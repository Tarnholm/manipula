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

// Resolve the AOR sibling's recruit name. Always auto-derived from u.unit — never cached, so it
// stays in sync if the user renames u.unit later. Always produces `aor X` where X is the unit
// name with any existing "aor " prefix stripped (so typing "picentine skirmishers" yields
// "aor picentine skirmishers", and typing "aor picentine skirmishers" still yields the same — no
// double-prefix). Applies in both paired and AOR-only modes.
function aorRecruitName(u) {
  if (!u.aor) return null;
  const base = String(u.unit || "").replace(/^aor\s+/i, "");
  return `aor ${base}`;
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
      text: `                recruit "${u.unit}" 0 requires ${homelandReqs()}`,
    });
  }
  if (u.emitGovC) {
    lines.push({
      building: "governmentC", level: "gov3",
      text: `                recruit "${u.unit}" 0 requires ${outsideReqs()}`,
    });
  }
  if (u.emitGovB) {
    lines.push({
      building: "governmentB", level: "gov2",
      text: `                recruit "${u.unit}" 0 requires ${outsideReqs()}`,
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
    ...(u.aorRequires || []),                          // AOR-only extras (applies only here, not to faction sibling)
    `gov_tier_${u.aor.govTier || 1}`,
  ]);
  return [{
    building: AOR_PLAYER_BUILDING,
    level: AOR_PLAYER_LEVEL,
    text: `                recruit "${aorName}" 0 requires ${requires}`,
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
      ...(u.aiRequires || []),                 // AI-only extras (regardless of faction / AOR side)
      ...(isAor ? (u.aorRequires || []) : []), // AOR-only extras only on AOR-side AI lines
      "noisland",
      u.aiHomeland ? "homeland" : "",
    ]);
  };

  // MIC mic_<canonicalMicTier> .. mic_4
  // For AI, we use canonicalMicTier as the floor — but the AI sibling
  // feature lets the user override it so the AI recruits the unit
  // earlier than the player. Falls back to the unit's own tier when
  // no override is set.
  const aiTierOverride = (u.ai && u.ai.enabled && typeof u.ai.canonicalMicTier === "number")
    ? u.ai.canonicalMicTier
    : null;
  const minTier = aiTierOverride != null ? aiTierOverride : u.canonicalMicTier;
  for (let t = minTier; t <= 4; t++) {
    const lvl = MIC_LEVELS[t - 1];
    out.push({
      building: MIC_BUILDING, level: lvl,
      text: `                recruit "${recruitName}" ${xpFor(u, MIC_BUILDING, lvl)} requires ${buildReq(lvl, MIC_BUILDING)}`,
      aorVariant: isAor,
    });
  }

  // Garrison emission. Original heuristic was "tier 1 only — garrison
  // aliases tier 1," but real mods recruit higher-tier units from
  // garrison too (e.g. RIS's AOR Cretan Archers at tier 2). Switch to
  // an explicit flag set at import time (App.js's importFromEDB scans
  // variantEntries for building === "garrison" and sets
  // unit.garrisonRecruit). Legacy data with no flag falls back to the
  // tier-1 heuristic so previously-imported units round-trip the same.
  const wantGarrison = (u.garrisonRecruit !== undefined) ? u.garrisonRecruit : (minTier === 1);
  if (wantGarrison) {
    for (const lvl of GARRISON_LEVELS) {
      out.push({
        building: GARRISON_BUILDING, level: lvl,
        text: `                recruit "${recruitName}" ${xpFor(u, GARRISON_BUILDING, lvl)} requires ${buildReq(lvl, GARRISON_BUILDING)}`,
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
  // Mirror applyUnitsToEDB: pendingRemoval units are in scope (so the
  // diff captures their existing lines as "to be removed"), even when
  // they were previously ref-only.
  const writableUnits = units.filter(u => u.writeBack !== false || u.pendingRemoval);
  const ownedUnits = new Set();
  for (const u of writableUnits) {
    if (!(u.aor && u.aor.enabled && u.aor.aorOnly)) ownedUnits.add(u.unit);
    if (aorEmitsLines(u) || (u.aor && u.aor.enabled && u.aor.aorOnly)) {
      ownedUnits.add(aorRecruitName(u));
    }
  }
  const lines = originalEDB.split(/\r?\n/);

  const existing = []; // [{ unit, building, level, xp, raw, line }]
  // Robust scan: just track curBuilding via top-level `building` declarations. Level/capability
  // tracking is best-effort for the "level" field (used for display only); the diff itself
  // captures every line by recruit name and tool-managed building.
  let curBuilding = null, curLevels = [], curLevelIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const bm = line.match(/^building\s+([A-Za-z_][A-Za-z0-9_]*)/);
    if (bm) { curBuilding = bm[1]; curLevels = []; curLevelIdx = -1; continue; }
    const lm = line.match(/^\s*levels\s+(.+?)\s*$/);
    if (lm && curBuilding) { curLevels = lm[1].split(/\s+/).filter(Boolean); continue; }
    if (curBuilding && curLevels.length) {
      const head = line.trimStart().match(/^([A-Za-z_][A-Za-z0-9_+\-]*)\s+requires\b/);
      if (head && curLevels.includes(head[1])) curLevelIdx = curLevels.indexOf(head[1]);
    }
    if (curBuilding && TOOL_BUILDINGS.has(curBuilding)) {
      const rm = line.match(/^\s*recruit\s+"([^"]+)"\s+(\d+)\s+requires\s+(.+?)\s*$/);
      if (rm && ownedUnits.has(rm[1])) {
        existing.push({
          unit: rm[1], building: curBuilding,
          level: curLevels[curLevelIdx] || "?",
          xp: parseInt(rm[2], 10), requires: rm[3].trim(), line: i,
        });
      }
    }
  }

  // What we will emit
  const newLines = [];
  for (const u of writableUnits) {
    if (!u.enabled) continue;
    if (u.pendingRemoval) continue;   // strip-only — emit nothing
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
  // Units in the strip set: anything Manipula will rewrite this pass.
  // Includes pendingRemoval units regardless of writeBack so their
  // existing recruit lines are scrubbed from the EDB even when the
  // unit was previously ref-only. Emit phase skips them (see below).
  const writableUnits = units.filter(u => u.writeBack !== false || u.pendingRemoval);
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

  // Strip existing recruit lines for owned recruit names. Robust strip: only requires that we're
  // somewhere inside a tool-managed building (track curBuilding via top-level `building` declarations).
  // No capability/level depth tracking needed for strip — recruit lines in EDB only ever appear
  // inside capability blocks anyway, and this looser check guarantees we never miss one due to a
  // state-machine glitch.
  const remove = new Set();
  let stripCurBuilding = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const bm = line.match(/^building\s+([A-Za-z_][A-Za-z0-9_]*)/);
    if (bm) { stripCurBuilding = bm[1]; continue; }
    if (stripCurBuilding && TOOL_BUILDINGS.has(stripCurBuilding)) {
      const rm = line.match(/^\s*recruit\s+"([^"]+)"\s+\d+\s+requires\s+/);
      if (rm && ownedRecruitNames.has(rm[1])) {
        remove.add(i);
        if (i > 0 && /^\s*;;; RT_/.test(lines[i - 1])) remove.add(i - 1);
        if (i + 1 < lines.length && /^\s*;;; RT_/.test(lines[i + 1])) remove.add(i + 1);
      }
    }
  }

  // Build emission lists per level target, AND record the first-line position of each owned unit's
  // existing recruit lines (so we can re-insert at the same location to preserve ordering).
  const buckets = new Map();
  for (const t of levelTargets) buckets.set(`${t.building}|${t.level}`, []);

  // BD's New Base orders recruit lines within a capability block by category, in this sequence:
  //   1. Infantry  2. Missiles  3. Camels  4. Elephants  5. Cavalry  6. Generals
  // Inside each category, BD groups by Quality Class (slingers together, archers together, etc.).
  //
  // We classify each unit (writable + reference, looked up by recruit name from the profile) into
  // one of these six buckets, then place new lines so they preserve this ordering:
  //   - Unit has its own existing line → re-insert exactly there.
  //   - Same Quality Class anchor exists → insert there (groups exact subtype together).
  //   - Same category bucket — find the FIRST line of the NEXT bucket and insert BEFORE it.
  //   - No suitable anchor → capability close (the original behavior).

  // Look up the EDU entry for a recruit name (used as a bucket fallback when qualityClass is missing).
  const eduByName = new Map();
  for (const u of units) {
    if (u && u.unit && u.eduCategory) eduByName.set(u.unit, u);
  }

  // Recruitment output order (and unit-list display order):
  //   1. Infantry  2. Missiles  3. Cavalry  4. Camels  5. Elephants  6. Generals
  function bucketOf(u) {
    if (!u) return 99; // unknown — falls to "after everything" → capability close
    const qc = String(u.qualityClass || "");
    if (qc) {
      if (/camel/i.test(qc)) return 4;
      if (/elephant/i.test(qc)) return 5;
      if (/general/i.test(qc)) return 6;
      if (/(slinger|archer|javelin|missile)/i.test(qc)) return 2;
      if (/(hoplite|spearman|infantry|fanatic|legionary|auxilia|phalangite|guard)/i.test(qc)) return 1;
      if (/(cav|HA\b)/i.test(qc)) return 3;
    }
    const n = String(u.unit || "").toLowerCase();
    if (/(elephant|olifant)/.test(n)) return 5;
    if (/camel/.test(n)) return 4;
    if (/(\bgeneral\b|legatus|imperator|royal\s+escort)/.test(n)) return 6;
    if (/(slinger|funditor|archer|toxotai|toxotes|javelinman|javelin|akontistai)/.test(n)) return 2;
    if (/(cavalry|horseman|equit(es)?\b|lancer|cataphract)/.test(n)) return 3;
    return 1; // default to infantry
  }

  const qcByUnit = new Map();
  for (const u of units) {
    if (u && u.unit && u.qualityClass) qcByUnit.set(u.unit, u.qualityClass);
  }
  const unitByName = new Map();
  for (const u of units) {
    if (u && u.unit) unitByName.set(u.unit, u);
  }

  const anchors = new Map();             // unit|building|level → first own recruit line index
  const qcAnchors = new Map();           // qualityClass|building|level → first matching line index
  // Anchors must be scoped by (building, level), not just building. Each level has its own
  // capability block, and emission targets are per (building, level) — using a building-wide
  // anchor would land mic_2/mic_3/mic_4 emissions at line indices inside mic_1's capability.
  const bucketLines = new Map();         // building|level → [{ line, bucket, name }] in file order
  let anchorBldg = null;
  let anchorLevels = [];
  let anchorLevelIdx = -1;
  let anchorInCapability = false;
  let anchorCapDepth = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const bm = line.match(/^building\s+([A-Za-z_][A-Za-z0-9_]*)/);
    if (bm) {
      anchorBldg = bm[1];
      anchorLevels = []; anchorLevelIdx = -1;
      anchorInCapability = false; anchorCapDepth = 0;
      continue;
    }
    const lm = line.match(/^\s*levels\s+(.+?)\s*$/);
    if (lm && anchorBldg) { anchorLevels = lm[1].split(/\s+/).filter(Boolean); continue; }
    if (anchorBldg && anchorLevels.length) {
      const head = line.trimStart().match(/^([A-Za-z_][A-Za-z0-9_+\-]*)\s+requires\b/);
      if (head && anchorLevels.includes(head[1])) {
        anchorLevelIdx = anchorLevels.indexOf(head[1]);
        anchorInCapability = false; anchorCapDepth = 0;
      }
    }
    if (anchorBldg && anchorLevelIdx >= 0) {
      if (/^\s*capability\s*$/.test(line) || /^\s*capability\s*\{/.test(line)) {
        anchorInCapability = true;
        anchorCapDepth = (line.match(/\{/g) || []).length - (line.match(/\}/g) || []).length;
        continue;
      }
      if (anchorInCapability) {
        const opens = (line.match(/\{/g) || []).length;
        const closes = (line.match(/\}/g) || []).length;
        anchorCapDepth += opens - closes;
        if (anchorCapDepth <= 0 && /^\s*\}\s*$/.test(line)) {
          anchorInCapability = false;
          anchorLevelIdx = -1;
        }
      }
    }

    if (anchorBldg && TOOL_BUILDINGS.has(anchorBldg) && anchorLevelIdx >= 0 && anchorInCapability) {
      const rm = line.match(/^\s*recruit\s+"([^"]+)"\s+\d+\s+requires\s+/);
      if (rm) {
        const lvl = anchorLevels[anchorLevelIdx];
        if (ownedRecruitNames.has(rm[1])) {
          const k = `${rm[1]}|${anchorBldg}|${lvl}`;
          if (!anchors.has(k)) anchors.set(k, i);
        }
        const qc = qcByUnit.get(rm[1]);
        if (qc) {
          const qk = `${qc}|${anchorBldg}|${lvl}`;
          if (!qcAnchors.has(qk)) qcAnchors.set(qk, i);
        }
        const u = unitByName.get(rm[1]);
        const bkt = bucketOf(u);
        const bk = `${anchorBldg}|${lvl}`;
        if (!bucketLines.has(bk)) bucketLines.set(bk, []);
        bucketLines.get(bk).push({ line: i, bucket: bkt, name: rm[1] });
      }
    }
  }

  // Sort key for the third level: factions list (alphabetized comma-joined). Two units with the
  // same positive faction list end up adjacent — same-faction grouping inside (category, tier).
  function factionsKey(u) {
    return ((u && u.factions) || []).slice().sort().join(",");
  }

  // Dedup the writable list by recruit name first — if the user accidentally has multiple unit
  // entries with the same `unit` field (e.g. from duplicating + repeated imports), emitting all of
  // them would produce multiple identical lines per bucket. We keep the first one.
  const seenWritable = new Set();
  const writableDedup = writableUnits.filter(u => {
    const k = u.unit + "|" + (u.aor && u.aor.aorOnly ? "aoronly" : "");
    if (seenWritable.has(k)) return false;
    seenWritable.add(k);
    return true;
  });

  // Track what's already in each bucket so we never emit two identical lines into the same place.
  const bucketSeen = new Map();
  for (const u of writableDedup) {
    if (!u.enabled) continue;
    // pendingRemoval units are included in writableUnits so their
    // existing lines get stripped above, but we deliberately emit
    // nothing here — they're being removed from the EDB.
    if (u.pendingRemoval) continue;
    const all = [...generatePlayerLines(u), ...generateAORPlayerLines(u), ...generateAILines(u)];
    const newBucket = bucketOf(u);
    const newTier = u.canonicalMicTier ?? u.minTier ?? 1;
    const newFKey = factionsKey(u);
    for (const ln of all) {
      const key = `${ln.building}|${ln.level}`;
      if (buckets.has(key)) {
        // Per-bucket dedup by exact line text.
        if (!bucketSeen.has(key)) bucketSeen.set(key, new Set());
        const seen = bucketSeen.get(key);
        const txtKey = ln.text.replace(/\s+/g, " ").trim();
        if (seen.has(txtKey)) continue;
        seen.add(txtKey);
        const m = ln.text.match(/recruit\s+"([^"]+)"/);
        const unitName = m ? m[1] : null;
        // Anchor priority (matches BD's New Base ordering: category > tier > faction > QC):
        //   1) Unit's own existing line — preserves position exactly.
        //   2) Same Quality Class anchor — groups exact subtype (slingers with slingers).
        //   3) Sorted (bucket, tier, faction) tuple — find first existing line strictly greater
        //      than the new line's tuple and insert before it. This keeps category > tier > faction
        //      ordering consistent with the rest of the EDB.
        //   4) Capability close — last resort (no existing line comes after this one).
        let anchorLine = null;
        if (unitName) {
          const k = `${unitName}|${ln.building}|${ln.level}`;
          if (anchors.has(k)) anchorLine = anchors.get(k);
          else if (u.qualityClass) {
            const qk = `${u.qualityClass}|${ln.building}|${ln.level}`;
            if (qcAnchors.has(qk)) anchorLine = qcAnchors.get(qk);
          }
          if (anchorLine == null) {
            const arr = bucketLines.get(`${ln.building}|${ln.level}`) || [];
            for (const e of arr) {
              const eUnit = unitByName.get(e.name);
              const eTier = eUnit ? (eUnit.canonicalMicTier ?? eUnit.minTier ?? 1) : 1;
              const eFKey = factionsKey(eUnit);
              // Lexicographic compare of (bucket, tier, factionsKey).
              const cmp = e.bucket !== newBucket ? Math.sign(e.bucket - newBucket)
                        : eTier !== newTier ? Math.sign(eTier - newTier)
                        : eFKey < newFKey ? -1 : eFKey > newFKey ? 1 : 0;
              if (cmp > 0) { anchorLine = e.line; break; }
            }
          }
        }
        buckets.get(key).push({ text: ln.text, anchorLine });
      }
    }
  }

  // Emit insertions. For each line: lines with anchors go to their anchor's index; lines without
  // anchors (genuinely new units) go to the capability close line of their target level.
  const insertions = new Map(); // line index → string[]
  const queueAt = (idx, text) => {
    if (!insertions.has(idx)) insertions.set(idx, []);
    insertions.get(idx).push(text);
  };
  for (const t of levelTargets) {
    const key = `${t.building}|${t.level}`;
    const items = buckets.get(key) || [];
    for (const item of items) {
      if (item.anchorLine != null) queueAt(item.anchorLine, item.text);
      else queueAt(t.capabilityCloseLine, item.text);
    }
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

// Round-trip integrity check. Takes the proposed new EDB text (output of applyUnitsToEDB),
// re-parses it, and verifies that every line we INTENDED to emit actually landed at the
// expected (building, level). Catches anchor-heuristic drift and silent corruption that
// the diff modal wouldn't otherwise surface.
export function verifyRoundTrip(newEdbText, units) {
  // pendingRemoval units emit nothing, so they don't show up in the
  // expected set — same as ref-only or disabled.
  const writableUnits = units.filter(u => u.writeBack !== false && u.enabled && !u.pendingRemoval);
  const expected = []; // { unit, building, level }
  for (const u of writableUnits) {
    for (const ln of [...generatePlayerLines(u), ...generateAORPlayerLines(u), ...generateAILines(u)]) {
      const m = ln.text.match(/recruit\s+"([^"]+)"/);
      if (m) expected.push({ unit: m[1], building: ln.building, level: ln.level });
    }
  }
  // Walk the new EDB and record every recruit line's resolved (unit, building, level).
  const found = new Set();
  const lines = newEdbText.split(/\r?\n/);
  let curBuilding = null, curLevels = [], curLevelIdx = -1;
  for (const line of lines) {
    const bm = line.match(/^building\s+([A-Za-z_][A-Za-z0-9_]*)/);
    if (bm) { curBuilding = bm[1]; curLevels = []; curLevelIdx = -1; continue; }
    const lm = line.match(/^\s*levels\s+(.+?)\s*$/);
    if (lm && curBuilding) { curLevels = lm[1].split(/\s+/).filter(Boolean); continue; }
    if (curBuilding && curLevels.length) {
      const head = line.trimStart().match(/^([A-Za-z_][A-Za-z0-9_+\-]*)\s+requires\b/);
      if (head && curLevels.includes(head[1])) curLevelIdx = curLevels.indexOf(head[1]);
    }
    const rm = line.match(/^\s*recruit\s+"([^"]+)"\s+\d+\s+requires\s+/);
    if (rm && curBuilding && curLevelIdx >= 0) {
      found.add(`${rm[1]}|${curBuilding}|${curLevels[curLevelIdx]}`);
    }
  }
  const missing = [];
  const seen = new Set();
  for (const e of expected) {
    const k = `${e.unit}|${e.building}|${e.level}`;
    if (seen.has(k)) continue;
    seen.add(k);
    if (!found.has(k)) missing.push(e);
  }
  return { ok: missing.length === 0, missing, expectedCount: seen.size };
}
