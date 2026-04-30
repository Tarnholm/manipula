import React, { useMemo, useState } from "react";
import { validateUnits, validateFactions, summarize } from "../validation";

export default function ValidationView({ units, modIndex, onJump, onFilterFaction }) {
  const issues = useMemo(() => validateUnits(units, modIndex), [units, modIndex]);
  const factionIssues = useMemo(() => validateFactions(units, modIndex), [units, modIndex]);
  const sum = useMemo(() => summarize(issues), [issues]);
  const [filter, setFilter] = useState("all");

  const filtered = issues.filter(i => filter === "all" || i.severity === filter);

  // Group by unit
  const groups = new Map();
  for (const i of filtered) {
    if (!groups.has(i.unitId)) groups.set(i.unitId, []);
    groups.get(i.unitId).push(i);
  }

  return (
    <div style={{ height: "100%", overflow: "auto", padding: 16 }}>
      <div style={{ display: "flex", gap: 12, alignItems: "baseline", marginBottom: 14, flexWrap: "wrap" }}>
        <div style={{ fontSize: 16, fontWeight: 700 }}>Validation</div>
        <Pill onClick={() => setFilter("all")} active={filter === "all"} color="#999">{sum.total} total</Pill>
        <Pill onClick={() => setFilter("error")} active={filter === "error"} color="#e88">{sum.error} errors</Pill>
        <Pill onClick={() => setFilter("warn")} active={filter === "warn"} color="#dca64a">{sum.warn} warnings</Pill>
        <Pill onClick={() => setFilter("info")} active={filter === "info"} color="#7af">{sum.info} info</Pill>
      </div>

      {sum.total === 0 && factionIssues.length === 0 && (
        <div style={{ padding: 30, textAlign: "center", color: "#7c9", fontSize: 14 }}>
          No issues found. Looks good.
        </div>
      )}

      {factionIssues.length > 0 && (
        <div style={{ marginBottom: 18 }}>
          <div style={{ fontSize: 11, color: "#dca64a", marginBottom: 8, textTransform: "uppercase", letterSpacing: 0.6, fontWeight: 700 }}>
            Faction-level — tier gaps
          </div>
          {factionIssues.map((fi, idx) => (
            <div key={idx} style={{ marginBottom: 10, padding: "10px 12px", background: "rgba(220,166,74,0.06)", border: "1px solid rgba(220,166,74,0.2)", borderRadius: 8 }}>
              <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                <button
                  onClick={() => onFilterFaction && onFilterFaction(fi.faction)}
                  style={{ background: "rgba(220,166,74,0.18)", border: "1px solid rgba(220,166,74,0.3)", color: "#dca64a", padding: "3px 8px", borderRadius: 4, fontSize: 12, fontWeight: 600 }}
                >Filter →</button>
                <span style={{ fontWeight: 600 }}>{fi.faction}</span>
                <span style={{ color: "#888", fontSize: 11 }}>· {fi.unitCount} units · missing tier{fi.missingTiers.length > 1 ? "s" : ""} {fi.missingTiers.join(", ")}</span>
              </div>
              <div style={{ fontSize: 12, color: "#cba", marginTop: 4 }}>
                {fi.message}
              </div>
              <div style={{ fontSize: 11, color: "#999", marginTop: 4, fontStyle: "italic" }}>
                Suggestion: filter by this faction, multi-select all units, then in the bulk-edit pane run <span style={{ color: "#dca64a", fontStyle: "normal" }}>Tier-gap XP filler</span>.
              </div>
            </div>
          ))}
        </div>
      )}

      {[...groups].map(([unitId, issuesForUnit]) => {
        const u = units.find(x => x.id === unitId);
        if (!u) return null;
        const display = modIndex.unitDisplayName ? modIndex.unitDisplayName(u.unit) : null;
        return (
          <div key={unitId} style={{ marginBottom: 14, background: "rgba(28,30,32,0.4)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 8, padding: "10px 12px" }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 8 }}>
              <button
                onClick={() => onJump && onJump(unitId)}
                style={{ background: "rgba(220,166,74,0.18)", border: "1px solid rgba(220,166,74,0.3)", color: "#dca64a", padding: "3px 8px", borderRadius: 4, fontSize: 12, fontWeight: 600 }}
              >Jump →</button>
              <span style={{ fontWeight: 600 }}>{display || u.unit}</span>
              {display && <span style={{ color: "#666", fontSize: 11 }}>({u.unit})</span>}
              <span style={{ color: "#888", fontSize: 11 }}>· {u.unitType || "faction"} · t{u.minTier}</span>
            </div>
            {issuesForUnit.map((i, idx) => (
              <div key={idx} style={{ display: "flex", gap: 8, alignItems: "baseline", padding: "3px 0", fontSize: 12.5 }}>
                <Severity severity={i.severity} />
                <span style={{ color: "#ccc" }}>{i.message}</span>
                <span style={{ color: "#555", fontFamily: "Consolas, monospace", fontSize: 11 }}>[{i.code}]</span>
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}

function Pill({ children, color, onClick, active }) {
  return (
    <button
      onClick={onClick}
      style={{
        background: active ? color : "transparent",
        color: active ? "#1a1a1a" : color,
        border: `1px solid ${color}`,
        padding: "4px 12px",
        borderRadius: 14,
        fontSize: 12,
        fontWeight: 600,
      }}
    >{children}</button>
  );
}

function Severity({ severity }) {
  const map = { error: { c: "#e88", t: "ERROR" }, warn: { c: "#dca64a", t: "WARN" }, info: { c: "#7af", t: "INFO" } };
  const m = map[severity] || { c: "#999", t: severity };
  return (
    <span style={{ display: "inline-block", minWidth: 50, fontSize: 10, fontWeight: 700, color: m.c, fontFamily: "Consolas, monospace" }}>{m.t}</span>
  );
}
