import React, { useMemo, useState } from "react";

// A multi-select with search. options = [{ value, label, hint? }]. value = string[].
export default function Picker({ label, options, value, onChange, placeholder = "Add...", maxHeight = 220 }) {
  const [q, setQ] = useState("");
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
        {value.map(v => {
          const opt = options.find(o => o.value === v);
          return (
            <span key={v} style={{ background: "#333", padding: "2px 6px", borderRadius: 3, fontSize: 12, display: "inline-flex", alignItems: "center", gap: 4 }}>
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
          {filtered.slice(0, 100).map(o => (
            <div
              key={o.value}
              onClick={() => add(o.value)}
              style={{ padding: "4px 8px", cursor: "pointer", borderBottom: "1px solid #2a2a2a", display: "flex", justifyContent: "space-between" }}
              onMouseEnter={(e) => e.currentTarget.style.background = "#333"}
              onMouseLeave={(e) => e.currentTarget.style.background = ""}
            >
              <span>{o.label}</span>
              {o.hint && <span style={{ color: "#777", fontSize: 11 }}>{o.hint}</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
