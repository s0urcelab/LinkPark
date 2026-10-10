package store

import (
	"context"
	"encoding/json"
	"errors"
	"path/filepath"
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
	return model.Op{OpID: opID, Type: model.OpCreate, BookmarkID: id,
		Payload: mustJSON(model.CreatePayload{URL: url, Title: "t " + url, Tags: tags})}
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

	all, _, err := s.ListSince(ctx, 0)
	if err != nil {
		t.Fatal(err)
	}
	if len(all) != 2 || len(all[0].Tags) != 2 {
		t.Fatalf("expected 2 bookmarks, tags deduped case-insensitively: %+v", all)
	}

	title := "renamed"
	tags := []string{"x"}
	_, v2, err := s.ApplyOps(ctx, []model.Op{
		{OpID: "o3", Type: model.OpUpdate, BookmarkID: "b1", Payload: mustJSON(model.UpdatePayload{Title: &title, Tags: &tags})},
		{OpID: "o4", Type: model.OpDelete, BookmarkID: "b2"},
	})
	if err != nil {
		t.Fatal(err)
	}

	changed, cur, err := s.ListSince(ctx, v1)
	if err != nil {
		t.Fatal(err)
	}
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

	full, _, _ := s.ListSince(ctx, 0)
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
		{OpID: "o2", Type: "bogus", BookmarkID: "b1"},
	})
	var ve *ValidationError
	if !errors.As(err, &ve) {
		t.Fatalf("expected validation error, got %v", err)
	}
	all, v, _ := s.ListSince(ctx, 0)
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
		{OpID: "o3", Type: model.OpDelete, BookmarkID: "ghost"},
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
		{OpID: "o5", Type: model.OpDelete, BookmarkID: "b1"},
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
	})
	if err != nil {
		t.Fatal(err)
	}
	if r.Imported != 1 || r.Skipped != 3 {
		t.Fatalf("unexpected import result: %+v", r)
	}
	all, _, _ := s.ListSince(ctx, 0)
	for _, b := range all {
		if b.URL == "https://b.com" && len(b.Tags) != 2 {
			t.Fatalf("in-batch duplicates should merge tags: %+v", b)
		}
	}
}
