// Package model defines the wire and domain types shared by the store and API layers.
package model

import "encoding/json"

type Bookmark struct {
	ID      string   `json:"id"`
	URL     string   `json:"url"`
	Title   string   `json:"title"`
	Favicon string   `json:"favicon"`
	Tags    []string `json:"tags"`
	// Rank is the bookmark's place in the single global order (a fractional-index key
	// compared bytewise). Any tag filter shows its results in this order.
	Rank      string `json:"rank"`
	CreatedAt int64  `json:"created_at"`
	UpdatedAt int64  `json:"updated_at"`
	DeletedAt *int64 `json:"deleted_at"`
	Version   int64  `json:"version"`
}

// UntaggedKey is the TagMeta name of the virtual "未分类" tag, which holds every
// bookmark without tags. Real tags are never empty.
const UntaggedKey = ""

// TagMeta is the user's ordering and pinning of a tag.
type TagMeta struct {
	Name   string `json:"name"`
	Rank   string `json:"rank"`
	Pinned bool   `json:"pinned"`
}

type StashItem struct {
	URL   string `json:"url"`
	Title string `json:"title"`
}

// Stash is one batch of tabs saved together; items keep the original tab order.
type Stash struct {
	ID        string      `json:"id"`
	Name      string      `json:"name"`
	Items     []StashItem `json:"items"`
	CreatedAt int64       `json:"created_at"`
	UpdatedAt int64       `json:"updated_at"`
	DeletedAt *int64      `json:"deleted_at"`
	Version   int64       `json:"version"`
}

type Entity string

const (
	EntityBookmark Entity = "bookmark"
	// EntityTag ops address a tag by name; UntaggedKey addresses the virtual tag.
	EntityTag   Entity = "tag"
	EntityStash Entity = "stash"
)

type OpType string

const (
	OpCreate OpType = "create"
	OpUpdate OpType = "update"
	OpDelete OpType = "delete"
)

type Op struct {
	OpID     string          `json:"op_id"`
	Entity   Entity          `json:"entity"`
	Type     OpType          `json:"type"`
	ID       string          `json:"id"`
	Payload  json.RawMessage `json:"payload,omitempty"`
	ClientTS int64           `json:"client_ts"`
}

type CreatePayload struct {
	URL       string   `json:"url"`
	Title     string   `json:"title"`
	Favicon   string   `json:"favicon"`
	Tags      []string `json:"tags"`
	Rank      string   `json:"rank"`
	CreatedAt int64    `json:"created_at"`
}

// UpdatePayload fields are optional; nil means "leave unchanged".
type UpdatePayload struct {
	URL     *string   `json:"url"`
	Title   *string   `json:"title"`
	Favicon *string   `json:"favicon"`
	Tags    *[]string `json:"tags"`
	Rank    *string   `json:"rank"`
}

// TagUpdatePayload: Name renames the tag on every bookmark (merging into an existing
// tag of that name); Rank and Pinned edit its metadata.
type TagUpdatePayload struct {
	Name   *string `json:"name"`
	Rank   *string `json:"rank"`
	Pinned *bool   `json:"pinned"`
}

type StashCreatePayload struct {
	Name      string      `json:"name"`
	Items     []StashItem `json:"items"`
	CreatedAt int64       `json:"created_at"`
}

type StashUpdatePayload struct {
	Name  *string      `json:"name"`
	Items *[]StashItem `json:"items"`
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

// Changes is everything modified after a given version. Tags is always the complete
// metadata list, since it is small and tags have no tombstones.
type Changes struct {
	Version   int64      `json:"version"`
	Full      bool       `json:"full"`
	Bookmarks []Bookmark `json:"bookmarks"`
	Stashes   []Stash    `json:"stashes"`
	Tags      []TagMeta  `json:"tags"`
}

type ImportItem struct {
	URL       string   `json:"url"`
	Title     string   `json:"title"`
	Tags      []string `json:"tags"`
	Rank      string   `json:"rank"`
	CreatedAt int64    `json:"created_at"`
	// Data-URL image captured at import. Empty when the client had nothing to store.
	Favicon string `json:"favicon"`
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
