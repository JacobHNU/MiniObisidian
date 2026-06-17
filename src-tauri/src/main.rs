#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;

use std::sync::Mutex;

pub struct AppState {
    pub note_service: Mutex<Option<note_core::NoteService>>,
}

fn main() {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::from_default_env()
                .add_directive("mini_obsidian=debug".parse().unwrap()),
        )
        .init();

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .manage(AppState {
            note_service: Mutex::new(None),
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
            commands::ai_chat,
            commands::configure_sync,
            commands::run_sync,
            commands::get_sync_changes,
        ])
        .setup(|_app| {
            tracing::info!("MiniObsidian starting up");
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
