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

// Resolve a friendly display name for an EDB unit dictionary key.
// EDB recruit lines reference the unit's "dictionary" key (sometimes the same as type, with underscores → spaces).
// e.g. dictionary `roman_rorarii` → string key `roman_rorarii` in export_units.txt.
export function lookupUnitName(unitDict, unitsMap) {
  if (!unitDict) return null;
  const k = unitDict.replace(/\s+/g, "_");
  return unitsMap[k] || unitsMap[unitDict] || null;
}
