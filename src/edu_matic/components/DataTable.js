// DataTable.js — read-only data grid with optional substring search.
//
// Trivial implementation: plain <table> in a scroll container.
// The user will swap in TanStack Table / AG Grid / their own virtualized
// grid later — this is just enough to exercise the pipeline.

import React, { useState, useMemo } from "react";

export default function DataTable({ columns = [], rows = [], maxHeight = "60vh", searchable = false }) {
  const [q, setQ] = useState("");
  const [totalShown, filtered] = useMemo(() => {
    const needle = q.trim().toLowerCase();
    let filtered = rows;
    if (needle) {
      filtered = rows.filter((row) =>
        row.some((cell) => cell != null && String(cell).toLowerCase().includes(needle))
      );
    }
    return [filtered.length, filtered];
  }, [q, rows]);

  return (
    <div className="dtable-wrap">
      {searchable && (
        <div className="dtable-toolbar">
          <input
            className="input"
            placeholder="Search…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <span className="dim">
            {totalShown} of {rows.length} row{rows.length === 1 ? "" : "s"}
          </span>
        </div>
      )}
      <div className="dtable-scroll" style={{ maxHeight }}>
        <table className="dtable">
          <thead>
            <tr>
              {columns.map((c) => (
                <th key={c} title={c}>{c}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.map((row, i) => (
              <tr key={i}>
                {columns.map((c, j) => (
                  <td key={j} title={row[j] != null ? String(row[j]) : ""}>
                    {renderCell(row[j])}
                  </td>
                ))}
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr><td className="dim" colSpan={columns.length} style={{ textAlign: "center", padding: 20 }}>No rows.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function renderCell(v) {
  if (v === null || v === undefined || v === "") return "";
  if (typeof v === "number") {
    if (Number.isInteger(v)) return String(v);
    return v.toFixed(4).replace(/\.?0+$/, "");     // trim trailing zeros
  }
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}
