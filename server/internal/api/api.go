// Package api wires the HTTP routes.
package api

import (
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/linkpark/server/internal/auth"
	"github.com/linkpark/server/internal/model"
	"github.com/linkpark/server/internal/store"
)

const (
	maxBodyBytes   = 16 << 20
	maxOpsPerBatch = 500
	maxImportItems = 5000
)

type Server struct {
	store *store.Store
	log   *slog.Logger
}

func New(s *store.Store, token string, log *slog.Logger) http.Handler {
	srv := &Server{store: s, log: log}

	authed := http.NewServeMux()
	authed.HandleFunc("POST /api/v1/ops", srv.handleOps)
	authed.HandleFunc("GET /api/v1/bookmarks", srv.handleList)
	authed.HandleFunc("POST /api/v1/import", srv.handleImport)
	authed.HandleFunc("GET /api/v1/tags", srv.handleTags)

	root := http.NewServeMux()
	root.HandleFunc("GET /healthz", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
	})
	root.Handle("/api/", auth.Middleware(token, authed))

	return srv.logging(cors(root))
}

// cors allows browser-extension origins. Extensions granted host permissions bypass
// CORS anyway; this covers the case where the user hasn't granted them.
func cors(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		origin := r.Header.Get("Origin")
		if strings.HasPrefix(origin, "chrome-extension://") {
			h := w.Header()
			h.Set("Access-Control-Allow-Origin", origin)
			h.Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
			h.Set("Access-Control-Allow-Headers", "Authorization, Content-Type")
			h.Set("Access-Control-Max-Age", "86400")
			h.Add("Vary", "Origin")
		}
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

type statusRecorder struct {
	http.ResponseWriter
	status int
}

func (r *statusRecorder) WriteHeader(code int) {
	r.status = code
	r.ResponseWriter.WriteHeader(code)
}

func (s *Server) logging(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		rec := &statusRecorder{ResponseWriter: w, status: http.StatusOK}
		next.ServeHTTP(rec, r)
		if r.URL.Path == "/healthz" {
			return
		}
		s.log.Info("request", "method", r.Method, "path", r.URL.Path, "status", rec.status, "dur", time.Since(start))
	})
}

func (s *Server) handleOps(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Ops []model.Op `json:"ops"`
	}
	if !decode(w, r, &req) {
		return
	}
	if len(req.Ops) == 0 {
		writeError(w, http.StatusBadRequest, "ops is empty")
		return
	}
	if len(req.Ops) > maxOpsPerBatch {
		writeError(w, http.StatusRequestEntityTooLarge, "too many ops in one batch")
		return
	}
	results, version, err := s.store.ApplyOps(r.Context(), req.Ops)
	if err != nil {
		s.storeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"version": version, "results": results})
}

func (s *Server) handleList(w http.ResponseWriter, r *http.Request) {
	var since int64
	if v := r.URL.Query().Get("since"); v != "" {
		n, err := strconv.ParseInt(v, 10, 64)
		if err != nil || n < 0 {
			writeError(w, http.StatusBadRequest, "invalid since")
			return
		}
		since = n
	}
	changes, err := s.store.Changes(r.Context(), since)
	if err != nil {
		s.storeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, changes)
}

func (s *Server) handleImport(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Bookmarks []model.ImportItem `json:"bookmarks"`
		Tags      []model.TagMeta    `json:"tags"`
	}
	if !decode(w, r, &req) {
		return
	}
	if len(req.Bookmarks) > maxImportItems || len(req.Tags) > maxImportItems {
		writeError(w, http.StatusRequestEntityTooLarge, "too many bookmarks in one request")
		return
	}
	res, err := s.store.Import(r.Context(), req.Bookmarks, req.Tags)
	if err != nil {
		s.storeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, res)
}

func (s *Server) handleTags(w http.ResponseWriter, r *http.Request) {
	tags, err := s.store.ListTags(r.Context())
	if err != nil {
		s.storeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"tags": tags})
}

func (s *Server) storeError(w http.ResponseWriter, err error) {
	var ve *store.ValidationError
	if errors.As(err, &ve) {
		writeError(w, http.StatusUnprocessableEntity, ve.Msg)
		return
	}
	s.log.Error("store error", "err", err)
	writeError(w, http.StatusInternalServerError, "internal error")
}

func decode(w http.ResponseWriter, r *http.Request, v any) bool {
	r.Body = http.MaxBytesReader(w, r.Body, maxBodyBytes)
	if err := json.NewDecoder(r.Body).Decode(v); err != nil {
		var mbe *http.MaxBytesError
		if errors.As(err, &mbe) {
			writeError(w, http.StatusRequestEntityTooLarge, "request body too large")
		} else {
			writeError(w, http.StatusBadRequest, "invalid JSON: "+err.Error())
		}
		return false
	}
	return true
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v)
}

func writeError(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]string{"error": msg})
}
