pub mod schema;

use anyhow::{anyhow, Result};
use rusqlite::Connection;
use std::path::Path;
use std::sync::Mutex;

pub struct Database {
    conn: Mutex<Connection>,
}

impl Database {
    pub fn open(path: &Path) -> Result<Self> {
        let conn = Connection::open(path)?;
        conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;")?;
        let db = Self {
            conn: Mutex::new(conn),
        };
        db.run_migrations()?;
        Ok(db)
    }

    pub fn open_in_memory() -> Result<Self> {
        let conn = Connection::open_in_memory()?;
        conn.execute_batch("PRAGMA foreign_keys=ON;")?;
        let db = Self {
            conn: Mutex::new(conn),
        };
        db.run_migrations()?;
        Ok(db)
    }

    /// Safely acquire the database connection lock
    fn lock_conn(&self) -> Result<std::sync::MutexGuard<'_, Connection>> {
        self.conn.lock().map_err(|_| anyhow!("Database lock poisoned"))
    }

    fn run_migrations(&self) -> Result<()> {
        let conn = self.lock_conn()?;
        conn.execute_batch(schema::CREATE_TABLES)?;
        // Migration: remove FK constraint on links.target_id
        conn.execute_batch(schema::MIGRATE_LINKS_NO_TARGET_FK)?;
        // Migration: add mtime baseline column to sync_state (idempotent-safe:
        // CREATE TABLE IF NOT EXISTS above defines it for fresh DBs; ALTER only
        // succeeds on pre-existing DBs missing the column).
        let has_col: bool = conn
            .prepare("SELECT COUNT(*) FROM pragma_table_info('sync_state') WHERE name='last_synced_mtime'")?
            .query_row([], |r| r.get::<_, i64>(0))
            .map(|c| c > 0)
            .unwrap_or(false);
        if !has_col {
            conn.execute_batch(schema::MIGRATE_ADD_SYNC_STATE_MTIME)?;
        }
        Ok(())
    }

    // -- Note metadata operations --

    pub fn upsert_note(&self, note: &schema::NoteMeta) -> Result<()> {
        let conn = self.lock_conn()?;
        conn.execute(
            "INSERT INTO notes_meta (id, path, title, tags, content_hash, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
             ON CONFLICT(path) DO UPDATE SET
               id = excluded.id,
               title = excluded.title,
               tags = excluded.tags,
               content_hash = excluded.content_hash,
               updated_at = excluded.updated_at",
            rusqlite::params![
                note.id,
                note.path,
                note.title,
                serde_json::to_string(&note.tags)?,
                note.content_hash,
                note.created_at,
                note.updated_at,
            ],
        )?;
        Ok(())
    }

    pub fn get_note(&self, id: &str) -> Result<Option<schema::NoteMeta>> {
        let conn = self.lock_conn()?;
        let mut stmt = conn.prepare(
            "SELECT id, path, title, tags, content_hash, created_at, updated_at
             FROM notes_meta WHERE id = ?1",
        )?;
        let result = stmt
            .query_row(rusqlite::params![id], |row| {
                let tags_str: String = row.get(3)?;
                let tags: Vec<String> =
                    serde_json::from_str(&tags_str).unwrap_or_default();
                Ok(schema::NoteMeta {
                    id: row.get(0)?,
                    path: row.get(1)?,
                    title: row.get(2)?,
                    tags,
                    content_hash: row.get(4)?,
                    created_at: row.get(5)?,
                    updated_at: row.get(6)?,
                })
            })
            .optional()?;
        Ok(result)
    }

    pub fn list_notes(&self) -> Result<Vec<schema::NoteMeta>> {
        let conn = self.lock_conn()?;
        let mut stmt = conn.prepare(
            "SELECT id, path, title, tags, content_hash, created_at, updated_at
             FROM notes_meta ORDER BY updated_at DESC",
        )?;
        let notes = stmt
            .query_map([], |row| {
                let tags_str: String = row.get(3)?;
                let tags: Vec<String> =
                    serde_json::from_str(&tags_str).unwrap_or_default();
                Ok(schema::NoteMeta {
                    id: row.get(0)?,
                    path: row.get(1)?,
                    title: row.get(2)?,
                    tags,
                    content_hash: row.get(4)?,
                    created_at: row.get(5)?,
                    updated_at: row.get(6)?,
                })
            })?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        Ok(notes)
    }

    pub fn delete_note(&self, id: &str) -> Result<()> {
        let conn = self.lock_conn()?;
        conn.execute("DELETE FROM notes_meta WHERE id = ?1", rusqlite::params![id])?;
        conn.execute("DELETE FROM links WHERE source_id = ?1 OR target_id = ?1", rusqlite::params![id])?;
        Ok(())
    }

    /// Atomically update a note's path (used for move operations)
    /// This ensures the id remains the same and avoids UNIQUE constraint conflicts
    pub fn update_note_path(&self, id: &str, new_path: &str, new_content_hash: &str) -> Result<()> {
        let conn = self.lock_conn()?;
        let now = chrono::Utc::now().to_rfc3339();
        let rows_affected = conn.execute(
            "UPDATE notes_meta SET path = ?1, content_hash = ?2, updated_at = ?3 WHERE id = ?4",
            rusqlite::params![new_path, new_content_hash, now, id],
        )?;
        if rows_affected == 0 {
            anyhow::bail!("Note not found in database: {}", id);
        }
        Ok(())
    }

    /// Clear all notes and links (used before full vault re-scan)
    pub fn clear_all_notes(&self) -> Result<()> {
        let conn = self.lock_conn()?;
        conn.execute("DELETE FROM links", [])?;
        conn.execute("DELETE FROM notes_meta", [])?;
        Ok(())
    }

    pub fn get_note_by_path(&self, path: &str) -> Result<Option<schema::NoteMeta>> {
        let conn = self.lock_conn()?;
        let mut stmt = conn.prepare(
            "SELECT id, path, title, tags, content_hash, created_at, updated_at
             FROM notes_meta WHERE path = ?1",
        )?;
        let result = stmt
            .query_row(rusqlite::params![path], |row| {
                let tags_str: String = row.get(3)?;
                let tags: Vec<String> =
                    serde_json::from_str(&tags_str).unwrap_or_default();
                Ok(schema::NoteMeta {
                    id: row.get(0)?,
                    path: row.get(1)?,
                    title: row.get(2)?,
                    tags,
                    content_hash: row.get(4)?,
                    created_at: row.get(5)?,
                    updated_at: row.get(6)?,
                })
            })
            .optional()?;
        Ok(result)
    }

    /// Find a note by content hash (for rename detection)
    pub fn get_note_by_content_hash(&self, content_hash: &str) -> Result<Option<schema::NoteMeta>> {
        let conn = self.lock_conn()?;
        let mut stmt = conn.prepare(
            "SELECT id, path, title, tags, content_hash, created_at, updated_at
             FROM notes_meta WHERE content_hash = ?1",
        )?;
        let result = stmt
            .query_row(rusqlite::params![content_hash], |row| {
                let tags_str: String = row.get(3)?;
                let tags: Vec<String> =
                    serde_json::from_str(&tags_str).unwrap_or_default();
                Ok(schema::NoteMeta {
                    id: row.get(0)?,
                    path: row.get(1)?,
                    title: row.get(2)?,
                    tags,
                    content_hash: row.get(4)?,
                    created_at: row.get(5)?,
                    updated_at: row.get(6)?,
                })
            })
            .optional()?;
        Ok(result)
    }

    // -- Link operations --

    pub fn upsert_link(&self, source_id: &str, target_id: &str, context: Option<&str>) -> Result<()> {
        let conn = self.lock_conn()?;
        conn.execute(
            "INSERT OR IGNORE INTO links (source_id, target_id, context) VALUES (?1, ?2, ?3)",
            rusqlite::params![source_id, target_id, context],
        )?;
        Ok(())
    }

    pub fn clear_links_from(&self, source_id: &str) -> Result<()> {
        let conn = self.lock_conn()?;
        conn.execute(
            "DELETE FROM links WHERE source_id = ?1",
            rusqlite::params![source_id],
        )?;
        Ok(())
    }

    pub fn get_all_links(&self) -> Result<Vec<schema::Link>> {
        let conn = self.lock_conn()?;
        let mut stmt = conn.prepare(
            "SELECT source_id, target_id, context FROM links",
        )?;
        let links = stmt
            .query_map([], |row| {
                Ok(schema::Link {
                    source_id: row.get(0)?,
                    target_id: row.get(1)?,
                    context: row.get(2)?,
                })
            })?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        Ok(links)
    }

    pub fn get_backlinks(&self, note_id: &str) -> Result<Vec<String>> {
        let conn = self.lock_conn()?;
        let mut stmt = conn.prepare(
            "SELECT source_id FROM links WHERE target_id = ?1",
        )?;
        let ids = stmt
            .query_map(rusqlite::params![note_id], |row| row.get(0))?
            .collect::<std::result::Result<Vec<String>, _>>()?;
        Ok(ids)
    }

    pub fn get_backlinks_with_context(&self, note_id: &str) -> Result<Vec<(String, Option<String>)>> {
        let conn = self.lock_conn()?;
        let mut stmt = conn.prepare(
            "SELECT source_id, context FROM links WHERE target_id = ?1",
        )?;
        let results = stmt
            .query_map(rusqlite::params![note_id], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, Option<String>>(1)?))
            })?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        Ok(results)
    }

    // -- Config operations --

    pub fn get_config(&self, key: &str) -> Result<Option<String>> {
        let conn = self.lock_conn()?;
        let result = conn
            .prepare("SELECT value FROM config WHERE key = ?1")?
            .query_row(rusqlite::params![key], |row| row.get(0))
            .optional()?;
        Ok(result)
    }

    pub fn set_config(&self, key: &str, value: &str) -> Result<()> {
        let conn = self.lock_conn()?;
        conn.execute(
            "INSERT INTO config (key, value) VALUES (?1, ?2)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            rusqlite::params![key, value],
        )?;
        Ok(())
    }

    // -- Tag operations --

    pub fn create_tag(&self, tag: &schema::Tag) -> Result<()> {
        let conn = self.lock_conn()?;
        conn.execute(
            "INSERT INTO tags (name, color, icon, description, created_at) VALUES (?1, ?2, ?3, ?4, ?5)",
            rusqlite::params![tag.name, tag.color, tag.icon, tag.description, tag.created_at],
        )?;
        Ok(())
    }

    pub fn update_tag(&self, name: &str, color: Option<&str>, icon: Option<&str>, description: Option<&str>) -> Result<()> {
        let conn = self.lock_conn()?;
        // Build dynamic UPDATE
        let mut sets = Vec::new();
        let mut params: Vec<Box<dyn rusqlite::types::ToSql>> = Vec::new();
        if let Some(c) = color {
            sets.push(format!("color = ?{}", params.len() + 1));
            params.push(Box::new(c.to_string()));
        }
        if let Some(i) = icon {
            sets.push(format!("icon = ?{}", params.len() + 1));
            params.push(Box::new(i.to_string()));
        }
        if let Some(d) = description {
            sets.push(format!("description = ?{}", params.len() + 1));
            params.push(Box::new(d.to_string()));
        }
        if sets.is_empty() {
            return Ok(());
        }
        params.push(Box::new(name.to_string()));
        let sql = format!("UPDATE tags SET {} WHERE name = ?{}", sets.join(", "), params.len());
        let param_refs: Vec<&dyn rusqlite::types::ToSql> = params.iter().map(|p| p.as_ref()).collect();
        conn.execute(&sql, param_refs.as_slice())?;
        Ok(())
    }

    pub fn delete_tag(&self, name: &str) -> Result<()> {
        let conn = self.lock_conn()?;
        conn.execute("DELETE FROM tags WHERE name = ?1", rusqlite::params![name])?;
        Ok(())
    }

    pub fn list_tags(&self) -> Result<Vec<schema::Tag>> {
        let conn = self.lock_conn()?;
        let mut stmt = conn.prepare(
            "SELECT name, color, icon, description, created_at FROM tags ORDER BY name",
        )?;
        let tags = stmt
            .query_map([], |row| {
                Ok(schema::Tag {
                    name: row.get(0)?,
                    color: row.get(1)?,
                    icon: row.get(2)?,
                    description: row.get(3)?,
                    created_at: row.get(4)?,
                })
            })?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        Ok(tags)
    }

    pub fn get_tag(&self, name: &str) -> Result<Option<schema::Tag>> {
        let conn = self.lock_conn()?;
        let result = conn
            .prepare("SELECT name, color, icon, description, created_at FROM tags WHERE name = ?1")?
            .query_row(rusqlite::params![name], |row| {
                Ok(schema::Tag {
                    name: row.get(0)?,
                    color: row.get(1)?,
                    icon: row.get(2)?,
                    description: row.get(3)?,
                    created_at: row.get(4)?,
                })
            })
            .optional()?;
        Ok(result)
    }

    pub fn get_notes_by_tag(&self, tag_name: &str) -> Result<Vec<schema::NoteMeta>> {
        let conn = self.lock_conn()?;
        let pattern = format!("%\"{}%", tag_name);
        let mut stmt = conn.prepare(
            "SELECT id, path, title, tags, content_hash, created_at, updated_at
             FROM notes_meta WHERE tags LIKE ?1 ORDER BY updated_at DESC",
        )?;
        let notes = stmt
            .query_map(rusqlite::params![pattern], |row| {
                let tags_str: String = row.get(3)?;
                let tags: Vec<String> = serde_json::from_str(&tags_str).unwrap_or_default();
                // Filter in Rust to avoid false positives from LIKE
                if !tags.iter().any(|t| t == tag_name) {
                    return Ok(None);
                }
                Ok(Some(schema::NoteMeta {
                    id: row.get(0)?,
                    path: row.get(1)?,
                    title: row.get(2)?,
                    tags,
                    content_hash: row.get(4)?,
                    created_at: row.get(5)?,
                    updated_at: row.get(6)?,
                }))
            })?
            .filter_map(|r| r.transpose())
            .collect::<std::result::Result<Vec<_>, _>>()?;
        Ok(notes)
    }

    // -- Folder meta operations --

    pub fn set_folder_icon(&self, path: &str, icon: Option<&str>) -> Result<()> {
        let conn = self.lock_conn()?;
        if let Some(i) = icon {
            conn.execute(
                "INSERT INTO folder_meta (path, icon) VALUES (?1, ?2)
                 ON CONFLICT(path) DO UPDATE SET icon = excluded.icon",
                rusqlite::params![path, i],
            )?;
        } else {
            conn.execute("DELETE FROM folder_meta WHERE path = ?1", rusqlite::params![path])?;
        }
        Ok(())
    }

    pub fn get_folder_meta(&self, path: &str) -> Result<Option<schema::FolderMeta>> {
        let conn = self.lock_conn()?;
        let result = conn
            .prepare("SELECT path, icon, color FROM folder_meta WHERE path = ?1")?
            .query_row(rusqlite::params![path], |row| {
                Ok(schema::FolderMeta {
                    path: row.get(0)?,
                    icon: row.get(1)?,
                    color: row.get(2)?,
                })
            })
            .optional()?;
        Ok(result)
    }

    pub fn list_folder_metas(&self) -> Result<Vec<schema::FolderMeta>> {
        let conn = self.lock_conn()?;
        let mut stmt = conn.prepare("SELECT path, icon, color FROM folder_meta")?;
        let metas = stmt
            .query_map([], |row| {
                Ok(schema::FolderMeta {
                    path: row.get(0)?,
                    icon: row.get(1)?,
                    color: row.get(2)?,
                })
            })?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        Ok(metas)
    }

    // -- Sync state operations --

    pub fn get_sync_state(&self, file_path: &str) -> Result<Option<schema::SyncState>> {
        let conn = self.lock_conn()?;
        let result = conn
            .prepare(
                "SELECT file_path, local_hash, remote_hash, sync_status, last_synced, last_synced_mtime, remote_fid, version
                 FROM sync_state WHERE file_path = ?1",
            )?
            .query_row(rusqlite::params![file_path], |row| {
                Ok(schema::SyncState {
                    file_path: row.get(0)?,
                    local_hash: row.get(1)?,
                    remote_hash: row.get(2)?,
                    sync_status: row.get(3)?,
                    last_synced: row.get(4)?,
                    last_synced_mtime: row.get(5)?,
                    remote_fid: row.get(6)?,
                    version: row.get(7)?,
                })
            })
            .optional()?;
        Ok(result)
    }

    pub fn get_all_sync_states(&self) -> Result<Vec<schema::SyncState>> {
        let conn = self.lock_conn()?;
        let mut stmt = conn.prepare(
            "SELECT file_path, local_hash, remote_hash, sync_status, last_synced, last_synced_mtime, remote_fid, version
             FROM sync_state",
        )?;
        let states = stmt
            .query_map([], |row| {
                Ok(schema::SyncState {
                    file_path: row.get(0)?,
                    local_hash: row.get(1)?,
                    remote_hash: row.get(2)?,
                    sync_status: row.get(3)?,
                    last_synced: row.get(4)?,
                    last_synced_mtime: row.get(5)?,
                    remote_fid: row.get(6)?,
                    version: row.get(7)?,
                })
            })?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        Ok(states)
    }

    pub fn upsert_sync_state(&self, state: &schema::SyncState) -> Result<()> {
        let conn = self.lock_conn()?;
        conn.execute(
            "INSERT INTO sync_state (file_path, local_hash, remote_hash, sync_status, last_synced, last_synced_mtime, remote_fid, version)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
             ON CONFLICT(file_path) DO UPDATE SET
               local_hash = excluded.local_hash,
               remote_hash = excluded.remote_hash,
               sync_status = excluded.sync_status,
               last_synced = excluded.last_synced,
               last_synced_mtime = excluded.last_synced_mtime,
               remote_fid = excluded.remote_fid,
               version = excluded.version",
            rusqlite::params![
                state.file_path,
                state.local_hash,
                state.remote_hash,
                state.sync_status,
                state.last_synced,
                state.last_synced_mtime,
                state.remote_fid,
                state.version,
            ],
        )?;
        Ok(())
    }

    pub fn delete_sync_state(&self, file_path: &str) -> Result<()> {
        let conn = self.lock_conn()?;
        conn.execute("DELETE FROM sync_state WHERE file_path = ?1", rusqlite::params![file_path])?;
        Ok(())
    }

    pub fn get_pending_sync_states(&self) -> Result<Vec<schema::SyncState>> {
        let conn = self.lock_conn()?;
        let mut stmt = conn.prepare(
            "SELECT file_path, local_hash, remote_hash, sync_status, last_synced, last_synced_mtime, remote_fid, version
             FROM sync_state WHERE sync_status != 'synced'",
        )?;
        let states = stmt
            .query_map([], |row| {
                Ok(schema::SyncState {
                    file_path: row.get(0)?,
                    local_hash: row.get(1)?,
                    remote_hash: row.get(2)?,
                    sync_status: row.get(3)?,
                    last_synced: row.get(4)?,
                    last_synced_mtime: row.get(5)?,
                    remote_fid: row.get(6)?,
                    version: row.get(7)?,
                })
            })?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        Ok(states)
    }

    // -- Note icon operations (stored in config table) --

    pub fn set_note_icon(&self, note_id: &str, icon: Option<&str>) -> Result<()> {
        let key = format!("icon:{}", note_id);
        if let Some(i) = icon {
            self.set_config(&key, i)?;
        } else {
            let conn = self.lock_conn()?;
            conn.execute("DELETE FROM config WHERE key = ?1", rusqlite::params![key])?;
        }
        Ok(())
    }

    pub fn get_note_icon(&self, note_id: &str) -> Result<Option<String>> {
        let key = format!("icon:{}", note_id);
        self.get_config(&key)
    }
}

use rusqlite::OptionalExtension;
