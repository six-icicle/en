//! PATH resolution for PTY-spawned children.
//!
//! Mac apps launched from Finder/Spotlight/dock inherit a minimal PATH
//! (typically `/usr/bin:/bin:/usr/sbin:/sbin`). They do NOT inherit the
//! user's interactive-shell PATH set in `.zshrc` / `.zprofile`. So tools
//! installed by Homebrew (`/opt/homebrew/bin`), npm globals, `~/.local/bin`,
//! cargo (`~/.cargo/bin`), bun, mise/asdf, etc. are invisible to spawned
//! processes — meaning `claude` can't be found, and PTY spawn fails.
//!
//! Fix: at app startup, source the user's login shell once to capture
//! the real PATH, then prepend a fallback set of common bin dirs. Cache
//! the result on `AppHandle` state for the rest of the process lifetime.

use std::path::PathBuf;
use std::process::Command;

#[derive(Clone)]
pub struct ResolvedPath(pub String);

/// Resolve a robust PATH for spawning child processes from the production
/// app bundle. Strategy:
///   1. Try sourcing the user's login shell (zsh -ilc 'echo -n $PATH').
///      `-i` = interactive, `-l` = login → reads .zshrc + .zprofile.
///   2. Fall back to a hard-coded set of common bin dirs if step 1 fails.
///   3. Always merge in the inherited PATH (whatever Finder gave us) at the end
///      so /usr/bin etc. stay reachable.
pub fn resolve() -> ResolvedPath {
    let inherited = std::env::var("PATH").unwrap_or_default();
    let mut entries: Vec<String> = Vec::new();

    // 1. Try login-shell source.
    if let Some(shell_path) = source_login_shell() {
        for p in shell_path.split(':') {
            if !p.is_empty() {
                entries.push(p.to_string());
            }
        }
    }

    // 2. Hard-coded fallback set (idempotent — `dedup` below removes
    //    duplicates if the shell already had these).
    let home = std::env::var("HOME").unwrap_or_default();
    let fallback = [
        "/opt/homebrew/bin".to_string(),
        "/opt/homebrew/sbin".to_string(),
        "/usr/local/bin".to_string(),
        "/usr/local/sbin".to_string(),
        format!("{home}/.local/bin"),
        format!("{home}/.cargo/bin"),
        format!("{home}/.bun/bin"),
        format!("{home}/.nvm/versions/node/current/bin"),
    ];
    for p in fallback {
        entries.push(p);
    }

    // 3. Inherited PATH last so anything Finder gave us still works.
    for p in inherited.split(':') {
        if !p.is_empty() {
            entries.push(p.to_string());
        }
    }

    // Dedup while preserving first-seen order.
    let mut seen = std::collections::HashSet::new();
    entries.retain(|p| seen.insert(p.clone()));

    // Drop any path that doesn't exist on disk so PATH stays tidy.
    entries.retain(|p| PathBuf::from(p).exists());

    ResolvedPath(entries.join(":"))
}

fn source_login_shell() -> Option<String> {
    // Prefer the user's actual SHELL if set; default to zsh on macOS.
    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string());

    // -i = interactive, -l = login. Together they read .zshrc + .zprofile.
    // -c "echo -n $PATH" prints the resolved PATH with no trailing newline.
    let output = Command::new(&shell)
        .args(["-ilc", "echo -n $PATH"])
        .output()
        .ok()?;

    if !output.status.success() {
        return None;
    }

    let path = String::from_utf8(output.stdout).ok()?;
    let trimmed = path.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}
