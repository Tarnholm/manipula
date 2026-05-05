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
  columnLabels = null,    // optional { [key]: displayLabel } for header rendering
  onEdit = null,
  editable = false,
  pinFirstColumn = false,
  // Optional: pin N columns from the start. Falls back to pinFirstColumn
  // for back-compat; both inputs feed the same internal pinned state
  // which the header menu can extend / shrink.
  pinColumns = null,
  maxHeight = "60vh",
  searchable = false,
  columnsToggleable = false,
  // Row-mutating operations. Wire any subset; the right-click context menu
  // and toolbar surface only the verbs that have a callback. rowOrigIdx
  // passed back is the row's index in the SOURCE rows array (not after
  // search filtering), and rowIds[rowOrigIdx] still resolves to the
  // caller's domain id when rowIds is provided.
  onAddRow = null,           // toolbar "+ Add row" (no row context)
  onDuplicateRow = null,     // context menu — copy + insert below
  onInsertRowBelow = null,   // context menu — blank insert below
  onDeleteRow = null,        // context menu — delete this row
  addRowLabel = "+ Add row",
  rowMenuExtras = null,      // optional [{ label, onClick(rowId), destructive? }, ...]
  // Optional resolver for "what JSON should the Copy-row context menu
  // emit?" When provided, the menu gains a "Copy row as JSON" entry
  // that reads the actual source record for that rowId and writes its
  // pretty-printed JSON to the system clipboard.
  rowToJSON = null,          // (rowId) => any | null
  // Counterpart to rowToJSON: pastes the clipboard's JSON into the
  // right-clicked row's record. The handler decides which fields to
  // copy in (typically a structural merge) and calls setProject.
  onPasteRow = null,         // (rowId, parsedJSON) => void
  // Per-row flag indicators for inline validation. Map keyed by ROWID
  // (not row index): { [rowId]: { error?: string, warn?: string } }.
  // First column gets a small dot showing the highest severity; the
  // tooltip carries the message.
  rowFlags = null,
  // Bulk operations on multi-selected rows. When the user has anything
  // selected, a strip appears in the toolbar with action buttons here.
  // Each item: { label, onClick(rowIds[]), destructive? }.
  // Special form for set-field: { label, setField: { onApply(rowIds, col, val) } }
  // — DataTable opens a styled popover with a column dropdown + value
  // input rather than firing window.prompt twice.
  bulkActions = null,
  // Persistence key for the search box so switching tabs doesn't lose
  // the user's query. Reads/writes localStorage when set.
  searchPersistKey = null,
  // Find/Replace box in the toolbar — opt-in via this prop. The
  // simpler `searchable` highlights only; find/replace adds a Replace
  // input + a "Replace all visible" button that calls onReplaceAll
  // with the matching rowIds and the chosen replacement.
  findReplace = false,
  onReplaceAll = null,        // (rowIds[], find, replace) => void
  // Drag-and-drop reorder. When provided, every data row is draggable;
  // dragging a selected row moves the entire current selection (so the
  // user can grab a whole "Polybian Romans" group and drop it under
  // "Late Republicans"). Args: (srcRowIds[], targetRowId, position) where
  // position is "above" | "below" relative to the target. Section /
  // separator rows are not draggable but ARE valid drop targets.
  onMoveRows = null,
  // Selection-change event. Fires whenever the user adds or removes a
  // row from the multi-select set (Ctrl/Shift-click). UnitsScreen reads
  // this to drive its computed-stat preview pane.
  onSelectionChange = null,
}) {
  const [q, setQ] = useState(() => {
    if (!searchPersistKey) return "";
    try { return localStorage.getItem("rt:search:" + searchPersistKey) || ""; } catch { return ""; }
  });
  // Persist on change so switching tabs doesn't lose the query.
  useEffect(() => {
    if (!searchPersistKey) return;
    try {
      if (q) localStorage.setItem("rt:search:" + searchPersistKey, q);
      else localStorage.removeItem("rt:search:" + searchPersistKey);
    } catch {}
  }, [q, searchPersistKey]);
  const [bulkSetState, setBulkSetState] = useState(null);  // null | { onApply, column, value }
  const filteredEntries = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const all = rows.map((r, i) => ({ row: r, origIdx: i }));
    if (!needle) return all;
    const kept = [];
    for (const e of all) {
      // Drop separator rows entirely while searching — they were meant
      // to mark group transitions in the FULL list, but after filtering
      // they often sit between matching same-name variants and read as
      // false group boundaries. Section headers stay so the user keeps
      // their bearings.
      if (isSeparator(e.row)) continue;
      if (isSection(e.row)) {
        // Replace any trailing run of section rows with the latest, so
        // we never get two stacked headers when intermediate sections
        // had no matching rows.
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
  // Cell-level match count for the search query — reports how many
  // individual cells match across all visible columns. Useful when one
  // string occurs many times per row (e.g. faction codes), so the user
  // can tell "12 of 845 rows" from "57 cells matched."
  const matchedCellCount = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return 0;
    let n = 0;
    for (const e of filteredEntries) {
      if (!Array.isArray(e.row)) continue;
      for (const cell of e.row) {
        if (cell != null && String(cell).toLowerCase().includes(needle)) n++;
      }
    }
    return n;
  }, [filteredEntries, q]);

  // Lazy-render limit. Large EDU projects have ~800-1000 rows; rendering
  // every Cell on first paint takes seconds even with React.memo. We cap
  // initial render to ROW_PAGE rows; an IntersectionObserver sentinel
  // below bumps the limit as the user scrolls near the bottom. Search
  // narrows filteredEntries before this cap so search results aren't
  // hidden behind it.
  const ROW_PAGE = 200;
  const [renderLimit, setRenderLimit] = useState(ROW_PAGE);
  // Reset on data / search change so jumping to a different filter
  // shows results from the top.
  useEffect(() => { setRenderLimit(ROW_PAGE); }, [rows, q]);
  // sortedEntries / visibleEntries are computed further down, after the
  // sort/pinned state is declared. Their deps array reads `sortBy`, so
  // they MUST come after the useState. Putting them here would TDZ-crash
  // the entire EDU panel on every project load — see the ee/sortBy bug
  // diagnosed in v0.33.5 via source-map.

  // groups (sections-grouped visibleEntries) is computed further down,
  // after visibleEntries / sortedEntries are declared.

  // Column visibility — opt-in via columnsToggleable. Internal state holds the
  // *hidden* set so an unset visibility map still defaults to showing all
  // columns when new ones are added to a project. Pinned-first-column key is
  // never hidden (it'd defeat the pin) — guarded in the toggle handler below.
  const [hiddenCols, setHiddenCols] = useState(() => new Set());
  const [colsMenuOpen, setColsMenuOpen] = useState(false);
  // Pinned-column set — keys (column names) that should stay sticky on
  // the left during horizontal scroll. Seeded from pinFirstColumn /
  // pinColumns props; the header right-click menu lets the user pin /
  // unpin further. Render order treats pinned columns as the first
  // visible columns regardless of the source `columns` order.
  const [pinned, setPinned] = useState(() => {
    const seed = new Set();
    const n = pinColumns != null ? pinColumns : (pinFirstColumn ? 1 : 0);
    for (let i = 0; i < n && i < columns.length; i++) seed.add(columns[i]);
    return seed;
  });
  // Column widths — { [columnKey]: px }. Filled by drag-to-resize. When
  // unset, the column uses table-auto sizing (its natural width).
  const [colWidths, setColWidths] = useState({});
  // Client-side sort: { key, dir: "asc"|"desc" } | null. Applied on top
  // of the search-filtered rows but does NOT mutate the source data.
  const [sortBy, setSortBy] = useState(null);
  // Header right-click menu — { x, y, columnKey } | null.
  const [headerMenu, setHeaderMenu] = useState(null);
  useEffect(() => {
    if (!headerMenu) return;
    const onAny = () => setHeaderMenu(null);
    setTimeout(() => document.addEventListener("click", onAny, { once: true }), 0);
    return () => document.removeEventListener("click", onAny);
  }, [headerMenu]);
  // Apply client-side sort when set. Section / separator rows are
  // dropped while sorted (they only make sense in the original order)
  // and restored when sort is cleared. The sort uses natural-collator
  // comparison so "10" sorts after "9" in mixed-text columns. Sits
  // here (not above) so the [filteredEntries, sortBy, columns] deps
  // array doesn't TDZ on `sortBy` during render.
  const sortedEntries = useMemo(() => {
    if (!sortBy) return filteredEntries;
    const colIdx = columns.indexOf(sortBy.key);
    if (colIdx < 0) return filteredEntries;
    const sortable = filteredEntries.filter((e) => Array.isArray(e.row));
    const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });
    sortable.sort((a, b) => {
      const av = a.row[colIdx], bv = b.row[colIdx];
      const as = av == null ? "" : String(av);
      const bs = bv == null ? "" : String(bv);
      const r = collator.compare(as, bs);
      return sortBy.dir === "asc" ? r : -r;
    });
    return sortable;
  }, [filteredEntries, sortBy, columns]);
  const visibleEntries = useMemo(
    () => sortedEntries.length > renderLimit ? sortedEntries.slice(0, renderLimit) : sortedEntries,
    [sortedEntries, renderLimit]
  );
  const hiddenRowCount = filteredEntries.length - visibleEntries.length;
  // Group entries into one tbody per section so sticky-top section dividers
  // are bounded by their own tbody. Without this, multiple sticky <tr> at the
  // same top: offset all stick at the same y-coordinate and overlap as the
  // user scrolls — which is exactly the "non-remastered romans following when
  // I scroll down" symptom. With per-section tbody, sticky is constrained to
  // its tbody's bounds: the previous section's header un-sticks when its
  // tbody scrolls offscreen, and the next section's header takes over.
  const groups = useMemo(() => {
    const out = [];
    let cur = null;
    for (const e of visibleEntries) {
      if (isSection(e.row)) {
        cur = { section: e, entries: [] };
        out.push(cur);
        continue;
      }
      if (!cur) {
        cur = { section: null, entries: [] };
        out.push(cur);
      }
      cur.entries.push(e);
    }
    return out;
  }, [visibleEntries]);
  const visibleColIndices = useMemo(
    () => columns.map((_, i) => i).filter((i) => !hiddenCols.has(columns[i])),
    [columns, hiddenCols]
  );
  const visibleColumns = useMemo(
    () => visibleColIndices.map((i) => columns[i]),
    [columns, visibleColIndices]
  );
  // Reorder so pinned columns come first, in their original relative
  // order. The unpinned remainder follows in source order.
  const orderedColumns = useMemo(() => {
    const pin = visibleColumns.filter((c) => pinned.has(c));
    const rest = visibleColumns.filter((c) => !pinned.has(c));
    return [...pin, ...rest];
  }, [visibleColumns, pinned]);
  const orderedColIndices = useMemo(() => orderedColumns.map((c) => columns.indexOf(c)), [orderedColumns, columns]);
  // Per-column cumulative `left` offset for the pinned ones, in pixels.
  // Uses the user's resized width if present, otherwise a sensible
  // default (140px) — wide enough for short labels without being
  // dramatic for long ones.
  const DEFAULT_COL_PX = 160;
  const colLeftOffsets = useMemo(() => {
    const out = {};
    let acc = 0;
    for (const c of orderedColumns) {
      if (!pinned.has(c)) break;
      out[c] = acc;
      acc += colWidths[c] || DEFAULT_COL_PX;
    }
    return out;
  }, [orderedColumns, pinned, colWidths]);
  // Update the navigation snapshot for moveCell. Uses filteredEntries
  // so search filtering also limits Tab navigation to visible rows.
  useEffect(() => {
    navRef.current.colKeys = visibleColumns;
    navRef.current.dataRowIdxs = filteredEntries
      .filter((e) => Array.isArray(e.row))
      .map((e) => e.origIdx);
  }, [visibleColumns, filteredEntries]);
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
  // Auto-enter target. Set by Tab/Shift-Tab/Enter from the active editor;
  // the matching Cell sees it on its next render and re-enters edit mode
  // automatically. Resolved through navRef so the callback always reads
  // the freshest visible-cell layout (refs survive memoization).
  const [autoEditTarget, setAutoEditTarget] = useState(null);
  const navRef = useRef({ dataRowIdxs: [], colKeys: [] });
  const moveCell = useCallback((fromRowIdx, fromCol, dir) => {
    const { dataRowIdxs, colKeys } = navRef.current;
    const r = dataRowIdxs.indexOf(fromRowIdx);
    const c = colKeys.indexOf(fromCol);
    if (r < 0 || c < 0) return;
    let nr = r, nc = c;
    if (dir === "right") nc = Math.min(colKeys.length - 1, c + 1);
    else if (dir === "left") nc = Math.max(0, c - 1);
    else if (dir === "down") nr = Math.min(dataRowIdxs.length - 1, r + 1);
    else if (dir === "up") nr = Math.max(0, r - 1);
    if (nr === r && nc === c) return;
    setAutoEditTarget({ rowOrigIdx: dataRowIdxs[nr], columnKey: colKeys[nc] });
  }, []);
  const consumeAutoEdit = useCallback(() => setAutoEditTarget(null), []);

  // Multi-select state. Keys are rowIds (caller-domain), so selection
  // survives table re-renders / search filtering. Click a row to select
  // (replace), shift-click to range-select, ctrl/cmd-click to toggle.
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  // Notify the parent when the selection changes. Ref stored to dedupe
  // — only fire when the prop actually changes shape.
  const lastSelectionRef = useRef(null);
  useEffect(() => {
    if (!onSelectionChange) return;
    const arr = [...selectedIds];
    const sig = arr.join("|");
    if (lastSelectionRef.current === sig) return;
    lastSelectionRef.current = sig;
    onSelectionChange(arr);
  }, [selectedIds, onSelectionChange]);
  // Drag state for reorder: dragSrcIds is the set of rowIds being moved
  // (singleton for single-row drag, the whole selection for multi-drag);
  // dropTarget is the hovered row's { rowId, position } where position
  // is "above" | "below". Cleared on dragend.
  const [dragSrcIds, setDragSrcIds] = useState(null);
  const [dropTarget, setDropTarget] = useState(null);
  const lastClickedRowIdRef = useRef(null);

  // Find/Replace state. Replace is only revealed when findReplace prop is on.
  const [replaceText, setReplaceText] = useState("");

  // Per-row context menu state. Click outside or pick an action to close.
  // Rendered via portal so it can spill outside the table's scroll container.
  const [ctxMenu, setCtxMenu] = useState(null);
  // null | { x, y, rowOrigIdx }
  // Whether the user is scrolled far enough down for the "back to top" FAB
  // to be useful. Threshold: 800px past the top of the scroll container.
  const [showScrollTop, setShowScrollTop] = useState(false);

  useEffect(() => {
    if (!ctxMenu) return;
    const close = () => setCtxMenu(null);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    document.addEventListener("mousedown", close);
    return () => {
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
      document.removeEventListener("mousedown", close);
    };
  }, [ctxMenu]);

  // Reset to leftmost only when the dataset *identity* changes — i.e.
  // the row count differs (load / add / delete) OR the search query
  // changed (different filter result). Cell EDITS produce a new `rows`
  // reference too but length stays the same; resetting on every edit
  // snapped the user back to column 1 every time they committed a cell
  // on the right side of a wide table, which is exactly what the user
  // hit in the Units screen on the Turns column.
  const lastResetKeyRef = useRef("");
  useEffect(() => {
    const key = `${rows.length}|${q}`;
    if (key === lastResetKeyRef.current) return;
    lastResetKeyRef.current = key;
    if (scrollRef.current) scrollRef.current.scrollLeft = 0;
  }, [rows, q]);


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
    // Ctrl+D = duplicate selected rows. Only fires when no editor cell
    // currently has focus (the document.activeElement is the scroll
    // container itself or another scroll-bound element).
    if ((e.ctrlKey || e.metaKey) && (e.key === "d" || e.key === "D")) {
      const ae = document.activeElement;
      const aeTag = (ae && ae.tagName) || "";
      const isText = aeTag === "INPUT" || aeTag === "TEXTAREA" || aeTag === "SELECT" || (ae && ae.isContentEditable);
      if (isText) return;
      if (selectedIds.size && bulkActions) {
        const dup = bulkActions.find((b) => /duplicate/i.test(b.label || ""));
        if (dup && dup.onClick) {
          e.preventDefault();
          dup.onClick([...selectedIds]);
          return;
        }
      }
    }
    // Don't hijack the arrows while editing a cell.
    const ae = document.activeElement;
    if (ae && ae !== sc && (ae.tagName === "INPUT" || ae.tagName === "TEXTAREA" || ae.tagName === "SELECT")) return;
    if (e.key === "ArrowLeft")  { sc.scrollLeft -= 80; e.preventDefault(); }
    else if (e.key === "ArrowRight") { sc.scrollLeft += 80; e.preventDefault(); }
    else if (e.key === "Home")       { sc.scrollLeft = 0; e.preventDefault(); }
    else if (e.key === "End")        { sc.scrollLeft = sc.scrollWidth; e.preventDefault(); }
  };

  const showToolbar = searchable || columnsToggleable || onAddRow || findReplace || (bulkActions && bulkActions.length);
  const selectionArr = useMemo(() => [...selectedIds], [selectedIds]);
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
                {q.trim() && matchedCellCount > 0 && (
                  <span style={{ marginLeft: 8, color: "#dca64a" }}>· {matchedCellCount} cell{matchedCellCount === 1 ? "" : "s"} matched</span>
                )}
              </span>
            </>
          )}
          {findReplace && (
            <input
              className="input"
              placeholder="Replace with…"
              value={replaceText}
              onChange={(e) => setReplaceText(e.target.value)}
              style={{ minWidth: 140 }}
              title="Replace all matches of the Search text in visible rows"
            />
          )}
          {findReplace && onReplaceAll && (
            <button
              type="button"
              className="btn"
              disabled={!q.trim()}
              onClick={() => {
                const matchingIds = filteredEntries
                  .filter(en => Array.isArray(en.row))
                  .map(en => rowIds ? rowIds[en.origIdx] : en.origIdx);
                if (!matchingIds.length) return;
                onReplaceAll(matchingIds, q, replaceText);
              }}
              title="Replace the search text with the replacement in all visible rows"
            >Replace all visible</button>
          )}
          {onAddRow && (
            <button
              type="button"
              className="btn"
              onClick={onAddRow}
              title="Append a new blank row at the end"
              style={{ marginLeft: 4 }}
            >
              {addRowLabel}
            </button>
          )}
          {selectionArr.length > 0 && (
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6, marginLeft: 8, padding: "2px 8px", background: "rgba(220,166,74,0.12)", border: "1px solid rgba(220,166,74,0.4)", borderRadius: 12, fontSize: 11, color: "#dca64a" }}>
              {selectionArr.length} selected
              <button
                type="button"
                onClick={() => setSelectedIds(new Set())}
                style={{ background: "none", border: "none", color: "#dca64a", cursor: "pointer", padding: 0, fontSize: 11, textDecoration: "underline" }}
                title="Clear selection"
              >clear</button>
            </span>
          )}
          {selectionArr.length > 0 && bulkActions && bulkActions.map((a, i) => (
            <button
              key={`bulk-${i}`}
              type="button"
              className="btn"
              onClick={() => {
                if (a.setField) {
                  // Open the structured popover instead of window.prompt.
                  setBulkSetState({ onApply: a.setField.onApply, column: visibleColumns[0] || (columns[0] || ""), value: "" });
                } else {
                  a.onClick(selectionArr);
                }
              }}
              title={a.title || a.label}
              style={a.destructive ? { borderColor: "#d66c6c", color: "#d66c6c" } : undefined}
            >{a.label}</button>
          ))}
          {columnsToggleable && (
            <ColumnsPicker
              columns={columns}
              columnLabels={columnLabels}
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
      {bulkSetState && (
        <div style={{ background: "#1c1c1c", border: "1px solid #3a3a3a", borderRadius: 6, padding: 10, marginBottom: 8, display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
          <span style={{ color: "#dca64a", fontSize: 12, fontWeight: 600 }}>
            Set field on {selectionArr.length} selected:
          </span>
          <select
            value={bulkSetState.column}
            onChange={(e) => setBulkSetState({ ...bulkSetState, column: e.target.value })}
            className="input"
            style={{ minWidth: 200 }}
          >
            {columns.map((c) => (
              <option key={c} value={c}>{(columnLabels && columnLabels[c]) || c}</option>
            ))}
          </select>
          <span style={{ color: "#888", fontSize: 11 }}>=</span>
          <input
            className="input"
            placeholder="(blank to clear)"
            value={bulkSetState.value}
            onChange={(e) => setBulkSetState({ ...bulkSetState, value: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === "Escape") setBulkSetState(null);
              else if (e.key === "Enter") {
                bulkSetState.onApply(selectionArr, bulkSetState.column, bulkSetState.value);
                setBulkSetState(null);
              }
            }}
            autoFocus
            style={{ flex: 1, minWidth: 180 }}
          />
          <button
            className="btn btn-accent"
            onClick={() => {
              bulkSetState.onApply(selectionArr, bulkSetState.column, bulkSetState.value);
              setBulkSetState(null);
            }}
          >Apply</button>
          <button className="btn" onClick={() => setBulkSetState(null)}>Cancel</button>
        </div>
      )}
      <div
        className="dtable-scroll"
        style={maxHeight ? { maxHeight, position: "relative" } : { position: "relative" }}
        ref={scrollRef}
        onWheel={onWheel}
        onKeyDown={onKeyDown}
        onScroll={(e) => {
          // Cheap throttling — only update state when crossing the
          // threshold so we don't re-render the table on every wheel tick.
          const past = e.currentTarget.scrollTop > 800;
          if (past !== showScrollTop) setShowScrollTop(past);
        }}
        tabIndex={0}
      >
        <table className="dtable">
          <thead>
            <tr>
              {orderedColumns.map((c) => {
                const label = (columnLabels && columnLabels[c]) || c;
                const isPinned = pinned.has(c);
                const w = colWidths[c];
                const sortIcon = sortBy && sortBy.key === c ? (sortBy.dir === "asc" ? " ▲" : " ▼") : "";
                const style = {};
                if (isPinned) {
                  style.position = "sticky";
                  style.left = colLeftOffsets[c] || 0;
                  style.zIndex = 5;
                  style.background = "var(--bg-elev2)";
                }
                if (w) style.width = w;
                return (
                  <th
                    key={c}
                    title={c + (sortBy && sortBy.key === c ? `\n(sorted ${sortBy.dir})` : "")}
                    style={style}
                    onContextMenu={(e) => { e.preventDefault(); setHeaderMenu({ x: e.clientX, y: e.clientY, columnKey: c }); }}
                    onClick={(e) => {
                      // Plain click on the header cycles sort. Right-click
                      // brings up the full menu (set above).
                      if (e.target.closest('.dtable-resize-handle')) return;
                      setSortBy((cur) => {
                        if (!cur || cur.key !== c) return { key: c, dir: "asc" };
                        if (cur.dir === "asc") return { key: c, dir: "desc" };
                        return null;
                      });
                    }}
                  >
                    {label}{sortIcon}
                    <span className="dtable-caret" aria-hidden="true">▾</span>
                    <span
                      className="dtable-resize-handle"
                      onMouseDown={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        const startX = e.clientX;
                        const th = e.currentTarget.parentElement;
                        const startW = th ? th.getBoundingClientRect().width : (w || DEFAULT_COL_PX);
                        const onMove = (ev) => {
                          const next = Math.max(40, Math.round(startW + (ev.clientX - startX)));
                          setColWidths((cur) => ({ ...cur, [c]: next }));
                        };
                        const onUp = () => {
                          window.removeEventListener("mousemove", onMove);
                          window.removeEventListener("mouseup", onUp);
                        };
                        window.addEventListener("mousemove", onMove);
                        window.addEventListener("mouseup", onUp);
                      }}
                      onClick={(e) => e.stopPropagation()}
                      title="Drag to resize column; double-click to reset"
                      onDoubleClick={(e) => { e.stopPropagation(); setColWidths((cur) => { const n = { ...cur }; delete n[c]; return n; }); }}
                    />
                  </th>
                );
              })}
            </tr>
          </thead>
          {groups.map((g, gi) => (
            <tbody key={`g${gi}`}>
              {g.section && (
                <tr key={`s${g.section.origIdx}`} className="dtable-section">
                  <td colSpan={visibleColumns.length} title={g.section.row.section}>{g.section.row.section}</td>
                </tr>
              )}
              {g.entries.map(({ row, origIdx }) => {
                if (isSeparator(row)) {
                  return (
                    <tr key={`d${origIdx}`} className="dtable-separator" aria-hidden="true">
                      <td colSpan={visibleColumns.length} />
                    </tr>
                  );
                }
                const hasRowOps = onDuplicateRow || onInsertRowBelow || onDeleteRow || (rowMenuExtras && rowMenuExtras.length);
                const rowId = rowIds ? rowIds[origIdx] : origIdx;
                const isSelected = selectedIds.has(rowId);
                // Visual flag for inline validation. Highest severity wins
                // — if a row has both an error and a warn we render the
                // error dot; tooltip carries the message regardless.
                const flag = rowFlags && rowFlags[rowId];
                // Row tint: errors get a faint red wash, warns a faint
                // amber. Selection takes priority — a 30-row bulk-select
                // shouldn't lose its highlight to inline validation.
                let bgStyle;
                if (isSelected) bgStyle = { background: "rgba(220,166,74,0.18)" };
                else if (flag && flag.error) bgStyle = { background: "rgba(214,108,108,0.07)" };
                else if (flag && flag.warn) bgStyle = { background: "rgba(220,166,74,0.06)" };
                // Drop indicator above/below this row when it's the
                // hovered drop target during a drag operation.
                const showDropAbove = dropTarget && dropTarget.rowId === rowId && dropTarget.position === "above";
                const showDropBelow = dropTarget && dropTarget.rowId === rowId && dropTarget.position === "below";
                const isBeingDragged = dragSrcIds && dragSrcIds.has(rowId);
                if (showDropAbove || showDropBelow) {
                  bgStyle = { ...(bgStyle || {}), boxShadow: showDropAbove ? "inset 0 2px 0 #dca64a" : "inset 0 -2px 0 #dca64a" };
                }
                if (isBeingDragged) {
                  bgStyle = { ...(bgStyle || {}), opacity: 0.4 };
                }
                return (
                  <tr
                    key={`r${origIdx}`}
                    style={bgStyle}
                    draggable={!!onMoveRows}
                    onDragStart={onMoveRows ? (e) => {
                      // If the dragged row is part of the current
                      // selection, move the whole selection. Otherwise
                      // move just this row.
                      const ids = (selectedIds.has(rowId) && selectedIds.size > 1)
                        ? new Set(selectedIds)
                        : new Set([rowId]);
                      setDragSrcIds(ids);
                      e.dataTransfer.effectAllowed = "move";
                      try { e.dataTransfer.setData("text/plain", String(rowId)); } catch {}
                    } : undefined}
                    onDragOver={onMoveRows ? (e) => {
                      if (!dragSrcIds) return;
                      e.preventDefault();
                      e.dataTransfer.dropEffect = "move";
                      const r = e.currentTarget.getBoundingClientRect();
                      const position = (e.clientY - r.top) < r.height / 2 ? "above" : "below";
                      setDropTarget((cur) => (cur && cur.rowId === rowId && cur.position === position) ? cur : { rowId, position });
                    } : undefined}
                    onDrop={onMoveRows ? (e) => {
                      e.preventDefault();
                      const src = dragSrcIds;
                      const tgt = dropTarget;
                      setDragSrcIds(null); setDropTarget(null);
                      if (!src || src.size === 0) return;
                      // Don't drop onto self.
                      if (src.has(rowId) && src.size === 1) return;
                      onMoveRows([...src], rowId, tgt ? tgt.position : "below");
                    } : undefined}
                    onDragEnd={onMoveRows ? () => { setDragSrcIds(null); setDropTarget(null); } : undefined}
                    onClick={(e) => {
                      // Selection only fires on modifier-click — plain click
                      // continues to enter cell-edit mode. Without this gate,
                      // every click on a cell would also flip the row's
                      // selected state, fighting the editor.
                      if (!e.ctrlKey && !e.metaKey && !e.shiftKey) return;
                      e.stopPropagation();
                      setSelectedIds(prev => {
                        const next = new Set(prev);
                        if (e.shiftKey && lastClickedRowIdRef.current != null) {
                          // Range-select between last-clicked and this row,
                          // walking the visible filteredEntries sequence.
                          const visibleIds = filteredEntries
                            .filter(en => Array.isArray(en.row))
                            .map(en => rowIds ? rowIds[en.origIdx] : en.origIdx);
                          const a = visibleIds.indexOf(lastClickedRowIdRef.current);
                          const b = visibleIds.indexOf(rowId);
                          if (a >= 0 && b >= 0) {
                            const lo = Math.min(a, b), hi = Math.max(a, b);
                            for (let k = lo; k <= hi; k++) next.add(visibleIds[k]);
                          } else next.add(rowId);
                        } else {
                          if (next.has(rowId)) next.delete(rowId); else next.add(rowId);
                        }
                        lastClickedRowIdRef.current = rowId;
                        return next;
                      });
                    }}
                    onContextMenu={hasRowOps ? (e) => {
                      e.preventDefault();
                      setCtxMenu({ x: e.clientX, y: e.clientY, rowOrigIdx: origIdx });
                    } : undefined}
                  >
                    {orderedColIndices.map((origColIdx, j) => {
                      const c = columns[origColIdx];
                      const autoEnter = !!(autoEditTarget && autoEditTarget.rowOrigIdx === origIdx && autoEditTarget.columnKey === c);
                      const isPinned = pinned.has(c);
                      const cellStyle = {};
                      if (isPinned) {
                        cellStyle.position = "sticky";
                        cellStyle.left = colLeftOffsets[c] || 0;
                        cellStyle.zIndex = 1;
                        cellStyle.background = isSelected ? "rgba(220,166,74,0.18)" : "var(--bg-elev)";
                      }
                      const w = colWidths[c];
                      if (w) cellStyle.width = w;
                      return (
                        <Cell
                          key={c}
                          value={row[origColIdx]}
                          columnKey={c}
                          rowOrigIdx={origIdx}
                          meta={columnMeta && columnMeta[c]}
                          editable={editable}
                          onCommit={commitCell}
                          flag={j === 0 ? flag : null}
                          autoEnter={autoEnter}
                          onAutoEnterConsumed={consumeAutoEdit}
                          onMove={moveCell}
                          stickyStyle={Object.keys(cellStyle).length ? cellStyle : null}
                        />
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          ))}
          {filteredEntries.length === 0 && (
            <tbody>
              <tr><td className="dim" colSpan={visibleColumns.length} style={{ textAlign: "center", padding: 20 }}>No rows.</td></tr>
            </tbody>
          )}
          {hiddenRowCount > 0 && (
            <tbody>
              <tr>
                <td
                  colSpan={visibleColumns.length}
                  ref={(el) => {
                    // IntersectionObserver sentinel — when this row scrolls
                    // into view (or near it via rootMargin), bump the
                    // renderLimit so the next page of rows mounts. Setup
                    // happens via callback ref so the observer is reattached
                    // every render the sentinel is present.
                    if (!el || typeof IntersectionObserver === "undefined") return;
                    if (el.__manipulaObs) return;
                    const io = new IntersectionObserver((entries) => {
                      for (const e of entries) {
                        if (e.isIntersecting) {
                          setRenderLimit((n) => n + ROW_PAGE);
                          io.disconnect();
                          el.__manipulaObs = null;
                          return;
                        }
                      }
                    }, { root: scrollRef.current, rootMargin: "400px" });
                    io.observe(el);
                    el.__manipulaObs = io;
                  }}
                  className="dim"
                  style={{ textAlign: "center", padding: 14, fontStyle: "italic", borderTop: "1px solid rgba(220,166,74,0.2)" }}
                >
                  Loading {Math.min(hiddenRowCount, ROW_PAGE)} more
                  <span style={{ color: "#666" }}> · {filteredEntries.length - hiddenRowCount} of {filteredEntries.length} rendered · </span>
                  <button
                    type="button"
                    onClick={() => setRenderLimit(filteredEntries.length)}
                    style={{ background: "none", border: "none", color: "#dca64a", cursor: "pointer", padding: 0, fontSize: "inherit", textDecoration: "underline", fontStyle: "italic" }}
                  >render all</button>
                </td>
              </tr>
            </tbody>
          )}
        </table>
        {showScrollTop && (
          <button
            type="button"
            onClick={() => { if (scrollRef.current) scrollRef.current.scrollTop = 0; }}
            title="Scroll to top"
            style={{
              position: "sticky", bottom: 14, marginLeft: "auto", marginRight: 14,
              float: "right", clear: "both",
              width: 36, height: 36, borderRadius: 18,
              background: "rgba(28,30,32,0.95)", color: "#dca64a",
              border: "1px solid #3a3a3a", cursor: "pointer", fontSize: 16,
              boxShadow: "0 4px 14px rgba(0,0,0,0.5)", zIndex: 50,
            }}
          >↑</button>
        )}
      </div>
      {ctxMenu && createPortal(
        <div
          data-row-context-menu
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
          style={{
            position: "fixed", left: ctxMenu.x, top: ctxMenu.y,
            background: "#1c1c1c", border: "1px solid #3a3a3a", borderRadius: 6,
            padding: 4, zIndex: 11000, minWidth: 200,
            boxShadow: "0 8px 24px rgba(0,0,0,0.6)",
            fontFamily: "Consolas, monospace", fontSize: 12, color: "#ddd",
          }}
        >
          {onDuplicateRow && (
            <div
              style={{ padding: "6px 12px", cursor: "pointer", borderRadius: 4 }}
              onMouseEnter={(e) => e.currentTarget.style.background = "rgba(220,166,74,0.18)"}
              onMouseLeave={(e) => e.currentTarget.style.background = "transparent"}
              onClick={() => { onDuplicateRow(rowIds ? rowIds[ctxMenu.rowOrigIdx] : ctxMenu.rowOrigIdx); setCtxMenu(null); }}
            >Duplicate row (insert below)</div>
          )}
          {onInsertRowBelow && (
            <div
              style={{ padding: "6px 12px", cursor: "pointer", borderRadius: 4 }}
              onMouseEnter={(e) => e.currentTarget.style.background = "rgba(220,166,74,0.18)"}
              onMouseLeave={(e) => e.currentTarget.style.background = "transparent"}
              onClick={() => { onInsertRowBelow(rowIds ? rowIds[ctxMenu.rowOrigIdx] : ctxMenu.rowOrigIdx); setCtxMenu(null); }}
            >Insert blank row below</div>
          )}
          {rowToJSON && (
            <div
              style={{ padding: "6px 12px", cursor: "pointer", borderRadius: 4, color: "#ddd" }}
              onMouseEnter={(e) => e.currentTarget.style.background = "rgba(220,166,74,0.18)"}
              onMouseLeave={(e) => e.currentTarget.style.background = "transparent"}
              onClick={async () => {
                const rowId = rowIds ? rowIds[ctxMenu.rowOrigIdx] : ctxMenu.rowOrigIdx;
                const obj = rowToJSON(rowId);
                if (obj == null) return;
                try { await navigator.clipboard.writeText(JSON.stringify(obj, null, 2)); } catch {}
                setCtxMenu(null);
                if (typeof window !== "undefined" && window.toast) window.toast("Row JSON copied to clipboard", "ok", 2000);
              }}
            >Copy row as JSON</div>
          )}
          {onPasteRow && (
            <div
              style={{ padding: "6px 12px", cursor: "pointer", borderRadius: 4, color: "#ddd" }}
              onMouseEnter={(e) => e.currentTarget.style.background = "rgba(220,166,74,0.18)"}
              onMouseLeave={(e) => e.currentTarget.style.background = "transparent"}
              onClick={async () => {
                const rowId = rowIds ? rowIds[ctxMenu.rowOrigIdx] : ctxMenu.rowOrigIdx;
                setCtxMenu(null);
                let txt = "";
                try { txt = await navigator.clipboard.readText(); } catch {}
                if (!txt || !txt.trim()) {
                  if (window.toast) window.toast("Clipboard is empty.", "warn", 2500);
                  return;
                }
                let parsed;
                try { parsed = JSON.parse(txt); }
                catch (e) {
                  if (window.toast) window.toast("Clipboard isn't valid JSON: " + e.message, "error");
                  return;
                }
                onPasteRow(rowId, parsed);
                if (window.toast) window.toast("Row updated from clipboard JSON.", "ok", 2500);
              }}
            >Paste row from JSON</div>
          )}
          {rowMenuExtras && rowMenuExtras.map((item, i) => (
            <div
              key={`extra-${i}`}
              style={{ padding: "6px 12px", cursor: "pointer", borderRadius: 4, color: item.destructive ? "#d66c6c" : "#ddd" }}
              onMouseEnter={(e) => e.currentTarget.style.background = item.destructive ? "rgba(214,108,108,0.18)" : "rgba(220,166,74,0.18)"}
              onMouseLeave={(e) => e.currentTarget.style.background = "transparent"}
              onClick={() => { item.onClick(rowIds ? rowIds[ctxMenu.rowOrigIdx] : ctxMenu.rowOrigIdx); setCtxMenu(null); }}
            >{item.label}</div>
          ))}
          {onDeleteRow && (
            <div
              style={{ padding: "6px 12px", cursor: "pointer", borderRadius: 4, color: "#d66c6c" }}
              onMouseEnter={(e) => e.currentTarget.style.background = "rgba(214,108,108,0.18)"}
              onMouseLeave={(e) => e.currentTarget.style.background = "transparent"}
              onClick={() => {
                if (window.confirm("Delete this row?")) onDeleteRow(rowIds ? rowIds[ctxMenu.rowOrigIdx] : ctxMenu.rowOrigIdx);
                setCtxMenu(null);
              }}
            >Delete row</div>
          )}
        </div>,
        document.body
      )}
      {headerMenu && createPortal(
        <div
          onClick={(e) => e.stopPropagation()}
          style={{
            position: "fixed", left: headerMenu.x, top: headerMenu.y,
            zIndex: 11000, background: "rgba(28,30,32,0.98)",
            border: "1px solid rgba(220,166,74,0.3)", borderRadius: 6,
            padding: 4, fontSize: 12, color: "#ddd", boxShadow: "0 8px 24px rgba(0,0,0,0.6)", minWidth: 200,
          }}
        >
          <div style={{ padding: "5px 10px", color: "#dca64a", fontWeight: 700, borderBottom: "1px solid rgba(255,255,255,0.06)", marginBottom: 4 }}>
            {(columnLabels && columnLabels[headerMenu.columnKey]) || headerMenu.columnKey}
          </div>
          {[
            { label: "Sort A → Z",         onClick: () => setSortBy({ key: headerMenu.columnKey, dir: "asc" }) },
            { label: "Sort Z → A",         onClick: () => setSortBy({ key: headerMenu.columnKey, dir: "desc" }) },
            { label: "Reset sort",         onClick: () => setSortBy(null) },
            { label: pinned.has(headerMenu.columnKey) ? "Unpin column" : "Pin to left", onClick: () => setPinned((cur) => { const n = new Set(cur); if (n.has(headerMenu.columnKey)) n.delete(headerMenu.columnKey); else n.add(headerMenu.columnKey); return n; }) },
            (colWidths[headerMenu.columnKey] != null) ? { label: "Reset width", onClick: () => setColWidths((cur) => { const n = { ...cur }; delete n[headerMenu.columnKey]; return n; }) } : null,
            columnsToggleable ? { label: "Hide column", onClick: () => setHiddenCols((cur) => { const n = new Set(cur); n.add(headerMenu.columnKey); return n; }) } : null,
          ].filter(Boolean).map((it, i) => (
            <div
              key={i}
              onClick={() => { it.onClick(); setHeaderMenu(null); }}
              style={{ padding: "5px 10px", cursor: "pointer", borderRadius: 3 }}
              onMouseEnter={(e) => e.currentTarget.style.background = "rgba(220,166,74,0.10)"}
              onMouseLeave={(e) => e.currentTarget.style.background = "transparent"}
            >{it.label}</div>
          ))}
        </div>,
        document.body
      )}
    </div>
  );
}

// Columns picker — small toolbar button + portal popover with a checkbox per
// column. Renders via createPortal so the popover can spill outside the
// table's scroll container without being clipped (same trick as the combobox).
function ColumnsPicker({ columns, columnLabels, hiddenCols, hiddenCount, pinFirstColumn, open, onOpenChange, onToggle, onShowAll, onHideAll }) {
  const btnRef = useRef(null);
  const popRef = useRef(null);
  const [pos, setPos] = useState(null);
  // Search-within-columns. Tables with 50+ columns ("Engine Pri Proj"
  // among Units' lot) made finding a specific column a scroll job;
  // typing to filter narrows the list in place.
  const [pickerQ, setPickerQ] = useState("");

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
          <input
            type="text"
            value={pickerQ}
            onChange={(e) => setPickerQ(e.target.value)}
            placeholder="search columns…"
            autoFocus
            style={{ background: "#0e0e0e", color: "#ddd", border: "1px solid #3a3a3a", borderRadius: 4, padding: "4px 8px", margin: "4px 8px 0", fontFamily: "Consolas, monospace", fontSize: 11, outline: "none" }}
          />
          <div className="dtable-cols-list">
            {columns.map((c, i) => {
              const isPinned = pinFirstColumn && i === 0;
              const checked = !hiddenCols.has(c);
              const label = (columnLabels && columnLabels[c]) || c;
              const q = pickerQ.trim().toLowerCase();
              if (q && !label.toLowerCase().includes(q) && !c.toLowerCase().includes(q)) return null;
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
                  <span>{label}</span>
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
const Cell = React.memo(function Cell({ value, columnKey, rowOrigIdx, meta, editable, onCommit, flag, autoEnter, onAutoEnterConsumed, onMove, stickyStyle }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  // Ref alongside state so commit() reads the latest typed/picked value even
  // when the editor calls onChange + onCommit in the same tick (combobox
  // option-click does this — without the ref, setDraft hasn't flushed before
  // commit captures `draft`, and commit gets the stale prior value).
  const draftRef = useRef("");
  const touchedRef = useRef(false);
  const text = value != null ? String(value) : "";
  const startEdit = (e) => {
    // Modifier-click is row selection (handled at the tr level); skip
    // entering edit mode in that case so the user's shift/ctrl-click
    // toggles selection without also opening an editor.
    if (e && (e.ctrlKey || e.metaKey || e.shiftKey)) return;
    if (!editable) return;
    const isCombo = meta && meta.type === "select";
    const initial = isCombo ? "" : text;
    setDraft(initial);
    draftRef.current = initial;
    touchedRef.current = false;
    setEditing(true);
  };
  // Auto-enter edit mode when the parent flagged this cell as the
  // navigation target (Tab/Shift-Tab/Enter from a sibling cell).
  useEffect(() => {
    if (autoEnter && editable && !editing) {
      const isCombo = meta && meta.type === "select";
      const initial = isCombo ? "" : text;
      setDraft(initial);
      draftRef.current = initial;
      touchedRef.current = false;
      setEditing(true);
      onAutoEnterConsumed && onAutoEnterConsumed();
    }
  }, [autoEnter]);   // intentionally narrow deps — only fire on the pulse
  const commit = () => {
    if (!editing) return;
    setEditing(false);
    if (!touchedRef.current) return;
    const final = draftRef.current;
    if (final !== text) onCommit(rowOrigIdx, columnKey, final);
  };
  const cancel = () => setEditing(false);
  const onDraftChange = (v) => { touchedRef.current = true; draftRef.current = v; setDraft(v); };
  // Flag dot — small coloured circle in the leftmost cell of any row
  // that has an error / warn / info / recruit-line linkage. Severity
  // tiers stack: error red > warn amber > info blue > linkage gold.
  // Tooltip combines whichever ones are populated so a single hover
  // shows everything the user might need (validation msg + recruit
  // link summary + import diff status).
  let flagColor = null;
  let flagTitle = "";
  if (flag) {
    if (flag.error)         { flagColor = "#d66c6c"; flagTitle = flag.error; }
    else if (flag.warn)     { flagColor = "#dca64a"; flagTitle = flag.warn; }
    else if (flag.info)     { flagColor = "#4f8fd6"; flagTitle = flag.info; }
    else if (flag.recruitNote) { flagColor = "#7c9"; flagTitle = ""; }
    else if (flag.blame)    { flagColor = "#888"; flagTitle = ""; }
    if (flag.recruitNote)   flagTitle = (flagTitle ? flagTitle + "\n\n" : "") + flag.recruitNote;
    // Blame line goes last in the tooltip so the validation message
    // (the most actionable info) is visible first.
    if (flag.blame)         flagTitle = (flagTitle ? flagTitle + "\n\n" : "") + "Last edit: " + flag.blame;
  }
  const flagDot = flagColor ? (
    <span
      title={flagTitle}
      style={{
        display: "inline-block", width: 7, height: 7, borderRadius: 4,
        background: flagColor,
        marginRight: 6, verticalAlign: "middle",
      }}
    />
  ) : null;
  // Render the read-state value INSIDE every cell at all times, even while
  // editing. Editor floats absolutely over it. Two reasons:
  //   1. Column width is set by table-auto layout based on each cell's
  //      content. When the editor was rendered alone the cell briefly
  //      reported the editor's intrinsic width (different from the text)
  //      and the column shifted on every open/close. Keeping the text in
  //      the flow (visibility:hidden) freezes the column at its read-state
  //      width.
  //   2. Empty rows had zero-height cells — nothing inside them. nbsp
  //      placeholder gives the row a baseline line-height so a freshly
  //      inserted blank row is the same height as the populated rows
  //      around it.
  const display = renderCell(value);
  const placeholderText = display === "" ? " " : display;
  return (
    <td
      title={flagTitle || text}
      className={editable ? "dtable-editable" : ""}
      style={{ position: stickyStyle ? "sticky" : "relative", ...(stickyStyle || {}) }}
      onClick={startEdit}
    >
      <span
        className="dtable-cell-text"
        style={{
          visibility: editing ? "hidden" : "visible",
          display: "inline-block",
          whiteSpace: "nowrap",
          maxWidth: "100%",
          overflow: "hidden",
          textOverflow: "ellipsis",
          verticalAlign: "middle",
        }}
      >
        {flagDot}{placeholderText}
      </span>
      {editing && (
        <span
          className="dtable-cell-edit-overlay"
          onClick={(e) => e.stopPropagation()}
          style={{
            position: "absolute",
            top: 0,
            bottom: 0,
            left: 4,
            right: 4,
            display: "flex",
            alignItems: "stretch",
          }}
        >
          <CellEditor
            value={draft}
            placeholder={text}
            meta={meta}
            onChange={onDraftChange}
            onCommit={commit}
            onCancel={cancel}
            onMove={(dir) => onMove && onMove(rowOrigIdx, columnKey, dir)}
          />
        </span>
      )}
    </td>
  );
}, (prev, next) => {
  // Re-render only when something visible changes. editable/meta refs are
  // stable across DataTable renders, so this collapses click-elsewhere into a
  // no-op for unaffected cells. autoEnter must be in the equality check
  // so the navigation pulse actually wakes the target cell up.
  return prev.value === next.value
      && prev.columnKey === next.columnKey
      && prev.rowOrigIdx === next.rowOrigIdx
      && prev.meta === next.meta
      && prev.editable === next.editable
      && prev.onCommit === next.onCommit
      && prev.flag === next.flag
      && prev.autoEnter === next.autoEnter
      && prev.onAutoEnterConsumed === next.onAutoEnterConsumed
      && prev.onMove === next.onMove
      && prev.stickyStyle === next.stickyStyle;
});

function CellEditor({ value, placeholder = "", meta, onChange, onCommit, onCancel, onMove }) {
  const ref = useRef(null);
  // Auto-focus + select-all so the user can immediately type to filter or
  // overwrite.
  useEffect(() => {
    if (!ref.current) return;
    ref.current.focus();
    if (ref.current.select) { try { ref.current.select(); } catch {} }
  }, []);
  const onKeyDown = (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      onCommit();
      onMove && onMove("down");
    } else if (e.key === "Escape") {
      e.preventDefault();
      onCancel();
    } else if (e.key === "Tab") {
      // Commit + move horizontally. preventDefault so focus doesn't
      // jump to the next browser-tab-stop instead of our cell.
      e.preventDefault();
      onCommit();
      onMove && onMove(e.shiftKey ? "left" : "right");
    }
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
        onMove={onMove}
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
function ComboboxEditor({ value, placeholder, options, onChange, onCommit, onCancel, onMove }) {
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
      onMove && onMove("down");
    } else if (e.key === "Escape") {
      e.preventDefault();
      onCancel();
    } else if (e.key === "Tab") {
      e.preventDefault();
      onCommit();
      onMove && onMove(e.shiftKey ? "left" : "right");
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
          // The popover is rendered via createPortal into document.body, but
          // React's synthetic events bubble through the *virtual* DOM tree,
          // not the real one — so a click here propagates back up to the
          // <td onClick={startEdit}> that opened it. That second startEdit
          // ran *after* onDraftChange had set touchedRef to true, blanking
          // it back to false and clobbering draftRef with "" before the
          // deferred commit could fire — which produced the "edit reverts
          // back to original value" symptom. Stop the click so it doesn't
          // bubble out of the popover.
          onClick={(e) => e.stopPropagation()}
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
