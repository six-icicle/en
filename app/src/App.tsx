import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import {
  Activity,
  Bug,
  Columns3,
  Flower2,
  Grid3x3,
  HeartPulse,
  LayoutGrid,
  LayoutPanelLeft,
  MoveVertical,
  Sparkles,
  Star,
  Sword,
  Wind,
} from "lucide-react";
import TerminalView from "./Terminal";
import { useSessions, type SessionDecl } from "./sessions";
import GridResizeHandles from "./GridResizeHandles";
import {
  APPEARANCE_DEFAULTS,
  loadAppearance,
  saveAppearance,
  type AlertStyle,
  type Appearance,
  type Layout,
  type Texture,
  type Theme,
} from "./persistence";
import "./App.css";
type DisplayStatus = "working" | "needs" | "idle" | "stale";

type TileDecl = SessionDecl & {
  meta: string;
  status: DisplayStatus;
};

const THEMES: { id: Theme; title: string }[] = [
  { id: "kanagawa", title: "Kanagawa Sumi" },
  { id: "everforest", title: "Everforest Dusk" },
  { id: "rose-pine", title: "Rose Pine Moon" },
  { id: "rose-pine-alt", title: "Rose Pine Moon (alt)" },
  { id: "original", title: "Original (dark amber)" },
];

const THEME_ACCENTS: Record<Theme, string> = {
  kanagawa: "#c0a36e",
  everforest: "#a7c080",
  "rose-pine": "#ea9a97",
  "rose-pine-alt": "#ea9a97",
  original: "#f0a929",
};

const THEME_BGS: Record<Theme, string> = {
  kanagawa: "#25252e",
  everforest: "#2d353b",
  "rose-pine": "#232136",
  "rose-pine-alt": "#2a273f",
  original: "#0e1114",
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
];

const LAYOUTS: { id: Layout; title: string; desc: string }[] = [
  { id: "row",   title: "Row",   desc: "single row" },
  { id: "grid",  title: "Quad",  desc: "2×2" },
  { id: "wide",  title: "Hex",   desc: "2×3" },
  { id: "focus", title: "Focus", desc: "active big" },
];

const ALERT_STYLES: { id: AlertStyle; title: string; desc: string }[] = [
  { id: "pulse",     title: "Andon",         desc: "soft halo" },
  { id: "heartbeat", title: "Kodou",         desc: "lub-dub" },
  { id: "breath",    title: "Kokyu",         desc: "slow inhale" },
  { id: "hotaru",    title: "Hotaru",        desc: "racing firefly" },
  { id: "samurai",   title: "Samurai",       desc: "katana sheen" },
  { id: "triple",    title: "Sandangiri",    desc: "three cuts" },
  { id: "vertical",  title: "Tatewari",      desc: "falling cut" },
  { id: "sakura",    title: "Sakura",        desc: "petals fall" },
  { id: "ninja",     title: "Ninja",         desc: "corner strike" },
  { id: "shuriken",  title: "Shuriken",      desc: "throw + stick" },
];

function defaultTracks(layout: Layout, count: number): { cols: number[]; rows: number[] } {
  if (count <= 0) return { cols: [1], rows: [1] };
  if (count === 1) return { cols: [1], rows: [1] };
  if (layout === "row") {
    return { cols: Array(count).fill(1), rows: [1] };
  }
  if (layout === "grid") {
    if (count === 2) return { cols: [1, 1], rows: [1] };
    const rows = Math.ceil(count / 2);
    return { cols: [1, 1], rows: Array(rows).fill(1) };
  }
  if (layout === "wide") {
    if (count === 2) return { cols: [1, 1], rows: [1] };
    if (count === 3) return { cols: [1, 1, 1], rows: [1] };
    return { cols: [1, 1, 1], rows: count <= 6 ? [1, 1] : [1, 1, 1] };
  }
  // focus
  if (count === 2) return { cols: [2, 1], rows: [1] };
  if (count === 3) return { cols: [2, 1], rows: [1, 1] };
  if (count === 4) return { cols: [2, 1], rows: [1, 1, 1] };
  if (count === 5) return { cols: [2, 1, 1], rows: [1, 1] };
  return { cols: [1, 1, 1], rows: [1, 1, 1] };
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

export default function App() {
  const [theme, setTheme] = useState<Theme>(APPEARANCE_DEFAULTS.theme);
  const [texture, setTexture] = useState<Texture>(APPEARANCE_DEFAULTS.texture);
  const [fz, setFz] = useState(APPEARANCE_DEFAULTS.fz);
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
  const alertMenuRef = useRef<HTMLDivElement | null>(null);
  const [layoutMenuOpen, setLayoutMenuOpen] = useState(false);
  const layoutMenuRef = useRef<HTMLDivElement | null>(null);
  const [themeMenuOpen, setThemeMenuOpen] = useState(false);
  const themeMenuRef = useRef<HTMLDivElement | null>(null);
  const [appearanceLoaded, setAppearanceLoaded] = useState(false);
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [pendingClose, setPendingClose] = useState<string | null>(null);
  const gridRef = useRef<HTMLDivElement | null>(null);
  const { kill, list } = useSessions();

  const renameTile = useCallback((key: string, next: string) => {
    const trimmed = next.trim();
    if (!trimmed) return;
    setTiles((prev) =>
      prev.map((t) => (t.key === key ? { ...t, name: trimmed } : t)),
    );
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
      setTexAmt(a.texAmt);
      setAccent(a.accent);
      setBg(a.bg);
      setAlertStyle(a.alertStyle);
      setAppearanceLoaded(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!appearanceLoaded) return;
    const next: Appearance = {
      theme,
      texture,
      layout,
      fz,
      texAmt,
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
    texAmt,
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
    document.documentElement.dataset.theme = theme;
  }, [theme]);
  useEffect(() => {
    document.documentElement.dataset.texture = texture;
  }, [texture]);
  useEffect(() => {
    document.documentElement.style.setProperty("--fz", String(fz));
  }, [fz]);
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

  const spawn = useCallback(async () => {
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

  const bumpFz = (delta: number) =>
    setFz((v) => Math.max(0.7, Math.min(1.6, +(v + delta).toFixed(2))));
  const bumpTexAmt = (delta: number) =>
    setTexAmt((v) => Math.max(0.2, Math.min(2.0, +(v + delta).toFixed(2))));

  const statusByKey = new Map(list.map((s) => [s.key, s.status]));
  const tilesWithStatus = tiles.map((t) => {
    const s = statusByKey.get(t.key);
    let status: DisplayStatus = t.status;
    let meta = t.meta;
    if (s === "spawning") {
      status = "idle";
      meta = "spawning…";
    } else if (s === "exited") {
      status = "stale";
      meta = "exited";
    } else if (s === "failed") {
      status = "stale";
      meta = "failed";
    }
    return { ...t, status, meta };
  });

  return (
    <div className="app">
      <div className="titlebar">
        <div className="brand">
          en
        </div>
        <div className="status">
          <button
            className="spawn-btn"
            onClick={spawn}
            title="Spawn a new session"
            aria-label="Spawn new session"
          >
            <span className="spawn-btn-plus">+</span>
            <span className="spawn-btn-label">new session</span>
            <kbd className="spawn-btn-kbd">⌘N</kbd>
          </button>
          <button
            className="reset-sizes-btn"
            onClick={() => {
              setColFrs(defaults.cols);
              setRowFrs(defaults.rows);
              window.dispatchEvent(new Event("en:refit"));
            }}
            title="Reset all terminal sizes to default"
            aria-label="Reset terminal sizes"
          >
            reset sizes
          </button>
        </div>
        <div className="alert-style-wrap" ref={themeMenuRef}>
          <span className="label">theme</span>
          <button
            className="alert-style-trigger"
            aria-expanded={themeMenuOpen}
            aria-haspopup="menu"
            onClick={() => setThemeMenuOpen((v) => !v)}
            title="Theme + accent + background + texture"
          >
            <span
              className="theme-trigger-swatch"
              aria-hidden="true"
              style={{ background: accent ?? THEME_ACCENTS[theme] }}
            />
            <span>{THEMES.find((t) => t.id === theme)?.title ?? "Theme"}</span>
            <span className="caret">▾</span>
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
                  {TEXTURES.map((t) => (
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
          <span className="label">layout</span>
          <button
            className="alert-style-trigger"
            aria-expanded={layoutMenuOpen}
            aria-haspopup="menu"
            onClick={() => setLayoutMenuOpen((v) => !v)}
            title="Tile layout"
          >
            <span className="trigger-glyph" aria-hidden="true">
              <LayoutGlyph id={layout} />
            </span>
            <span>{LAYOUTS.find((l) => l.id === layout)?.title ?? "Row"}</span>
            <span className="caret">▾</span>
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
          <span className="label">alert</span>
          <button
            className="alert-style-trigger"
            aria-expanded={alertMenuOpen}
            aria-haspopup="menu"
            onClick={() => setAlertMenuOpen((v) => !v)}
            title="Alert style — visual treatment when a session needs you"
          >
            <span className="swatch" />
            <span>{ALERT_STYLES.find((s) => s.id === alertStyle)?.title ?? "Andon"}</span>
            <span className="caret">▾</span>
          </button>
          {alertMenuOpen && (
            <div className="alert-style-popover" role="menu">
              {ALERT_STYLES.map((s) => (
                <button
                  key={s.id}
                  className="alert-style-option"
                  role="menuitemradio"
                  aria-checked={alertStyle === s.id}
                  data-active={alertStyle === s.id ? "true" : undefined}
                  onClick={() => {
                    setAlertStyle(s.id);
                    setAlertMenuOpen(false);
                  }}
                >
                  <span className="glyph" aria-hidden="true">
                    <AlertGlyph id={s.id} />
                  </span>
                  <span>{s.title}</span>
                  <span className="desc">{s.desc}</span>
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="fz">
          <span className="label">font size</span>
          <button onClick={() => bumpFz(-0.05)} title="Decrease font size">−</button>
          <span className="val">{Math.round(fz * 100)}%</span>
          <button onClick={() => bumpFz(0.05)} title="Increase font size">+</button>
        </div>
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
              spawn one <kbd>⌘N</kbd>
            </button>
          </div>
        )}
        {tilesWithStatus.map((s) => (
          <section
            key={s.key}
            className={`tile ${s.status} ${activeId === s.key ? "active" : ""}`}
            onClick={() => setActiveId(s.key)}
          >
            <header className="t-head">
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
              <button
                className="t-close"
                title="Close session (⌘W)"
                aria-label="Close session"
                onClick={(ev) => {
                  ev.stopPropagation();
                  setPendingClose(s.key);
                }}
              >
                ×
              </button>
            </header>
            {s.status === "needs" && <AlertExtras style={alertStyle} />}
            <div className="t-body">
              <TerminalView
                decl={{
                  key: s.key,
                  name: s.name,
                  path: s.path,
                  cwd: s.cwd,
                  cmd: s.cmd,
                }}
                theme={theme}
                fontScale={fz}
                accent={accent ?? undefined}
                bg={bg ?? undefined}
                active={activeId === s.key}
              />
            </div>
          </section>
        ))}
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
  if (style === "samurai") {
    return (
      <div className="alert-extras" aria-hidden="true">
        <span className="katana" />
        <div className="hanko">待</div>
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
    return (
      <div className="alert-extras" aria-hidden="true">
        <div className="petals">
          {drift.map((_, i) => (
            <span key={`d${i}`} className="petal drift" />
          ))}
          {pile.map((_, i) => (
            <span key={`p${i}`} className="petal pile" />
          ))}
        </div>
      </div>
    );
  }
  if (style === "ninja") {
    return (
      <div className="alert-extras" aria-hidden="true">
        <span className="smoke" />
        <span className="shuriken">
          <svg viewBox="0 0 32 32" fill="currentColor">
            <path d="M16 2 L19 13 L30 16 L19 19 L16 30 L13 19 L2 16 L13 13 Z" />
            <circle cx="16" cy="16" r="2.5" fill="var(--bg)" />
          </svg>
        </span>
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
  // pulse / heartbeat / breath: no DOM extras — pure border animation
  return null;
}

function LayoutGlyph({ id }: { id: Layout }) {
  const props = { size: 14, strokeWidth: 1.75 } as const;
  switch (id) {
    case "row":   return <Columns3 {...props} />;
    case "grid":  return <LayoutGrid {...props} />;
    case "wide":  return <Grid3x3 {...props} />;
    case "focus": return <LayoutPanelLeft {...props} />;
  }
}

function AlertGlyph({ id }: { id: AlertStyle }) {
  const props = { size: 14, strokeWidth: 1.75 } as const;
  switch (id) {
    case "pulse":     return <Activity {...props} />;
    case "heartbeat": return <HeartPulse {...props} />;
    case "breath":    return <Wind {...props} />;
    case "hotaru":    return <Bug {...props} />;
    case "samurai":   return <Sword {...props} />;
    case "triple":
      return (
        <span className="glyph-stack">
          <Sword size={9} strokeWidth={2} />
          <Sword size={9} strokeWidth={2} />
          <Sword size={9} strokeWidth={2} />
        </span>
      );
    case "vertical":  return <MoveVertical {...props} />;
    case "sakura":    return <Flower2 {...props} />;
    case "ninja":     return <Sparkles {...props} />;
    case "shuriken":  return <Star {...props} />;
  }
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
