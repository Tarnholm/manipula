// End-to-end round-trip check: parse EDB → infer units → regenerate → diff vs. original
// recruit lines (for owned units). Reports drift so we can see which units don't round-trip cleanly.
//
// Run: node scripts/roundtrip.js  [maxReportPerUnit=5]
//
// We don't import the React/ESM modules; we re-implement the core logic here against the same
// algorithms in src/parsers/edb.js and src/generator.js. (Smoke-test only — production code is the
// real source of truth.)

const fs = require("fs");

const EDB_PATH = "C:\\RIS\\RIS\\data\\export_descr_buildings.txt";
const MAX_REPORT = parseInt(process.argv[2] || "3", 10);

const PLAYER_BUILDINGS = ["governmentB", "governmentC", "governmentD"];
const PLAYER_LEVEL = { governmentB: "gov2", governmentC: "gov3", governmentD: "gov4" };
const MIC = "military_industrial_complex";
const MIC_LEVELS = ["mic_1", "mic_2", "mic_3", "mic_4"];
const GARRISON_LEVELS = ["garrison", "garrison+1", "garrison+2"];

const RECRUIT_RE = /^\s*recruit\s+"([^"]+)"\s+(\d+)\s+requires\s+(.+?)\s*$/;

function parseAllRecruits(text) {
  const lines = text.split(/\r?\n/);
  const out = [];
  let curBuilding = null, curLevels = [], curLevelIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    const ln = lines[i];
    const bm = ln.match(/^building\s+([A-Za-z_][A-Za-z0-9_]*)/);
    if (bm) { curBuilding = bm[1]; curLevels = []; curLevelIdx = -1; continue; }
    const lm = ln.match(/^\s*levels\s+(.+?)\s*$/);
    if (lm && curBuilding) { curLevels = lm[1].split(/\s+/).filter(Boolean); continue; }
    if (curBuilding && curLevels.length) {
      const head = ln.trimStart().match(/^([A-Za-z_][A-Za-z0-9_+\-]*)\s+requires\b/);
      if (head && curLevels.includes(head[1])) curLevelIdx = curLevels.indexOf(head[1]);
    }
    const rm = ln.match(RECRUIT_RE);
    if (rm && curBuilding && curLevelIdx >= 0) {
      out.push({
        unit: rm[1], xp: parseInt(rm[2], 10), requires: rm[3],
        building: curBuilding, level: curLevels[curLevelIdx], line: i,
      });
    }
  }
  return out;
}

function splitOnAnd(s) {
  const out = []; let cur = ""; let depth = 0;
  const tokens = s.split(/(\s+and\s+)/);
  for (const tok of tokens) {
    if (/^\s+and\s+$/.test(tok) && depth === 0) { out.push(cur); cur = ""; }
    else { cur += tok; depth += (tok.match(/\{/g) || []).length - (tok.match(/\}/g) || []).length; }
  }
  if (cur) out.push(cur);
  return out;
}
function extractFactions(requires) {
  const m = requires.match(/factions\s*\{\s*([^}]*)\}/);
  return m ? m[1].split(",").map(s => s.trim()).filter(Boolean) : [];
}
function extractCoreRequires(requires) {
  return splitOnAnd(requires).filter(p => {
    const t = p.trim();
    return !(/^factions \{/.test(t)
      || /^not factions \{/.test(t)
      || /^is_player$/.test(t)
      || /^not is_player$/.test(t)
      || /^mic_tier_\d$/.test(t)
      || /^colony_tier_\d$/.test(t)
      || /^gov_tier_\d$/.test(t)
      || /^noisland$/.test(t));
  }).map(s => s.trim());
}
function detectMinTier(requires) {
  const m = requires.match(/mic_tier_(\d)/);
  return m ? parseInt(m[1], 10) : null;
}

function tierOfLevel(b, lvl) {
  if (b === MIC) { const m = lvl.match(/^mic_(\d)$/); return m ? parseInt(m[1], 10) : null; }
  if (b === "garrison") {
    if (lvl === "garrison") return 1;
    const m = lvl.match(/^garrison\+(\d)$/);
    return m ? parseInt(m[1], 10) + 1 : null;
  }
  return null;
}

function inferUnits(recs) {
  const map = new Map();
  for (const r of recs) {
    if (!map.has(r.unit)) map.set(r.unit, []);
    map.get(r.unit).push(r);
  }
  const units = [];
  for (const [unit, entries] of map) {
    const ai = entries.filter(e => /\bnot is_player\b/.test(e.requires));
    const pl = entries.filter(e => /\bis_player\b/.test(e.requires) && !/\bnot is_player\b/.test(e.requires));
    if (!ai.length && !pl.length) continue;
    const unitType = pl.some(e => e.building === "hinterland_region") ? "aor" : "faction";
    const factions = [...new Set(entries.flatMap(e => extractFactions(e.requires)))];
    const excludeFactions = (() => {
      for (const e of entries) {
        const m = e.requires.match(/not factions\s*\{\s*([^}]*)\}/);
        if (m) return m[1].split(",").map(s => s.trim()).filter(Boolean);
      }
      return [];
    })();
    const tiers = pl.map(e => detectMinTier(e.requires)).filter(t => t != null);
    const minTier = tiers.length ? Math.min(...tiers) : 1;
    const requires = [...new Set(entries.flatMap(e => extractCoreRequires(e.requires)))];
    const xpEntries = ai.filter(e => e.xp > 0);
    let xp = null;
    if (xpEntries.length) {
      const micXp = xpEntries.filter(e => e.building === "military_industrial_complex");
      if (micXp.length) {
        const t = Math.min(...micXp.map(e => parseInt((e.level.match(/^mic_(\d)$/) || [])[1] || "99", 10)));
        xp = { startTier: t, value: Math.max(...xpEntries.map(e => e.xp)) };
      } else {
        xp = { startTier: 4, value: Math.max(...xpEntries.map(e => e.xp)) };
      }
    }
    units.push({
      unit, unitType, minTier, factions, excludeFactions, requires, xp,
      aiOnly: ai.length > 0 && pl.length === 0,
      playerOnly: pl.length > 0 && ai.length === 0,
      origLines: entries.length,
    });
  }
  return units;
}

function joinAnd(parts) { return parts.filter(Boolean).join(" and "); }
function fmt(factions) { return `factions { ${(factions && factions.length ? factions : ["all"]).join(", ")}, }`; }
function fmtExclude(ex) { return ex && ex.length ? `not factions { ${ex.join(", ")}, }` : ""; }
function xpForLine(unit, b, lvl) {
  if (!unit.xp) return 0;
  if (b === MIC) {
    const m = lvl.match(/^mic_(\d)$/);
    if (!m) return 0;
    return parseInt(m[1]) >= unit.xp.startTier ? unit.xp.value : 0;
  }
  if (b === "garrison") return lvl === "garrison+2" ? unit.xp.value : 0;
  return 0;
}

function generate(unit) {
  const out = [];
  if (!unit.aiOnly) {
    if (unit.unitType === "aor") {
      out.push({
        building: "hinterland_region", level: "region_base", xp: 0, unit: unit.unit,
        requires: joinAnd([fmt(unit.factions), "is_player", fmtExclude(unit.excludeFactions), `mic_tier_${unit.minTier}`, ...unit.requires, "gov_tier_1"]),
      });
    } else {
      for (const b of PLAYER_BUILDINGS) {
        out.push({
          building: b, level: PLAYER_LEVEL[b], xp: 0, unit: unit.unit,
          requires: joinAnd([fmt(unit.factions), "is_player", fmtExclude(unit.excludeFactions), `mic_tier_${unit.minTier}`, ...unit.requires]),
        });
      }
    }
  }
  if (!unit.playerOnly) {
    for (let t = unit.minTier; t <= 4; t++) {
      out.push({
        building: MIC, level: MIC_LEVELS[t - 1], xp: xpForLine(unit, MIC, MIC_LEVELS[t - 1]), unit: unit.unit,
        requires: joinAnd([fmt(unit.factions), "not is_player", fmtExclude(unit.excludeFactions), ...unit.requires, "noisland"]),
      });
    }
    if (unit.minTier === 1) {
      for (const lvl of GARRISON_LEVELS) {
        out.push({
          building: "garrison", level: lvl, xp: xpForLine(unit, "garrison", lvl), unit: unit.unit,
          requires: joinAnd([fmt(unit.factions), "not is_player", fmtExclude(unit.excludeFactions), ...unit.requires, "noisland"]),
        });
      }
    }
  }
  return out;
}

// ── run ──
const text = fs.readFileSync(EDB_PATH, "utf8");
const recs = parseAllRecruits(text);
console.log(`Parsed ${recs.length} recruit lines from EDB.`);

const units = inferUnits(recs);
console.log(`Inferred ${units.length} unit definitions.`);

// For each owned unit, compare original lines vs regenerated (line counts + per-(building,level,xp,requires) match)
let totalUnits = 0, perfect = 0, drifted = 0, missing = 0;
const driftReports = [];

for (const u of units) {
  totalUnits++;
  const origLinesByKey = new Map(); // key = building|level|xp → original requires
  for (const r of recs.filter(r => r.unit === u.unit)) {
    origLinesByKey.set(`${r.building}|${r.level}|${r.xp}`, r.requires);
  }
  const generated = generate(u);
  let exactCount = 0, drift = 0;
  const drifts = [];
  for (const g of generated) {
    const k = `${g.building}|${g.level}|${g.xp}`;
    if (origLinesByKey.has(k)) {
      // Compare requires (after light normalization)
      const orig = origLinesByKey.get(k).replace(/\s+/g, " ").trim();
      const reg = g.requires.replace(/\s+/g, " ").trim();
      if (orig === reg) exactCount++;
      else { drift++; drifts.push({ key: k, orig, reg }); }
    } else {
      drift++;
      drifts.push({ key: k, orig: "(MISSING)", reg: g.requires });
    }
  }
  const origExtra = [];
  for (const k of origLinesByKey.keys()) {
    if (!generated.find(g => `${g.building}|${g.level}|${g.xp}` === k)) {
      origExtra.push({ key: k, orig: origLinesByKey.get(k) });
    }
  }
  if (drift === 0 && origExtra.length === 0) perfect++;
  else if (origExtra.length > 0 && drift === 0) {
    // Original has more lines than we'd generate (e.g. capital_treasury, multi-tier garrison etc.)
    missing++;
    if (driftReports.length < MAX_REPORT) {
      driftReports.push({ unit: u.unit, type: "missing", origExtra: origExtra.slice(0, 5) });
    }
  } else {
    drifted++;
    if (driftReports.length < MAX_REPORT) {
      driftReports.push({ unit: u.unit, type: "drift", drifts: drifts.slice(0, 5), origExtra: origExtra.slice(0, 5) });
    }
  }
}

console.log(`\nResult:`);
console.log(`  Perfect round-trip:   ${perfect}/${totalUnits}`);
console.log(`  Has drift in lines:   ${drifted}`);
console.log(`  Original has extras:  ${missing}  (units our generator wouldn't fully cover yet)`);

if (driftReports.length) {
  console.log(`\nFirst ${driftReports.length} drift samples:`);
  for (const r of driftReports) {
    console.log(`\n  Unit: "${r.unit}"  (${r.type})`);
    if (r.drifts) for (const d of r.drifts) {
      console.log(`    [${d.key}]`);
      console.log(`      orig: ${d.orig}`);
      console.log(`      regn: ${d.reg}`);
    }
    if (r.origExtra) for (const e of r.origExtra) {
      console.log(`    EXTRA orig [${e.key}]:`);
      console.log(`      ${e.orig}`);
    }
  }
}
