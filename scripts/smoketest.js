// Smoke test: parse real EDB, find roman_rorarii, regenerate from inferred fields, diff.
// Run: node scripts/smoketest.js
const fs = require("fs");
const path = require("path");

// Reuse the parsers and generator by transpiling-on-the-fly via require hooks isn't worth it —
// the modules are pure ES; we'll use a tiny dynamic import via vm. Easier: copy the relevant
// logic inline. (Keeping smoketest small to avoid bundling.)
//
// Instead, we shell out to a temp script that the CRA bundle compiles. Easiest: just import-style
// using node's --experimental-vm-modules is overkill. We re-export the small bits.
//
// Simplest: use babel via @babel/register if installed; otherwise read the files and eval.
// For our purposes, just hard-code minimal versions.

const EDB = fs.readFileSync("C:\\RIS\\RIS\\data\\export_descr_buildings.txt", "utf8");
const lines = EDB.split(/\r?\n/);

// Find every line for "roman rorarii"
const rec = [];
let curBuilding = null;
let curLevels = [];
let curLevelIdx = -1;
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
  const rm = ln.match(/^\s*recruit\s+"([^"]+)"\s+(\d+)\s+requires\s+(.+?)\s*$/);
  if (rm && rm[1] === "roman rorarii" && curBuilding && curLevelIdx >= 0) {
    rec.push({ building: curBuilding, level: curLevels[curLevelIdx], xp: parseInt(rm[2], 10), requires: rm[3], line: i });
  }
}
console.log(`Found ${rec.length} roman rorarii recruit lines:`);
for (const r of rec) console.log(`  ${r.building}/${r.level}  xp=${r.xp}  line=${r.line}`);

// Expected: 3 player (governmentB/C/D, gov2/3/4) + 4 AI MIC (mic_1..mic_4) + 3 AI garrison (garrison/+1/+2) = 10
console.log(`\nExpected: 3 player gov + 4 AI MIC + 3 AI garrison = 10 lines`);

const players = rec.filter(r => /\bis_player\b/.test(r.requires) && !/not is_player/.test(r.requires));
const ai = rec.filter(r => /not is_player/.test(r.requires));
console.log(`Player lines: ${players.length} (buildings: ${[...new Set(players.map(p => p.building))].join(", ")})`);
console.log(`AI lines: ${ai.length} (buildings: ${[...new Set(ai.map(p => p.building))].join(", ")})`);

const xpEntries = rec.filter(r => r.xp > 0);
console.log(`XP > 0 lines: ${xpEntries.length}`);
for (const e of xpEntries) console.log(`  ${e.building}/${e.level} xp=${e.xp}`);
