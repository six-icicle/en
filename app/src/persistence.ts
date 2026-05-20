import { load, type Store } from "@tauri-apps/plugin-store";

export type Theme =
  | "kanagawa"
  | "everforest"
  | "rose-pine"
  | "rose-pine-alt"
  | "original";
export type Texture =
  | "none"
  | "grain"
  | "scanlines"
  | "dots"
  | "sakura"
  | "seigaiha";
export type Layout = "row" | "grid" | "wide" | "focus";
export type AlertStyle =
  | "pulse"
  | "heartbeat"
  | "breath"
  | "hotaru"
  | "samurai"
  | "triple"
  | "vertical"
  | "sakura"
  | "ninja"
  | "shuriken";

// Migrate prior IDs that were renamed.
const ALERT_STYLE_LEGACY: Record<string, AlertStyle> = {
  tron: "hotaru",
  katana: "triple",
};

export type Appearance = {
  theme: Theme;
  texture: Texture;
  layout: Layout;
  fz: number;
  texAmt: number;
  accent: string | null;
  bg: string | null;
  alertStyle: AlertStyle;
};

export const APPEARANCE_DEFAULTS: Appearance = {
  theme: "rose-pine-alt",
  texture: "seigaiha",
  layout: "row",
  fz: 1,
  texAmt: 1,
  accent: null,
  bg: null,
  alertStyle: "pulse",
};

const THEMES = new Set<Theme>([
  "kanagawa",
  "everforest",
  "rose-pine",
  "rose-pine-alt",
  "original",
]);
const TEXTURES = new Set<Texture>([
  "none",
  "grain",
  "scanlines",
  "dots",
  "sakura",
  "seigaiha",
]);
const LAYOUTS = new Set<Layout>(["row", "grid", "wide", "focus"]);
const ALERT_STYLES = new Set<AlertStyle>([
  "pulse",
  "heartbeat",
  "breath",
  "hotaru",
  "samurai",
  "triple",
  "vertical",
  "sakura",
  "ninja",
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
  const theme = THEMES.has(r.theme as Theme)
    ? (r.theme as Theme)
    : APPEARANCE_DEFAULTS.theme;
  const texture = TEXTURES.has(r.texture as Texture)
    ? (r.texture as Texture)
    : APPEARANCE_DEFAULTS.texture;
  const layout = LAYOUTS.has(r.layout as Layout)
    ? (r.layout as Layout)
    : APPEARANCE_DEFAULTS.layout;
  const fz = typeof r.fz === "number" ? clamp(r.fz, 0.7, 1.6) : APPEARANCE_DEFAULTS.fz;
  const texAmt =
    typeof r.texAmt === "number"
      ? clamp(r.texAmt, 0.2, 2.0)
      : APPEARANCE_DEFAULTS.texAmt;
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
  return { theme, texture, layout, fz, texAmt, accent, bg, alertStyle };
}

export async function loadAppearance(): Promise<Appearance> {
  try {
    const store = await getStore();
    const raw = await store.get(KEY);
    return validate(raw);
  } catch {
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
