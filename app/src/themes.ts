/* Theme palettes — JS-side single source for the values that need to be
   the same in two places (App.tsx picker swatches + bg/accent picker
   defaults, AND Terminal.tsx xterm bg/cursor).

   Anything CSS-only (--ink, --line, --warn, --tile-2, etc.) lives in
   App.css. xterm-specific values (foreground, cursorAccent, ANSI) live
   in Terminal.tsx. Both still must visually match this file. */
import { THEME_META, type Theme } from "./persistence";

export const THEME_BGS: Record<Theme, string> = {
  kanagawa: "#1a1a23",
  "kanagawa-soft": "#2f2f3d",
  everforest: "#222a30",
  "everforest-soft": "#303c40",
  "rose-pine": "#211f33",
  "rose-pine-soft": "#312e4a",
  hinoki: "#1b1d20",
  "hinoki-soft": "#312d26",
  washi: "#ebedf0",
  "washi-kyokujitsu": "#ebedf0",
  "washi-tsuki": "#11141a",
};

export const THEME_ACCENTS: Record<Theme, string> = {
  kanagawa: "#d4b274",
  "kanagawa-soft": "#c0a36e",
  everforest: "#b8d290",
  "everforest-soft": "#a7c080",
  "rose-pine": "#f4a8a5",
  "rose-pine-soft": "#ea9a97",
  hinoki: "#d49a3a",
  "hinoki-soft": "#c89656",
  washi: "#bc002d",
  "washi-kyokujitsu": "#bc002d",
  "washi-tsuki": "#be4258",
};

/* Init-time invariant: every theme in THEME_META (the picker source of
   truth) must have a matching bg + accent here. TS's Record<Theme, …>
   already enforces this at compile time, but a future widening of the
   key type — or a hand-edit that bypasses the type — would silently
   degrade rendered tiles to xterm defaults. Throw loudly at module
   load so the dev signal is unmissable. */
for (const k of Object.keys(THEME_META) as Theme[]) {
  if (!THEME_BGS[k]) throw new Error(`THEME_BGS missing entry for ${k}`);
  if (!THEME_ACCENTS[k]) throw new Error(`THEME_ACCENTS missing entry for ${k}`);
}
