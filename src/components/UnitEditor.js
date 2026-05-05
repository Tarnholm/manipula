import React, { useMemo } from "react";
import Picker from "./Picker";
import UnitStats from "./UnitStats";
import EDBOccurrences from "./EDBOccurrences";
import FactionIcon from "./FactionIcon";
import RegionMap from "./RegionMap";
import { renderUnitPreview, generatePlayerLines, generateAORPlayerLines, generateAILines } from "../generator";
import { GRADE_DEFAULTS, GRADES } from "../grades";
import { QUALITY_CLASSES, findQualityClass } from "../qualityClasses";

// Unit family editor — grade-driven authoring.
// Layout: Identity → Grade → Player section → AOR sibling → AI section → Common requires → Stats + Preview.
export default function UnitEditor({ unit, onChange, modIndex, allUnits, onFilterFaction, onSelectUnit, eduProject, onJumpToEdu, onCreateEduStub }) {
  const opts = useMemo(() => buildOptions(modIndex), [modIndex]);

  // Live emit-count: how many EDB recruit lines this unit will produce given current toggles.
  // MUST be declared before the early return so the hook order stays stable across renders.
  const emitCounts = useMemo(() => {
    if (!unit) return { player: 0, aor: 0, ai: 0, total: 0 };
    try {
      const player = generatePlayerLines(unit).length;
      const aor = generateAORPlayerLines(unit).length;
      const ai = generateAILines(unit).length;
      return { player, aor, ai, total: player + aor + ai };
    } catch { return { player: 0, aor: 0, ai: 0, total: 0 }; }
  }, [unit]);

  // Variant tabs — when multiple authored entries share the active
  // unit's name, expose each as a sub-tab so the user can switch
  // between Factional / Factional+AoR / AOR variants without
  // hunting them down in the sidebar. The sidebar collapses
  // same-name cards into one; this is where the user picks which
  // variant of that one card they actually want to edit.
  const siblings = useMemo(() => {
    if (!unit || !Array.isArray(allUnits)) return [];
    return allUnits.filter(u => u.unit === unit.unit);
  }, [unit, allUnits]);

  if (!unit) {
    return <div style={{ padding: 30, color: "#777", textAlign: "center" }}>Select a unit to edit, or click ＋ New unit.</div>;
  }

  const u = unit;
  const set = (patch) => onChange({ ...u, ...patch });

  // Apply grade defaults to a unit, but only the fields the user hasn't explicitly overridden.
  const applyGrade = (newGrade) => {
    const def = GRADE_DEFAULTS[newGrade] || GRADE_DEFAULTS.Standard;
    onChange({
      ...u,
      grade: newGrade,
      canonicalMicTier: def.canonicalMicTier,
      homelandMicTier: def.homelandMicTier,
      colonyTier: def.colonyTier,
      emitGovB: def.emitGovB,
      emitGovC: def.emitGovC,
      emitGovD: def.emitGovD,
    });
  };

  const ex = parseExtras(u.outsideExtras || []);
  const updateOutsideExtras = (kind, list) => {
    const merged = serializeExtras({ ...ex, [kind]: list });
    set({ outsideExtras: merged });
  };

  const cr = parseExtras(u.commonRequires || []);
  const updateCommonRequires = (kind, list) => {
    const merged = serializeExtras({ ...cr, [kind]: list });
    set({ commonRequires: merged });
  };

  const ar = parseExtras(u.aorRequires || []);
  const updateAorRequires = (kind, list) => {
    const merged = serializeExtras({ ...ar, [kind]: list });
    set({ aorRequires: merged });
  };

  return (
    <div style={{ padding: 16 }}>
      {siblings.length > 1 && (
        <div style={{ marginBottom: 10, display: "flex", gap: 4, flexWrap: "wrap", alignItems: "center", padding: "6px 8px", background: "rgba(20,22,23,0.7)", border: "1px solid rgba(220,166,74,0.18)", borderRadius: 6 }}>
          <span style={{ fontSize: 10, color: "#888", textTransform: "uppercase", letterSpacing: 0.6, marginRight: 6 }}>Variant:</span>
          {siblings.map((s, i) => {
            const active = s.id === u.id;
            const isAor = s.aor && s.aor.enabled;
            const facList = (s.factions || []).filter(f => f && f !== "all");
            const facLabel = isAor
              ? "AOR"
              : (facList.length === 0 ? "all factions" : (facList.slice(0, 2).join(", ") + (facList.length > 2 ? ` +${facList.length - 2}` : "")));
            const tabKind = isAor ? "AOR" : `Faction code ${i + 1}`;
            return (
              <button
                key={s.id}
                onClick={() => { if (!active && onSelectUnit) onSelectUnit(s.id); }}
                title={`${tabKind} — ${facLabel}\nGrade: ${s.grade || "?"} · t${s.canonicalMicTier ?? s.minTier ?? "?"}\n${s.writeBack === false ? "REF ONLY" : "WRITE"}`}
                style={{
                  background: active ? "rgba(220,166,74,0.22)" : "rgba(255,255,255,0.04)",
                  color: active ? "#dca64a" : "#aaa",
                  border: active ? "1px solid #dca64a" : "1px solid #333",
                  padding: "4px 10px",
                  borderRadius: 4,
                  fontSize: 11,
                  fontWeight: active ? 700 : 500,
                  cursor: "pointer",
                  display: "inline-flex", alignItems: "center", gap: 6,
                }}
              >
                <span>{tabKind}</span>
                <span style={{ color: "#888", fontWeight: 400, fontSize: 10, fontFamily: "Consolas, monospace" }}>{facLabel}</span>
                {s.writeBack === false && (
                  <span style={{ color: "#888", fontSize: 9, fontWeight: 700, padding: "0 3px", border: "1px solid #444", borderRadius: 2 }}>REF</span>
                )}
              </button>
            );
          })}
        </div>
      )}
      <div style={{ marginBottom: 10, padding: "6px 10px", background: "rgba(220,166,74,0.06)", border: "1px solid rgba(220,166,74,0.18)", borderRadius: 6, fontSize: 11.5, color: "#bca", display: "flex", gap: 14, alignItems: "center" }}>
        <span>Will emit <strong style={{ color: emitCounts.total > 0 ? "#dca64a" : "#a77" }}>{emitCounts.total}</strong> EDB lines</span>
        <span style={{ color: "#888" }}>player: {emitCounts.player}</span>
        {emitCounts.aor > 0 && <span style={{ color: "#888" }}>AOR: {emitCounts.aor}</span>}
        <span style={{ color: "#888" }}>AI: {emitCounts.ai}</span>
        {/* Cross-link to EDU Builder when the loaded EDU project has a row for this unit. */}
        {eduProject && (eduProject.units || []).some(eu => (eu.Unit || eu.unit || eu.Type || eu.type) === u.unit) && onJumpToEdu && (
          <button
            onClick={onJumpToEdu}
            title="Jump to this unit's stats row in the EDU Builder"
            style={{ marginLeft: "auto", background: "rgba(220,166,74,0.18)", border: "1px solid rgba(220,166,74,0.35)", color: "#dca64a", padding: "3px 10px", borderRadius: 4, fontSize: 11, fontWeight: 600, cursor: "pointer" }}
          >View EDU stats →</button>
        )}
        {/* Auto-create the EDU stub when there's no matching row yet, so authoring on one
            side automatically scaffolds the other. */}
        {eduProject && onCreateEduStub && !(eduProject.units || []).some(eu => (eu.Unit || eu.unit || eu.Type || eu.type) === u.unit) && (
          <button
            onClick={() => onCreateEduStub(u)}
            title="Append a stub row to the loaded EDU project for this unit name"
            style={{ marginLeft: "auto", background: "rgba(124,201,153,0.10)", border: "1px solid rgba(124,201,153,0.35)", color: "#7c9", padding: "3px 10px", borderRadius: 4, fontSize: 11, fontWeight: 600, cursor: "pointer" }}
          >+ Create EDU stub</button>
        )}
      </div>
      {/* IDENTITY */}
      <Section title="Unit identity">
        <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
          <input
            type="text"
            value={u.unit}
            onChange={(e) => set({ unit: e.target.value })}
            placeholder='Unit recruit name (e.g. "cappadocian noble cavalry")'
            style={input(320, true)}
          />
          {modIndex.unitDisplayName && modIndex.unitDisplayName(u.unit) && (
            <span style={{ color: "#7a9", fontSize: 12 }}>→ {modIndex.unitDisplayName(u.unit)}</span>
          )}
          <label style={{ color: "#aaa", fontSize: 12, marginLeft: "auto" }}>
            <input type="checkbox" checked={u.enabled !== false} onChange={(e) => set({ enabled: e.target.checked })} />
            {" "}Enabled
          </label>
          <label style={{ color: u.writeBack !== false ? "#dca64a" : "#888", fontSize: 12 }} title="When off, this unit is reference-only — Write to EDB will not touch any of its lines.">
            <input
              type="checkbox"
              checked={u.writeBack !== false}
              onChange={(e) => set({ writeBack: e.target.checked, writeBackUserSet: true })}
            />
            {" "}Write to EDB
          </label>
        </div>
        {u.writeBack === false && (
          <div style={{ marginTop: 8, padding: "6px 10px", background: "rgba(255,255,255,0.04)", borderRadius: 6, fontSize: 11.5, color: "#888" }}>
            Reference-only unit (imported). The "Write to EDB" action ignores it — its existing EDB
            lines are left alone. Tick the "Write to EDB" toggle above to take ownership and have
            this tool manage its lines.
          </div>
        )}
      </Section>

      {/* GRADE + QUALITY CLASS */}
      <Section title="Grade & Quality Class">
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <Field label="Grade (Class column in EDUMatic)">
            <select value={u.grade || "Standard"} onChange={(e) => applyGrade(e.target.value)} style={input("100%")}>
              {GRADES.map(g => <option key={g} value={g}>{g}</option>)}
            </select>
          </Field>
          <Field label="Quality Class (EDUMatic detail)">
            <select
              value={u.qualityClass || ""}
              onChange={(e) => {
                const v = e.target.value;
                const q = findQualityClass(v);
                // If the user picks a Quality Class, suggest tier from its hint — but only update tier if the
                // user hasn't already overridden (we apply naively here; they can re-edit if needed).
                if (q) {
                  set({ qualityClass: v, canonicalMicTier: q.tierHint, homelandMicTier: q.tierHint });
                } else {
                  set({ qualityClass: v });
                }
              }}
              style={input("100%")}
            >
              <option value="">— none —</option>
              {QUALITY_CLASSES.map(q => <option key={q.id} value={q.id}>{q.id}</option>)}
            </select>
          </Field>
        </div>
        <GradeChips current={u.grade || "Standard"} qualityClass={u.qualityClass} />
        <div style={{ fontSize: 11, color: "#999", marginTop: 4 }}>
          Picking a grade fills in defaults; picking a Quality Class also suggests the tier hint. Both are overridable.
        </div>
      </Section>

      {/* PLAYER RECRUITMENT */}
      <Section title="Player recruitment">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12 }}>
          <Field label="Canonical mic_tier (GovC/GovB)">
            <select value={u.canonicalMicTier} onChange={(e) => set({ canonicalMicTier: parseInt(e.target.value, 10) })} style={input(80)}>
              {[1, 2, 3, 4].map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </Field>
          <Field label="Homeland mic_tier (GovD)">
            <select value={u.homelandMicTier} onChange={(e) => set({ homelandMicTier: parseInt(e.target.value, 10) })} style={input(80)}>
              {[1, 2, 3, 4].map(t => <option key={t} value={t}>{t}</option>)}
            </select>
            {u.canonicalMicTier !== u.homelandMicTier && (
              <span style={{ fontSize: 10, color: "#dca64a" }}>
                {u.homelandMicTier < u.canonicalMicTier ? `−${u.canonicalMicTier - u.homelandMicTier} discount` : "homeland is stricter"}
              </span>
            )}
          </Field>
          <Field label="Colony tier (outside homeland)">
            <select value={u.colonyTier ?? 0} onChange={(e) => set({ colonyTier: parseInt(e.target.value, 10) })} style={input(120)}>
              <option value={0}>none</option>
              <option value={1}>colony_tier_1</option>
              <option value={2}>colony_tier_2</option>
            </select>
          </Field>
        </div>

        <div style={{ display: "flex", gap: 16, marginTop: 12 }}>
          <Toggle label="GovB (Indirect Rule)" checked={u.emitGovB} onChange={(v) => set({ emitGovB: v })} />
          <Toggle label="GovC (Direct Rule)" checked={u.emitGovC} onChange={(v) => set({ emitGovC: v })} />
          <Toggle label="GovD (Homeland)" checked={u.emitGovD} onChange={(v) => set({ emitGovD: v })} />
        </div>

        <div style={{ marginTop: 14, padding: 10, background: "rgba(220,166,74,0.04)", border: "1px dashed rgba(220,166,74,0.2)", borderRadius: 6 }}>
          <Label>Outside-homeland-only extras (added to GovB/GovC, NOT GovD)</Label>
          <Picker
            label=""
            options={opts.hiddenResources}
            value={ex.hidden_resource || []}
            onChange={(v) => updateOutsideExtras("hidden_resource", v)}
            placeholder="add hidden_resource (e.g. horse_supply)"
          />
          <Picker
            label="Excluded hidden_resources (emits not hidden_resource X — gates regions OUT)"
            options={opts.hiddenResources}
            value={ex.not_hidden_resource || []}
            onChange={(v) => updateOutsideExtras("not_hidden_resource", v)}
            placeholder="add not hidden_resource (e.g. island_settlement)"
          />
          <Picker
            label=""
            options={opts.aliases}
            value={ex.alias || []}
            onChange={(v) => updateOutsideExtras("alias", v)}
            placeholder="add alias"
          />
          <Field label="Custom extras (one per line — verbatim)">
            <textarea
              value={(ex.raw || []).join("\n")}
              onChange={(e) => updateOutsideExtras("raw", e.target.value.split("\n").map(s => s.trim()).filter(Boolean))}
              rows={2}
              style={{ ...input("100%"), fontFamily: "Consolas, monospace", fontSize: 12 }}
              placeholder='e.g. building_present_min_level port_buildings port'
            />
          </Field>
        </div>
      </Section>

      {/* AOR SIBLING */}
      <Section title={`AOR sibling${u.aor && u.aor.enabled ? " — enabled" : ""}`}>
        {/^merc\s+/i.test(u.unit || "") && (
          <div style={{ marginBottom: 8, padding: "6px 10px", background: "rgba(232,136,136,0.08)", border: "1px solid rgba(232,136,136,0.2)", borderRadius: 6, fontSize: 11.5, color: "#caa" }}>
            Mercenary unit — AOR sibling pairing is disabled. Mercs are recruited via descr_mercenaries.txt
            (outside this tool's scope) and don't have AOR variants in EDB.
          </div>
        )}
        <div style={{ display: "flex", gap: 12, alignItems: "center", opacity: /^merc\s+/i.test(u.unit || "") ? 0.5 : 1 }}>
          <Toggle
            label="Pair with an AOR variant"
            checked={!!(u.aor && u.aor.enabled)}
            onChange={(v) => {
              if (/^merc\s+/i.test(u.unit || "")) return;
              set({ aor: v ? { enabled: true, govTier: 1, aorOnly: false, recruitName: null } : null });
            }}
          />
          {u.aor && u.aor.enabled && (
            <>
              <Toggle
                label="AOR-only (no faction sibling)"
                checked={!!u.aor.aorOnly}
                onChange={(v) => set({ aor: { ...u.aor, aorOnly: v, recruitName: v ? (u.aor.recruitName || `aor ${u.unit}`) : null } })}
              />
            </>
          )}
        </div>
        {u.aor && u.aor.enabled && (
          <div style={{ marginTop: 10, padding: 10, background: "rgba(255,255,255,0.03)", borderRadius: 6 }}>
            <div style={{ display: "flex", gap: 12, alignItems: "baseline", flexWrap: "wrap" }}>
              <Field label="AOR recruit name (auto)">
                <input
                  type="text"
                  value={`aor ${String(u.unit || "").replace(/^aor\s+/i, "")}`}
                  readOnly
                  title="Auto-derived from the unit name. Strips any existing 'aor ' prefix and re-adds it."
                  style={{ ...input(280), background: "#1a1a1a", color: "#aaa" }}
                />
              </Field>
              <Field label="gov_tier">
                <select value={u.aor.govTier || 1} onChange={(e) => set({ aor: { ...u.aor, govTier: parseInt(e.target.value, 10) } })} style={input(70)}>
                  {[1, 2, 3, 4].map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </Field>
              {!u.aor.aorOnly && (
                <span style={{ color: "#7a9", fontSize: 11 }}>
                  Exclusion list auto-derived from faction sibling: <code style={{ color: "#dca64a" }}>not factions {`{`} {(u.factions || ["all"]).join(", ")} {`}`}</code>
                </span>
              )}
            </div>
          </div>
        )}
      </Section>

      {/* AI RECRUITMENT */}
      <Section title="AI recruitment">
        <div style={{ display: "flex", gap: 18, alignItems: "baseline", flexWrap: "wrap" }}>
          <Toggle
            label='AI homeland gate (adds "and homeland")'
            checked={!!u.aiHomeland}
            onChange={(v) => set({ aiHomeland: v })}
          />
          <div style={{ display: "flex", gap: 6, alignItems: "baseline" }}>
            <Toggle
              label="Bonus XP at higher tiers"
              checked={!!u.xp}
              onChange={(v) => set({ xp: v ? { startTier: 4, value: 1 } : null })}
            />
            {u.xp && (
              <>
                <span style={{ color: "#aaa", fontSize: 12 }}>+</span>
                <input type="number" min={1} max={9}
                  value={u.xp.value}
                  onChange={(e) => set({ xp: { ...u.xp, value: Math.max(1, parseInt(e.target.value || "1", 10)) } })}
                  style={input(60)} />
                <span style={{ color: "#aaa", fontSize: 12 }}>at tier ≥</span>
                <select value={u.xp.startTier} onChange={(e) => set({ xp: { ...u.xp, startTier: parseInt(e.target.value, 10) } })} style={input(70)}>
                  {[1, 2, 3, 4].map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </>
            )}
          </div>
        </div>
      </Section>

      {/* FACTIONS */}
      <Section title="Factions">
        <Picker
          label="Faction list (positive)"
          options={opts.factions}
          value={u.factions || []}
          onChange={(v) => set({ factions: v })}
          placeholder='Type to search factions, or add "all"'
          renderIcon={(o) => o.value === "all" ? null : (
            <FactionIcon iconPath={`faction_icons/${o.value}.tga`} alt={o.value} size={16} modIconsDir={modIndex.factionIconsDir} />
          )}
        />
        <Picker
          label='Exclude factions ("not factions { … }")'
          options={opts.factions}
          value={u.excludeFactions || []}
          onChange={(v) => set({ excludeFactions: v })}
          placeholder="rare — used for explicit exclusions"
          renderIcon={(o) => o.value === "all" ? null : (
            <FactionIcon iconPath={`faction_icons/${o.value}.tga`} alt={o.value} size={16} modIconsDir={modIndex.factionIconsDir} />
          )}
        />
      </Section>

      {/* AOR-SPECIFIC REQUIRES — only visible when an AOR sibling is enabled */}
      {u.aor && u.aor.enabled && (
        <Section title="AOR-only requires (apply only to the AOR sibling's lines)">
          <Picker
            label="Hidden resources"
            options={opts.hiddenResources}
            value={ar.hidden_resource || []}
            onChange={(v) => updateAorRequires("hidden_resource", v)}
            placeholder="add hidden_resource (only on AOR variant)"
          />
          {(ar.hidden_resource || []).length > 0 && modIndex.regionsByHR && (
            <div style={{ marginTop: -8, marginBottom: 12, padding: "6px 10px", background: "#1c1c1c", border: "1px solid #2a2a2a", borderRadius: 3, fontSize: 11.5, color: "#9b9" }}>
              {(ar.hidden_resource || []).map(hr => {
                const regs = (modIndex.regionsByHR[hr] || []);
                return (
                  <div key={hr} style={{ marginBottom: 4 }}>
                    <span style={{ color: "#bcb", fontFamily: "Consolas, monospace" }}>{hr}</span>
                    <span style={{ color: "#666" }}> — </span>
                    {regs.length === 0
                      ? <span style={{ color: "#a77" }}>not present in any region</span>
                      : <span>{regs.length} region{regs.length === 1 ? "" : "s"}: {regs.slice(0, 6).map(r => r.region).join(", ")}{regs.length > 6 ? `, +${regs.length - 6} more` : ""}</span>
                    }
                  </div>
                );
              })}
            </div>
          )}
          <Picker
            label="Excluded hidden_resources (emits not hidden_resource X — prevents AOR overlap with faction sibling regions)"
            options={opts.hiddenResources}
            value={ar.not_hidden_resource || []}
            onChange={(v) => updateAorRequires("not_hidden_resource", v)}
            placeholder="add not hidden_resource (e.g. iberia)"
          />
          <Picker
            label="Reforms required (major_event)"
            options={opts.reforms}
            value={ar.major_event || []}
            onChange={(v) => updateAorRequires("major_event", v)}
          />
          <Picker
            label="Aliases"
            options={opts.aliases}
            value={ar.alias || []}
            onChange={(v) => updateAorRequires("alias", v)}
          />
          <Field label="Custom requires (one per line — verbatim)">
            <textarea
              value={(ar.raw || []).join("\n")}
              onChange={(e) => updateAorRequires("raw", e.target.value.split("\n").map(s => s.trim()).filter(Boolean))}
              rows={2}
              style={{ ...input("100%"), fontFamily: "Consolas, monospace", fontSize: 12 }}
              placeholder='e.g. not hidden_resource island_settlement'
            />
          </Field>
        </Section>
      )}

      {/* COMMON REQUIRES */}
      <Section title="Common requires (apply to every emitted line)">
        <Picker
          label="Hidden resources"
          options={opts.hiddenResources}
          value={cr.hidden_resource || []}
          onChange={(v) => updateCommonRequires("hidden_resource", v)}
          placeholder="add hidden_resource (e.g. aestian)"
        />
        {(cr.hidden_resource || []).length > 0 && modIndex.regionsByHR && (
          <div style={{ marginTop: -8, marginBottom: 12, padding: "6px 10px", background: "#1c1c1c", border: "1px solid #2a2a2a", borderRadius: 3, fontSize: 11.5, color: "#9b9" }}>
            {(cr.hidden_resource || []).map(hr => {
              const regs = (modIndex.regionsByHR[hr] || []);
              return (
                <div key={hr} style={{ marginBottom: 4 }}>
                  <span style={{ color: "#bcb", fontFamily: "Consolas, monospace" }}>{hr}</span>
                  <span style={{ color: "#666" }}> — </span>
                  {regs.length === 0
                    ? <span style={{ color: "#a77" }}>not present in any region</span>
                    : <span>{regs.length} region{regs.length === 1 ? "" : "s"}: {regs.slice(0, 6).map(r => r.region).join(", ")}{regs.length > 6 ? `, +${regs.length - 6} more` : ""}</span>
                  }
                </div>
              );
            })}
          </div>
        )}
        <Picker
          label="Excluded hidden_resources (emits not hidden_resource X — gates regions OUT)"
          options={opts.hiddenResources}
          value={cr.not_hidden_resource || []}
          onChange={(v) => updateCommonRequires("not_hidden_resource", v)}
          placeholder="add not hidden_resource (e.g. island_settlement)"
        />
        <Picker
          label="Reforms required (major_event)"
          options={opts.reforms}
          value={cr.major_event || []}
          onChange={(v) => updateCommonRequires("major_event", v)}
        />
        <Picker
          label="Aliases"
          options={opts.aliases}
          value={cr.alias || []}
          onChange={(v) => updateCommonRequires("alias", v)}
          placeholder="e.g. land_recruitment"
        />
        <Field label="Custom requires (one per line — verbatim)">
          <textarea
            value={(cr.raw || []).join("\n")}
            onChange={(e) => updateCommonRequires("raw", e.target.value.split("\n").map(s => s.trim()).filter(Boolean))}
            rows={2}
            style={{ ...input("100%"), fontFamily: "Consolas, monospace", fontSize: 12 }}
            placeholder='e.g. not hidden_resource island_settlement'
          />
        </Field>
      </Section>

      {/* RECRUITABLE REGIONS MAP */}
      <RegionMap
        unit={u}
        modIndex={modIndex}
        allUnits={allUnits}
        onAddRequire={(bucket, kind, value) => {
          const cur = u[bucket] || [];
          const clause = kind === "not_hidden_resource" ? `not hidden_resource ${value}` : `hidden_resource ${value}`;
          if (cur.includes(clause)) return;
          set({ [bucket]: [...cur, clause] });
        }}
        onFilterFaction={onFilterFaction}
        onUnitClick={onSelectUnit}
      />

      {/* NOTES */}
      <Section title="Notes (not emitted)">
        <textarea
          value={u.notes || ""}
          onChange={(e) => set({ notes: e.target.value })}
          rows={2}
          style={{ ...input("100%"), fontStyle: "italic" }}
        />
      </Section>

      {/* CURRENT IN EDB — read-only existing recruit lines for this unit */}
      <EDBOccurrences recruitName={u.unit} modIndex={modIndex} />

      {/* STATS */}
      <UnitStats recruitName={u.unit} modIndex={modIndex} />

      {/* PREVIEW */}
      <div style={{ marginTop: 14, padding: 12, background: "rgba(15,17,18,0.7)", border: "1px solid rgba(220,166,74,0.18)", borderRadius: 12, backdropFilter: "blur(6px)", WebkitBackdropFilter: "blur(6px)" }}>
        <Label>Preview</Label>
        <pre style={{ whiteSpace: "pre-wrap", fontFamily: "Consolas, monospace", fontSize: 11.5, color: "#bbb", margin: 0 }}>
{renderUnitPreview(u)}
        </pre>
      </div>
    </div>
  );
}

function GradeChips({ current, qualityClass }) {
  const def = GRADE_DEFAULTS[current] || GRADE_DEFAULTS.Standard;
  const q = findQualityClass(qualityClass);
  return (
    <div style={{ display: "flex", gap: 6, marginTop: 6, fontSize: 11, color: "#999", flexWrap: "wrap" }}>
      <Chip>canonical mic_tier {def.canonicalMicTier}</Chip>
      <Chip>homeland mic_tier {def.homelandMicTier}</Chip>
      <Chip>colony tier {def.colonyTier || "none"}</Chip>
      <Chip>{def.emitGovB && def.emitGovC && def.emitGovD ? "GovB+C+D" : (def.emitGovC && def.emitGovD ? "GovC+D only" : "custom")}</Chip>
      {q && <Chip>{q.role} · QC tier hint {q.tierHint}</Chip>}
    </div>
  );
}
const Chip = ({ children }) => <span style={{ padding: "2px 8px", background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 10 }}>{children}</span>;

function Section({ title, children }) {
  // Per-section collapse state, keyed by title and persisted across launches. Lets the
  // user hide sections they don't actively edit (e.g. always-collapsed AI section if
  // they never touch AI tuning).
  const storageKey = `rt:section:${String(title || "").replace(/\s+/g, "_").toLowerCase()}`;
  const [collapsed, setCollapsed] = React.useState(() => {
    try { return localStorage.getItem(storageKey) === "1"; } catch { return false; }
  });
  const toggle = () => {
    setCollapsed(c => {
      const next = !c;
      try { localStorage.setItem(storageKey, next ? "1" : "0"); } catch {}
      return next;
    });
  };
  return (
    <div style={{ marginBottom: 18, padding: collapsed ? "8px 14px" : 14, background: "rgba(24,26,27,0.55)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 12, backdropFilter: "blur(6px)", WebkitBackdropFilter: "blur(6px)", boxShadow: "0 2px 12px rgba(0,0,0,0.2)" }}>
      <div onClick={toggle} style={{ fontSize: 11, color: "#dca64a", marginBottom: collapsed ? 0 : 10, textTransform: "uppercase", letterSpacing: 0.6, fontWeight: 700, cursor: "pointer", userSelect: "none", display: "flex", alignItems: "center", gap: 6 }}>
        <span style={{ display: "inline-block", width: 10, transition: "transform 0.15s", transform: collapsed ? "rotate(-90deg)" : "rotate(0deg)" }}>▾</span>
        <span>{title}</span>
      </div>
      {!collapsed && children}
    </div>
  );
}
function Field({ label, children }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <Label>{label}</Label>
      {children}
    </div>
  );
}
function Toggle({ label, checked, onChange }) {
  return (
    <label style={{ display: "inline-flex", alignItems: "center", gap: 6, cursor: "pointer", color: checked ? "#dca64a" : "#aaa", fontSize: 12, userSelect: "none" }}>
      <input type="checkbox" checked={!!checked} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}
const Label = ({ children }) => <div style={{ fontSize: 11, color: "#999", marginBottom: 4, textTransform: "uppercase", letterSpacing: 0.5 }}>{children}</div>;

function input(width, bold) {
  return {
    background: "#252525",
    border: "1px solid #333",
    color: "#ddd",
    padding: "5px 7px",
    borderRadius: 6,
    width: width || "auto",
    fontWeight: bold ? 600 : 400,
  };
}

// Parse a list of requires-strings ("hidden_resource X", "alias_name", "major_event \"Y\"", "raw ...")
// into structured kinds for the editor's pickers.
function parseExtras(reqs) {
  const ex = { hidden_resource: [], not_hidden_resource: [], resource: [], major_event: [], building_present: [], alias: [], raw: [] };
  for (const r of reqs || []) {
    const s = (r || "").trim();
    if (!s) continue;
    let m;
    if ((m = s.match(/^not\s+hidden_resource\s+(\S+)$/))) ex.not_hidden_resource.push(m[1]);
    else if ((m = s.match(/^hidden_resource\s+(\S+)$/))) ex.hidden_resource.push(m[1]);
    else if ((m = s.match(/^resource\s+(\S+)$/))) ex.resource.push(m[1]);
    else if ((m = s.match(/^major_event\s+"([^"]+)"$/))) ex.major_event.push(m[1]);
    else if ((m = s.match(/^building_present_min_level\s+(\S+)\s+(\S+)$/))) ex.building_present.push(`${m[1]}:${m[2]}`);
    else if (/^[a-z_][a-z0-9_]*$/.test(s)) ex.alias.push(s);
    else ex.raw.push(s);
  }
  return ex;
}

function serializeExtras(ex) {
  const out = [];
  for (const v of ex.hidden_resource || []) out.push(`hidden_resource ${v}`);
  for (const v of ex.not_hidden_resource || []) out.push(`not hidden_resource ${v}`);
  for (const v of ex.resource || []) out.push(`resource ${v}`);
  for (const v of ex.alias || []) out.push(v);
  for (const v of ex.building_present || []) {
    const [b, l] = v.split(":");
    out.push(`building_present_min_level ${b} ${l}`);
  }
  for (const v of ex.major_event || []) out.push(`major_event "${v}"`);
  for (const v of ex.raw || []) out.push(v);
  return out;
}

function buildOptions(modIndex) {
  const factions = (modIndex.factions || []).map(f => ({ value: f.id, label: f.id, hint: f.culture || "" }));
  factions.unshift({ value: "all", label: "all", hint: "every faction" });
  const resources = (modIndex.resources || []).map(r => ({ value: r.id, label: r.id }));
  const hiddenResources = (modIndex.hiddenResources || []).map(r => {
    const regCount = (modIndex.regionsByHR && modIndex.regionsByHR[r.id]) ? modIndex.regionsByHR[r.id].length : 0;
    return { value: r.id, label: r.id, hint: regCount ? `${regCount} regions` : "" };
  });
  const aliases = (modIndex.aliases || []).map(a => ({ value: a.name, label: a.name }));
  const reforms = (modIndex.reforms || []).map(r => ({ value: r.id, label: r.id, hint: r.hasUnitSwitches ? "has unit switches" : "" }));
  return { factions, resources, hiddenResources, aliases, reforms };
}
