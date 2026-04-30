const path = require("path");
const { readEdumatic } = require(path.join(__dirname, "..", "xlsmReader"));

const xlsm = process.argv[2] || "C:\\Users\\vtarn\\Downloads\\BD's New Base.xlsm";
const r = readEdumatic(xlsm);
const multi = r.filter(x => x.factions.length > 1);
console.log("Multi-faction rows:", multi.length);
console.log("First 3 multi-faction:");
for (const m of multi.slice(0, 3)) console.log(JSON.stringify({ unit: m.unit, factions: m.factions }));
console.log();
const totalFactions = new Set(r.flatMap(x => x.factions));
console.log("Total unique factions:", totalFactions.size);
