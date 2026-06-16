use crate::AppState;
use note_core::{service::FileInfo, service::GraphData, NoteService};
use serde::{Deserialize, Serialize};
use storage::schema::NoteMeta;
use storage::Database;
use tauri::State;
use std::path::PathBuf;

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
    let service = NoteService::new(path, db).map_err(|e| e.to_string())?;

    // Auto-scan the vault on init
    let notes = service.scan_vault().map_err(|e| e.to_string())?;
    let count = notes.len();

    let mut guard = state.note_service.lock().unwrap();
    *guard = Some(service);

    Ok(VaultInfo {
        path: vault_path,
        note_count: count,
    })
}

/// Get current vault path
#[tauri::command]
pub fn get_vault_path(state: State<'_, AppState>) -> Result<Option<String>, String> {
    let guard = state.note_service.lock().unwrap();
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
    let guard = state.note_service.lock().unwrap();
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
    let guard = state.note_service.lock().unwrap();
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
    let guard = state.note_service.lock().unwrap();
    let svc = guard.as_ref().ok_or("Vault not initialized")?;
    svc.read_note_by_path(&path).map_err(|e| e.to_string())
}

/// Update a note's content
#[tauri::command]
pub fn update_note(
    state: State<'_, AppState>,
    note_id: String,
    content: String,
) -> Result<NoteMeta, String> {
    let guard = state.note_service.lock().unwrap();
    let svc = guard.as_ref().ok_or("Vault not initialized")?;
    svc.update_note(&note_id, &content).map_err(|e| e.to_string())
}

/// Delete a note
#[tauri::command]
pub fn delete_note(
    state: State<'_, AppState>,
    note_id: String,
) -> Result<(), String> {
    let guard = state.note_service.lock().unwrap();
    let svc = guard.as_ref().ok_or("Vault not initialized")?;
    svc.delete_note(&note_id).map_err(|e| e.to_string())
}

/// List all notes
#[tauri::command]
pub fn list_notes(
    state: State<'_, AppState>,
) -> Result<Vec<NoteMeta>, String> {
    let guard = state.note_service.lock().unwrap();
    let svc = guard.as_ref().ok_or("Vault not initialized")?;
    svc.list_notes().map_err(|e| e.to_string())
}

/// List all folders
#[tauri::command]
pub fn list_folders(
    state: State<'_, AppState>,
) -> Result<Vec<String>, String> {
    let guard = state.note_service.lock().unwrap();
    let svc = guard.as_ref().ok_or("Vault not initialized")?;
    svc.list_folders().map_err(|e| e.to_string())
}

/// List files in a folder
#[tauri::command]
pub fn list_files(
    state: State<'_, AppState>,
    folder: String,
) -> Result<Vec<FileInfo>, String> {
    let guard = state.note_service.lock().unwrap();
    let svc = guard.as_ref().ok_or("Vault not initialized")?;
    svc.list_files_in_folder(&folder).map_err(|e| e.to_string())
}

/// Create a new folder
#[tauri::command]
pub fn create_folder(
    state: State<'_, AppState>,
    folder_path: String,
) -> Result<(), String> {
    let guard = state.note_service.lock().unwrap();
    let svc = guard.as_ref().ok_or("Vault not initialized")?;
    svc.create_folder(&folder_path).map_err(|e| e.to_string())
}

/// Rename a note
#[tauri::command]
pub fn rename_note(
    state: State<'_, AppState>,
    note_id: String,
    new_title: String,
) -> Result<NoteMeta, String> {
    let guard = state.note_service.lock().unwrap();
    let svc = guard.as_ref().ok_or("Vault not initialized")?;
    svc.rename_note(&note_id, &new_title).map_err(|e| e.to_string())
}

/// Move a note to a different folder
#[tauri::command]
pub fn move_note(
    state: State<'_, AppState>,
    note_id: String,
    target_folder: String,
) -> Result<NoteMeta, String> {
    let guard = state.note_service.lock().unwrap();
    let svc = guard.as_ref().ok_or("Vault not initialized")?;
    svc.move_note(&note_id, &target_folder)
        .map_err(|e| e.to_string())
}

/// Scan vault and index all notes
#[tauri::command]
pub fn scan_vault(
    state: State<'_, AppState>,
) -> Result<Vec<NoteMeta>, String> {
    let guard = state.note_service.lock().unwrap();
    let svc = guard.as_ref().ok_or("Vault not initialized")?;
    svc.scan_vault().map_err(|e| e.to_string())
}

/// Get graph data for knowledge graph visualization
#[tauri::command]
pub fn get_graph_data(
    state: State<'_, AppState>,
) -> Result<GraphData, String> {
    let guard = state.note_service.lock().unwrap();
    let svc = guard.as_ref().ok_or("Vault not initialized")?;
    svc.get_graph_data().map_err(|e| e.to_string())
}

/// Create or open today's daily note
#[tauri::command]
pub fn create_daily_note(
    state: State<'_, AppState>,
) -> Result<NoteMeta, String> {
    let guard = state.note_service.lock().unwrap();
    let svc = guard.as_ref().ok_or("Vault not initialized")?;
    svc.create_daily_note().map_err(|e| e.to_string())
}

/// Open file explorer showing the given note file or folder
#[tauri::command]
pub fn show_in_folder(
    state: State<'_, AppState>,
    note_path: String,
) -> Result<(), String> {
    let guard = state.note_service.lock().unwrap();
    let svc = guard.as_ref().ok_or("Vault not initialized")?;
    let clean_path = note_path.trim_end_matches('/');
    let abs_path = svc.vault_path().join(clean_path);

    if abs_path.is_dir() {
        // Open the directory itself
        #[cfg(target_os = "windows")]
        { std::process::Command::new("explorer").arg(&abs_path).spawn().map_err(|e| e.to_string())?; }
        #[cfg(target_os = "macos")]
        { std::process::Command::new("open").arg(&abs_path).spawn().map_err(|e| e.to_string())?; }
        #[cfg(target_os = "linux")]
        { std::process::Command::new("xdg-open").arg(&abs_path).spawn().map_err(|e| e.to_string())?; }
    } else {
        // Select the file in its parent directory
        #[cfg(target_os = "windows")]
        { std::process::Command::new("explorer").args(["/select,", &abs_path.to_string_lossy()]).spawn().map_err(|e| e.to_string())?; }
        #[cfg(target_os = "macos")]
        { std::process::Command::new("open").args(["-R", &abs_path.to_string_lossy()]).spawn().map_err(|e| e.to_string())?; }
        #[cfg(target_os = "linux")]
        { std::process::Command::new("xdg-open").arg(abs_path.parent().unwrap_or(&abs_path)).spawn().map_err(|e| e.to_string())?; }
    }

    Ok(())
}

/// Save a base64-encoded image to the vault's attachments folder
#[tauri::command]
pub fn save_attachment(
    state: State<'_, AppState>,
    filename: String,
    data_base64: String,
) -> Result<String, String> {
    use base64::Engine;

    let guard = state.note_service.lock().unwrap();
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

    let file_path = attachments_dir.join(&filename);
    std::fs::write(&file_path, &bytes).map_err(|e| e.to_string())?;

    tracing::info!("Saved attachment: {} ({} bytes)", file_path.display(), bytes.len());

    // Return the relative path (short string, no issues with IPC)
    Ok(format!("attachments/{}", filename))
}

/// Read an attachment file and return it as a base64 data URI
/// This is used by the frontend to display images in the preview
#[tauri::command]
pub fn read_attachment(
    state: State<'_, AppState>,
    relative_path: String,
) -> Result<String, String> {
    use base64::Engine;

    let guard = state.note_service.lock().unwrap();
    let svc = guard.as_ref().ok_or("Vault not initialized")?;

    let file_path = svc.vault_path().join(&relative_path);
    if !file_path.exists() {
        return Err(format!("Attachment not found: {}", relative_path));
    }

    let bytes = std::fs::read(&file_path).map_err(|e| e.to_string())?;

    // Determine MIME type from extension
    let mime = match file_path.extension().and_then(|e| e.to_str()) {
        Some("png") => "image/png",
        Some("jpg") | Some("jpeg") => "image/jpeg",
        Some("gif") => "image/gif",
        Some("webp") => "image/webp",
        Some("svg") => "image/svg+xml",
        Some("bmp") => "image/bmp",
        _ => "application/octet-stream",
    };

    let b64 = base64::engine::general_purpose::STANDARD.encode(&bytes);
    Ok(format!("data:{};base64,{}", mime, b64))
}

#[derive(Debug, Serialize, Deserialize)]
pub struct NoteContent {
    pub title: String,
    pub body: String,
    pub tags: Vec<String>,
    pub raw: String,
}
