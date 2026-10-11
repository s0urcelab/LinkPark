package api

import (
	"bytes"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"

	"github.com/linkpark/server/internal/store"
)

const testToken = "test-token-0123456789"

func newTestServer(t *testing.T) *httptest.Server {
	t.Helper()
	st, err := store.Open(filepath.Join(t.TempDir(), "api.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { st.Close() })
	ts := httptest.NewServer(New(st, testToken, slog.New(slog.NewTextHandler(io.Discard, nil))))
	t.Cleanup(ts.Close)
	return ts
}

func do(t *testing.T, ts *httptest.Server, method, path, token string, body any) (int, map[string]any) {
	t.Helper()
	var r io.Reader
	if body != nil {
		b, _ := json.Marshal(body)
		r = bytes.NewReader(b)
	}
	req, _ := http.NewRequest(method, ts.URL+path, r)
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	req.Header.Set("Origin", "chrome-extension://abc")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if method != http.MethodOptions && resp.Header.Get("Access-Control-Allow-Origin") != "chrome-extension://abc" {
		t.Errorf("missing CORS header on %s %s", method, path)
	}
	var out map[string]any
	json.NewDecoder(resp.Body).Decode(&out)
	return resp.StatusCode, out
}

func TestAuth(t *testing.T) {
	ts := newTestServer(t)
	if code, _ := do(t, ts, "GET", "/api/v1/tags", "", nil); code != http.StatusUnauthorized {
		t.Fatalf("no token: %d", code)
	}
	if code, _ := do(t, ts, "GET", "/api/v1/tags", "wrong", nil); code != http.StatusUnauthorized {
		t.Fatalf("wrong token: %d", code)
	}
	if code, _ := do(t, ts, "GET", "/healthz", "", nil); code != http.StatusOK {
		t.Fatalf("healthz: %d", code)
	}
	if code, _ := do(t, ts, "OPTIONS", "/api/v1/ops", "", nil); code != http.StatusNoContent {
		t.Fatalf("preflight: %d", code)
	}
}

func TestOpsAndPull(t *testing.T) {
	ts := newTestServer(t)
	ops := map[string]any{"ops": []map[string]any{
		{"op_id": "o1", "entity": "bookmark", "type": "create", "id": "b1", "payload": map[string]any{"url": "https://a.com", "title": "A", "tags": []string{"dev"}}},
		{"op_id": "o2", "entity": "bookmark", "type": "create", "id": "b2", "payload": map[string]any{"url": "https://b.com", "title": "B"}},
	}}
	code, body := do(t, ts, "POST", "/api/v1/ops", testToken, ops)
	if code != http.StatusOK || body["version"].(float64) != 2 {
		t.Fatalf("ops: %d %v", code, body)
	}

	code, body = do(t, ts, "POST", "/api/v1/ops", testToken, map[string]any{"ops": []map[string]any{
		{"op_id": "o3", "entity": "bookmark", "type": "delete", "id": "b2"},
	}})
	if code != http.StatusOK {
		t.Fatalf("delete: %d %v", code, body)
	}

	code, body = do(t, ts, "GET", "/api/v1/bookmarks?since=2", testToken, nil)
	list := body["bookmarks"].([]any)
	if code != http.StatusOK || len(list) != 1 || list[0].(map[string]any)["deleted_at"] == nil {
		t.Fatalf("incremental pull: %d %v", code, body)
	}

	code, body = do(t, ts, "GET", "/api/v1/bookmarks", testToken, nil)
	if code != http.StatusOK || len(body["bookmarks"].([]any)) != 1 || body["full"] != true {
		t.Fatalf("full pull: %d %v", code, body)
	}

	code, body = do(t, ts, "POST", "/api/v1/ops", testToken, map[string]any{"ops": []map[string]any{
		{"op_id": "o4", "entity": "bookmark", "type": "update", "id": "b1"},
	}})
	if code != http.StatusUnprocessableEntity {
		t.Fatalf("invalid op should be 422: %d %v", code, body)
	}
}

func TestImportAndTags(t *testing.T) {
	ts := newTestServer(t)
	code, body := do(t, ts, "POST", "/api/v1/import", testToken, map[string]any{"bookmarks": []map[string]any{
		{"url": "https://a.com", "title": "A", "tags": []string{"技术", "Go"}},
		{"url": "https://b.com", "title": "B", "tags": []string{"Go"}},
	}})
	if code != http.StatusOK || body["imported"].(float64) != 2 {
		t.Fatalf("import: %d %v", code, body)
	}
	code, body = do(t, ts, "GET", "/api/v1/tags", testToken, nil)
	tags := body["tags"].([]any)
	if code != http.StatusOK || len(tags) != 2 || tags[0].(map[string]any)["name"] != "Go" {
		t.Fatalf("tags: %d %v", code, body)
	}
}
