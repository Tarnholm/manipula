// Parse descr_mount.txt — the mount-linkage table.
//
// Each `type X` block declares a mount type referenced by EDU's
// `mount` column (e.g. EDU `mount medium horse` → descr_mount
// `type medium horse`). The block's `model Y` line points at a DMB
// `type Y` block which carries the actual battle-model + textures.
//
//   type    medium horse
//   class   horse
//   model   horse_medium
//   radius  1.5
//   ...
//
// Types can be multi-word (whitespace inside the name); we capture the
// rest of the line after `type ` verbatim. Mount names are matched
// case-insensitively against EDU's Mount field — RTW itself is
// case-insensitive on this lookup, and the `Mount` column in EDU
// is conventionally TitleCase ("Heavy horse") while descr_mount is
// lowercase ("heavy horse").
//
// Returns:
//   types          — Set<originalCase> of declared type names
//   typesLower     — Set<lowercase> for case-insensitive matching
//   modelByType    — Map<lowercase typeName, modelId>
export function parseDescrMount(text) {
  const types = new Set();
  const typesLower = new Set();
  const modelByType = new Map();
  if (typeof text !== "string" || !text) return { types, typesLower, modelByType };
  let currentType = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/;.*$/, "").trim();
    if (!line) continue;
    const tm = line.match(/^type\s+(.+)$/i);
    if (tm) {
      currentType = tm[1].trim();
      types.add(currentType);
      typesLower.add(currentType.toLowerCase());
      continue;
    }
    const mm = line.match(/^model\s+(\S+)/i);
    if (mm && currentType) {
      modelByType.set(currentType.toLowerCase(), mm[1]);
    }
  }
  return { types, typesLower, modelByType };
}
