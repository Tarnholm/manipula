import React, { useMemo, useState } from "react";

export default function UnitList({ units, selectedId, selectedIds, onSelect, onAdd, onDelete, onDuplicate, onCreateFromEDU, modIndex, filter, onFilterChange }) {
  selectedIds = selectedIds || new Set();
  const [q, setQ] = useState("");
  const filterMode = (filter && filter.mode) || "none";
  const filterValue = (filter && filter.value) || "";
  const setFilterMode = (m) => onFilterChange && onFilterChange({ mode: m, value: "" });
  const setFilterValue = (v) => onFilterChange && onFilterChange({ mode: filterMode, value: v });

  // Build dropdowns from BOTH authored units (counts how many of YOUR units use each value) AND the
  // full mod data (so the user can pick a faction they haven't authored anything for yet — useful
  // when adding a new faction's roster from scratch, since "Not yet coded" rows only appear under
  // an active faction filter).
  const usageOptions = useMemo(() => {
    const factionCounts = new Map(), hrs = new Map(), reforms = new Map();
    const bump = (m, k) => m.set(k, (m.get(k) || 0) + 1);
    for (const u of units) {
      for (const f of (u.factions || [])) bump(factionCounts, f);
      for (const r of [...(u.commonRequires || []), ...(u.requires || []), ...(u.outsideExtras || [])]) {
        let m;
        if ((m = r.match(/^hidden_resource\s+(\S+)$/))) bump(hrs, m[1]);
        else if ((m = r.match(/^major_event\s+"([^"]+)"$/))) bump(reforms, m[1]);
      }
    }
    // Authored-faction list (with counts), sorted by count desc
    const authoredFactions = [...factionCounts]
      .sort((a, b) => b[1] - a[1])
      .map(([value, count]) => ({ value, count, authored: true }));
    // Mod factions not yet authored — surfaced underneath the authored ones
    const authoredSet = new Set(factionCounts.keys());
    const modFactions = (modIndex.factions || [])
      .map(f => f.id)
      .filter(id => !authoredSet.has(id))
      .sort()
      .map(value => ({ value, count: 0, authored: false }));
    const sortByCount = (m) => [...m].sort((a, b) => b[1] - a[1]).map(([k, v]) => ({ value: k, count: v }));
    return {
      factions: [...authoredFactions, ...modFactions],
      hrs: sortByCount(hrs),
      reforms: sortByCount(reforms),
    };
  }, [units, modIndex]);

  const matchesUnitText = (u, ql) => {
    if (!ql) return true;
    const display = modIndex.unitDisplayName ? modIndex.unitDisplayName(u.unit) : null;
    if (u.unit.toLowerCase().includes(ql)) return true;
    if (display && display.toLowerCase().includes(ql)) return true;
    if (u.notes && u.notes.toLowerCase().includes(ql)) return true;
    if ((u.factions || []).some(f => f.toLowerCase().includes(ql))) return true;
    if ((u.excludeFactions || []).some(f => f.toLowerCase().includes(ql))) return true;
    if ((u.requires || []).some(r => r.toLowerCase().includes(ql))) return true;
    return false;
  };

  const filtered = useMemo(() => {
    const ql = q.toLowerCase();
    return units.filter(u => {
      if (ql && !matchesUnitText(u, ql)) return false;
      if (filterMode === "faction" && filterValue) {
        if (!(u.factions || []).includes(filterValue)) return false;
      } else if (filterMode === "hr" && filterValue) {
        if (!(u.requires || []).some(r => r === `hidden_resource ${filterValue}`)) return false;
      } else if (filterMode === "reform" && filterValue) {
        if (!(u.requires || []).some(r => r === `major_event "${filterValue}"`)) return false;
      }
      return true;
    });
    // eslint-disable-next-line
  }, [units, q, filterMode, filterValue, modIndex]);

  // Ghost units: present in EDU with the filtered faction in ownership, but not yet authored.
  // Only shown when filterMode === "faction" and a faction is picked, since the full EDU is huge.
  // Returns { rows, totalEduForFaction } so the UI can show "0 missing of N" diagnostics.
  const ghostInfo = useMemo(() => {
    if (filterMode !== "faction" || !filterValue) return { rows: [], totalEduForFaction: 0 };
    const authored = new Set(units.map(u => u.unit));
    const edu = modIndex.edu || [];
    const matchingEdu = edu.filter(e => Array.isArray(e.ownership) && e.ownership.includes(filterValue));
    const ql = q.toLowerCase();
    const rows = matchingEdu
      .filter(e => !authored.has(e.type))
      .filter(e => !ql
        || e.type.toLowerCase().includes(ql)
        || (e.dictionary && e.dictionary.toLowerCase().includes(ql)))
      .map(e => ({
        _ghost: true,
        id: "ghost_" + e.type,
        unit: e.type,
        edu: e,
        suggestedFactions: e.ownership.filter(o => o !== "slave"),
      }));
    return { rows, totalEduForFaction: matchingEdu.length };
    // eslint-disable-next-line
  }, [units, modIndex, filterMode, filterValue, q]);
  const ghostUnits = ghostInfo.rows;

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", borderRight: "1px solid #333" }}>
      <div style={{ padding: 10, borderBottom: "1px solid rgba(255,255,255,0.06)", background: "rgba(255,255,255,0.02)" }}>
        {selectedIds.size > 1 && (
          <div style={{ marginBottom: 8, padding: "4px 8px", background: "rgba(220,166,74,0.15)", borderRadius: 4, fontSize: 11, color: "#dca64a", fontWeight: 600 }}>
            {selectedIds.size} units selected — bulk-edit pane is active
          </div>
        )}
        <div style={{ display: "flex", gap: 4, marginBottom: 8 }}>
          <button onClick={onAdd} style={btn("#3a6")}>＋ New unit</button>
          <button
            onClick={() => selectedId && onDuplicate(selectedId)}
            disabled={!selectedId}
            style={btn("#446", !selectedId)}
          >Duplicate</button>
          <button
            onClick={() => selectedId && window.confirm("Delete unit?") && onDelete(selectedId)}
            disabled={!selectedId}
            style={btn("#733", !selectedId)}
          >Delete</button>
        </div>
        <input
          type="text"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={`Search ${units.length} units (name / faction / requires)…`}
          style={{ width: "100%", background: "#252525", border: "1px solid #333", color: "#ddd", padding: "5px 8px", borderRadius: 6, marginBottom: 6 }}
        />
        <div style={{ display: "flex", gap: 4 }}>
          <select
            value={filterMode}
            onChange={(e) => { setFilterMode(e.target.value); }}
            style={{ background: "#252525", border: "1px solid #333", color: "#ddd", padding: "5px 7px", borderRadius: 6, fontSize: 12 }}
          >
            <option value="none">Used in: any</option>
            <option value="faction">faction</option>
            <option value="hr">hidden_resource</option>
            <option value="reform">reform</option>
          </select>
          <select
            value={filterValue}
            onChange={(e) => setFilterValue(e.target.value)}
            disabled={filterMode === "none"}
            style={{ flex: 1, background: "#252525", border: "1px solid #333", color: "#ddd", padding: "5px 7px", borderRadius: 6, fontSize: 12 }}
          >
            <option value="">— pick —</option>
            {filterMode === "faction" && usageOptions.factions.map(o => (
              <option key={o.value} value={o.value}>
                {o.value} {o.authored ? `(${o.count})` : "(no units yet)"}
              </option>
            ))}
            {filterMode === "hr" && usageOptions.hrs.map(o => <option key={o.value} value={o.value}>{o.value} ({o.count})</option>)}
            {filterMode === "reform" && usageOptions.reforms.map(o => <option key={o.value} value={o.value}>{o.value} ({o.count})</option>)}
          </select>
        </div>
      </div>
      <div style={{ flex: 1, overflow: "auto" }}>
        {filtered.length === 0 && ghostUnits.length === 0 && (
          <div style={{ color: "#777", padding: 20, textAlign: "center" }}>
            {units.length === 0 ? "No units yet — click ＋ New unit to add one." : "No matches."}
          </div>
        )}
        {filtered.length > 0 && filterMode === "faction" && filterValue && (
          <div style={{ padding: "6px 12px", fontSize: 10, color: "#888", textTransform: "uppercase", letterSpacing: 0.6, background: "rgba(0,0,0,0.15)" }}>
            Authored — {filtered.length}
          </div>
        )}
        {filtered.map(u => {
          const display = modIndex.unitDisplayName ? modIndex.unitDisplayName(u.unit) : null;
          const isPrimary = u.id === selectedId;
          const isMulti = selectedIds.has(u.id);
          return (
            <div
              key={u.id}
              onClick={(ev) => onSelect(u.id, ev)}
              style={{
                padding: "8px 12px",
                borderBottom: "1px solid rgba(255,255,255,0.04)",
                cursor: "pointer",
                background: isPrimary ? "rgba(220,166,74,0.18)" : isMulti ? "rgba(220,166,74,0.08)" : "",
                borderLeft: u.enabled === false ? "3px solid #555" : isPrimary ? "3px solid #dca64a" : isMulti ? "3px solid rgba(220,166,74,0.5)" : "3px solid transparent",
                transition: "background 0.12s",
              }}
            >
              <div style={{ fontWeight: 600, color: u.enabled === false ? "#888" : "#ddd" }}>
                {u.writeBack === false && (
                  <span title="Reference-only — won't write to EDB" style={{ color: "#666", fontSize: 11, marginRight: 6 }}>📖</span>
                )}
                {display || u.unit}
                {display && <span style={{ color: "#666", fontWeight: 400, marginLeft: 6, fontSize: 11 }}>({u.unit})</span>}
              </div>
              <div style={{ fontSize: 11, color: "#888" }}>
                {u.grade || "?"} · t{u.canonicalMicTier ?? u.minTier ?? "?"}{u.homelandMicTier && u.homelandMicTier !== (u.canonicalMicTier ?? u.minTier) ? `(home t${u.homelandMicTier})` : ""}{u.aor && u.aor.enabled ? " · +AOR" : ""} · {(u.factions || []).slice(0, 3).join(", ")}{(u.factions || []).length > 3 ? `, +${u.factions.length - 3}` : ""}
              </div>
            </div>
          );
        })}

        {filterMode === "faction" && filterValue && (
          <div style={{ padding: "6px 12px", fontSize: 10, color: "#dca64a", textTransform: "uppercase", letterSpacing: 0.6, background: "rgba(220,166,74,0.06)", borderTop: "1px dashed rgba(220,166,74,0.2)", marginTop: 4 }}>
            Not yet coded into EDB — {ghostUnits.length}
            <span style={{ float: "right", color: "#888", fontWeight: 400, textTransform: "none", letterSpacing: 0 }}>
              {ghostInfo.totalEduForFaction} EDU entries own "{filterValue}"
            </span>
          </div>
        )}
        {filterMode === "faction" && filterValue && ghostUnits.length === 0 && ghostInfo.totalEduForFaction > 0 && (
          <div style={{ padding: 14, color: "#7c9", fontSize: 12, textAlign: "center", fontStyle: "italic" }}>
            All {ghostInfo.totalEduForFaction} EDU entries for "{filterValue}" are already authored.
          </div>
        )}
        {filterMode === "faction" && filterValue && ghostInfo.totalEduForFaction === 0 && (
          <div style={{ padding: 14, color: "#a77", fontSize: 12, textAlign: "center", fontStyle: "italic" }}>
            No EDU entries have "{filterValue}" in ownership.
            {(modIndex.edu || []).length === 0 && <div style={{ marginTop: 4, color: "#888" }}>Tip: click <strong>Reload</strong> in the topbar so the EDU file is parsed.</div>}
          </div>
        )}
        {ghostUnits.map(g => {
          const display = modIndex.unitDisplayName ? modIndex.unitDisplayName(g.unit) : null;
          return (
            <div
              key={g.id}
              onClick={() => onCreateFromEDU && onCreateFromEDU(g.edu)}
              title="Click to create a unit family from this EDU entry"
              style={{
                padding: "8px 12px",
                borderBottom: "1px solid rgba(255,255,255,0.04)",
                cursor: "pointer",
                background: "rgba(220,166,74,0.04)",
                borderLeft: "3px dashed rgba(220,166,74,0.5)",
                opacity: 0.8,
                transition: "opacity 0.15s, background 0.12s",
              }}
              onMouseEnter={(e) => { e.currentTarget.style.opacity = "1"; e.currentTarget.style.background = "rgba(220,166,74,0.12)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.opacity = "0.8"; e.currentTarget.style.background = "rgba(220,166,74,0.04)"; }}
            >
              <div style={{ display: "flex", alignItems: "baseline", gap: 6, fontWeight: 500, color: "#cba", fontStyle: "italic" }}>
                {display || g.unit}
                {display && <span style={{ color: "#666", fontWeight: 400, fontSize: 11, fontStyle: "normal" }}>({g.unit})</span>}
                <span style={{ marginLeft: "auto", fontSize: 9, color: "#dca64a", fontStyle: "normal", fontWeight: 700, letterSpacing: 0.5 }}>+ ADD</span>
              </div>
              <div style={{ fontSize: 11, color: "#777", fontStyle: "italic" }}>
                {g.edu.category || "?"} · {g.edu.class || "?"} · ownership: {g.suggestedFactions.slice(0, 3).join(", ")}{g.suggestedFactions.length > 3 ? `, +${g.suggestedFactions.length - 3}` : ""}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function btn(color, disabled) {
  return {
    flex: 1,
    background: disabled ? "rgba(255,255,255,0.06)" : color,
    color: disabled ? "#666" : "#fff",
    border: "none",
    padding: "6px 8px",
    borderRadius: 6,
    fontSize: 12,
    fontWeight: 500,
    cursor: disabled ? "default" : "pointer",
  };
}
