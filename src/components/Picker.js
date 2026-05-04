import React, { useMemo, useState } from "react";

// A multi-select with search. options = [{ value, label, hint?, icon? }]. value = string[].
// Selected chips and the dropdown both follow the order of `options` (file-order for factions),
// not insertion order — so the selection displays in a stable, predictable way regardless of click order.
// `renderIcon`, if provided, gets called as `renderIcon(option)` and may return a React node — used
// for inline faction icons in the chips and dropdown.
export default function Picker({ label, options, value, onChange, placeholder = "Add...", maxHeight = 220, renderIcon }) {
  const [q, setQ] = useState("");
  // Index lookup so we can sort the chosen `value` array by its position in `options`.
  const orderIndex = useMemo(() => {
    const m = new Map();
    for (let i = 0; i < options.length; i++) m.set(options[i].value, i);
    return m;
  }, [options]);
  const orderedValue = useMemo(() => {
    return value.slice().sort((a, b) => {
      const ai = orderIndex.has(a) ? orderIndex.get(a) : Number.MAX_SAFE_INTEGER;
      const bi = orderIndex.has(b) ? orderIndex.get(b) : Number.MAX_SAFE_INTEGER;
      if (ai !== bi) return ai - bi;
      return a < b ? -1 : a > b ? 1 : 0;
    });
  }, [value, orderIndex]);
  const filtered = useMemo(() => {
    const ql = q.toLowerCase();
    return options
      .filter(o => !value.includes(o.value))
      .filter(o => !ql || o.value.toLowerCase().includes(ql) || (o.label || "").toLowerCase().includes(ql));
  }, [options, value, q]);

  const add = (v) => { onChange([...value, v]); setQ(""); };
  const remove = (v) => onChange(value.filter(x => x !== v));

  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ fontSize: 11, color: "#999", marginBottom: 4, textTransform: "uppercase", letterSpacing: 0.5 }}>{label}</div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginBottom: 4 }}>
        {orderedValue.map(v => {
          const opt = options.find(o => o.value === v);
          const icon = renderIcon && opt ? renderIcon(opt) : null;
          return (
            <span key={v} style={{ background: "#333", padding: "2px 6px", borderRadius: 3, fontSize: 12, display: "inline-flex", alignItems: "center", gap: 4 }}>
              {icon}
              {opt ? opt.label : v}
              <button onClick={() => remove(v)} style={{ background: "none", border: "none", color: "#999", cursor: "pointer", padding: 0, fontSize: 14 }}>×</button>
            </span>
          );
        })}
      </div>
      <input
        type="text"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder={placeholder}
        style={{ width: "100%", background: "#252525", border: "1px solid #333", color: "#ddd", padding: "4px 6px", borderRadius: 3 }}
      />
      {q && filtered.length > 0 && (
        <div style={{ background: "#252525", border: "1px solid #333", marginTop: 2, maxHeight, overflow: "auto", borderRadius: 3 }}>
          {filtered.slice(0, 100).map(o => {
            const icon = renderIcon ? renderIcon(o) : null;
            return (
              <div
                key={o.value}
                onClick={() => add(o.value)}
                style={{ padding: "4px 8px", cursor: "pointer", borderBottom: "1px solid #2a2a2a", display: "flex", justifyContent: "space-between", alignItems: "center" }}
                onMouseEnter={(e) => e.currentTarget.style.background = "#333"}
                onMouseLeave={(e) => e.currentTarget.style.background = ""}
              >
                <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                  {icon}
                  {o.label}
                </span>
                {o.hint && <span style={{ color: "#777", fontSize: 11 }}>{o.hint}</span>}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
