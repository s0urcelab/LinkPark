// Package store implements SQLite persistence. Every mutating call bumps the global
// version counter so clients can pull changes incrementally with ?since=<version>.
package store

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"regexp"
	"sort"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/linkpark/server/internal/model"
	"github.com/linkpark/server/migrations"

	_ "modernc.org/sqlite"
)

const (
	maxURLLen   = 8192
	maxTitleLen = 1024
	maxTagLen   = 64
	maxTags     = 32
	// A 32px PNG data URL does not fit in maxURLLen. Drop it rather than truncate it into a broken URL.
	maxFaviconLen = 65536

	// tagSep must never appear in a tag name; normalizeTags strips control characters.
	tagSep = "\x1f"
)

// ValidationError marks a client error that must fail the whole batch without retry.
type ValidationError struct{ Msg string }

func (e *ValidationError) Error() string { return e.Msg }

func invalid(format string, args ...any) error {
	return &ValidationError{Msg: fmt.Sprintf(format, args...)}
}

type Store struct {
	db  *sql.DB
	now func() time.Time
}

func Open(path string) (*Store, error) {
	dsn := fmt.Sprintf("file:%s?_pragma=foreign_keys(1)&_pragma=journal_mode(WAL)&_pragma=busy_timeout(5000)&_pragma=synchronous(NORMAL)", path)
	db, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, err
	}
	// A single connection serializes writers and keeps per-connection pragmas consistent.
	db.SetMaxOpenConns(1)
	s := &Store{db: db, now: time.Now}
	if err := s.migrate(context.Background()); err != nil {
		db.Close()
		return nil, fmt.Errorf("migrate: %w", err)
	}
	return s, nil
}

func (s *Store) Close() error { return s.db.Close() }

func (s *Store) migrate(ctx context.Context) error {
	if _, err := s.db.ExecContext(ctx, `CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY)`); err != nil {
		return err
	}
	names, err := fs.Glob(migrations.FS, "*.sql")
	if err != nil {
		return err
	}
	sort.Strings(names)
	for _, name := range names {
		var exists int
		if err := s.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM schema_migrations WHERE name = ?`, name).Scan(&exists); err != nil {
			return err
		}
		if exists > 0 {
			continue
		}
		body, err := migrations.FS.ReadFile(name)
		if err != nil {
			return err
		}
		tx, err := s.db.BeginTx(ctx, nil)
		if err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx, string(body)); err != nil {
			tx.Rollback()
			return fmt.Errorf("%s: %w", name, err)
		}
		if _, err := tx.ExecContext(ctx, `INSERT INTO schema_migrations (name) VALUES (?)`, name); err != nil {
			tx.Rollback()
			return err
		}
		if err := tx.Commit(); err != nil {
			return err
		}
	}
	return nil
}

func (s *Store) nowMs() int64 { return s.now().UnixMilli() }

// PruneAppliedOps forgets idempotency keys older than maxAge.
func (s *Store) PruneAppliedOps(ctx context.Context, maxAge time.Duration) error {
	_, err := s.db.ExecContext(ctx, `DELETE FROM applied_ops WHERE applied_at < ?`, s.now().Add(-maxAge).UnixMilli())
	return err
}

func (s *Store) CurrentVersion(ctx context.Context) (int64, error) {
	var v int64
	err := s.db.QueryRowContext(ctx, `SELECT value FROM meta WHERE key = 'version'`).Scan(&v)
	return v, err
}

func bumpVersion(ctx context.Context, tx *sql.Tx) (int64, error) {
	var v int64
	err := tx.QueryRowContext(ctx, `UPDATE meta SET value = value + 1 WHERE key = 'version' RETURNING value`).Scan(&v)
	return v, err
}

// ApplyOps applies a batch atomically: either every op is applied (or skipped as a
// replay/no-op) and committed, or the transaction is rolled back.
func (s *Store) ApplyOps(ctx context.Context, ops []model.Op) ([]model.OpResult, int64, error) {
	for i, op := range ops {
		if strings.TrimSpace(op.OpID) == "" {
			return nil, 0, invalid("ops[%d]: op_id is required", i)
		}
		// Tag ops address the virtual "untagged" tag with an empty id.
		if op.Entity != model.EntityTag && strings.TrimSpace(op.ID) == "" {
			return nil, 0, invalid("ops[%d]: id is required", i)
		}
	}

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, 0, err
	}
	defer tx.Rollback()

	results := make([]model.OpResult, 0, len(ops))
	for i, op := range ops {
		var seen int
		if err := tx.QueryRowContext(ctx, `SELECT COUNT(*) FROM applied_ops WHERE op_id = ?`, op.OpID).Scan(&seen); err != nil {
			return nil, 0, err
		}
		if seen > 0 {
			results = append(results, model.OpResult{OpID: op.OpID, Status: model.StatusReplayed})
			continue
		}

		var status model.OpStatus
		switch op.Entity {
		case model.EntityBookmark:
			status, err = s.applyBookmarkOp(ctx, tx, op)
		case model.EntityTag:
			status, err = s.applyTagOp(ctx, tx, op)
		case model.EntityStash:
			status, err = s.applyStashOp(ctx, tx, op)
		default:
			err = invalid("unknown entity %q", op.Entity)
		}
		if err != nil {
			var ve *ValidationError
			if errors.As(err, &ve) {
				return nil, 0, invalid("ops[%d] (%s): %s", i, op.OpID, ve.Msg)
			}
			return nil, 0, fmt.Errorf("ops[%d] (%s): %w", i, op.OpID, err)
		}
		if _, err := tx.ExecContext(ctx, `INSERT INTO applied_ops (op_id, applied_at) VALUES (?, ?)`, op.OpID, s.nowMs()); err != nil {
			return nil, 0, err
		}
		results = append(results, model.OpResult{OpID: op.OpID, Status: status})
	}

	if err := cleanupOrphanTags(ctx, tx); err != nil {
		return nil, 0, err
	}
	var version int64
	if err := tx.QueryRowContext(ctx, `SELECT value FROM meta WHERE key = 'version'`).Scan(&version); err != nil {
		return nil, 0, err
	}
	if err := tx.Commit(); err != nil {
		return nil, 0, err
	}
	return results, version, nil
}

func decodePayload(raw json.RawMessage, v any) error {
	if len(raw) == 0 {
		return invalid("payload is required")
	}
	if err := json.Unmarshal(raw, v); err != nil {
		return invalid("bad payload: %v", err)
	}
	return nil
}

func (s *Store) applyBookmarkOp(ctx context.Context, tx *sql.Tx, op model.Op) (model.OpStatus, error) {
	switch op.Type {
	case model.OpCreate:
		return s.applyCreate(ctx, tx, op)
	case model.OpUpdate:
		return s.applyUpdate(ctx, tx, op)
	case model.OpDelete:
		return s.applyDelete(ctx, tx, op)
	}
	return "", invalid("unknown op type %q", op.Type)
}

func (s *Store) applyCreate(ctx context.Context, tx *sql.Tx, op model.Op) (model.OpStatus, error) {
	var p model.CreatePayload
	if err := decodePayload(op.Payload, &p); err != nil {
		return "", err
	}
	url, err := normalizeURL(p.URL)
	if err != nil {
		return "", err
	}
	tags, err := normalizeTags(p.Tags)
	if err != nil {
		return "", err
	}
	title := truncate(strings.TrimSpace(p.Title), maxTitleLen)
	if !validRank(p.Rank) {
		return "", invalid("bad rank %q", p.Rank)
	}

	var existingID string
	err = tx.QueryRowContext(ctx, `SELECT id FROM bookmarks WHERE url = ? AND deleted_at IS NULL`, url).Scan(&existingID)
	switch {
	case err == nil && existingID != op.ID:
		return model.StatusDuplicate, nil
	case err != nil && !errors.Is(err, sql.ErrNoRows):
		return "", err
	}

	var deleted sql.NullInt64
	err = tx.QueryRowContext(ctx, `SELECT deleted_at FROM bookmarks WHERE id = ?`, op.ID).Scan(&deleted)
	if err == nil && deleted.Valid {
		// A delete for this id already happened; don't resurrect it.
		return model.StatusIgnored, nil
	}
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return "", err
	}

	version, err := bumpVersion(ctx, tx)
	if err != nil {
		return "", err
	}
	now := s.nowMs()
	createdAt := p.CreatedAt
	if createdAt <= 0 || createdAt > now {
		createdAt = now
	}
	_, err = tx.ExecContext(ctx, `
		INSERT INTO bookmarks (id, url, title, favicon, rank, created_at, updated_at, version)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT (id) DO UPDATE SET url = excluded.url, title = excluded.title, favicon = excluded.favicon,
			rank = excluded.rank, updated_at = excluded.updated_at, version = excluded.version`,
		op.ID, url, title, truncate(p.Favicon, maxURLLen), p.Rank, createdAt, now, version)
	if err != nil {
		return "", err
	}
	if err := setTags(ctx, tx, op.ID, tags); err != nil {
		return "", err
	}
	return model.StatusApplied, nil
}

func (s *Store) applyUpdate(ctx context.Context, tx *sql.Tx, op model.Op) (model.OpStatus, error) {
	var p model.UpdatePayload
	if err := decodePayload(op.Payload, &p); err != nil {
		return "", err
	}

	var url, title, favicon, rank string
	err := tx.QueryRowContext(ctx, `SELECT url, title, favicon, rank FROM bookmarks WHERE id = ? AND deleted_at IS NULL`, op.ID).
		Scan(&url, &title, &favicon, &rank)
	if errors.Is(err, sql.ErrNoRows) {
		return model.StatusIgnored, nil
	}
	if err != nil {
		return "", err
	}

	if p.URL != nil {
		u, err := normalizeURL(*p.URL)
		if err != nil {
			return "", err
		}
		if u != url {
			var other int
			if err := tx.QueryRowContext(ctx, `SELECT COUNT(*) FROM bookmarks WHERE url = ? AND deleted_at IS NULL AND id <> ?`, u, op.ID).Scan(&other); err != nil {
				return "", err
			}
			if other > 0 {
				return model.StatusDuplicate, nil
			}
		}
		url = u
	}
	if p.Title != nil {
		title = truncate(strings.TrimSpace(*p.Title), maxTitleLen)
	}
	if p.Favicon != nil {
		favicon = truncate(*p.Favicon, maxURLLen)
	}
	if p.Rank != nil {
		if !validRank(*p.Rank) {
			return "", invalid("bad rank %q", *p.Rank)
		}
		rank = *p.Rank
	}
	var tags []string
	if p.Tags != nil {
		if tags, err = normalizeTags(*p.Tags); err != nil {
			return "", err
		}
	}

	version, err := bumpVersion(ctx, tx)
	if err != nil {
		return "", err
	}
	if _, err := tx.ExecContext(ctx, `UPDATE bookmarks SET url = ?, title = ?, favicon = ?, rank = ?, updated_at = ?, version = ? WHERE id = ?`,
		url, title, favicon, rank, s.nowMs(), version, op.ID); err != nil {
		return "", err
	}
	if p.Tags != nil {
		if err := setTags(ctx, tx, op.ID, tags); err != nil {
			return "", err
		}
	}
	return model.StatusApplied, nil
}

func (s *Store) applyDelete(ctx context.Context, tx *sql.Tx, op model.Op) (model.OpStatus, error) {
	var alive int
	if err := tx.QueryRowContext(ctx, `SELECT COUNT(*) FROM bookmarks WHERE id = ? AND deleted_at IS NULL`, op.ID).Scan(&alive); err != nil {
		return "", err
	}
	version, err := bumpVersion(ctx, tx)
	if err != nil {
		return "", err
	}
	now := s.nowMs()
	if alive == 0 {
		// Record a tombstone even for unknown ids so a create arriving later
		// (e.g. reordered retries) cannot resurrect the bookmark.
		_, err := tx.ExecContext(ctx, `
			INSERT INTO bookmarks (id, url, created_at, updated_at, deleted_at, version)
			VALUES (?, '', ?, ?, ?, ?) ON CONFLICT (id) DO NOTHING`,
			op.ID, now, now, now, version)
		if err != nil {
			return "", err
		}
		return model.StatusIgnored, nil
	}
	if _, err := tx.ExecContext(ctx, `UPDATE bookmarks SET deleted_at = ?, updated_at = ?, version = ? WHERE id = ?`,
		now, now, version, op.ID); err != nil {
		return "", err
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM bookmark_tags WHERE bookmark_id = ?`, op.ID); err != nil {
		return "", err
	}
	return model.StatusApplied, nil
}

func setTags(ctx context.Context, tx *sql.Tx, bookmarkID string, tags []string) error {
	if _, err := tx.ExecContext(ctx, `DELETE FROM bookmark_tags WHERE bookmark_id = ?`, bookmarkID); err != nil {
		return err
	}
	for _, name := range tags {
		if _, err := tx.ExecContext(ctx, `INSERT INTO tags (name) VALUES (?) ON CONFLICT (name) DO NOTHING`, name); err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx, `
			INSERT INTO bookmark_tags (bookmark_id, tag_id)
			SELECT ?, id FROM tags WHERE name = ? ON CONFLICT DO NOTHING`, bookmarkID, name); err != nil {
			return err
		}
	}
	return nil
}

func cleanupOrphanTags(ctx context.Context, tx *sql.Tx) error {
	_, err := tx.ExecContext(ctx, `DELETE FROM tags WHERE id NOT IN (SELECT DISTINCT tag_id FROM bookmark_tags)`)
	return err
}

// Changes returns every bookmark and stash changed after the given version, plus the
// complete tag metadata. since <= 0 means a full snapshot, which omits tombstones.
func (s *Store) Changes(ctx context.Context, since int64) (model.Changes, error) {
	tx, err := s.db.BeginTx(ctx, &sql.TxOptions{ReadOnly: true})
	if err != nil {
		return model.Changes{}, err
	}
	defer tx.Rollback()

	out := model.Changes{Full: since <= 0}
	if err := tx.QueryRowContext(ctx, `SELECT value FROM meta WHERE key = 'version'`).Scan(&out.Version); err != nil {
		return model.Changes{}, err
	}
	if out.Bookmarks, err = listBookmarks(ctx, tx, since); err != nil {
		return model.Changes{}, err
	}
	if out.Tags, err = listTagMeta(ctx, tx); err != nil {
		return model.Changes{}, err
	}
	if out.Stashes, err = listStashes(ctx, tx, since); err != nil {
		return model.Changes{}, err
	}
	return out, nil
}

// changedSince filters a table to rows newer than since; full snapshots skip tombstones.
func changedSince(since int64) string {
	if since <= 0 {
		return ` WHERE version > ? AND deleted_at IS NULL ORDER BY version`
	}
	return ` WHERE version > ? ORDER BY version`
}

func listBookmarks(ctx context.Context, tx *sql.Tx, since int64) ([]model.Bookmark, error) {
	q := `
		SELECT id, url, title, favicon, rank, created_at, updated_at, deleted_at, version,
			COALESCE((SELECT group_concat(t.name, char(31)) FROM bookmark_tags bt JOIN tags t ON t.id = bt.tag_id
				WHERE bt.bookmark_id = bookmarks.id), '')
		FROM bookmarks` + changedSince(since)
	rows, err := tx.QueryContext(ctx, q, since)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := []model.Bookmark{}
	for rows.Next() {
		var b model.Bookmark
		var deleted sql.NullInt64
		var tags string
		if err := rows.Scan(&b.ID, &b.URL, &b.Title, &b.Favicon, &b.Rank, &b.CreatedAt, &b.UpdatedAt, &deleted, &b.Version, &tags); err != nil {
			return nil, err
		}
		if deleted.Valid {
			b.DeletedAt = &deleted.Int64
		}
		b.Tags = []string{}
		if tags != "" {
			b.Tags = strings.Split(tags, tagSep)
			sort.Strings(b.Tags)
		}
		out = append(out, b)
	}
	return out, rows.Err()
}

func (s *Store) ListTags(ctx context.Context) ([]model.TagCount, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT t.name, COUNT(*) FROM tags t
		JOIN bookmark_tags bt ON bt.tag_id = t.id
		JOIN bookmarks b ON b.id = bt.bookmark_id AND b.deleted_at IS NULL
		GROUP BY t.id ORDER BY COUNT(*) DESC, t.name`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []model.TagCount{}
	for rows.Next() {
		var tc model.TagCount
		if err := rows.Scan(&tc.Name, &tc.Count); err != nil {
			return nil, err
		}
		out = append(out, tc)
	}
	return out, rows.Err()
}

// Import inserts bookmarks in one transaction, skipping URLs that already exist.
// Duplicate URLs inside the batch are merged (tags unioned, first usable favicon kept).
// Tag metadata is only added for tags that have none yet, so re-importing never undoes the user's ordering.
func (s *Store) Import(ctx context.Context, items []model.ImportItem, tags []model.TagMeta) (model.ImportResult, error) {
	type entry struct {
		item model.ImportItem
		tags []string
	}
	merged := map[string]*entry{}
	order := []string{}
	skipped := 0
	for _, it := range items {
		url, err := normalizeURL(it.URL)
		if err != nil {
			skipped++
			continue
		}
		tags := lenientTags(it.Tags)
		icon := cleanFavicon(it.Favicon)
		if e, ok := merged[url]; ok {
			skipped++
			e.tags = lenientTags(append(e.tags, tags...))
			if e.item.Favicon == "" {
				e.item.Favicon = icon
			}
			continue
		}
		it.URL = url
		it.Favicon = icon
		merged[url] = &entry{item: it, tags: tags}
		order = append(order, url)
	}

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return model.ImportResult{}, err
	}
	defer tx.Rollback()

	now := s.nowMs()
	imported := 0
	for _, url := range order {
		e := merged[url]
		var exists int
		if err := tx.QueryRowContext(ctx, `SELECT COUNT(*) FROM bookmarks WHERE url = ? AND deleted_at IS NULL`, url).Scan(&exists); err != nil {
			return model.ImportResult{}, err
		}
		if exists > 0 {
			skipped++
			continue
		}
		version, err := bumpVersion(ctx, tx)
		if err != nil {
			return model.ImportResult{}, err
		}
		id := uuid.NewString()
		createdAt := e.item.CreatedAt
		if createdAt <= 0 || createdAt > now {
			createdAt = now
		}
		title := truncate(strings.TrimSpace(e.item.Title), maxTitleLen)
		rank := e.item.Rank
		if !validRank(rank) {
			rank = ""
		}
		if _, err := tx.ExecContext(ctx, `
			INSERT INTO bookmarks (id, url, title, favicon, rank, created_at, updated_at, version) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
			id, url, title, e.item.Favicon, rank, createdAt, now, version); err != nil {
			return model.ImportResult{}, err
		}
		if err := setTags(ctx, tx, id, e.tags); err != nil {
			return model.ImportResult{}, err
		}
		imported++
	}

	if err := s.importTagMeta(ctx, tx, tags); err != nil {
		return model.ImportResult{}, err
	}

	var version int64
	if err := tx.QueryRowContext(ctx, `SELECT value FROM meta WHERE key = 'version'`).Scan(&version); err != nil {
		return model.ImportResult{}, err
	}
	if err := tx.Commit(); err != nil {
		return model.ImportResult{}, err
	}
	return model.ImportResult{Imported: imported, Skipped: skipped, Version: version}, nil
}

func normalizeURL(raw string) (string, error) {
	u := strings.TrimSpace(raw)
	if u == "" {
		return "", invalid("url is required")
	}
	if len(u) > maxURLLen {
		return "", invalid("url too long")
	}
	return u, nil
}

// normalizeTag strips control characters and surrounding space. Lenient mode
// truncates over-long names instead of failing.
func normalizeTag(raw string, lenient bool) (string, error) {
	t := strings.TrimSpace(strings.Map(func(r rune) rune {
		if r < 0x20 || r == 0x7f {
			return -1
		}
		return r
	}, raw))
	if len([]rune(t)) > maxTagLen {
		if !lenient {
			return "", invalid("tag %q too long (max %d chars)", t, maxTagLen)
		}
		t = strings.TrimSpace(truncate(t, maxTagLen))
	}
	return t, nil
}

func normalizeTags(in []string) ([]string, error) {
	seen := map[string]bool{}
	out := []string{}
	for _, raw := range in {
		t, err := normalizeTag(raw, false)
		if err != nil {
			return nil, err
		}
		if t == "" {
			continue
		}
		key := strings.ToLower(t)
		if seen[key] {
			continue
		}
		seen[key] = true
		out = append(out, t)
	}
	if len(out) > maxTags {
		return nil, invalid("too many tags (max %d)", maxTags)
	}
	return out, nil
}

// lenientTags is used for imports, where bad folder names shouldn't reject the bookmark.
func lenientTags(in []string) []string {
	out := []string{}
	seen := map[string]bool{}
	for _, raw := range in {
		t, _ := normalizeTag(raw, true)
		if t == "" || seen[strings.ToLower(t)] {
			continue
		}
		seen[strings.ToLower(t)] = true
		out = append(out, t)
		if len(out) == maxTags {
			break
		}
	}
	return out
}

var faviconRE = regexp.MustCompile(`(?i)^data:image/(png|jpe?g|gif|webp|x-icon|vnd\.microsoft\.icon);base64,[a-z0-9+/]+={0,2}$`)

func cleanFavicon(raw string) string {
	s := strings.Map(func(r rune) rune {
		if r == ' ' || r == '\n' || r == '\r' || r == '\t' {
			return -1
		}
		return r
	}, raw)
	if len(s) > maxFaviconLen || !faviconRE.MatchString(s) {
		return ""
	}
	return s
}

func truncate(s string, n int) string {
	r := []rune(s)
	if len(r) <= n {
		return s
	}
	return string(r[:n])
}
