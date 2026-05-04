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

import React, { useState, useMemo, useRef, useEffect, useCallback, useLayoutEffect } from "react";
import { createPortal } from "react-dom";

// Wide-table scrolling: relies on native overflow-x:auto on .dtable-scroll.
// The min-width:0 chain on the parent containers (App.js: flex children below
// the row-flex level) lets the scroll container constrain its width to the
// viewport, so wide tables overflow inside it instead of expanding it. If the
// horizontal bar disappears again, the regression is almost certainly a parent
// flex item missing min-width:0 — not a bug in this component.

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
  columnsToggleable = false,
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

  // Column visibility — opt-in via columnsToggleable. Internal state holds the
  // *hidden* set so an unset visibility map still defaults to showing all
  // columns when new ones are added to a project. Pinned-first-column key is
  // never hidden (it'd defeat the pin) — guarded in the toggle handler below.
  const [hiddenCols, setHiddenCols] = useState(() => new Set());
  const [colsMenuOpen, setColsMenuOpen] = useState(false);
  const visibleColIndices = useMemo(
    () => columns.map((_, i) => i).filter((i) => !hiddenCols.has(columns[i])),
    [columns, hiddenCols]
  );
  const visibleColumns = useMemo(
    () => visibleColIndices.map((i) => columns[i]),
    [columns, visibleColIndices]
  );
  const toggleCol = (key) => {
    setHiddenCols((prev) => {
      const next = new Set(prev);
      // Don't allow hiding the first column when pinned — losing the unit name
      // anchor while horizontally scrolled is worse than denying the toggle.
      if (pinFirstColumn && columns[0] === key && !next.has(key)) return prev;
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };
  const showAllCols = () => setHiddenCols(new Set());
  const hideAllCols = () => {
    // Always keep the pinned first column visible.
    const next = new Set(columns.slice(pinFirstColumn ? 1 : 0));
    setHiddenCols(next);
  };

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

  const scrollRef = useRef(null);

  // Reset to leftmost on dataset change so the user sees the first column.
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollLeft = 0;
  }, [rows]);

  // Wheel: shift+wheel scrolls horizontally; plain wheel scrolls vertically
  // (which the native scrollbar handles). Without an explicit handler some
  // browsers swallow shift+wheel inside table elements.
  const onWheel = (e) => {
    if (!e.shiftKey) return;
    if (!scrollRef.current) return;
    e.preventDefault();
    scrollRef.current.scrollLeft += e.deltaY || e.deltaX;
  };

  // Arrow-key horizontal scroll when the user has focused the table area.
  // Tabindex on .dtable-scroll lets it receive keyboard focus on click.
  const onKeyDown = (e) => {
    const sc = scrollRef.current;
    if (!sc) return;
    if (e.key === "ArrowLeft")  { sc.scrollLeft -= 80; e.preventDefault(); }
    else if (e.key === "ArrowRight") { sc.scrollLeft += 80; e.preventDefault(); }
    else if (e.key === "Home")       { sc.scrollLeft = 0; e.preventDefault(); }
    else if (e.key === "End")        { sc.scrollLeft = sc.scrollWidth; e.preventDefault(); }
  };

  const showToolbar = searchable || columnsToggleable;
  const hiddenCount = hiddenCols.size;
  return (
    <div className="dtable-wrap">
      {showToolbar && (
        <div className="dtable-toolbar">
          {searchable && (
            <>
              <input
                className="input"
                placeholder="Search…"
                value={q}
                onChange={(e) => setQ(e.target.value)}
              />
              <span className="dim">
                {dataCount} of {totalDataCount} row{totalDataCount === 1 ? "" : "s"}
              </span>
            </>
          )}
          {columnsToggleable && (
            <ColumnsPicker
              columns={columns}
              hiddenCols={hiddenCols}
              hiddenCount={hiddenCount}
              pinFirstColumn={pinFirstColumn}
              open={colsMenuOpen}
              onOpenChange={setColsMenuOpen}
              onToggle={toggleCol}
              onShowAll={showAllCols}
              onHideAll={hideAllCols}
            />
          )}
        </div>
      )}
      <div
        className="dtable-scroll"
        style={maxHeight ? { maxHeight } : undefined}
        ref={scrollRef}
        onWheel={onWheel}
        onKeyDown={onKeyDown}
        tabIndex={0}
      >
        <table className={"dtable" + (pinFirstColumn ? " dtable-pinfirst" : "")}>
          <thead>
            <tr>
              {visibleColumns.map((c) => (
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
                    <td colSpan={visibleColumns.length} title={row.section}>{row.section}</td>
                  </tr>
                );
              }
              if (isSeparator(row)) {
                return (
                  <tr key={`d${origIdx}`} className="dtable-separator" aria-hidden="true">
                    <td colSpan={visibleColumns.length} />
                  </tr>
                );
              }
              return (
                <tr key={`r${origIdx}`}>
                  {visibleColIndices.map((origColIdx, j) => {
                    const c = columns[origColIdx];
                    return (
                      <Cell
                        key={c}
                        value={row[origColIdx]}
                        columnKey={c}
                        rowOrigIdx={origIdx}
                        meta={columnMeta && columnMeta[c]}
                        editable={editable}
                        onCommit={commitCell}
                      />
                    );
                  })}
                </tr>
              );
            })}
            {filteredEntries.length === 0 && (
              <tr><td className="dim" colSpan={visibleColumns.length} style={{ textAlign: "center", padding: 20 }}>No rows.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// Columns picker — small toolbar button + portal popover with a checkbox per
// column. Renders via createPortal so the popover can spill outside the
// table's scroll container without being clipped (same trick as the combobox).
function ColumnsPicker({ columns, hiddenCols, hiddenCount, pinFirstColumn, open, onOpenChange, onToggle, onShowAll, onHideAll }) {
  const btnRef = useRef(null);
  const popRef = useRef(null);
  const [pos, setPos] = useState(null);

  useLayoutEffect(() => {
    if (!open || !btnRef.current) return;
    const r = btnRef.current.getBoundingClientRect();
    setPos({ left: r.left, top: r.bottom + 4 });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const reposition = () => {
      if (!btnRef.current) return;
      const r = btnRef.current.getBoundingClientRect();
      setPos({ left: r.left, top: r.bottom + 4 });
    };
    const onDocMouseDown = (e) => {
      if (popRef.current && popRef.current.contains(e.target)) return;
      if (btnRef.current && btnRef.current.contains(e.target)) return;
      onOpenChange(false);
    };
    window.addEventListener("scroll", reposition, true);
    window.addEventListener("resize", reposition);
    document.addEventListener("mousedown", onDocMouseDown);
    return () => {
      window.removeEventListener("scroll", reposition, true);
      window.removeEventListener("resize", reposition);
      document.removeEventListener("mousedown", onDocMouseDown);
    };
  }, [open, onOpenChange]);

  const label = hiddenCount === 0
    ? `Columns (${columns.length})`
    : `Columns (${columns.length - hiddenCount}/${columns.length})`;

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        className={"btn" + (hiddenCount > 0 ? " btn-active" : "")}
        onClick={() => onOpenChange(!open)}
        title="Show or hide columns"
      >
        {label} <span style={{ opacity: 0.5, marginLeft: 4 }}>▾</span>
      </button>
      {open && pos && createPortal(
        <div
          ref={popRef}
          className="dtable-cols-pop"
          style={{ left: pos.left, top: pos.top }}
        >
          <div className="dtable-cols-actions">
            <button type="button" className="link-btn" onClick={onShowAll}>show all</button>
            <span className="dim" style={{ margin: "0 6px" }}>·</span>
            <button type="button" className="link-btn" onClick={onHideAll}>hide all</button>
          </div>
          <div className="dtable-cols-list">
            {columns.map((c, i) => {
              const isPinned = pinFirstColumn && i === 0;
              const checked = !hiddenCols.has(c);
              return (
                <label
                  key={c}
                  className={"dtable-cols-row" + (isPinned ? " is-locked" : "")}
                  title={isPinned ? "Pinned first column — always visible" : c}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={isPinned}
                    onChange={() => onToggle(c)}
                  />
                  <span>{c}</span>
                  {isPinned && <span className="dim" style={{ marginLeft: "auto", fontSize: 10 }}>pinned</span>}
                </label>
              );
            })}
          </div>
        </div>,
        document.body
      )}
    </>
  );
}

// Cell — owns its own editing state. Memoized so only the clicked cell (or a
// cell whose underlying value just changed) re-renders. Without this, a click
// on one cell would re-render the whole 25k-cell table.
const Cell = React.memo(function Cell({ value, columnKey, rowOrigIdx, meta, editable, onCommit }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  // Ref alongside state so commit() reads the latest typed/picked value even
  // when the editor calls onChange + onCommit in the same tick (combobox
  // option-click does this — without the ref, setDraft hasn't flushed before
  // commit captures `draft`, and commit gets the stale prior value).
  const draftRef = useRef("");
  const touchedRef = useRef(false);
  const text = value != null ? String(value) : "";
  const startEdit = () => {
    if (!editable) return;
    const isCombo = meta && meta.type === "select";
    const initial = isCombo ? "" : text;
    setDraft(initial);
    draftRef.current = initial;
    touchedRef.current = false;
    setEditing(true);
  };
  const commit = () => {
    if (!editing) return;
    setEditing(false);
    if (!touchedRef.current) return;
    const final = draftRef.current;
    if (final !== text) onCommit(rowOrigIdx, columnKey, final);
  };
  const cancel = () => setEditing(false);
  const onDraftChange = (v) => { touchedRef.current = true; draftRef.current = v; setDraft(v); };
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

function CellEditor({ value, placeholder = "", meta, onChange, onCommit, onCancel }) {
  const ref = useRef(null);
  // Auto-focus + select-all so the user can immediately type to filter or
  // overwrite.
  useEffect(() => {
    if (!ref.current) return;
    ref.current.focus();
    if (ref.current.select) { try { ref.current.select(); } catch {} }
  }, []);
  const onKeyDown = (e) => {
    if (e.key === "Enter") { e.preventDefault(); onCommit(); }
    else if (e.key === "Escape") { e.preventDefault(); onCancel(); }
  };
  if (meta && meta.type === "select") {
    return (
      <ComboboxEditor
        value={value}
        placeholder={placeholder}
        options={meta.options || []}
        onChange={onChange}
        onCommit={onCommit}
        onCancel={onCancel}
      />
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

// ComboboxEditor — custom dropdown that scrolls reliably (the native <datalist>
// popover doesn't in Electron/Chromium for long lists, leaving users unable to
// reach later options). The popover renders via createPortal into document.body
// with position:fixed coords, so it can spill outside the table's scroll
// container without being clipped.
function ComboboxEditor({ value, placeholder, options, onChange, onCommit, onCancel }) {
  const inputRef = useRef(null);
  const popRef = useRef(null);
  const [pos, setPos] = useState(null);   // {left, top, width}
  const [highlightIdx, setHighlightIdx] = useState(0);

  const filtered = useMemo(() => {
    const q = (value || "").trim().toLowerCase();
    if (!q) return options;
    // Show "starts with" matches first, then "contains" matches — feels more
    // predictable when typing the start of a name.
    const starts = [], contains = [];
    for (const o of options) {
      const lc = String(o).toLowerCase();
      if (lc.startsWith(q)) starts.push(o);
      else if (lc.includes(q)) contains.push(o);
    }
    return starts.concat(contains);
  }, [value, options]);

  useEffect(() => { setHighlightIdx(0); }, [value]);

  useLayoutEffect(() => {
    if (!inputRef.current) return;
    inputRef.current.focus();
    if (inputRef.current.select) { try { inputRef.current.select(); } catch {} }
    const r = inputRef.current.getBoundingClientRect();
    setPos({ left: r.left, top: r.bottom + 2, minWidth: r.width });
  }, []);

  // Keep popover anchored if the page scrolls / window resizes while it's open.
  useEffect(() => {
    const reposition = () => {
      if (!inputRef.current) return;
      const r = inputRef.current.getBoundingClientRect();
      setPos({ left: r.left, top: r.bottom + 2, minWidth: r.width });
    };
    window.addEventListener("scroll", reposition, true);
    window.addEventListener("resize", reposition);
    return () => {
      window.removeEventListener("scroll", reposition, true);
      window.removeEventListener("resize", reposition);
    };
  }, []);

  const commitWith = (val) => {
    onChange(val);
    // Defer commit to after the parent applies the new value, so the editor's
    // touched flag captures the intent before the cell tears down.
    setTimeout(onCommit, 0);
  };

  const onKeyDown = (e) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlightIdx((i) => Math.min(filtered.length - 1, i + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlightIdx((i) => Math.max(0, i - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (filtered[highlightIdx] != null) commitWith(filtered[highlightIdx]);
      else onCommit();
    } else if (e.key === "Escape") {
      e.preventDefault();
      onCancel();
    } else if (e.key === "Tab") {
      // Don't preventDefault so focus moves naturally; commit the current
      // typed value.
      onCommit();
    }
  };

  // Blur commits *unless* the new focus target is inside our own popover (so
  // clicking an option doesn't fire blur-cancel before the click takes effect).
  const onBlur = (e) => {
    if (popRef.current && popRef.current.contains(e.relatedTarget)) return;
    onCommit();
  };

  // Scroll the highlighted option into view as the user arrows through.
  useEffect(() => {
    if (!popRef.current) return;
    const el = popRef.current.querySelector(`[data-combo-idx="${highlightIdx}"]`);
    if (el && typeof el.scrollIntoView === "function") {
      el.scrollIntoView({ block: "nearest" });
    }
  }, [highlightIdx]);

  return (
    <>
      <input
        ref={inputRef}
        type="text"
        className="dtable-cell-input dtable-cell-input--combo"
        value={value || ""}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
        onBlur={onBlur}
      />
      {pos && createPortal(
        <div
          ref={popRef}
          className="dtable-combo-pop"
          // The popover width is `width: max-content` (in CSS) capped via
          // max-width, so it grows to fit the longest option text without
          // ever needing an internal horizontal scrollbar. minWidth keeps
          // it at least as wide as the input it anchors to.
          style={{ left: pos.left, top: pos.top, minWidth: pos.minWidth }}
          onMouseDown={(e) => e.preventDefault() /* prevent input blur */}
        >
          {filtered.length === 0 && (
            <div className="dtable-combo-empty">no match — Enter to keep "{value}"</div>
          )}
          {filtered.map((opt, i) => (
            <div
              key={opt}
              data-combo-idx={i}
              className={"dtable-combo-opt" + (i === highlightIdx ? " is-active" : "")}
              onMouseEnter={() => setHighlightIdx(i)}
              onClick={() => commitWith(opt)}
            >
              {opt}
            </div>
          ))}
        </div>,
        document.body
      )}
    </>
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
