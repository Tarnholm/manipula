import { useCallback, useEffect, useRef, useState } from "react";

// Lightweight undo/redo stack — used for both the recruit-line units
// array and the EDU project. Stack stores REFERENCES to old values
// (not JSON snapshots) and dedups via Object.is. The previous version
// JSON.stringify'd the whole project on every set call — fine for the
// 200-unit recruit-line side, but ~50ms per call for an 800-unit EDU
// project, which stacked up under bulk edits and pinned the renderer.
// References mean callers must always replace the value (e.g.
// `setProject({ ...project, units: nextUnits })`) rather than mutating
// in place — which is the React convention anyway and is what every
// call site already does.
//
// Memory: each snapshot is a reference (one pointer) plus the unique
// data it points to, but most of an EDU project's bulk (factions,
// core data, armour) shares structure across edits so the actual
// retained memory is bounded. capacity caps the past/future stacks.
//
// Usage:
//   const { value, set, undo, redo, canUndo, canRedo, reset } = useHistory(initial, { capacity: 50 });
//   ...always call set(newValue) when state changes; calling reset(value) wipes history (use after import-from-EDB).
export default function useHistory(initial, { capacity = 50 } = {}) {
  const [value, setValue] = useState(initial);
  const past = useRef([]);
  const future = useRef([]);
  const lastValue = useRef(initial);

  const set = useCallback((next) => {
    if (Object.is(next, lastValue.current)) { setValue(next); return; }
    past.current.push(lastValue.current);
    if (past.current.length > capacity) past.current.shift();
    future.current = [];
    lastValue.current = next;
    setValue(next);
  }, [capacity]);

  const reset = useCallback((next) => {
    past.current = [];
    future.current = [];
    lastValue.current = next;
    setValue(next);
  }, []);

  const undo = useCallback(() => {
    if (!past.current.length) return;
    const prev = past.current.pop();
    future.current.push(lastValue.current);
    lastValue.current = prev;
    setValue(prev);
  }, []);
  const redo = useCallback(() => {
    if (!future.current.length) return;
    const fut = future.current.pop();
    past.current.push(lastValue.current);
    lastValue.current = fut;
    setValue(fut);
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
