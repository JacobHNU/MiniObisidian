use crate::AppState;
use note_core::{service::FileInfo, service::GraphData, NoteService};
use serde::{Deserialize, Serialize};
use storage::schema::{NoteMeta, Tag, FolderMeta};
use storage::Database;
use sync_engine::SyncAdapter;
use tauri::{AppHandle, Emitter, State};
use std::path::PathBuf;
use std::sync::OnceLock;
use std::time::Duration;

/// Shared HTTP client with connection pooling - created once, reused for all AI requests
fn get_http_client() -> &'static reqwest::Client {
    static CLIENT: OnceLock<reqwest::Client> = OnceLock::new();
    CLIENT.get_or_init(|| {
        reqwest::Client::builder()
            .timeout(Duration::from_secs(120))
            .connect_timeout(Duration::from_secs(30))
            .pool_idle_timeout(Duration::from_secs(90))
            .pool_max_idle_per_host(5)
            .tcp_keepalive(Duration::from_secs(60))
            .redirect(reqwest::redirect::Policy::limited(10))
            .build()
            .expect("Failed to create HTTP client")
    })
}



#[derive(Debug, Serialize, Deserialize)]
pub struct VaultInfo {
    pub path: String,
    pub note_count: usize,
}

/// Initialize the vault at the given path
#[tauri::command]
pub fn init_vault(
    state: State<'_, AppState>,
    vault_path: String,
) -> Result<VaultInfo, String> {
    let path = PathBuf::from(&vault_path);

    let db_path = path.join(".vault").join("data.db");
    // Ensure .vault directory exists before opening db
    std::fs::create_dir_all(path.join(".vault")).map_err(|e| e.to_string())?;

    let db = Database::open(&db_path).map_err(|e| e.to_string())?;
    let service = NoteService::new(path.clone(), db).map_err(|e| e.to_string())?;

    // Initialize search engine
    let search_index_path = path.join(".vault").join("search_index");
    let search_engine = note_core::SearchEngine::new(&search_index_path)
        .map_err(|e| format!("Failed to initialize search engine: {}", e))?;

    // Auto-scan the vault on init
    let notes = service.scan_vault().map_err(|e| e.to_string())?;
    let count = notes.len();

    // Index all notes for search
    if let Err(e) = service.index_all_notes_for_search(&search_engine) {
        tracing::warn!("Failed to index notes for search: {}", e);
    }

    let mut guard = state.note_service.lock().map_err(|e| e.to_string())?;
    *guard = Some(service);

    let mut search_guard = state.search_engine.lock().map_err(|e| e.to_string())?;
    *search_guard = Some(search_engine);

    Ok(VaultInfo {
        path: vault_path,
        note_count: count,
    })
}

/// Get current vault path
#[tauri::command]
pub fn get_vault_path(state: State<'_, AppState>) -> Result<Option<String>, String> {
    let guard = state.note_service.lock().map_err(|e| e.to_string())?;
    match guard.as_ref() {
        Some(svc) => Ok(Some(svc.vault_path().to_string_lossy().to_string())),
        None => Ok(None),
    }
}

/// Create a new note
#[tauri::command]
pub fn create_note(
    state: State<'_, AppState>,
    title: String,
    body: String,
    folder: Option<String>,
    tags: Option<Vec<String>>,
) -> Result<NoteMeta, String> {
    let guard = state.note_service.lock().map_err(|e| e.to_string())?;
    let svc = guard.as_ref().ok_or("Vault not initialized")?;
    svc.create_note(&title, &body, folder.as_deref(), tags.unwrap_or_default())
        .map_err(|e| e.to_string())
}

/// Read a note by ID
#[tauri::command]
pub fn read_note(
    state: State<'_, AppState>,
    note_id: String,
) -> Result<Option<NoteContent>, String> {
    let guard = state.note_service.lock().map_err(|e| e.to_string())?;
    let svc = guard.as_ref().ok_or("Vault not initialized")?;
    match svc.read_note(&note_id).map_err(|e| e.to_string())? {
        Some(parsed) => Ok(Some(NoteContent {
            title: parsed.frontmatter.title,
            body: parsed.body,
            tags: parsed.frontmatter.tags,
            raw: parsed.raw_content,
        })),
        None => Ok(None),
    }
}

/// Read a note by file path
#[tauri::command]
pub fn read_note_by_path(
    state: State<'_, AppState>,
    path: String,
) -> Result<String, String> {
    tracing::debug!(path = %path, "read_note_by_path called");
    let guard = state.note_service.lock().map_err(|e| {
        tracing::error!("Failed to acquire note_service lock: {}", e);
        e.to_string()
    })?;
    let svc = guard.as_ref().ok_or("Vault not initialized")?;
    let result = svc.read_note_by_path(&path).map_err(|e| {
        tracing::error!(path = %path, error = %e, "Failed to read note by path");
        e.to_string()
    })?;
    tracing::debug!(path = %path, length = result.len(), "read_note_by_path success");
    Ok(result)
}

/// Update a note's content
#[tauri::command]
pub fn update_note(
    state: State<'_, AppState>,
    note_id: String,
    content: String,
) -> Result<NoteMeta, String> {
    tracing::debug!(note_id = %note_id, content_len = content.len(), "update_note called");
    let guard = state.note_service.lock().map_err(|e| {
        tracing::error!("Failed to acquire note_service lock: {}", e);
        e.to_string()
    })?;
    let svc = guard.as_ref().ok_or("Vault not initialized")?;
    let result = svc.update_note(&note_id, &content).map_err(|e| {
        tracing::error!(note_id = %note_id, error = %e, "Failed to update note");
        e.to_string()
    })?;
    tracing::debug!(note_id = %note_id, "update_note success");
    Ok(result)
}

/// Delete a note
#[tauri::command]
pub fn delete_note(
    state: State<'_, AppState>,
    note_id: String,
) -> Result<(), String> {
    let guard = state.note_service.lock().map_err(|e| e.to_string())?;
    let svc = guard.as_ref().ok_or("Vault not initialized")?;
    svc.delete_note(&note_id).map_err(|e| e.to_string())
}

/// List all notes
#[tauri::command]
pub fn list_notes(
    state: State<'_, AppState>,
) -> Result<Vec<NoteMeta>, String> {
    let guard = state.note_service.lock().map_err(|e| e.to_string())?;
    let svc = guard.as_ref().ok_or("Vault not initialized")?;
    svc.list_notes().map_err(|e| e.to_string())
}

/// List all folders
#[tauri::command]
pub fn list_folders(
    state: State<'_, AppState>,
) -> Result<Vec<String>, String> {
    let guard = state.note_service.lock().map_err(|e| e.to_string())?;
    let svc = guard.as_ref().ok_or("Vault not initialized")?;
    svc.list_folders().map_err(|e| e.to_string())
}

/// List files in a folder
#[tauri::command]
pub fn list_files(
    state: State<'_, AppState>,
    folder: String,
) -> Result<Vec<FileInfo>, String> {
    let guard = state.note_service.lock().map_err(|e| e.to_string())?;
    let svc = guard.as_ref().ok_or("Vault not initialized")?;
    svc.list_files_in_folder(&folder).map_err(|e| e.to_string())
}

/// Create a new folder
#[tauri::command]
pub fn create_folder(
    state: State<'_, AppState>,
    folder_path: String,
) -> Result<(), String> {
    let guard = state.note_service.lock().map_err(|e| e.to_string())?;
    let svc = guard.as_ref().ok_or("Vault not initialized")?;
    svc.create_folder(&folder_path).map_err(|e| e.to_string())
}

/// Delete a folder
#[tauri::command]
pub fn delete_folder(
    state: State<'_, AppState>,
    folder_path: String,
) -> Result<(), String> {
    let guard = state.note_service.lock().map_err(|e| e.to_string())?;
    let svc = guard.as_ref().ok_or("Vault not initialized")?;
    svc.delete_folder(&folder_path).map_err(|e| e.to_string())
}

/// Rename a note
#[tauri::command]
pub fn rename_note(
    state: State<'_, AppState>,
    note_id: String,
    new_title: String,
) -> Result<NoteMeta, String> {
    tracing::info!(note_id = %note_id, new_title = %new_title, "rename_note called");
    let guard = state.note_service.lock().map_err(|e| {
        tracing::error!("Failed to acquire note_service lock: {}", e);
        e.to_string()
    })?;
    let svc = guard.as_ref().ok_or("Vault not initialized")?;
    let result = svc.rename_note(&note_id, &new_title).map_err(|e| {
        tracing::error!(note_id = %note_id, error = %e, "Failed to rename note");
        e.to_string()
    })?;
    tracing::info!(note_id = %note_id, new_path = %result.path, "rename_note success");
    Ok(result)
}

/// Move a note to a different folder
#[tauri::command]
pub fn move_note(
    state: State<'_, AppState>,
    note_id: String,
    target_folder: String,
) -> Result<NoteMeta, String> {
    tracing::info!(note_id = %note_id, target_folder = %target_folder, "move_note called");
    let guard = state.note_service.lock().map_err(|e| {
        tracing::error!("Failed to acquire note_service lock: {}", e);
        e.to_string()
    })?;
    let svc = guard.as_ref().ok_or("Vault not initialized")?;
    let result = svc.move_note(&note_id, &target_folder).map_err(|e| {
        tracing::error!(note_id = %note_id, error = %e, "Failed to move note");
        e.to_string()
    })?;
    tracing::info!(note_id = %note_id, new_path = %result.path, "move_note success");
    Ok(result)
}

/// Scan vault and index all notes
#[tauri::command]
pub fn scan_vault(
    state: State<'_, AppState>,
) -> Result<Vec<NoteMeta>, String> {
    let guard = state.note_service.lock().map_err(|e| e.to_string())?;
    let svc = guard.as_ref().ok_or("Vault not initialized")?;
    svc.scan_vault().map_err(|e| e.to_string())
}

/// Rescan vault: scan files + rebuild search index
/// Returns the number of notes found after scan
#[tauri::command]
pub fn rescan_vault(
    state: State<'_, AppState>,
) -> Result<usize, String> {
    let guard = state.note_service.lock().map_err(|e| e.to_string())?;
    let svc = guard.as_ref().ok_or("Vault not initialized")?;

    // Scan filesystem and update DB
    let notes = svc.scan_vault().map_err(|e| e.to_string())?;
    let count = notes.len();

    // Rebuild search index
    let search_engine = state.search_engine.lock().map_err(|e| e.to_string())?;
    if let Some(engine) = search_engine.as_ref() {
        if let Err(e) = svc.index_all_notes_for_search(engine) {
            tracing::warn!("Failed to rebuild search index during rescan: {}", e);
        }
    }

    tracing::info!("Rescan vault complete: {} notes", count);
    Ok(count)
}

/// Get graph data for knowledge graph visualization
#[tauri::command]
pub fn get_graph_data(
    state: State<'_, AppState>,
) -> Result<GraphData, String> {
    let guard = state.note_service.lock().map_err(|e| e.to_string())?;
    let svc = guard.as_ref().ok_or("Vault not initialized")?;
    svc.get_graph_data().map_err(|e| e.to_string())
}

/// Create or open today's daily note
#[tauri::command]
pub fn create_daily_note(
    state: State<'_, AppState>,
    date: Option<String>,
) -> Result<NoteMeta, String> {
    let guard = state.note_service.lock().map_err(|e| e.to_string())?;
    let svc = guard.as_ref().ok_or("Vault not initialized")?;
    svc.create_daily_note_for_date(date.as_deref()).map_err(|e| e.to_string())
}

/// Open file explorer showing the given note file or folder
#[tauri::command]
pub fn show_in_folder(
    state: State<'_, AppState>,
    note_path: String,
) -> Result<(), String> {
    let guard = state.note_service.lock().map_err(|e| e.to_string())?;
    let svc = guard.as_ref().ok_or("Vault not initialized")?;
    let clean_path = note_path.trim_end_matches('/');
    let vault_path = svc.vault_path();
    let abs_path = vault_path.join(clean_path);

    // Find the correct target path
    let target_path = if abs_path.is_dir() {
        abs_path.clone()
    } else if abs_path.exists() {
        abs_path.parent().unwrap_or(&abs_path).to_path_buf()
    } else {
        // Path doesn't exist - find closest existing parent
        let mut current = abs_path.clone();
        let mut found = false;

        while let Some(parent) = current.parent() {
            if parent.exists() && parent.is_dir() {
                found = true;
                break;
            }
            current = parent.to_path_buf();
        }

        if found { current } else { vault_path.to_path_buf() }
    };

    tracing::info!("Opening folder: {}", target_path.display());

    // Open in file explorer
    #[cfg(target_os = "windows")]
    {
        let path_str = target_path.to_string_lossy().to_string().replace('/', "\\");
        std::process::Command::new("explorer")
            .arg(&path_str)
            .spawn()
            .map_err(|e| format!("Failed to open explorer: {}", e))?;
    }

    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(&target_path)
            .spawn()
            .map_err(|e| e.to_string())?;
    }

    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdg-open")
            .arg(&target_path)
            .spawn()
            .map_err(|e| e.to_string())?;
    }

    Ok(())
}

// ──────────────────────────────────────────────
// Export Commands
// ──────────────────────────────────────────────

#[tauri::command]
pub fn write_export_file(path: String, data: Vec<u8>) -> Result<(), String> {
    std::fs::write(&path, &data).map_err(|e| format!("Failed to write file '{}': {}", path, e))
}

/// Relocate a note to a new file path (for manual recovery when file was moved/renamed externally)
#[tauri::command]
pub fn relocate_note(
    state: State<'_, AppState>,
    note_id: String,
    new_file_path: String,
) -> Result<NoteMeta, String> {
    let svc_guard = state.note_service.lock().map_err(|e| e.to_string())?;
    let svc = svc_guard.as_ref().ok_or("Vault not initialized")?;

    let abs_path = std::path::Path::new(svc.vault_path()).join(&new_file_path);
    if !abs_path.exists() {
        return Err(format!("File does not exist: {}", new_file_path));
    }

    // Read the new file to compute hash
    let content = note_core::parser::read_file_to_string(&abs_path)
        .map_err(|e| format!("Failed to read file: {}", e))?;
    let hash = note_core::parser::content_hash(&content);

    // Update the path in database
    let db = svc.db();
    db.update_note_path(&note_id, &new_file_path, &hash)
        .map_err(|e| e.to_string())?;

    let meta = db.get_note(&note_id)
        .map_err(|e| e.to_string())?
        .ok_or("Note not found after update")?;

    Ok(meta)
}

/// Get all notes (including those with missing files) for recovery purposes
#[tauri::command]
pub fn get_all_notes_including_missing(
    state: State<'_, AppState>,
) -> Result<Vec<NoteMeta>, String> {
    let svc_guard = state.note_service.lock().map_err(|e| e.to_string())?;
    let svc = svc_guard.as_ref().ok_or("Vault not initialized")?;

    let notes = svc.db().list_notes().map_err(|e| e.to_string())?;

    // Mark which notes have missing files
    Ok(notes)
}

// ──────────────────────────────────────────────
// Tag Commands
// ──────────────────────────────────────────────

#[tauri::command]
pub fn create_tag(
    state: State<'_, AppState>,
    name: String,
    color: Option<String>,
    icon: Option<String>,
    description: Option<String>,
) -> Result<Tag, String> {
    let guard = state.note_service.lock().map_err(|e| e.to_string())?;
    let svc = guard.as_ref().ok_or("Vault not initialized")?;
    let now = chrono::Utc::now().to_rfc3339();
    let tag = Tag {
        name: name.clone(),
        color: color.unwrap_or_else(|| "#cba6f7".to_string()),
        icon,
        description: description.unwrap_or_default(),
        created_at: now,
    };
    svc.db().create_tag(&tag).map_err(|e| e.to_string())?;
    Ok(tag)
}

#[tauri::command]
pub fn update_tag(
    state: State<'_, AppState>,
    name: String,
    color: Option<String>,
    icon: Option<String>,
    description: Option<String>,
) -> Result<Tag, String> {
    let guard = state.note_service.lock().map_err(|e| e.to_string())?;
    let svc = guard.as_ref().ok_or("Vault not initialized")?;
    svc.db().update_tag(&name, color.as_deref(), icon.as_deref(), description.as_deref()).map_err(|e| e.to_string())?;
    svc.db().get_tag(&name).map_err(|e| e.to_string())?.ok_or_else(|| "Tag not found".to_string())
}

#[tauri::command]
pub fn delete_tag(state: State<'_, AppState>, name: String) -> Result<(), String> {
    let guard = state.note_service.lock().map_err(|e| e.to_string())?;
    let svc = guard.as_ref().ok_or("Vault not initialized")?;
    svc.db().delete_tag(&name).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn list_tags(state: State<'_, AppState>) -> Result<Vec<Tag>, String> {
    let guard = state.note_service.lock().map_err(|e| e.to_string())?;
    let svc = guard.as_ref().ok_or("Vault not initialized")?;
    svc.db().list_tags().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_notes_by_tag(state: State<'_, AppState>, tag_name: String) -> Result<Vec<NoteMeta>, String> {
    let guard = state.note_service.lock().map_err(|e| e.to_string())?;
    let svc = guard.as_ref().ok_or("Vault not initialized")?;
    svc.db().get_notes_by_tag(&tag_name).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn add_tag_to_note(state: State<'_, AppState>, note_id: String, tag_name: String) -> Result<NoteMeta, String> {
    let guard = state.note_service.lock().map_err(|e| e.to_string())?;
    let svc = guard.as_ref().ok_or("Vault not initialized")?;
    let note = svc.db().get_note(&note_id).map_err(|e| e.to_string())?.ok_or("Note not found")?;
    let mut tags = note.tags.clone();
    if !tags.contains(&tag_name) {
        tags.push(tag_name);
        // Read the raw content, update frontmatter tags, and save
        let rel_path = &note.path;
        let abs_path = svc.vault_path().join(rel_path);
        let raw = note_core::parser::read_file_to_string(&abs_path).map_err(|e| e.to_string())?;
        let parsed = note_core::parser::parse_note(&raw).map_err(|e| e.to_string())?;
        let mut fm = parsed.frontmatter.clone();
        fm.tags = tags;
        let fm_str = note_core::parser::serialize_frontmatter(&fm);
        let new_raw = format!("{}\n\n{}", fm_str, parsed.body);
        std::fs::write(&abs_path, &new_raw).map_err(|e| e.to_string())?;
        svc.update_note(&note_id, &new_raw).map_err(|e| e.to_string())
    } else {
        Ok(note)
    }
}

#[tauri::command]
pub fn remove_tag_from_note(state: State<'_, AppState>, note_id: String, tag_name: String) -> Result<NoteMeta, String> {
    let guard = state.note_service.lock().map_err(|e| e.to_string())?;
    let svc = guard.as_ref().ok_or("Vault not initialized")?;
    let note = svc.db().get_note(&note_id).map_err(|e| e.to_string())?.ok_or("Note not found")?;
    let mut tags = note.tags.clone();
    if let Some(pos) = tags.iter().position(|t| t == &tag_name) {
        tags.remove(pos);
        let rel_path = &note.path;
        let abs_path = svc.vault_path().join(rel_path);
        let raw = note_core::parser::read_file_to_string(&abs_path).map_err(|e| e.to_string())?;
        let parsed = note_core::parser::parse_note(&raw).map_err(|e| e.to_string())?;
        let mut fm = parsed.frontmatter.clone();
        fm.tags = tags;
        let fm_str = note_core::parser::serialize_frontmatter(&fm);
        let new_raw = format!("{}\n\n{}", fm_str, parsed.body);
        std::fs::write(&abs_path, &new_raw).map_err(|e| e.to_string())?;
        svc.update_note(&note_id, &new_raw).map_err(|e| e.to_string())
    } else {
        Ok(note)
    }
}

// ──────────────────────────────────────────────
// Icon Commands
// ──────────────────────────────────────────────

#[tauri::command]
pub fn set_folder_icon(state: State<'_, AppState>, path: String, icon: Option<String>) -> Result<(), String> {
    let guard = state.note_service.lock().map_err(|e| e.to_string())?;
    let svc = guard.as_ref().ok_or("Vault not initialized")?;
    svc.db().set_folder_icon(&path, icon.as_deref()).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_folder_icon(state: State<'_, AppState>, path: String) -> Result<Option<String>, String> {
    let guard = state.note_service.lock().map_err(|e| e.to_string())?;
    let svc = guard.as_ref().ok_or("Vault not initialized")?;
    let meta = svc.db().get_folder_meta(&path).map_err(|e| e.to_string())?;
    Ok(meta.and_then(|m| m.icon))
}

#[tauri::command]
pub fn list_folder_icons(state: State<'_, AppState>) -> Result<Vec<FolderMeta>, String> {
    let guard = state.note_service.lock().map_err(|e| e.to_string())?;
    let svc = guard.as_ref().ok_or("Vault not initialized")?;
    svc.db().list_folder_metas().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn set_note_icon(state: State<'_, AppState>, note_id: String, icon: Option<String>) -> Result<(), String> {
    let guard = state.note_service.lock().map_err(|e| e.to_string())?;
    let svc = guard.as_ref().ok_or("Vault not initialized")?;
    svc.db().set_note_icon(&note_id, icon.as_deref()).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_note_icon(state: State<'_, AppState>, note_id: String) -> Result<Option<String>, String> {
    let guard = state.note_service.lock().map_err(|e| e.to_string())?;
    let svc = guard.as_ref().ok_or("Vault not initialized")?;
    svc.db().get_note_icon(&note_id).map_err(|e| e.to_string())
}

/// Save a base64-encoded image to the vault's attachments folder
#[tauri::command]
pub fn save_attachment(
    state: State<'_, AppState>,
    filename: String,
    data_base64: String,
) -> Result<String, String> {
    use base64::Engine;

    let guard = state.note_service.lock().map_err(|e| e.to_string())?;
    let svc = guard.as_ref().ok_or("Vault not initialized")?;

    let attachments_dir = svc.vault_path().join("attachments");
    std::fs::create_dir_all(&attachments_dir).map_err(|e| e.to_string())?;

    // Strip data URI prefix if present (e.g., "data:image/png;base64,")
    let b64 = match data_base64.find(',') {
        Some(pos) => &data_base64[pos + 1..],
        None => &data_base64,
    };

    let bytes = base64::engine::general_purpose::STANDARD
        .decode(b64)
        .map_err(|e| format!("Base64 decode failed: {}", e))?;

    // Sanitize filename: strip path separators and dangerous characters
    let safe_name: String = filename
        .chars()
        .filter(|c| !c.is_control() && *c != '/' && *c != '\\' && *c != ':' && *c != '*' && *c != '?' && *c != '"' && *c != '<' && *c != '>' && *c != '|')
        .collect::<String>()
        .trim()
        .to_string();

    let safe_name = if safe_name.is_empty() {
        format!("attachment-{}.png", chrono::Utc::now().timestamp())
    } else {
        safe_name
    };

    // Handle filename collision by appending a counter
    let mut file_path = attachments_dir.join(&safe_name);
    if file_path.exists() {
        let stem = std::path::Path::new(&safe_name)
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or("attachment");
        let ext = std::path::Path::new(&safe_name)
            .extension()
            .and_then(|s| s.to_str())
            .unwrap_or("png");
        for i in 1..10000 {
            let candidate = format!("{}-{}.{}", stem, i, ext);
            file_path = attachments_dir.join(&candidate);
            if !file_path.exists() {
                break;
            }
        }
    }

    std::fs::write(&file_path, &bytes).map_err(|e| e.to_string())?;

    tracing::info!("Saved attachment: {} ({} bytes)", file_path.display(), bytes.len());

    // Return the relative path
    let rel_name = file_path.file_name()
        .ok_or("Invalid file path: could not extract filename")?
        .to_string_lossy();
    Ok(format!("attachments/{}", rel_name))
}

/// Read an attachment file and return it as a base64 data URI
/// This is used by the frontend to display images in the preview
#[tauri::command]
pub fn read_attachment(
    state: State<'_, AppState>,
    relative_path: String,
) -> Result<String, String> {
    use base64::Engine;

    let guard = state.note_service.lock().map_err(|e| e.to_string())?;
    let svc = guard.as_ref().ok_or("Vault not initialized")?;

    let file_path = svc.vault_path().join(&relative_path);
    // Path traversal protection: ensure resolved path is within vault
    let canonical_path = file_path.canonicalize()
        .map_err(|e| format!("Attachment not found: {} ({})", relative_path, e))?;
    let canonical_vault = svc.vault_path().canonicalize()
        .unwrap_or_else(|_| svc.vault_path().to_path_buf());
    if !canonical_path.starts_with(&canonical_vault) {
        return Err("Access denied: path traversal detected".into());
    }

    let bytes = std::fs::read(&canonical_path).map_err(|e| e.to_string())?;

    // Determine MIME type from extension
    let mime = match canonical_path.extension().and_then(|e| e.to_str()) {
        Some("png") => "image/png",
        Some("jpg") | Some("jpeg") => "image/jpeg",
        Some("gif") => "image/gif",
        Some("webp") => "image/webp",
        Some("svg") => "image/svg+xml",
        Some("bmp") => "image/bmp",
        Some("pdf") => "application/pdf",
        _ => "application/octet-stream",
    };

    let b64 = base64::engine::general_purpose::STANDARD.encode(&bytes);
    Ok(format!("data:{};base64,{}", mime, b64))
}

/// Read a file from the vault and return raw base64 (without data URI prefix)
/// Used for PDF files and other binary files
#[tauri::command]
pub fn read_file_base64(
    state: State<'_, AppState>,
    relative_path: String,
) -> Result<String, String> {
    use base64::Engine;

    let guard = state.note_service.lock().map_err(|e| e.to_string())?;
    let svc = guard.as_ref().ok_or("Vault not initialized")?;

    let file_path = svc.vault_path().join(&relative_path);
    // Path traversal protection: ensure resolved path is within vault
    let canonical_path = file_path.canonicalize()
        .map_err(|e| format!("File not found: {} ({})", relative_path, e))?;
    let canonical_vault = svc.vault_path().canonicalize()
        .unwrap_or_else(|_| svc.vault_path().to_path_buf());
    if !canonical_path.starts_with(&canonical_vault) {
        return Err("Access denied: path traversal detected".into());
    }

    let bytes = std::fs::read(&canonical_path).map_err(|e| e.to_string())?;
    let b64 = base64::engine::general_purpose::STANDARD.encode(&bytes);
    Ok(b64)
}

#[derive(Debug, Serialize, Deserialize)]
pub struct NoteContent {
    pub title: String,
    pub body: String,
    pub tags: Vec<String>,
    pub raw: String,
}

/// AI chat request from frontend
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiChatRequest {
    pub question: String,
    pub note_content: String,
    pub note_title: String,
    pub api_key: String,
    pub api_url: String,
    pub model: String,
    pub history: Vec<ChatMessage>,
    pub context_notes: Option<Vec<ContextNote>>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ChatMessage {
    pub role: String,
    pub content: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ContextNote {
    pub id: String,
    pub title: String,
    pub content: String,
}

/// Send a chat request to an OpenAI-compatible API with note context
#[tauri::command]
pub async fn ai_chat(request: AiChatRequest) -> Result<String, String> {
    // Build system prompt with multi-note context
    let mut context_sections = String::new();

    if let Some(ref notes) = request.context_notes {
        if notes.len() > 1 {
            // Multi-note mode
            context_sections.push_str("The user has the following notes open. ");
            context_sections.push_str("Answer questions based on ALL the note content below. ");
            context_sections.push_str("When referencing information, mention which note it comes from.\n\n");
            for note in notes {
                context_sections.push_str(&format!(
                    "=== NOTE: {} ===\n{}\n=== END NOTE ===\n\n",
                    note.title, note.content
                ));
            }
        } else if let Some(note) = notes.first() {
            // Single note mode
            context_sections.push_str(&format!(
                "The user is currently viewing a note titled \"{}\". \
                 Answer questions based on the note content below.\n\n\
                 --- NOTE CONTENT ---\n{}\n--- END NOTE ---",
                note.title, note.content
            ));
        }
    } else {
        // Fallback to current note
        context_sections.push_str(&format!(
            "The user is currently viewing a note titled \"{}\". \
             Answer questions based on the note content below.\n\n\
             --- NOTE CONTENT ---\n{}\n--- END NOTE ---",
            request.note_title, request.note_content
        ));
    }

    let system_prompt = format!(
        "You are a helpful AI assistant embedded in a note-taking app. \
         If the question is not related to the notes, you may still help but mention that \
         the answer is not based on the current notes. \
         Respond in the same language as the user's question.\n\n{}",
        context_sections
    );

    // Build messages array
    let mut messages = Vec::new();
    messages.push(serde_json::json!({
        "role": "system",
        "content": system_prompt
    }));

    // Add conversation history
    for msg in &request.history {
        messages.push(serde_json::json!({
            "role": msg.role,
            "content": msg.content
        }));
    }

    // Add current question
    messages.push(serde_json::json!({
        "role": "user",
        "content": request.question
    }));

    // Build request body
    let body = serde_json::json!({
        "model": request.model,
        "messages": messages,
        "temperature": 0.7,
        "max_tokens": 2048
    });

    // Build API URL - normalize various URL formats
    let base_url = request.api_url.trim_end_matches('/').trim_end_matches("v1").trim_end_matches('/');
    let url = if base_url.ends_with("/compatible-mode") {
        // DashScope compatible mode: https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions
        format!("{}/v1/chat/completions", base_url)
    } else {
        format!("{}/v1/chat/completions", base_url)
    };

    tracing::info!("AI chat request: model={}, url={}", request.model, url);

    // Use shared client with connection pooling and retry logic
    let client = get_http_client();
    let auth_header = format!("Bearer {}", request.api_key);
    let max_retries = 3;
    let mut last_error = String::new();

    for attempt in 1..=max_retries {
        if attempt > 1 {
            let delay_ms = 1000 * 2u64.pow(attempt as u32 - 2); // 1s, 2s, 4s
            tracing::info!("AI request retry {}/{}, waiting {}ms", attempt, max_retries, delay_ms);
            tokio::time::sleep(Duration::from_millis(delay_ms)).await;
        }

        tracing::info!("AI request attempt {}/{}", attempt, max_retries);

        match client
            .post(&url)
            .header("Authorization", &auth_header)
            .header("Content-Type", "application/json")
            .json(&body)
            .send()
            .await
        {
            Ok(resp) => {
                let status = resp.status();
                if !status.is_success() {
                    let error_text = resp.text().await.unwrap_or_default();
                    tracing::error!("AI API error {}: {}", status, error_text);

                    // Don't retry on client errors (4xx) - only server errors (5xx) and network issues
                    if status.as_u16() < 500 {
                        return Err(format!("API error ({}): {}", status, error_text));
                    }
                    last_error = format!("API error ({}): {}", status, error_text);
                    continue;
                }

                let resp_json: serde_json::Value = resp
                    .json()
                    .await
                    .map_err(|e| format!("Failed to parse response: {}", e))?;

                // Extract the assistant's reply
                let answer = resp_json["choices"][0]["message"]["content"]
                    .as_str()
                    .unwrap_or("No response from AI")
                    .to_string();

                tracing::info!("AI chat response: {} chars", answer.len());
                return Ok(answer);
            }
            Err(e) => {
                let err_msg = format!("{}", e);
                tracing::warn!("AI request attempt {}/{} failed: {}", attempt, max_retries, err_msg);

                // Provide more specific error messages for common issues
                if err_msg.contains("dns") || err_msg.contains("DNS") {
                    last_error = format!("DNS resolution failed. Please check your network connection and the API URL: {}", url);
                } else if err_msg.contains("timeout") || err_msg.contains("Timeout") {
                    last_error = format!("Request timed out. The server may be slow or unreachable: {}", url);
                } else if err_msg.contains("certificate") || err_msg.contains("tls") || err_msg.contains("TLS") || err_msg.contains("SSL") {
                    last_error = format!("TLS/SSL error. Please check if the API URL uses HTTPS correctly: {} - Error: {}", url, err_msg);
                } else if err_msg.contains("connect") || err_msg.contains("Connect") {
                    last_error = format!("Connection failed. Please check your network and firewall settings: {} - Error: {}", url, err_msg);
                } else {
                    last_error = format!("Request failed: {} (URL: {})", err_msg, url);
                }

                // Don't retry on DNS or TLS errors - they won't resolve with retry
                if err_msg.contains("dns") || err_msg.contains("DNS") || 
                   err_msg.contains("certificate") || err_msg.contains("tls") || 
                   err_msg.contains("TLS") || err_msg.contains("SSL") {
                    break;
                }
            }
        }
    }

    Err(last_error)
}

/// Stream event payload sent to frontend via Tauri events
#[derive(Clone, Serialize)]
#[serde(tag = "type")]
pub enum AiStreamEvent {
    #[serde(rename = "chunk")]
    Chunk { content: String },
    #[serde(rename = "done")]
    Done,
    #[serde(rename = "error")]
    Error { message: String },
}

/// Streaming version of ai_chat - sends tokens via Tauri events as they arrive
#[tauri::command]
pub async fn ai_chat_stream(
    app_handle: AppHandle,
    request: AiChatRequest,
) -> Result<(), String> {
    use futures_util::StreamExt;

    // Build system prompt (same logic as ai_chat)
    let mut context_sections = String::new();

    if let Some(ref notes) = request.context_notes {
        if notes.len() > 1 {
            context_sections.push_str("The user has the following notes open. ");
            context_sections.push_str("Answer questions based on ALL the note content below. ");
            context_sections.push_str("When referencing information, mention which note it comes from.\n\n");
            for note in notes {
                context_sections.push_str(&format!(
                    "=== NOTE: {} ===\n{}\n=== END NOTE ===\n\n",
                    note.title, note.content
                ));
            }
        } else if let Some(note) = notes.first() {
            context_sections.push_str(&format!(
                "The user is currently viewing a note titled \"{}\". \
                 Answer questions based on the note content below.\n\n\
                 --- NOTE CONTENT ---\n{}\n--- END NOTE ---",
                note.title, note.content
            ));
        }
    } else {
        context_sections.push_str(&format!(
            "The user is currently viewing a note titled \"{}\". \
             Answer questions based on the note content below.\n\n\
             --- NOTE CONTENT ---\n{}\n--- END NOTE ---",
            request.note_title, request.note_content
        ));
    }

    let system_prompt = format!(
        "You are a helpful AI assistant embedded in a note-taking app. \
         If the question is not related to the notes, you may still help but mention that \
         the answer is not based on the current notes. \
         Respond in the same language as the user's question.\n\n{}",
        context_sections
    );

    let mut messages = Vec::new();
    messages.push(serde_json::json!({
        "role": "system",
        "content": system_prompt
    }));

    for msg in &request.history {
        messages.push(serde_json::json!({
            "role": msg.role,
            "content": msg.content
        }));
    }

    messages.push(serde_json::json!({
        "role": "user",
        "content": request.question
    }));

    // Build request body with stream: true
    let body = serde_json::json!({
        "model": request.model,
        "messages": messages,
        "temperature": 0.7,
        "max_tokens": 2048,
        "stream": true
    });

    // Build API URL
    let base_url = request.api_url.trim_end_matches('/').trim_end_matches("v1").trim_end_matches('/');
    let url = format!("{}/v1/chat/completions", base_url);

    tracing::info!("AI stream request: model={}, url={}", request.model, url);

    // Retry loop
    let client = get_http_client();
    let auth_header = format!("Bearer {}", request.api_key);
    let max_retries = 3;
    let mut last_error = String::new();

    for attempt in 1..=max_retries {
        if attempt > 1 {
            let delay_ms = 1000 * 2u64.pow(attempt as u32 - 2);
            tracing::info!("AI stream retry {}/{}, waiting {}ms", attempt, max_retries, delay_ms);
            tokio::time::sleep(Duration::from_millis(delay_ms)).await;
        }

        match client
            .post(&url)
            .header("Authorization", &auth_header)
            .header("Content-Type", "application/json")
            .json(&body)
            .send()
            .await
        {
            Ok(resp) => {
                let status = resp.status();
                if !status.is_success() {
                    let error_text = resp.text().await.unwrap_or_default();
                    tracing::error!("AI stream API error {}: {}", status, error_text);

                    if status.as_u16() < 500 {
                        let _ = app_handle.emit("ai-stream-event", AiStreamEvent::Error {
                            message: format!("API error ({}): {}", status, error_text),
                        });
                        return Err(format!("API error ({}): {}", status, error_text));
                    }
                    last_error = format!("API error ({}): {}", status, error_text);
                    continue;
                }

                // Process SSE stream
                let mut stream = resp.bytes_stream();
                let mut buffer = String::new();
                let mut full_content = String::new();

                while let Some(chunk_result) = stream.next().await {
                    match chunk_result {
                        Ok(bytes) => {
                            let text = String::from_utf8_lossy(&bytes);
                            buffer.push_str(&text);

                            // Process complete SSE lines
                            while let Some(line_end) = buffer.find('\n') {
                                let line = buffer[..line_end].trim().to_string();
                                buffer = buffer[line_end + 1..].to_string();

                                if line.is_empty() {
                                    continue;
                                }

                                if line.starts_with("data: ") {
                                    let data = &line[6..];

                                    // [DONE] signal
                                    if data.trim() == "[DONE]" {
                                        tracing::info!("AI stream completed: {} chars", full_content.len());
                                        let _ = app_handle.emit("ai-stream-event", AiStreamEvent::Done);
                                        return Ok(());
                                    }

                                    // Parse JSON chunk
                                    match serde_json::from_str::<serde_json::Value>(data) {
                                        Ok(chunk_json) => {
                                            if let Some(delta) = chunk_json.pointer("/choices/0/delta/content") {
                                                if let Some(content) = delta.as_str() {
                                                    if !content.is_empty() {
                                                        full_content.push_str(content);
                                                        let _ = app_handle.emit("ai-stream-event", AiStreamEvent::Chunk {
                                                            content: content.to_string(),
                                                        });
                                                    }
                                                }
                                            }
                                        }
                                        Err(e) => {
                                            tracing::warn!("Failed to parse SSE chunk: {} - data: {}", e, data);
                                        }
                                    }
                                }
                                // Ignore other SSE fields (event:, id:, retry:)
                            }
                        }
                        Err(e) => {
                            let err_msg = format!("{}", e);
                            tracing::error!("AI stream read error: {}", err_msg);
                            let _ = app_handle.emit("ai-stream-event", AiStreamEvent::Error {
                                message: format!("Stream interrupted: {}", err_msg),
                            });
                            return Err(format!("Stream error: {}", err_msg));
                        }
                    }
                }

                // Stream ended without [DONE] - treat as complete
                if !full_content.is_empty() {
                    tracing::info!("AI stream ended without [DONE], {} chars received", full_content.len());
                    let _ = app_handle.emit("ai-stream-event", AiStreamEvent::Done);
                    return Ok(());
                }

                last_error = "Stream ended with no content".to_string();
                break;
            }
            Err(e) => {
                let err_msg = format!("{}", e);
                tracing::warn!("AI stream attempt {}/{} failed: {}", attempt, max_retries, err_msg);

                if err_msg.contains("dns") || err_msg.contains("DNS") {
                    last_error = format!("DNS resolution failed: {}", url);
                } else if err_msg.contains("timeout") || err_msg.contains("Timeout") {
                    last_error = format!("Connection timed out: {}", url);
                } else if err_msg.contains("certificate") || err_msg.contains("tls") || err_msg.contains("TLS") || err_msg.contains("SSL") {
                    last_error = format!("TLS/SSL error: {} - {}", url, err_msg);
                } else if err_msg.contains("connect") || err_msg.contains("Connect") {
                    last_error = format!("Connection failed: {} - {}", url, err_msg);
                } else {
                    last_error = format!("Request failed: {} (URL: {})", err_msg, url);
                }

                if err_msg.contains("dns") || err_msg.contains("DNS") ||
                   err_msg.contains("certificate") || err_msg.contains("tls") ||
                   err_msg.contains("TLS") || err_msg.contains("SSL") {
                    break;
                }
            }
        }
    }

    let _ = app_handle.emit("ai-stream-event", AiStreamEvent::Error {
        message: last_error.clone(),
    });
    Err(last_error)
}

// ──────────────────────────────────────────────
// Sync Commands
// ──────────────────────────────────────────────

const SYNC_CONFIG_KEY: &str = "sync_config";

fn get_sync_config_from_db(db: &Database) -> sync_engine::sync_config::SyncConfig {
    db.get_config(SYNC_CONFIG_KEY)
        .ok()
        .flatten()
        .and_then(|json| sync_engine::sync_config::SyncConfig::from_json(&json).ok())
        .unwrap_or_default()
}

fn get_sync_states_map(db: &Database) -> std::collections::HashMap<String, sync_engine::SyncStateInfo> {
    db.get_all_sync_states()
        .ok()
        .unwrap_or_default()
        .into_iter()
        .map(|s| {
            (
                s.file_path.clone(),
                sync_engine::SyncStateInfo {
                    local_hash: s.local_hash,
                    remote_hash: s.remote_hash,
                    sync_status: s.sync_status,
                    version: s.version,
                },
            )
        })
        .collect()
}

fn persist_state_updates(db: &Database, updates: &[sync_engine::SyncStateUpdate]) {
    for update in updates {
        if update.delete {
            let _ = db.delete_sync_state(&update.file_path);
        } else {
            let _ = db.upsert_sync_state(&storage::schema::SyncState {
                file_path: update.file_path.clone(),
                local_hash: update.local_hash.clone(),
                remote_hash: update.remote_hash.clone(),
                sync_status: update.sync_status.clone(),
                last_synced: update.last_synced,
                remote_fid: update.remote_fid.clone(),
                version: update.version,
            });
        }
    }
}

/// Get sync configuration
#[tauri::command]
pub fn get_sync_config(state: State<'_, AppState>) -> Result<sync_engine::sync_config::SyncConfig, String> {
    let guard = state.note_service.lock().map_err(|e| e.to_string())?;
    let service = guard.as_ref().ok_or("Vault not initialized")?;
    Ok(get_sync_config_from_db(service.db()))
}

/// Set sync configuration
#[tauri::command]
pub fn set_sync_config(
    state: State<'_, AppState>,
    config: sync_engine::sync_config::SyncConfig,
) -> Result<(), String> {
    let guard = state.note_service.lock().map_err(|e| e.to_string())?;
    let service = guard.as_ref().ok_or("Vault not initialized")?;
    let json = config.to_json().map_err(|e| format!("Serialize config failed: {}", e))?;
    service.db().set_config(SYNC_CONFIG_KEY, &json).map_err(|e| e.to_string())
}

/// Configure sync target directory (legacy - now updates SyncConfig)
#[tauri::command]
pub async fn configure_sync(
    state: State<'_, AppState>,
    sync_target: String,
) -> Result<sync_engine::SyncStatus, String> {
    {
        let guard = state.note_service.lock().map_err(|e| e.to_string())?;
        let service = guard.as_ref().ok_or("Vault not initialized")?;

        let target = PathBuf::from(&sync_target);
        if !target.exists() {
            std::fs::create_dir_all(&target).map_err(|e| format!("Failed to create sync dir: {}", e))?;
        }

        // Update config in DB
        let mut config = get_sync_config_from_db(service.db());
        config.sync_target = sync_target.clone();
        let json = config.to_json().map_err(|e| e.to_string())?;
        service.db().set_config(SYNC_CONFIG_KEY, &json).map_err(|e| e.to_string())?;
    }

    Ok(sync_engine::SyncStatus {
        is_syncing: false,
        last_sync: None,
        last_result: None,
        pending_changes: 0,
        sync_dir: Some(sync_target),
    })
}

/// Run sync operation
#[tauri::command]
pub async fn run_sync(
    state: State<'_, AppState>,
) -> Result<sync_engine::SyncResult, String> {
    // 1. Read config and sync states while holding lock
    let (vault_path, config, sync_states) = {
        let guard = state.note_service.lock().map_err(|e| e.to_string())?;
        let service = guard.as_ref().ok_or("Vault not initialized")?;
        let config = get_sync_config_from_db(service.db());
        let sync_states = get_sync_states_map(service.db());
        (service.vault_path().to_path_buf(), config, sync_states)
    };

    if config.sync_target.is_empty() {
        return Err("Sync target not configured".to_string());
    }

    // 2. Run async sync (no lock held)
    let target = PathBuf::from(&config.sync_target);
    let adapter = sync_engine::local_adapter::LocalSyncAdapter::new(target);
    let strategy = sync_engine::ConflictStrategy::from_str(&config.conflict_strategy);
    let engine = sync_engine::SyncEngine::new(vault_path, Box::new(adapter), strategy, config);

    let result = engine.sync(&sync_states).await.map_err(|e| format!("Sync failed: {}", e))?;

    // 3. Persist state updates
    {
        let guard = state.note_service.lock().map_err(|e| e.to_string())?;
        let service = guard.as_ref().ok_or("Vault not initialized")?;
        persist_state_updates(service.db(), &result.state_updates);
    }

    Ok(result)
}

/// Get sync changes (dry run - just detect changes)
#[tauri::command]
pub async fn get_sync_changes(
    state: State<'_, AppState>,
) -> Result<Vec<sync_engine::FileChange>, String> {
    let (vault_path, config, sync_states) = {
        let guard = state.note_service.lock().map_err(|e| e.to_string())?;
        let service = guard.as_ref().ok_or("Vault not initialized")?;
        let config = get_sync_config_from_db(service.db());
        let sync_states = get_sync_states_map(service.db());
        (service.vault_path().to_path_buf(), config, sync_states)
    };

    if config.sync_target.is_empty() {
        return Ok(Vec::new());
    }

    let target = PathBuf::from(&config.sync_target);
    if !target.exists() {
        return Ok(Vec::new());
    }

    let local_files = sync_engine::ChangeDetector::scan_local(&vault_path, &config)
        .map_err(|e| format!("Scan local failed: {}", e))?;

    let adapter = sync_engine::local_adapter::LocalSyncAdapter::new(target);
    let remote_metas = adapter.list_remote_files().await
        .map_err(|e| format!("List remote failed: {}", e))?;
    let remote_files: std::collections::HashMap<String, sync_engine::FileMeta> = remote_metas
        .into_iter()
        .map(|m| (m.relative_path.clone(), m))
        .collect();

    Ok(sync_engine::ChangeDetector::detect_changes_with_state(&local_files, &remote_files, &sync_states))
}

/// Full pull: download all remote files to local
#[tauri::command]
pub async fn full_pull(
    state: State<'_, AppState>,
) -> Result<sync_engine::SyncResult, String> {
    // 1. Read config and sync states
    let (vault_path, config, sync_states) = {
        let guard = state.note_service.lock().map_err(|e| e.to_string())?;
        let service = guard.as_ref().ok_or("Vault not initialized")?;
        let config = get_sync_config_from_db(service.db());
        let sync_states = get_sync_states_map(service.db());
        (service.vault_path().to_path_buf(), config, sync_states)
    };

    if config.sync_target.is_empty() {
        return Err("Sync target not configured".to_string());
    }

    // 2. Run full pull
    let target = PathBuf::from(&config.sync_target);
    let adapter = sync_engine::local_adapter::LocalSyncAdapter::new(target);
    let strategy = sync_engine::ConflictStrategy::from_str(&config.conflict_strategy);
    let engine = sync_engine::SyncEngine::new(vault_path, Box::new(adapter), strategy, config);

    let result = engine.full_pull(&sync_states).await.map_err(|e| format!("Full pull failed: {}", e))?;

    // 3. Persist state updates
    {
        let guard = state.note_service.lock().map_err(|e| e.to_string())?;
        let service = guard.as_ref().ok_or("Vault not initialized")?;
        persist_state_updates(service.db(), &result.state_updates);
    }

    Ok(result)
}

/// Get sync status from database
#[tauri::command]
pub fn get_sync_status(state: State<'_, AppState>) -> Result<serde_json::Value, String> {
    let guard = state.note_service.lock().map_err(|e| e.to_string())?;
    let service = guard.as_ref().ok_or("Vault not initialized")?;
    let db = service.db();

    let config = get_sync_config_from_db(db);
    let pending = db.get_pending_sync_states().map_err(|e| e.to_string())?;
    let last_sync = db.get_config("last_sync_time").ok().flatten();

    Ok(serde_json::json!({
        "syncTarget": config.sync_target,
        "autoSyncEnabled": config.auto_sync_enabled,
        "autoSyncInterval": config.auto_sync_interval_minutes,
        "pendingChanges": pending.len(),
        "lastSync": last_sync,
    }))
}

// ──────────────────────────────────────────────
// Search Commands
// ──────────────────────────────────────────────

/// Search notes using full-text search
#[tauri::command]
pub fn search_notes(
    state: State<'_, AppState>,
    query: String,
    limit: Option<usize>,
) -> Result<Vec<note_core::SearchResult>, String> {
    let guard = state.note_service.lock().map_err(|e| e.to_string())?;
    let svc = guard.as_ref().ok_or("Vault not initialized")?;
    
    let limit = limit.unwrap_or(20);
    
    // Get search engine from state
    let search_engine = state.search_engine.lock().map_err(|e| e.to_string())?;
    let engine = search_engine.as_ref().ok_or("Search engine not initialized")?;
    
    svc.search_notes(&query, limit, engine).map_err(|e| e.to_string())
}

/// Initialize search index (reindex all notes)
#[tauri::command]
pub fn init_search_index(
    state: State<'_, AppState>,
) -> Result<usize, String> {
    let guard = state.note_service.lock().map_err(|e| e.to_string())?;
    let svc = guard.as_ref().ok_or("Vault not initialized")?;

    // Get search engine from state
    let search_engine = state.search_engine.lock().map_err(|e| e.to_string())?;
    let engine = search_engine.as_ref().ok_or("Search engine not initialized")?;

    svc.index_all_notes_for_search(engine).map_err(|e| e.to_string())?;

    Ok(engine.doc_count() as usize)
}

/// Update search index for a single note
#[tauri::command]
pub fn update_search_index_for_note(
    state: State<'_, AppState>,
    note_id: String,
) -> Result<(), String> {
    let guard = state.note_service.lock().map_err(|e| e.to_string())?;
    let svc = guard.as_ref().ok_or("Vault not initialized")?;

    let search_engine = state.search_engine.lock().map_err(|e| e.to_string())?;
    let engine = search_engine.as_ref().ok_or("Search engine not initialized")?;

    svc.index_note_for_search(&note_id, engine).map_err(|e| e.to_string())
}

// ──────────────────────────────────────────────
// Backlinks Commands
// ──────────────────────────────────────────────

/// Backlink info for a note
#[derive(Debug, Serialize, Deserialize)]
pub struct BacklinkInfo {
    pub note_id: String,
    pub note_title: String,
    pub note_path: String,
    pub context: String,
}

/// Get backlinks for a specific note
#[tauri::command]
pub fn get_backlinks(
    state: State<'_, AppState>,
    note_id: String,
) -> Result<Vec<BacklinkInfo>, String> {
    let guard = state.note_service.lock().map_err(|e| e.to_string())?;
    let svc = guard.as_ref().ok_or("Vault not initialized")?;

    let backlinks_with_ctx = svc.db().get_backlinks_with_context(&note_id).map_err(|e| e.to_string())?;

    let mut backlinks = Vec::new();
    for (source_id, context) in backlinks_with_ctx {
        if let Some(note) = svc.db().get_note(&source_id).map_err(|e| e.to_string())? {
            backlinks.push(BacklinkInfo {
                note_id: note.id,
                note_title: note.title,
                note_path: note.path,
                context: context.unwrap_or_default(),
            });
        }
    }

    Ok(backlinks)
}

// ──────────────────────────────────────────────
// Error Reporting Commands
// ──────────────────────────────────────────────

/// Report a frontend error to the backend logging system
#[tauri::command]
pub fn report_error(
    error_type: String,
    message: String,
    stack: Option<String>,
    context: Option<String>,
    source: Option<String>,
) -> Result<(), String> {
    let timestamp = chrono::Utc::now().to_rfc3339();
    let source = source.unwrap_or_else(|| "frontend".to_string());
    let stack = stack.unwrap_or_default();
    let context = context.unwrap_or_default();

    tracing::error!(
        timestamp = %timestamp,
        source = %source,
        error_type = %error_type,
        message = %message,
        stack = %stack,
        context = %context,
        "Frontend error reported"
    );

    Ok(())
}
