// Package model defines the wire and domain types shared by the store and API layers.
package model

import "encoding/json"

type Bookmark struct {
	ID        string   `json:"id"`
	URL       string   `json:"url"`
	Title     string   `json:"title"`
	Favicon   string   `json:"favicon"`
	Tags      []string `json:"tags"`
	CreatedAt int64    `json:"created_at"`
	UpdatedAt int64    `json:"updated_at"`
	DeletedAt *int64   `json:"deleted_at"`
	Version   int64    `json:"version"`
}

type OpType string

const (
	OpCreate OpType = "create"
	OpUpdate OpType = "update"
	OpDelete OpType = "delete"
)

type Op struct {
	OpID       string          `json:"op_id"`
	Type       OpType          `json:"type"`
	BookmarkID string          `json:"bookmark_id"`
	Payload    json.RawMessage `json:"payload,omitempty"`
	ClientTS   int64           `json:"client_ts"`
}

type CreatePayload struct {
	URL       string   `json:"url"`
	Title     string   `json:"title"`
	Favicon   string   `json:"favicon"`
	Tags      []string `json:"tags"`
	CreatedAt int64    `json:"created_at"`
}

// UpdatePayload fields are optional; nil means "leave unchanged".
type UpdatePayload struct {
	URL     *string   `json:"url"`
	Title   *string   `json:"title"`
	Favicon *string   `json:"favicon"`
	Tags    *[]string `json:"tags"`
}

type OpStatus string

const (
	StatusApplied   OpStatus = "applied"
	StatusDuplicate OpStatus = "duplicate" // create skipped: URL already bookmarked
	StatusIgnored   OpStatus = "ignored"   // target missing or already deleted
	StatusReplayed  OpStatus = "replayed"  // op_id was applied by an earlier request
)

type OpResult struct {
	OpID   string   `json:"op_id"`
	Status OpStatus `json:"status"`
}

type ImportItem struct {
	URL       string   `json:"url"`
	Title     string   `json:"title"`
	Tags      []string `json:"tags"`
	CreatedAt int64    `json:"created_at"`
}

type ImportResult struct {
	Imported int   `json:"imported"`
	Skipped  int   `json:"skipped"`
	Version  int64 `json:"version"`
}

type TagCount struct {
	Name  string `json:"name"`
	Count int    `json:"count"`
}
