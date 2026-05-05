// Toast.js — global notification stack. Use window.toast(msg, kind, ms?)
// from anywhere; kind is "info" | "ok" | "warn" | "error". Toasts render
// top-right, stack vertically, auto-dismiss after ms (default 4500), and
// errors are sticky until clicked.
import React, { useEffect, useState } from "react";
import { createPortal } from "react-dom";

let pushFn = null;

export function toast(msg, kind = "info", ms) {
  if (pushFn) pushFn(msg, kind, ms);
  else if (typeof window !== "undefined") {
    const q = window.__toastQueue = window.__toastQueue || [];
    q.push([msg, kind, ms]);
  }
}
if (typeof window !== "undefined") window.toast = toast;

export default function ToastContainer() {
  const [items, setItems] = useState([]);
  useEffect(() => {
    let nextId = 1;
    pushFn = (msg, kind, ms) => {
      const id = nextId++;
      setItems((cur) => [...cur, { id, msg, kind }]);
      const dwell = ms != null ? ms : (kind === "error" ? null : 4500);
      if (dwell) setTimeout(() => setItems((cur) => cur.filter((t) => t.id !== id)), dwell);
    };
    if (typeof window !== "undefined") {
      const q = window.__toastQueue || [];
      window.__toastQueue = [];
      for (const args of q) pushFn(...args);
    }
    return () => { pushFn = null; };
  }, []);

  if (!items.length) return null;
  const colour = (k) =>
    k === "ok"    ? { bd: "#7c9",     bg: "rgba(124,201,153,0.10)", fg: "#7c9" }
  : k === "warn"  ? { bd: "#dca64a",  bg: "rgba(220,166,74,0.10)",  fg: "#dca64a" }
  : k === "error" ? { bd: "#d66c6c",  bg: "rgba(214,108,108,0.12)", fg: "#e88" }
                  : { bd: "#557",     bg: "rgba(120,140,200,0.10)", fg: "#bcd" };

  return createPortal(
    <div style={{ position: "fixed", top: 14, right: 14, zIndex: 12000, display: "flex", flexDirection: "column", gap: 8, pointerEvents: "none", maxWidth: 420 }}>
      {items.map((t) => {
        const c = colour(t.kind);
        return (
          <div
            key={t.id}
            onClick={() => setItems((cur) => cur.filter((x) => x.id !== t.id))}
            style={{
              pointerEvents: "auto", cursor: "pointer",
              background: c.bg, border: `1px solid ${c.bd}`, color: c.fg,
              borderRadius: 6, padding: "8px 12px", fontSize: 12, fontFamily: "Consolas, monospace",
              boxShadow: "0 4px 14px rgba(0,0,0,0.4)", whiteSpace: "pre-wrap",
            }}
            title="click to dismiss"
          >
            {t.msg}
          </div>
        );
      })}
    </div>,
    document.body
  );
}
