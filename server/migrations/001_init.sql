CREATE TABLE meta (
    key   TEXT PRIMARY KEY,
    value INTEGER NOT NULL
);

INSERT INTO meta (key, value) VALUES ('version', 0);

CREATE TABLE bookmarks (
    id         TEXT PRIMARY KEY,
    url        TEXT NOT NULL,
    title      TEXT NOT NULL DEFAULT '',
    favicon    TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    deleted_at INTEGER,
    version    INTEGER NOT NULL
);

CREATE UNIQUE INDEX idx_bookmarks_url_alive ON bookmarks (url) WHERE deleted_at IS NULL;
CREATE INDEX idx_bookmarks_version ON bookmarks (version);

CREATE TABLE tags (
    id   INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE COLLATE NOCASE
);

CREATE TABLE bookmark_tags (
    bookmark_id TEXT    NOT NULL REFERENCES bookmarks (id) ON DELETE CASCADE,
    tag_id      INTEGER NOT NULL REFERENCES tags (id) ON DELETE CASCADE,
    PRIMARY KEY (bookmark_id, tag_id)
);

CREATE INDEX idx_bookmark_tags_tag ON bookmark_tags (tag_id);

CREATE TABLE applied_ops (
    op_id      TEXT PRIMARY KEY,
    applied_at INTEGER NOT NULL
);

CREATE INDEX idx_applied_ops_at ON applied_ops (applied_at);
