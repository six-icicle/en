import { useEffect, useRef } from "react";
import { Terminal as Xterm, type ITheme } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebglAddon } from "@xterm/addon-webgl";
import { useSessions, type SessionDecl } from "./sessions";
import type { Theme } from "./persistence";
import { THEME_ACCENTS, THEME_BGS } from "./themes";

/* WebKit caps WebGL contexts at ~8 per page; xterm's WebGL renderer
   claims one per terminal. Cap ourselves at 6 in prod so HMR/devtools/
   incidental contexts always have headroom. In dev we halve to 3 because
   React StrictMode double-mounts effects — disposed contexts aren't
   reaped by the GPU before the second mount runs, so 6 prod = 12 dev. */
const WEBGL_CAP = import.meta.env.DEV ? 3 : 6;
let webglContextCount = 0;

type Props = {
  decl: SessionDecl;
  theme: Theme;
  fontScale: number;
  accent?: string;
  bg?: string;
  active?: boolean;
};

function themeFor(theme: Theme, accent?: string, bg?: string): ITheme {
  const base = paletteFor(theme);
  if (!accent && !bg) return base;
  return {
    ...base,
    ...(accent ? { cursor: accent } : {}),
    ...(bg ? { background: bg } : {}),
  };
}

const KANAGAWA_ANSI = {
  black: "#16161d",
  red: "#c4746e",
  green: "#76946a",
  yellow: "#c0a36e",
  blue: "#7e9cd8",
  magenta: "#957fb8",
  cyan: "#6a9589",
  white: "#c8c093",
  brightBlack: "#727169",
  brightRed: "#e46876",
  brightGreen: "#98bb6c",
  brightYellow: "#e6c384",
  brightBlue: "#7fb4ca",
  brightMagenta: "#938aa9",
  brightCyan: "#7aa89f",
  brightWhite: "#dcd7ba",
};
const EVERFOREST_ANSI = {
  black: "#475258",
  red: "#e67e80",
  green: "#a7c080",
  yellow: "#dbbc7f",
  blue: "#7fbbb3",
  magenta: "#d699b6",
  cyan: "#83c092",
  white: "#d3c6aa",
  brightBlack: "#56635f",
  brightRed: "#e67e80",
  brightGreen: "#a7c080",
  brightYellow: "#dbbc7f",
  brightBlue: "#7fbbb3",
  brightMagenta: "#d699b6",
  brightCyan: "#83c092",
  brightWhite: "#d3c6aa",
};
const ROSE_PINE_ANSI = {
  black: "#393552",
  red: "#eb6f92",
  green: "#9ccfd8",
  yellow: "#f6c177",
  blue: "#3e8fb0",
  magenta: "#c4a7e7",
  cyan: "#ea9a97",
  white: "#e0def4",
  brightBlack: "#6e6a86",
  brightRed: "#eb6f92",
  brightGreen: "#9ccfd8",
  brightYellow: "#f6c177",
  brightBlue: "#3e8fb0",
  brightMagenta: "#c4a7e7",
  brightCyan: "#ea9a97",
  brightWhite: "#e0def4",
};

// Per-theme xterm specifics (foreground / cursorAccent / selection /
// ANSI). `background` and `cursor` are derived from THEME_BGS /
// THEME_ACCENTS in `themes.ts` so the picker swatch and the live xterm
// canvas can never drift.
type XtermSpec = Omit<ITheme, "background" | "cursor">;
const THEME_XTERM: Record<Theme, XtermSpec> = {
  kanagawa: {
    foreground: "#ece6c4",
    cursorAccent: "#14141c",
    selectionBackground: "#2d4f67",
    ...KANAGAWA_ANSI,
  },
  "kanagawa-soft": {
    foreground: "#dcd7ba",
    cursorAccent: "#2a2a37",
    selectionBackground: "#2d4f67",
    ...KANAGAWA_ANSI,
  },
  everforest: {
    foreground: "#e1d6b5",
    cursorAccent: "#181f23",
    selectionBackground: "#475258",
    ...EVERFOREST_ANSI,
  },
  "everforest-soft": {
    foreground: "#d3c6aa",
    cursorAccent: "#2a3539",
    selectionBackground: "#475258",
    ...EVERFOREST_ANSI,
  },
  "rose-pine": {
    foreground: "#ecebff",
    cursorAccent: "#1a1828",
    selectionBackground: "#44415a",
    ...ROSE_PINE_ANSI,
  },
  "rose-pine-soft": {
    foreground: "#e0def4",
    cursorAccent: "#2a273f",
    selectionBackground: "#44415a",
    ...ROSE_PINE_ANSI,
  },
  hinoki: {
    foreground: "#e3dccb",
    cursorAccent: "#15171a",
    selectionBackground: "#2a3038",
    black: "#1b1d20",
    red: "#e07050",
    green: "#88c99c",
    yellow: "#d49a3a",
    blue: "#7aa6da",
    magenta: "#c594c5",
    cyan: "#85c5b9",
    white: "#e3dccb",
    brightBlack: "#6e6a5e",
    brightRed: "#f08868",
    brightGreen: "#a4cea4",
    brightYellow: "#e8b25a",
    brightBlue: "#9bbfee",
    brightMagenta: "#d6b6d6",
    brightCyan: "#a6d8cd",
    brightWhite: "#f5eede",
  },
  "hinoki-soft": {
    foreground: "#d6d0bf",
    cursorAccent: "#2a2620",
    selectionBackground: "#3a342a",
    black: "#312d26",
    red: "#d97050",
    green: "#88c99c",
    yellow: "#c89656",
    blue: "#8badd2",
    magenta: "#c39ec4",
    cyan: "#96c4ba",
    white: "#d6d0bf",
    brightBlack: "#6a6458",
    brightRed: "#e88868",
    brightGreen: "#a4cea4",
    brightYellow: "#dba972",
    brightBlue: "#a8c5e5",
    brightMagenta: "#d6bbd7",
    brightCyan: "#b1d6cc",
    brightWhite: "#ede5d2",
  },
  // Washi Hinomaru / shironuri — en's first LIGHT terminal palette.
  // Foreground is the accent red, not sumi — user-typed text reads in
  // shu-iro per the user's directive ("submitted message should be red").
  // ANSI colors retuned for WCAG-readable contrast on light bg.
  washi: {
    foreground: "#bc002d",
    cursorAccent: "#ebedf0",
    selectionBackground: "#c8d0db",
    black: "#1a1614",
    red: "#bc002d",
    green: "#4a7d3a",
    yellow: "#a06820",
    blue: "#7291c0",
    magenta: "#7d2d5a",
    cyan: "#2d6a6a",
    white: "#3a3026",
    brightBlack: "#8a7f76",
    brightRed: "#d8233f",
    brightGreen: "#5a8d4a",
    brightYellow: "#b87830",
    brightBlue: "#87a5ce",
    brightMagenta: "#8d3d6a",
    brightCyan: "#3d7a7a",
    brightWhite: "#fbf6eb",
  },
  // Same xterm palette as washi — the kyokujitsu rays render behind the
  // tiles via [data-theme] CSS, not inside the terminal canvas.
  "washi-kyokujitsu": {
    foreground: "#bc002d",
    cursorAccent: "#ebedf0",
    selectionBackground: "#c8d0db",
    black: "#1a1614",
    red: "#bc002d",
    green: "#4a7d3a",
    yellow: "#a06820",
    blue: "#7291c0",
    magenta: "#7d2d5a",
    cyan: "#2d6a6a",
    white: "#3a3026",
    brightBlack: "#8a7f76",
    brightRed: "#d8233f",
    brightGreen: "#5a8d4a",
    brightYellow: "#b87830",
    brightBlue: "#87a5ce",
    brightMagenta: "#8d3d6a",
    brightCyan: "#3d7a7a",
    brightWhite: "#fbf6eb",
  },
  // Washi Tsuki — moonlight on slate. Dark sibling to the washi family.
  // Cold-neutral bg + cool-grey ink, restrained shu accent. ANSI tuned to
  // sit on slate without burning; selection picks the same blue as the
  // light washi so claude's picker bg keeps a coherent identity.
  "washi-tsuki": {
    foreground: "#c8cdd6",
    cursorAccent: "#11141a",
    selectionBackground: "#2c3340",
    black: "#171b22",
    red: "#be4258",
    green: "#7a9778",
    yellow: "#c8a060",
    blue: "#7291c0",
    magenta: "#a47898",
    cyan: "#7a9b9b",
    white: "#c8cdd6",
    brightBlack: "#565b66",
    brightRed: "#d4566c",
    brightGreen: "#8ca888",
    brightYellow: "#dab070",
    brightBlue: "#87a5ce",
    brightMagenta: "#b388a8",
    brightCyan: "#88abab",
    brightWhite: "#dee3ec",
  },
};

function paletteFor(theme: Theme): ITheme {
  return {
    background: THEME_BGS[theme],
    cursor: THEME_ACCENTS[theme],
    ...THEME_XTERM[theme],
  };
}

export default function TerminalView({
  decl,
  theme,
  fontScale,
  accent,
  bg,
  active,
}: Props) {
  const sessionKey = decl.key;
  const containerRef = useRef<HTMLDivElement | null>(null);
  const termRef = useRef<Xterm | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const { ensure, sendInput, resize, subscribe } = useSessions();

  useEffect(() => {
    if (!containerRef.current) return;

    const term = new Xterm({
      fontFamily: "'JetBrains Mono', ui-monospace, monospace",
      fontSize: Math.round(14 * fontScale),
      theme: themeFor(theme, accent, bg),
      cursorBlink: true,
      allowProposedApi: true,
      scrollback: 5000,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(containerRef.current);

    let webgl: WebglAddon | null = null;
    if (webglContextCount < WEBGL_CAP) {
      try {
        webgl = new WebglAddon();
        webgl.onContextLoss(() => webgl?.dispose());
        term.loadAddon(webgl);
        webglContextCount++;
      } catch {
        webgl = null; // fall back to default canvas renderer
      }
    }

    term.attachCustomKeyEventHandler((event) => {
      if (event.type !== "keydown" || event.key !== "Backspace") return true;
      if (event.ctrlKey && !event.metaKey && !event.altKey) {
        sendInput(sessionKey, "\x17");
        return false;
      }
      if (event.metaKey && !event.ctrlKey && !event.altKey) {
        sendInput(sessionKey, "\x15");
        return false;
      }
      return true;
    });

    termRef.current = term;
    fitRef.current = fit;

    let ensured = false;
    let lastCols = 0;
    let lastRows = 0;
    let pendingEnsureFrame: number | null = null;
    let lastMeasuredCols = 0;
    let lastMeasuredRows = 0;
    let stabilityAttempts = 0;
    const MAX_STABILITY_ATTEMPTS = 8;

    // Wait for the container to settle at a stable size before spawning the
    // PTY. First-paint reflow can shrink the container ~10px after layout
    // resolves (flex/grid tracks, font loading). Spawning during that window
    // means claude paints the welcome banner at one column count and we
    // refit to a smaller one — xterm's text buffer truncates rather than
    // re-wraps, erasing the rightmost column (the `│` border of the welcome
    // box). Defer one rAF for paint, then require two consecutive equal
    // measurements; cap at MAX_STABILITY_ATTEMPTS so we always spawn.
    const tryEnsure = () => {
      pendingEnsureFrame = null;
      if (ensured) return;
      const el = containerRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      if (rect.width < 8 || rect.height < 8) {
        pendingEnsureFrame = requestAnimationFrame(tryEnsure);
        return;
      }
      try {
        fit.fit();
      } catch {
        return;
      }
      if (term.cols < 2 || term.rows < 2) return;

      const cols = term.cols;
      const rows = term.rows;
      const stable = cols === lastMeasuredCols && rows === lastMeasuredRows;
      if (!stable && stabilityAttempts < MAX_STABILITY_ATTEMPTS) {
        lastMeasuredCols = cols;
        lastMeasuredRows = rows;
        stabilityAttempts++;
        pendingEnsureFrame = requestAnimationFrame(tryEnsure);
        return;
      }

      ensured = true;
      lastCols = cols;
      lastRows = rows;
      console.log(
        `[en/${decl.key}] ensure: container=${Math.round(rect.width)}x${Math.round(rect.height)} cols=${cols} rows=${rows} (settled in ${stabilityAttempts + 1} ticks)`,
      );
      ensure(decl, cols, rows).catch(() => {});
    };
    pendingEnsureFrame = requestAnimationFrame(tryEnsure);

    const unsubscribe = subscribe(
      sessionKey,
      (bytes) => term.write(bytes),
      () => term.writeln("\r\n\x1b[2m[session ended]\x1b[0m"),
    );

    const onDataDispose = term.onData((data) => {
      sendInput(sessionKey, data);
    });

    let rafId = 0;
    const refit = () => {
      if (rafId) return;
      rafId = requestAnimationFrame(() => {
        rafId = 0;
        // First-paint case: PTY may not be ensured yet because the
        // container had no width. Try again now that we got a resize event.
        if (!ensured) {
          tryEnsure();
          return;
        }
        try {
          fit.fit();
        } catch {
          return;
        }
        if (term.cols !== lastCols || term.rows !== lastRows) {
          const el = containerRef.current;
          const rect = el?.getBoundingClientRect();
          console.log(
            `[en/${decl.key}] refit: container=${rect ? Math.round(rect.width) : "?"}x${rect ? Math.round(rect.height) : "?"} cols=${term.cols} rows=${term.rows}`,
          );
          lastCols = term.cols;
          lastRows = term.rows;
          resize(sessionKey, term.cols, term.rows);
        }
      });
    };
    const ro = new ResizeObserver(refit);
    ro.observe(containerRef.current);
    window.addEventListener("en:refit", refit);

    return () => {
      if (rafId) cancelAnimationFrame(rafId);
      if (pendingEnsureFrame !== null) cancelAnimationFrame(pendingEnsureFrame);
      ro.disconnect();
      window.removeEventListener("en:refit", refit);
      onDataDispose.dispose();
      unsubscribe();
      if (webgl) {
        webgl.dispose();
        webglContextCount = Math.max(0, webglContextCount - 1);
      }
      term.dispose();
      termRef.current = null;
      fitRef.current = null;
    };
    // Theme/font changes are handled by separate effects; we don't want to
    // recreate xterm and replay scrollback on every prop change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionKey]);

  useEffect(() => {
    const term = termRef.current;
    if (!term) return;
    term.options.theme = themeFor(theme, accent, bg);
  }, [theme, accent, bg]);

  useEffect(() => {
    const term = termRef.current;
    const fit = fitRef.current;
    if (!term) return;
    term.options.fontSize = Math.round(14 * fontScale);
    try {
      fit?.fit();
    } catch {
      // ignore
    }
    resize(sessionKey, term.cols, term.rows);
  }, [fontScale, sessionKey, resize]);

  useEffect(() => {
    if (active) termRef.current?.focus();
  }, [active]);

  /* Block native HTML5 drag-and-drop INSIDE the terminal so xterm.js's
     hidden textarea doesn't ALSO receive the path. The OS-level drop
     is handled in App.tsx via Tauri's onDragDropEvent — that sends one
     copy. Without this, macOS's WebView additionally fires a synthetic
     drop on the focused textarea → second paste. */
  useEffect(() => {
    const host = containerRef.current;
    if (!host) return;
    const block = (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
    };
    host.addEventListener("dragenter", block, { capture: true });
    host.addEventListener("dragover", block, { capture: true });
    host.addEventListener("drop", block, { capture: true });
    return () => {
      host.removeEventListener("dragenter", block, { capture: true });
      host.removeEventListener("dragover", block, { capture: true });
      host.removeEventListener("drop", block, { capture: true });
    };
  }, []);

  return <div ref={containerRef} className="xterm-host" />;
}
