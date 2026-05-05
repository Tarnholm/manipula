// ShortcutOverlay.js — `?` cheatsheet. Reads from src/shortcuts.js so
// the documentation can never drift from the actual handlers.
import React, { useEffect } from "react";
import { createPortal } from "react-dom";
import { SHORTCUTS } from "../shortcuts";

export default function ShortcutOverlay({ open, onClose }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open) return null;

  const groups = {};
  for (const s of SHORTCUTS) (groups[s.group] = groups[s.group] || []).push(s);

  return createPortal(
    <div
      onClick={onClose}
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.65)", zIndex: 13000, display: "flex", alignItems: "flex-start", justifyContent: "center", paddingTop: "8vh", overflow: "auto" }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "#1a1a1a", border: "1px solid rgba(220,166,74,0.4)", borderRadius: 10,
          padding: 22, minWidth: 560, maxWidth: 840, boxShadow: "0 12px 40px rgba(0,0,0,0.6)",
          color: "#ddd", fontSize: 12,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
          <h2 style={{ margin: 0, color: "#dca64a", fontWeight: 600 }}>Keyboard shortcuts</h2>
          <button onClick={onClose} style={{ background: "transparent", border: "1px solid #444", color: "#bbb", borderRadius: 4, padding: "4px 10px", cursor: "pointer", fontSize: 11 }}>Esc</button>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24 }}>
          {Object.entries(groups).map(([name, list]) => (
            <div key={name}>
              <div style={{ color: "#dca64a", fontWeight: 700, letterSpacing: 0.5, fontSize: 11, textTransform: "uppercase", marginBottom: 6, borderBottom: "1px solid rgba(220,166,74,0.2)", paddingBottom: 4 }}>{name}</div>
              {list.map((s, i) => (
                <div key={i} style={{ display: "flex", justifyContent: "space-between", padding: "3px 0", gap: 12 }}>
                  <span style={{ color: "#999" }}>{s.label}</span>
                  <kbd style={{ fontFamily: "Consolas, monospace", background: "#0e0e0e", border: "1px solid #333", borderRadius: 3, padding: "1px 7px", color: "#dca64a", fontSize: 11, whiteSpace: "nowrap" }}>{s.keys}</kbd>
                </div>
              ))}
            </div>
          ))}
        </div>
        <div style={{ marginTop: 16, color: "#777", fontSize: 11, textAlign: "center" }}>
          Press <kbd style={{ fontFamily: "Consolas, monospace", color: "#dca64a" }}>?</kbd> any time to bring this back.
        </div>
      </div>
    </div>,
    document.body
  );
}
