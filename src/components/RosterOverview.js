import React, { useMemo } from "react";
import FactionIcon from "./FactionIcon";
import { ROSTER_ROLES, categorizeUnit, isNonRecruitable } from "../qualityClasses";

// Roles for which the UI hides the row entirely when the faction has 0 units (camels and elephants
// are typically only present for a handful of cultures).
const HIDE_IF_EMPTY = new Set(["camel", "elephant", "siege", "naval"]);

// Roster Overview — when filtering by a single faction, this widget shows a tier × role grid:
//
//                  Tier 1   Tier 2   Tier 3
//   Missile         2        0 ←     0 ←
//   Infantry        3        1        0 ←
//   Cavalry         2        1        0 ←
//   General         1        —        —
//
// "0 ←" cells are highlighted as gaps. This makes it easy to spot what tier-bucket a faction's roster is
// missing units in, which is key when adding a new faction or filling out an existing one.
//
// Tier comes from the unit's canonicalMicTier. Role comes from the Quality Class (or fallback to "infantry").
// Units with role missing AND no qualityClass are bucketed under "?" so we don't lose them.

export default function RosterOverview({ units, faction, modIconsDir, modIndex, onUnitClick, onCreateFromEDU }) {
  const grid = useMemo(() => buildGrid(units, faction), [units, faction]);
  // EDU completeness: every EDU entry that lists this faction in `ownership`, minus the ones
  // already authored. Highlights "you have a unit in EDU but no recruitment line for it yet".
  const eduCoverage = useMemo(() => {
    const edu = (modIndex && modIndex.edu) || [];
    const owned = edu.filter(e => Array.isArray(e.ownership) && e.ownership.includes(faction) && !isNonRecruitable(e));
    const authored = new Set(units.map(u => u.unit));
    const missing = owned.filter(e => !authored.has(e.type));
    return { total: owned.length, authored: owned.length - missing.length, missing };
  }, [modIndex, units, faction]);
  if (!faction) return null;

  return (
    <div style={{ marginBottom: 12, padding: 12, background: "rgba(28,30,32,0.5)", border: "1px solid rgba(220,166,74,0.18)", borderRadius: 10 }}>
      <div style={{ display: "flex", alignItems: "center", marginBottom: 10, gap: 12 }}>
        <FactionIcon
          iconPath={`faction_icons/${faction}.tga`}
          alt={faction}
          size={56}
          modIconsDir={modIconsDir}
        />
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: "#dca64a", textTransform: "uppercase", letterSpacing: 0.8 }}>
            Roster overview — {faction}
          </div>
          <div style={{ color: "#888", fontSize: 11 }}>{grid.totalUnits} authored units</div>
        </div>
      </div>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
        <thead>
          <tr>
            <th style={{ ...thStyle, textAlign: "left" }}>Role</th>
            <th style={thStyle}>Tier 1</th>
            <th style={thStyle}>Tier 2</th>
            <th style={thStyle}>Tier 3</th>
            <th style={thStyle}>Tier 4</th>
            <th style={thStyle}>Total</th>
          </tr>
        </thead>
        <tbody>
          {ROSTER_ROLES.map(role => {
            const row = grid.rows[role];
            if (!row) return null;
            // Always-shown rows still render even if empty (so the user can see the gaps).
            // Conditional rows (camels/elephants/siege/naval) are hidden entirely when 0.
            if (row.total === 0 && HIDE_IF_EMPTY.has(role)) return null;
            return (
              <tr key={role}>
                <td style={tdStyle}>{role}</td>
                {[1, 2, 3, 4].map(tier => {
                  const cell = row.tiers[tier] || [];
                  const empty = cell.length === 0;
                  // Don't flag tier 4 as a gap (it's rare for player to recruit at tier 4 — usually AI-only)
                  const isGap = empty && tier <= 3 && row.total > 0;
                  return (
                    <td key={tier} style={{
                      ...tdStyle,
                      textAlign: "center",
                      background: isGap ? "rgba(232,136,136,0.12)" : "",
                      color: empty ? (isGap ? "#e88" : "#555") : "#dca64a",
                      fontWeight: empty ? 400 : 700,
                      cursor: cell.length > 0 ? "pointer" : "default",
                    }}
                    title={cell.map(u => u.unit).join("\n") || (isGap ? "Gap — no units at this tier" : "")}
                    onClick={() => cell.length > 0 && onUnitClick && onUnitClick(cell[0].id)}
                    >
                      {empty ? (isGap ? "—" : "·") : cell.length}
                    </td>
                  );
                })}
                <td style={{ ...tdStyle, textAlign: "center", color: "#bbb" }}>{row.total}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div style={{ fontSize: 11, color: "#999", marginTop: 8 }}>
        Tier from each unit's canonical mic_tier. Role from Quality Class (defaults to infantry if unset).
        {grid.gaps > 0 && <span style={{ color: "#e88", marginLeft: 8 }}>{grid.gaps} tier gap{grid.gaps === 1 ? "" : "s"} highlighted.</span>}
      </div>
      {eduCoverage.total > 0 && (
        <div style={{ marginTop: 12, padding: 10, background: "rgba(0,0,0,0.2)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 6 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 6, gap: 8 }}>
            <span style={{ fontSize: 11, color: "#dca64a", textTransform: "uppercase", letterSpacing: 0.5, fontWeight: 700 }}>EDU coverage</span>
            <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
              {eduCoverage.missing.length > 0 && onCreateFromEDU && (
                <button
                  onClick={() => {
                    if (!window.confirm(`Create draft authored entries for all ${eduCoverage.missing.length} missing EDU units owned by ${faction}?`)) return;
                    for (const e of eduCoverage.missing) onCreateFromEDU(e);
                  }}
                  title="Bulk-create draft authored entries for every missing EDU unit"
                  style={{ background: "rgba(220,166,74,0.15)", border: "1px solid rgba(220,166,74,0.3)", color: "#dca64a", padding: "2px 8px", borderRadius: 3, fontSize: 11, fontWeight: 600, cursor: "pointer" }}
                >+ Create all {eduCoverage.missing.length}</button>
              )}
              <span style={{ fontSize: 11, color: eduCoverage.missing.length === 0 ? "#7c9" : "#a77" }}>
                {eduCoverage.authored} / {eduCoverage.total} EDU units have authored recruitment
              </span>
            </div>
          </div>
          {eduCoverage.missing.length > 0 ? (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
              {eduCoverage.missing.slice(0, 30).map(e => (
                <button
                  key={e.type}
                  onClick={() => onCreateFromEDU && onCreateFromEDU(e)}
                  title={`${e.type}${e.dictionary ? ` (${e.dictionary})` : ""} — click to create authored entry`}
                  style={{ background: "rgba(232,136,136,0.10)", border: "1px solid rgba(232,136,136,0.25)", color: "#e88", padding: "2px 6px", borderRadius: 3, fontSize: 11, fontFamily: "Consolas, monospace", cursor: onCreateFromEDU ? "pointer" : "default" }}
                >{e.type}</button>
              ))}
              {eduCoverage.missing.length > 30 && (
                <span style={{ color: "#888", fontSize: 11, padding: "2px 6px" }}>+{eduCoverage.missing.length - 30} more</span>
              )}
            </div>
          ) : (
            <div style={{ color: "#7c9", fontSize: 12, fontStyle: "italic" }}>Every EDU unit owned by this faction has an authored recruitment line.</div>
          )}
        </div>
      )}
    </div>
  );
}

function buildGrid(units, faction) {
  // Filter authored units: must include this faction in the positive list (or "all"), AND must be
  // a faction-side unit — AOR siblings are excluded so the overview reflects each faction's own
  // actual roster, not the catch-all AOR pool that any faction can recruit.
  const matched = units.filter(u => {
    if (u.aor && u.aor.aorOnly) return false;          // skip AOR-only entries
    if (/^aor\s+/i.test(u.unit || "")) return false;   // skip units explicitly named "aor X"
    if (isNonRecruitable(u)) return false;             // skip ships and mob units
    const f = u.factions || [];
    return f.includes(faction) || f.includes("all");
  });
  const rows = {}; // role → { total, tiers: { 1: [], 2: [], 3: [], 4: [] } }
  for (const role of ROSTER_ROLES) rows[role] = { total: 0, tiers: { 1: [], 2: [], 3: [], 4: [] } };

  for (const u of matched) {
    const role = categorizeUnit(u);
    const tier = u.canonicalMicTier ?? u.minTier ?? 1;
    if (!rows[role]) rows[role] = { total: 0, tiers: { 1: [], 2: [], 3: [], 4: [] } };
    if (!rows[role].tiers[tier]) rows[role].tiers[tier] = [];
    rows[role].tiers[tier].push(u);
    rows[role].total++;
  }

  // Count gaps: rows that have units, but missing tier 1, 2, or 3
  let gaps = 0;
  for (const role of ROSTER_ROLES) {
    const row = rows[role];
    if (row.total === 0) continue;
    for (const t of [1, 2, 3]) {
      if (!row.tiers[t] || row.tiers[t].length === 0) gaps++;
    }
  }

  return { rows, totalUnits: matched.length, gaps };
}

const thStyle = {
  padding: "6px 10px",
  borderBottom: "1px solid rgba(255,255,255,0.08)",
  fontSize: 10,
  color: "#888",
  fontWeight: 600,
  textTransform: "uppercase",
  letterSpacing: 0.5,
};
const tdStyle = {
  padding: "6px 10px",
  borderBottom: "1px solid rgba(255,255,255,0.04)",
  color: "#bbb",
};
