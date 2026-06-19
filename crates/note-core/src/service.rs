use anyhow::{Context, Result};
use chrono::Utc;
use std::fs;
use std::path::{Path, PathBuf};
use storage::schema::NoteMeta;
use storage::Database;
use uuid::Uuid;

use crate::link;
use crate::parser;

/// Core note management service
pub struct NoteService {
    vault_path: PathBuf,
    db: Database,
}

impl NoteService {
    pub fn new(vault_path: PathBuf, db: Database) -> Result<Self> {
        // Ensure vault directory exists
        fs::create_dir_all(&vault_path)
            .with_context(|| format!("Failed to create vault directory: {:?}", vault_path))?;

        // Ensure default subdirectories exist
        for dir in &["inbox", "daily", "templates", "attachments"] {
            fs::create_dir_all(vault_path.join(dir))?;
        }

        // Ensure .vault system directory exists
        fs::create_dir_all(vault_path.join(".vault"))?;
        fs::create_dir_all(vault_path.join(".vault").join("trash"))?;

        Ok(Self { vault_path, db })
    }

    pub fn vault_path(&self) -> &Path {
        &self.vault_path
    }

    pub fn db(&self) -> &Database {
        &self.db
    }

    /// Create a new note
    pub fn create_note(
        &self,
        title: &str,
        body: &str,
        folder: Option<&str>,
        tags: Vec<String>,
    ) -> Result<NoteMeta> {
        let id = Uuid::new_v4().to_string();
        let now = Utc::now().to_rfc3339();

        // Determine file path
        let folder = folder.unwrap_or("inbox");
        let safe_title = title
            .chars()
            .map(|c| if c.is_alphanumeric() || c == '-' || c == '_' || c == ' ' { c } else { '-' })
            .collect::<String>()
            .trim()
            .replace(' ', "-");

        let filename = if safe_title.is_empty() {
            format!("{}.md", &id[..8])
        } else {
            // Ensure unique filename by appending timestamp if file exists
            let base = format!("{}.md", safe_title);
            let candidate = self.vault_path.join(folder).join(&base);
            if candidate.exists() {
                let ts = Utc::now().timestamp();
                format!("{}-{}.md", safe_title, ts)
            } else {
                base
            }
        };

        let relative_path = format!("{}/{}", folder, filename);
        let abs_path = self.vault_path.join(&relative_path);

        // Ensure parent directory exists
        if let Some(parent) = abs_path.parent() {
            fs::create_dir_all(parent)?;
        }

        // Build frontmatter
        let fm = parser::Frontmatter {
            id: Some(id.clone()),
            title: title.to_string(),
            tags: tags.clone(),
            created: Some(now.clone()),
            updated: Some(now.clone()),
            links: Vec::new(),
            ai_summary: None,
        };

        let content = parser::rebuild_note_content(&fm, body);
        let hash = parser::content_hash(&content);

        // Write file
        fs::write(&abs_path, &content)?;

        // Save to database
        let note = NoteMeta {
            id: id.clone(),
            path: relative_path.clone(),
            title: title.to_string(),
            tags,
            content_hash: hash,
            created_at: now.clone(),
            updated_at: now,
        };

        self.db.upsert_note(&note)?;

        // Extract and save links
        self.update_links(&id, body)?;

        Ok(note)
    }

    /// Create or open today's daily note
    pub fn create_daily_note(&self) -> Result<NoteMeta> {
        self.create_daily_note_for_date(None)
    }

    pub fn create_daily_note_for_date(&self, date: Option<&str>) -> Result<NoteMeta> {
        use chrono::Local;
        use chrono::NaiveDate;

        let (date_str, weekday);
        if let Some(date_input) = date {
            // Parse user-provided date (YYYY-MM-DD)
            let parsed = NaiveDate::parse_from_str(date_input, "%Y-%m-%d")
                .map_err(|_| anyhow::anyhow!("Invalid date format: {}. Expected YYYY-MM-DD", date_input))?;
            let weekday_names = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
            weekday = weekday_names[parsed.format("%w").to_string().parse::<usize>().unwrap_or(0)].to_string();
            date_str = parsed.format("%Y-%m-%d").to_string();
        } else {
            let now = Local::now();
            let weekday_names = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
            weekday = weekday_names[now.format("%w").to_string().parse::<usize>().unwrap_or(0)].to_string();
            date_str = now.format("%Y-%m-%d").to_string();
        }

        let year = &date_str[..4];
        let month = &date_str[5..7];

        // Path: daily/YYYY/MM/YYYY-MM-DD.md
        let folder = format!("daily/{}/{}", year, month);
        let filename = format!("{}.md", date_str);
        let relative_path = format!("{}/{}", folder, filename);
        let abs_path = self.vault_path.join(&relative_path);

        // If the daily note already exists, return it
        if abs_path.exists() {
            if let Some(existing) = self.db.get_note_by_path(&relative_path)? {
                return Ok(existing);
            }
        }

        let abs_now = Utc::now().to_rfc3339();
        let title = format!("{}", date_str);
        let id = Uuid::new_v4().to_string();
        let body = format!(
            "# {} {}\n\n## Tasks\n\n- [ ] \n\n## Notes\n\n\n",
            date_str, weekday
        );

        let fm = parser::Frontmatter {
            id: Some(id.clone()),
            title: title.clone(),
            tags: vec!["daily".to_string()],
            created: Some(abs_now.clone()),
            updated: Some(abs_now.clone()),
            links: Vec::new(),
            ai_summary: None,
        };

        let content = parser::rebuild_note_content(&fm, &body);
        let hash = parser::content_hash(&content);

        // Ensure directory exists
        if let Some(parent) = abs_path.parent() {
            fs::create_dir_all(parent)?;
        }

        fs::write(&abs_path, &content)?;

        let note = NoteMeta {
            id: id.clone(),
            path: relative_path,
            title,
            tags: vec!["daily".to_string()],
            content_hash: hash,
            created_at: abs_now.clone(),
            updated_at: abs_now,
        };

        self.db.upsert_note(&note)?;

        Ok(note)
    }

    /// Read a note's content from disk
    pub fn read_note(&self, note_id: &str) -> Result<Option<parser::ParsedNote>> {
        let meta = self.db.get_note(note_id)?;
        match meta {
            Some(m) => {
                let abs_path = self.vault_path.join(&m.path);
                if abs_path.exists() {
                    let content = fs::read_to_string(&abs_path)?;
                    let parsed = parser::parse_note(&content)?;
                    Ok(Some(parsed))
                } else {
                    Ok(None)
                }
            }
            None => Ok(None),
        }
    }

    /// Read raw content of a note by path
    pub fn read_note_by_path(&self, relative_path: &str) -> Result<String> {
        let abs_path = self.vault_path.join(relative_path);
        let content = fs::read_to_string(&abs_path)
            .with_context(|| format!("Failed to read note: {}", relative_path))?;
        Ok(content)
    }

    /// Update a note's content
    pub fn update_note(&self, note_id: &str, new_content: &str) -> Result<NoteMeta> {
        let meta = self
            .db
            .get_note(note_id)?
            .context("Note not found")?;

        let abs_path = self.vault_path.join(&meta.path);
        let now = Utc::now().to_rfc3339();

        // Parse the new content to extract frontmatter
        let parsed = parser::parse_note(new_content)?;

        // Update frontmatter's updated timestamp
        let mut fm = parsed.frontmatter.clone();
        fm.updated = Some(now.clone());

        let final_content = parser::rebuild_note_content(&fm, &parsed.body);
        let hash = parser::content_hash(&final_content);

        // Write updated file
        fs::write(&abs_path, &final_content)?;

        // Update database
        let updated_meta = NoteMeta {
            id: meta.id.clone(),
            path: meta.path,
            title: if fm.title.is_empty() { meta.title } else { fm.title },
            tags: if fm.tags.is_empty() { meta.tags } else { fm.tags },
            content_hash: hash,
            created_at: meta.created_at,
            updated_at: now,
        };

        self.db.upsert_note(&updated_meta)?;

        // Update links
        self.update_links(note_id, &parsed.body)?;

        Ok(updated_meta)
    }

    /// Delete a note (soft delete: move to .vault/trash/)
    pub fn delete_note(&self, note_id: &str) -> Result<()> {
        let meta = self
            .db
            .get_note(note_id)?
            .context("Note not found")?;

        let abs_path = self.vault_path.join(&meta.path);

        // Move to trash
        if abs_path.exists() {
            let trash_name = format!(
                "{}.{}.{}",
                meta.path.replace('/', "_"),
                Utc::now().timestamp(),
                "md"
            );
            let trash_path = self.vault_path.join(".vault").join("trash").join(&trash_name);
            fs::rename(&abs_path, &trash_path)?;
        }

        // Remove from database
        self.db.delete_note(note_id)?;

        Ok(())
    }

    /// List all notes in the vault
    pub fn list_notes(&self) -> Result<Vec<NoteMeta>> {
        self.db.list_notes()
    }

    /// List all folders in the vault
    pub fn list_folders(&self) -> Result<Vec<String>> {
        let mut folders = Vec::new();
        self.collect_folders(&self.vault_path, "", &mut folders)?;
        folders.sort();
        Ok(folders)
    }

    fn collect_folders(&self, dir: &Path, prefix: &str, folders: &mut Vec<String>) -> Result<()> {
        for entry in fs::read_dir(dir)? {
            let entry = entry?;
            let path = entry.path();
            if path.is_dir() {
                let name = entry.file_name().to_string_lossy().to_string();
                // Skip hidden directories
                if name.starts_with('.') {
                    continue;
                }
                let rel = if prefix.is_empty() {
                    name.clone()
                } else {
                    format!("{}/{}", prefix, name)
                };
                folders.push(rel.clone());
                self.collect_folders(&path, &rel, folders)?;
            }
        }
        Ok(())
    }

    /// List all markdown files in a folder
    pub fn list_files_in_folder(&self, folder: &str) -> Result<Vec<FileInfo>> {
        let dir = if folder.is_empty() {
            self.vault_path.clone()
        } else {
            self.vault_path.join(folder)
        };

        let mut files = Vec::new();
        if dir.exists() {
            for entry in fs::read_dir(&dir)? {
                let entry = entry?;
                let path = entry.path();
                // Include all files (not just .md), especially images in attachments/
                if path.is_file() {
                    let name = entry.file_name().to_string_lossy().to_string();
                    let relative_path = if folder.is_empty() {
                        name.clone()
                    } else {
                        format!("{}/{}", folder, name)
                    };
                    let meta = entry.metadata()?;
                    files.push(FileInfo {
                        name,
                        path: relative_path,
                        size: meta.len(),
                        modified: meta.modified().ok().map(|t| {
                            t.duration_since(std::time::UNIX_EPOCH)
                                .unwrap_or_default()
                                .as_secs()
                        }),
                    });
                }
            }
        }

        files.sort_by(|a, b| a.name.cmp(&b.name));
        Ok(files)
    }

    /// Create a new folder in the vault
    pub fn create_folder(&self, folder_path: &str) -> Result<()> {
        let abs_path = self.vault_path().join(folder_path);
        fs::create_dir_all(&abs_path)?;
        Ok(())
    }

    /// Delete a folder and all its contents (moves notes to trash first)
    pub fn delete_folder(&self, folder_path: &str) -> Result<()> {
        let abs_path = self.vault_path().join(folder_path);
        
        // First, move all notes in this folder to trash
        let all_notes = self.list_notes()?;
        for note in all_notes {
            if note.path.starts_with(folder_path) {
                let note_path = self.vault_path().join(&note.path);
                if note_path.exists() {
                    // Move to trash (same as delete_note)
                    let trash_name = format!(
                        "{}.{}.{}",
                        note.path.replace('/', "_"),
                        Utc::now().timestamp(),
                        "md"
                    );
                    let trash_path = self.vault_path.join(".vault").join("trash").join(&trash_name);
                    let _ = fs::rename(&note_path, &trash_path);
                }
                // Remove from database
                self.db.delete_note(&note.id)?;
            }
        }
        
        // Delete the folder itself (now empty or only contains non-md files)
        if abs_path.exists() && abs_path.is_dir() {
            fs::remove_dir_all(&abs_path)?;
        }
        
        Ok(())
    }

    /// Rename a note
    pub fn rename_note(&self, note_id: &str, new_title: &str) -> Result<NoteMeta> {
        let meta = self
            .db
            .get_note(note_id)?
            .context("Note not found")?;

        let abs_path = self.vault_path.join(&meta.path);
        let content = fs::read_to_string(&abs_path)?;
        let mut parsed = parser::parse_note(&content)?;

        parsed.frontmatter.title = new_title.to_string();
        let new_content = parser::rebuild_note_content(&parsed.frontmatter, &parsed.body);

        self.update_note(note_id, &new_content)
    }

    /// Move a note to a different folder with cross-device support and conflict handling
    pub fn move_note(&self, note_id: &str, target_folder: &str) -> Result<NoteMeta> {
        let meta = self
            .db
            .get_note(note_id)?
            .context("Note not found")?;

        let old_abs_path = self.vault_path.join(&meta.path);
        if !old_abs_path.exists() {
            anyhow::bail!("Source file not found: {}", old_abs_path.display());
        }

        let filename = old_abs_path
            .file_name()
            .context("Invalid path")?
            .to_string_lossy()
            .to_string();

        // Build target path with conflict resolution
        let mut new_relative_path = if target_folder.is_empty() {
            filename.clone()
        } else {
            format!("{}/{}", target_folder, filename)
        };
        let mut new_abs_path = self.vault_path.join(&new_relative_path);

        // Handle same-name conflict: append numeric suffix
        if new_abs_path.exists() && new_abs_path != old_abs_path {
            let stem = Path::new(&filename)
                .file_stem()
                .unwrap_or_default()
                .to_string_lossy();
            let ext = Path::new(&filename)
                .extension()
                .map(|e| format!(".{}", e.to_string_lossy()))
                .unwrap_or_default();
            for i in 1..1000 {
                let candidate = format!("{} ({}){}", stem, i, ext);
                let candidate_rel = if target_folder.is_empty() {
                    candidate.clone()
                } else {
                    format!("{}/{}", target_folder, candidate)
                };
                let candidate_abs = self.vault_path.join(&candidate_rel);
                if !candidate_abs.exists() {
                    new_relative_path = candidate_rel;
                    new_abs_path = candidate_abs;
                    break;
                }
            }
        }

        // Ensure target folder exists
        if let Some(parent) = new_abs_path.parent() {
            fs::create_dir_all(parent)?;
        }

        // Try fs::rename first (atomic, fast)
        let move_result = fs::rename(&old_abs_path, &new_abs_path);
        if move_result.is_err() {
            // Cross-device fallback: copy + delete
            fs::copy(&old_abs_path, &new_abs_path).context(
                "Failed to copy file. Check disk space and file permissions."
            )?;
            // Only remove source after successful copy
            if let Err(e) = fs::remove_file(&old_abs_path) {
                // Copy succeeded but delete failed - still update DB since file exists at new location
                tracing::warn!("Failed to remove source file after copy: {}", e);
            }
        }

        // Update database using atomic path update (avoids UNIQUE constraint conflict)
        if let Err(db_err) = self.db.update_note_path(&meta.id, &new_relative_path, &meta.content_hash) {
            // Rollback: move file back to original location
            let _ = fs::rename(&new_abs_path, &old_abs_path);
            anyhow::bail!("Database update failed, file move rolled back: {}", db_err);
        }

        let updated = NoteMeta {
            path: new_relative_path,
            updated_at: chrono::Utc::now().to_rfc3339(),
            ..meta
        };

        Ok(updated)
    }

    /// Scan the vault directory and index all markdown files (incremental)
    pub fn scan_vault(&self) -> Result<Vec<NoteMeta>> {
        // Load existing notes from the database for incremental comparison
        let existing_notes = self.db.list_notes()?;

        let mut indexed = Vec::new();
        let mut seen_paths = std::collections::HashSet::new();
        self.scan_directory_incremental(&self.vault_path, "", &mut indexed, &mut seen_paths, &existing_notes)?;

        // Remove notes from DB whose files no longer exist on disk
        for note in &existing_notes {
            if !seen_paths.contains(&note.path) {
                let abs_path = self.vault_path.join(&note.path);
                if !abs_path.exists() {
                    self.db.delete_note(&note.id)?;
                    tracing::info!("Removed stale note from DB: {}", note.path);
                }
            }
        }

        tracing::info!("Scanned and indexed {} notes", indexed.len());
        Ok(indexed)
    }

    fn scan_directory_incremental(
        &self,
        dir: &Path,
        prefix: &str,
        indexed: &mut Vec<NoteMeta>,
        seen_paths: &mut std::collections::HashSet<String>,
        existing_notes: &[NoteMeta],
    ) -> Result<()> {
        for entry in fs::read_dir(dir)? {
            let entry = entry?;
            let path = entry.path();

            if path.is_dir() {
                let name = entry.file_name().to_string_lossy().to_string();
                if name.starts_with('.') {
                    continue;
                }
                let rel = if prefix.is_empty() {
                    name.clone()
                } else {
                    format!("{}/{}", prefix, name)
                };
                self.scan_directory_incremental(&path, &rel, indexed, seen_paths, existing_notes)?;
            } else {
                let name = entry.file_name().to_string_lossy().to_string();
                let ext = path.extension().map(|e| e.to_string_lossy().to_string().to_lowercase()).unwrap_or_default();
                let relative_path = if prefix.is_empty() {
                    name.clone()
                } else {
                    format!("{}/{}", prefix, name)
                };

                // Only index markdown and PDF files
                if ext != "md" && ext != "pdf" {
                    continue;
                }

                seen_paths.insert(relative_path.clone());

                // Check if this file has changed by comparing content hash
                let current_hash = if ext == "md" {
                    fs::read_to_string(&path)
                        .ok()
                        .map(|c| parser::content_hash(&c))
                } else {
                    // For PDF files, use file metadata hash
                    fs::metadata(&path)
                        .ok()
                        .map(|m| format!("{}-{}", m.len(), m.modified().map(|t| t.duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_secs()).unwrap_or(0)))
                        .map(|s| parser::content_hash(&s))
                };

                let existing = existing_notes.iter().find(|n| n.path == relative_path);

                let needs_reindex = match (existing, &current_hash) {
                    (Some(note), Some(hash)) => note.content_hash != *hash,
                    (None, Some(_)) => true,
                    _ => false,
                };

                if needs_reindex {
                    let result = if ext == "pdf" {
                        self.index_pdf_file(&relative_path)
                    } else {
                        self.index_file(&relative_path)
                    };
                    match result {
                        Ok(meta) => indexed.push(meta),
                        Err(e) => {
                            tracing::warn!("Failed to index {}: {}", relative_path, e);
                        }
                    }
                } else if let Some(note) = existing {
                    indexed.push(note.clone());
                }
            }
        }
        Ok(())
    }

    /// Index a PDF file (without parsing frontmatter)
    fn index_pdf_file(&self, relative_path: &str) -> Result<NoteMeta> {
        let abs_path = self.vault_path.join(relative_path);

        // Use file metadata for hash
        let metadata = fs::metadata(&abs_path)?;
        let hash = format!("{}-{}", metadata.len(), metadata.modified()
            .map(|t| t.duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_secs())
            .unwrap_or(0));
        let hash = parser::content_hash(&hash);

        // Check if already exists in DB
        let existing = self.db.list_notes()?.into_iter().find(|n| n.path == relative_path);
        let id = existing.map(|n| n.id).unwrap_or_else(|| Uuid::new_v4().to_string());

        let title = Path::new(relative_path)
            .file_stem()
            .map(|s| s.to_string_lossy().to_string())
            .unwrap_or_else(|| "Untitled".to_string());

        let now = Utc::now().to_rfc3339();

        let meta = NoteMeta {
            id,
            path: relative_path.to_string(),
            title,
            tags: vec!["pdf".to_string()],
            content_hash: hash,
            created_at: now.clone(),
            updated_at: now,
        };

        self.db.upsert_note(&meta)?;

        Ok(meta)
    }

    fn index_file(&self, relative_path: &str) -> Result<NoteMeta> {
        let abs_path = self.vault_path.join(relative_path);
        let content = fs::read_to_string(&abs_path)?;
        let parsed = parser::parse_note(&content)?;
        let hash = parser::content_hash(&content);

        // Check if file already exists in DB by path
        let existing = self.db.list_notes()?.into_iter().find(|n| n.path == relative_path);

        // Reuse existing ID from frontmatter or database for stability across restarts
        let id = parsed
            .frontmatter
            .id
            .clone()
            .or_else(|| existing.as_ref().map(|n| n.id.clone()))
            .unwrap_or_else(|| Uuid::new_v4().to_string());
        let now = Utc::now().to_rfc3339();

        let title = if parsed.frontmatter.title.is_empty() {
            // Use filename as title
            Path::new(relative_path)
                .file_stem()
                .map(|s| s.to_string_lossy().to_string())
                .unwrap_or_else(|| "Untitled".to_string())
        } else {
            parsed.frontmatter.title.clone()
        };

        let created_at = parsed
            .frontmatter
            .created
            .or_else(|| existing.as_ref().map(|n| n.created_at.clone()))
            .unwrap_or_else(|| now.clone());
        let updated_at = parsed
            .frontmatter
            .updated
            .unwrap_or_else(|| now.clone());

        let meta = NoteMeta {
            id,
            path: relative_path.to_string(),
            title,
            tags: parsed.frontmatter.tags,
            content_hash: hash,
            created_at,
            updated_at,
        };

        self.db.upsert_note(&meta)?;
        self.update_links(&meta.id, &parsed.body)?;

        Ok(meta)
    }

    fn update_links(&self, source_id: &str, body: &str) -> Result<()> {
        // Clear existing links from this note
        self.db.clear_links_from(source_id)?;

        // Extract wiki links and add them
        let wiki_links = link::extract_wiki_links(body);
        for wl in &wiki_links {
            // Try to find target note by title
            let target_id = self.find_note_id_by_title(&wl.target)
                .unwrap_or_else(|| link::target_to_id(&wl.target));
            self.db
                .upsert_link(source_id, &target_id, Some(&wl.context))?;
        }

        // Also extract standard markdown links
        let md_links = link::extract_md_links(body);
        for ml in &md_links {
            let target_id = self.find_note_id_by_title(&ml.target)
                .unwrap_or_else(|| link::target_to_id(&ml.target));
            self.db
                .upsert_link(source_id, &target_id, Some(&ml.context))?;
        }

        Ok(())
    }

    /// Find note ID by title (exact match first, then fuzzy)
    fn find_note_id_by_title(&self, title: &str) -> Option<String> {
        let notes = self.db.list_notes().ok()?;
        
        // Try exact title match first
        if let Some(note) = notes.iter().find(|n| n.title == title) {
            return Some(note.id.clone());
        }
        
        // Try case-insensitive match
        let title_lower = title.to_lowercase();
        if let Some(note) = notes.iter().find(|n| n.title.to_lowercase() == title_lower) {
            return Some(note.id.clone());
        }
        
        // Try matching by filename (without extension)
        for note in &notes {
            if let Some(stem) = Path::new(&note.path).file_stem() {
                let stem_str = stem.to_string_lossy().to_string();
                if stem_str == title || stem_str.to_lowercase() == title_lower {
                    return Some(note.id.clone());
                }
            }
        }
        
        None
    }

    /// Get all links for the knowledge graph
    pub fn get_graph_data(&self) -> Result<GraphData> {
        let notes = self.db.list_notes()?;
        let links = self.db.get_all_links()?;

        let nodes: Vec<GraphNode> = notes
            .iter()
            .map(|n| GraphNode {
                id: n.id.clone(),
                title: n.title.clone(),
                path: n.path.clone(),
                tags: n.tags.clone(),
            })
            .collect();

        let edges: Vec<GraphEdge> = links
            .iter()
            .map(|l| GraphEdge {
                source: l.source_id.clone(),
                target: l.target_id.clone(),
            })
            .collect();

        Ok(GraphData { nodes, edges })
    }
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct FileInfo {
    pub name: String,
    pub path: String,
    pub size: u64,
    pub modified: Option<u64>,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct GraphData {
    pub nodes: Vec<GraphNode>,
    pub edges: Vec<GraphEdge>,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct GraphNode {
    pub id: String,
    pub title: String,
    pub path: String,
    pub tags: Vec<String>,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct GraphEdge {
    pub source: String,
    pub target: String,
}

/// Search-related methods for NoteService
impl NoteService {
    /// Search notes using full-text search
    pub fn search_notes(
        &self,
        query: &str,
        limit: usize,
        search_engine: &crate::search::SearchEngine,
    ) -> Result<Vec<crate::search::SearchResult>> {
        search_engine.search(query, limit)
    }

    /// Index all notes for full-text search
    pub fn index_all_notes_for_search(
        &self,
        search_engine: &crate::search::SearchEngine,
    ) -> Result<()> {
        let notes = self.list_notes()?;
        let mut notes_with_content = Vec::new();

        for note in notes {
            let abs_path = self.vault_path.join(&note.path);
            if abs_path.exists() {
                match fs::read_to_string(&abs_path) {
                    Ok(content) => {
                        let parsed = parser::parse_note(&content)?;
                        notes_with_content.push((note, parsed.body));
                    }
                    Err(e) => {
                        tracing::warn!("Failed to read note {}: {}", note.path, e);
                    }
                }
            }
        }

        search_engine.index_all_notes(&notes_with_content)?;
        Ok(())
    }

    /// Index a single note for search
    pub fn index_note_for_search(
        &self,
        note_id: &str,
        search_engine: &crate::search::SearchEngine,
    ) -> Result<()> {
        let note = self
            .db
            .get_note(note_id)?
            .context("Note not found")?;

        let abs_path = self.vault_path.join(&note.path);
        let content = fs::read_to_string(&abs_path)?;
        let parsed = parser::parse_note(&content)?;

        search_engine.index_note(&note, &parsed.body)?;
        Ok(())
    }
}
