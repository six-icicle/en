use std::time::{SystemTime, UNIX_EPOCH};

use serde_json::Value;
use tauri::{AppHandle, Manager};

const STORE_FILE: &str = "settings.json";

/// If the appearance store on disk exists but isn't valid JSON, move it
/// aside to `settings.json.en-corrupted-<stamp>` before tauri-plugin-store
/// gets a chance to overwrite it on the next save. Defaults will silently
/// load the next pass; the quarantine file lets the user recover anything
/// they had set manually.
pub fn quarantine_if_corrupt(app: &AppHandle) {
    let dir = match app.path().app_data_dir() {
        Ok(d) => d,
        Err(e) => {
            eprintln!("[en-appearance] WARN cannot resolve app_data_dir: {e}");
            return;
        }
    };
    let path = dir.join(STORE_FILE);
    if !path.exists() {
        return;
    }
    let raw = match std::fs::read_to_string(&path) {
        Ok(s) => s,
        Err(e) => {
            eprintln!("[en-appearance] WARN read {}: {e}", path.display());
            return;
        }
    };
    if raw.trim().is_empty() {
        return;
    }
    // tauri-plugin-store always writes a top-level JSON object. Anything else
    // (parse failure, top-level array, scalar, null) is treated as corrupt and
    // quarantined so the plugin doesn't silently overwrite the user's file.
    let reason = match serde_json::from_str::<Value>(&raw) {
        Ok(v) if v.is_object() => return,
        Ok(_) => "wrong-shape".to_string(),
        Err(e) => format!("parse-error: {e}"),
    };
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default();
    let stamp = format!("{}-{}-{}", now.as_secs(), now.subsec_nanos(), std::process::id());
    let quarantine = dir.join(format!("settings.json.en-corrupted-{stamp}"));
    match std::fs::rename(&path, &quarantine) {
        Ok(()) => eprintln!(
            "[en-appearance] WARN appearance store was corrupt ({reason}); moved to {}",
            quarantine.display()
        ),
        Err(e) => eprintln!(
            "[en-appearance] WARN failed to quarantine corrupt store {} ({reason}): {e}",
            path.display()
        ),
    }
}
