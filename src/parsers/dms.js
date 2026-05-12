// Parse descr_model_strat.txt — the strat-map character models
// (spies, assassins, diplomats, generals, captains, etc.).
//
// DMS has TWO line shapes for model refs that we care about:
//
// 1. Bare-path form (old style — most spy/assassin/diplomat blocks):
//      no_variation model armenia, African data/characters/strat_ris_spy_armenia_1e_no_variation
//      model russia, Caucasian data/characters/strat_ris_spy_armenia_1e_no_variation
//    The path here does NOT include `.cas` or `_lodN` — the game
//    implicitly resolves it to `_lod0.cas`..`_lod3.cas`. The caller
//    LOD-expands these into the orphan-diff set.
//
// 2. DMB-style form (used by `sm_…_general` / `sm_…_captain` blocks):
//      type sm_anatolian_lesser_general
//      pbr_texture     data/characters/textures/ris/strat/pbr/strat_captain_anatolian_pbr.tga
//      texture         data/characters/textures/ris/strat/strat_captain_anatolian_aor.tga
//      texture cilicians, data/characters/textures/ris/strat/strat_captain_anatolian_cilicians.tga
//      model_flexi_m   data/characters/strat_captain_anatolian_lod0.cas, 15
//      model_flexi     data/characters/strat_captain_anatolian_lod1.cas, max
//      no_variation model_flexi_m  data/characters/strat_captain_anatolian_lod0.cas, 15
//    These are fully-qualified paths (with .cas + _lodN), structurally
//    identical to DMB's model_flexi / pbr_texture lines. They were
//    previously invisible to the orphan audit, which is why every
//    `strat_captain_*_lodN.cas` and its textures false-flagged as orphan.
//
// Returns:
//   • types       — Set of `type X` block names.
//   • modelPaths  — bare-path list (form 1) — caller LOD-expands.
//   • flexiModels — array of { type, path } from `model_flexi[_m]`
//                   lines (form 2) — fully qualified, no LOD expansion.
//   • textures    — array of { type, path } from `pbr_texture` /
//                   `texture` lines in sm_ blocks (form 2).
export function parseDMS(text) {
  const types = new Set();
  const modelPaths = [];
  const flexiModels = [];
  const textures = [];
  if (typeof text !== "string" || !text) return { types, modelPaths, flexiModels, textures };
  let currentType = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/;.*$/, "").trim();
    if (!line) continue;
    const tm = line.match(/^type\s+(\S+)/i);
    if (tm) { currentType = tm[1]; types.add(currentType); continue; }
    const stripped = line.replace(/^no_variation\s+/i, "");
    let m;
    // Form 2: DMB-style texture lines. Faction-key is optional.
    if ((m = stripped.match(/^(?:pbr_)?texture\s+(?:\S+\s*,\s*)?([^,]+?)\s*$/i))) {
      textures.push({ type: currentType, path: m[1].trim() });
      continue;
    }
    // Form 2: DMB-style model_flexi lines.
    if ((m = stripped.match(/^model_flexi(?:_m)?\s+([^,]+?)\s*,/i))) {
      flexiModels.push({ type: currentType, path: m[1].trim() });
      continue;
    }
    // Form 1: bare-path forms — with or without leading `model` keyword.
    const m1 =
      line.match(/^(?:no_variation\s+)?model\s+\S+\s*,\s*\S+\s+(data\/\S+)/i) ||
      line.match(/^(?:no_variation\s+)?\S+\s*,\s*\S+\s+(data\/\S+)/i);
    if (m1) modelPaths.push(m1[1].trim());
  }
  return { types, modelPaths, flexiModels, textures };
}
