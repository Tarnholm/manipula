// Parse descr_sm_major_events.txt → [{ id, affects: [...factions], global: bool, hasUnitSwitches: bool }]
// The text-block grammar is "<id>": { ... }
export function parseReforms(text, eventScriptFiles = []) {
  const lines = text.split(/\r?\n/);
  const out = [];
  let cur = null;
  let depth = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const opens = (line.match(/\{/g) || []).length;
    const closes = (line.match(/\}/g) || []).length;
    if (depth === 0) {
      const m = line.match(/^\s*"([A-Za-z_][A-Za-z0-9_]*)"\s*:\s*(;.*)?$/);
      if (m && (i + 1 < lines.length) && /^\s*\{/.test(lines[i + 1])) {
        if (m[1] !== "major events") {
          cur = { id: m[1], affects: [], global: false, hasUnitSwitches: false };
          out.push(cur);
        }
      }
    }
    if (cur) {
      const a = line.match(/"affects"\s*:\s*\[([^\]]*)\]/);
      if (a) cur.affects = a[1].split(",").map(s => s.replace(/"/g, "").trim()).filter(Boolean);
      if (/"global"\s*:\s*true/.test(line)) cur.global = true;
      if (/"unit switches"/.test(line)) cur.hasUnitSwitches = true;
    }
    depth += opens - closes;
    if (depth < 0) depth = 0;
  }
  // Also expose the raw script file list (handy for the UI's "available reforms" picker).
  return { reforms: out, scriptFiles: eventScriptFiles };
}
