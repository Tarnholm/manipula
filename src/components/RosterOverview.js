import React, { useMemo, useState } from "react";
import FactionIcon from "./FactionIcon";
import { ROSTER_ROLES, categorizeUnit, isNonRecruitable } from "../qualityClasses";
import { generatePlayerLines, generateAORPlayerLines, generateAILines } from "../generator";

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
  const [showDetailed, setShowDetailed] = useState(false);
  // Per-unit recruitment table — for each unit recruitable by this
  // faction, which buildings + tier ranges does it actually emit lines
  // in? Computed by running the generator and tagging cells. Memoised
  // off (units, faction) since it scales O(unitsForFaction) with a
  // generator pass per unit.
  const recruitTable = useMemo(() => {
    if (!showDetailed) return null;
    const ours = units.filter(u => {
      if (u.enabled === false) return false;
      if (isNonRecruitable(u)) return false;
      const f = u.factions || [];
      return f.includes(faction) || f.includes("all");
    });
    return ours.map(u => {
      let player = [], aor = [], ai = [];
      try { player = generatePlayerLines(u); } catch {}
      try { aor = generateAORPlayerLines(u); } catch {}
      try { ai = generateAILines(u); } catch {}
      const tierOf = (lvl) => { const m = String(lvl || "").match(/^(?:mic|gov|garrison)_?\+?(\d)/); return m ? parseInt(m[1], 10) : null; };
      const govTier = (b) => {
        const lines = player.filter(l => l.building === b);
        if (!lines.length) return null;
        const t = lines.map(l => l.text.match(/mic_tier_(\d)/)).filter(Boolean).map(m => parseInt(m[1], 10));
        return t.length ? Math.min(...t) : "✓";
      };
      const tiersIn = (lines, building) => {
        const filtered = lines.filter(l => l.building === building);
        const tiers = filtered.map(l => tierOf(l.level)).filter(Number.isFinite);
        if (!tiers.length) return null;
        const lo = Math.min(...tiers), hi = Math.max(...tiers);
        return lo === hi ? String(lo) : `${lo}-${hi}`;
      };
      return {
        id: u.id,
        unit: u.unit,
        govB: govTier("governmentB"),
        govC: govTier("governmentC"),
        govD: govTier("governmentD"),
        aor: aor.length > 0 ? "✓" : null,
        aorBoth: aor.some(l => l.alsoFactional),    // shared AOR (factional + aor lines)
        mic: tiersIn(ai, "military_industrial_complex"),
        garrison: tiersIn(ai, "garrison"),
      };
    });
  }, [showDetailed, units, faction]);
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
      {/* Per-unit recruitment dashboard. Lazy-rendered behind a toggle
          because the generator pass per unit has measurable cost on
          large rosters and the user usually only wants the tier×role
          summary above. Click to expand → table of every unit × the
          buildings it recruits in (player gov chain + AOR + AI MIC /
          garrison). Helps spot lopsided coverage at a glance. */}
      <div style={{ marginTop: 12 }}>
        <button
          onClick={() => setShowDetailed(s => !s)}
          style={{ background: "rgba(255,255,255,0.04)", color: "#aaa", border: "1px solid rgba(255,255,255,0.08)", padding: "4px 12px", borderRadius: 4, fontSize: 11, fontWeight: 600, cursor: "pointer" }}
          title="Toggle the per-unit × per-building recruitment table"
        >{showDetailed ? "▾ Hide" : "▸ Show"} detailed recruitment table</button>
      </div>
      {showDetailed && recruitTable && recruitTable.length > 0 && (
        <div style={{ marginTop: 8, padding: 8, background: "rgba(0,0,0,0.2)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 6, overflow: "auto", maxHeight: 420 }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
            <thead style={{ position: "sticky", top: 0, background: "rgba(28,30,32,0.95)" }}>
              <tr>
                <th style={dthStyle}>Unit</th>
                <th style={dthStyle} title="Player line in governmentB (Indirect Rule); shows the mic_tier requirement">GovB</th>
                <th style={dthStyle} title="Player line in governmentC (Direct Rule); shows the mic_tier requirement">GovC</th>
                <th style={dthStyle} title="Player line in governmentD (Homeland); shows the mic_tier requirement">GovD</th>
                <th style={dthStyle} title="Player AOR sibling line in hinterland_region. ✓ = AOR enabled. ★ = also recruits the factional name in AOR (Greek/Latin shared pattern)">AOR</th>
                <th style={dthStyle} title="AI lines in the military_industrial_complex building chain; shows the tier range">MIC (AI)</th>
                <th style={dthStyle} title="AI lines in the garrison building chain; shows the tier range">Gar (AI)</th>
              </tr>
            </thead>
            <tbody>
              {recruitTable.map(r => (
                <tr key={r.id} onClick={() => onUnitClick && onUnitClick(r.id)} style={{ cursor: onUnitClick ? "pointer" : "default" }}
                  onMouseEnter={(e) => e.currentTarget.style.background = "rgba(220,166,74,0.06)"}
                  onMouseLeave={(e) => e.currentTarget.style.background = ""}>
                  <td style={{ ...dtdStyle, color: "#dca64a", fontFamily: "Consolas, monospace" }}>{r.unit}</td>
                  <td style={dtdStyle}>{cellOf(r.govB)}</td>
                  <td style={dtdStyle}>{cellOf(r.govC)}</td>
                  <td style={dtdStyle}>{cellOf(r.govD)}</td>
                  <td style={dtdStyle}>{r.aor ? <span style={{ color: r.aorBoth ? "#dca64a" : "#7c9", fontWeight: 700 }}>{r.aorBoth ? "★" : "✓"}</span> : <span style={{ color: "#444" }}>—</span>}</td>
                  <td style={dtdStyle}>{cellOf(r.mic)}</td>
                  <td style={dtdStyle}>{cellOf(r.garrison)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div style={{ marginTop: 6, fontSize: 10, color: "#888", fontStyle: "italic" }}>
            Cell shows the mic_tier requirement (player Gov columns) or tier range (AI columns). ★ in AOR = shared factional/AOR (Greek/Latin pattern). Click a row to jump to the unit.
          </div>
        </div>
      )}
      {showDetailed && recruitTable && recruitTable.length === 0 && (
        <div style={{ marginTop: 8, padding: 12, color: "#888", fontStyle: "italic", fontSize: 12, textAlign: "center" }}>
          No units in this faction yet — add some via the EDU coverage panel above or the sidebar's + New unit.
        </div>
      )}
    </div>
  );
}

const dthStyle = { padding: "5px 8px", borderBottom: "1px solid rgba(220,166,74,0.18)", fontSize: 10, color: "#888", fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.4, textAlign: "center" };
const dtdStyle = { padding: "4px 8px", borderBottom: "1px solid rgba(255,255,255,0.04)", color: "#bbb", textAlign: "center", fontFamily: "Consolas, monospace" };
function cellOf(v) {
  if (v == null) return <span style={{ color: "#444" }}>—</span>;
  return <span style={{ color: "#dca64a" }}>{v}</span>;
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
