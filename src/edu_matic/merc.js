// merc.js — mercenary pipeline (parallel to main compute/format).
//
// Produces the text content of descr_mercenaries.txt from the project's
// merc rows (pool / regions / unit entries). Each unit's cost defaults
// to the override in the merc row; if that's blank, falls back to the
// computed EDU cost × a global multiplier.


import { compute } from "./compute";

function num(v, dflt) {
  if (v === null || v === undefined || v === "") return dflt;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : dflt;
}

/** Build a cost lookup by unit id from computed DATA rows. */
function buildCostIndex(dataRows) {
  const m = new Map();
  for (const r of dataRows) {
    if (r.kind !== "data") continue;
    const id = r["type"];
    if (id) m.set(String(id).toLowerCase(), r["price"] || 0);
  }
  return m;
}

/**
 * Compute the merc pool data — resolves each unit row's cost from
 * either its override or the computed EDU price × multiplier.
 *
 * @param {import("./xlsmImporter").Project} project
 * @param {number} [multiplier=1.8]
 * @returns {Array<{kind:"pool"|"regions"|"unit"|"blank", text:string}>}
 */
function computeMerc(project, multiplier = 1.8) {
  const dataRows = compute(project);
  const costIdx  = buildCostIndex(dataRows);
  const out = [];
  for (const m of project.merc || []) {
    if (m.kind === "pool") {
      out.push({ kind: "pool", text: `pool ${m.name}` });
    } else if (m.kind === "regions") {
      out.push({ kind: "regions", text: `regions ${m.list}` });
    } else if (m.kind === "unit") {
      const refKey = String(m.refUnitId || m.unitId || "").toLowerCase();
      const derived = costIdx.get(refKey);
      const cost = m.cost != null && m.cost !== "" ? num(m.cost, 0) : Math.round((derived ?? 0) * multiplier);
      const exp = num(m.exp, 0);
      const rmin = num(m.replenishMin, 0);
      const rmax = num(m.replenishMax, 0);
      const maxP = num(m.maxInPool, 1);
      const init = num(m.initial, 0);
      out.push({
        kind: "unit",
        text: `unit ${m.unitId}, exp ${exp} cost ${cost} replenish ${rmin} - ${rmax} max ${maxP} initial ${init}`,
      });
    } else if (m.kind === "blank") {
      out.push({ kind: "blank", text: "" });
    }
  }
  return out;
}

/**
 * Full descr_mercenaries.txt text.
 * @param {import("./xlsmImporter").Project} project
 * @returns {string}
 */
function formatMerc(project) {
  const rows = computeMerc(project);
  return rows.map((r) => r.text).join("\n") + "\n";
}

export { computeMerc, formatMerc };
