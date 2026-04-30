// Parse descr_regions.txt → [{ region, settlement, owner, traits: [..tags..], hiddenResources: [..] }]
// Each block (separated by blank lines) is 5+ tab-indented lines:
//   <region>
//   \t<settlement>
//   \t<owner>
//   \t<rebel_type>
//   \t<r,g,b>
//   \t<resource_traits comma-list>
//   \t<numbers...>
//   \t<numbers...>
//   \t<religion lines...>
export function parseRegions(text) {
  const lines = text.split(/\r?\n/);
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line || line.startsWith(";") || /^\s/.test(line)) { i++; continue; }
    // Region name (starts at column 0, non-comment)
    const region = line.trim();
    if (!region) { i++; continue; }
    // Next non-blank should be settlement (indented)
    const block = [region];
    let j = i + 1;
    while (j < lines.length) {
      const l = lines[j];
      if (l === "") { j++; break; }
      if (l.startsWith(";")) { j++; continue; }
      if (!/^\s/.test(l)) break; // next region
      block.push(l.trim());
      j++;
    }
    if (block.length >= 5) {
      const [r, settlement, owner, rebel, _color, traitLine] = block;
      const traits = (traitLine || "").split(",").map(s => s.trim()).filter(Boolean);
      out.push({
        region: r,
        settlement,
        owner,
        rebel,
        traits,
        // Heuristic: hiddenResources are anything in traits — descr_regions doesn't distinguish.
        // The parser keeps the whole list; the UI can cross-check against the resources/hiddenResources from descr_sm_resources.
      });
    }
    i = j;
  }
  return out;
}

// Helper: which regions reference a given hidden_resource id?
export function regionsByHiddenResource(regions, hr) {
  return regions.filter(r => r.traits.includes(hr));
}
