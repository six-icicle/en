//! Cross-tier event-name prefixes used for Tauri AppHandle::emit() →
//! frontend listen() channels. Each emit site formats `<PREFIX><id>` and
//! the matching listener does the same. These strings are part of the
//! wire protocol with the frontend.
//!
//! SIBLING: `app/src/events.ts` mirrors these constants. Renaming any
//! prefix requires editing both files in the same commit, otherwise the
//! channel silently breaks (emit fires into a name no one listens for).
//
// Used by:
//   pty.rs   → PTY_EVENT_PREFIX, PTY_EXIT_EVENT_PREFIX
//   hooks.rs → TILE_STATUS_EVENT_PREFIX

pub const PTY_EVENT_PREFIX: &str = "pty:";
pub const PTY_EXIT_EVENT_PREFIX: &str = "pty-exit:";
pub const TILE_STATUS_EVENT_PREFIX: &str = "tile-status:";
