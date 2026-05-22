use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::{Arc, Mutex};
use std::thread;

use base64::{engine::general_purpose::STANDARD as B64, Engine as _};
use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};
use serde::Serialize;
use tauri::{AppHandle, Emitter, State};
use uuid::Uuid;

use crate::hooks::HookConfig;

pub struct PtySession {
    writer: Arc<Mutex<Box<dyn Write + Send>>>,
    master: Arc<Mutex<Box<dyn MasterPty + Send>>>,
    child: Mutex<Box<dyn Child + Send + Sync>>,
}

impl Drop for PtySession {
    fn drop(&mut self) {
        if let Ok(mut child) = self.child.lock() {
            let _ = child.kill();
        }
    }
}

#[derive(Default)]
pub struct PtyManager {
    sessions: Mutex<HashMap<String, Arc<PtySession>>>,
}

#[derive(Serialize, Clone)]
pub struct SessionInfo {
    pub id: String,
    pub cols: u16,
    pub rows: u16,
}

#[tauri::command]
pub fn spawn_session(
    app: AppHandle,
    state: State<PtyManager>,
    hooks: State<HookConfig>,
    cwd: Option<String>,
    cols: Option<u16>,
    rows: Option<u16>,
    cmd: Option<String>,
) -> Result<SessionInfo, String> {
    let cols = cols.unwrap_or(140);
    let rows = rows.unwrap_or(36);

    let pty_system = native_pty_system();
    let pair = pty_system
        .openpty(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| format!("openpty failed: {e}"))?;

    let id = Uuid::new_v4().to_string();

    let cmd_str = cmd.unwrap_or_else(|| "claude".to_string());
    let mut command = CommandBuilder::new(&cmd_str);
    // Inherit the parent process env so child processes (e.g. `claude`) see
    // HOME, PATH, USER, LANG, etc. portable-pty's CommandBuilder starts with
    // an empty env by default — without this, claude can't find ~/.claude
    // and falls back to a different startup UI than the user's terminal.
    // TERM is set last so it overrides whatever the parent had.
    for (k, v) in std::env::vars() {
        command.env(k, v);
    }
    command.env("TERM", "xterm-256color");
    // Status detection: claude hooks read these to curl back to our local
    // receiver. When unset (claude run outside en), the hook command no-ops.
    // (Removed CLAUDE_CODE_SIMPLE=1 — it suppressed the banner but also
    // disabled the hooks system entirely, breaking status detection.)
    command.env("EN_HUB_SESSION_ID", &id);
    command.env(
        "EN_HUB_HOOK_URL",
        format!("http://127.0.0.1:{}/hook", hooks.port),
    );
    let cwd_resolved = cwd
        .filter(|s| !s.is_empty())
        .or_else(|| std::env::var("HOME").ok())
        .unwrap_or_else(|| ".".to_string());
    command.cwd(cwd_resolved);

    let child = pair
        .slave
        .spawn_command(command)
        .map_err(|e| format!("spawn '{cmd_str}' failed: {e}"))?;
    drop(pair.slave);

    let master_box: Box<dyn MasterPty + Send> = pair.master;
    let reader = master_box
        .try_clone_reader()
        .map_err(|e| format!("clone_reader failed: {e}"))?;
    let writer = master_box
        .take_writer()
        .map_err(|e| format!("take_writer failed: {e}"))?;

    let id_for_thread = id.clone();
    let app_for_thread = app.clone();

    thread::spawn(move || {
        let mut reader = reader;
        let mut buf = [0u8; 8192];
        let data_event = format!("pty:{}", id_for_thread);
        let exit_event = format!("pty-exit:{}", id_for_thread);
        loop {
            match reader.read(&mut buf) {
                Ok(0) => break,
                Ok(n) => {
                    let chunk = B64.encode(&buf[..n]);
                    if app_for_thread.emit(&data_event, chunk).is_err() {
                        break;
                    }
                }
                Err(_) => break,
            }
        }
        let _ = app_for_thread.emit(&exit_event, ());
    });

    let session = Arc::new(PtySession {
        writer: Arc::new(Mutex::new(writer)),
        master: Arc::new(Mutex::new(master_box)),
        child: Mutex::new(child),
    });

    state
        .sessions
        .lock()
        .unwrap()
        .insert(id.clone(), session);

    Ok(SessionInfo { id, cols, rows })
}

#[tauri::command]
pub fn send_input(
    state: State<PtyManager>,
    id: String,
    data: String,
) -> Result<(), String> {
    let writer = {
        let map = state.sessions.lock().unwrap();
        map.get(&id).map(|s| s.writer.clone())
    };
    let writer = writer.ok_or_else(|| format!("no such session: {id}"))?;
    let result = writer
        .lock()
        .unwrap()
        .write_all(data.as_bytes())
        .map_err(|e| e.to_string());
    result
}

#[tauri::command]
pub fn resize_session(
    state: State<PtyManager>,
    id: String,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    let master = {
        let map = state.sessions.lock().unwrap();
        map.get(&id).map(|s| s.master.clone())
    };
    let master = master.ok_or_else(|| format!("no such session: {id}"))?;
    let result = master
        .lock()
        .unwrap()
        .resize(PtySize {
            cols,
            rows,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| e.to_string());
    result
}

#[tauri::command]
pub fn kill_session(state: State<PtyManager>, id: String) -> Result<(), String> {
    let removed = state.sessions.lock().unwrap().remove(&id);
    drop(removed);
    Ok(())
}
