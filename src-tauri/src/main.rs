#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;

use std::sync::Mutex;

pub struct AppState {
    pub note_service: Mutex<Option<note_core::NoteService>>,
    pub search_engine: Mutex<Option<note_core::SearchEngine>>,
}

fn main() {
    // Initialize file logging with daily rotation
    let log_dir = dirs::data_dir()
        .unwrap_or_else(|| std::path::PathBuf::from("."))
        .join("mini-obsidian")
        .join("logs");
    
    let file_appender = tracing_appender::rolling::daily(&log_dir, "mini-obsidian.log");
    let (non_blocking, _guard) = tracing_appender::non_blocking(file_appender);
    
    // Log to both file and console
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::from_default_env()
                .add_directive("mini_obsidian=debug".parse().unwrap()),
        )
        .with_target(true)
        .with_thread_ids(true)
        .with_file(true)
        .with_line_number(true)
        .with_writer(non_blocking)
        .init();

    tracing::info!("MiniObsidian starting up, logs directory: {}", log_dir.display());

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .manage(AppState {
            note_service: Mutex::new(None),
            search_engine: Mutex::new(None),
        })
        .invoke_handler(tauri::generate_handler![
            commands::init_vault,
            commands::get_vault_path,
            commands::create_note,
            commands::read_note,
            commands::read_note_by_path,
            commands::update_note,
            commands::delete_note,
            commands::list_notes,
            commands::list_folders,
            commands::list_files,
            commands::create_folder,
            commands::delete_folder,
            commands::rename_note,
            commands::move_note,
            commands::scan_vault,
            commands::get_graph_data,
            commands::create_daily_note,
            commands::show_in_folder,
            commands::save_attachment,
            commands::read_attachment,
            commands::read_file_base64,
            commands::ai_chat,
            commands::ai_chat_stream,
            commands::configure_sync,
            commands::run_sync,
            commands::get_sync_changes,
            commands::search_notes,
            commands::init_search_index,
            commands::update_search_index_for_note,
            commands::get_backlinks,
            commands::report_error,
        ])
        .setup(|_app| {
            tracing::info!("MiniObsidian setup complete");
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
