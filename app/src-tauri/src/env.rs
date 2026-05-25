//! Cross-tier env-var names + hook URL path bridging the Rust pty spawner
//! and the bash hook script that Claude executes inside the spawned PTY.
//!
//! Used by:
//!   pty.rs   → injects EN_HUB_SESSION_ID / EN_HUB_HOOK_URL into the child
//!              env, builds the URL with HOOK_URL_PATH.
//!   hooks.rs → matches HOOK_URL_PATH on the receiver side; the shell
//!              heredoc references the env-var names literally as
//!              `$EN_HUB_SESSION_ID` / `$EN_HUB_HOOK_URL` (bash expansion,
//!              not Rust interpolation), so renaming a constant here also
//!              requires editing the heredoc body. The debug_assert_eq! in
//!              hook_command_for trips at startup if they drift.
//
// Renaming any of these requires editing both ends in the same commit.
// There's no compile-time link between the Rust constant and the bash
// `$VAR` literal in the heredoc — only the debug assert catches drift.
pub const EN_HUB_SESSION_ID: &str = "EN_HUB_SESSION_ID";
pub const EN_HUB_HOOK_URL: &str = "EN_HUB_HOOK_URL";
pub const HOOK_URL_PATH: &str = "/hook";
