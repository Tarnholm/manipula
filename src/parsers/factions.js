// Parse descr_sm_factions.txt → [{ id, culture, religion }]
// Format: each top-level "<faction_id>": { ... "culture": "x", ... }
export function parseFactions(text) {
  const out = [];
  const lines = text.split(/\r?\n/);
  // Top-level faction keys are at indent 1 tab (e.g. `\t"romans_julii":`).
  // Inside the block, find culture and default religion.
  let cur = null;
  let depth = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Track braces to know nesting
    const opens = (line.match(/\{/g) || []).length;
    const closes = (line.match(/\}/g) || []).length;

    // Detect a faction key: a line like `\t"<id>":` not nested inside something else.
    // We trigger on the line whose immediate next non-blank is `{` and we're at depth 0.
    if (depth === 0) {
      const m = line.match(/^\s*"([a-z_][a-z0-9_]*)"\s*:\s*(;.*)?$/);
      if (m && (i + 1 < lines.length) && /^\s*\{/.test(lines[i + 1])) {
        // Skip the meta key "factions" itself
        if (m[1] !== "factions" && m[1] !== "resources" && m[1] !== "hidden_resources") {
          cur = { id: m[1], culture: null, religion: null };
          out.push(cur);
        }
      }
    }

    if (cur) {
      const c = line.match(/"culture"\s*:\s*"([^"]+)"/);
      if (c) cur.culture = c[1];
      const r = line.match(/"default religion"\s*:\s*"([^"]+)"/);
      if (r) cur.religion = r[1];
    }

    depth += opens - closes;
    if (depth < 0) depth = 0;
  }
  return out;
}
