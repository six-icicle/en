mod appearance;
mod hooks;
mod pty;

use pty::{kill_session, resize_session, send_input, spawn_session, PtyManager};
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .manage(PtyManager::default())
        .setup(|app| {
            // Run before any JS executes so tauri-plugin-store can't
            // observe (and later overwrite) a corrupt file.
            appearance::quarantine_if_corrupt(app.handle());

            let cfg = hooks::start(app.handle().clone())?;
            eprintln!("[en-hooks] receiver listening on 127.0.0.1:{}", cfg.port);
            app.manage(cfg);
            match hooks::install_hooks() {
                Ok(true) => eprintln!("[en-hooks] installed hook block into ~/.claude/settings.json"),
                Ok(false) => eprintln!("[en-hooks] hook block already present (no changes)"),
                Err(e) => eprintln!("[en-hooks] WARN install failed: {e}"),
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            spawn_session,
            send_input,
            resize_session,
            kill_session,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
