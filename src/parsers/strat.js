// Parse descr_strat.txt → { factionId: [regionName, ...] }
// Ported from Provincia (parsers.js:parseDescrStratFactions). Each `faction X` block contains
// `settlement { ... region <name> ... }` blocks for the regions that faction owns at start.
//
// We only care about start-of-campaign ownership for the recruitable-regions map overlay —
// it's much more accurate than descr_regions' rebel-default `owner` field.
export function parseDescrStratFactions(text) {
  if (!text) return {};
  const lines = text.split(/\r?\n/);
  const factionRegions = {};
  let current = null;
  let inSettlement = false;
  for (const line of lines) {
    const s = line.trim();
    if (!s || s.startsWith(";")) continue;
    const fm = s.match(/^faction\s+(\w+)/);
    if (fm) {
      current = fm[1].toLowerCase();
      if (!factionRegions[current]) factionRegions[current] = [];
      inSettlement = false;
      continue;
    }
    if (s === "settlement") { inSettlement = true; continue; }
    if (s === "}" && inSettlement) { inSettlement = false; continue; }
    if (inSettlement && s.startsWith("region")) {
      const rn = s.replace("region", "").trim();
      if (current && rn) factionRegions[current].push(rn);
    }
  }
  return Object.fromEntries(Object.entries(factionRegions).filter(([, v]) => v.length > 0));
}

// Build the inverse: regionName → factionId. Each region is owned by exactly one faction in
// descr_strat (or none, in which case the rebel/slave faction owns it via descr_regions).
export function regionToFaction(stratFactions) {
  const m = {};
  for (const [fac, regs] of Object.entries(stratFactions || {})) {
    for (const r of regs) m[r] = fac;
  }
  return m;
}
