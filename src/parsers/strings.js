// Parse RTW string files (export_units.txt, export_buildings.txt, expanded_bi.txt).
// Format: lines like `{key}Value` (UTF-16 in source file; Electron main reads it as JS string).
// Multi-line values: subsequent non-comment lines that don't start with `{` belong to the previous key.
export function parseStrings(text) {
  if (!text) return {};
  const out = {};
  // Drop any leftover BOM glyphs.
  const lines = text.replace(/﻿/g, "").split(/\r?\n/);
  let curKey = null;
  let curVal = "";
  const flush = () => {
    if (curKey !== null) {
      out[curKey] = curVal.trim();
    }
    curKey = null;
    curVal = "";
  };
  for (const raw of lines) {
    const line = raw;
    if (!line) { continue; }
    if (line.trimStart().startsWith("¬") || line.trimStart().startsWith("¬")) continue; // comment marker in CA files
    const m = line.match(/^\s*\{([^}]+)\}(.*)$/);
    if (m) {
      flush();
      curKey = m[1].trim();
      curVal = m[2];
    } else if (curKey !== null) {
      curVal += "\n" + line;
    }
  }
  flush();
  return out;
}

// Async variant — yields the event loop every CHUNK lines so the renderer thread stays responsive
// while parsing huge string files (export_units.txt can be 100k+ lines / multiple MB).
const CHUNK = 4000;
const tick = () => new Promise(r => setTimeout(r, 0));
export async function parseStringsAsync(text) {
  if (!text) return {};
  const out = {};
  const lines = text.replace(/﻿/g, "").split(/\r?\n/);
  let curKey = null;
  let curVal = "";
  const flush = () => { if (curKey !== null) out[curKey] = curVal.trim(); curKey = null; curVal = ""; };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;
    if (line.trimStart().startsWith("¬")) continue;
    const m = line.match(/^\s*\{([^}]+)\}(.*)$/);
    if (m) { flush(); curKey = m[1].trim(); curVal = m[2]; }
    else if (curKey !== null) curVal += "\n" + line;
    if ((i % CHUNK) === 0 && i > 0) await tick();
  }
  flush();
  return out;
}

// Resolve a friendly display name for an EDB unit dictionary key.
// EDB recruit lines reference the unit's "dictionary" key (sometimes the same as type, with underscores → spaces).
// e.g. dictionary `roman_rorarii` → string key `roman_rorarii` in export_units.txt.
export function lookupUnitName(unitDict, unitsMap) {
  if (!unitDict) return null;
  const k = unitDict.replace(/\s+/g, "_");
  return unitsMap[k] || unitsMap[unitDict] || null;
}
