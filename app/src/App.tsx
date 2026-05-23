import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { openPath } from "@tauri-apps/plugin-opener";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import {
  Bug,
  Columns3,
  HeartPulse,
  LayoutGrid,
  LayoutPanelLeft,
  Wind,
} from "lucide-react";
import TerminalView from "./Terminal";
import { useSessions, type SessionDecl } from "./sessions";
import GridResizeHandles from "./GridResizeHandles";
import {
  APPEARANCE_DEFAULTS,
  loadAppearance,
  loadTileSlots,
  saveAppearance,
  saveTileSlots,
  type AlertStyle,
  type Appearance,
  type Layout,
  type Texture,
  type Theme,
  type TileSlot,
} from "./persistence";
import "./App.css";
type DisplayStatus = "working" | "needs" | "idle" | "stale";

type TileDecl = SessionDecl & {
  meta: string;
  status: DisplayStatus;
  sleeping?: boolean;
};

const THEMES: { id: Theme; title: string }[] = [
  { id: "kanagawa", title: "Kanagawa Sumi" },
  { id: "kanagawa-soft", title: "Kanagawa Sumi (soft)" },
  { id: "everforest", title: "Everforest Dusk" },
  { id: "everforest-soft", title: "Everforest Dusk (soft)" },
  { id: "rose-pine", title: "Rose Pine Moon" },
  { id: "rose-pine-soft", title: "Rose Pine Moon (soft)" },
  { id: "hinoki", title: "Hinoki" },
  { id: "hinoki-soft", title: "Hinoki (soft)" },
  { id: "washi", title: "Washi Hinomaru" },
  { id: "washi-kyokujitsu", title: "Washi Kyokujitsu" },
];

const THEME_ACCENTS: Record<Theme, string> = {
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
};

const THEME_BGS: Record<Theme, string> = {
  kanagawa: "#1a1a23",
  "kanagawa-soft": "#2f2f3d",
  everforest: "#222a30",
  "everforest-soft": "#3a464c",
  "rose-pine": "#211f33",
  "rose-pine-soft": "#312e4a",
  hinoki: "#1b1d20",
  "hinoki-soft": "#312d26",
  washi: "#ebedf0",
  "washi-kyokujitsu": "#ebedf0",
};

function hexToRgba(hex: string, alpha: number): string {
  const c = hex.replace("#", "");
  const r = parseInt(c.slice(0, 2), 16);
  const g = parseInt(c.slice(2, 4), 16);
  const b = parseInt(c.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function shiftLightness(hex: string, delta: number): string {
  const c = hex.replace("#", "");
  const ch = (i: number) =>
    Math.max(0, Math.min(255, parseInt(c.slice(i, i + 2), 16) + delta));
  const r = ch(0),
    g = ch(2),
    b = ch(4);
  return (
    "#" +
    [r, g, b]
      .map((v) => Math.round(v).toString(16).padStart(2, "0"))
      .join("")
  );
}

const TEXTURES: { id: Texture; title: string }[] = [
  { id: "none", title: "None" },
  { id: "grain", title: "Grain" },
  { id: "scanlines", title: "Scanlines" },
  { id: "dots", title: "Dot grid" },
  { id: "sakura", title: "Sakura" },
  { id: "seigaiha", title: "Seigaiha (waves)" },
  { id: "topography", title: "Topography" },
  { id: "pluses", title: "Plus signs" },
  { id: "yagasuri", title: "Yagasuri" },
  { id: "brush", title: "Brush strokes" },
  { id: "bokeh", title: "Bokeh" },
  { id: "bamboo", title: "Bamboo forest" },
  { id: "petals-fall", title: "Sakura rain" },
  { id: "shuriken-fall", title: "Shuriken rain" },
];

const MAX_TILES = 8;

const LAYOUTS: { id: Layout; title: string; desc: string }[] = [
  { id: "row",   title: "Row",   desc: "single row" },
  { id: "grid",  title: "Grid",  desc: "2 × 1–4" },
  { id: "focus", title: "Focus", desc: "active big" },
];

const ALERT_STYLES: { id: AlertStyle; title: string; desc: string }[] = [
  { id: "pulse",     title: "Andon",         desc: "soft halo" },
  { id: "heartbeat", title: "Kodou",         desc: "lub-dub" },
  { id: "breath",    title: "Kokyu",         desc: "slow inhale" },
  { id: "hotaru",    title: "Hotaru",        desc: "racing firefly" },
  { id: "triple",    title: "Sandangiri",    desc: "three cuts" },
  { id: "vertical",  title: "Tatewari",      desc: "falling cut" },
  { id: "sakura",    title: "Sakura rain",   desc: "petals fall" },
  { id: "shuriken",  title: "Shuriken",      desc: "throw + stick" },
  { id: "hinode",    title: "Hinode",        desc: "rising sun" },
];

function defaultTracks(layout: Layout, count: number): { cols: number[]; rows: number[] } {
  if (count <= 0) return { cols: [1], rows: [1] };
  if (count === 1) return { cols: [1], rows: [1] };
  if (layout === "row") {
    return { cols: Array(count).fill(1), rows: [1] };
  }
  if (layout === "grid") {
    /* 2 rows × 1–4 cols. Side-by-side at 2; otherwise ceil(count/2)
       columns and 2 rows. Odd counts leave one trailing empty cell. */
    if (count === 2) return { cols: [1, 1], rows: [1] };
    const cols = Math.min(4, Math.ceil(count / 2));
    return { cols: Array(cols).fill(1), rows: [1, 1] };
  }
  // focus
  if (count === 2) return { cols: [2, 1], rows: [1] };
  if (count === 3) return { cols: [2, 1], rows: [1, 1] };
  if (count === 4) return { cols: [2, 1], rows: [1, 1, 1] };
  if (count === 5) return { cols: [2, 1, 1], rows: [1, 1] };
  if (count === 6) return { cols: [2, 1, 1], rows: [1, 1, 1] };
  // 7: primary + 2-col × 3-row right side (1 cell unused)
  if (count === 7) return { cols: [2, 1, 1], rows: [1, 1, 1] };
  // 8: primary spans 4 rows + 2-col × 4-row right side (1 cell unused)
  return { cols: [2, 1, 1], rows: [1, 1, 1, 1] };
}

const INITIAL_TILES: TileDecl[] = [];

function deriveDisplayPath(absPath: string): string {
  const home =
    typeof window !== "undefined" && (window as { HOME?: string }).HOME
      ? ((window as { HOME?: string }).HOME as string)
      : "";
  if (home && absPath.startsWith(home)) return "~" + absPath.slice(home.length);
  return absPath;
}

function basename(path: string): string {
  const parts = path.split("/").filter(Boolean);
  return parts[parts.length - 1] || path;
}

/* Shell-quote a path the way Terminal.app does on drag-drop:
   POSIX single-quoting — wrap in single quotes, escape any embedded
   single quote with the canonical '\'' dance. Safe for paths with
   spaces, parens, dollar signs, etc. */
function shellQuotePath(path: string): string {
  if (!/[^A-Za-z0-9._\-/~]/.test(path)) return path;
  return `'${path.replace(/'/g, `'\\''`)}'`;
}

export default function App() {
  const [theme, setTheme] = useState<Theme>(APPEARANCE_DEFAULTS.theme);
  const [texture, setTexture] = useState<Texture>(APPEARANCE_DEFAULTS.texture);
  const [fz, setFz] = useState(APPEARANCE_DEFAULTS.fz);
  const [tfz, setTfz] = useState(APPEARANCE_DEFAULTS.tfz);
  const [brightness, setBrightness] = useState(APPEARANCE_DEFAULTS.brightness);
  const [texAmt, setTexAmt] = useState(APPEARANCE_DEFAULTS.texAmt);
  const [accent, setAccent] = useState<string | null>(APPEARANCE_DEFAULTS.accent);
  const [bg, setBg] = useState<string | null>(APPEARANCE_DEFAULTS.bg);
  const [tiles, setTiles] = useState<TileDecl[]>(INITIAL_TILES);
  const [activeId, setActiveId] = useState<string>("");
  const [layout, setLayout] = useState<Layout>(APPEARANCE_DEFAULTS.layout);
  const [alertStyle, setAlertStyle] = useState<AlertStyle>(
    APPEARANCE_DEFAULTS.alertStyle,
  );
  const [alertMenuOpen, setAlertMenuOpen] = useState(false);
  const [alertHoverId, setAlertHoverId] = useState<AlertStyle | null>(null);
  const alertMenuRef = useRef<HTMLDivElement | null>(null);
  const [layoutMenuOpen, setLayoutMenuOpen] = useState(false);
  const layoutMenuRef = useRef<HTMLDivElement | null>(null);
  const [themeMenuOpen, setThemeMenuOpen] = useState(false);
  const themeMenuRef = useRef<HTMLDivElement | null>(null);
  const [appearanceLoaded, setAppearanceLoaded] = useState(false);
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [pendingClose, setPendingClose] = useState<string | null>(null);
  const [resetMenuOpen, setResetMenuOpen] = useState(false);
  const [fzMenuOpen, setFzMenuOpen] = useState(false);
  const fzMenuRef = useRef<HTMLDivElement | null>(null);
  const [tfzMenuOpen, setTfzMenuOpen] = useState(false);
  const tfzMenuRef = useRef<HTMLDivElement | null>(null);
  const [brightnessMenuOpen, setBrightnessMenuOpen] = useState(false);
  const brightnessMenuRef = useRef<HTMLDivElement | null>(null);
  const [batchMenuOpen, setBatchMenuOpen] = useState(false);
  const batchMenuRef = useRef<HTMLDivElement | null>(null);
  const [killAllOpen, setKillAllOpen] = useState(false);
  const gridRef = useRef<HTMLDivElement | null>(null);
  const { kill, list, sendInput, ackStatus } = useSessions();

  const renameTile = useCallback((key: string, next: string) => {
    const trimmed = next.trim();
    if (!trimmed) return;
    setTiles((prev) =>
      prev.map((t) => (t.key === key ? { ...t, name: trimmed } : t)),
    );
  }, []);

  const reviveTile = useCallback((key: string) => {
    setTiles((prev) =>
      prev.map((t) =>
        t.key === key ? { ...t, sleeping: false, status: "working" } : t,
      ),
    );
    setActiveId(key);
  }, []);

  const closeTile = useCallback(
    (key: string) => {
      kill(key).catch(() => {});
      setTiles((prev) => {
        const next = prev.filter((t) => t.key !== key);
        if (next.length === 0) return next;
        if (key === activeId) {
          const idx = prev.findIndex((t) => t.key === key);
          const fallback = next[Math.min(idx, next.length - 1)];
          if (fallback) setActiveId(fallback.key);
        }
        return next;
      });
    },
    [kill, activeId],
  );

  const [dragKey, setDragKey] = useState<string | null>(null);
  // Swap-on-drop: the key of the tile the dragged tile would swap with.
  // null = no swap target (drop is a no-op, ghost snaps back).
  const [dragSwapKey, setDragSwapKey] = useState<string | null>(null);
  const [ghostStyle, setGhostStyle] = useState<{
    x: number;
    y: number;
    w: number;
    h: number;
    name: string;
  } | null>(null);

  const dragHappenedRef = useRef(false);
  const tilesRef = useRef(tiles);
  useEffect(() => {
    tilesRef.current = tiles;
  }, [tiles]);
  const handleTileHeadPointerDown = useCallback(
    (ev: React.PointerEvent<HTMLElement>, tileKey: string, name: string) => {
      if (ev.button !== 0) return;
      const target = ev.target as HTMLElement;
      // Don't start a drag from interactive children. The .name span is
      // intentionally NOT excluded — clicking/holding the name should drag
      // the tile (rename happens only on dblclick, handled separately).
      if (target.closest(".t-close, .t-reveal, .name-edit")) return;

      const startX = ev.clientX;
      const startY = ev.clientY;
      const tileEl = (ev.currentTarget as HTMLElement).closest<HTMLElement>("section.tile");
      if (!tileEl) return;
      const GHOST_W = 220;
      const GHOST_H = 38;
      let activated = false;
      let lastSwapKey: string | null = null;

      const onMove = (e: PointerEvent) => {
        if (!activated) {
          if (Math.hypot(e.clientX - startX, e.clientY - startY) < 5) return;
          activated = true;
          dragHappenedRef.current = true;
          setDragKey(tileKey);
          setGhostStyle({
            x: e.clientX - GHOST_W / 2,
            y: e.clientY - GHOST_H / 2,
            w: GHOST_W,
            h: GHOST_H,
            name,
          });
          document.body.style.cursor = "grabbing";
        } else {
          setGhostStyle((prev) =>
            prev
              ? { ...prev, x: e.clientX - GHOST_W / 2, y: e.clientY - GHOST_H / 2 }
              : prev,
          );
          // Swap-on-drop: find the nearest non-source tile by center
          // distance. Whichever tile center is closest to the cursor
          // becomes the swap target. Works identically in Row, Grid, and
          // Focus — the geometry of the layout doesn't matter.
          const grid = gridRef.current;
          if (!grid) return;
          const sections = grid.querySelectorAll<HTMLElement>(
            "section.tile[data-session-key]",
          );
          type Nearest = { key: string; dist: number };
          let nearest: Nearest | null = null;
          sections.forEach((el) => {
            const k = el.dataset.sessionKey;
            if (!k || k === tileKey) return;
            const r = el.getBoundingClientRect();
            // Skip if cursor is far outside this tile's bounds. We only
            // consider tiles within "magnetic range" of the cursor — half
            // a tile-width/height beyond their edges. Past that, no swap
            // target (drop = no-op).
            const padX = r.width * 0.5;
            const padY = r.height * 0.5;
            if (
              e.clientX < r.left - padX ||
              e.clientX > r.right + padX ||
              e.clientY < r.top - padY ||
              e.clientY > r.bottom + padY
            ) {
              return;
            }
            const cx = r.left + r.width / 2;
            const cy = r.top + r.height / 2;
            const d = Math.hypot(e.clientX - cx, e.clientY - cy);
            if (nearest === null || d < nearest.dist) {
              nearest = { key: k, dist: d };
            }
          });
          const newSwap = (nearest as Nearest | null)?.key ?? null;
          lastSwapKey = newSwap;
          setDragSwapKey(newSwap);
        }
      };

      // lastSwapKey hoisted above onMove so finish() reads the latest
      // candidate synchronously without going through React state.
      const finish = (commit: boolean) => {
        document.removeEventListener("pointermove", onMove);
        document.removeEventListener("pointerup", onUp);
        document.removeEventListener("pointercancel", onCancel);
        document.body.style.cursor = "";
        if (commit && activated && lastSwapKey && lastSwapKey !== tileKey) {
          setTiles((prev) => {
            const aIdx = prev.findIndex((t) => t.key === tileKey);
            const bIdx = prev.findIndex((t) => t.key === lastSwapKey);
            if (aIdx < 0 || bIdx < 0) return prev;
            const next = prev.slice();
            [next[aIdx], next[bIdx]] = [next[bIdx], next[aIdx]];
            return next;
          });
        }
        setDragSwapKey(null);
        setDragKey(null);
        setGhostStyle(null);
      };
      const onUp = () => finish(true);
      const onCancel = () => finish(false);

      document.addEventListener("pointermove", onMove);
      document.addEventListener("pointerup", onUp);
      document.addEventListener("pointercancel", onCancel);
    },
    [],
  );

  const tileRectsRef = useRef<Map<string, DOMRect>>(new Map());
  const tilesOrderKey = tiles.map((t) => t.key).join(",");
  useLayoutEffect(() => {
    const grid = gridRef.current;
    if (!grid) return;
    const prev = tileRectsRef.current;
    const next = new Map<string, DOMRect>();
    const sections = grid.querySelectorAll<HTMLElement>("section.tile[data-session-key]");
    sections.forEach((el) => {
      const key = el.dataset.sessionKey;
      if (!key) return;
      const rect = el.getBoundingClientRect();
      next.set(key, rect);
      const before = prev.get(key);
      if (before) {
        const dx = before.left - rect.left;
        const dy = before.top - rect.top;
        if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) {
          el.animate(
            [
              { transform: `translate(${dx}px, ${dy}px)` },
              { transform: "translate(0, 0)" },
            ],
            {
              duration: 520,
              easing: "cubic-bezier(0.34, 1.15, 0.64, 1)",
              fill: "both",
            },
          );
        }
      }
    });
    tileRectsRef.current = next;
  }, [tilesOrderKey]);

  const tileCount = tiles.length;
  const defaults = useMemo(
    () => defaultTracks(layout, tileCount),
    [layout, tileCount],
  );
  const [colFrs, setColFrs] = useState<number[]>(defaults.cols);
  const [rowFrs, setRowFrs] = useState<number[]>(defaults.rows);

  useEffect(() => {
    setColFrs(defaults.cols);
    setRowFrs(defaults.rows);
    // Tell every TerminalView to force-refit; xterm's WebGL canvas can lag
    // a frame behind a layout change, especially when the tile count grows.
    requestAnimationFrame(() => {
      window.dispatchEvent(new Event("en:refit"));
    });
  }, [defaults]);

  // Guard against ever rendering a stale fr array against the current track
  // count — happens for one paint when tiles is updated before the
  // defaults effect runs. Falls back to the defaults sized for *now*.
  const effectiveColFrs =
    colFrs.length === defaults.cols.length ? colFrs : defaults.cols;
  const effectiveRowFrs =
    rowFrs.length === defaults.rows.length ? rowFrs : defaults.rows;

  useEffect(() => {
    let cancelled = false;
    loadAppearance().then((a) => {
      if (cancelled) return;
      setTheme(a.theme);
      setTexture(a.texture);
      setLayout(a.layout);
      setFz(a.fz);
      setTfz(a.tfz);
      setBrightness(a.brightness);
      setTexAmt(a.texAmt);
      setAccent(a.accent);
      setBg(a.bg);
      setAlertStyle(a.alertStyle);
      setAppearanceLoaded(true);
    });
    loadTileSlots().then((slots) => {
      if (cancelled || slots.length === 0) return;
      const restored: TileDecl[] = slots.map((s) => ({
        key: s.key,
        name: s.name,
        cwd: s.cwd,
        path: s.path,
        meta: "",
        status: "idle",
        sleeping: true,
      }));
      setTiles(restored);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Persist tile slots whenever the array changes (after initial load).
  useEffect(() => {
    if (!appearanceLoaded) return;
    const slots: TileSlot[] = tiles
      .filter((t) => !!t.cwd)
      .map((t) => ({ key: t.key, name: t.name, cwd: t.cwd!, path: t.path }));
    saveTileSlots(slots);
  }, [appearanceLoaded, tiles]);

  useEffect(() => {
    if (!appearanceLoaded) return;
    const next: Appearance = {
      theme,
      texture,
      layout,
      fz,
      tfz,
      texAmt,
      brightness,
      accent,
      bg,
      alertStyle,
    };
    saveAppearance(next);
  }, [
    appearanceLoaded,
    theme,
    texture,
    layout,
    fz,
    tfz,
    texAmt,
    brightness,
    accent,
    bg,
    alertStyle,
  ]);

  useEffect(() => {
    document.documentElement.dataset.alertStyle = alertStyle;
  }, [alertStyle]);

  useEffect(() => {
    if (!alertMenuOpen) return;
    const onPointer = (e: MouseEvent) => {
      if (!alertMenuRef.current) return;
      if (!alertMenuRef.current.contains(e.target as Node)) {
        setAlertMenuOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setAlertMenuOpen(false);
    };
    window.addEventListener("mousedown", onPointer);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onPointer);
      window.removeEventListener("keydown", onKey);
    };
  }, [alertMenuOpen]);

  useEffect(() => {
    if (!layoutMenuOpen) return;
    const onPointer = (e: MouseEvent) => {
      if (!layoutMenuRef.current) return;
      if (!layoutMenuRef.current.contains(e.target as Node)) {
        setLayoutMenuOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setLayoutMenuOpen(false);
    };
    window.addEventListener("mousedown", onPointer);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onPointer);
      window.removeEventListener("keydown", onKey);
    };
  }, [layoutMenuOpen]);

  useEffect(() => {
    if (!themeMenuOpen) return;
    const onPointer = (e: MouseEvent) => {
      if (!themeMenuRef.current) return;
      if (!themeMenuRef.current.contains(e.target as Node)) {
        setThemeMenuOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setThemeMenuOpen(false);
    };
    window.addEventListener("mousedown", onPointer);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onPointer);
      window.removeEventListener("keydown", onKey);
    };
  }, [themeMenuOpen]);

  useEffect(() => {
    if (!fzMenuOpen) return;
    const onPointer = (e: MouseEvent) => {
      if (!fzMenuRef.current) return;
      if (!fzMenuRef.current.contains(e.target as Node)) setFzMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setFzMenuOpen(false);
    };
    window.addEventListener("mousedown", onPointer);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onPointer);
      window.removeEventListener("keydown", onKey);
    };
  }, [fzMenuOpen]);

  useEffect(() => {
    if (!batchMenuOpen) return;
    const onPointer = (e: MouseEvent) => {
      if (!batchMenuRef.current) return;
      if (!batchMenuRef.current.contains(e.target as Node)) setBatchMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setBatchMenuOpen(false);
    };
    window.addEventListener("mousedown", onPointer);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onPointer);
      window.removeEventListener("keydown", onKey);
    };
  }, [batchMenuOpen]);

  useEffect(() => {
    if (!tfzMenuOpen) return;
    const onPointer = (e: MouseEvent) => {
      if (!tfzMenuRef.current) return;
      if (!tfzMenuRef.current.contains(e.target as Node)) setTfzMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setTfzMenuOpen(false);
    };
    window.addEventListener("mousedown", onPointer);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onPointer);
      window.removeEventListener("keydown", onKey);
    };
  }, [tfzMenuOpen]);

  useEffect(() => {
    if (!brightnessMenuOpen) return;
    const onPointer = (e: MouseEvent) => {
      if (!brightnessMenuRef.current) return;
      if (!brightnessMenuRef.current.contains(e.target as Node))
        setBrightnessMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setBrightnessMenuOpen(false);
    };
    window.addEventListener("mousedown", onPointer);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onPointer);
      window.removeEventListener("keydown", onKey);
    };
  }, [brightnessMenuOpen]);

  useEffect(() => {
    document.documentElement.style.setProperty(
      "--app-brightness",
      brightness.toString(),
    );
  }, [brightness]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);
  useEffect(() => {
    document.documentElement.dataset.texture = texture;
  }, [texture]);
  useEffect(() => {
    document.documentElement.style.setProperty("--fz", String(fz));
  }, [fz]);
  useEffect(() => {
    document.documentElement.style.setProperty("--tfz", String(tfz));
  }, [tfz]);
  useEffect(() => {
    document.documentElement.style.setProperty("--tex-amt", String(texAmt));
  }, [texAmt]);
  useEffect(() => {
    if (accent === null) {
      document.documentElement.style.removeProperty("--accent");
      document.documentElement.style.removeProperty("--accent-glow");
    } else {
      document.documentElement.style.setProperty("--accent", accent);
      document.documentElement.style.setProperty(
        "--accent-glow",
        hexToRgba(accent, 0.32),
      );
    }
  }, [accent]);
  useEffect(() => {
    const root = document.documentElement.style;
    if (bg === null) {
      root.removeProperty("--bg");
      root.removeProperty("--tile");
      root.removeProperty("--tile-2");
    } else {
      root.setProperty("--bg", shiftLightness(bg, -8));
      root.setProperty("--tile", bg);
      root.setProperty("--tile-2", shiftLightness(bg, 7));
    }
  }, [bg]);

  // Sessions are ensured by the TerminalView for each tile, after xterm
  // measures itself, so the PTY is spawned at the real cols/rows.

  const tileCountRef = useRef(tiles.length);
  useEffect(() => {
    tileCountRef.current = tiles.length;
  }, [tiles.length]);

  const spawn = useCallback(async () => {
    if (tileCountRef.current >= MAX_TILES) return;
    let chosen: string | null = null;
    try {
      const result = await openDialog({
        directory: true,
        multiple: false,
        title: "Choose a folder for the new claude session",
      });
      chosen = typeof result === "string" ? result : null;
    } catch {
      return;
    }
    if (!chosen) return;
    const name = basename(chosen);
    const key = `${name}-${Date.now().toString(36)}`;
    const decl: TileDecl = {
      key,
      name,
      path: deriveDisplayPath(chosen),
      cwd: chosen,
      meta: "",
      status: "working",
    };
    setTiles((prev) => [...prev, decl]);
    setActiveId(key);
  }, []);

  const spawnBatch = useCallback(async (n: number) => {
    const room = MAX_TILES - tileCountRef.current;
    if (room <= 0) return;
    const want = Math.min(n, room);
    let picks: string[] = [];
    try {
      const result = await openDialog({
        directory: true,
        multiple: true,
        title: `Pick up to ${want} folder${want === 1 ? "" : "s"}`,
      });
      picks = Array.isArray(result) ? result : result ? [result] : [];
    } catch {
      return;
    }
    if (picks.length === 0) return;
    const chosen = picks.slice(0, want);
    const stamp = Date.now().toString(36);
    const decls: TileDecl[] = chosen.map((cwd, i) => {
      const name = basename(cwd);
      return {
        key: `${name}-${stamp}-${i}`,
        name,
        path: deriveDisplayPath(cwd),
        cwd,
        meta: "",
        status: "working",
      };
    });
    setTiles((prev) => [...prev, ...decls]);
    setActiveId(decls[decls.length - 1].key);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Don't hijack keys while one of our own editable controls is focused
      // (e.g. the tile name-edit input). xterm has its own hidden textarea
      // that always has focus when a tile is active — we MUST still process
      // hub-level shortcuts (⌘N, ⌘W, ⌘+arrow) over it, otherwise navigation
      // never works.
      const target = e.target as HTMLElement | null;
      const inXterm = !!target?.closest(".xterm-host");
      if (
        target &&
        !inXterm &&
        (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)
      ) {
        return;
      }
      if (!e.metaKey || e.altKey || e.ctrlKey) return;

      // ⌘+N — spawn a new session.
      if (e.code === "KeyN") {
        e.preventDefault();
        spawn();
        return;
      }

      // ⌘+W — request close of active session (shows confirm modal).
      if (e.code === "KeyW") {
        e.preventDefault();
        if (activeId) setPendingClose(activeId);
        return;
      }

      // ⌘+1..9 jumps to the Nth tile.
      if (/^Digit[1-9]$/.test(e.code)) {
        const idx = parseInt(e.code.slice(5), 10) - 1;
        if (idx < tiles.length) {
          e.preventDefault();
          setActiveId(tiles[idx].key);
        }
        return;
      }

      const dir =
        e.key === "ArrowLeft"
          ? "left"
          : e.key === "ArrowRight"
            ? "right"
            : e.key === "ArrowUp"
              ? "up"
              : e.key === "ArrowDown"
                ? "down"
                : null;
      if (!dir) return;

      const grid = gridRef.current;
      if (!grid) return;
      const tileEls = Array.from(
        grid.querySelectorAll<HTMLElement>(":scope > .tile:not(.tile-spawn)"),
      );
      if (tileEls.length < 2) return;

      const activeIdx = tiles.findIndex((t) => t.key === activeId);
      if (activeIdx < 0) return;
      const cur = tileEls[activeIdx]?.getBoundingClientRect();
      if (!cur) return;
      const cx = cur.left + cur.width / 2;
      const cy = cur.top + cur.height / 2;

      let bestIdx = -1;
      let bestScore = Infinity;
      for (let i = 0; i < tileEls.length; i++) {
        if (i === activeIdx) continue;
        const r = tileEls[i].getBoundingClientRect();
        const rx = r.left + r.width / 2;
        const ry = r.top + r.height / 2;
        const dx = rx - cx;
        const dy = ry - cy;
        const inDir =
          (dir === "left" && dx < -1) ||
          (dir === "right" && dx > 1) ||
          (dir === "up" && dy < -1) ||
          (dir === "down" && dy > 1);
        if (!inDir) continue;
        const primary =
          dir === "left" || dir === "right" ? Math.abs(dx) : Math.abs(dy);
        const cross =
          dir === "left" || dir === "right" ? Math.abs(dy) : Math.abs(dx);
        const score = primary + cross * 4;
        if (score < bestScore) {
          bestScore = score;
          bestIdx = i;
        }
      }
      if (bestIdx >= 0) {
        e.preventDefault();
        setActiveId(tiles[bestIdx].key);
      }
    };
    window.addEventListener("keydown", onKey, { capture: true });
    return () =>
      window.removeEventListener("keydown", onKey, { capture: true });
  }, [activeId, tiles, spawn, closeTile]);

  /* Drag-and-drop files/folders/screenshots into a tile.
     Routes to the tile under the cursor; falls back to the focused tile
     when dropped on empty grid space. Mirrors Terminal.app's behavior:
     paths are POSIX-quoted and joined with spaces, no auto-Enter. */
  const [dragOverKey, setDragOverKey] = useState<string | null>(null);
  const activeIdRef = useRef(activeId);
  useEffect(() => {
    activeIdRef.current = activeId;
  }, [activeId]);
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    const tileKeyAt = (x: number, y: number): string | null => {
      /* First try DOM hit-test — fastest path. */
      const el = document.elementFromPoint(x, y);
      const tileEl = el?.closest<HTMLElement>(".tile:not(.empty-state)");
      if (tileEl?.dataset.sessionKey) return tileEl.dataset.sessionKey;
      /* Fallback: hit-test against each tile's bounding rect.
         elementFromPoint can land on overlay siblings (.grid-handle,
         popovers, decorative overlays) that don't sit inside .tile. */
      const tiles = document.querySelectorAll<HTMLElement>(
        '.tile[data-session-key]',
      );
      for (const t of tiles) {
        const r = t.getBoundingClientRect();
        if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) {
          return t.dataset.sessionKey ?? null;
        }
      }
      return null;
    };

    /* StrictMode-safe: cancelled is checked when the async listener
       registration resolves. If cleanup already ran, we unregister
       immediately so we never end up with two live listeners. */
    let cancelled = false;
    (async () => {
      const webview = getCurrentWebview();
      const off = await webview.onDragDropEvent((event) => {
        const p = event.payload;
        if (p.type === "enter" || p.type === "over") {
          const { x, y } = p.position;
          /* Don't fall back to activeId for the visual hover state —
             that made the ring stick to the active tile during any
             frame where elementFromPoint missed (handle, gap, etc.).
             If we genuinely don't know what tile, show no ring. */
          setDragOverKey(tileKeyAt(x, y));
        } else if (p.type === "leave") {
          setDragOverKey(null);
        } else if (p.type === "drop") {
          const { x, y } = p.position;
          /* Drop routing still falls back to active — better to send
             the path somewhere reasonable than swallow the drop. */
          const targetKey = tileKeyAt(x, y) ?? activeIdRef.current;
          setDragOverKey(null);
          if (!targetKey || p.paths.length === 0) return;
          const text = p.paths.map(shellQuotePath).join(" ") + " ";
          void sendInput(targetKey, text);
        }
      });
      if (cancelled) {
        off();
      } else {
        unlisten = off;
      }
    })().catch((err) => {
      console.error("drag-drop wiring failed:", err);
    });

    /* Swallow HTML5 drag/drop at the document level so xterm.js's
       built-in drop handler doesn't ALSO paste the path. Tauri's
       native onDragDropEvent above is the only path. */
    const swallow = (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
    };
    window.addEventListener("dragover", swallow, { capture: true });
    window.addEventListener("drop", swallow, { capture: true });

    return () => {
      cancelled = true;
      unlisten?.();
      setDragOverKey(null);
      window.removeEventListener("dragover", swallow, { capture: true });
      window.removeEventListener("drop", swallow, { capture: true });
    };
  }, [sendInput]);

  const bumpFz = (delta: number) =>
    setFz((v) => Math.max(0.7, Math.min(1.6, +(v + delta).toFixed(2))));
  const bumpTfz = (delta: number) =>
    setTfz((v) => Math.max(0.7, Math.min(1.6, +(v + delta).toFixed(2))));
  const bumpBrightness = (delta: number) =>
    setBrightness((v) => Math.max(0.5, Math.min(2.0, +(v + delta).toFixed(2))));
  const bumpTexAmt = (delta: number) =>
    setTexAmt((v) => Math.max(0.2, Math.min(2.0, +(v + delta).toFixed(2))));

  const statusByKey = new Map(list.map((s) => [s.key, s.status]));
  const tilesWithStatus = tiles.map((t) => {
    const s = statusByKey.get(t.key);
    let status: DisplayStatus = t.status;
    let meta = t.meta;
    if (s === "spawning") {
      status = "idle";
      meta = "kindling…";
    } else if (s === "exited") {
      status = "stale";
      meta = "exited";
    } else if (s === "failed") {
      status = "stale";
      meta = "failed";
    } else if (s === "working" || s === "needs" || s === "idle") {
      status = s;
    }
    return { ...t, status, meta };
  });

  return (
    <div className="app">
      {(texture === "petals-fall" || texture === "shuriken-fall") && (
        <FallingTexture kind={texture === "petals-fall" ? "petals" : "shuriken"} />
      )}
      <div className="titlebar" data-tauri-drag-region>
        <WindowControls />
        <div className="brand">
          <svg
            className="brand-mark"
            viewBox="0 0 44 44"
            fill="none"
            aria-hidden="true"
          >
            <g stroke="currentColor" strokeWidth="3" strokeLinecap="round">
              <path d="M5 12 Q22 8 39 12" />
              <line x1="11" y1="18" x2="33" y2="18" />
              <line x1="14" y1="12" x2="14" y2="36" />
              <line x1="30" y1="12" x2="30" y2="36" />
            </g>
          </svg>
          en
          {(theme === "washi" || theme === "washi-kyokujitsu") && (
            <span
              className="brand-hinomaru"
              aria-hidden="true"
              title={theme === "washi-kyokujitsu" ? "Kyokujitsu" : "Hinomaru"}
            />
          )}
        </div>
        <div className="status">
          <button
            className="spawn-btn"
            onClick={spawn}
            disabled={tiles.length >= MAX_TILES}
            title={
              tiles.length >= MAX_TILES
                ? `Hub at capacity (${MAX_TILES})`
                : "Kindle a new session (⌘N)"
            }
            aria-label="Kindle new session"
          >
            <svg
              className="spawn-btn-plus"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              aria-hidden="true"
            >
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
          </button>
          <div className="alert-style-wrap" ref={batchMenuRef}>
            <button
              className="alert-style-trigger icon-only batch-trigger"
              aria-expanded={batchMenuOpen}
              aria-haspopup="menu"
              onClick={() => setBatchMenuOpen((v) => !v)}
              title="Kindle multiple sessions at once"
              aria-label="Kindle multiple sessions"
            >
              <span className="batch-trigger-glyph" aria-hidden="true">#</span>
            </button>
            {batchMenuOpen && (
              <div className="alert-style-popover batch-popover" role="menu">
                <div className="batch-popover-label">
                  how many? <span className="batch-cap">{tiles.length}/{MAX_TILES}</span>
                </div>
                {[1, 2, 3, 4, 5, 6, 7, 8].map((n) => {
                  const room = MAX_TILES - tiles.length;
                  const disabled = n > room;
                  return (
                    <button
                      key={n}
                      className="alert-style-option batch-option"
                      role="menuitem"
                      disabled={disabled}
                      onClick={() => {
                        setBatchMenuOpen(false);
                        void spawnBatch(n);
                      }}
                      title={
                        disabled
                          ? `Only ${room} slot${room === 1 ? "" : "s"} left`
                          : `Pick ${n} folder${n === 1 ? "" : "s"}`
                      }
                    >
                      <span className="glyph batch-kanji" aria-hidden="true">
                        {["一", "二", "三", "四", "五", "六", "七", "八"][n - 1]}
                      </span>
                      <span>{n === 1 ? "one folder" : `${n} folders`}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
          <button
            className="reset-sizes-btn"
            onClick={() => setResetMenuOpen(true)}
            title="Reset…"
            aria-label="Open reset menu"
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <polyline points="23 4 23 10 17 10" />
              <polyline points="1 20 1 14 7 14" />
              <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10" />
              <path d="M20.49 15a9 9 0 0 1-14.85 3.36L1 14" />
            </svg>
          </button>
        </div>
        <div className="alert-style-wrap" ref={themeMenuRef}>
          <button
            className="alert-style-trigger icon-only"
            aria-expanded={themeMenuOpen}
            aria-haspopup="menu"
            onClick={() => setThemeMenuOpen((v) => !v)}
            title={`Theme: ${THEMES.find((t) => t.id === theme)?.title ?? "Theme"}`}
            aria-label="Theme"
          >
            <span
              className="theme-trigger-dot"
              aria-hidden="true"
              style={{
                background: `linear-gradient(135deg, ${bg ?? THEME_BGS[theme]} 50%, ${accent ?? THEME_ACCENTS[theme]} 50%)`,
              }}
            />
          </button>
          {themeMenuOpen && (
            <div className="alert-style-popover theme-popover" role="menu">
              <div className="theme-section">
                <div className="theme-section-label">Theme</div>
                <div className="themes inline-themes">
                  {THEMES.map((t) => (
                    <button
                      key={t.id}
                      data-set={t.id}
                      data-active={theme === t.id ? "true" : undefined}
                      title={t.title}
                      onClick={() => setTheme(t.id)}
                    />
                  ))}
                </div>
              </div>
              <div className="theme-section theme-row">
                <div className="theme-row-label">Accent</div>
                <label
                  className="accent-swatch"
                  title="Pick accent color"
                  style={{ background: accent ?? THEME_ACCENTS[theme] }}
                >
                  <input
                    type="color"
                    value={accent ?? THEME_ACCENTS[theme]}
                    onChange={(e) => setAccent(e.target.value)}
                  />
                </label>
                {accent !== null && (
                  <button
                    className="accent-reset"
                    onClick={() => setAccent(null)}
                    title="Reset accent to theme default"
                  >
                    ×
                  </button>
                )}
              </div>
              <div className="theme-section theme-row">
                <div className="theme-row-label">Background</div>
                <label
                  className="accent-swatch"
                  title="Pick background color"
                  style={{ background: bg ?? THEME_BGS[theme] }}
                >
                  <input
                    type="color"
                    value={bg ?? THEME_BGS[theme]}
                    onChange={(e) => setBg(e.target.value)}
                  />
                </label>
                {bg !== null && (
                  <button
                    className="accent-reset"
                    onClick={() => setBg(null)}
                    title="Reset background to theme default"
                  >
                    ×
                  </button>
                )}
              </div>
              <div className="theme-section">
                <div className="theme-section-label">Texture</div>
                <div className="textures inline-textures">
                  {TEXTURES.filter((t) => !t.id.endsWith("-fall")).map((t) => (
                    <button
                      key={t.id}
                      className="texture-chip"
                      data-tex={t.id}
                      data-active={texture === t.id ? "true" : undefined}
                      title={t.title}
                      onClick={() => setTexture(t.id)}
                    >
                      <span className="texture-chip-label">
                        {t.id === "none" ? "off" : t.id}
                      </span>
                    </button>
                  ))}
                  {(() => {
                    const normal = TEXTURES.filter(
                      (t) => !t.id.endsWith("-fall"),
                    ).length;
                    return Array.from({ length: (3 - (normal % 3)) % 3 }).map(
                      (_, i) => (
                        <div
                          key={`fill-${i}`}
                          className="texture-chip texture-chip-filler"
                          aria-hidden="true"
                        />
                      ),
                    );
                  })()}
                  {TEXTURES.filter((t) => t.id.endsWith("-fall")).map((t) => (
                    <button
                      key={t.id}
                      className="texture-chip texture-chip-rain"
                      data-tex={t.id}
                      data-active={texture === t.id ? "true" : undefined}
                      title={t.title}
                      onClick={() => setTexture(t.id)}
                    >
                      <span className="texture-chip-label">
                        {t.id === "petals-fall" ? "sakura rain" : "shuriken rain"}
                      </span>
                    </button>
                  ))}
                </div>
                <div className="theme-row theme-amt-row">
                  <div className="theme-row-label">Texture strength</div>
                  <button onClick={() => bumpTexAmt(-0.1)} title="Subdue texture">−</button>
                  <span className="val">{Math.round(texAmt * 100)}%</span>
                  <button onClick={() => bumpTexAmt(0.1)} title="Strengthen texture">+</button>
                </div>
              </div>
            </div>
          )}
        </div>
        <div className="alert-style-wrap" ref={layoutMenuRef}>
          <button
            className="alert-style-trigger icon-only"
            aria-expanded={layoutMenuOpen}
            aria-haspopup="menu"
            onClick={() => setLayoutMenuOpen((v) => !v)}
            title={`Layout: ${LAYOUTS.find((l) => l.id === layout)?.title ?? "Row"}`}
            aria-label="Layout"
          >
            <span className="trigger-glyph" aria-hidden="true">
              <LayoutGlyph id={layout} />
            </span>
          </button>
          {layoutMenuOpen && (
            <div className="alert-style-popover" role="menu">
              {LAYOUTS.map((l) => (
                <button
                  key={l.id}
                  className="alert-style-option"
                  role="menuitemradio"
                  aria-checked={layout === l.id}
                  data-active={layout === l.id ? "true" : undefined}
                  onClick={() => {
                    setLayout(l.id);
                    setLayoutMenuOpen(false);
                  }}
                >
                  <span className="glyph" aria-hidden="true">
                    <LayoutGlyph id={l.id} />
                  </span>
                  <span>{l.title}</span>
                  <span className="desc">{l.desc}</span>
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="alert-style-wrap" ref={alertMenuRef}>
          <button
            className="alert-style-trigger icon-only"
            aria-expanded={alertMenuOpen}
            aria-haspopup="menu"
            onClick={() => setAlertMenuOpen((v) => !v)}
            title={`Alert: ${ALERT_STYLES.find((s) => s.id === alertStyle)?.title ?? "Andon"}`}
            aria-label="Alert style"
          >
            <span className="trigger-glyph" aria-hidden="true">
              <AlertGlyph id={alertStyle} />
            </span>
          </button>
          {alertMenuOpen && (
            <div
              className="alert-style-popover"
              role="menu"
              onMouseLeave={() => setAlertHoverId(null)}
            >
              {ALERT_STYLES.map((s) => (
                <button
                  key={s.id}
                  className="alert-style-option"
                  role="menuitemradio"
                  aria-checked={alertStyle === s.id}
                  data-active={alertStyle === s.id ? "true" : undefined}
                  onMouseEnter={() => setAlertHoverId(s.id)}
                  onFocus={() => setAlertHoverId(s.id)}
                  onClick={() => {
                    setAlertStyle(s.id);
                    setAlertMenuOpen(false);
                    setAlertHoverId(null);
                  }}
                >
                  <span className="glyph" aria-hidden="true">
                    <AlertGlyph id={s.id} />
                  </span>
                  <span>{s.title}</span>
                  <span className="desc">{s.desc}</span>
                  {alertHoverId === s.id && (
                    <div
                      className="alert-style-preview"
                      data-alert-style={s.id}
                      aria-hidden="true"
                    >
                      <div className="tile needs">
                        <AlertExtras style={s.id} />
                      </div>
                    </div>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="alert-style-wrap" ref={fzMenuRef}>
          <button
            className="alert-style-trigger icon-only fz-trigger"
            aria-expanded={fzMenuOpen}
            aria-haspopup="menu"
            onClick={() => setFzMenuOpen((v) => !v)}
            title={`App font size: ${Math.round(fz * 100)}%`}
            aria-label="App font size"
          >
            <span className="fz-trigger-aa" aria-hidden="true">Aa</span>
          </button>
          {fzMenuOpen && (
            <div className="alert-style-popover fz-popover" role="menu">
              <div className="fz-popover-row">
                <span className="fz-popover-label">app font size</span>
                <button onClick={() => bumpFz(-0.05)} title="Decrease">−</button>
                <span className="val">{Math.round(fz * 100)}%</span>
                <button onClick={() => bumpFz(0.05)} title="Increase">+</button>
              </div>
            </div>
          )}
        </div>
        <div className="alert-style-wrap" ref={tfzMenuRef}>
          <button
            className="alert-style-trigger icon-only fz-trigger"
            aria-expanded={tfzMenuOpen}
            aria-haspopup="menu"
            onClick={() => setTfzMenuOpen((v) => !v)}
            title={`Terminal font size: ${Math.round(tfz * 100)}%`}
            aria-label="Terminal font size"
          >
            <span className="fz-trigger-glyph" aria-hidden="true">
              <svg
                viewBox="0 0 16 12"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.4"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <rect x="1" y="1" width="14" height="10" rx="1.5" />
                <path d="M4 5l2 2-2 2" />
                <line x1="7.5" y1="9" x2="11" y2="9" />
              </svg>
            </span>
          </button>
          {tfzMenuOpen && (
            <div className="alert-style-popover fz-popover" role="menu">
              <div className="fz-popover-row">
                <span className="fz-popover-label">terminal font size</span>
                <button onClick={() => bumpTfz(-0.05)} title="Decrease">−</button>
                <span className="val">{Math.round(tfz * 100)}%</span>
                <button onClick={() => bumpTfz(0.05)} title="Increase">+</button>
              </div>
            </div>
          )}
        </div>
        <div className="alert-style-wrap" ref={brightnessMenuRef}>
          <button
            className="alert-style-trigger icon-only fz-trigger"
            aria-expanded={brightnessMenuOpen}
            aria-haspopup="menu"
            onClick={() => setBrightnessMenuOpen((v) => !v)}
            title={`App brightness: ${Math.round(brightness * 100)}%`}
            aria-label="App brightness"
          >
            <span className="fz-trigger-glyph" aria-hidden="true">
              <svg
                viewBox="0 0 16 16"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.4"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <circle cx="8" cy="8" r="3" />
                <line x1="8" y1="1.5" x2="8" y2="3" />
                <line x1="8" y1="13" x2="8" y2="14.5" />
                <line x1="1.5" y1="8" x2="3" y2="8" />
                <line x1="13" y1="8" x2="14.5" y2="8" />
                <line x1="3.4" y1="3.4" x2="4.5" y2="4.5" />
                <line x1="11.5" y1="11.5" x2="12.6" y2="12.6" />
                <line x1="3.4" y1="12.6" x2="4.5" y2="11.5" />
                <line x1="11.5" y1="4.5" x2="12.6" y2="3.4" />
              </svg>
            </span>
          </button>
          {brightnessMenuOpen && (
            <div className="alert-style-popover fz-popover" role="menu">
              <div className="fz-popover-row">
                <span className="fz-popover-label">app brightness</span>
                <button onClick={() => bumpBrightness(-0.1)} title="Dim">−</button>
                <span className="val">{Math.round(brightness * 100)}%</span>
                <button onClick={() => bumpBrightness(0.1)} title="Brighten">+</button>
              </div>
            </div>
          )}
        </div>
        <button
          className="alert-style-trigger icon-only kill-all-btn"
          onClick={() => setKillAllOpen(true)}
          disabled={tiles.length === 0}
          title={
            tiles.length === 0
              ? "No sessions to extinguish"
              : `Extinguish all sessions (${tiles.length})`
          }
          aria-label="Extinguish all sessions"
        >
          <span className="trigger-glyph" aria-hidden="true">
            <SkullGlyph />
          </span>
        </button>
      </div>

      <div
        className="grid"
        data-count={tilesWithStatus.length}
        data-layout={layout}
        ref={gridRef}
        style={{
          gridTemplateColumns: effectiveColFrs.map((f) => `${f}fr`).join(" "),
          gridTemplateRows: effectiveRowFrs.map((f) => `${f}fr`).join(" "),
        }}
      >
        {tilesWithStatus.length === 0 && (
          <div className="empty-state">
            <span className="empty-line">no sessions</span>
            <button className="empty-cta" onClick={spawn}>
              kindle one <kbd>⌘ N</kbd>
            </button>
          </div>
        )}
        {tilesWithStatus.map((s) => {
          const isSwapTarget = dragKey !== null && dragSwapKey === s.key && dragKey !== s.key;
          return (
          <section
            key={s.key}
            data-session-key={s.key}
            data-dragging={dragKey === s.key ? "true" : undefined}
            data-swap-target={isSwapTarget ? "true" : undefined}
            data-sleeping={s.sleeping ? "true" : undefined}
            className={`tile ${s.status} ${activeId === s.key ? "active" : ""}`}
            onClick={() => {
              if (dragHappenedRef.current) {
                dragHappenedRef.current = false;
                return;
              }
              setActiveId(s.key);
              ackStatus(s.key);
            }}
          >
            {dragOverKey === s.key && <div className="tile-drop-ring" aria-hidden="true" />}
            <header
              className="t-head"
              onPointerDown={(ev) => handleTileHeadPointerDown(ev, s.key, s.name)}
            >
              <span className="dot"></span>
              {editingKey === s.key ? (
                <input
                  className="name name-edit"
                  autoFocus
                  defaultValue={s.name}
                  onClick={(ev) => ev.stopPropagation()}
                  onBlur={(ev) => {
                    renameTile(s.key, ev.currentTarget.value);
                    setEditingKey(null);
                  }}
                  onKeyDown={(ev) => {
                    if (ev.key === "Enter") {
                      renameTile(s.key, ev.currentTarget.value);
                      setEditingKey(null);
                    } else if (ev.key === "Escape") {
                      setEditingKey(null);
                    }
                  }}
                />
              ) : (
                <span
                  className="name"
                  title="Double-click to rename"
                  onDoubleClick={(ev) => {
                    ev.stopPropagation();
                    setEditingKey(s.key);
                  }}
                >
                  {s.name}
                </span>
              )}
              <span className="meta">{s.meta}</span>
              {s.cwd && (
                <button
                  className="t-reveal"
                  title="Open in Finder"
                  aria-label="Open in Finder"
                  onClick={(ev) => {
                    ev.stopPropagation();
                    void openPath(s.cwd!);
                  }}
                >
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.75"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <path d="M4 7a2 2 0 0 1 2-2h4l2 2h6a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z" />
                    <path d="M11 13l3-3" />
                    <path d="M14 13V10h-3" />
                  </svg>
                </button>
              )}
              <button
                className="t-close"
                title="Close session (⌘W)"
                aria-label="Close session"
                onClick={(ev) => {
                  ev.stopPropagation();
                  setPendingClose(s.key);
                }}
              >
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.75"
                  strokeLinecap="round"
                  aria-hidden="true"
                >
                  <line x1="6" y1="6" x2="18" y2="18" />
                  <line x1="18" y1="6" x2="6" y2="18" />
                </svg>
              </button>
            </header>
            {s.status === "needs" && !s.sleeping && <AlertExtras style={alertStyle} />}
            <div className="t-body">
              {s.sleeping ? (
                <SleepingTileBody
                  cwd={s.cwd ?? ""}
                  onRevive={() => reviveTile(s.key)}
                />
              ) : (
                <TerminalView
                  decl={{
                    key: s.key,
                    name: s.name,
                    path: s.path,
                    cwd: s.cwd,
                    cmd: s.cmd,
                  }}
                  theme={theme}
                  fontScale={tfz}
                  accent={accent ?? undefined}
                  bg={bg ?? undefined}
                  active={activeId === s.key}
                />
              )}
            </div>
          </section>
          );
        })}
        <GridResizeHandles
          gridRef={gridRef}
          layout={layout}
          count={tilesWithStatus.length}
          colFrs={colFrs}
          rowFrs={rowFrs}
          setColFrs={setColFrs}
          setRowFrs={setRowFrs}
        />
      </div>

      <div className="foot">
        <span className="group">
          navigate <kbd>⌘</kbd>
          <kbd>←</kbd>
          <kbd>→</kbd>
          <kbd>↑</kbd>
          <kbd>↓</kbd>
        </span>
        <span className="group">
          close <kbd>⌘</kbd>
          <kbd>W</kbd>
        </span>
        <span className="right">
          focus <b>{tilesWithStatus.find((s) => s.key === activeId)?.name ?? "—"}</b>
        </span>
      </div>
      {killAllOpen && (
        <ConfirmKillAllModal
          count={tiles.length}
          onCancel={() => setKillAllOpen(false)}
          onConfirm={() => {
            const keys = tiles.map((t) => t.key);
            setKillAllOpen(false);
            for (const k of keys) closeTile(k);
          }}
        />
      )}
      {pendingClose !== null && (
        <ConfirmCloseModal
          name={tiles.find((t) => t.key === pendingClose)?.name ?? "session"}
          onCancel={() => setPendingClose(null)}
          onConfirm={() => {
            const k = pendingClose;
            setPendingClose(null);
            if (k) closeTile(k);
          }}
        />
      )}
      {resetMenuOpen && (
        <ResetMenuModal
          onClose={() => setResetMenuOpen(false)}
          actions={{
            terminalSizes: () => {
              setColFrs(defaults.cols);
              setRowFrs(defaults.rows);
              window.dispatchEvent(new Event("en:refit"));
            },
            appFontSize: () => setFz(APPEARANCE_DEFAULTS.fz),
            termFontSize: () => setTfz(APPEARANCE_DEFAULTS.tfz),
            themeColors: () => {
              setAccent(null);
              setBg(null);
            },
            allAppearance: () => {
              setTheme(APPEARANCE_DEFAULTS.theme);
              setTexture(APPEARANCE_DEFAULTS.texture);
              setLayout(APPEARANCE_DEFAULTS.layout);
              setFz(APPEARANCE_DEFAULTS.fz);
              setTfz(APPEARANCE_DEFAULTS.tfz);
              setTexAmt(APPEARANCE_DEFAULTS.texAmt);
              setBrightness(APPEARANCE_DEFAULTS.brightness);
              setAccent(APPEARANCE_DEFAULTS.accent);
              setBg(APPEARANCE_DEFAULTS.bg);
              setAlertStyle(APPEARANCE_DEFAULTS.alertStyle);
            },
          }}
        />
      )}
      {ghostStyle && (
        <div
          className="tile-drag-ghost"
          aria-hidden="true"
          style={{
            transform: `translate(${ghostStyle.x}px, ${ghostStyle.y}px)`,
            width: ghostStyle.w,
            height: ghostStyle.h,
          }}
        >
          <div className="tile-drag-ghost-head">
            <span className="dot" />
            <span className="name">{ghostStyle.name}</span>
          </div>
        </div>
      )}
    </div>
  );
}

function AlertExtras({ style }: { style: AlertStyle }) {
  if (style === "hotaru") {
    return (
      <div className="alert-extras" aria-hidden="true">
        <span className="laser" />
      </div>
    );
  }
  if (style === "triple") {
    return (
      <div className="alert-extras" aria-hidden="true">
        <span className="slash s1" />
        <span className="slash s2" />
        <span className="slash s3" />
      </div>
    );
  }
  if (style === "vertical") {
    return (
      <div className="alert-extras" aria-hidden="true">
        <span className="vfall" />
        <span className="vseam" />
      </div>
    );
  }
  if (style === "sakura") {
    const drift = Array.from({ length: 6 });
    const pile = Array.from({ length: 36 });
    const Petal = () => (
      <svg viewBox="-5 -8 10 14" width="11" height="15">
        <path
          d="M0,-7 C2.5,-5 4,-2 4,0 C4,2.5 2,4.5 0,5 C-2,4.5 -4,2.5 -4,0 C-4,-2 -2.5,-5 0,-7 Z"
          fill="currentColor"
        />
      </svg>
    );
    return (
      <div className="alert-extras" aria-hidden="true">
        <div className="petals">
          {drift.map((_, i) => (
            <span key={`d${i}`} className="petal drift">
              <Petal />
            </span>
          ))}
          {pile.map((_, i) => (
            <span key={`p${i}`} className="petal pile">
              <Petal />
            </span>
          ))}
        </div>
      </div>
    );
  }
  if (style === "shuriken") {
    const slots: Array<{
      cls: string;
      top: string;
      left: string;
      tx: string;
      ty: string;
      rot: string;
      bx: string;
      by: string;
      delay: string;
    }> = [
      { cls: "a1", top: "22%", left: "28%", tx: "-160px", ty: "-120px", rot: "540deg",  bx: "-2px", by: "1px",  delay: "0s" },
      { cls: "a2", top: "52%", left: "70%", tx: "200px",  ty: "-100px", rot: "-480deg", bx: "1px",  by: "2px",  delay: "0.2s" },
      { cls: "a3", top: "64%", left: "22%", tx: "-180px", ty: "140px",  rot: "600deg",  bx: "-2px", by: "-1px", delay: "0.4s" },
      { cls: "a4", top: "30%", left: "56%", tx: "220px",  ty: "-160px", rot: "-540deg", bx: "2px",  by: "-1px", delay: "0.6s" },
      { cls: "b1", top: "38%", left: "18%", tx: "-200px", ty: "160px",  rot: "480deg",  bx: "-1px", by: "2px",  delay: "-4.5s" },
      { cls: "b2", top: "26%", left: "72%", tx: "180px",  ty: "200px",  rot: "-600deg", bx: "2px",  by: "-2px", delay: "-4.3s" },
      { cls: "b3", top: "70%", left: "50%", tx: "0px",    ty: "220px",  rot: "720deg",  bx: "0px",  by: "-2px", delay: "-4.1s" },
      { cls: "b4", top: "48%", left: "36%", tx: "-220px", ty: "-40px",  rot: "-540deg", bx: "-2px", by: "1px",  delay: "-3.9s" },
    ];
    return (
      <div className="alert-extras" aria-hidden="true">
        <div className="ninja-stage">
          {slots.map((s) => {
            const style = {
              top: s.top,
              left: s.left,
              ["--tx" as string]: s.tx,
              ["--ty" as string]: s.ty,
              ["--rot" as string]: s.rot,
              ["--bx" as string]: s.bx,
              ["--by" as string]: s.by,
              animationDelay: s.delay,
            } as React.CSSProperties;
            return (
              <span key={s.cls} className={`shuri ${s.cls}`} style={style}>
                <svg viewBox="0 0 32 32" fill="currentColor">
                  <path d="M16 2 L19 13 L30 16 L19 19 L16 30 L13 19 L2 16 L13 13 Z" />
                  <circle cx="16" cy="16" r="2.5" fill="var(--bg)" />
                </svg>
              </span>
            );
          })}
          {slots.map((s) => (
            <span
              key={`f-${s.cls}`}
              className="impact"
              style={{
                top: s.top,
                left: s.left,
                animationDelay: s.delay,
              }}
            />
          ))}
        </div>
      </div>
    );
  }
  if (style === "hinode") {
    return (
      <div className="alert-extras" aria-hidden="true">
        <div className="hinode-stage">
          <div className="hinode-disc" />
          <div className="hinode-horizon" />
        </div>
      </div>
    );
  }
  // pulse / heartbeat / breath: no DOM extras — pure border animation
  return null;
}

function LayoutGlyph({ id }: { id: Layout }) {
  const props = { size: 14, strokeWidth: 1.75 } as const;
  switch (id) {
    case "row":   return <Columns3 {...props} />;
    case "grid":  return <LayoutGrid {...props} />;
    case "focus": return <LayoutPanelLeft {...props} />;
  }
}

function AlertGlyph({ id }: { id: AlertStyle }) {
  const props = { size: 14, strokeWidth: 1.75 } as const;
  switch (id) {
    case "pulse":     return (
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
        <ellipse cx="8" cy="8" rx="6.2" ry="2.6" stroke="currentColor" strokeWidth="1.4" />
      </svg>
    );
    case "heartbeat": return <HeartPulse {...props} />;
    case "breath":    return <Wind {...props} />;
    case "hotaru":    return <Bug {...props} />;
    case "triple":
      return (
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
          <line x1="1" y1="13" x2="6" y2="3" />
          <line x1="5.5" y1="13" x2="10.5" y2="3" />
          <line x1="10" y1="13" x2="15" y2="3" />
        </svg>
      );
    case "vertical":
      return (
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
          <line x1="5.5" y1="13" x2="10.5" y2="3" />
        </svg>
      );
    case "sakura":    return (
      <svg width="14" height="14" viewBox="0 0 16 16">
        <defs>
          <path id="ag-p" d="M0,-7 C2.5,-5 4,-2 4,0 C4,2.5 2,4.5 0,5 C-2,4.5 -4,2.5 -4,0 C-4,-2 -2.5,-5 0,-7 Z" fill="currentColor" />
        </defs>
        <use href="#ag-p" transform="translate(4 3.5) rotate(-30) scale(0.42)" />
        <use href="#ag-p" transform="translate(10.5 7.5) rotate(40) scale(0.52)" />
        <use href="#ag-p" transform="translate(5.5 12) rotate(80) scale(0.38)" />
      </svg>
    );
    case "shuriken":  return (
      <svg width="14" height="14" viewBox="-8 -8 16 16">
        <path
          d="M0,-7 L1.6,-1.6 L7,0 L1.6,1.6 L0,7 L-1.6,1.6 L-7,0 L-1.6,-1.6 Z"
          fill="currentColor"
        />
        <circle r="1.1" fill="var(--bg)" />
      </svg>
    );
    case "hinode": return (
      // Rising-sun glyph: half-disc above a horizon line, three short rays.
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
        <path d="M3 11 a5 5 0 0 1 10 0" fill="currentColor" stroke="none" />
        <line x1="1.5" y1="11.5" x2="14.5" y2="11.5" />
        <line x1="8" y1="2.5" x2="8" y2="4" />
        <line x1="3.5" y1="4" x2="4.5" y2="5.5" />
        <line x1="12.5" y1="4" x2="11.5" y2="5.5" />
      </svg>
    );
  }
}

function SkullGlyph() {
  /* Minimal single-stroke skull — two dot eyes, three teeth.
     14×14 viewBox to match the layout/alert lucide glyphs. */
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M3 7.5 C3 4.5 5 2.5 8 2.5 C11 2.5 13 4.5 13 7.5 L13 10 L11 10 L11 12 L9 12 L9 10.5 L7 10.5 L7 12 L5 12 L5 10 L3 10 Z" />
      <circle cx="6" cy="7" r="0.9" fill="currentColor" stroke="none" />
      <circle cx="10" cy="7" r="0.9" fill="currentColor" stroke="none" />
    </svg>
  );
}

function SleepingTileBody({
  cwd,
  onRevive,
}: {
  cwd: string;
  onRevive: () => void;
}) {
  // Display path: replace home prefix with ~, ellipsis-truncate the middle
  // for readability. The full path lives in the title attr for exact recall.
  const display = cwd.replace(/^\/Users\/[^/]+/, "~");
  return (
    <div className="sleeping-body">
      <button
        type="button"
        className="sleeping-revive"
        onClick={(ev) => {
          ev.stopPropagation();
          onRevive();
        }}
        title={`Revive session in ${cwd}`}
      >
        click to revive
      </button>
      <div className="sleeping-cwd" title={cwd}>
        {display}
      </div>
    </div>
  );
}

function ConfirmKillAllModal({
  count,
  onCancel,
  onConfirm,
}: {
  count: number;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const confirmRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    confirmRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onCancel();
      } else if (e.key === "Enter") {
        e.preventDefault();
        onConfirm();
      }
    };
    window.addEventListener("keydown", onKey, { capture: true });
    return () =>
      window.removeEventListener("keydown", onKey, { capture: true });
  }, [onCancel, onConfirm]);
  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-title">Extinguish all sessions</div>
        <div className="modal-body">
          End <b>{count}</b> session{count === 1 ? "" : "s"}? Any in-progress
          work will be lost.
        </div>
        <div className="modal-actions">
          <button className="modal-cancel" onClick={onCancel}>
            cancel <kbd>esc</kbd>
          </button>
          <button
            ref={confirmRef}
            className="modal-confirm"
            onClick={onConfirm}
          >
            extinguish all <kbd>↵</kbd>
          </button>
        </div>
      </div>
    </div>
  );
}

function WindowControls() {
  const handleClose = useCallback(() => {
    void getCurrentWindow().close();
  }, []);
  const handleMinimize = useCallback(() => {
    void getCurrentWindow().minimize();
  }, []);
  const handleFullscreen = useCallback(async () => {
    const w = getCurrentWindow();
    const isFs = await w.isFullscreen();
    void w.setFullscreen(!isFs);
  }, []);
  return (
    <div className="window-controls">
      <button
        className="wc wc-close"
        onClick={handleClose}
        title="Close window (⌘Q)"
        aria-label="Close window"
      />
      <button
        className="wc wc-min"
        onClick={handleMinimize}
        title="Minimize window (⌘M)"
        aria-label="Minimize window"
      />
      <button
        className="wc wc-full"
        onClick={handleFullscreen}
        title="Toggle fullscreen (⌃⌘F)"
        aria-label="Toggle fullscreen"
      />
    </div>
  );
}

function ConfirmCloseModal({
  name,
  onCancel,
  onConfirm,
}: {
  name: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const confirmRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    confirmRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onCancel();
      } else if (e.key === "Enter") {
        e.preventDefault();
        onConfirm();
      }
    };
    window.addEventListener("keydown", onKey, { capture: true });
    return () =>
      window.removeEventListener("keydown", onKey, { capture: true });
  }, [onCancel, onConfirm]);
  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-title">Close session</div>
        <div className="modal-body">
          End <b>{name}</b>? Any in-progress work in this terminal will be lost.
        </div>
        <div className="modal-actions">
          <button className="modal-cancel" onClick={onCancel}>
            cancel <kbd>esc</kbd>
          </button>
          <button
            ref={confirmRef}
            className="modal-confirm"
            onClick={onConfirm}
          >
            close session <kbd>↵</kbd>
          </button>
        </div>
      </div>
    </div>
  );
}

function ResetMenuModal({
  onClose,
  actions,
}: {
  onClose: () => void;
  actions: {
    terminalSizes: () => void;
    appFontSize: () => void;
    termFontSize: () => void;
    themeColors: () => void;
    allAppearance: () => void;
  };
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey, { capture: true });
    return () =>
      window.removeEventListener("keydown", onKey, { capture: true });
  }, [onClose]);
  const items: { label: string; desc: string; run: () => void }[] = [
    {
      label: "terminal sizes",
      desc: "snap grid tracks back to layout default",
      run: actions.terminalSizes,
    },
    {
      label: "app font size",
      desc: "reset app chrome scale to 100%",
      run: actions.appFontSize,
    },
    {
      label: "terminal font size",
      desc: "reset xterm scale to 100%",
      run: actions.termFontSize,
    },
    {
      label: "theme colors",
      desc: "drop custom accent + background overrides",
      run: actions.themeColors,
    },
    {
      label: "all appearance",
      desc: "theme · accent · bg · texture · sizes · alert",
      run: actions.allAppearance,
    },
  ];
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal reset-modal"
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-title">Reset…</div>
        <div className="reset-list">
          {items.map((it) => (
            <button
              key={it.label}
              className="reset-item"
              onClick={() => {
                it.run();
                onClose();
              }}
            >
              <span className="reset-item-label">{it.label}</span>
              <span className="reset-item-desc">{it.desc}</span>
            </button>
          ))}
        </div>
        <div className="modal-actions">
          <button className="modal-cancel" onClick={onClose}>
            cancel <kbd>esc</kbd>
          </button>
        </div>
      </div>
    </div>
  );
}

function FallingTexture({ kind }: { kind: "petals" | "shuriken" }) {
  const count = kind === "petals" ? 18 : 12;
  return (
    <div className={`tex-fall-layer tex-fall-${kind}`} aria-hidden="true">
      {Array.from({ length: count }).map((_, i) => (
        <span key={i} className="tex-fall-particle">
          {kind === "petals" ? (
            <svg viewBox="-5 -8 10 14" width="11" height="15">
              <path
                d="M0,-7 C2.5,-5 4,-2 4,0 C4,2.5 2,4.5 0,5 C-2,4.5 -4,2.5 -4,0 C-4,-2 -2.5,-5 0,-7 Z"
                fill="currentColor"
              />
            </svg>
          ) : (
            <svg viewBox="-8 -8 16 16" width="18" height="18">
              <g fill="currentColor">
                <path d="M0,-7 L1.6,-1.6 L7,0 L1.6,1.6 L0,7 L-1.6,1.6 L-7,0 L-1.6,-1.6 Z" />
              </g>
              <circle r="1.2" fill="rgba(0,0,0,0.55)" />
            </svg>
          )}
        </span>
      ))}
    </div>
  );
}
