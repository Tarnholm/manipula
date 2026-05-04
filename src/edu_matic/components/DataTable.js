// DataTable.js — read-only data grid with optional substring search.
//
// rows can be either:
//   - a plain Cell[][]                    (data row)
//   - { section: string }                 (full-width divider, e.g. "#MACEDON")
// Section rows mirror EDU-matic's faction-block separators. They are excluded
// from the search filter and skipped from "x of y rows" counts.

import React, { useState, useMemo } from "react";

function isSection(row) { return row && !Array.isArray(row) && typeof row.section === "string"; }

export default function DataTable({ columns = [], rows = [], maxHeight = "60vh", searchable = false }) {
  const [q, setQ] = useState("");
  const [dataCount, totalDataCount, filtered] = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const totalData = rows.reduce((n, r) => n + (isSection(r) ? 0 : 1), 0);
    if (!needle) return [totalData, totalData, rows];
    // Filter data rows by substring; drop sections that end up adjacent to no
    // data (so empty faction blocks don't hang there).
    const kept = [];
    for (const r of rows) {
      if (isSection(r)) {
        if (kept.length && isSection(kept[kept.length - 1])) kept[kept.length - 1] = r;
        else kept.push(r);
        continue;
      }
      if (r.some((cell) => cell != null && String(cell).toLowerCase().includes(needle))) kept.push(r);
    }
    while (kept.length && isSection(kept[kept.length - 1])) kept.pop();
    const shown = kept.reduce((n, r) => n + (isSection(r) ? 0 : 1), 0);
    return [shown, totalData, kept];
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
            {dataCount} of {totalDataCount} row{totalDataCount === 1 ? "" : "s"}
          </span>
        </div>
      )}
      <div className="dtable-scroll" style={{ maxHeight }}>
        <table className="dtable">
          <thead>
            <tr>
              {columns.map((c) => (
                <th key={c} title={c}>
                  {c}
                  <span className="dtable-caret" aria-hidden="true">▾</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.map((row, i) => {
              if (isSection(row)) {
                return (
                  <tr key={`s${i}`} className="dtable-section">
                    <td colSpan={columns.length} title={row.section}>{row.section}</td>
                  </tr>
                );
              }
              return (
                <tr key={i}>
                  {columns.map((c, j) => (
                    <td key={j} title={row[j] != null ? String(row[j]) : ""}>
                      {renderCell(row[j])}
                    </td>
                  ))}
                </tr>
              );
            })}
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
