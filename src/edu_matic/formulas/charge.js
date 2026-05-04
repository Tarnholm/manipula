// formulas/charge.js — port of CreateUnitData Case 84 ("primary charge").
//
// VBA L7020–7036:
//   If Ship or Engine: charge = 0
//   If Foot/Foot Missile/Handler:
//     charge = GlobalChargeMdf × (UnitCharge × QualMdf × SpecMdf × CultInfMdf + PriWpnCharge)
//              × Sqrt(UnitSpeed) × Sqrt(SoldierMass / ManMass)
//   If Mounted/Mounted Missile/Special:
//     charge = GlobalChargeMdf × (UnitCharge × QualMdf × SpecMdf × CultCavMdf + PriWpnCharge)
//              × Sqrt(UnitSpeed) × (SoldierMass + HorseMass) × 0.17 / ManMass
//   Clamp 0–63, CInt.
//
// UnitSpeed selection (Case 73 on RTW/ALX):
//   Mounted/Mounted Missile/Special         → MountSkeletonSpeed
//   Foot (melee) / Handler / Engine         → PriMeleeSkeletonSpeed
//   Foot Missile / (Foot with ranged pri)   → SecMeleeSkeletonSpeed


import { cint } from "./attack";

function num(v, dflt) {
  if (v === null || v === undefined || v === "") return dflt;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : dflt;
}
function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }

/** Unit's skeleton-derived speed (pre-global-mdf). Used by charge formula. */
function unitSpeed(r) {
  const catName = String((r.cat && r.cat["Category Type"]) || "").trim().toLowerCase();
  const priRange = num(r.priWpn && r.priWpn["Range"], 0);
  const mountSpeed = num(r.mountSkel && r.mountSkel["Speed"], 1);
  const priSkelSpeed = num(r.priSkel && r.priSkel["Speed"], 1);
  const secSkelSpeed = num(r.secSkel && r.secSkel["Speed"], 1);
  if (catName === "mounted" || catName === "mounted missile" || catName === "special" || catName === "chariot") return mountSpeed;
  if ((catName === "foot" && priRange === 0) || catName === "handler" || catName === "engine") return priSkelSpeed;
  if (catName === "foot missile" || (catName === "foot" && priRange !== 0)) return secSkelSpeed;
  return 1;
}

/**
 * @param {import("../resolve").ResolvedUnit} r
 * @param {{soldierMass:number, horseMass:number}} mr
 * @param {import("../xlsmImporter").Project} project
 * @returns {number|null}
 */
function computeCharge(r, mr, project) {
  const globals = project.globals || {};
  const catName = String((r.cat && r.cat["Category Type"]) || "").trim().toLowerCase();
  if (catName === "ship" || catName === "engine") return 0;
  if (!r.priWpn) return null;

  const gChg     = num(globals.GlobalChargeMdf, 1);
  const unitChg  = num(globals.UnitCharge,      1);
  const manMass  = num(globals.ManMass, 0);

  const qualChg = num(r.qual && r.qual["Charge mdf"],   1);
  const specChg = num(r.spec && r.spec["Charge mdf"],   1);
  const cultInf = num(r.cult && r.cult["Inf charge mdf"], 1);
  const cultCav = num(r.cult && r.cult["Cav charge mdf"], 1);
  const priWpnChg = num(r.priWpn["Charge"], 0);

  const speed = unitSpeed(r);
  let v;
  if (catName === "foot" || catName === "foot missile" || catName === "handler") {
    const base = unitChg * qualChg * specChg * cultInf + priWpnChg;
    v = gChg * base * Math.sqrt(speed) * Math.sqrt(mr.soldierMass / (manMass || 1));
  } else if (catName === "mounted" || catName === "mounted missile" || catName === "special" || catName === "chariot") {
    const base = unitChg * qualChg * specChg * cultCav + priWpnChg;
    v = gChg * base * Math.sqrt(speed) * (mr.soldierMass + mr.horseMass) * 0.17 / (manMass || 1);
  } else {
    return 0;
  }
  return clamp(cint(v), 0, 63);
}

export { computeCharge, unitSpeed };
