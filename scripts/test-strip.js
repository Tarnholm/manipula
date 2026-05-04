// Simulate the strip pass against the real EDB with a list of "writable" unit names.
// Reports how many lines would be removed and where.
const fs = require("fs");
const text = fs.readFileSync("C:\\RIS\\RIS\\data\\export_descr_buildings.txt", "utf8");
const lines = text.split(/\r?\n/);

const TOOL_BUILDINGS = new Set([
  "governmentB", "governmentC", "governmentD",
  "hinterland_region", "military_industrial_complex", "garrison",
]);

const owned = new Set([
  "roman hastati early", "roman principes early", "roman triarii early",
  "roman leves", "roman equites early", "roman rorarii", "roman general", "roman funditores",
]);

let curBuilding = null, curLevels = [], curLevelIdx = -1;
let inCapability = false, capDepth = 0;
const remove = [];
const skippedReasons = [];

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
        if (rm && owned.has(rm[1])) {
          remove.push({ line: i + 1, building: curBuilding, level: curLevels[curLevelIdx], unit: rm[1] });
        }
      }
      if (capDepth <= 0 && /^\s*\}\s*$/.test(line)) { inCapability = false; curLevelIdx = -1; }
    }
  }
}

// Also check what lines exist in the EDB matching the owned units (regardless of strip pass)
const allMatching = [];
let curBldg2 = null;
for (let i = 0; i < lines.length; i++) {
  const ln = lines[i];
  const bm = ln.match(/^building\s+([A-Za-z_][A-Za-z0-9_]*)/);
  if (bm) { curBldg2 = bm[1]; continue; }
  const rm = ln.match(/^\s*recruit\s+"([^"]+)"\s+\d+\s+requires\s+/);
  if (rm && owned.has(rm[1])) {
    allMatching.push({ line: i + 1, building: curBldg2 || "(file-level)", unit: rm[1] });
  }
}

console.log(`Total lines in EDB matching owned units: ${allMatching.length}`);
console.log(`Lines that strip pass WOULD remove: ${remove.length}`);
console.log(`MISSED by strip: ${allMatching.length - remove.length}`);
console.log();

const missed = allMatching.filter(a => !remove.find(r => r.line === a.line));
if (missed.length) {
  console.log("Lines NOT caught by strip pass:");
  // Group by building
  const byBldg = {};
  for (const m of missed) {
    if (!byBldg[m.building]) byBldg[m.building] = [];
    byBldg[m.building].push(m);
  }
  for (const [bldg, hits] of Object.entries(byBldg)) {
    console.log(`  ${bldg}: ${hits.length} lines`);
    for (const h of hits.slice(0, 5)) console.log(`    L${h.line}: "${h.unit}"`);
    if (hits.length > 5) console.log(`    ... and ${hits.length - 5} more`);
  }
} else {
  console.log("All matching lines are caught by strip pass.");
}
