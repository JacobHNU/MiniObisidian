use crate::AppState;
use note_core::{service::FileInfo, service::GraphData, NoteService};
use serde::{Deserialize, Serialize};
use storage::schema::NoteMeta;
use storage::Database;
use sync_engine::SyncAdapter;
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

/// Delete a folder
#[tauri::command]
pub fn delete_folder(
    state: State<'_, AppState>,
    folder_path: String,
) -> Result<(), String> {
    let guard = state.note_service.lock().unwrap();
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
    date: Option<String>,
) -> Result<NoteMeta, String> {
    let guard = state.note_service.lock().unwrap();
    let svc = guard.as_ref().ok_or("Vault not initialized")?;
    svc.create_daily_note_for_date(date.as_deref()).map_err(|e| e.to_string())
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
    let vault_path = svc.vault_path();
    let abs_path = vault_path.join(clean_path);

    // Create log file in current directory
    let log_path = std::env::current_dir().unwrap_or_default().join("show_in_folder_debug.log");
    let mut log_content = String::new();
    log_content.push_str(&format!("=== show_in_folder DEBUG ===\n"));
    log_content.push_str(&format!("Time: {}\n", chrono::Utc::now().to_rfc3339()));
    log_content.push_str(&format!("Input note_path: {}\n", note_path));
    log_content.push_str(&format!("Clean path: {}\n", clean_path));
    log_content.push_str(&format!("Vault path: {}\n", vault_path.display()));
    log_content.push_str(&format!("Absolute path: {}\n", abs_path.display()));
    log_content.push_str(&format!("Vault path exists: {}\n", vault_path.exists()));
    log_content.push_str(&format!("Absolute path exists: {}\n", abs_path.exists()));
    log_content.push_str(&format!("Absolute path is_dir: {}\n", abs_path.is_dir()));

    // Find the correct target path
    let target_path = if abs_path.is_dir() {
        // Directory exists - open it
        log_content.push_str("Target: Directory exists, opening it\n");
        abs_path.clone()
    } else if abs_path.exists() {
        // File exists - get its parent
        log_content.push_str("Target: File exists, opening parent\n");
        abs_path.parent().unwrap_or(&abs_path).to_path_buf()
    } else {
        // Path doesn't exist - find closest existing parent
        log_content.push_str("Target: Path doesn't exist, finding closest parent\n");
        let mut current = abs_path.clone();
        let mut found = false;
        
        while let Some(parent) = current.parent() {
            log_content.push_str(&format!("Checking parent: {}\n", parent.display()));
            if parent.exists() && parent.is_dir() {
                log_content.push_str(&format!("Found existing parent: {}\n", parent.display()));
                found = true;
                break;
            }
            current = parent.to_path_buf();
        }
        
        if found {
            current
        } else {
            log_content.push_str(&format!("No existing parent found, using vault root: {}\n", vault_path.display()));
            vault_path.to_path_buf()
        }
    };

    log_content.push_str(&format!("Final target path: {}\n", target_path.display()));

    // Write log to file
    let _ = std::fs::write(&log_path, &log_content);
    tracing::info!("Log written to: {}", log_path.display());

    // Open in file explorer
    #[cfg(target_os = "windows")]
    {
        // Convert all forward slashes to backslashes for Windows
        let path_str = target_path.to_string_lossy().to_string().replace('/', "\\");
        log_content.push_str(&format!("Opening explorer at: {}\n", path_str));
        
        // Use explorer with the normalized path
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

    // Update log with final action
    let _ = std::fs::write(&log_path, &log_content);

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

    // Build API URL
    let url = format!("{}/chat/completions", request.api_url.trim_end_matches('/'));

    tracing::info!("AI chat request: model={}, url={}", request.model, url);

    // Send request
    let client = reqwest::Client::new();
    let resp = client
        .post(&url)
        .header("Authorization", format!("Bearer {}", request.api_key))
        .header("Content-Type", "application/json")
        .json(&body)
        .timeout(std::time::Duration::from_secs(60))
        .send()
        .await
        .map_err(|e| format!("Request failed: {}", e))?;

    let status = resp.status();
    if !status.is_success() {
        let error_text = resp.text().await.unwrap_or_default();
        tracing::error!("AI API error {}: {}", status, error_text);
        return Err(format!("API error ({}): {}", status, error_text));
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
    Ok(answer)
}

// ──────────────────────────────────────────────
// Sync Commands
// ──────────────────────────────────────────────

/// Configure sync target directory
#[tauri::command]
pub async fn configure_sync(
    state: State<'_, AppState>,
    sync_target: String,
) -> Result<sync_engine::SyncStatus, String> {
    let vault_path = {
        let service_guard = state.note_service.lock().map_err(|e| e.to_string())?;
        let service = service_guard.as_ref().ok_or("Vault not initialized")?;
        service.vault_path().to_path_buf()
    };

    let target = PathBuf::from(&sync_target);
    if !target.exists() {
        std::fs::create_dir_all(&target).map_err(|e| format!("Failed to create sync dir: {}", e))?;
    }

    let adapter = sync_engine::local_adapter::LocalSyncAdapter::new(target);
    let engine = sync_engine::SyncEngine::new(
        vault_path,
        Box::new(adapter),
        sync_engine::ConflictStrategy::KeepNewer,
    );

    let status = engine.status();
    Ok(status)
}

/// Run sync operation
#[tauri::command]
pub async fn run_sync(
    state: State<'_, AppState>,
    sync_target: String,
) -> Result<sync_engine::SyncResult, String> {
    let vault_path = {
        let service_guard = state.note_service.lock().map_err(|e| e.to_string())?;
        let service = service_guard.as_ref().ok_or("Vault not initialized")?;
        service.vault_path().to_path_buf()
    };

    let target = PathBuf::from(&sync_target);
    let adapter = sync_engine::local_adapter::LocalSyncAdapter::new(target);
    let mut engine = sync_engine::SyncEngine::new(
        vault_path,
        Box::new(adapter),
        sync_engine::ConflictStrategy::KeepNewer,
    );

    engine.sync().await.map_err(|e| format!("Sync failed: {}", e))
}

/// Get sync status (dry run - just detect changes)
#[tauri::command]
pub async fn get_sync_changes(
    state: State<'_, AppState>,
    sync_target: String,
) -> Result<Vec<sync_engine::FileChange>, String> {
    let vault_path = {
        let service_guard = state.note_service.lock().map_err(|e| e.to_string())?;
        let service = service_guard.as_ref().ok_or("Vault not initialized")?;
        service.vault_path().to_path_buf()
    };

    let target = PathBuf::from(&sync_target);
    if !target.exists() {
        return Ok(Vec::new());
    }

    let local_files = sync_engine::ChangeDetector::scan_local(&vault_path)
        .map_err(|e| format!("Scan local failed: {}", e))?;

    let adapter = sync_engine::local_adapter::LocalSyncAdapter::new(target);
    let remote_metas = adapter.list_remote_files().await
        .map_err(|e| format!("List remote failed: {}", e))?;
    let remote_files: std::collections::HashMap<String, sync_engine::FileMeta> = remote_metas
        .into_iter()
        .map(|m| (m.relative_path.clone(), m))
        .collect();

    Ok(sync_engine::ChangeDetector::detect_changes(&local_files, &remote_files))
}
