import { createContext, useCallback, useContext, useRef, useState } from "react";
import type { ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

type Status =
  | "spawning"
  | "working"
  | "needs"
  | "idle"
  | "exited"
  | "failed";

type TileStatusEvent = { status: "working" | "needs" | "idle"; event: string };

export type SessionDecl = {
  key: string;
  name: string;
  path: string;
  cwd?: string;
  cmd?: string;
};

export type Session = SessionDecl & {
  ptyId: string | null;
  cols: number;
  rows: number;
  status: Status;
  error?: string;
};

type SpawnReply = { id: string; cols: number; rows: number };

type Subs = {
  data: Set<(bytes: Uint8Array) => void>;
  exit: Set<() => void>;
};

const REPLAY_CAP = 256 * 1024;

type Buffer = {
  chunks: Uint8Array[];
  size: number;
};

type Ctx = {
  list: Session[];
  ensure(decl: SessionDecl, initialCols?: number, initialRows?: number): Promise<Session>;
  kill(key: string): Promise<void>;
  sendInput(key: string, data: string): Promise<void>;
  resize(key: string, cols: number, rows: number): Promise<void>;
  pauseResize(): void;
  resumeResize(): void;
  subscribe(
    key: string,
    onData: (bytes: Uint8Array) => void,
    onExit: () => void,
  ): () => void;
  ackStatus(key: string): void;
};

const SessionsContext = createContext<Ctx | null>(null);

function decodeBase64(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function SessionsProvider({ children }: { children: ReactNode }) {
  const sessionsRef = useRef<Map<string, Session>>(new Map());
  const inflight = useRef<Map<string, Promise<Session>>>(new Map());
  const subsRef = useRef<Map<string, Subs>>(new Map());
  const buffersRef = useRef<Map<string, Buffer>>(new Map());
  const unlistenersRef = useRef<Map<string, UnlistenFn[]>>(new Map());
  const resizePausedRef = useRef(false);
  const pendingResizeRef = useRef<Map<string, { cols: number; rows: number }>>(
    new Map(),
  );
  const [, setTick] = useState(0);

  const getSubs = (key: string): Subs => {
    let s = subsRef.current.get(key);
    if (!s) {
      s = { data: new Set(), exit: new Set() };
      subsRef.current.set(key, s);
    }
    return s;
  };

  const getBuffer = (key: string): Buffer => {
    let b = buffersRef.current.get(key);
    if (!b) {
      b = { chunks: [], size: 0 };
      buffersRef.current.set(key, b);
    }
    return b;
  };

  const appendToBuffer = (key: string, bytes: Uint8Array) => {
    const b = getBuffer(key);
    b.chunks.push(bytes);
    b.size += bytes.length;
    while (b.size > REPLAY_CAP && b.chunks.length > 1) {
      const dropped = b.chunks.shift();
      if (dropped) b.size -= dropped.length;
    }
  };

  const ensure = useCallback(
    async (
      decl: SessionDecl,
      initialCols?: number,
      initialRows?: number,
    ): Promise<Session> => {
    const existing = sessionsRef.current.get(decl.key);
    if (
      existing &&
      existing.status !== "exited" &&
      existing.status !== "failed"
    ) {
      return existing;
    }
    const flight = inflight.current.get(decl.key);
    if (flight) return flight;

    const p = (async (): Promise<Session> => {
      sessionsRef.current.set(decl.key, {
        ...decl,
        ptyId: null,
        cols: 0,
        rows: 0,
        status: "spawning",
      });
      setTick((t) => t + 1);

      let info: SpawnReply;
      try {
        info = await invoke<SpawnReply>("spawn_session", {
          cwd: decl.cwd,
          cmd: decl.cmd,
          cols: initialCols,
          rows: initialRows,
        });
      } catch (e) {
        const cur = sessionsRef.current.get(decl.key);
        if (cur) {
          sessionsRef.current.set(decl.key, {
            ...cur,
            status: "failed",
            error: String(e),
          });
        }
        setTick((t) => t + 1);
        throw e;
      }

      const dataUnlisten = await listen<string>(`pty:${info.id}`, (ev) => {
        const bytes = decodeBase64(ev.payload);
        appendToBuffer(decl.key, bytes);
        const sub = subsRef.current.get(decl.key);
        if (sub) for (const fn of sub.data) fn(bytes);
      });
      const exitUnlisten = await listen(`pty-exit:${info.id}`, () => {
        const sub = subsRef.current.get(decl.key);
        if (sub) for (const fn of sub.exit) fn();
        const cur = sessionsRef.current.get(decl.key);
        if (cur) {
          sessionsRef.current.set(decl.key, { ...cur, status: "exited" });
        }
        setTick((t) => t + 1);
      });
      const statusUnlisten = await listen<TileStatusEvent>(
        `tile-status:${info.id}`,
        (ev) => {
          const cur = sessionsRef.current.get(decl.key);
          if (!cur || cur.status === "exited" || cur.status === "failed") {
            return;
          }
          if (cur.status === ev.payload.status) return;
          sessionsRef.current.set(decl.key, {
            ...cur,
            status: ev.payload.status,
          });
          setTick((t) => t + 1);
        },
      );
      unlistenersRef.current.set(decl.key, [
        dataUnlisten,
        exitUnlisten,
        statusUnlisten,
      ]);

      const updated: Session = {
        ...decl,
        ptyId: info.id,
        cols: info.cols,
        rows: info.rows,
        status: "working",
      };
      sessionsRef.current.set(decl.key, updated);
      setTick((t) => t + 1);
      return updated;
    })();

    inflight.current.set(decl.key, p);
    p.finally(() => inflight.current.delete(decl.key));
    return p;
    },
    [],
  );

  const kill = useCallback(async (key: string): Promise<void> => {
    const cur = sessionsRef.current.get(key);
    if (!cur) return;
    const ul = unlistenersRef.current.get(key);
    if (ul) {
      ul.forEach((u) => u());
      unlistenersRef.current.delete(key);
    }
    if (cur.ptyId) {
      try {
        await invoke("kill_session", { id: cur.ptyId });
      } catch {
        // backend may have already cleaned up
      }
    }
    sessionsRef.current.delete(key);
    subsRef.current.delete(key);
    buffersRef.current.delete(key);
    setTick((t) => t + 1);
  }, []);

  const sendInput = useCallback(
    async (key: string, data: string): Promise<void> => {
      const cur = sessionsRef.current.get(key);
      if (!cur || !cur.ptyId) return;
      try {
        await invoke("send_input", { id: cur.ptyId, data });
      } catch {
        // ignore
      }
    },
    [],
  );

  /* User-acknowledge: flip a "needs" tile back to "idle" when the user
     engages with it (e.g. clicks it). The next hook from claude
     (UserPromptSubmit/Stop) will overwrite as appropriate — this just
     stops the alert animation immediately so the UI feels responsive. */
  const ackStatus = useCallback((key: string): void => {
    const cur = sessionsRef.current.get(key);
    if (!cur || cur.status !== "needs") return;
    sessionsRef.current.set(key, { ...cur, status: "idle" });
    setTick((t) => t + 1);
  }, []);

  const resize = useCallback(
    async (key: string, cols: number, rows: number): Promise<void> => {
      const cur = sessionsRef.current.get(key);
      if (!cur || !cur.ptyId) return;
      if (resizePausedRef.current) {
        pendingResizeRef.current.set(key, { cols, rows });
        return;
      }
      try {
        await invoke("resize_session", { id: cur.ptyId, cols, rows });
        const latest = sessionsRef.current.get(key);
        if (latest) {
          sessionsRef.current.set(key, { ...latest, cols, rows });
        }
      } catch {
        // ignore
      }
    },
    [],
  );

  const pauseResize = useCallback(() => {
    resizePausedRef.current = true;
  }, []);

  const resumeResize = useCallback(() => {
    resizePausedRef.current = false;
    const pending = pendingResizeRef.current;
    pendingResizeRef.current = new Map();
    for (const [key, { cols, rows }] of pending) {
      const cur = sessionsRef.current.get(key);
      if (!cur || !cur.ptyId) continue;
      invoke("resize_session", { id: cur.ptyId, cols, rows })
        .then(() => {
          const latest = sessionsRef.current.get(key);
          if (latest) {
            sessionsRef.current.set(key, { ...latest, cols, rows });
          }
        })
        .catch(() => {
          // ignore
        });
    }
  }, []);

  const subscribe = useCallback(
    (
      key: string,
      onData: (bytes: Uint8Array) => void,
      onExit: () => void,
    ): (() => void) => {
      const s = getSubs(key);
      const b = buffersRef.current.get(key);
      if (b) for (const chunk of b.chunks) onData(chunk);
      s.data.add(onData);
      s.exit.add(onExit);
      return () => {
        s.data.delete(onData);
        s.exit.delete(onExit);
      };
    },
    [],
  );

  const list = Array.from(sessionsRef.current.values());

  const ctx: Ctx = {
    list,
    ensure,
    kill,
    sendInput,
    resize,
    pauseResize,
    resumeResize,
    subscribe,
    ackStatus,
  };
  return (
    <SessionsContext.Provider value={ctx}>{children}</SessionsContext.Provider>
  );
}

export function useSessions(): Ctx {
  const ctx = useContext(SessionsContext);
  if (!ctx) throw new Error("useSessions must be used within <SessionsProvider>");
  return ctx;
}
