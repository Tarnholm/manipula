const path = require("path");
const { readEdumatic } = require(path.join(__dirname, "..", "xlsmReader"));

const xlsm = process.argv[2] || "C:\\Users\\vtarn\\Downloads\\EDU-matic_RIS_0.7.0 239 factions.xlsm";
console.log("Reading:", xlsm);
try {
  const rows = readEdumatic(xlsm);
  console.log("Total rows:", rows.length);
  console.log("\nFirst 3 rows:");
  console.log(JSON.stringify(rows.slice(0, 3), null, 2));

  console.log("\nUnique factions (first 30):");
  console.log([...new Set(rows.flatMap(r => r.factions))].slice(0, 30));

  console.log("\nType breakdown:");
  const typeCounts = {};
  for (const r of rows) {
    const t = r._meta.type || "(unknown)";
    typeCounts[t] = (typeCounts[t] || 0) + 1;
  }
  console.log(typeCounts);

  console.log("\nQuality Class breakdown (top 20):");
  const qcCounts = {};
  for (const r of rows) {
    const q = r.qualityClass || "(none)";
    qcCounts[q] = (qcCounts[q] || 0) + 1;
  }
  console.log(Object.entries(qcCounts).sort((a, b) => b[1] - a[1]).slice(0, 20));

  console.log("\nTier distribution:");
  const tierCounts = {};
  for (const r of rows) tierCounts[r.tier] = (tierCounts[r.tier] || 0) + 1;
  console.log(tierCounts);
} catch (e) {
  console.error("Error:", e.message);
  console.error(e.stack);
}
