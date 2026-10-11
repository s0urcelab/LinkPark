package store

import (
	"context"
	"database/sql"
	"errors"
	"regexp"
	"strings"

	"github.com/linkpark/server/internal/model"
)

// Ranks are fractional-index keys over [0-9A-Za-z], compared bytewise. Empty means
// "unranked", which clients sort after every ranked item.
var rankRe = regexp.MustCompile(`^[0-9A-Za-z]{0,128}$`)

func validRank(r string) bool { return rankRe.MatchString(r) }

// tagKey resolves a tag op id: empty addresses the virtual "untagged" tag.
func tagKey(id string) (string, error) {
	if id == model.UntaggedKey {
		return id, nil
	}
	name, err := normalizeTag(id, true)
	if err != nil {
		return "", err
	}
	if name == "" {
		return "", invalid("bad tag name %q", id)
	}
	return name, nil
}

func (s *Store) applyTagOp(ctx context.Context, tx *sql.Tx, op model.Op) (model.OpStatus, error) {
	key, err := tagKey(op.ID)
	if err != nil {
		return "", err
	}
	switch op.Type {
	case model.OpUpdate:
		var p model.TagUpdatePayload
		if err := decodePayload(op.Payload, &p); err != nil {
			return "", err
		}
		return s.tagUpdate(ctx, tx, key, p)
	case model.OpDelete:
		if key == model.UntaggedKey {
			return "", invalid("the untagged tag cannot be deleted")
		}
		return s.tagDelete(ctx, tx, key)
	}
	return "", invalid("unknown op type %q", op.Type)
}

func (s *Store) tagUpdate(ctx context.Context, tx *sql.Tx, key string, p model.TagUpdatePayload) (model.OpStatus, error) {
	status := model.StatusIgnored
	if p.Name != nil {
		if key == model.UntaggedKey {
			return "", invalid("the untagged tag cannot be renamed")
		}
		to, err := normalizeTag(*p.Name, false)
		if err != nil {
			return "", err
		}
		if to == "" {
			return "", invalid("tag name is required")
		}
		if to != key {
			if status, err = s.tagRename(ctx, tx, key, to); err != nil {
				return "", err
			}
			key = to
		}
	}
	if p.Rank == nil && p.Pinned == nil {
		return status, nil
	}

	var canonical string
	err := tx.QueryRowContext(ctx, `SELECT name FROM tags WHERE name = ?`, key).Scan(&canonical)
	switch {
	case err == nil:
		key = canonical
	case !errors.Is(err, sql.ErrNoRows):
		return "", err
	}
	rank, pinned := "", key == model.UntaggedKey
	err = tx.QueryRowContext(ctx, `SELECT rank, pinned FROM tag_meta WHERE name = ?`, key).Scan(&rank, &pinned)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return "", err
	}
	if p.Rank != nil {
		if !validRank(*p.Rank) {
			return "", invalid("bad rank %q", *p.Rank)
		}
		rank = *p.Rank
	}
	if p.Pinned != nil {
		pinned = *p.Pinned
	}
	if _, err := bumpVersion(ctx, tx); err != nil {
		return "", err
	}
	_, err = tx.ExecContext(ctx, `
		INSERT INTO tag_meta (name, rank, pinned, updated_at) VALUES (?, ?, ?, ?)
		ON CONFLICT (name) DO UPDATE SET name = excluded.name, rank = excluded.rank, pinned = excluded.pinned,
			updated_at = excluded.updated_at`,
		key, rank, pinned, s.nowMs())
	if err != nil {
		return "", err
	}
	return model.StatusApplied, nil
}

// tagRename moves every bookmark from one tag to another. If the target tag already
// exists the two merge and the target keeps its own order and pin state.
func (s *Store) tagRename(ctx context.Context, tx *sql.Tx, from, to string) (model.OpStatus, error) {
	fromID, ok, err := tagID(ctx, tx, from)
	if err != nil || !ok {
		return model.StatusIgnored, err
	}
	affected, err := taggedBookmarks(ctx, tx, fromID)
	if err != nil {
		return "", err
	}

	targetExisted := false
	if strings.EqualFold(from, to) {
		if _, err := tx.ExecContext(ctx, `UPDATE tags SET name = ? WHERE id = ?`, to, fromID); err != nil {
			return "", err
		}
	} else {
		var toID int64
		if toID, targetExisted, err = tagID(ctx, tx, to); err != nil {
			return "", err
		}
		if !targetExisted {
			if err := tx.QueryRowContext(ctx, `INSERT INTO tags (name) VALUES (?) RETURNING id`, to).Scan(&toID); err != nil {
				return "", err
			}
		}
		if _, err := tx.ExecContext(ctx, `
			INSERT INTO bookmark_tags (bookmark_id, tag_id)
			SELECT bookmark_id, ? FROM bookmark_tags WHERE tag_id = ? ON CONFLICT DO NOTHING`, toID, fromID); err != nil {
			return "", err
		}
		if err := dropTag(ctx, tx, fromID); err != nil {
			return "", err
		}
	}

	var targetMeta int
	if err := tx.QueryRowContext(ctx, `SELECT COUNT(*) FROM tag_meta WHERE name = ?`, to).Scan(&targetMeta); err != nil {
		return "", err
	}
	if targetExisted && targetMeta > 0 {
		_, err = tx.ExecContext(ctx, `DELETE FROM tag_meta WHERE name = ?`, from)
	} else {
		if !strings.EqualFold(from, to) {
			// Stale metadata left by an earlier tag of this name.
			if _, err := tx.ExecContext(ctx, `DELETE FROM tag_meta WHERE name = ?`, to); err != nil {
				return "", err
			}
		}
		_, err = tx.ExecContext(ctx, `UPDATE tag_meta SET name = ? WHERE name = ?`, to, from)
	}
	if err != nil {
		return "", err
	}
	return model.StatusApplied, s.touchBookmarks(ctx, tx, affected)
}

// tagDelete removes a tag from every bookmark; the bookmarks themselves stay.
func (s *Store) tagDelete(ctx context.Context, tx *sql.Tx, name string) (model.OpStatus, error) {
	if _, err := tx.ExecContext(ctx, `DELETE FROM tag_meta WHERE name = ?`, name); err != nil {
		return "", err
	}
	id, ok, err := tagID(ctx, tx, name)
	if err != nil || !ok {
		return model.StatusIgnored, err
	}
	affected, err := taggedBookmarks(ctx, tx, id)
	if err != nil {
		return "", err
	}
	if err := dropTag(ctx, tx, id); err != nil {
		return "", err
	}
	return model.StatusApplied, s.touchBookmarks(ctx, tx, affected)
}

func tagID(ctx context.Context, tx *sql.Tx, name string) (int64, bool, error) {
	var id int64
	err := tx.QueryRowContext(ctx, `SELECT id FROM tags WHERE name = ?`, name).Scan(&id)
	if errors.Is(err, sql.ErrNoRows) {
		return 0, false, nil
	}
	return id, err == nil, err
}

func taggedBookmarks(ctx context.Context, tx *sql.Tx, tagID int64) ([]string, error) {
	rows, err := tx.QueryContext(ctx, `SELECT bookmark_id FROM bookmark_tags WHERE tag_id = ?`, tagID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	ids := []string{}
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		ids = append(ids, id)
	}
	return ids, rows.Err()
}

func dropTag(ctx context.Context, tx *sql.Tx, id int64) error {
	if _, err := tx.ExecContext(ctx, `DELETE FROM bookmark_tags WHERE tag_id = ?`, id); err != nil {
		return err
	}
	_, err := tx.ExecContext(ctx, `DELETE FROM tags WHERE id = ?`, id)
	return err
}

// touchBookmarks gives bookmarks whose tags changed a new version so clients pull them.
func (s *Store) touchBookmarks(ctx context.Context, tx *sql.Tx, ids []string) error {
	version, err := bumpVersion(ctx, tx)
	if err != nil {
		return err
	}
	now := s.nowMs()
	for _, id := range ids {
		if _, err := tx.ExecContext(ctx, `UPDATE bookmarks SET version = ?, updated_at = ? WHERE id = ?`, version, now, id); err != nil {
			return err
		}
	}
	return nil
}

// importTagMeta records order and pin state for tags that have none yet.
func (s *Store) importTagMeta(ctx context.Context, tx *sql.Tx, metas []model.TagMeta) error {
	added := false
	now := s.nowMs()
	for _, m := range metas {
		key, err := tagKey(m.Name)
		if err != nil {
			continue
		}
		rank := m.Rank
		if !validRank(rank) {
			rank = ""
		}
		res, err := tx.ExecContext(ctx, `
			INSERT INTO tag_meta (name, rank, pinned, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT (name) DO NOTHING`,
			key, rank, m.Pinned, now)
		if err != nil {
			return err
		}
		if n, _ := res.RowsAffected(); n > 0 {
			added = true
		}
	}
	if added {
		_, err := bumpVersion(ctx, tx)
		return err
	}
	return nil
}

// listTagMeta returns metadata for the untagged tag and every tag still in use;
// metadata of vanished tags is kept so a re-created tag returns to its old place.
func listTagMeta(ctx context.Context, tx *sql.Tx) ([]model.TagMeta, error) {
	rows, err := tx.QueryContext(ctx, `
		SELECT m.name, m.rank, m.pinned FROM tag_meta m
		WHERE m.name = '' OR EXISTS (SELECT 1 FROM tags t WHERE t.name = m.name)
		ORDER BY m.rank, m.name`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []model.TagMeta{}
	for rows.Next() {
		var m model.TagMeta
		if err := rows.Scan(&m.Name, &m.Rank, &m.Pinned); err != nil {
			return nil, err
		}
		out = append(out, m)
	}
	return out, rows.Err()
}
