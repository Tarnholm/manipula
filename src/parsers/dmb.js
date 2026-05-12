// Parse descr_model_battle.txt
//
// Each block starts with `type <model_id>` and lists asset references:
//   skeleton    fs_dagger
//   pbr_texture pergamon, data/characters/textures/.../crew_pergamon.tga
//   texture     pergamon, data/characters/textures/.../crew_pergamon.tga
//   model_flexi    data/characters/crew_high_lod1.cas, 30
//   model_flexi_m  data/characters/crew_high_lod0.cas, 15
//   no_variation model_flexi  data/.../foo.cas, 30   (optional prefix)
//
// There is *also* a bare-model form (rare, used in some legacy RIS
// blocks like `type light_infantry_longshield`):
//   model African           data/characters/light_spear_infantry_pontus
//   model parni, African    data/characters/light_spear_infantry_parni
//   no_variation model African    data/characters/light_spear_infantry_pontus
// The path here has NO `.cas` suffix and NO `_lodN` suffix — the game
// implicitly resolves it to `_lod0.cas`..`_lod3.cas` on disk, the same
// way DMS does. Caller must LOD-expand bareModels before doing orphan
// diffs against on-disk filenames.
//
// We surface four things the validator can use:
//   • types       — Set of declared model ids ("type X" blocks).
//   • textures    — array of { type, path } — every texture /
//                   pbr_texture line, regardless of faction key.
//   • models      — array of { type, path } — every model_flexi / _m
//                   line (path already includes .cas + _lodN).
//   • bareModels  — array of { type, path } — bare `model X path` form,
//                   path lacks .cas and _lodN suffixes.
//
// The path strings are stored as written. Mod data conventionally uses
// `data/...` paths relative to the mod root; the existence checker
// resolves them by stripping the leading `data/` and prepending the
// configured mod data dir.

export function parseDMB(text) {
  const types = new Set();
  const textures = [];
  const models = [];
  const bareModels = [];
  if (typeof text !== "string" || !text) return { types, textures, models, bareModels };
  let currentType = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/;.*$/, "").trim();
    if (!line) continue;
    const tm = line.match(/^type\s+(\S+)/i);
    if (tm) { currentType = tm[1]; types.add(currentType); continue; }
    const stripped = line.replace(/^no_variation\s+/i, "");
    let m;
    if ((m = stripped.match(/^(?:pbr_)?texture\s+(?:\S+\s*,\s*)?([^,]+?)\s*$/i))) {
      textures.push({ type: currentType, path: m[1].trim() });
      continue;
    }
    if ((m = stripped.match(/^model_flexi(?:_m)?\s+([^,]+?)\s*,/i))) {
      models.push({ type: currentType, path: m[1].trim() });
      continue;
    }
    // Bare-model form: `model <faction-or-culture-list> <path>` where
    // path starts with `data/` and lacks `.cas`/`_lodN`. The `\s+` after
    // `model` excludes `model_flexi*` (which has `_`, not whitespace,
    // after `model`).
    if ((m = stripped.match(/^model\s+[^\n]+?\s+(data\/\S+?)\s*$/i)) && !/\.cas\b/i.test(m[1])) {
      bareModels.push({ type: currentType, path: m[1].trim() });
      continue;
    }
  }
  return { types, textures, models, bareModels };
}
