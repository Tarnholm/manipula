// Parse descr_engines.txt — siege-engine and ladder definitions.
//
// Each `type X` block declares an engine type referenced by EDU's
// `engine` column (e.g. EDU `engine lithobolos` → descr_engines
// `type lithobolos`). The block has several model + projectile refs:
//
//   type        lithobolos
//   class       onager
//   projectile  boulder                     ← descr_projectile_new ref
//   engine_collision data/models_engine/lithobolos.cas
//   engine_outline   data/models_engine/lithobolos.cas
//   engine_model     data/models_engine/lithobolos.cas, 20.0
//   engine_model     data/models_engine/lithobolos.cas, max
//   engine_platforms data/models_engine/foo.cas         ← optional (or 'none')
//   missile_model    data/models_engine/Big_Boulder_high.CAS, 20.0
//   ...
//
// Returns:
//   types          — Set<typeName>
//   projectileByType — Map<typeName, projectileName>
//   modelPaths     — Array<{ type, path, kind }> where kind is one of
//                    'collision' | 'outline' | 'engine_model' |
//                    'engine_platforms' | 'missile_model'
export function parseDescrEngine(text) {
  const types = new Set();
  const projectileByType = new Map();
  const modelPaths = [];
  if (typeof text !== "string" || !text) return { types, projectileByType, modelPaths };
  let currentType = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/;.*$/, "").trim();
    if (!line) continue;
    const tm = line.match(/^type\s+(\S+)/i);
    if (tm) { currentType = tm[1]; types.add(currentType); continue; }
    if (!currentType) continue;
    const pj = line.match(/^projectile\s+(\S+)/i);
    if (pj) { projectileByType.set(currentType, pj[1]); continue; }
    // Each of the four model-bearing lines: take the first comma-separated
    // path field. 'engine_platforms none' has 'none' literal — skip.
    const match = (kind, prefix) => {
      const m = line.match(new RegExp("^" + prefix + "\\s+([^,\\s]+(?:\\s[^,]*?)?)\\s*(?:,|$)", "i"));
      if (m) {
        const p = m[1].trim();
        if (p && p.toLowerCase() !== "none") modelPaths.push({ type: currentType, path: p, kind });
      }
    };
    match("collision", "engine_collision");
    match("outline", "engine_outline");
    match("engine_model", "engine_model");
    match("engine_platforms", "engine_platforms");
    match("missile_model", "missile_model");
  }
  return { types, projectileByType, modelPaths };
}
