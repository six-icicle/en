import { load, type Store } from "@tauri-apps/plugin-store";

export type Theme =
  | "kanagawa"
  | "kanagawa-soft"
  | "everforest"
  | "everforest-soft"
  | "rose-pine"
  | "rose-pine-soft"
  | "hinoki"
  | "hinoki-soft";
export type Texture =
  | "none"
  | "grain"
  | "scanlines"
  | "dots"
  | "sakura"
  | "seigaiha"
  | "petals-fall"
  | "shuriken-fall"
  | "topography"
  | "pluses"
  | "yagasuri"
  | "brush"
  | "bokeh"
  | "bamboo";
export type Layout = "row" | "grid" | "focus";
export type AlertStyle =
  | "pulse"
  | "heartbeat"
  | "breath"
  | "hotaru"
  | "triple"
  | "vertical"
  | "sakura"
  | "shuriken";

// Migrate prior IDs that were renamed.
const ALERT_STYLE_LEGACY: Record<string, AlertStyle> = {
  tron: "hotaru",
  katana: "triple",
  // 2026-05-21: removed standalone samurai (katana sheen) style; closest
  // sibling is the triple-slash sandangiri.
  samurai: "triple",
  // 2026-05-21: removed standalone ninja (corner strike) style; closest
  // sibling is shuriken (throw + stick).
  ninja: "shuriken",
};
const THEME_LEGACY: Record<string, Theme> = {
  // 2026-05-21: existing themes were re-cast as the high-contrast lead and
  // the original (lower-contrast) palettes moved to *-soft variants.
  // rose-pine-alt + rose-pine-alt-soft were collapsed; the alt-soft palette
  // became the canonical rose-pine-soft.
  "rose-pine-alt": "rose-pine",
  "rose-pine-alt-soft": "rose-pine-soft",
  // 2026-05-21: "Dark Amber" renamed to Hinoki (Japanese cypress) with a
  // softer palette to match the family aesthetic.
  original: "hinoki",
  "original-alt": "hinoki-soft",
  "original-soft": "hinoki-soft",
};

export type Appearance = {
  theme: Theme;
  texture: Texture;
  layout: Layout;
  fz: number;
  tfz: number;
  texAmt: number;
  brightness: number;
  accent: string | null;
  bg: string | null;
  alertStyle: AlertStyle;
};

export const APPEARANCE_DEFAULTS: Appearance = {
  theme: "rose-pine-soft",
  texture: "seigaiha",
  layout: "row",
  fz: 1,
  tfz: 1,
  texAmt: 1,
  brightness: 1,
  accent: null,
  bg: null,
  alertStyle: "pulse",
};

const THEMES = new Set<Theme>([
  "kanagawa",
  "kanagawa-soft",
  "everforest",
  "everforest-soft",
  "rose-pine",
  "rose-pine-soft",
  "hinoki",
  "hinoki-soft",
]);
const TEXTURES = new Set<Texture>([
  "none",
  "grain",
  "scanlines",
  "dots",
  "sakura",
  "seigaiha",
  "petals-fall",
  "shuriken-fall",
  "topography",
  "pluses",
  "yagasuri",
  "brush",
  "bokeh",
  "bamboo",
]);
const LAYOUTS = new Set<Layout>(["row", "grid", "focus"]);
const LAYOUT_LEGACY: Record<string, Layout> = { wide: "grid" };
const ALERT_STYLES = new Set<AlertStyle>([
  "pulse",
  "heartbeat",
  "breath",
  "hotaru",
  "triple",
  "vertical",
  "sakura",
  "shuriken",
]);

const HEX_RE = /^#[0-9a-fA-F]{6}$/;

const STORE_FILE = "settings.json";
const KEY = "appearance";

let storePromise: Promise<Store> | null = null;
function getStore(): Promise<Store> {
  if (!storePromise) {
    storePromise = load(STORE_FILE, { autoSave: true, defaults: {} });
  }
  return storePromise;
}

function clamp(n: number, lo: number, hi: number): number {
  if (!Number.isFinite(n)) return lo;
  return Math.max(lo, Math.min(hi, n));
}

function validate(raw: unknown): Appearance {
  if (!raw || typeof raw !== "object") return { ...APPEARANCE_DEFAULTS };
  const r = raw as Record<string, unknown>;
  let theme: Theme;
  if (THEMES.has(r.theme as Theme)) {
    theme = r.theme as Theme;
  } else if (typeof r.theme === "string" && r.theme in THEME_LEGACY) {
    theme = THEME_LEGACY[r.theme];
  } else {
    theme = APPEARANCE_DEFAULTS.theme;
  }
  const texture = TEXTURES.has(r.texture as Texture)
    ? (r.texture as Texture)
    : APPEARANCE_DEFAULTS.texture;
  const layout = LAYOUTS.has(r.layout as Layout)
    ? (r.layout as Layout)
    : typeof r.layout === "string" && r.layout in LAYOUT_LEGACY
      ? LAYOUT_LEGACY[r.layout]
      : APPEARANCE_DEFAULTS.layout;
  const fz = typeof r.fz === "number" ? clamp(r.fz, 0.7, 1.6) : APPEARANCE_DEFAULTS.fz;
  const tfz =
    typeof r.tfz === "number" ? clamp(r.tfz, 0.7, 1.6) : APPEARANCE_DEFAULTS.tfz;
  const texAmt =
    typeof r.texAmt === "number"
      ? clamp(r.texAmt, 0.2, 2.0)
      : APPEARANCE_DEFAULTS.texAmt;
  const brightness =
    typeof r.brightness === "number"
      ? clamp(r.brightness, 0.5, 2.0)
      : APPEARANCE_DEFAULTS.brightness;
  const accent =
    typeof r.accent === "string" && HEX_RE.test(r.accent) ? r.accent : null;
  const bg = typeof r.bg === "string" && HEX_RE.test(r.bg) ? r.bg : null;
  const rawAlert = r.alertStyle;
  let alertStyle: AlertStyle;
  if (ALERT_STYLES.has(rawAlert as AlertStyle)) {
    alertStyle = rawAlert as AlertStyle;
  } else if (typeof rawAlert === "string" && rawAlert in ALERT_STYLE_LEGACY) {
    alertStyle = ALERT_STYLE_LEGACY[rawAlert];
  } else {
    alertStyle = APPEARANCE_DEFAULTS.alertStyle;
  }
  return { theme, texture, layout, fz, tfz, texAmt, brightness, accent, bg, alertStyle };
}

export async function loadAppearance(): Promise<Appearance> {
  try {
    const store = await getStore();
    const raw = await store.get(KEY);
    return validate(raw);
  } catch (e) {
    // Native side (appearance::quarantine_if_corrupt in lib.rs) moves
    // unparseable settings.json files aside before the store plugin
    // opens them, so reaching this branch means the plugin itself
    // errored — surface it once so the user has a chance to notice.
    console.warn("[en/persistence] failed to load appearance store:", e);
    return { ...APPEARANCE_DEFAULTS };
  }
}

export async function saveAppearance(next: Appearance): Promise<void> {
  try {
    const store = await getStore();
    await store.set(KEY, next);
  } catch {
    // Best-effort: persistence is non-critical. If the store is unavailable,
    // the in-memory state still works for this session.
  }
}
