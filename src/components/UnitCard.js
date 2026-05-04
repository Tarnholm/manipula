import React, { useState, useContext, createContext } from "react";
import { decodeStatPri, decodeStatArmour, decodeStatCost } from "../parsers/edu";
import LazyImage from "./LazyImage";

// Build a flat list of {label, value} rows from an EDU entry. Used by the lightbox sidecar.
function buildStatsRows(edu) {
  if (!edu) return null;
  const rows = [];
  const push = (label, value, opts = {}) => { if (value !== null && value !== undefined && value !== "") rows.push({ label, value, ...opts }); };
  push("Type", edu.type, { mono: true });
  if (edu.dictionary) push("Dictionary", edu.dictionary, { mono: true });
  push("Category", edu.category);
  push("Class", edu.class);
  if (edu.soldier) push("Soldier", `${edu.soldier} × ${edu.soldierCount || "?"}`);
  push("Health", edu.statHealth);
  const pri = decodeStatPri(edu.statPri);
  if (pri) {
    push("Primary attack", `${pri.attack} (charge +${pri.charge})`, { color: "#dca64a", bold: true });
    if (pri.projectile) push("Primary weapon", `${pri.projectile} · ${pri.type || "?"} · ${pri.tech || "?"} · ${pri.damage || "?"}`);
    if (pri.range) push("Range", `${pri.range}${pri.ammo ? `, ammo ${pri.ammo}` : ""}`);
  }
  const sec = decodeStatPri(edu.statSec);
  if (sec && sec.attack) {
    push("Secondary attack", `${sec.attack} (charge +${sec.charge})`);
    if (sec.projectile) push("Secondary weapon", `${sec.projectile} · ${sec.type || "?"}`);
  }
  const arm = decodeStatArmour(edu.statPriArmour);
  if (arm) push("Armour / def / shield", `${arm.armour} / ${arm.defense} / ${arm.shield}`, { color: "#9bc", bold: true });
  push("Morale", edu.statMental);
  const cost = decodeStatCost(edu.statCost);
  if (cost) {
    push("Cost", cost.cost, { mono: true, color: "#dca64a" });
    push("Upkeep", cost.upkeep, { mono: true });
    push("Build turns", cost.turns, { mono: true });
  }
  if (edu.attributes && edu.attributes.length) push("Attributes", edu.attributes.join(", "));
  if (edu.formation) push("Formation", edu.formation);
  if (edu.ownership && edu.ownership.length) push("Ownership", edu.ownership.slice(0, 6).join(", ") + (edu.ownership.length > 6 ? `, +${edu.ownership.length - 6}` : ""));
  return rows.length ? rows : null;
}

// Lightbox context — enables right-click on any UnitCard/FactionIcon to open full-size.
const LightboxContext = createContext(null);

export function LightboxProvider({ children }) {
  const [state, setState] = useState(null); // { src, alt, stats } | null
  const open = (s, a, opts) => setState({ src: s, alt: a || "", stats: (opts && opts.stats) || null });
  const close = () => setState(null);
  const src = state && state.src;
  const alt = state ? state.alt : "";
  const stats = state ? state.stats : null;
  return (
    <LightboxContext.Provider value={{ open }}>
      {children}
      {src && (
        <div
          onClick={close}
          onContextMenu={(e) => { e.preventDefault(); close(); }}
          style={{
            position: "fixed", inset: 0, background: "rgba(0,0,0,0.85)", backdropFilter: "blur(4px)",
            display: "flex", alignItems: "center", justifyContent: "center", zIndex: 5000,
            cursor: "zoom-out", gap: 18,
          }}
        >
          <img
            src={src}
            alt={alt}
            style={{ maxWidth: stats ? "55vw" : "92vw", maxHeight: "92vh", boxShadow: "0 8px 48px rgba(0,0,0,0.6)", border: "1px solid rgba(220,166,74,0.3)", borderRadius: 8 }}
            onClick={(e) => e.stopPropagation()}
            onContextMenu={(e) => { e.preventDefault(); close(); }}
            draggable={false}
          />
          {stats && (
            <div
              onClick={(e) => e.stopPropagation()}
              onContextMenu={(e) => { e.preventDefault(); close(); }}
              style={{
                maxWidth: "32vw", maxHeight: "92vh", overflowY: "auto",
                background: "rgba(20,22,23,0.96)", border: "1px solid rgba(220,166,74,0.3)",
                borderRadius: 8, padding: 18, color: "#ddd", fontSize: 13,
                boxShadow: "0 8px 48px rgba(0,0,0,0.6)", cursor: "default",
              }}
            >
              <div style={{ fontSize: 16, fontWeight: 700, color: "#dca64a", marginBottom: 10, borderBottom: "1px solid rgba(220,166,74,0.2)", paddingBottom: 6 }}>{stats.title || alt}</div>
              {stats.rows.map((r, i) => (
                <div key={i} style={{ display: "flex", justifyContent: "space-between", padding: "3px 0", borderBottom: i < stats.rows.length - 1 ? "1px dashed rgba(255,255,255,0.05)" : "none" }}>
                  <span style={{ color: "#888" }}>{r.label}</span>
                  <span style={{ color: r.color || "#ddd", fontFamily: r.mono ? "Consolas, monospace" : undefined, fontWeight: r.bold ? 600 : 400 }}>{r.value}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </LightboxContext.Provider>
  );
}

export function useLightbox() {
  return useContext(LightboxContext);
}

// Build the rticon:// URL for a unit card or info portrait. Main process resolves the TGA path
// natively (data dir + faction folder + filename variants), decodes once, caches the PNG, and
// streams the bytes back. From the renderer's perspective this is just an `<img src>`.
function unitIconUrl(kind, faction, unitName, dictionary) {
  if (!unitName) return null;
  const fac = encodeURIComponent(faction || "");
  const name = encodeURIComponent(unitName);
  const q = dictionary ? `?d=${encodeURIComponent(dictionary)}` : "";
  return `rticon://${kind}/${fac}/${name}${q}`;
}

// UnitCard: small clickable thumbnail of a unit's UI portrait. Right-click opens full-size.
export default function UnitCard({ faction, unitName, dictionary, eduEntry, size = 32, alt }) {
  const lightbox = useLightbox();
  const cardUrl = unitIconUrl("unit", faction, unitName, dictionary);
  const infoUrl = unitIconUrl("info", faction, unitName, dictionary);
  const [failed, setFailed] = useState(false);

  // RTW unit_card TGAs are portrait-oriented (taller than wide), roughly 2:3. Keep `size` as the
  // width and derive height from the 2:3 aspect ratio so they render natively without cropping.
  const w = size;
  const h = Math.round(size * 1.5);

  const openLightbox = () => {
    if (!lightbox) return;
    const label = alt || unitName;
    const statsRows = buildStatsRows(eduEntry);
    const stats = statsRows ? { title: label, rows: statsRows } : null;
    // Open the larger info portrait if available — main process will 404 if no _info.tga exists,
    // and the <img onError> below will fall through to the small card on the next click.
    lightbox.open(infoUrl || cardUrl, label, { stats });
  };

  if (!cardUrl || failed) {
    return (
      <div
        title={`${alt || unitName} — no unit_card.tga found in mod data`}
        style={{
          width: w, height: h, borderRadius: 4,
          background: "repeating-linear-gradient(45deg, rgba(232,136,136,0.10) 0 6px, rgba(232,136,136,0.04) 6px 12px)",
          border: "1px dashed rgba(232,136,136,0.45)",
          display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
          flexDirection: "column", gap: 2,
        }}
      >
        <span style={{ fontSize: Math.max(10, w * 0.45), color: "#e88", fontWeight: 700, lineHeight: 1 }}>×</span>
        <span style={{ fontSize: Math.max(7, w * 0.18), color: "#e88", textTransform: "uppercase", letterSpacing: 0.4 }}>no card</span>
      </div>
    );
  }

  return (
    <LazyImage
      src={cardUrl}
      alt={alt || unitName}
      title={`${alt || unitName} — right-click to view full size`}
      width={w}
      height={h}
      onContextMenu={(e) => {
        e.preventDefault();
        openLightbox();
      }}
      style={{
        display: "block", width: w, height: h, objectFit: "contain",
        borderRadius: 4, flexShrink: 0,
        border: "1px solid rgba(255,255,255,0.06)",
        cursor: "context-menu",
      }}
      draggable={false}
      onError={() => setFailed(true)}
    />
  );
}
