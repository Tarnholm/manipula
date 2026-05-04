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
      const [r, settlement, owner, rebel, color, traitLine] = block;
      const traits = (traitLine || "").split(",").map(s => s.trim()).filter(Boolean);
      // RGB is whitespace-separated 3-tuple identifying this region's pixel color in map_regions.tga.
      // Used by the in-app map view to colour regions matching a unit's HR requirements.
      const rgbParts = (color || "").trim().split(/\s+/).map(n => parseInt(n, 10));
      const rgb = rgbParts.length === 3 && rgbParts.every(n => Number.isFinite(n) && n >= 0 && n <= 255)
        ? rgbParts
        : null;
      out.push({
        region: r,
        settlement,
        owner,
        rebel,
        traits,
        rgb,                                   // [r, g, b] or null if unparsable
        rgbKey: rgb ? rgb.join(",") : null,    // "r,g,b" — direct key for map_regions.tga pixel lookup
      });
    }
    i = j;
  }
  return out;
}

// Build a `${r},${g},${b}` → region lookup map for fast pixel-to-region resolution
// when colouring map_regions.tga.
export function regionsByRgbKey(regions) {
  const m = {};
  for (const r of regions) if (r.rgbKey) m[r.rgbKey] = r;
  return m;
}

// Helper: which regions reference a given hidden_resource id?
export function regionsByHiddenResource(regions, hr) {
  return regions.filter(r => r.traits.includes(hr));
}
