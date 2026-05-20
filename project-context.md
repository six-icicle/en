# Project Context — En

## What this is
**En** (縁 — connection, fate, the central point that links) is a desktop hub for managing many concurrent Claude CLI sessions on Mac. Tauri 2 app (Rust core + React/TypeScript webview frontend) with embedded terminals via xterm.js. Single hub window: themed grid of terminal sessions, every tile visible at once. *Not* a generic terminal app — purpose-built for running many `claude` instances side-by-side and knowing which need attention. Renamed from "multiclaude" 2026-05-20. Repo: `git@github.com:six-icicle/en.git`. Bundle ID: `dev.sixicicle.en`. Crate: `en` / `en_lib`.

## Why
User runs many `claude` sessions per day across different projects and wants one place to navigate, organize, and surface which sessions need input — instead of cycling through dozens of iTerm2 windows.

## Stack
- Frontend: React 19 + TypeScript + shadcn/ui + Vite + xterm.js (WebGL addon)
- Backend: Tauri 2 + Rust + portable-pty + tiny_http (status-detection HTTP receiver)
- Storage: SQLite via rusqlite (planned — metadata only; sessions are ephemeral, die on hub quit)
- Aesthetic: hyper-modern minimal terminal grid. **Brand wordmark: Outfit 600/18px**, body sans Inter, mono JetBrains Mono. **Default theme: rose-pine-alt + seigaiha texture** (changed from kanagawa/grain). 5 themes + 6 textures + accent/bg pickers + texture-amount and font-size scales.

## What's done
- Architecture: Tauri 2 + React/TS + portable-pty
- Layout: live tiling grid — every session visible at once, ⌘+arrows / click to focus, layout switcher (Row / Quad / Hex / Focus)
- Visual system: hyper-modern minimal, Inter + JetBrains Mono, rose-pine-alt default + 4 swappable themes; texture switcher (none / grain / scanlines / dots / sakura / seigaiha)
- Active tile indicator: top accent line + bloom + 1px inset accent ring + soft inner glow
- Grid sizing rule: 1–5 sessions = single row full height; 6 sessions = 2×3; layouts cover counts 1–6 with no empty cells
- **Titlebar dropdown system** — collapsed appearance controls into 4 pill triggers, right-to-left: **font size · alert · layout · theme**. Each trigger opens a styled popover with options + descriptions. Lucide icons for layout/alert glyphs (`lucide-react` installed). Click-outside + Esc close. Spawn + reset stay grouped on the left.
- **Theme popover** is one combined panel containing 4 sections: Theme (5 swatches), Accent (color picker + reset), Background (color picker + reset), Texture (6 large preview chips with overlaid name labels) + Texture-strength −/+ row. `.accent-swatch` / `.accent-reset` were unscoped from the old `.accent` parent so they style correctly inside the popover.
- 38+ HTML mockups in `mockups/` (locked design = `36-textures.html`; alert-style explorations 37–41; central index = `00-hub.html`)
- **PTY layer** (`app/src-tauri/src/pty.rs`): `spawn_session` / `send_input` / `resize_session` / `kill_session`. Inherits parent env. `[mc-pty]` eprintln diagnostics removed.
- **xterm.js wired** (`app/src/Terminal.tsx`): xterm 6 + fit-addon + WebglAddon. Per-theme palette swaps without re-spawning. Spawn-stability check waits for two equal cols/rows measurements before spawning the PTY (prevents off-by-one truncation). Claude's welcome-banner colors are driven by xterm's per-theme ANSI palette in `themeFor()` — the banner colors with the theme.
- **Multi-session frontend hook** (`app/src/sessions.tsx`): SessionsProvider owns `Map<key, Session>` + lifecycle; 256 KB ring buffer per session for late-mount replay
- **Resize handles** (`app/src/GridResizeHandles.tsx`): track-level drag handles, rAF-coalesced, PTY IPC paused during drag and flushed once on release
- **Spawn / close flow**: `spawn()` opens native folder picker → derives session name from basename. Three entry points: titlebar pill, ⌘N, empty-state CTA. App starts empty.
- **Confirm-close modal**: ⌘W and tile × open a modal; Enter confirms, Esc/click-outside dismisses
- **Reset sizes button** in titlebar — snaps tracks back to layout default, dispatches `en:refit`
- **Default app size**: 1400×850, minWidth 900, minHeight 500, centered
- **Phase A persistence shipped** (`tauri-plugin-store` + `app/src/persistence.ts`): theme, accent, bg, texture, texAmt, fz, layout, alertStyle all survive relaunch via `settings.json` in app data dir. Validation enforces enum/range. Legacy `alertStyle` IDs (`tron`→`hotaru`, `katana`→`triple`) auto-migrate.
- **Alert-style system** (`document.documentElement.dataset.alertStyle` + `.tile.needs` CSS + per-tile `<AlertExtras>` DOM). 10 styles, all driven by `--accent` so they auto-theme:
  - Andon (soft halo) · Kodou (lub-dub heartbeat) · Kokyu (slow breath) · Hotaru (racing firefly dot) · Samurai (katana sheen + 待 hanko) · Sandangiri (three slashes via clip-path, no final glow) · Tatewari (vertical falling cut from tile's top edge) · Sakura (petals fall + pile up to ~36, drifters dissipate at the floor) · Ninja (corner smoke + spinning shuriken) · Shuriken (8-throw + stick + smoke-fade, two waves)
  - All honor `prefers-reduced-motion`. Default = Andon.
  - Status detection isn't wired yet — `tile.status === "needs"` never fires from runtime today; preview via `pass-code.md` devtools snippet.
- **Window-drag artifact fixed**: switched `body::before` (texture) and `body::after` (vignette) from `position: fixed` → `position: absolute` so they don't get put on a separate compositor layer that lagged behind the window during drag on macOS WebView.
- **Project rename + git init** (2026-05-20): folder `multiclaude/`→`en/`, brand `multi·claude`→lowercase `en`, bundle `dev.sixicicle.en`, Cargo crate `en`/`en_lib`, refit event `multiclaude:refit`→`en:refit`. Memory dir moved to `~/.claude/projects/-Users-austin-pozodesportes-Documents-claude-projects-en/memory/`. Repo: `https://github.com/six-icicle/en` (HTTPS via gh token; SSH not authorized for this account). Initial commit pushed to `main`.
- **Status detection shipped on `feat/status-detection`** (2026-05-20, NOT YET MERGED OR PUSHED). New `app/src-tauri/src/hooks.rs` runs a `tiny_http` receiver bound to 127.0.0.1:0 (dynamic port), listens for `POST /hook` with `{session_id, event}`, emits `tile-status:<id>` Tauri events. State machine: SessionStart→idle, UserPromptSubmit→working, Stop|Notification→needs, SubagentStop ignored. `pty.rs` injects `EN_HUB_SESSION_ID` and `EN_HUB_HOOK_URL` into every spawn. On startup the app idempotently merges a hook block into `~/.claude/settings.json` (with one-time `settings.json.en-backup-<ts>` backup). Hook commands are guarded by `[ -n "$EN_HUB_SESSION_ID" ]` so claude run outside en is a no-op. Frontend `sessions.tsx` listens per-session and writes to `Session.status`; `App.tsx` `tilesWithStatus` mapping passes `working`/`needs`/`idle` through to existing CSS. Smoke-tested live: tiles flip working↔needs on real claude prompts.
- **Brand font set to Outfit** (2026-05-20): `.brand` is Outfit 600 @ 18px / 0.01em letter-spacing. Loaded alongside Inter + JetBrains Mono in `index.html`.

## What's next
1. **Push `feat/status-detection` and merge to main.** Open PR or fast-forward — branch contains 2 commits (status-detection feature + Outfit brand font). Worktree at `.claude/worktrees/status-detection/`.
2. **Phase B persistence** — tile slots (cwd + name) restored on relaunch, manual click-to-spawn, missing-cwd shows a disabled state. Optional Phase C later: auto-respawn with `claude --resume <uuid>` from `~/.claude/projects/.../*.jsonl`.
3. **Layer 3 — distribution / enterprise readiness.** Apple Developer ID ($99/yr), code signing + notarization in `tauri.conf.json`, `tauri-plugin-updater` with minisign keypair, GitHub Actions to build signed `.dmg` on tag push. Set up *before* first teammate distribution because the updater public key is baked at build time. Real app icons (replace placeholder Tauri ones).
4. Polish: find-in-scrollback (⌘F), drag-reorder tiles, SQLite metadata for titles/colors/recent cwds.
5. Consider Tauri `Channel<Vec<u8>>` instead of base64 events if streaming overhead shows up.

## Open decisions
- Categorical color palette for per-session tags (deferred until grid feels crowded)
- Whether sessions persist across app restarts or always start fresh
- Whether to wrap the `claude` CLI or invoke it directly
- Minimum tile width enforcement vs accepting narrow-tile clipping

## Key references
- **Always work from `/Users/austin.pozodesportes/Documents/claude-projects/en/`** — older sessions launched in the `…multiclaude/` cwd resolve memory to a stale path. Future Claude Code sessions should `cd en/` before starting.
- Memory directory: `~/.claude/projects/-Users-austin-pozodesportes-Documents-claude-projects-en/memory/`
- TauriForge persona + 5-section output protocol with `<thought>` tags: see memory `feedback-tauriforge-protocol.md`
- pass-code.md workflow: runnable code blocks go to `./pass-code.md`, prose stays in chat
- Mockups: `./mockups/` (locked design = `36-textures.html`; brand-font sampler = `42-brand-fonts.html`)
- Project settings: `./.claude/settings.json` (allowlist), `./.claude/settings.local.json` (user-local, untouched)
- Worktree for in-flight work: `./.claude/worktrees/status-detection/` on branch `feat/status-detection`. To re-enter: `cd .claude/worktrees/status-detection`. To re-run dev build: `cd .claude/worktrees/status-detection/app && npm run tauri dev`. Worktree shares `node_modules` with main tree via symlink.
- `~/.claude/settings.json` was modified by en's auto-merge (status-detection install). Backup at `~/.claude/settings.json.en-backup-<ts>`. The `# en-managed` marker in hook commands is what makes the merge idempotent.
