import React, { useMemo, useState } from "react";
import { validateUnits, validateFactions, summarize, eduValidationIssues, eduOrphanIssues, crossSideIssues } from "../validation";
import { validate as eduValidate } from "../edu_matic/validate";

// Per-issue-code documentation. Hovering an issue's code in the validation tab shows
// these as a tooltip — explains what the rule means and how to fix it. Codes that
// aren't in this map fall back to the issue.message itself.
const ISSUE_DOCS = {
  "empty-name": "The unit's recruit name field is empty. The EDB writer can't generate a recruit line without a name. Set the unit's primary recruit string in the editor.",
  "duplicate-unit": "Two authored units share the same recruit name. Both will emit lines for the same string, leading to duplicate entries in the EDB. Rename or delete one.",
  "unknown-edu": "This recruit name doesn't match any unit in export_descr_unit.txt. The game will fail to instantiate the unit at recruit-time. Check spelling, or add the EDU entry.",
  "missing-unit-card": "No unit_card.tga found in data/ui/units/<faction>/ for this recruit name. The unit will recruit but show a blank portrait in-game.",
  "bad-canonical-tier": "Canonical mic_tier must be 1–4. The MIC building only has four levels — anything else is silently ignored by the engine.",
  "bad-homeland-tier": "Homeland mic_tier must be 1–4 (or unset). Same constraint as canonical tier.",
  "outside-extras-orphaned": "outsideExtras only apply to GovB/GovC lines. With both off, the extras you set will never be emitted anywhere. Either enable an outside-government emit or move the extras to commonRequires.",
  "no-emit": "No government lines emitted and no AOR sibling — this unit produces zero player recruitment. Probably not what you want.",
  "no-factions": "Empty factions list. The recruit line `factions { }` is invalid and will fail to parse in-game.",
  "unknown-faction": "This faction id isn't in descr_sm_factions.txt or any culture group. Check spelling.",
  "unknown-exclude-faction": "Same as unknown-faction but in the excludeFactions list. Excluding a non-existent faction has no effect but indicates a typo.",
  "unknown-hr": "This hidden_resource isn't in descr_sm_resources.txt. The recruit line will fail to parse — descr_sm_resources must declare every HR before it can be referenced.",
  "unknown-hr-negated": "Same hidden_resource lookup, but in a `not hidden_resource` clause. Less fatal (the negation is always true if the HR is undefined) but signals a typo.",
  "unknown-resource": "This `resource X` clause references a resource not in descr_sm_resources.txt. Resources are different from hidden_resources — make sure you mean the right one.",
  "unknown-reform": "The `major_event` doesn't match any reform in your script files. The recruit line will never be activatable. Check the major_event_scripts/ folder.",
  "unknown-alias": "This bare alias isn't declared in descr_sm_factions/EDB. Aliases are like `colony_tier_1` — they have to be defined elsewhere in the EDB before they can be referenced in requires.",
  "gov-tier-below-mic": "AOR's gov_tier_X is below this unit's canonical mic_tier_Y. The MIC tier check fires first; the AOR variant won't recruit until the mic tier is reached, regardless of gov_tier. Bump gov_tier to ≥ canonical mic_tier.",
  "tier-conflict": "Two units recruit at the same (faction, mic_tier) with overlapping HR requirements. They'll both appear in the same recruitment list — likely a tier-collision you didn't intend. Tighten one's HR or shift its tier.",
  "edu-orphan": "An EDB recruit line references a unit type that doesn't exist in your EDU. The game will fail to load. Either add the EDU entry or remove the recruit line.",
  "cross-faction-mismatch": "EDB factions list doesn't overlap with EDU ownership. The recruit line allows recruitment by factions that the EDU doesn't allow to own the unit — silently broken.",
  "typo-suspect": "Recruit name is one character off from an existing EDU type. Probably a typo (e.g. roman_hastatii vs roman_hastati). Edit the unit name to match the EDU.",
};

export default function ValidationView({ units, modIndex, missingCards, eduProject, onJump, onFilterFaction, onCreateEduStubs }) {
  const issues = useMemo(() => {
    const recruit = validateUnits(units, modIndex, { missingCards });
    const edu = eduValidationIssues(eduProject, eduValidate);
    const orphans = eduOrphanIssues(modIndex);
    const cross = crossSideIssues(units, eduProject);
    return [...recruit, ...orphans, ...cross, ...edu];
  }, [units, modIndex, missingCards, eduProject]);
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
        <span style={{ color: "#888", fontSize: 11, marginLeft: 12 }}>
          Missing unit cards: <strong style={{ color: missingCards && missingCards.size > 0 ? "#e88" : "#7c9" }}>{missingCards ? missingCards.size : "?"}</strong>
        </span>
        {/* EDB → EDU bulk sync. Only useful when an EDU project is loaded; creates a stub
            row for every authored unit that has no matching EDU entry. */}
        {eduProject && onCreateEduStubs && (() => {
          const eduSet = new Set((eduProject.units || []).map(eu => eu.Unit || eu.unit || eu.Type || eu.type).filter(Boolean));
          const missing = (units || []).filter(u => u.unit && !eduSet.has(u.unit));
          return missing.length > 0 ? (
            <button
              onClick={() => { if (window.confirm(`Create EDU stubs for all ${missing.length} authored units missing from the EDU project?`)) onCreateEduStubs(missing); }}
              title="Bulk-create EDU rows for every authored unit lacking one — closes the gap when starting from an existing mod."
              style={{ marginLeft: "auto", background: "rgba(124,201,153,0.10)", border: "1px solid rgba(124,201,153,0.35)", color: "#7c9", padding: "4px 12px", borderRadius: 4, fontSize: 11, fontWeight: 600, cursor: "pointer" }}
            >+ Sync EDB → EDU ({missing.length})</button>
          ) : null;
        })()}
      </div>

      {sum.total === 0 && factionIssues.length === 0 && (
        <div style={{ padding: 30, textAlign: "center", color: "#7c9", fontSize: 14 }}>
          No issues found. Looks good.
        </div>
      )}

      {/* Missing unit cards — always rendered when units exist so the user can confirm the
          check is wired up. Shows the count, a status line, and a chip per missing recruit name. */}
      {units.length > 0 && (
        <div style={{ marginBottom: 18 }}>
          <div style={{ fontSize: 11, color: missingCards && missingCards.size > 0 ? "#e88" : "#7c9", marginBottom: 8, textTransform: "uppercase", letterSpacing: 0.6, fontWeight: 700 }}>
            Missing unit cards — {missingCards ? missingCards.size : "checking…"}
          </div>
          <div style={{ padding: "10px 12px", background: missingCards && missingCards.size > 0 ? "rgba(232,136,136,0.06)" : "rgba(124,201,153,0.05)", border: `1px solid ${missingCards && missingCards.size > 0 ? "rgba(232,136,136,0.25)" : "rgba(124,201,153,0.18)"}`, borderRadius: 8, fontSize: 12.5 }}>
            {!missingCards ? (
              <div style={{ color: "#888", fontStyle: "italic" }}>Waiting for main process to scan mod data…</div>
            ) : missingCards.size === 0 ? (
              <div style={{ color: "#7c9", fontStyle: "italic" }}>All authored units have a unit_card.tga in the mod data.</div>
            ) : (
              <>
                <div style={{ color: "#cba", marginBottom: 6, fontStyle: "italic" }}>
                  No <code style={{ color: "#dca64a" }}>unit_card.tga</code> located under <code>data/ui/units/&lt;faction&gt;/</code> for these recruit names. Check spelling or add the portrait file to your mod.
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
                  {[...missingCards].sort().map(name => {
                    const u = units.find(x => x.unit === name);
                    return (
                      <button
                        key={name}
                        onClick={() => u && onJump && onJump(u.id)}
                        style={{ background: "rgba(232,136,136,0.12)", border: "1px solid rgba(232,136,136,0.3)", color: "#e88", padding: "3px 8px", borderRadius: 4, fontSize: 11.5, fontFamily: "Consolas, monospace", cursor: u ? "pointer" : "default" }}
                        title={u ? "Jump to unit" : "Unit not in current profile"}
                      >{name}</button>
                    );
                  })}
                </div>
              </>
            )}
          </div>
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
                <span title={ISSUE_DOCS[i.code] || ""} style={{ color: "#555", fontFamily: "Consolas, monospace", fontSize: 11, cursor: ISSUE_DOCS[i.code] ? "help" : "default", borderBottom: ISSUE_DOCS[i.code] ? "1px dotted #555" : "none" }}>[{i.code}]</span>
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
