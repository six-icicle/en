mod pty;

use pty::{kill_session, resize_session, send_input, spawn_session, PtyManager};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .manage(PtyManager::default())
        .invoke_handler(tauri::generate_handler![
            spawn_session,
            send_input,
            resize_session,
            kill_session,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
