// Parse descr_sm_resources.txt → { resources: [{id,subtype,tier}], hiddenResources: [{id}] }
// Each resource block: `\t"<id>":\n\t{\n\t\t"subtype": "...", ...\n\t}`
export function parseResources(text) {
  const lines = text.split(/\r?\n/);
  const all = [];
  let cur = null;
  let depth = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const opens = (line.match(/\{/g) || []).length;
    const closes = (line.match(/\}/g) || []).length;

    // top-level key (depth 0 → 1 transition)
    if (depth === 0) {
      const m = line.match(/^\s*"([A-Za-z_][A-Za-z0-9_-]*)"\s*:\s*(;.*)?$/);
      if (m && (i + 1 < lines.length) && /^\s*\{/.test(lines[i + 1])) {
        if (m[1] !== "resources") {
          cur = { id: m[1], subtype: "none", tier: null };
          all.push(cur);
        }
      }
    }

    if (cur) {
      const s = line.match(/"subtype"\s*:\s*"([^"]+)"/);
      if (s) cur.subtype = s[1];
      const t = line.match(/"tier"\s*:\s*(\d+)/);
      if (t) cur.tier = parseInt(t[1], 10);
    }

    depth += opens - closes;
    if (depth < 0) depth = 0;
  }

  return {
    resources: all.filter(r => r.subtype !== "hidden"),
    hiddenResources: all.filter(r => r.subtype === "hidden"),
  };
}
