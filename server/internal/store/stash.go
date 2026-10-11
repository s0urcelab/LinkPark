package store

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"strings"

	"github.com/linkpark/server/internal/model"
)

const (
	maxStashItems   = 1000
	maxStashNameLen = 200
)

func normalizeStashItems(in []model.StashItem) ([]model.StashItem, error) {
	if len(in) > maxStashItems {
		return nil, invalid("too many stash items (max %d)", maxStashItems)
	}
	out := make([]model.StashItem, 0, len(in))
	for _, it := range in {
		url, err := normalizeURL(it.URL)
		if err != nil {
			return nil, err
		}
		out = append(out, model.StashItem{URL: url, Title: truncate(strings.TrimSpace(it.Title), maxTitleLen)})
	}
	return out, nil
}

func (s *Store) applyStashOp(ctx context.Context, tx *sql.Tx, op model.Op) (model.OpStatus, error) {
	switch op.Type {
	case model.OpCreate:
		return s.stashCreate(ctx, tx, op)
	case model.OpUpdate:
		return s.stashUpdate(ctx, tx, op)
	case model.OpDelete:
		return s.softDelete(ctx, tx, "stashes", op.ID,
			`INSERT INTO stashes (id, created_at, updated_at, deleted_at, version) VALUES (?, ?, ?, ?, ?) ON CONFLICT (id) DO NOTHING`)
	}
	return "", invalid("unknown op type %q", op.Type)
}

// softDelete tombstones a row. Unknown ids still get a tombstone (via tombstoneSQL, which
// takes id, created_at, updated_at, deleted_at, version) so a late create can't resurrect it.
func (s *Store) softDelete(ctx context.Context, tx *sql.Tx, table, id, tombstoneSQL string) (model.OpStatus, error) {
	var alive int
	if err := tx.QueryRowContext(ctx, `SELECT COUNT(*) FROM `+table+` WHERE id = ? AND deleted_at IS NULL`, id).Scan(&alive); err != nil {
		return "", err
	}
	version, err := bumpVersion(ctx, tx)
	if err != nil {
		return "", err
	}
	now := s.nowMs()
	if alive == 0 {
		if _, err := tx.ExecContext(ctx, tombstoneSQL, id, now, now, now, version); err != nil {
			return "", err
		}
		return model.StatusIgnored, nil
	}
	if _, err := tx.ExecContext(ctx, `UPDATE `+table+` SET deleted_at = ?, updated_at = ?, version = ? WHERE id = ?`,
		now, now, version, id); err != nil {
		return "", err
	}
	return model.StatusApplied, nil
}

func (s *Store) stashCreate(ctx context.Context, tx *sql.Tx, op model.Op) (model.OpStatus, error) {
	var p model.StashCreatePayload
	if err := decodePayload(op.Payload, &p); err != nil {
		return "", err
	}
	items, err := normalizeStashItems(p.Items)
	if err != nil {
		return "", err
	}
	if len(items) == 0 {
		return "", invalid("stash has no items")
	}
	var exists int
	if err := tx.QueryRowContext(ctx, `SELECT COUNT(*) FROM stashes WHERE id = ?`, op.ID).Scan(&exists); err != nil {
		return "", err
	}
	if exists > 0 {
		return model.StatusIgnored, nil
	}
	body, _ := json.Marshal(items)
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
		INSERT INTO stashes (id, name, items, created_at, updated_at, version) VALUES (?, ?, ?, ?, ?, ?)`,
		op.ID, truncate(strings.TrimSpace(p.Name), maxStashNameLen), string(body), createdAt, now, version)
	if err != nil {
		return "", err
	}
	return model.StatusApplied, nil
}

func (s *Store) stashUpdate(ctx context.Context, tx *sql.Tx, op model.Op) (model.OpStatus, error) {
	var p model.StashUpdatePayload
	if err := decodePayload(op.Payload, &p); err != nil {
		return "", err
	}
	var name, items string
	err := tx.QueryRowContext(ctx, `SELECT name, items FROM stashes WHERE id = ? AND deleted_at IS NULL`, op.ID).Scan(&name, &items)
	if errors.Is(err, sql.ErrNoRows) {
		return model.StatusIgnored, nil
	}
	if err != nil {
		return "", err
	}
	if p.Name != nil {
		name = truncate(strings.TrimSpace(*p.Name), maxStashNameLen)
	}
	if p.Items != nil {
		norm, err := normalizeStashItems(*p.Items)
		if err != nil {
			return "", err
		}
		body, _ := json.Marshal(norm)
		items = string(body)
	}
	version, err := bumpVersion(ctx, tx)
	if err != nil {
		return "", err
	}
	_, err = tx.ExecContext(ctx, `UPDATE stashes SET name = ?, items = ?, updated_at = ?, version = ? WHERE id = ?`,
		name, items, s.nowMs(), version, op.ID)
	if err != nil {
		return "", err
	}
	return model.StatusApplied, nil
}

func listStashes(ctx context.Context, tx *sql.Tx, since int64) ([]model.Stash, error) {
	rows, err := tx.QueryContext(ctx, `
		SELECT id, name, items, created_at, updated_at, deleted_at, version
		FROM stashes`+changedSince(since), since)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []model.Stash{}
	for rows.Next() {
		var st model.Stash
		var items string
		var deleted sql.NullInt64
		if err := rows.Scan(&st.ID, &st.Name, &items, &st.CreatedAt, &st.UpdatedAt, &deleted, &st.Version); err != nil {
			return nil, err
		}
		if deleted.Valid {
			st.DeletedAt = &deleted.Int64
		}
		st.Items = []model.StashItem{}
		if err := json.Unmarshal([]byte(items), &st.Items); err != nil {
			return nil, err
		}
		out = append(out, st)
	}
	return out, rows.Err()
}
