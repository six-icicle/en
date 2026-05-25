import { useEffect, type RefObject } from "react";

export function usePopover(
  open: boolean,
  ref: RefObject<HTMLElement | null>,
  setOpen: (v: boolean) => void,
) {
  useEffect(() => {
    if (!open) return;
    const onPointer = (e: MouseEvent) => {
      const el = ref.current;
      if (!el) return;
      if (!el.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("mousedown", onPointer);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onPointer);
      window.removeEventListener("keydown", onKey);
    };
  }, [open, ref, setOpen]);
}
