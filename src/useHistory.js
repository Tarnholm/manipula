import { useCallback, useEffect, useRef, useState } from "react";

// Lightweight undo/redo stack for the units array.
// Snapshots are JSON-stringified so equality checks are cheap and recursion is avoided.
// Capacity caps to avoid memory bloat.
//
// Usage:
//   const { value, set, undo, redo, canUndo, canRedo, reset } = useHistory(initial, { capacity: 50 });
//   ...always call set(newValue) when state changes; calling reset(value) wipes history (use after import-from-EDB).
export default function useHistory(initial, { capacity = 50 } = {}) {
  const [value, setValue] = useState(initial);
  const past = useRef([]);
  const future = useRef([]);
  const lastSnapshot = useRef(JSON.stringify(initial));

  // Keep value reference fresh
  const set = useCallback((next) => {
    const cur = lastSnapshot.current;
    const nextStr = JSON.stringify(next);
    if (nextStr === cur) { setValue(next); return; }
    past.current.push(cur);
    if (past.current.length > capacity) past.current.shift();
    future.current = [];
    lastSnapshot.current = nextStr;
    setValue(next);
  }, [capacity]);

  const reset = useCallback((next) => {
    past.current = [];
    future.current = [];
    lastSnapshot.current = JSON.stringify(next);
    setValue(next);
  }, []);

  const undo = useCallback(() => {
    if (!past.current.length) return;
    const prev = past.current.pop();
    future.current.push(lastSnapshot.current);
    lastSnapshot.current = prev;
    setValue(JSON.parse(prev));
  }, []);
  const redo = useCallback(() => {
    if (!future.current.length) return;
    const fut = future.current.pop();
    past.current.push(lastSnapshot.current);
    lastSnapshot.current = fut;
    setValue(JSON.parse(fut));
  }, []);

  return {
    value,
    set,
    reset,
    undo,
    redo,
    get canUndo() { return past.current.length > 0; },
    get canRedo() { return future.current.length > 0; },
  };
}

// Hook the document for keyboard shortcuts (Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z or Ctrl+Y).
export function useUndoShortcuts({ undo, redo }) {
  useEffect(() => {
    const handler = (e) => {
      const mod = e.ctrlKey || e.metaKey;
      if (!mod) return;
      // Skip if focus is inside text inputs / textareas / contenteditable
      const tag = (document.activeElement && document.activeElement.tagName) || "";
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (e.key === "z" && !e.shiftKey) { e.preventDefault(); undo(); }
      else if ((e.key === "z" && e.shiftKey) || e.key === "y") { e.preventDefault(); redo(); }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [undo, redo]);
}
