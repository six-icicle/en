import { load, type Store } from "@tauri-apps/plugin-store";

/* Catalogs — single source of truth per domain.
   Each record's insertion order is the picker order in App.tsx.
   The TS union, runtime validator Set, and picker array all derive
   from these constants. To add or remove a variant: edit the record
   here and only here. */
export const THEME_META = {
  kanagawa:           { title: "Kanagawa Sumi" },
  "kanagawa-soft":    { title: "Kanagawa Sumi (soft)" },
  everforest:         { title: "Everforest Dusk" },
  "everforest-soft":  { title: "Everforest Dusk (soft)" },
  "rose-pine":        { title: "Rose Pine Moon" },
  "rose-pine-soft":   { title: "Rose Pine Moon (soft)" },
  hinoki:             { title: "Hinoki" },
  "hinoki-soft":      { title: "Hinoki (soft)" },
  washi:              { title: "Washi Hinomaru" },
  "washi-kyokujitsu": { title: "Washi Kyokujitsu" },
  "washi-tsuki":      { title: "Washi Tsuki" },
} as const;
export type Theme = keyof typeof THEME_META;

export const TEXTURE_META = {
  none:            { title: "None" },
  grain:           { title: "Grain" },
  scanlines:       { title: "Scanlines" },
  dots:            { title: "Dot grid" },
  sakura:          { title: "Sakura" },
  seigaiha:        { title: "Seigaiha (waves)" },
  topography:      { title: "Topography" },
  pluses:          { title: "Plus signs" },
  yagasuri:        { title: "Yagasuri" },
  brush:           { title: "Brush strokes" },
  bokeh:           { title: "Bokeh" },
  bamboo:          { title: "Bamboo forest" },
  "petals-fall":   { title: "Sakura rain" },
  "shuriken-fall": { title: "Shuriken rain" },
} as const;
export type Texture = keyof typeof TEXTURE_META;

export const LAYOUT_META = {
  row:   { title: "Row",   desc: "single row" },
  grid:  { title: "Grid",  desc: "2 × 1–4" },
  focus: { title: "Focus", desc: "active big" },
} as const;
export type Layout = keyof typeof LAYOUT_META;

export const ALERT_STYLE_META = {
  pulse:     { title: "Andon",      desc: "soft halo" },
  heartbeat: { title: "Kodou",      desc: "lub-dub" },
  breath:    { title: "Kokyu",      desc: "slow inhale" },
  hotaru:    { title: "Hotaru",     desc: "racing firefly" },
  triple:    { title: "Sandangiri", desc: "three cuts" },
  vertical:  { title: "Tatewari",   desc: "falling cut" },
  sakura:    { title: "Sakura rain", desc: "petals fall" },
  shuriken:  { title: "Shuriken",   desc: "throw + stick" },
  hinode:    { title: "Hinode",     desc: "rising sun" },
} as const;
export type AlertStyle = keyof typeof ALERT_STYLE_META;

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

const THEMES = new Set<Theme>(Object.keys(THEME_META) as Theme[]);
const TEXTURES = new Set<Texture>(Object.keys(TEXTURE_META) as Texture[]);
const LAYOUTS = new Set<Layout>(Object.keys(LAYOUT_META) as Layout[]);
const LAYOUT_LEGACY: Record<string, Layout> = { wide: "grid" };
const ALERT_STYLES = new Set<AlertStyle>(
  Object.keys(ALERT_STYLE_META) as AlertStyle[],
);

const HEX_RE = /^#[0-9a-fA-F]{6}$/;

const STORE_FILE = "settings.json";
const KEY = "appearance";
const SLOTS_KEY = "tileSlots";

export type TileSlot = {
  key: string;
  name: string;
  cwd: string;
  path: string;
};

const SLOT_NAME_MAX = 256;
const SLOT_PATH_MAX = 4096;

function isValidSlot(raw: unknown): raw is TileSlot {
  if (!raw || typeof raw !== "object") return false;
  const r = raw as Record<string, unknown>;
  return (
    typeof r.key === "string" &&
    typeof r.name === "string" &&
    typeof r.cwd === "string" &&
    typeof r.path === "string" &&
    r.key.length > 0 &&
    r.name.length > 0 &&
    r.name.length <= SLOT_NAME_MAX &&
    r.cwd.length > 0 &&
    r.cwd.length <= SLOT_PATH_MAX &&
    r.path.length <= SLOT_PATH_MAX
  );
}

export async function loadTileSlots(): Promise<TileSlot[]> {
  try {
    const store = await getStore();
    const raw = await store.get(SLOTS_KEY);
    if (!Array.isArray(raw)) return [];
    return raw.filter(isValidSlot).slice(0, 8);
  } catch (e) {
    console.warn("[en/persistence] failed to load tile slots:", e);
    return [];
  }
}

export async function saveTileSlots(slots: TileSlot[]): Promise<void> {
  try {
    const store = await getStore();
    await store.set(SLOTS_KEY, slots);
    await store.save();
  } catch {
    // Best-effort.
  }
}

let storePromise: Promise<Store> | null = null;
function getStore(): Promise<Store> {
  if (!storePromise) {
    // If the load rejects (FS hiccup, plugin race during boot), null
    // the cache so the next call retries instead of returning the same
    // dead promise for the rest of the session.
    storePromise = load(STORE_FILE, { autoSave: true, defaults: {} }).catch(
      (err) => {
        storePromise = null;
        throw err;
      },
    );
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
    // Force a flush — autoSave debouncing can drop the latest write
    // when ⌘Q fires inside the debounce window. Appearance changes are
    // rare enough that the extra disk traffic doesn't matter.
    await store.save();
  } catch {
    // Best-effort: persistence is non-critical. If the store is unavailable,
    // the in-memory state still works for this session.
  }
}
