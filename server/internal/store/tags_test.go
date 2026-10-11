package store

import (
	"context"
	"errors"
	"testing"

	"github.com/linkpark/server/internal/model"
)

func tagOp(opID, name string, p model.TagUpdatePayload) model.Op {
	return model.Op{OpID: opID, Entity: model.EntityTag, Type: model.OpUpdate, ID: name, Payload: mustJSON(p)}
}

func ptr[T any](v T) *T { return &v }

func mustApply(t *testing.T, s *Store, ops ...model.Op) []model.OpResult {
	t.Helper()
	res, _, err := s.ApplyOps(context.Background(), ops)
	if err != nil {
		t.Fatal(err)
	}
	return res
}

func tagsByURL(t *testing.T, s *Store) map[string][]string {
	t.Helper()
	out := map[string][]string{}
	for _, b := range changes(t, s, 0).Bookmarks {
		out[b.URL] = b.Tags
	}
	return out
}

func metaByName(t *testing.T, s *Store) map[string]model.TagMeta {
	t.Helper()
	out := map[string]model.TagMeta{}
	for _, m := range changes(t, s, 0).Tags {
		out[m.Name] = m
	}
	return out
}

func TestFlatTagsKeepSlash(t *testing.T) {
	s := newTestStore(t)
	mustApply(t, s, createOp("o1", "b1", "https://a.com", " 技术/前端 ", "go"))
	if got := tagsByURL(t, s)["https://a.com"]; len(got) != 2 || got[1] != "技术/前端" {
		t.Fatalf("tags: %v", got)
	}
}

func TestBookmarkRank(t *testing.T) {
	s := newTestStore(t)
	op := createOp("o1", "b1", "https://a.com")
	op.Payload = mustJSON(model.CreatePayload{URL: "https://a.com", Rank: "V"})
	mustApply(t, s, op)
	mustApply(t, s, model.Op{OpID: "o2", Entity: model.EntityBookmark, Type: model.OpUpdate, ID: "b1",
		Payload: mustJSON(model.UpdatePayload{Rank: ptr("k")})})
	if b := changes(t, s, 0).Bookmarks[0]; b.Rank != "k" {
		t.Fatalf("rank: %+v", b)
	}
	_, _, err := s.ApplyOps(context.Background(), []model.Op{{OpID: "o3", Entity: model.EntityBookmark, Type: model.OpUpdate,
		ID: "b1", Payload: mustJSON(model.UpdatePayload{Rank: ptr("a-b")})}})
	var ve *ValidationError
	if !errors.As(err, &ve) {
		t.Fatalf("bad rank should be rejected, got %v", err)
	}
}

func TestTagMeta(t *testing.T) {
	s := newTestStore(t)
	mustApply(t, s, createOp("o1", "b1", "https://a.com", "go"))
	v0 := changes(t, s, 0).Version
	mustApply(t, s,
		tagOp("o2", "Go", model.TagUpdatePayload{Rank: ptr("V"), Pinned: ptr(true)}),
		tagOp("o3", "", model.TagUpdatePayload{Rank: ptr("1")}),
		tagOp("o4", "unused", model.TagUpdatePayload{Pinned: ptr(true)}),
	)
	c := changes(t, s, v0)
	if c.Version <= v0 || len(c.Tags) != 2 {
		t.Fatalf("meta of unused tags must be hidden: %+v", c.Tags)
	}
	// The untagged tag defaults to pinned; tag names match case-insensitively.
	if c.Tags[0] != (model.TagMeta{Name: "", Rank: "1", Pinned: true}) ||
		c.Tags[1] != (model.TagMeta{Name: "go", Rank: "V", Pinned: true}) {
		t.Fatalf("meta: %+v", c.Tags)
	}
	// Removing the last bookmark hides the meta; re-creating the tag brings it back.
	mustApply(t, s, model.Op{OpID: "o5", Entity: model.EntityBookmark, Type: model.OpDelete, ID: "b1"})
	if len(metaByName(t, s)) != 1 {
		t.Fatal("orphan tag meta should be hidden")
	}
	mustApply(t, s, createOp("o6", "b2", "https://b.com", "go"))
	if m := metaByName(t, s)["go"]; m.Rank != "V" {
		t.Fatalf("re-created tag should keep its meta: %+v", m)
	}

	for _, op := range []model.Op{
		{OpID: "x1", Entity: model.EntityTag, Type: model.OpDelete, ID: ""},
		tagOp("x2", "", model.TagUpdatePayload{Name: ptr("foo")}),
		tagOp("x3", "go", model.TagUpdatePayload{Rank: ptr("!")}),
	} {
		_, _, err := s.ApplyOps(context.Background(), []model.Op{op})
		var ve *ValidationError
		if !errors.As(err, &ve) {
			t.Fatalf("%s should be rejected, got %v", op.OpID, err)
		}
	}
}

func TestTagRenameAndMerge(t *testing.T) {
	s := newTestStore(t)
	mustApply(t, s,
		createOp("o1", "b1", "https://a.com", "js", "web"),
		createOp("o2", "b2", "https://b.com", "javascript"),
		createOp("o3", "b3", "https://c.com", "other"),
		tagOp("o4", "js", model.TagUpdatePayload{Rank: ptr("a"), Pinned: ptr(true)}),
		tagOp("o5", "javascript", model.TagUpdatePayload{Rank: ptr("b")}),
	)
	v0 := changes(t, s, 0).Version

	// Case-only rename keeps the meta.
	mustApply(t, s, tagOp("o6", "web", model.TagUpdatePayload{Name: ptr("Web")}))
	if got := tagsByURL(t, s)["https://a.com"]; got[0] != "Web" {
		t.Fatalf("case rename: %v", got)
	}

	// Merging js into javascript: the target keeps its own meta.
	res := mustApply(t, s, tagOp("o7", "js", model.TagUpdatePayload{Name: ptr("JavaScript")}))
	if res[0].Status != model.StatusApplied {
		t.Fatalf("merge status: %v", res)
	}
	tags := tagsByURL(t, s)
	if len(tags["https://a.com"]) != 2 || tags["https://a.com"][0] != "Web" || tags["https://a.com"][1] != "javascript" {
		t.Fatalf("merged tags: %v", tags)
	}
	meta := metaByName(t, s)
	if _, ok := meta["js"]; ok || meta["javascript"].Rank != "b" || meta["javascript"].Pinned {
		t.Fatalf("merge meta: %+v", meta)
	}
	changed := map[string]bool{}
	for _, b := range changes(t, s, v0).Bookmarks {
		changed[b.ID] = true
	}
	if !changed["b1"] || changed["b2"] || changed["b3"] {
		t.Fatalf("only bookmarks that lost a tag need a new version: %v", changed)
	}

	// Renaming to a fresh name moves the meta along.
	mustApply(t, s, tagOp("o8", "javascript", model.TagUpdatePayload{Name: ptr("JS")}))
	if m := metaByName(t, s)["JS"]; m.Rank != "b" {
		t.Fatalf("rename meta: %+v", metaByName(t, s))
	}
	if res := mustApply(t, s, tagOp("o9", "missing", model.TagUpdatePayload{Name: ptr("x")})); res[0].Status != model.StatusIgnored {
		t.Fatalf("renaming a missing tag: %v", res)
	}
}

func TestTagDelete(t *testing.T) {
	s := newTestStore(t)
	mustApply(t, s,
		createOp("o1", "b1", "https://a.com", "go", "web"),
		createOp("o2", "b2", "https://b.com", "go"),
		tagOp("o3", "go", model.TagUpdatePayload{Pinned: ptr(true)}),
	)
	mustApply(t, s, model.Op{OpID: "o4", Entity: model.EntityTag, Type: model.OpDelete, ID: "GO"})
	tags := tagsByURL(t, s)
	if len(tags) != 2 || len(tags["https://a.com"]) != 1 || len(tags["https://b.com"]) != 0 {
		t.Fatalf("bookmarks should stay, minus the tag: %v", tags)
	}
	if _, ok := metaByName(t, s)["go"]; ok {
		t.Fatal("deleted tag meta should be gone")
	}
	mustApply(t, s, createOp("o5", "b3", "https://c.com", "go"))
	if _, ok := metaByName(t, s)["go"]; ok {
		t.Fatal("a re-created tag must not inherit deleted meta")
	}
}

func TestImportRanksAndMeta(t *testing.T) {
	s := newTestStore(t)
	ctx := context.Background()
	_, err := s.Import(ctx, []model.ImportItem{
		{URL: "https://a.com", Tags: []string{"技术", "前端"}, Rank: "U"},
		{URL: "https://b.com", Rank: "bad!"},
	}, []model.TagMeta{
		{Name: "", Rank: "1", Pinned: true},
		{Name: "技术", Rank: "U", Pinned: true},
		{Name: "前端", Rank: "k"},
	})
	if err != nil {
		t.Fatal(err)
	}
	ranks := map[string]string{}
	for _, b := range changes(t, s, 0).Bookmarks {
		ranks[b.URL] = b.Rank
	}
	if ranks["https://a.com"] != "U" || ranks["https://b.com"] != "" {
		t.Fatalf("ranks: %v", ranks)
	}

	// A re-import must not override the user's own ordering.
	mustApply(t, s, tagOp("o1", "技术", model.TagUpdatePayload{Rank: ptr("z"), Pinned: ptr(false)}))
	if _, err := s.Import(ctx, nil, []model.TagMeta{{Name: "技术", Rank: "U", Pinned: true}}); err != nil {
		t.Fatal(err)
	}
	meta := metaByName(t, s)
	if len(meta) != 3 || meta["技术"].Rank != "z" || meta["技术"].Pinned || !meta[""].Pinned {
		t.Fatalf("meta: %+v", meta)
	}
}

func TestStashLifecycle(t *testing.T) {
	s := newTestStore(t)
	items := []model.StashItem{{URL: "https://a.com", Title: " A "}, {URL: "https://b.com"}}
	mustApply(t, s, model.Op{OpID: "o1", Entity: model.EntityStash, Type: model.OpCreate, ID: "s1",
		Payload: mustJSON(model.StashCreatePayload{Name: "w", Items: items})})
	mustApply(t, s, model.Op{OpID: "o2", Entity: model.EntityStash, Type: model.OpUpdate, ID: "s1",
		Payload: mustJSON(model.StashUpdatePayload{Items: &[]model.StashItem{items[1]}})})
	c := changes(t, s, 0)
	if len(c.Stashes) != 1 || len(c.Stashes[0].Items) != 1 || c.Stashes[0].Items[0].URL != "https://b.com" {
		t.Fatalf("stash: %+v", c.Stashes)
	}
	mustApply(t, s, model.Op{OpID: "o3", Entity: model.EntityStash, Type: model.OpDelete, ID: "s1"})
	if c2 := changes(t, s, c.Version); len(c2.Stashes) != 1 || c2.Stashes[0].DeletedAt == nil {
		t.Fatalf("tombstone: %+v", c2.Stashes)
	}
	if len(changes(t, s, 0).Stashes) != 0 {
		t.Fatal("full snapshot should skip deleted stashes")
	}
}
