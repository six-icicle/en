import { useEffect, useRef } from "react";
import { Terminal as Xterm, type ITheme } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebglAddon } from "@xterm/addon-webgl";
import { useSessions, type SessionDecl } from "./sessions";

type Theme = "kanagawa" | "everforest" | "rose-pine" | "rose-pine-alt" | "original";

type Props = {
  decl: SessionDecl;
  theme: Theme;
  fontScale: number;
  accent?: string;
  bg?: string;
  active?: boolean;
};

function themeFor(theme: Theme, accent?: string, bg?: string): ITheme {
  const base = THEMES[theme];
  if (!accent && !bg) return base;
  return {
    ...base,
    ...(accent ? { cursor: accent } : {}),
    ...(bg ? { background: bg } : {}),
  };
}

const THEMES: Record<Theme, ITheme> = {
  kanagawa: {
    background: "#25252e",
    foreground: "#dcd7ba",
    cursor: "#c0a36e",
    cursorAccent: "#1f1f28",
    selectionBackground: "#2d4f67",
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
  },
  everforest: {
    background: "#2d353b",
    foreground: "#d3c6aa",
    cursor: "#a7c080",
    cursorAccent: "#232a2e",
    selectionBackground: "#475258",
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
  },
  "rose-pine": {
    background: "#232136",
    foreground: "#e0def4",
    cursor: "#ea9a97",
    cursorAccent: "#1f1d2e",
    selectionBackground: "#44415a",
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
  },
  "rose-pine-alt": {
    background: "#2a273f",
    foreground: "#e0def4",
    cursor: "#ea9a97",
    cursorAccent: "#232136",
    selectionBackground: "#44415a",
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
  },
  original: {
    background: "#0e1114",
    foreground: "#d8dde3",
    cursor: "#f0a929",
    cursorAccent: "#0a0c0e",
    selectionBackground: "#23303a",
    black: "#11141a",
    red: "#ff5a3a",
    green: "#6dd2a8",
    yellow: "#f0a929",
    blue: "#7aa6da",
    magenta: "#c594c5",
    cyan: "#85c5b9",
    white: "#d8dde3",
    brightBlack: "#5a636c",
    brightRed: "#ff7a5a",
    brightGreen: "#8de4be",
    brightYellow: "#ffc857",
    brightBlue: "#9bbfee",
    brightMagenta: "#d6b6d6",
    brightCyan: "#a6d8cd",
    brightWhite: "#ffffff",
  },
};

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
    try {
      webgl = new WebglAddon();
      webgl.onContextLoss(() => webgl?.dispose());
      term.loadAddon(webgl);
    } catch {
      webgl = null; // fall back to default DOM renderer
    }

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
        `[mc/${decl.key}] ensure: container=${Math.round(rect.width)}x${Math.round(rect.height)} cols=${cols} rows=${rows} (settled in ${stabilityAttempts + 1} ticks)`,
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
            `[mc/${decl.key}] refit: container=${rect ? Math.round(rect.width) : "?"}x${rect ? Math.round(rect.height) : "?"} cols=${term.cols} rows=${term.rows}`,
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
      webgl?.dispose();
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

  return <div ref={containerRef} className="xterm-host" />;
}
