// Generator — turns a unit family definition into the EDB recruit lines for player + AI sections.
//
// Unit family shape (v2):
//   {
//     id, unit, enabled, notes,
//     grade: "Levy" | "Standard" | "Professional" | "Elite" | "Veteran" | "Custom",
//
//     // Player-side (faction sibling)
//     canonicalMicTier: 1..4,        // mic_tier_X used in GovC/GovB lines
//     homelandMicTier: 1..4,         // mic_tier_X used in GovD line (often canonicalMicTier or canonicalMicTier-1)
//     colonyTier: 0..2,              // colony_tier_X added to GovC/GovB (skipped on GovD); 0 = no colony required
//     outsideExtras: string[],       // extra clauses applied to GovC/GovB but NOT GovD (e.g. "hidden_resource horse_supply")
//     emitGovB: bool, emitGovC: bool, emitGovD: bool,
//     factions: string[],            // positive list (or ["all"] if used as part of an AOR-only family)
//     excludeFactions: string[],     // not factions { ... }
//     commonRequires: string[],      // applied to every emitted line (player + AI). Examples: 'major_event "X"', 'hidden_resource Y'
//
//     // AI-side
//     aiHomeland: bool,              // include "and homeland" clause on AI lines
//     xp: { startTier, value } | null,
//
//     // AOR sibling (paired with this unit). When set, emits separate lines for the AOR variant.
//     aor: null | {
//       enabled: bool,               // if false, no AOR sibling
//       govTier: 1..4,               // gov_tier_X clause on the player AOR line
//       // Recruit name is auto-derived as "aor " + unit, unless aorOnly = true.
//       aorOnly: bool,               // if true, this is an AOR-only unit (no faction sibling). aor.recruitName must be set.
//       recruitName: string | null,  // override recruit name when aorOnly
//     },
//   }
//
// Three independent dials drive the player section:
//   1. canonicalMicTier — what GovC/GovB need (the unit's "real" tier requirement)
//   2. homelandMicTier — what GovD needs (the homeland discount; usually canonical-1 for elites, canonical for everyone else)
//   3. colonyTier + outsideExtras — extras applied only outside homeland (GovC/GovB)
//
// Grade is the meta-classification. It auto-fills sensible defaults for the dials but every dial is overridable.

import { fillDefaults as fillGradeDefaults, GRADE_DEFAULTS } from "./grades";

export const PLAYER_BUILDINGS = ["governmentB", "governmentC", "governmentD"];
export const PLAYER_BUILDING_LEVEL = { governmentB: "gov2", governmentC: "gov3", governmentD: "gov4" };
export const AOR_PLAYER_BUILDING = "hinterland_region";
export const AOR_PLAYER_LEVEL = "region_base";
export const MIC_BUILDING = "military_industrial_complex";
export const MIC_LEVELS = ["mic_1", "mic_2", "mic_3", "mic_4"];
export const GARRISON_BUILDING = "garrison";
export const GARRISON_LEVELS = ["garrison", "garrison+1", "garrison+2"];

export const TOOL_BUILDINGS = new Set([
  ...PLAYER_BUILDINGS,
  AOR_PLAYER_BUILDING,
  MIC_BUILDING,
  GARRISON_BUILDING,
]);

// XP rule: only AI lines get bonus XP. MIC: tier >= xp.startTier. Garrison: garrison+2 only.
function xpFor(unit, building, level) {
  if (!unit.xp) return 0;
  if (building === MIC_BUILDING) {
    const m = level.match(/^mic_(\d)$/);
    return m && parseInt(m[1], 10) >= unit.xp.startTier ? unit.xp.value : 0;
  }
  if (building === GARRISON_BUILDING) {
    return level === "garrison+2" ? unit.xp.value : 0;
  }
  return 0;
}

function joinAnd(parts) {
  // Filter falsy + dedupe (whitespace-normalized) so the same clause appearing in multiple sources
  // (e.g. outsideExtras and commonRequires from EDUMatic having overlapping columns) only emits once.
  const seen = new Set();
  const out = [];
  for (const p of parts) {
    if (!p) continue;
    const key = String(p).replace(/\s+/g, " ").trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(p);
  }
  return out.join(" and ");
}
function fmtFactions(factions) {
  const ids = (factions && factions.length) ? factions : ["all"];
  return `factions { ${ids.join(", ")}, }`;
}
function fmtExcludeFactions(ex) {
  if (!ex || !ex.length) return "";
  return `not factions { ${ex.join(", ")}, }`;
}

// Mercenaries are recruited via descr_mercenaries.txt — they don't have AOR siblings in the EDB.
function isMercUnit(name) {
  return /^merc\s+/i.test(String(name || "").trim());
}

// Resolve the AOR sibling's recruit name.
// Paired (faction + AOR): `aor <faction unit name>` (the standard convention).
// AOR-only: `u.unit` is already the AOR name (e.g. "aor X" or a merc-only entry); never re-prefix.
function aorRecruitName(u) {
  if (!u.aor) return null;
  if (u.aor.aorOnly) return u.aor.recruitName || u.unit;
  return `aor ${u.unit}`;
}

// True when this unit's AOR sibling should actually emit lines.
function aorEmitsLines(u) {
  if (!u.aor || !u.aor.enabled) return false;
  if (isMercUnit(u.unit)) return false; // mercs don't have an AOR sibling in EDB
  return true;
}

// Public: faction-sibling player lines (1, 2, or 3 depending on emit toggles).
// AOR-only units skip this entirely — they only emit the hinterland_region line.
export function generatePlayerLines(unit) {
  const u = fillGradeDefaults(unit);
  if (!u.enabled) return [];
  if (u.aor && u.aor.enabled && u.aor.aorOnly) return [];

  const lines = [];
  const homelandReqs = (govLine) => joinAnd([
    fmtFactions(u.factions),
    "is_player",
    fmtExcludeFactions(u.excludeFactions),
    `mic_tier_${u.homelandMicTier}`,
    ...(u.commonRequires || []),
  ]);
  const outsideReqs = () => joinAnd([
    fmtFactions(u.factions),
    "is_player",
    fmtExcludeFactions(u.excludeFactions),
    `mic_tier_${u.canonicalMicTier}`,
    ...(u.colonyTier > 0 ? [`colony_tier_${u.colonyTier}`] : []),
    ...(u.outsideExtras || []),
    ...(u.commonRequires || []),
  ]);

  if (u.emitGovD) {
    lines.push({
      building: "governmentD", level: "gov4",
      text: `\t\t\trecruit "${u.unit}" 0 requires ${homelandReqs()}`,
    });
  }
  if (u.emitGovC) {
    lines.push({
      building: "governmentC", level: "gov3",
      text: `\t\t\trecruit "${u.unit}" 0 requires ${outsideReqs()}`,
    });
  }
  if (u.emitGovB) {
    lines.push({
      building: "governmentB", level: "gov2",
      text: `\t\t\trecruit "${u.unit}" 0 requires ${outsideReqs()}`,
    });
  }
  return lines;
}

// Public: AOR-sibling player line (one line in hinterland_region/region_base).
// Only emitted when the unit has an AOR sibling AND it's not a merc unit.
export function generateAORPlayerLines(unit) {
  const u = fillGradeDefaults(unit);
  if (!u.enabled) return [];
  if (!aorEmitsLines(u)) return [];

  const aorName = aorRecruitName(u);
  // For paired AOR (faction + AOR), the AOR's `not factions { ... }` = the faction sibling's positive list.
  // For AOR-only, no exclusion list (every faction can recruit it).
  const exclude = u.aor.aorOnly ? [] : (u.factions || []);
  const factions = ["all"]; // AOR is always factions { all, }

  const requires = joinAnd([
    fmtFactions(factions),
    "is_player",
    fmtExcludeFactions(exclude),
    `mic_tier_${u.canonicalMicTier}`,                 // AOR uses canonical (no homeland discount)
    ...(u.commonRequires || []),
    `gov_tier_${u.aor.govTier || 1}`,
  ]);
  return [{
    building: AOR_PLAYER_BUILDING,
    level: AOR_PLAYER_LEVEL,
    text: `\t\t\trecruit "${aorName}" 0 requires ${requires}`,
    aorVariant: true,
  }];
}

// Public: AI lines for a unit family.
//   - Faction sibling: emits unless aorOnly (in which case there is no faction sibling).
//   - AOR sibling: emits when aorEmitsLines (i.e. AOR is enabled and the unit isn't a merc).
export function generateAILines(unit) {
  const u = fillGradeDefaults(unit);
  if (!u.enabled) return [];

  const out = [];
  const isAorOnly = !!(u.aor && u.aor.enabled && u.aor.aorOnly);

  // Faction sibling — skip when this is an AOR-only unit family (no faction sibling exists).
  if (!isAorOnly) {
    pushAILinesFor(out, u, /*aor*/ false);
  }

  // AOR sibling — emits in two cases:
  //   1) Paired faction+AOR: u.aor.enabled && !aorOnly (and not a merc unit)
  //   2) AOR-only: u.aor.enabled && aorOnly (the unit IS the AOR variant; faction sibling is in descr_mercenaries instead)
  if (aorEmitsLines(u) || isAorOnly) {
    pushAILinesFor(out, u, /*aor*/ true);
  }

  return out;
}

function pushAILinesFor(out, u, isAor) {
  const recruitName = isAor ? aorRecruitName(u) : u.unit;
  const factions = isAor ? ["all"] : (u.factions || ["all"]);
  const exclude = isAor
    ? (u.aor.aorOnly ? [] : (u.factions || []))
    : (u.excludeFactions || []);

  const buildReq = (level, building) => {
    return joinAnd([
      fmtFactions(factions),
      "not is_player",
      fmtExcludeFactions(exclude),
      ...(u.commonRequires || []),
      "noisland",
      u.aiHomeland ? "homeland" : "",
    ]);
  };

  // MIC mic_<canonicalMicTier> .. mic_4
  // For AI, we use canonicalMicTier as the floor (matching the player's GovC tier).
  // The "homeland discount" is player-side only.
  const minTier = u.canonicalMicTier;
  for (let t = minTier; t <= 4; t++) {
    const lvl = MIC_LEVELS[t - 1];
    out.push({
      building: MIC_BUILDING, level: lvl,
      text: `\t\t\trecruit "${recruitName}" ${xpFor(u, MIC_BUILDING, lvl)} requires ${buildReq(lvl, MIC_BUILDING)}`,
      aorVariant: isAor,
    });
  }

  // Garrison duplications for canonicalMicTier === 1 only (garrison aliases tier 1).
  if (minTier === 1) {
    for (const lvl of GARRISON_LEVELS) {
      out.push({
        building: GARRISON_BUILDING, level: lvl,
        text: `\t\t\trecruit "${recruitName}" ${xpFor(u, GARRISON_BUILDING, lvl)} requires ${buildReq(lvl, GARRISON_BUILDING)}`,
        aorVariant: isAor,
      });
    }
  }
}

// Render a unit family's full output as a preview text block, grouped by section.
export function renderUnitPreview(unit) {
  const u = fillGradeDefaults(unit);
  const player = generatePlayerLines(u);
  const aor = generateAORPlayerLines(u);
  const ai = generateAILines(u);

  let s = "";
  s += `;;; ${u.unit}  —  grade: ${u.grade || "?"}, canonical mic_tier: ${u.canonicalMicTier}, homeland mic_tier: ${u.homelandMicTier}\n`;
  s += `;;; Factions: ${(u.factions || ["all"]).join(", ")}`;
  if (u.excludeFactions && u.excludeFactions.length) s += `   excludes: ${u.excludeFactions.join(", ")}`;
  s += "\n";
  if (u.colonyTier > 0) s += `;;; Colony tier (outside homeland): ${u.colonyTier}\n`;
  if (u.outsideExtras && u.outsideExtras.length) s += `;;; Outside-homeland extras: ${u.outsideExtras.join(", ")}\n`;
  if (u.commonRequires && u.commonRequires.length) s += `;;; Common requires: ${u.commonRequires.join(", ")}\n`;
  if (u.aiHomeland) s += `;;; AI homeland gate: yes\n`;
  if (u.xp) s += `;;; XP +${u.xp.value} starting at tier ${u.xp.startTier}\n`;
  if (u.aor && u.aor.enabled) s += `;;; AOR sibling: ${u.aor.aorOnly && u.aor.recruitName ? u.aor.recruitName : "aor " + u.unit} (gov_tier_${u.aor.govTier})\n`;
  s += "\n";

  if (player.length) {
    s += "; ── PLAYER (faction sibling) ──\n";
    for (const ln of player) s += `; (${ln.building} / ${ln.level})\n${ln.text.trim()}\n`;
  }
  if (aor.length) {
    s += "\n; ── PLAYER (AOR sibling) ──\n";
    for (const ln of aor) s += `; (${ln.building} / ${ln.level})\n${ln.text.trim()}\n`;
  }
  if (ai.length) {
    s += "\n; ── AI ──\n";
    for (const ln of ai) {
      const tag = ln.aorVariant ? " [AOR]" : "";
      s += `; (${ln.building} / ${ln.level})${tag}\n${ln.text.trim()}\n`;
    }
  }
  return s;
}

export function renderAllPreview(units) {
  return units.filter(u => u.enabled).map(renderUnitPreview).join("\n\n");
}

// ── Diff preview: compare what will change in EDB ──
// Only units with writeBack !== false are written to / removed from the EDB. Imported reference
// units (writeBack === false) are excluded — the tool ignores their existing EDB lines entirely.
export function diffEDB(originalEDB, units) {
  const writableUnits = units.filter(u => u.writeBack !== false);
  const ownedUnits = new Set();
  for (const u of writableUnits) {
    if (!(u.aor && u.aor.enabled && u.aor.aorOnly)) ownedUnits.add(u.unit);
    if (aorEmitsLines(u) || (u.aor && u.aor.enabled && u.aor.aorOnly)) {
      ownedUnits.add(aorRecruitName(u));
    }
  }
  const lines = originalEDB.split(/\r?\n/);

  const existing = []; // [{ unit, building, level, xp, raw, line }]
  let curBuilding = null, curLevels = [], curLevelIdx = -1;
  let inCapability = false, capDepth = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const bm = line.match(/^building\s+([A-Za-z_][A-Za-z0-9_]*)/);
    if (bm) { curBuilding = bm[1]; curLevels = []; curLevelIdx = -1; inCapability = false; capDepth = 0; continue; }
    const lm = line.match(/^\s*levels\s+(.+?)\s*$/);
    if (lm && curBuilding) { curLevels = lm[1].split(/\s+/).filter(Boolean); continue; }
    if (curBuilding && curLevels.length) {
      const head = line.trimStart().match(/^([A-Za-z_][A-Za-z0-9_+\-]*)\s+requires\b/);
      if (head && curLevels.includes(head[1])) { curLevelIdx = curLevels.indexOf(head[1]); inCapability = false; capDepth = 0; }
    }
    if (curBuilding && curLevelIdx >= 0) {
      if (/^\s*capability\s*$/.test(line) || /^\s*capability\s*\{/.test(line)) {
        inCapability = true;
        capDepth = (line.match(/\{/g) || []).length - (line.match(/\}/g) || []).length;
        continue;
      }
      if (inCapability) {
        const opens = (line.match(/\{/g) || []).length;
        const closes = (line.match(/\}/g) || []).length;
        capDepth += opens - closes;
        const rm = line.match(/^\s*recruit\s+"([^"]+)"\s+(\d+)\s+requires\s+(.+?)\s*$/);
        if (rm && ownedUnits.has(rm[1]) && TOOL_BUILDINGS.has(curBuilding)) {
          existing.push({
            unit: rm[1], building: curBuilding, level: curLevels[curLevelIdx],
            xp: parseInt(rm[2], 10), requires: rm[3].trim(), line: i,
          });
        }
        if (capDepth <= 0 && /^\s*\}\s*$/.test(line)) { inCapability = false; curLevelIdx = -1; }
      }
    }
  }

  // What we will emit
  const newLines = [];
  for (const u of writableUnits) {
    if (!u.enabled) continue;
    const player = generatePlayerLines(u);
    const aor = generateAORPlayerLines(u);
    const ai = generateAILines(u);
    for (const ln of [...player, ...aor, ...ai]) {
      const m = ln.text.match(/^\s*recruit\s+"([^"]+)"\s+(\d+)\s+requires\s+(.+?)\s*$/);
      newLines.push({
        unit: m[1], building: ln.building, level: ln.level,
        xp: parseInt(m[2], 10), requires: m[3].trim(),
      });
    }
  }

  const norm = (r) => r.replace(/\s+/g, " ").trim();
  const keyOf = (e) => `${e.unit}|${e.building}|${e.level}|${e.xp}|${norm(e.requires)}`;
  const existKeys = new Set(existing.map(keyOf));
  const newKeys = new Set(newLines.map(keyOf));

  const removed = existing.filter(e => !newKeys.has(keyOf(e)));
  const added = newLines.filter(e => !existKeys.has(keyOf(e)));
  const kept = existing.filter(e => newKeys.has(keyOf(e)));
  return { added, removed, kept };
}

// ── Write-back: returns new EDB text with all unit blocks reapplied. ──
// Only writeBack-enabled units are touched. Reference-only imports stay untouched in the EDB.
// Preserves the original file's line-ending style — RTW's parser requires Windows CRLF, so detecting
// and re-using the original style is essential. Falls back to CRLF if the original has none.
export function applyUnitsToEDB(originalEDB, units) {
  const useCRLF = /\r\n/.test(originalEDB) || !/\n/.test(originalEDB);
  const eol = useCRLF ? "\r\n" : "\n";
  const lines = originalEDB.split(/\r?\n/);
  const writableUnits = units.filter(u => u.writeBack !== false);
  const ownedRecruitNames = new Set();
  for (const u of writableUnits) {
    if (!(u.aor && u.aor.enabled && u.aor.aorOnly)) ownedRecruitNames.add(u.unit);
    if (aorEmitsLines(u) || (u.aor && u.aor.enabled && u.aor.aorOnly)) {
      ownedRecruitNames.add(aorRecruitName(u));
    }
  }

  // Locate level targets — the close-line of each capability { ... } block in tool-owned buildings.
  const levelTargets = [];
  let curBuilding = null, curLevels = [], curLevelIdx = -1;
  let inCapability = false, capDepth = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const bm = line.match(/^building\s+([A-Za-z_][A-Za-z0-9_]*)/);
    if (bm) { curBuilding = bm[1]; curLevels = []; curLevelIdx = -1; inCapability = false; capDepth = 0; continue; }
    const lm = line.match(/^\s*levels\s+(.+?)\s*$/);
    if (lm && curBuilding) { curLevels = lm[1].split(/\s+/).filter(Boolean); continue; }
    if (curBuilding && curLevels.length) {
      const head = line.trimStart().match(/^([A-Za-z_][A-Za-z0-9_+\-]*)\s+requires\b/);
      if (head && curLevels.includes(head[1])) { curLevelIdx = curLevels.indexOf(head[1]); inCapability = false; capDepth = 0; continue; }
    }
    if (curBuilding && curLevelIdx >= 0) {
      if (/^\s*capability\s*$/.test(line) || /^\s*capability\s*\{/.test(line)) {
        inCapability = true;
        capDepth = (line.match(/\{/g) || []).length - (line.match(/\}/g) || []).length;
        continue;
      }
      if (inCapability) {
        const opens = (line.match(/\{/g) || []).length;
        const closes = (line.match(/\}/g) || []).length;
        capDepth += opens - closes;
        if (capDepth <= 0 && /^\s*\}\s*$/.test(line)) {
          if (TOOL_BUILDINGS.has(curBuilding)) {
            levelTargets.push({
              building: curBuilding,
              level: curLevels[curLevelIdx],
              capabilityCloseLine: i,
            });
          }
          inCapability = false;
          curLevelIdx = -1;
        }
      }
    }
  }

  const targetMap = new Map();
  for (const t of levelTargets) targetMap.set(`${t.building}|${t.level}`, t);

  // Strip existing recruit lines for owned recruit names (and their RT banner comments).
  const remove = new Set();
  curBuilding = null;
  curLevels = [];
  curLevelIdx = -1;
  inCapability = false;
  capDepth = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const bm = line.match(/^building\s+([A-Za-z_][A-Za-z0-9_]*)/);
    if (bm) { curBuilding = bm[1]; curLevels = []; curLevelIdx = -1; inCapability = false; capDepth = 0; continue; }
    const lm = line.match(/^\s*levels\s+(.+?)\s*$/);
    if (lm && curBuilding) { curLevels = lm[1].split(/\s+/).filter(Boolean); continue; }
    if (curBuilding && curLevels.length) {
      const head = line.trimStart().match(/^([A-Za-z_][A-Za-z0-9_+\-]*)\s+requires\b/);
      if (head && curLevels.includes(head[1])) { curLevelIdx = curLevels.indexOf(head[1]); inCapability = false; capDepth = 0; continue; }
    }
    if (curBuilding && curLevelIdx >= 0) {
      if (/^\s*capability\s*$/.test(line) || /^\s*capability\s*\{/.test(line)) {
        inCapability = true;
        capDepth = (line.match(/\{/g) || []).length - (line.match(/\}/g) || []).length;
        continue;
      }
      if (inCapability) {
        const opens = (line.match(/\{/g) || []).length;
        const closes = (line.match(/\}/g) || []).length;
        capDepth += opens - closes;
        if (TOOL_BUILDINGS.has(curBuilding)) {
          const rm = line.match(/^\s*recruit\s+"([^"]+)"\s+\d+\s+requires\s+/);
          if (rm && ownedRecruitNames.has(rm[1])) {
            remove.add(i);
            if (i > 0 && /^\s*;;; RT_/.test(lines[i - 1])) remove.add(i - 1);
            if (i + 1 < lines.length && /^\s*;;; RT_/.test(lines[i + 1])) remove.add(i + 1);
          }
        }
        if (capDepth <= 0 && /^\s*\}\s*$/.test(line)) { inCapability = false; curLevelIdx = -1; }
      }
    }
  }

  // Build insertion buckets per level target.
  const buckets = new Map();
  for (const t of levelTargets) buckets.set(`${t.building}|${t.level}`, []);

  for (const u of writableUnits) {
    if (!u.enabled) continue;
    const all = [...generatePlayerLines(u), ...generateAORPlayerLines(u), ...generateAILines(u)];
    for (const ln of all) {
      const key = `${ln.building}|${ln.level}`;
      if (buckets.has(key)) buckets.get(key).push(ln.text);
    }
  }

  // Emit insertions before each level's capability close line. No banner comments — the strip pass
  // identifies tool-managed lines by recruit name, not by banners. (Old banners from earlier versions
  // are still cleaned up by the strip pass for forward-compat.)
  const insertions = new Map();
  for (const t of levelTargets) {
    const key = `${t.building}|${t.level}`;
    const lns = buckets.get(key) || [];
    if (!lns.length) continue;
    insertions.set(t.capabilityCloseLine, lns.slice());
  }

  const next = [];
  for (let i = 0; i < lines.length; i++) {
    if (insertions.has(i)) {
      for (const b of insertions.get(i)) next.push(b);
    }
    if (remove.has(i)) continue;
    next.push(lines[i]);
  }
  return next.join(eol);
}

// Convenience export so the editor can show grade defaults.
export { GRADE_DEFAULTS };
