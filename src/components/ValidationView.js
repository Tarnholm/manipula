import React, { useMemo, useState, useEffect } from "react";
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
    // Pass DMB cross-file context so the Validate tab matches the Sync
    // popover's error count. Without this, the four DMB checks
    // (unit-dmb-missing, dmb-asset-missing, dmb-orphan-type,
    // dmb-orphan-asset) silently no-op here while still firing in the
    // App.js debounced validate that drives the Sync count.
    const edu = eduValidationIssues(eduProject, eduValidate, {
      dmbModels: modIndex && modIndex.dmbModels,
      dmbExtraUsage: modIndex && modIndex.dmbExtraUsage,
      dmbNewTypes: modIndex && modIndex.dmbNewTypes,
      mountTypesLower: modIndex && modIndex.mountTypesLower,
      mountModelByType: modIndex && modIndex.mountModelByType,
      projectileTypes: modIndex && modIndex.projectileTypes,
      projectileModelPaths: modIndex && modIndex.projectileModelPaths,
      dmbTextures: modIndex && modIndex.dmbTextures,
      dmbModelFiles: modIndex && modIndex.dmbModelFiles,
      dmbAssetMissing: modIndex && modIndex.dmbAssetMissing,
      dmbAssetOrphans: modIndex && modIndex.dmbAssetOrphans,
      dmbBareModelMissing: modIndex && modIndex.dmbBareModelMissing,
      unitStringTags: modIndex && modIndex.strings && modIndex.strings.units ? new Set(Object.keys(modIndex.strings.units)) : null,
    });
    const orphans = eduOrphanIssues(modIndex);
    const cross = crossSideIssues(units, eduProject);
    return [...recruit, ...orphans, ...cross, ...edu];
  }, [units, modIndex, missingCards, eduProject]);
  const factionIssues = useMemo(() => validateFactions(units, modIndex), [units, modIndex]);
  const sum = useMemo(() => summarize(issues), [issues]);
  const [filter, setFilter] = useState("all");
  // Code filter: Set<string> of issue codes to keep. Empty = no filter.
  const [codeFilter, setCodeFilter] = useState(() => new Set());
  const [searchQuery, setSearchQuery] = useState("");
  // Bulk-action selection: Set<unitId> of groups the user has ticked.
  // Cleared whenever the visible filter changes so stale selections
  // don't trigger surprise actions on rows the user can't see.
  const [selectedUnitIds, setSelectedUnitIds] = useState(() => new Set());
  useEffect(() => { setSelectedUnitIds(new Set()); }, [filter, codeFilter, searchQuery]);
  const [bulkBusy, setBulkBusy] = useState(false);

  // Distinct (code → count) for the code-filter chip bar. Computed off
  // severity-filtered issues so the count next to each chip reflects
  // what's actually visible at the current severity.
  const codeCounts = useMemo(() => {
    const m = new Map();
    for (const i of issues) {
      if (filter !== "all" && i.severity !== filter) continue;
      m.set(i.code, (m.get(i.code) || 0) + 1);
    }
    return [...m.entries()].sort((a, b) => b[1] - a[1]);   // most-frequent first
  }, [issues, filter]);

  const filtered = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return issues.filter(i => {
      if (filter !== "all" && i.severity !== filter) return false;
      if (codeFilter.size > 0 && !codeFilter.has(i.code)) return false;
      if (q && !((i.unit || "").toLowerCase().includes(q) || (i.message || "").toLowerCase().includes(q))) return false;
      return true;
    });
  }, [issues, filter, codeFilter, searchQuery]);

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

      {/* Filter row: free-text search + multi-select code chips. The chips
          show a count derived off the severity filter above so they're
          self-consistent ("after I filtered to errors, how many of each
          code remain?"). Click a chip to add/remove from codeFilter;
          empty codeFilter = show all codes. */}
      {(codeCounts.length > 1 || sum.total > 0) && (
        <div style={{ marginBottom: 12, padding: 8, background: "rgba(0,0,0,0.15)", border: "1px solid rgba(255,255,255,0.05)", borderRadius: 6 }}>
          <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 6 }}>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search unit name or message…"
              style={{ flex: 1, background: "#1c1c1c", border: "1px solid #333", color: "#ddd", padding: "5px 10px", borderRadius: 4, fontSize: 12 }}
            />
            {(codeFilter.size > 0 || searchQuery) && (
              <button
                onClick={() => { setCodeFilter(new Set()); setSearchQuery(""); }}
                style={{ background: "rgba(255,255,255,0.06)", color: "#aaa", border: "1px solid #333", padding: "4px 10px", borderRadius: 4, fontSize: 11, cursor: "pointer" }}
                title="Clear search query and all code-chip selections"
              >Clear</button>
            )}
            <span style={{ fontSize: 11, color: "#888" }}>
              {filtered.length} / {sum.total} shown
            </span>
          </div>
          {codeCounts.length > 0 && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
              {codeCounts.map(([code, count]) => {
                const active = codeFilter.has(code);
                return (
                  <button
                    key={code}
                    onClick={() => {
                      const next = new Set(codeFilter);
                      if (next.has(code)) next.delete(code); else next.add(code);
                      setCodeFilter(next);
                    }}
                    title={ISSUE_DOCS[code] || code}
                    style={{
                      background: active ? "rgba(220,166,74,0.2)" : "rgba(255,255,255,0.04)",
                      color: active ? "#dca64a" : "#aaa",
                      border: `1px solid ${active ? "rgba(220,166,74,0.5)" : "rgba(255,255,255,0.1)"}`,
                      padding: "2px 8px", borderRadius: 12, fontSize: 10, fontWeight: 600,
                      fontFamily: "Consolas, monospace", cursor: "pointer", letterSpacing: 0.3,
                    }}
                  >{code} <span style={{ opacity: 0.7 }}>· {count}</span></button>
                );
              })}
            </div>
          )}
        </div>
      )}

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

      {(() => {
        // Bulk-action bar — only meaningful when the visible groups all
        // belong to one actionable code. We support two flavours today:
        //   • dmb-orphan-asset → delete files from disk
        //   • dmb-orphan-type → strip 'type X' blocks from DMB
        // Need codeFilter to be exactly one of those (otherwise mixing
        // selections would be ambiguous about what action to run).
        const actionableCodes = new Set(["dmb-orphan-asset", "dmb-texture-orphan-asset", "dmb-model-orphan-asset", "dms-model-orphan-asset", "dmb-animal-orphan-asset", "projectile-model-orphan-asset", "engine-model-orphan-asset", "dmb-orphan-type"]);
        const onlyCode = codeFilter.size === 1 ? [...codeFilter][0] : null;
        if (!onlyCode || !actionableCodes.has(onlyCode)) return null;
        const visibleIds = [...groups.keys()];
        const allSelected = visibleIds.length > 0 && visibleIds.every(id => selectedUnitIds.has(id));
        const selectionCount = visibleIds.filter(id => selectedUnitIds.has(id)).length;
        // All asset-orphan codes share the delete-from-disk action;
        // type-orphan uses the DMB strip-block path. assetCodes covers
        // every orphan-asset variant we know about.
        const assetCodes = new Set(["dmb-orphan-asset", "dmb-texture-orphan-asset", "dmb-model-orphan-asset", "dms-model-orphan-asset", "dmb-animal-orphan-asset", "projectile-model-orphan-asset", "engine-model-orphan-asset"]);
        const isAssetCode = assetCodes.has(onlyCode);
        const labelFor = isAssetCode
          ? `Delete ${selectionCount} orphan file${selectionCount === 1 ? "" : "s"} from disk`
          : `Strip ${selectionCount} 'type X' block${selectionCount === 1 ? "" : "s"} from DMB`;
        const runBulk = async () => {
          const api = window.eduAPI;
          if (!api) return;
          const selectedGroups = [...groups.entries()].filter(([id]) => selectedUnitIds.has(id));
          if (selectedGroups.length === 0) return;
          if (isAssetCode) {
            const paths = selectedGroups.map(([, items]) => items[0] && (items[0].unit || "").replace(/^\[asset orphan\]\s+/, "")).filter(Boolean);
            if (!window.confirm(
              `Permanently delete ${paths.length} file${paths.length === 1 ? "" : "s"} from the mod data folder?\n\n` +
              `${paths.slice(0, 8).map(p => "  • " + p).join("\n")}${paths.length > 8 ? `\n  …and ${paths.length - 8} more` : ""}\n\n` +
              `NOT recoverable. Files are unlinked, not moved to a recycle bin.`
            )) return;
            setBulkBusy(true);
            try {
              const r = await api.deleteModFiles(paths);
              alert(`Deleted ${r.deleted} file${r.deleted === 1 ? "" : "s"}.${r.failed && r.failed.length ? `\n\n${r.failed.length} failed:\n${r.failed.slice(0, 8).map(f => "  • " + f.path + " — " + f.error).join("\n")}` : ""}\n\nReload mod files (topbar Reload) to refresh the validation list.`);
              setSelectedUnitIds(new Set());
            } finally { setBulkBusy(false); }
          } else if (onlyCode === "dmb-orphan-type") {
            const types = selectedGroups.map(([, items]) => items[0] && (items[0].unit || "").replace(/^\[DMB\]\s+/, "")).filter(Boolean);
            if (!window.confirm(
              `Strip ${types.length} 'type X' block${types.length === 1 ? "" : "s"} from descr_model_battle.txt?\n\n` +
              `${types.slice(0, 8).map(t => "  • type " + t).join("\n")}${types.length > 8 ? `\n  …and ${types.length - 8} more` : ""}\n\n` +
              `Each block runs from its 'type' line until the next one (or EOF). A timestamped backup of DMB is written first.`
            )) return;
            setBulkBusy(true);
            try {
              const r = await api.stripDmbTypes(types);
              if (!r.ok) { alert("Strip failed: " + (r.reason || "unknown")); return; }
              alert(`Stripped ${r.stripped} block${r.stripped === 1 ? "" : "s"} from DMB.\n\nBackup: ${r.backup}\n\nReload mod files (topbar Reload) to refresh the validation list.`);
              setSelectedUnitIds(new Set());
            } finally { setBulkBusy(false); }
          }
        };
        return (
          <div style={{ marginBottom: 12, padding: "8px 12px", background: "rgba(232,136,136,0.06)", border: "1px solid rgba(232,136,136,0.25)", borderRadius: 6, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer", fontSize: 12, color: "#ccc" }}>
              <input
                type="checkbox"
                checked={allSelected}
                onChange={() => {
                  if (allSelected) setSelectedUnitIds(new Set());
                  else setSelectedUnitIds(new Set(visibleIds));
                }}
              />
              {allSelected ? "Deselect all" : `Select all ${visibleIds.length} visible`}
            </label>
            <span style={{ color: "#888", fontSize: 11 }}>· {selectionCount} selected</span>
            <button
              disabled={bulkBusy || selectionCount === 0}
              onClick={runBulk}
              style={{ marginLeft: "auto", background: selectionCount > 0 ? "rgba(232,136,136,0.18)" : "rgba(255,255,255,0.04)", color: selectionCount > 0 ? "#e88" : "#666", border: "1px solid " + (selectionCount > 0 ? "rgba(232,136,136,0.5)" : "#333"), padding: "5px 14px", borderRadius: 4, fontSize: 12, fontWeight: 600, cursor: selectionCount > 0 ? "pointer" : "not-allowed" }}
            >{bulkBusy ? "Working…" : labelFor}</button>
          </div>
        );
      })()}
      {[...groups].map(([unitId, issuesForUnit]) => renderGroup(unitId, issuesForUnit, units, modIndex, onJump, selectedUnitIds, setSelectedUnitIds, codeFilter))}
    </div>
  );
}

// Render a single (unitId, issues[]) group row. Groups map 1:1 to a
// project unit when the issue's unitId is a real unit id; cross-file
// issues use synthetic ids (edu:[DMB] X, orphan:X, [asset orphan] X)
// that don't resolve. The synthetic case is rendered without the
// Jump-to-editor button so the rows stay visible.
//
// When the codeFilter is one of the bulk-actionable codes
// (dmb-orphan-asset / dmb-orphan-type) a checkbox is rendered so the
// user can select rows for the bulk-action bar above.
function renderGroup(unitId, issuesForUnit, units, modIndex, onJump, selectedUnitIds, setSelectedUnitIds, codeFilter) {
  const u = units.find(x => x.id === unitId);
  const display = u && modIndex.unitDisplayName ? modIndex.unitDisplayName(u.unit) : null;
  const heading = u
    ? (display || u.unit)
    : (issuesForUnit[0] && issuesForUnit[0].unit) || unitId;
  const actionableCodes = new Set(["dmb-orphan-asset", "dmb-texture-orphan-asset", "dmb-model-orphan-asset", "dms-model-orphan-asset", "dmb-animal-orphan-asset", "projectile-model-orphan-asset", "engine-model-orphan-asset", "dmb-orphan-type"]);
  const showCheckbox = codeFilter && codeFilter.size === 1 && actionableCodes.has([...codeFilter][0]);
  const isSelected = selectedUnitIds && selectedUnitIds.has(unitId);
  return (
    <div key={unitId} style={{ marginBottom: 14, background: isSelected ? "rgba(232,136,136,0.08)" : "rgba(28,30,32,0.4)", border: `1px solid ${isSelected ? "rgba(232,136,136,0.4)" : "rgba(255,255,255,0.06)"}`, borderRadius: 8, padding: "10px 12px" }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 8 }}>
        {showCheckbox && setSelectedUnitIds && (
          <input
            type="checkbox"
            checked={!!isSelected}
            onChange={() => {
              const next = new Set(selectedUnitIds);
              if (next.has(unitId)) next.delete(unitId); else next.add(unitId);
              setSelectedUnitIds(next);
            }}
            style={{ marginRight: 4 }}
          />
        )}
        {u && (
          <button
            onClick={() => onJump && onJump(unitId)}
            style={{ background: "rgba(220,166,74,0.18)", border: "1px solid rgba(220,166,74,0.3)", color: "#dca64a", padding: "3px 8px", borderRadius: 4, fontSize: 12, fontWeight: 600 }}
          >Jump →</button>
        )}
        <span style={{ fontWeight: 600 }}>{heading}</span>
        {u && display && <span style={{ color: "#666", fontSize: 11 }}>({u.unit})</span>}
        {u && <span style={{ color: "#888", fontSize: 11 }}>· {u.unitType || "faction"} · t{u.canonicalMicTier ?? u.minTier ?? "?"}</span>}
        {!u && <span style={{ color: "#888", fontSize: 11 }}>· cross-file</span>}
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
