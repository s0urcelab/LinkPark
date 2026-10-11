package store

import (
	"context"
	"encoding/json"
	"errors"
	"path/filepath"
	"strings"
	"testing"

	"github.com/linkpark/server/internal/model"
)

func newTestStore(t *testing.T) *Store {
	t.Helper()
	s, err := Open(filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { s.Close() })
	return s
}

func mustJSON(v any) json.RawMessage {
	b, _ := json.Marshal(v)
	return b
}

func createOp(opID, id, url string, tags ...string) model.Op {
	return model.Op{OpID: opID, Type: model.OpCreate, Entity: model.EntityBookmark, ID: id,
		Payload: mustJSON(model.CreatePayload{URL: url, Title: "t " + url, Tags: tags})}
}

func changes(t *testing.T, s *Store, since int64) model.Changes {
	t.Helper()
	c, err := s.Changes(context.Background(), since)
	if err != nil {
		t.Fatal(err)
	}
	return c
}

func TestApplyOpsLifecycle(t *testing.T) {
	s := newTestStore(t)
	ctx := context.Background()

	res, v1, err := s.ApplyOps(ctx, []model.Op{
		createOp("o1", "b1", "https://a.com", "Go", "go", "dev"),
		createOp("o2", "b2", "https://b.com"),
	})
	if err != nil {
		t.Fatal(err)
	}
	if v1 != 2 || res[0].Status != model.StatusApplied || res[1].Status != model.StatusApplied {
		t.Fatalf("unexpected: v=%d res=%+v", v1, res)
	}

	all := changes(t, s, 0).Bookmarks
	if len(all) != 2 || len(all[0].Tags) != 2 {
		t.Fatalf("expected 2 bookmarks, tags deduped case-insensitively: %+v", all)
	}

	title := "renamed"
	tags := []string{"x"}
	_, v2, err := s.ApplyOps(ctx, []model.Op{
		{OpID: "o3", Type: model.OpUpdate, Entity: model.EntityBookmark, ID: "b1", Payload: mustJSON(model.UpdatePayload{Title: &title, Tags: &tags})},
		{OpID: "o4", Type: model.OpDelete, Entity: model.EntityBookmark, ID: "b2"},
	})
	if err != nil {
		t.Fatal(err)
	}

	c := changes(t, s, v1)
	changed, cur := c.Bookmarks, c.Version
	if cur != v2 || len(changed) != 2 {
		t.Fatalf("expected 2 changes at v%d, got %d at v%d", v2, len(changed), cur)
	}
	for _, b := range changed {
		switch b.ID {
		case "b1":
			if b.Title != "renamed" || len(b.Tags) != 1 || b.Tags[0] != "x" {
				t.Fatalf("bad update: %+v", b)
			}
		case "b2":
			if b.DeletedAt == nil {
				t.Fatalf("expected tombstone: %+v", b)
			}
		}
	}

	full := changes(t, s, 0).Bookmarks
	if len(full) != 1 {
		t.Fatalf("full snapshot should omit tombstones, got %d", len(full))
	}

	tagList, err := s.ListTags(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if len(tagList) != 1 || tagList[0].Name != "x" {
		t.Fatalf("orphan tags should be cleaned: %+v", tagList)
	}
}

func TestApplyOpsIdempotent(t *testing.T) {
	s := newTestStore(t)
	ctx := context.Background()
	batch := []model.Op{createOp("o1", "b1", "https://a.com")}
	if _, _, err := s.ApplyOps(ctx, batch); err != nil {
		t.Fatal(err)
	}
	res, v, err := s.ApplyOps(ctx, batch)
	if err != nil {
		t.Fatal(err)
	}
	if res[0].Status != model.StatusReplayed || v != 1 {
		t.Fatalf("replay should be a no-op: %+v v=%d", res, v)
	}
}

func TestApplyOpsAtomic(t *testing.T) {
	s := newTestStore(t)
	ctx := context.Background()
	_, _, err := s.ApplyOps(ctx, []model.Op{
		createOp("o1", "b1", "https://a.com"),
		{OpID: "o2", Type: "bogus", Entity: model.EntityBookmark, ID: "b1"},
	})
	var ve *ValidationError
	if !errors.As(err, &ve) {
		t.Fatalf("expected validation error, got %v", err)
	}
	c := changes(t, s, 0)
	all, v := c.Bookmarks, c.Version
	if len(all) != 0 || v != 0 {
		t.Fatalf("batch should have rolled back: %d bookmarks, v=%d", len(all), v)
	}
	// The rolled-back op_id must not be marked applied.
	res, _, err := s.ApplyOps(ctx, []model.Op{createOp("o1", "b1", "https://a.com")})
	if err != nil || res[0].Status != model.StatusApplied {
		t.Fatalf("retry after rollback should apply: %+v %v", res, err)
	}
}

func TestDuplicateAndDeleteSemantics(t *testing.T) {
	s := newTestStore(t)
	ctx := context.Background()
	res, _, err := s.ApplyOps(ctx, []model.Op{
		createOp("o1", "b1", "https://a.com"),
		createOp("o2", "b2", "https://a.com"),
		{OpID: "o3", Type: model.OpDelete, Entity: model.EntityBookmark, ID: "ghost"},
		createOp("o4", "ghost", "https://ghost.com"),
	})
	if err != nil {
		t.Fatal(err)
	}
	want := []model.OpStatus{model.StatusApplied, model.StatusDuplicate, model.StatusIgnored, model.StatusIgnored}
	for i, r := range res {
		if r.Status != want[i] {
			t.Fatalf("op %d: want %s got %s", i, want[i], r.Status)
		}
	}

	// After deleting, the same URL may be bookmarked again under a new id.
	res, _, err = s.ApplyOps(ctx, []model.Op{
		{OpID: "o5", Type: model.OpDelete, Entity: model.EntityBookmark, ID: "b1"},
		createOp("o6", "b3", "https://a.com"),
	})
	if err != nil || res[1].Status != model.StatusApplied {
		t.Fatalf("re-create after delete: %+v %v", res, err)
	}
}

func TestImport(t *testing.T) {
	s := newTestStore(t)
	ctx := context.Background()
	if _, _, err := s.ApplyOps(ctx, []model.Op{createOp("o1", "b1", "https://a.com")}); err != nil {
		t.Fatal(err)
	}
	r, err := s.Import(ctx, []model.ImportItem{
		{URL: "https://a.com", Title: "exists"},
		{URL: "https://b.com", Title: "b", Tags: []string{"技术"}},
		{URL: "https://b.com", Title: "b dup", Tags: []string{"Go"}},
		{URL: "  ", Title: "empty"},
	}, nil)
	if err != nil {
		t.Fatal(err)
	}
	if r.Imported != 1 || r.Skipped != 3 {
		t.Fatalf("unexpected import result: %+v", r)
	}
	for _, b := range changes(t, s, 0).Bookmarks {
		if b.URL == "https://b.com" && len(b.Tags) != 2 {
			t.Fatalf("in-batch duplicates should merge tags: %+v", b)
		}
	}
}

func TestImportFavicon(t *testing.T) {
	s := newTestStore(t)
	png := "data:image/png;base64,AAAA"
	_, err := s.Import(context.Background(), []model.ImportItem{
		{URL: "https://icon.com", Title: "i", Favicon: png},
		{URL: "https://icon.com", Title: "dup", Favicon: "data:image/png;base64,BBBB"},
		{URL: "https://later.com", Title: "1", Favicon: "https://later.com/favicon.ico"},
		{URL: "https://later.com", Title: "2", Favicon: "data:image/png;base64,CCCC"},
		{URL: "https://nope.com", Title: "n", Favicon: "data:image/svg+xml;base64,AAAA"},
		{URL: "https://big.com", Title: "b", Favicon: "data:image/png;base64," + strings.Repeat("A", maxFaviconLen)},
	}, nil)
	if err != nil {
		t.Fatal(err)
	}
	got := map[string]string{}
	for _, b := range changes(t, s, 0).Bookmarks {
		got[b.URL] = b.Favicon
	}
	if got["https://icon.com"] != png || got["https://later.com"] != "data:image/png;base64,CCCC" {
		t.Fatalf("favicon merge: %v", got)
	}
	if got["https://nope.com"] != "" || got["https://big.com"] != "" {
		t.Fatalf("rejected favicons should be dropped: %v", got)
	}
}
