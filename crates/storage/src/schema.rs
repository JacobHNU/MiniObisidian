use serde::{Deserialize, Serialize};

pub const CREATE_TABLES: &str = r#"
CREATE TABLE IF NOT EXISTS notes_meta (
    id           TEXT PRIMARY KEY,
    path         TEXT NOT NULL UNIQUE,
    title        TEXT NOT NULL DEFAULT '',
    tags         TEXT NOT NULL DEFAULT '[]',
    content_hash TEXT NOT NULL DEFAULT '',
    created_at   TEXT NOT NULL,
    updated_at   TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS links (
    source_id TEXT NOT NULL,
    target_id TEXT NOT NULL,
    context   TEXT,
    PRIMARY KEY (source_id, target_id),
    FOREIGN KEY (source_id) REFERENCES notes_meta(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS sync_state (
    file_path          TEXT PRIMARY KEY,
    local_hash         TEXT NOT NULL,
    remote_hash        TEXT,
    sync_status        TEXT NOT NULL DEFAULT 'synced',
    last_synced        INTEGER NOT NULL DEFAULT 0,
    last_synced_mtime  INTEGER NOT NULL DEFAULT 0,
    remote_fid         TEXT,
    version            INTEGER DEFAULT 1
);

CREATE TABLE IF NOT EXISTS config (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_notes_updated ON notes_meta(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_links_source ON links(source_id);
CREATE INDEX IF NOT EXISTS idx_links_target ON links(target_id);
CREATE INDEX IF NOT EXISTS idx_sync_status ON sync_state(sync_status);

CREATE TABLE IF NOT EXISTS tags (
    name        TEXT PRIMARY KEY,
    color       TEXT NOT NULL DEFAULT '#cba6f7',
    icon        TEXT,
    description TEXT NOT NULL DEFAULT '',
    created_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS folder_meta (
    path        TEXT PRIMARY KEY,
    icon        TEXT,
    color       TEXT
);
"#;

/// Migration: rebuild links table without FK on target_id
/// (wiki-links can point to notes that don't exist yet)
pub const MIGRATE_LINKS_NO_TARGET_FK: &str = r#"
CREATE TABLE IF NOT EXISTS links_new (
    source_id TEXT NOT NULL,
    target_id TEXT NOT NULL,
    context   TEXT,
    PRIMARY KEY (source_id, target_id),
    FOREIGN KEY (source_id) REFERENCES notes_meta(id) ON DELETE CASCADE
);
INSERT OR IGNORE INTO links_new (source_id, target_id, context)
    SELECT source_id, target_id, context FROM links;
DROP TABLE IF EXISTS links;
ALTER TABLE links_new RENAME TO links;
CREATE INDEX IF NOT EXISTS idx_links_source ON links(source_id);
CREATE INDEX IF NOT EXISTS idx_links_target ON links(target_id);
"#;

/// Migration: add mtime baseline column to sync_state
/// (safe for both fresh and existing databases)
pub const MIGRATE_ADD_SYNC_STATE_MTIME: &str = r#"
ALTER TABLE sync_state ADD COLUMN last_synced_mtime INTEGER NOT NULL DEFAULT 0;
"#;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NoteMeta {
    pub id: String,
    pub path: String,
    pub title: String,
    pub tags: Vec<String>,
    pub content_hash: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Link {
    pub source_id: String,
    pub target_id: String,
    pub context: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SyncState {
    pub file_path: String,
    pub local_hash: String,
    pub remote_hash: Option<String>,
    pub sync_status: String,
    pub last_synced: i64,
    /// Baseline cloud server_mtime from the last successful sync.
    /// Used for mtime-based change detection (avoids clock skew between devices).
    pub last_synced_mtime: i64,
    pub remote_fid: Option<String>,
    pub version: i32,
}

/// Tag metadata stored in SQLite
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Tag {
    pub name: String,
    pub color: String,
    pub icon: Option<String>,
    pub description: String,
    pub created_at: String,
}

/// Folder metadata (icon/color overrides)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FolderMeta {
    pub path: String,
    pub icon: Option<String>,
    pub color: Option<String>,
}
