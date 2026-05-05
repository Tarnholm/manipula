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
  // EDU tables
  { keys: "Click",        label: "Edit cell",                               group: "EDU tables" },
  { keys: "Tab / Shift+Tab", label: "Move to next / previous cell",         group: "EDU tables" },
  { keys: "Enter",        label: "Commit cell + jump down one row",         group: "EDU tables" },
  { keys: "Esc",          label: "Cancel cell edit",                        group: "EDU tables" },
  { keys: "Ctrl+D",       label: "Duplicate selected row(s)",               group: "EDU tables" },
  { keys: "Ctrl+Z / Ctrl+Y", label: "Undo / redo (EDU project)",            group: "EDU tables" },
  { keys: "↑ / ↓ in number cell", label: "Increment / decrement value",     group: "EDU tables" },
  { keys: "Drag row",     label: "Reorder rows; multi-select to drag groups", group: "EDU tables" },
  { keys: "Right-click row", label: "Row menu (Move up/down, Insert above…)", group: "EDU tables" },
  { keys: "Right-click header", label: "Column menu (sort, hide, pin)",     group: "EDU tables" },
];
