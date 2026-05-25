use std::fs::OpenOptions;
use std::path::PathBuf;
use std::thread;
use std::time::{SystemTime, UNIX_EPOCH};

use fs2::FileExt;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter};
use tiny_http::{Header, Method, Response, Server, StatusCode};

use crate::env::{EN_HUB_HOOK_URL, EN_HUB_SESSION_ID, HOOK_URL_PATH};
use crate::events::TILE_STATUS_EVENT_PREFIX;

const HOOK_MARKER: &str = "# en-managed";

// Single source of truth for the Claude lifecycle events en cares about
// and the tile status each one drives. install_hooks installs every
// event in this table; status_for reads from it. Adding a new event is
// one row.
const HOOKS: &[(&str, &str)] = &[
    ("SessionStart",     "idle"),
    ("UserPromptSubmit", "working"),
    ("Stop",             "needs"),
    ("Notification",     "needs"),
];

#[derive(Clone)]
pub struct HookConfig {
    pub port: u16,
}

#[derive(Deserialize)]
struct HookPayload {
    session_id: String,
    event: String,
}

#[derive(Serialize, Clone)]
struct TileStatusEvent {
    status: &'static str,
    event: String,
}

pub fn start(app: AppHandle) -> Result<HookConfig, String> {
    let server = Server::http("127.0.0.1:0")
        .map_err(|e| format!("hook receiver bind failed: {e}"))?;
    let port = server
        .server_addr()
        .to_ip()
        .map(|sa| sa.port())
        .ok_or_else(|| "hook receiver could not resolve bound port".to_string())?;

    thread::spawn(move || serve(server, app));

    Ok(HookConfig { port })
}

fn serve(server: Server, app: AppHandle) {
    for mut req in server.incoming_requests() {
        if req.method() != &Method::Post || req.url() != HOOK_URL_PATH {
            let _ = req.respond(Response::empty(StatusCode(404)));
            continue;
        }

        let mut body = String::new();
        if req.as_reader().read_to_string(&mut body).is_err() {
            let _ = req.respond(Response::empty(StatusCode(400)));
            continue;
        }

        let payload: HookPayload = match serde_json::from_str(&body) {
            Ok(p) => p,
            Err(_) => {
                let _ = req.respond(Response::empty(StatusCode(400)));
                continue;
            }
        };

        if let Some(status) = status_for(&payload.event) {
            let event_name = format!("{TILE_STATUS_EVENT_PREFIX}{}", payload.session_id);
            let _ = app.emit(
                &event_name,
                TileStatusEvent {
                    status,
                    event: payload.event.clone(),
                },
            );
        }

        let header = Header::from_bytes(&b"Content-Type"[..], &b"application/json"[..])
            .expect("static header bytes");
        let _ = req.respond(
            Response::from_string("{\"ok\":true}").with_header(header),
        );
    }
}

fn status_for(event: &str) -> Option<&'static str> {
    HOOKS
        .iter()
        .find(|(name, _)| *name == event)
        .map(|(_, status)| *status)
}

pub fn install_hooks() -> Result<bool, String> {
    let home = std::env::var("HOME").map_err(|_| "HOME not set".to_string())?;
    let dir = PathBuf::from(&home).join(".claude");
    let path = dir.join("settings.json");

    std::fs::create_dir_all(&dir)
        .map_err(|e| format!("mkdir {}: {e}", dir.display()))?;

    // Advisory file lock guards the whole read→merge→write→rename cycle.
    // Two en instances launching simultaneously would otherwise race:
    // both read the pre-install file, both merge in their en block,
    // last writer wins and the other's identical block is "lost" — for
    // identical en blocks the outcome is fine, but if the launches
    // straddle a HOOK_EVENTS schema change the older binary would clobber
    // the newer entries. Lock makes the operation strictly serialized.
    let lock_path = dir.join(".en-hooks.lock");
    let lock_file = OpenOptions::new()
        .create(true)
        .read(true)
        .write(true)
        .open(&lock_path)
        .map_err(|e| format!("open lock {}: {e}", lock_path.display()))?;
    lock_file
        .lock_exclusive()
        .map_err(|e| format!("lock {}: {e}", lock_path.display()))?;
    // lock_file dropped at function exit → unlocked automatically.

    let existing = if path.exists() {
        std::fs::read_to_string(&path)
            .map_err(|e| format!("read {}: {e}", path.display()))?
    } else {
        "{}".to_string()
    };

    let mut settings: Value = if existing.trim().is_empty() {
        json!({})
    } else {
        serde_json::from_str(&existing)
            .map_err(|e| format!("parse settings.json: {e}"))?
    };
    if !settings.is_object() {
        return Err("settings.json is not a JSON object".into());
    }

    // Nanos + pid suffix so two launches in the same second can't collide
    // on the backup filename (or the .en-tmp filename mid-rename).
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default();
    let stamp = format!("{}-{}-{}", now.as_secs(), now.subsec_nanos(), std::process::id());

    let obj = settings.as_object_mut().unwrap();
    let hooks_root = obj
        .entry("hooks".to_string())
        .or_insert_with(|| json!({}));
    if !hooks_root.is_object() {
        return Err("settings.hooks is not a JSON object".into());
    }
    let hooks_map = hooks_root.as_object_mut().unwrap();

    // Per-event upsert: replace en's existing entry's command if present
    // (so HOOK_EVENTS can grow or the command body can change in a future
    // release without duplicating), otherwise push a fresh entry. Foreign
    // entries are left untouched.
    let mut changed = false;
    for (event, _) in HOOKS {
        let want_cmd = hook_command_for(event);
        let arr = hooks_map
            .entry((*event).to_string())
            .or_insert_with(|| json!([]));
        let Some(vec) = arr.as_array_mut() else {
            return Err(format!("settings.hooks.{event} is not a JSON array"));
        };
        let mut found = false;
        for entry in vec.iter_mut() {
            let Some(inner) = entry.get_mut("hooks").and_then(Value::as_array_mut) else {
                continue;
            };
            for h in inner.iter_mut() {
                let is_ours = h
                    .get("command")
                    .and_then(Value::as_str)
                    .map(|c| c.starts_with(HOOK_MARKER))
                    .unwrap_or(false);
                if is_ours {
                    let cur = h.get("command").and_then(Value::as_str).unwrap_or("");
                    if cur != want_cmd {
                        if let Some(o) = h.as_object_mut() {
                            o.insert("command".to_string(), Value::String(want_cmd.clone()));
                            changed = true;
                        }
                    }
                    found = true;
                    break;
                }
            }
            if found {
                break;
            }
        }
        if !found {
            vec.push(json!({
                "hooks": [{
                    "type": "command",
                    "command": want_cmd,
                }]
            }));
            changed = true;
        }
    }

    if !changed {
        return Ok(false);
    }

    if path.exists() {
        let backup = dir.join(format!("settings.json.en-backup-{stamp}"));
        std::fs::copy(&path, &backup)
            .map_err(|e| format!("backup settings.json: {e}"))?;
    }

    let serialized = serde_json::to_string_pretty(&settings)
        .map_err(|e| format!("serialize settings.json: {e}"))?;
    let tmp = dir.join(format!("settings.json.en-tmp-{stamp}"));
    std::fs::write(&tmp, serialized)
        .map_err(|e| format!("write tmp settings.json: {e}"))?;
    std::fs::rename(&tmp, &path)
        .map_err(|e| format!("rename tmp settings.json: {e}"))?;

    Ok(true)
}

fn hook_command_for(event: &str) -> String {
    // The bash `$EN_HUB_SESSION_ID` / `$EN_HUB_HOOK_URL` tokens below are
    // shell variable expansions — literal text in this Rust string. The
    // debug_assert_eq! pair is the only compile-side link to the env
    // constants in env.rs: rename a constant and dev builds fire here so
    // the literal can be updated in lockstep. Release builds skip the
    // assert; the bash tokens stay literal either way.
    debug_assert_eq!(EN_HUB_SESSION_ID, "EN_HUB_SESSION_ID");
    debug_assert_eq!(EN_HUB_HOOK_URL, "EN_HUB_HOOK_URL");
    format!(
        r#"{marker}
if [ -n "$EN_HUB_SESSION_ID" ] && [ -n "$EN_HUB_HOOK_URL" ]; then curl --max-time 0.3 -fsS -X POST -H 'Content-Type: application/json' -d "{{\"session_id\":\"$EN_HUB_SESSION_ID\",\"event\":\"{event}\"}}" "$EN_HUB_HOOK_URL" >/dev/null 2>&1 & fi"#,
        marker = HOOK_MARKER,
        event = event,
    )
}
