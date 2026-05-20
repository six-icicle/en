import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ReactElement, RefObject } from "react";
import { useSessions } from "./sessions";

const HANDLE_THICKNESS = 6;
const MIN_TRACK_PX = 100;

type Layout = "row" | "grid" | "wide" | "focus";

type Props = {
  gridRef: RefObject<HTMLDivElement | null>;
  layout: Layout;
  count: number;
  colFrs: number[];
  rowFrs: number[];
  setColFrs: (next: number[]) => void;
  setRowFrs: (next: number[]) => void;
};

type Tracks = { cols: number[]; rows: number[] };

function readTracks(grid: HTMLDivElement): Tracks {
  const s = getComputedStyle(grid);
  const cols = s.gridTemplateColumns.split(" ").map((v) => parseFloat(v) || 0);
  const rows = s.gridTemplateRows.split(" ").map((v) => parseFloat(v) || 0);
  return { cols, rows };
}

function cumulative(tracks: number[]): number[] {
  const out = [0];
  let sum = 0;
  for (const t of tracks) {
    sum += t;
    out.push(sum);
  }
  return out;
}

function isLineHidden(
  layout: Layout,
  count: number,
  axis: "col" | "row",
  lineIdx: number,
): boolean {
  if (layout !== "focus") return false;
  if (count === 6 && lineIdx === 1) return true;
  void axis;
  return false;
}

export default function GridResizeHandles({
  gridRef,
  layout,
  count,
  colFrs,
  rowFrs,
  setColFrs,
  setRowFrs,
}: Props) {
  const [tracks, setTracks] = useState<Tracks>({ cols: [], rows: [] });
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const draggingRef = useRef(false);
  const rafIdRef = useRef(0);
  const { pauseResize, resumeResize } = useSessions();

  // Re-measure when layout/count/fr arrays change. During drag we suppress
  // measurement so the React-driven track values don't fight the live DOM
  // values we're writing directly.
  useLayoutEffect(() => {
    const grid = gridRef.current;
    if (!grid) return;
    const measure = () => {
      if (draggingRef.current) return;
      setTracks(readTracks(grid));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(grid);
    return () => ro.disconnect();
  }, [gridRef, layout, count, colFrs, rowFrs]);

  useEffect(() => {
    const onUp = () => {
      if (!draggingRef.current) return;
      draggingRef.current = false;
      if (rafIdRef.current) {
        cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = 0;
      }
      document.body.style.cursor = "";
      document.body.style.userSelect = "";

      const grid = gridRef.current;
      if (!grid) return;
      const t = readTracks(grid);
      const sumCols = t.cols.reduce((a, b) => a + b, 0);
      const sumRows = t.rows.reduce((a, b) => a + b, 0);
      if (sumCols > 0) setColFrs(t.cols.map((px) => (colFrs[0] != null ? (px / sumCols) * t.cols.length : 1)));
      if (sumRows > 0) setRowFrs(t.rows.map((px) => (rowFrs[0] != null ? (px / sumRows) * t.rows.length : 1)));

      resumeResize();
    };
    window.addEventListener("pointerup", onUp);
    return () => window.removeEventListener("pointerup", onUp);
  }, [gridRef, colFrs, rowFrs, setColFrs, setRowFrs, resumeResize]);

  const startDrag = (
    axis: "col" | "row",
    lineIdx: number,
    e: React.PointerEvent,
  ) => {
    const grid = gridRef.current;
    if (!grid) return;
    const t = readTracks(grid);
    const initial = axis === "col" ? [...t.cols] : [...t.rows];
    const a = initial[lineIdx - 1];
    const b = initial[lineIdx];
    if (a == null || b == null) return;
    const startClient = axis === "col" ? e.clientX : e.clientY;

    draggingRef.current = true;
    pauseResize();
    document.body.style.cursor = axis === "col" ? "col-resize" : "row-resize";
    document.body.style.userSelect = "none";
    e.preventDefault();
    (e.target as Element).releasePointerCapture?.(e.pointerId);

    let pendingClient = startClient;

    const apply = () => {
      rafIdRef.current = 0;
      let delta = pendingClient - startClient;
      const newA = a + delta;
      const newB = b - delta;
      if (newA < MIN_TRACK_PX) delta = MIN_TRACK_PX - a;
      if (newB < MIN_TRACK_PX) delta = b - MIN_TRACK_PX;
      const finalA = a + delta;
      const finalB = b - delta;
      const live = [...initial];
      live[lineIdx - 1] = finalA;
      live[lineIdx] = finalB;
      const liveSum = live.reduce((s, v) => s + v, 0);
      const tmpl = live.map((px) => `${(px / liveSum) * live.length}fr`).join(" ");
      if (axis === "col") grid.style.gridTemplateColumns = tmpl;
      else grid.style.gridTemplateRows = tmpl;

      // Reposition the visible handles so they stay glued to the moving
      // boundaries during the drag (other handles on the same axis stay put).
      const overlay = overlayRef.current;
      if (overlay) {
        const cum = cumulative(live);
        const handles = overlay.querySelectorAll<HTMLElement>(
          axis === "col" ? ".grid-handle.col" : ".grid-handle.row",
        );
        handles.forEach((h) => {
          const i = parseInt(h.dataset.line ?? "0", 10);
          if (!i) return;
          if (axis === "col") {
            h.style.left = `${cum[i] - HANDLE_THICKNESS / 2}px`;
          } else {
            h.style.top = `${cum[i] - HANDLE_THICKNESS / 2}px`;
          }
        });
      }
    };

    const onMove = (ev: PointerEvent) => {
      pendingClient = axis === "col" ? ev.clientX : ev.clientY;
      if (rafIdRef.current) return;
      rafIdRef.current = requestAnimationFrame(apply);
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  const colLines = cumulative(tracks.cols);
  const rowLines = cumulative(tracks.rows);
  const gridHeight = colLines.length > 0 ? rowLines[rowLines.length - 1] : 0;
  const gridWidth = rowLines.length > 0 ? colLines[colLines.length - 1] : 0;

  const handles: ReactElement[] = [];
  for (let i = 1; i < tracks.cols.length; i++) {
    if (isLineHidden(layout, count, "col", i)) continue;
    handles.push(
      <div
        key={`c${i}`}
        data-line={i}
        className="grid-handle col"
        style={{
          left: colLines[i] - HANDLE_THICKNESS / 2,
          top: 0,
          width: HANDLE_THICKNESS,
          height: gridHeight,
        }}
        onPointerDown={(e) => startDrag("col", i, e)}
      />,
    );
  }
  for (let i = 1; i < tracks.rows.length; i++) {
    if (isLineHidden(layout, count, "row", i)) continue;
    handles.push(
      <div
        key={`r${i}`}
        data-line={i}
        className="grid-handle row"
        style={{
          top: rowLines[i] - HANDLE_THICKNESS / 2,
          left: 0,
          height: HANDLE_THICKNESS,
          width: gridWidth,
        }}
        onPointerDown={(e) => startDrag("row", i, e)}
      />,
    );
  }

  return (
    <div className="grid-handles" ref={overlayRef}>
      {handles}
    </div>
  );
}
