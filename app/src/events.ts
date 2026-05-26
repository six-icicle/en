// Cross-tier event-name prefixes used for Tauri listen() channels.
// Each Rust emit site formats `<PREFIX><id>` and the matching listener
// here does the same. These strings are part of the wire protocol with
// the Rust backend.
//
// SIBLING: `app/src-tauri/src/events.rs` mirrors these constants.
// Renaming any prefix requires editing both files in the same commit,
// otherwise the channel silently breaks (emit fires into a name no one
// listens for).
//
// Used by:
//   sessions.tsx → all three prefixes (data / exit / tile-status listeners)

export const PTY_EVENT_PREFIX = "pty:";
export const PTY_EXIT_EVENT_PREFIX = "pty-exit:";
export const TILE_STATUS_EVENT_PREFIX = "tile-status:";

// The set of statuses the Rust `tile-status:<id>` channel can emit. The
// Rust source of truth is the `HOOKS` table in `app/src-tauri/src/hooks.rs`
// (currently `idle` / `working` / `needs`) — this list mirrors that table's
// status column. Renaming or adding a status here requires updating the
// Rust HOOKS table in the same commit.
export const WORKING_STATUSES = ["working", "needs", "idle"] as const;
export type WorkingStatus = (typeof WORKING_STATUSES)[number];
