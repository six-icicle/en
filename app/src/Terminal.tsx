import { useEffect, useRef } from "react";
import { Terminal as Xterm, type ITheme } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebglAddon } from "@xterm/addon-webgl";
import { useSessionsMethods, type SessionDecl } from "./sessions";
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

/* xterm.js has no `bold:` slot in its ITheme contract — bold is a weight
   attribute, not a color. Claude (and most markdown-style CLIs) emit
   headers as plain `\e[1m` with no color, so they render in `foreground`.
   To paint bold with theme accent, we transform the byte stream in
   place: when `\e[1m` arrives WITHOUT a preceding color in the same
   span, we splice an accent foreground SGR right after it. When color
   arrives explicitly (claude's syntax highlighting), we leave it alone.

   State machine is per-session and survives across PTY chunks (escapes
   can split at any byte boundary). Only intercepts CSI ... m (SGR);
   every other escape passes through untouched. */
function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  const n = parseInt(h.length === 3 ? h.split("").map((c) => c + c).join("") : h, 16);
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}

class BoldColorizer {
  private accentSgr = "";
  private buffered = ""; // partial escape across chunks
  // Streaming UTF-8 decoder so multi-byte chars (e.g. box-drawing `─`,
  // 3 bytes) split across PTY chunks don't get replaced with U+FFFD.
  private decoder = new TextDecoder("utf-8", { fatal: false });
  // span state: bold on? does the current span already have an explicit fg color?
  private boldOn = false;
  private colorOn = false;

  setAccent(hex: string) {
    const [r, g, b] = hexToRgb(hex);
    this.accentSgr = `\x1b[38;2;${r};${g};${b}m`;
  }

  // Walk a complete SGR parameter list (numeric codes between CSI and 'm').
  // Decide AFTER walking all params — same SGR group can carry both bold
  // and color (e.g. \e[1;38;5;240m for dim-grey table borders), and we
  // must not inject our accent in that case.
  private applySgr(params: number[]): { inject: boolean; suppress: boolean } {
    const wasBold = this.boldOn;
    const wasColor = this.colorOn;
    if (params.length === 0) params = [0];
    for (let i = 0; i < params.length; i++) {
      const p = params[i];
      if (p === 0) {
        this.boldOn = false;
        this.colorOn = false;
      } else if (p === 1) {
        this.boldOn = true;
      } else if (p === 22) {
        this.boldOn = false;
      } else if (p === 39) {
        this.colorOn = false;
      } else if ((p >= 30 && p <= 37) || (p >= 90 && p <= 97)) {
        this.colorOn = true;
      } else if (p === 38) {
        this.colorOn = true;
        if (params[i + 1] === 5) i += 2;
        else if (params[i + 1] === 2) i += 4;
      }
    }
    // Inject accent when we transition INTO a bold-no-color span.
    const inBoldNoColor = this.boldOn && !this.colorOn;
    const wasBoldNoColor = wasBold && !wasColor;
    const inject = inBoldNoColor && !wasBoldNoColor;
    // Suppress (= emit default-fg reset) when we leave bold-no-color
    // while our injected accent is still live.
    const suppress = wasBoldNoColor && !inBoldNoColor && this.colorOn === false;
    return { inject, suppress };
  }

  transform(input: Uint8Array): string {
    if (!this.accentSgr) return this.decoder.decode(input, { stream: true });
    const text = this.buffered + this.decoder.decode(input, { stream: true });
    this.buffered = "";
    let out = "";
    let i = 0;
    while (i < text.length) {
      const ch = text[i];
      if (ch !== "\x1b") {
        out += ch;
        i++;
        continue;
      }
      if (i + 1 >= text.length) {
        this.buffered = text.slice(i);
        break;
      }
      if (text[i + 1] !== "[") {
        // non-CSI escape (OSC, charset, etc) — pass through unparsed
        out += text[i] + text[i + 1];
        i += 2;
        continue;
      }
      // scan CSI: params then a final byte 0x40..0x7E
      let j = i + 2;
      while (j < text.length) {
        const code = text.charCodeAt(j);
        if (code >= 0x40 && code <= 0x7e) break;
        j++;
      }
      if (j >= text.length) {
        this.buffered = text.slice(i);
        break;
      }
      const final = text[j];
      const seq = text.slice(i, j + 1);
      i = j + 1;
      if (final !== "m") {
        out += seq;
        continue;
      }
      const body = seq.slice(2, seq.length - 1);
      const params = body.length === 0 ? [] : body.split(";").map((s) => parseInt(s, 10) || 0);
      const { inject, suppress } = this.applySgr(params);
      out += seq;
      if (inject) out += this.accentSgr;
      if (suppress) out += "\x1b[39m";
    }
    return out;
  }
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
  const colorizerRef = useRef<BoldColorizer | null>(null);
  const { ensure, sendInput, resize, subscribe } = useSessionsMethods();

  useEffect(() => {
    if (!containerRef.current) return;

    const term = new Xterm({
      fontFamily: "'JetBrains Mono', ui-monospace, monospace",
      fontSize: Math.round(14 * fontScale),
      fontWeight: 300,
      fontWeightBold: 700,
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

    const colorizer = new BoldColorizer();
    colorizer.setAccent(accent ?? THEME_ACCENTS[theme]);
    colorizerRef.current = colorizer;

    const unsubscribe = subscribe(
      sessionKey,
      (bytes) => term.write(colorizer.transform(bytes)),
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
    colorizerRef.current?.setAccent(accent ?? THEME_ACCENTS[theme]);
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
