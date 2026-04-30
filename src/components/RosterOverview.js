import React, { useMemo } from "react";
import { ROSTER_ROLES, roleOf } from "../qualityClasses";

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

export default function RosterOverview({ units, faction, onUnitClick }) {
  const grid = useMemo(() => buildGrid(units, faction), [units, faction]);
  if (!faction) return null;

  return (
    <div style={{ marginBottom: 12, padding: 12, background: "rgba(28,30,32,0.5)", border: "1px solid rgba(220,166,74,0.18)", borderRadius: 10 }}>
      <div style={{ display: "flex", alignItems: "baseline", marginBottom: 10, gap: 8 }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: "#dca64a", textTransform: "uppercase", letterSpacing: 0.6 }}>
          Roster overview — {faction}
        </div>
        <div style={{ color: "#888", fontSize: 11 }}>{grid.totalUnits} authored units</div>
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
            if (!row || row.total === 0) return null;
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
    </div>
  );
}

function buildGrid(units, faction) {
  // Filter authored units that include this faction in their positive list (or "all").
  const matched = units.filter(u => (u.factions || []).includes(faction) || (u.factions || []).includes("all"));
  const rows = {}; // role → { total, tiers: { 1: [], 2: [], 3: [], 4: [] } }
  for (const role of ROSTER_ROLES) rows[role] = { total: 0, tiers: { 1: [], 2: [], 3: [], 4: [] } };

  for (const u of matched) {
    const role = roleOf(u.qualityClass);
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
