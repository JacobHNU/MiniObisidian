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
}

use rusqlite::OptionalExtension;
