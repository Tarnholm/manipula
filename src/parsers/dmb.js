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
// We surface three things the validator can use:
//   • types    — Set of declared model ids ("type X" blocks).
//   • textures — array of { type, path } — every texture / pbr_texture
//                line, regardless of which faction column it's keyed to.
//   • models   — array of { type, path } — every model_flexi / _m line.
//
// The path strings are stored as written. Mod data conventionally uses
// `data/...` paths relative to the mod root; the existence checker
// resolves them by stripping the leading `data/` and prepending the
// configured mod data dir.

export function parseDMB(text) {
  const types = new Set();
  const textures = [];
  const models = [];
  if (typeof text !== "string" || !text) return { types, textures, models };
  let currentType = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/;.*$/, "").trim();
    if (!line) continue;
    const tm = line.match(/^type\s+(\S+)/i);
    if (tm) { currentType = tm[1]; types.add(currentType); continue; }
    const stripped = line.replace(/^no_variation\s+/i, "");
    let m;
    if ((m = stripped.match(/^(?:pbr_)?texture\s+\S+\s*,\s*([^,]+?)\s*$/i))) {
      textures.push({ type: currentType, path: m[1].trim() });
      continue;
    }
    if ((m = stripped.match(/^model_flexi(?:_m)?\s+([^,]+?)\s*,/i))) {
      models.push({ type: currentType, path: m[1].trim() });
      continue;
    }
  }
  return { types, textures, models };
}
