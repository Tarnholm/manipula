// End-to-end test of applyUnitsToEDB with hypothetical Roman writable units, then check for duplicate
// recruit lines in the output.
const fs = require("fs");
const path = require("path");

// The generator module is ES-format, so we transpile-on-the-fly via require with a small shim.
// Easier: re-implement applyUnitsToEDB inline using the exact logic from src/generator.js.
// (Tests just the strip+insert behavior end to end.)

const TOOL_BUILDINGS = new Set(["governmentB", "governmentC", "governmentD",
  "hinterland_region", "military_industrial_complex", "garrison"]);
const PLAYER_BUILDINGS = ["governmentB", "governmentC", "governmentD"];
const PLAYER_BUILDING_LEVEL = { governmentB: "gov2", governmentC: "gov3", governmentD: "gov4" };
const MIC_BUILDING = "military_industrial_complex";
const MIC_LEVELS = ["mic_1", "mic_2", "mic_3", "mic_4"];
const GARRISON_BUILDING = "garrison";
const GARRISON_LEVELS = ["garrison", "garrison+1", "garrison+2"];
const AOR_PLAYER_BUILDING = "hinterland_region";
const AOR_PLAYER_LEVEL = "region_base";

function joinAnd(parts) {
  const seen = new Set(); const out = [];
  for (const p of parts) {
    if (!p) continue;
    const key = String(p).replace(/\s+/g, " ").trim();
    if (!key || seen.has(key)) continue;
    seen.add(key); out.push(p);
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

function generatePlayerLines(u) {
  if (u.aor && u.aor.enabled && u.aor.aorOnly) return [];
  const lines = [];
  const homelandReqs = () => joinAnd([
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
  if (u.emitGovD) lines.push({ building: "governmentD", level: "gov4", text: `\t\t\trecruit "${u.unit}" 0 requires ${homelandReqs()}` });
  if (u.emitGovC) lines.push({ building: "governmentC", level: "gov3", text: `\t\t\trecruit "${u.unit}" 0 requires ${outsideReqs()}` });
  if (u.emitGovB) lines.push({ building: "governmentB", level: "gov2", text: `\t\t\trecruit "${u.unit}" 0 requires ${outsideReqs()}` });
  return lines;
}

function aorEmitsLines(u) {
  if (!u.aor || !u.aor.enabled) return false;
  if (/^merc\s+/i.test(u.unit || "")) return false;
  return true;
}
function aorRecruitName(u) {
  if (!u.aor) return null;
  if (u.aor.aorOnly) return u.aor.recruitName || u.unit;
  return `aor ${u.unit}`;
}

function generateAILines(u) {
  if (!u.enabled) return [];
  const out = [];
  const isAorOnly = !!(u.aor && u.aor.enabled && u.aor.aorOnly);
  if (!isAorOnly) pushAILinesFor(out, u, false);
  if (aorEmitsLines(u) || isAorOnly) pushAILinesFor(out, u, true);
  return out;
}
function pushAILinesFor(out, u, isAor) {
  const recruitName = isAor ? aorRecruitName(u) : u.unit;
  const factions = isAor ? ["all"] : (u.factions || ["all"]);
  const exclude = isAor ? (u.aor.aorOnly ? [] : (u.factions || [])) : (u.excludeFactions || []);
  const buildReq = () => joinAnd([
    fmtFactions(factions), "not is_player", fmtExcludeFactions(exclude),
    ...(u.commonRequires || []), "noisland", u.aiHomeland ? "homeland" : "",
  ]);
  const minTier = u.canonicalMicTier;
  for (let t = minTier; t <= 4; t++) {
    out.push({ building: MIC_BUILDING, level: MIC_LEVELS[t - 1], text: `\t\t\trecruit "${recruitName}" 0 requires ${buildReq()}` });
  }
  if (minTier === 1) {
    for (const lvl of GARRISON_LEVELS) {
      out.push({ building: GARRISON_BUILDING, level: lvl, text: `\t\t\trecruit "${recruitName}" 0 requires ${buildReq()}` });
    }
  }
}

function applyUnitsToEDB(originalEDB, units) {
  const lines = originalEDB.split(/\r?\n/);
  const writableUnits = units.filter(u => u.writeBack !== false);
  const ownedRecruitNames = new Set();
  for (const u of writableUnits) {
    if (!(u.aor && u.aor.enabled && u.aor.aorOnly)) ownedRecruitNames.add(u.unit);
    if (aorEmitsLines(u) || (u.aor && u.aor.enabled && u.aor.aorOnly)) ownedRecruitNames.add(aorRecruitName(u));
  }

  // SCAN levelTargets
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
          if (TOOL_BUILDINGS.has(curBuilding)) levelTargets.push({ building: curBuilding, level: curLevels[curLevelIdx], capabilityCloseLine: i });
          inCapability = false; curLevelIdx = -1;
        }
      }
    }
  }

  // STRIP
  const remove = new Set();
  curBuilding = null; curLevels = []; curLevelIdx = -1; inCapability = false; capDepth = 0;
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
          if (rm && ownedRecruitNames.has(rm[1])) remove.add(i);
        }
        if (capDepth <= 0 && /^\s*\}\s*$/.test(line)) { inCapability = false; curLevelIdx = -1; }
      }
    }
  }

  // BUCKET + INSERT
  const buckets = new Map();
  for (const t of levelTargets) buckets.set(`${t.building}|${t.level}`, []);
  for (const u of writableUnits) {
    if (!u.enabled) continue;
    const all = [...generatePlayerLines(u), ...generateAILines(u)];
    for (const ln of all) {
      const key = `${ln.building}|${ln.level}`;
      if (buckets.has(key)) buckets.get(key).push(ln.text);
    }
  }
  const insertions = new Map();
  for (const t of levelTargets) {
    const lns = buckets.get(`${t.building}|${t.level}`) || [];
    if (lns.length) insertions.set(t.capabilityCloseLine, lns.slice());
  }
  const next = [];
  for (let i = 0; i < lines.length; i++) {
    if (insertions.has(i)) for (const b of insertions.get(i)) next.push(b);
    if (remove.has(i)) continue;
    next.push(lines[i]);
  }
  return next.join("\r\n");
}

const text = fs.readFileSync("C:\\RIS\\RIS\\data\\export_descr_buildings.txt", "utf8");
const units = [
  { unit: "roman rorarii", enabled: true, writeBack: true,
    canonicalMicTier: 1, homelandMicTier: 1, colonyTier: 1, outsideExtras: [],
    emitGovB: true, emitGovC: true, emitGovD: true,
    factions: ["romans_julii", "roman_rebels_1", "roman_rebels_2", "roman_senate"],
    excludeFactions: [], commonRequires: [] },
  { unit: "roman hastati early", enabled: true, writeBack: true,
    canonicalMicTier: 1, homelandMicTier: 1, colonyTier: 1, outsideExtras: ["hidden_resource italic"],
    emitGovB: true, emitGovC: true, emitGovD: true,
    factions: ["romans_julii", "roman_rebels_1", "roman_rebels_2", "roman_senate"],
    excludeFactions: [], commonRequires: ['not major_event "marian_reforms"'] },
];
const out = applyUnitsToEDB(text, units);
const outLines = out.split(/\r\n/);

// Count "roman rorarii" and "roman hastati early" lines in OUTPUT
let rorariiCount = 0, hastatiCount = 0;
for (const ln of outLines) {
  if (/recruit\s+"roman rorarii"/.test(ln)) rorariiCount++;
  if (/recruit\s+"roman hastati early"/.test(ln)) hastatiCount++;
}
console.log("Output recruit-line counts:");
console.log("  roman rorarii:", rorariiCount);
console.log("  roman hastati early:", hastatiCount);
console.log();
console.log("Original EDB had:");
const origLines = text.split(/\r?\n/);
let oRor = 0, oHas = 0;
for (const ln of origLines) {
  if (/recruit\s+"roman rorarii"/.test(ln)) oRor++;
  if (/recruit\s+"roman hastati early"/.test(ln)) oHas++;
}
console.log("  roman rorarii:", oRor);
console.log("  roman hastati early:", oHas);
console.log();
console.log("Expected after write (based on tool's emission rules):");
console.log("  roman rorarii: 3 player (B/C/D) + 4 MIC + 3 garrison = 10");
console.log("  roman hastati early: 3 player + 4 MIC + 3 garrison = 10");
