// Parse descr_model_strat.txt — the strat-map character models
// (spies, assassins, diplomats, generals, captains, etc.).
//
// DMS lines look like:
//   strat_ris_spy_armenia_1d_no_variation                  ← block header (`type`)
//   no_variation model armenia, African data/characters/strat_ris_spy_armenia_1e_no_variation
//   model russia, Caucasian data/characters/strat_ris_spy_armenia_1e_no_variation
//
// Critically, the `data/...` path on those model lines does NOT include the
// `_lodN.cas` suffix — DMS implicitly expands each path into the on-disk
// LOD-variant files (`_lod0.cas`, `_lod1.cas`, etc). The orphan-asset
// audit needs to know about both the bare paths AND the expanded LOD
// variants, otherwise every strat-character LOD file false-flags as
// "no DMB reference, candidate for deletion" when DMS does reference it.
//
// Returns { types, modelPaths } — types is the Set of `type X` block
// names (currently unused but cheap to extract; useful if we want a
// dms-orphan-type check later), modelPaths is the bare-path list.
export function parseDMS(text) {
  const types = new Set();
  const modelPaths = [];
  if (typeof text !== "string" || !text) return { types, modelPaths };
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/;.*$/, "").trim();
    if (!line) continue;
    const tm = line.match(/^type\s+(\S+)/i);
    if (tm) { types.add(tm[1]); continue; }
    // `[no_variation ]model <faction>, <ethnicity> data/...`
    // Some entries omit the leading `model` keyword and use the column
    // form directly — accept both shapes.
    const m =
      line.match(/^(?:no_variation\s+)?model\s+\S+\s*,\s*\S+\s+(data\/\S+)/i) ||
      line.match(/^(?:no_variation\s+)?\S+\s*,\s*\S+\s+(data\/\S+)/i);
    if (m) modelPaths.push(m[1].trim());
  }
  return { types, modelPaths };
}
