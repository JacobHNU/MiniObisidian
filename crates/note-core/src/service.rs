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

    /// Delete a folder and all its contents
    pub fn delete_folder(&self, folder_path: &str) -> Result<()> {
        let abs_path = self.vault_path().join(folder_path);
        
        // First, delete all notes in this folder from the database
        let all_notes = self.list_notes()?;
        for note in all_notes {
            if note.path.starts_with(folder_path) {
                // Delete from database
                self.db.delete_note(&note.id)?;
                // Delete the file if it exists
                let note_path = self.vault_path().join(&note.path);
                if note_path.exists() {
                    let _ = fs::remove_file(note_path);
                }
            }
        }
        
        // Delete the folder itself
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

    /// Move a note to a different folder
    pub fn move_note(&self, note_id: &str, target_folder: &str) -> Result<NoteMeta> {
        let meta = self
            .db
            .get_note(note_id)?
            .context("Note not found")?;

        let old_abs_path = self.vault_path.join(&meta.path);
        let filename = old_abs_path
            .file_name()
            .context("Invalid path")?
            .to_string_lossy()
            .to_string();

        let new_relative_path = format!("{}/{}", target_folder, filename);
        let new_abs_path = self.vault_path.join(&new_relative_path);

        // Ensure target folder exists
        if let Some(parent) = new_abs_path.parent() {
            fs::create_dir_all(parent)?;
        }

        // Move file
        fs::rename(&old_abs_path, &new_abs_path)?;

        // Update database
        let updated = NoteMeta {
            path: new_relative_path,
            ..meta.clone()
        };
        self.db.upsert_note(&updated)?;

        Ok(updated)
    }

    /// Scan the vault directory and index all markdown files
    pub fn scan_vault(&self) -> Result<Vec<NoteMeta>> {
        // Clear old entries before re-scanning to avoid stale/duplicate IDs
        self.db.clear_all_notes()?;
        let mut indexed = Vec::new();
        self.scan_directory(&self.vault_path, "", &mut indexed)?;
        tracing::info!("Scanned and indexed {} notes", indexed.len());
        Ok(indexed)
    }

    fn scan_directory(
        &self,
        dir: &Path,
        prefix: &str,
        indexed: &mut Vec<NoteMeta>,
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
                self.scan_directory(&path, &rel, indexed)?;
            } else if path.extension().map(|e| e == "md").unwrap_or(false) {
                let name = entry.file_name().to_string_lossy().to_string();
                let relative_path = if prefix.is_empty() {
                    name.clone()
                } else {
                    format!("{}/{}", prefix, name)
                };

                match self.index_file(&relative_path) {
                    Ok(meta) => indexed.push(meta),
                    Err(e) => {
                        tracing::warn!("Failed to index {}: {}", relative_path, e);
                    }
                }
            }
        }
        Ok(())
    }

    fn index_file(&self, relative_path: &str) -> Result<NoteMeta> {
        let abs_path = self.vault_path.join(relative_path);
        let content = fs::read_to_string(&abs_path)?;
        let parsed = parser::parse_note(&content)?;
        let hash = parser::content_hash(&content);

        // Reuse existing ID from frontmatter for stability across restarts
        let id = parsed
            .frontmatter
            .id
            .clone()
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
            // Try to find target note by title or filename
            let target_id = link::target_to_id(&wl.target);
            self.db
                .upsert_link(source_id, &target_id, Some(&wl.context))?;
        }

        Ok(())
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
