// DataTable.js — data grid with optional substring search and per-cell editing.
//
// rows can be either:
//   - a plain Cell[][]                    (data row)
//   - { section: string }                 (full-width divider, e.g. "#MACEDON")
//   - { separator: true }                 (thin band — used between groups of
//                                          rows belonging to the same unit,
//                                          e.g. armour-tier rows for one
//                                          legion's helmet/torso variants)
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
//
// Performance: each Cell owns its own "is editing" state and is React.memo'd.
// That means a click in one cell does not re-render the other 25,000 cells in
// the table — only the clicked cell. Commits update project state, but
// memoization ensures only the cell whose value actually changed re-renders.

import React, { useState, useMemo, useRef, useEffect, useCallback } from "react";

function isSection(row) { return row && !Array.isArray(row) && typeof row.section === "string"; }
function isSeparator(row) { return row && !Array.isArray(row) && row.separator === true; }
function isNonData(row) { return isSection(row) || isSeparator(row); }

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
  const filteredEntries = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const all = rows.map((r, i) => ({ row: r, origIdx: i }));
    if (!needle) return all;
    const kept = [];
    for (const e of all) {
      if (isNonData(e.row)) {
        // Replace any trailing run of non-data rows (sections / separators) with
        // the latest one, so we never get two stacked decorations and we drop
        // them entirely if no following data row matches.
        if (kept.length && isNonData(kept[kept.length - 1].row)) kept[kept.length - 1] = e;
        else kept.push(e);
        continue;
      }
      if (e.row.some((cell) => cell != null && String(cell).toLowerCase().includes(needle))) kept.push(e);
    }
    while (kept.length && isNonData(kept[kept.length - 1].row)) kept.pop();
    return kept;
  }, [q, rows]);
  const totalDataCount = useMemo(() => rows.reduce((n, r) => n + (isNonData(r) ? 0 : 1), 0), [rows]);
  const dataCount = useMemo(() => filteredEntries.reduce((n, e) => n + (isNonData(e.row) ? 0 : 1), 0), [filteredEntries]);

  // Stable per-cell commit callback. Each Cell calls this with its rowOrigIdx +
  // columnKey + newValue; we resolve the rowId and forward to onEdit. The ref
  // is stable across renders so memoized Cells don't re-render just because
  // the parent re-rendered.
  const commitRef = useRef({ onEdit, rowIds });
  commitRef.current.onEdit = onEdit;
  commitRef.current.rowIds = rowIds;
  const commitCell = useCallback((rowOrigIdx, columnKey, newValue) => {
    const { onEdit: f, rowIds: ids } = commitRef.current;
    if (!f) return;
    const rowId = ids ? ids[rowOrigIdx] : rowOrigIdx;
    f(rowId, columnKey, newValue);
  }, []);

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
            {filteredEntries.map(({ row, origIdx }) => {
              if (isSection(row)) {
                return (
                  <tr key={`s${origIdx}`} className="dtable-section">
                    <td colSpan={columns.length} title={row.section}>{row.section}</td>
                  </tr>
                );
              }
              if (isSeparator(row)) {
                return (
                  <tr key={`d${origIdx}`} className="dtable-separator" aria-hidden="true">
                    <td colSpan={columns.length} />
                  </tr>
                );
              }
              return (
                <tr key={`r${origIdx}`}>
                  {columns.map((c, j) => (
                    <Cell
                      key={c}
                      value={row[j]}
                      columnKey={c}
                      rowOrigIdx={origIdx}
                      meta={columnMeta && columnMeta[c]}
                      editable={editable}
                      onCommit={commitCell}
                    />
                  ))}
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

// Cell — owns its own editing state. Memoized so only the clicked cell (or a
// cell whose underlying value just changed) re-renders. Without this, a click
// on one cell would re-render the whole 25k-cell table.
const Cell = React.memo(function Cell({ value, columnKey, rowOrigIdx, meta, editable, onCommit }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const touchedRef = useRef(false);
  const text = value != null ? String(value) : "";
  const startEdit = () => {
    if (!editable) return;
    // For dropdowns, start with an empty input so the datalist popover shows
    // ALL options instead of filtering to only those matching the current
    // value. The prior value lives in the placeholder. Bare-text cells start
    // pre-filled (and select-all'd) since users typically want to overwrite.
    const isCombo = meta && meta.type === "select";
    setDraft(isCombo ? "" : text);
    touchedRef.current = false;
    setEditing(true);
  };
  const commit = () => {
    if (!editing) return;
    setEditing(false);
    // If the user opened a dropdown and clicked away without picking, draft
    // is "" but they didn't actually mean to clear the cell — restore to the
    // prior value by not committing. They can still type a single space then
    // delete to explicitly clear.
    if (!touchedRef.current) return;
    if (draft !== text) onCommit(rowOrigIdx, columnKey, draft);
  };
  const cancel = () => setEditing(false);
  const onDraftChange = (v) => { touchedRef.current = true; setDraft(v); };
  return (
    <td
      title={text}
      className={editable ? "dtable-editable" : ""}
      onClick={startEdit}
    >
      {editing ? (
        <CellEditor
          value={draft}
          placeholder={text}
          meta={meta}
          onChange={onDraftChange}
          onCommit={commit}
          onCancel={cancel}
        />
      ) : (
        renderCell(value)
      )}
    </td>
  );
}, (prev, next) => {
  // Re-render only when something visible changes. editable/meta refs are
  // stable across DataTable renders, so this collapses click-elsewhere into a
  // no-op for unaffected cells.
  return prev.value === next.value
      && prev.columnKey === next.columnKey
      && prev.rowOrigIdx === next.rowOrigIdx
      && prev.meta === next.meta
      && prev.editable === next.editable
      && prev.onCommit === next.onCommit;
});

// Monotonic id for <datalist>s so the same lookup column rendered across many
// cells doesn't collide. Each editor mount gets a fresh id.
let datalistSeq = 0;

function CellEditor({ value, placeholder = "", meta, onChange, onCommit, onCancel }) {
  const ref = useRef(null);
  const idRef = useRef(`dt-opts-${++datalistSeq}`);
  // Auto-focus + select-all so the user can type-to-filter immediately. For
  // datalist-backed inputs the suggestion popover opens on focus/typing, no
  // showPicker() workaround needed.
  useEffect(() => {
    if (!ref.current) return;
    ref.current.focus();
    if (ref.current.select) {
      try { ref.current.select(); } catch {}
    }
  }, []);
  const onKeyDown = (e) => {
    if (e.key === "Enter") { e.preventDefault(); onCommit(); }
    else if (e.key === "Escape") { e.preventDefault(); onCancel(); }
  };
  if (meta && meta.type === "select") {
    // Datalist input: visible chevron, opens on focus, type-to-filter, and the
    // user can type a value not in the list (which we keep — useful for older
    // workbooks with values that newer ones dropped). Earlier we used a
    // <select> + showPicker() but Chrome's user-activation rule made the
    // dropdown silently fail to open most of the time, leaving the user
    // staring at a blank cell that didn't seem to do anything.
    const opts = meta.options || [];
    const seen = new Set(opts);
    const augmented = seen.has(value) || !value ? opts : [value, ...opts];
    return (
      <>
        <input
          ref={ref}
          type="text"
          list={idRef.current}
          className="dtable-cell-input dtable-cell-input--combo"
          value={value || ""}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={onKeyDown}
          onBlur={onCommit}
        />
        <datalist id={idRef.current}>
          {augmented.map((o) => <option key={o} value={o} />)}
        </datalist>
      </>
    );
  }
  return (
    <input
      ref={ref}
      type={meta && meta.type === "number" ? "number" : "text"}
      className="dtable-cell-input"
      value={value || ""}
      placeholder={placeholder}
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
