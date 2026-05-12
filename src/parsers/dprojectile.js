// Parse descr_projectile_new.txt — the missile/projectile definitions.
//
//   projectile javelin
//
//       damage    0
//       radius    0
//       velocity  30
//       ...
//       model     data/models_missile/weapon_javelin_high.cas, 40
//       model     data/models_missile/weapon_javelin_low.cas,  max
//
// EDU's `pri missile type` and `sec missile type` columns reference the
// projectile name (the X in `projectile X`). Each block can declare
// multiple `model <path>, <distance>` lines (LOD variants) — we keep
// every path so the asset-existence check covers them all.
//
// Returns:
//   types         — Set<projectileName>
//   modelPaths    — Array<{ type, path }> for each model line
export function parseDescrProjectile(text) {
  const types = new Set();
  const modelPaths = [];
  if (typeof text !== "string" || !text) return { types, modelPaths };
  let currentType = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/;.*$/, "").trim();
    if (!line) continue;
    const tm = line.match(/^projectile\s+(\S+)/i);
    if (tm) { currentType = tm[1]; types.add(currentType); continue; }
    const mm = line.match(/^model\s+([^,\s]+(?:\s[^,]*)?)\s*,/i);
    if (mm && currentType) {
      modelPaths.push({ type: currentType, path: mm[1].trim() });
    }
  }
  return { types, modelPaths };
}
