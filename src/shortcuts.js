// shortcuts.js — central keymap registry. The same definitions drive
// the runtime handlers AND the `?` cheatsheet overlay, so they can't
// drift apart.
//
// Each entry: { keys, label, group, when?: (ctx) => boolean }
//   keys  — display string ("Ctrl+S", "?", "Ctrl+1…7")
//   label — what it does in plain English
//   group — heading in the overlay
//   when  — optional context predicate ("only when X tab is active")
export const SHORTCUTS = [
  // Global
  { keys: "Ctrl+S",       label: "Save project",                            group: "Global" },
  { keys: "Ctrl+F",       label: "Focus the Find unit search",              group: "Global" },
  { keys: "?",            label: "Show this cheatsheet",                    group: "Global" },
  { keys: "Esc",          label: "Close popovers / clear search",           group: "Global" },
  { keys: "Ctrl+1",       label: "Editor tab",                              group: "Global" },
  { keys: "Ctrl+2",       label: "Validation tab",                          group: "Global" },
  { keys: "Ctrl+3",       label: "All units (preview)",                     group: "Global" },
  { keys: "Ctrl+4",       label: "EDU Builder",                             group: "Global" },
  // EDB sidebar
  { keys: "/",            label: "Focus sidebar search",                    group: "EDB sidebar" },
  { keys: "J / K",        label: "Next / previous unit",                    group: "EDB sidebar" },
  { keys: "Drag",         label: "Reorder unit cards (manual sort)",        group: "EDB sidebar" },
  { keys: "Right-click",  label: "Context menu (insert above/below…)",      group: "EDB sidebar" },
  // EDU tables — cell selection
  { keys: "Click",        label: "Select a cell",                           group: "EDU tables · cells" },
  { keys: "Double-click", label: "Edit a cell",                             group: "EDU tables · cells" },
  { keys: "Click + drag", label: "Select a rectangular range of cells",     group: "EDU tables · cells" },
  { keys: "Shift+Click",  label: "Extend the cell selection to here",       group: "EDU tables · cells" },
  { keys: "Ctrl+C",       label: "Copy selected cells (TSV — paste into Excel)", group: "EDU tables · cells" },
  { keys: "Ctrl+V",       label: "Fill selected cells (one value → all; grid maps in)", group: "EDU tables · cells" },
  { keys: "Tab / Shift+Tab", label: "Move to next / previous cell (while editing)", group: "EDU tables · cells" },
  { keys: "Enter",        label: "Commit cell + jump down one row",         group: "EDU tables · cells" },
  { keys: "Esc",          label: "Cancel cell edit",                        group: "EDU tables · cells" },
  { keys: "↑ / ↓ in number cell", label: "Increment / decrement value",     group: "EDU tables · cells" },
  // EDU tables — rows
  { keys: "Click row number", label: "Select the whole row (gutter on the left)", group: "EDU tables · rows" },
  { keys: "Ctrl+Click row #", label: "Add / remove a row from the selection", group: "EDU tables · rows" },
  { keys: "Shift+Click row #", label: "Select a range of rows",             group: "EDU tables · rows" },
  { keys: "Ctrl+C (rows)", label: "Copy selected rows (dashed = on clipboard)", group: "EDU tables · rows" },
  { keys: "Ctrl+V (rows)", label: "Overwrite selected rows / paste new rows if none selected", group: "EDU tables · rows" },
  { keys: "Ctrl+D",       label: "Duplicate selected row(s)",               group: "EDU tables · rows" },
  { keys: "Drag row number", label: "Reorder rows (or Shift+drag anywhere)", group: "EDU tables · rows" },
  { keys: "+ New row",    label: "Append a row and open its first cell",     group: "EDU tables · rows" },
  // EDU tables — misc
  { keys: "Ctrl+Z / Ctrl+Y", label: "Undo / redo (EDU project)",            group: "EDU tables · misc" },
  { keys: "Right-click row", label: "Row menu (copy / paste / move / insert)", group: "EDU tables · misc" },
  { keys: "Right-click header", label: "Column menu (sort, hide, pin, copy column)", group: "EDU tables · misc" },
];
