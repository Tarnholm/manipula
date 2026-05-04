// DataTable.js — data grid with optional substring search and per-cell editing.
//
// rows can be either:
//   - a plain Cell[][]                    (data row)
//   - { section: string }                 (full-width divider, e.g. "#MACEDON")
// Section rows mirror EDU-matic's faction-block separators. They are excluded
// from the search filter and skipped from "x of y rows" counts.
//
// Edit support (opt-in):
//   editable          — turns cells into click-to-edit fields.
//   columnMeta        — { [columnKey]: { type: "text" | "number" | "select",
//                        options?: string[] } } per-column override. Columns
//                        without an entry render as plain text and edit as
//                        free-form text input.
//   rowIds            — parallel array to `rows`. Required when editable=true:
//                        DataTable passes rowIds[i] to onEdit so the caller
//                        can map the edit back to its source object regardless
//                        of search filtering.
//   onEdit            — (rowId, columnKey, newValue) => void. Called on commit.
//   pinFirstColumn    — sticky-left first column on horizontal scroll, useful
//                        for wide tables (Units has 30+ columns) so the unit
//                        name stays visible.

import React, { useState, useMemo, useRef, useEffect } from "react";

function isSection(row) { return row && !Array.isArray(row) && typeof row.section === "string"; }

export default function DataTable({
  columns = [],
  rows = [],
  rowIds = null,
  columnMeta = null,
  onEdit = null,
  editable = false,
  pinFirstColumn = false,
  maxHeight = "60vh",
  searchable = false,
}) {
  const [q, setQ] = useState("");
  // Filter rows but keep the original-row index alongside each kept row, so we
  // can hand the caller the right rowId no matter the current search state.
  const filteredEntries = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const all = rows.map((r, i) => ({ row: r, origIdx: i }));
    if (!needle) return all;
    const kept = [];
    for (const e of all) {
      if (isSection(e.row)) {
        if (kept.length && isSection(kept[kept.length - 1].row)) kept[kept.length - 1] = e;
        else kept.push(e);
        continue;
      }
      if (e.row.some((cell) => cell != null && String(cell).toLowerCase().includes(needle))) kept.push(e);
    }
    while (kept.length && isSection(kept[kept.length - 1].row)) kept.pop();
    return kept;
  }, [q, rows]);
  const totalDataCount = useMemo(() => rows.reduce((n, r) => n + (isSection(r) ? 0 : 1), 0), [rows]);
  const dataCount = useMemo(() => filteredEntries.reduce((n, e) => n + (isSection(e.row) ? 0 : 1), 0), [filteredEntries]);

  // Active edit cell — stored as { rowOrigIdx, columnKey, draft }. Only one cell
  // is editable at a time; clicking another commits the previous one.
  const [editing, setEditing] = useState(null);

  const commit = (next) => {
    if (!editing || !onEdit) { setEditing(next); return; }
    const rowId = rowIds ? rowIds[editing.rowOrigIdx] : editing.rowOrigIdx;
    onEdit(rowId, editing.columnKey, editing.draft);
    setEditing(next);
  };
  const cancel = () => setEditing(null);

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
        <table className={"dtable" + (pinFirstColumn ? " dtable-pinfirst" : "")}>
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
            {filteredEntries.map(({ row, origIdx }, i) => {
              if (isSection(row)) {
                return (
                  <tr key={`s${origIdx}`} className="dtable-section">
                    <td colSpan={columns.length} title={row.section}>{row.section}</td>
                  </tr>
                );
              }
              return (
                <tr key={`r${origIdx}`}>
                  {columns.map((c, j) => {
                    const isEditing = editable && editing && editing.rowOrigIdx === origIdx && editing.columnKey === c;
                    const text = row[j] != null ? String(row[j]) : "";
                    return (
                      <td
                        key={j}
                        title={text}
                        className={editable ? "dtable-editable" : ""}
                        onClick={() => {
                          if (!editable) return;
                          if (isEditing) return;
                          commit({ rowOrigIdx: origIdx, columnKey: c, draft: row[j] != null ? String(row[j]) : "" });
                        }}
                      >
                        {isEditing ? (
                          <CellEditor
                            value={editing.draft}
                            meta={columnMeta && columnMeta[c]}
                            onChange={(v) => setEditing({ ...editing, draft: v })}
                            onCommit={() => commit(null)}
                            onCancel={cancel}
                          />
                        ) : (
                          renderCell(row[j])
                        )}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
            {filteredEntries.length === 0 && (
              <tr><td className="dim" colSpan={columns.length} style={{ textAlign: "center", padding: 20 }}>No rows.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function CellEditor({ value, meta, onChange, onCommit, onCancel }) {
  const ref = useRef(null);
  // Auto-focus when an editor mounts so the user doesn't need a second click.
  // For selects we also open the dropdown on mount via showPicker() where
  // available, falling back gracefully on older Chromium.
  useEffect(() => {
    if (!ref.current) return;
    ref.current.focus();
    if (meta && meta.type === "select" && typeof ref.current.showPicker === "function") {
      try { ref.current.showPicker(); } catch {}
    } else if (ref.current.select) {
      try { ref.current.select(); } catch {}
    }
  }, [meta]);
  const onKeyDown = (e) => {
    if (e.key === "Enter") { e.preventDefault(); onCommit(); }
    else if (e.key === "Escape") { e.preventDefault(); onCancel(); }
  };
  if (meta && meta.type === "select") {
    const opts = meta.options || [];
    // Include the current value in the option list even if it's not in opts
    // (so we don't silently lose unknown values from older workbooks).
    const seen = new Set(opts);
    const augmented = seen.has(value) || !value ? opts : [value, ...opts];
    return (
      <select
        ref={ref}
        className="dtable-cell-input"
        value={value || ""}
        onChange={(e) => { onChange(e.target.value); /* commit immediately on select */ setTimeout(onCommit, 0); }}
        onKeyDown={onKeyDown}
        onBlur={onCommit}
      >
        <option value="">—</option>
        {augmented.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    );
  }
  return (
    <input
      ref={ref}
      type={meta && meta.type === "number" ? "number" : "text"}
      className="dtable-cell-input"
      value={value || ""}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={onKeyDown}
      onBlur={onCommit}
    />
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
