import React, { useState } from "react";
import Picker from "./Picker";

// Bulk-edit pane shown when 2+ units are selected. Lets the user apply a single change to all of them
// without losing per-unit fields the user didn't touch.
//
// Operations: set min tier; toggle unit type; add/remove a hidden_resource; add/remove a faction
// (positive); add/remove an exclude faction; set XP; clear XP; toggle enabled.
export default function BulkEditor({ selectedUnits, onApply, modIndex, onClearSelection }) {
  const [op, setOp] = useState("set-min-tier");
  const [intVal, setIntVal] = useState(1);
  const [strVal, setStrVal] = useState("");
  const [strList, setStrList] = useState([]);
  const [boolVal, setBoolVal] = useState(true);
  const [xpStart, setXpStart] = useState(4);
  const [xpValue, setXpValue] = useState(1);

  const factionOpts = [{ value: "all", label: "all" }, ...(modIndex.factions || []).map(f => ({ value: f.id, label: f.id, hint: f.culture || "" }))];
  const hrOpts = (modIndex.hiddenResources || []).map(r => ({ value: r.id, label: r.id }));

  const apply = () => {
    const transform = makeTransformer(op, { intVal, strVal, strList, boolVal, xpStart, xpValue });
    onApply(transform);
  };

  return (
    <div style={{ padding: 20, height: "100%", overflow: "auto" }}>
      <div style={{ display: "flex", gap: 8, alignItems: "baseline", marginBottom: 14 }}>
        <span style={{ fontSize: 16, fontWeight: 700 }}>Bulk edit</span>
        <span style={{ color: "#999" }}>{selectedUnits.length} units selected</span>
        <button onClick={onClearSelection} style={{ marginLeft: "auto", background: "rgba(255,255,255,0.06)", color: "#bbb", border: "1px solid rgba(255,255,255,0.08)", padding: "4px 10px", borderRadius: 6, fontSize: 12 }}>Clear selection</button>
      </div>

      <div style={{ marginBottom: 14, padding: 12, background: "rgba(220,166,74,0.06)", border: "1px solid rgba(220,166,74,0.2)", borderRadius: 8, fontSize: 12, color: "#cba" }}>
        Pick an operation, then "Apply to selection" to update every selected unit at once.
        Per-unit fields you don't touch stay untouched.
      </div>

      <Label>Operation</Label>
      <select value={op} onChange={(e) => setOp(e.target.value)} style={input(360)}>
        <option value="set-min-tier">Set min tier</option>
        <option value="set-unit-type">Set unit type</option>
        <option value="set-enabled">Set enabled</option>
        <option value="set-writeback">Set "Write to EDB"</option>
        <option value="add-hidden-resource">Add hidden_resource requirement</option>
        <option value="remove-hidden-resource">Remove hidden_resource requirement</option>
        <option value="add-faction">Add faction (positive)</option>
        <option value="remove-faction">Remove faction</option>
        <option value="add-exclude-faction">Add excluded faction</option>
        <option value="remove-exclude-faction">Remove excluded faction</option>
        <option value="set-xp">Set bonus XP rule</option>
        <option value="clear-xp">Clear bonus XP rule</option>
        <option value="tier-gap-xp">Tier-gap XP filler (preset: +1 starting at canonical+1)</option>
        <option value="add-raw">Append raw requires line</option>
      </select>

      <div style={{ marginTop: 14 }}>
        {op === "set-min-tier" && (
          <Field label="Min tier (1–4)">
            <select value={intVal} onChange={(e) => setIntVal(parseInt(e.target.value, 10))} style={input(80)}>
              {[1, 2, 3, 4].map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </Field>
        )}
        {op === "set-unit-type" && (
          <Field label="Unit type">
            <select value={strVal} onChange={(e) => setStrVal(e.target.value)} style={input(220)}>
              <option value="">—</option>
              <option value="faction">faction (govB/C/D)</option>
              <option value="aor">AOR (hinterland_region)</option>
            </select>
          </Field>
        )}
        {op === "set-enabled" && (
          <Field label="Enabled">
            <input type="checkbox" checked={boolVal} onChange={(e) => setBoolVal(e.target.checked)} />
          </Field>
        )}
        {op === "set-writeback" && (
          <Field label='Write to EDB (off = reference-only, no EDB touch)'>
            <input type="checkbox" checked={boolVal} onChange={(e) => setBoolVal(e.target.checked)} />
          </Field>
        )}
        {(op === "add-hidden-resource" || op === "remove-hidden-resource") && (
          <Picker label="Hidden resources" options={hrOpts} value={strList} onChange={setStrList} />
        )}
        {(op === "add-faction" || op === "remove-faction" || op === "add-exclude-faction" || op === "remove-exclude-faction") && (
          <Picker label="Factions" options={factionOpts} value={strList} onChange={setStrList} />
        )}
        {op === "set-xp" && (
          <div style={{ display: "flex", gap: 8, alignItems: "baseline" }}>
            <Field label="XP value">
              <input type="number" min={1} max={9} value={xpValue} onChange={(e) => setXpValue(parseInt(e.target.value || "1", 10))} style={input(60)} />
            </Field>
            <Field label="Starting at tier">
              <select value={xpStart} onChange={(e) => setXpStart(parseInt(e.target.value, 10))} style={input(70)}>
                {[1, 2, 3, 4].map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </Field>
          </div>
        )}
        {op === "add-raw" && (
          <Field label='Custom requires line (e.g. "not hidden_resource island_settlement")'>
            <input type="text" value={strVal} onChange={(e) => setStrVal(e.target.value)} style={input("100%")} placeholder='Verbatim clause' />
          </Field>
        )}
        {op === "tier-gap-xp" && (
          <div style={{ marginTop: 8, padding: 10, background: "rgba(220,166,74,0.06)", border: "1px solid rgba(220,166,74,0.2)", borderRadius: 6, fontSize: 12, color: "#cba" }}>
            For each selected unit, sets <code>xp.value = 1</code> and <code>xp.startTier = canonicalMicTier + 1</code>.
            Useful for limited-roster factions where higher MIC tiers don't unlock new units — instead, the existing
            units gain XP at the upgraded tier, making the building upgrade worthwhile.
          </div>
        )}
      </div>

      <div style={{ marginTop: 18, display: "flex", gap: 8, alignItems: "baseline" }}>
        <button onClick={apply} style={{ background: "#dca64a", color: "#1a1a1a", border: "none", padding: "8px 18px", borderRadius: 6, fontWeight: 700 }}>
          Apply to {selectedUnits.length} units
        </button>
        <span style={{ color: "#888", fontSize: 12 }}>Preview after apply will land in the units list.</span>
      </div>

      <div style={{ marginTop: 24 }}>
        <Label>Selected units</Label>
        <div style={{ background: "rgba(0,0,0,0.2)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 8, padding: 8, maxHeight: 240, overflow: "auto" }}>
          {selectedUnits.map(u => (
            <div key={u.id} style={{ fontFamily: "Consolas, monospace", fontSize: 11.5, color: "#bbb", padding: "2px 6px" }}>
              {u.unit} <span style={{ color: "#666" }}>· {u.unitType || "faction"} · t{u.minTier}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function makeTransformer(op, params) {
  const { intVal, strVal, strList, boolVal, xpStart, xpValue } = params;
  return (unit) => {
    const u = { ...unit };
    switch (op) {
      case "set-min-tier":
        // v2: set both canonical and homeland to the same tier
        u.canonicalMicTier = intVal;
        u.homelandMicTier = intVal;
        u.minTier = intVal; // keep v1 field in sync for back-compat
        break;
      case "set-unit-type":
        if (strVal === "aor") {
          u.aor = u.aor && u.aor.enabled ? u.aor : { enabled: true, govTier: 1, aorOnly: false, recruitName: null };
        } else if (strVal === "faction") {
          u.aor = null;
        }
        u.unitType = strVal; // legacy
        break;
      case "set-enabled": u.enabled = boolVal; break;
      case "set-writeback":
        u.writeBack = boolVal;
        u.writeBackUserSet = true;
        break;
      case "add-hidden-resource": {
        const reqs = u.commonRequires || [];
        for (const v of strList) {
          const c = `hidden_resource ${v}`;
          if (!reqs.includes(c)) reqs.push(c);
        }
        u.commonRequires = reqs;
        break;
      }
      case "remove-hidden-resource":
        u.commonRequires = (u.commonRequires || []).filter(r => !strList.some(v => r === `hidden_resource ${v}`));
        break;
      case "add-faction": {
        const f = u.factions || [];
        for (const v of strList) if (!f.includes(v)) f.push(v);
        u.factions = f;
        break;
      }
      case "remove-faction":
        u.factions = (u.factions || []).filter(x => !strList.includes(x));
        break;
      case "add-exclude-faction": {
        const f = u.excludeFactions || [];
        for (const v of strList) if (!f.includes(v)) f.push(v);
        u.excludeFactions = f;
        break;
      }
      case "remove-exclude-faction":
        u.excludeFactions = (u.excludeFactions || []).filter(x => !strList.includes(x));
        break;
      case "set-xp": u.xp = { startTier: xpStart, value: xpValue }; break;
      case "clear-xp": u.xp = null; break;
      case "tier-gap-xp": {
        // Per-unit: bonus XP starts one tier above the unit's canonical mic_tier (or stays at 4 if already at 4).
        const start = Math.min(4, (u.canonicalMicTier || u.minTier || 1) + 1);
        u.xp = { startTier: start, value: 1 };
        break;
      }
      case "add-raw": {
        const reqs = u.commonRequires || [];
        if (strVal && !reqs.includes(strVal)) reqs.push(strVal);
        u.commonRequires = reqs;
        break;
      }
      default: break;
    }
    return u;
  };
}

const Label = ({ children }) => <div style={{ fontSize: 11, color: "#999", marginBottom: 4, textTransform: "uppercase", letterSpacing: 0.5 }}>{children}</div>;
const Field = ({ label, children }) => (
  <div style={{ display: "flex", flexDirection: "column", gap: 4, marginBottom: 10 }}>
    <Label>{label}</Label>
    {children}
  </div>
);
function input(width) {
  return {
    background: "#252525",
    border: "1px solid #333",
    color: "#ddd",
    padding: "5px 7px",
    borderRadius: 6,
    width: width || "auto",
  };
}
