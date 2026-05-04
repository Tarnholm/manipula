// formulas/vs.js — port of CreateUnitData Cases 38–41 (VS horse /
// elephant / chariot / camel bonuses).
//
// VBA L6423–6551:
//   1. sum contributions from spec + dwell + weapons + mount + special mount,
//      blended by MeleeFraction when a secondary weapon is present
//   2. clamp each to ±31
//   3. "keep top 2 magnitude" filter: if all four are nonzero, zero the
//      smallest-magnitude pair (VBA does it via two nested comparisons —
//      replicated faithfully)
//   4. emit as "horse +N" / "horse -N" / ...


import { cint } from "./attack";

function num(v, dflt) {
  if (v === null || v === undefined || v === "") return dflt;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : dflt;
}
function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }

function sumBonus(r, keyTable, priKey, projKey, withSec, meleeFrac) {
  const spec = num(r.spec    && r.spec[keyTable],    0);
  const dwel = num(r.dwel    && r.dwel[keyTable],    0);
  const priW = num(r.priWpn  && r.priWpn[priKey],    0);
  const proj = num(r.projectile && r.projectile[projKey], 0);
  const secW = num(r.secWpn  && r.secWpn[priKey],    0);
  const mnt  = num(r.mount   && r.mount[keyTable],   0);
  const spMt = num(r.spMount && r.spMount[keyTable], 0);
  if (!withSec) return spec + dwel + priW + proj + mnt + spMt;
  return spec + dwel + (priW + proj) * meleeFrac + secW * (1 - meleeFrac) + mnt + spMt;
}

/** @param {import("../resolve").ResolvedUnit} r */
function computeVS(r, project) {
  const globals = project.globals || {};
  const out = {};
  const withSec = !!r.secWpn;
  const mf = num(globals.MeleeFraction, 0.5);
  const fractions = {
    horse:    num(globals.HorseFraction,    0),
    elephant: num(globals.ElephantFraction, 0),
    chariot:  num(globals.ChariotFraction,  0),
    camel:    num(globals.CamelFraction,    0),
  };
  // column name in each core-data table:
  const cols = {
    horse:    ["vs horse",    "vs horse"],
    elephant: ["vs elephant", "vs elephant"],
    chariot:  ["vs chariot",  "vs chariot"],
    camel:    ["vs camel",    "vs camel"],
  };

  // Compute each bonus if its fraction > 0.
  /** @type {Record<string, number|null>} */
  const vals = { horse: 0, elephant: 0, chariot: 0, camel: 0 };
  for (const k of Object.keys(fractions)) {
    if (fractions[k] > 0) {
      vals[k] = clamp(sumBonus(r, cols[k][0], cols[k][1], cols[k][1], withSec, mf), -31, 31);
    }
  }

  // Keep-top-2 filter: if all four are nonzero, drop the smallest-magnitude
  // pair via VBA's nested-compare structure.
  const allNonzero = ["horse","elephant","chariot","camel"].every((k) => vals[k] !== 0);
  if (allNonzero) {
    const A = Math.abs(vals.horse), B = Math.abs(vals.elephant),
          C = Math.abs(vals.chariot), D = Math.abs(vals.camel);
    if (A < B) {
      if (A < C) { if (A < D) vals.horse = 0; else vals.camel = 0; }
      else       { if (C < D) vals.chariot = 0; else vals.camel = 0; }
    } else {
      if (B < C) { if (B < D) vals.elephant = 0; else vals.camel = 0; }
      else       { if (C < D) vals.chariot = 0; else vals.camel = 0; }
    }
  }

  // Emit pre-formatted strings ("horse +N" / "horse -N") matching cached
  // DATA and what the EDU `stat_pri_attr` / `stat_sec_attr` lines want.
  // A numeric alias (`vs_horse_n` etc.) is also kept for downstream math.
  for (const k of Object.keys(vals)) {
    const n = cint(vals[k]);
    if (n === 0) continue;
    out[`vs_${k}`]   = n > 0 ? `${k} +${n}` : `${k} ${n}`;
    out[`vs_${k}_n`] = n;
  }
  return out;
}

export { computeVS };
