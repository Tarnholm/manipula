// formulas/stats.js — batch port of the "stat_*" cases:
//
//   Case 169 'stat_heat'         — armour burden + quality + dwelling
//   Case 170 'scrub'             — additive terrain bonuses from spec/form/dwell/weapons/mount
//   Case 171 'sand'              — same shape
//   Case 172 'forest'            — same shape
//   Case 173 'snow'              — same shape
//   Case 174 'morale'            — UnitMorale × chain + ArmourMorale bonus
//   Case 175 'discipline'        — "low"/"normal"/"disciplined"/"impetuous"
//   Case 176 'training'          — "untrained"/"trained"/"highly_trained"
//   Case 177 'mrl lock'          — "lock_morale" if standard engine
//   Case 178 'charge dist'       — CatCategoryChargeDist, 0 if phalanx (except germanic_infantry)
//   Case 179 'fire delay'        — constant 0
//   Case 180 'food 1'            — constant 60
//   Case 181 'food 2'            — constant 300


import { cint } from "./attack";

function num(v, dflt) {
  if (v === null || v === undefined || v === "") return dflt;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : dflt;
}
function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }
function str(v) { return v == null ? "" : String(v); }
function hasWpn(row) { return !!(row && row["Weapon Type"]); }

/** Sum of terrain bonus contributions across all row sources (as per VBA). */
function groundBonus(r, key, isM2_unused, meleeFraction) {
  // Column key is literal in core-data (e.g. "scrub", "sand", "forest", "snow").
  const spec = num(r.spec && r.spec[key], 0);
  const form = num(r.form && r.form[key], 0);
  const dwel = num(r.dwel && r.dwel[key], 0);
  const priW = num(r.priWpn && r.priWpn[key], 0);
  const secW = num(r.secWpn && r.secWpn[key], 0);
  const mnt  = num(r.mount && r.mount[key], 0);
  const spMt = num(r.spMount && r.spMount[key], 0);
  if (!hasWpn(r.secWpn)) {
    return spec + form + dwel + priW + mnt + spMt;
  }
  // When a secondary weapon is present, primary/secondary weapons blend
  // by MeleeFraction (VBA L7602). Note "forest" re-includes FormationForestBon
  // (L7630) but the other three don't — faithful VBA replication.
  let v = spec + dwel + priW * meleeFraction + secW * (1 - meleeFraction) + mnt + spMt;
  if (key === "forest") v += form;
  return v;
}

/**
 * Produce all stat_* columns for one resolved unit.
 *
 * @param {import("../resolve").ResolvedUnit} r
 * @param {{mass:number|null, soldierMass:number, horseMass:number,
 *          armour:{heatMdf:number}}} mr
 * @param {import("../xlsmImporter").Project} project
 * @param {number} unitPriArmour   computed primary armour stat (Case 154 output)
 * @returns {object}
 */
function computeStats(r, mr, project, unitPriArmour) {
  const out = {};
  const globals = project.globals || {};
  const platform = String(project.modInfo?.platform || "");
  const isM2 = platform === "M2TW" || platform === "KGDM";
  const catName = String((r.cat && r.cat["Category Type"]) || "").trim();
  const cat = catName.toLowerCase();

  // ── Case 169 stat_heat ──────────────────────────────────────
  const extraMassPerHeat = num(globals.ExtraMassPerHeat, 1);
  const baseHorseMass    = num(globals.BaseHorseMass, 1);
  const manMass          = num(globals.ManMass, 0);
  const qualHeat = num(r.qual && r.qual["Heat fatigue mdf"], 0);
  // v0.7.0 renamed the dwelling heat column from "Heat mdf" to "heat modifier".
  const dwelHeat = num((r.dwel && r.dwel["heat modifier"]) ?? (r.dwel && r.dwel["Heat mdf"]), 0);

  let heat;
  if (cat === "foot" || cat === "foot missile" || cat === "handler" || cat === "engine") {
    heat = cint(mr.armour.heatMdf * ((mr.soldierMass - manMass) / extraMassPerHeat))
         + qualHeat + dwelHeat;
  } else if (cat === "mounted" || cat === "mounted missile") {
    heat = cint(mr.armour.heatMdf * (((mr.horseMass + mr.soldierMass) / baseHorseMass) +
                                     0.7 * ((mr.soldierMass - manMass) / extraMassPerHeat)))
         + qualHeat + dwelHeat;
  } else if (cat === "special" || cat === "chariot") {
    const spMass = num(r.spMount && r.spMount["Mount mass"], 0);
    const hcvt = num(globals.HeavyCavThreshold, 1);
    heat = cint(Math.sqrt(spMass / hcvt)) + dwelHeat;
  } else if (cat === "ship") {
    heat = 0;
  } else {
    heat = 0;
  }
  const heatMax = isM2 ? 6 : 5;
  out["heat"] = clamp(cint(heat), -2, heatMax);

  // ── Cases 170–173 ground effects (scrub/sand/forest/snow) ─
  const meleeFrac = num(globals.MeleeFraction, 0.5);
  for (const k of ["scrub", "sand", "forest", "snow"]) {
    const v = groundBonus(r, k, isM2, meleeFrac);
    out[k] = clamp(cint(v), -8, 8);
  }

  // ── Case 174 morale ─────────────────────────────────────────
  const gMorale = num(globals.GlobalMoraleMdf, 1);
  const unitMorale = num(globals.UnitMorale, 1);
  const armourMoraleMdf = num(globals.ArmourMoraleMdf, 0);
  const qualMorale = num(r.qual && r.qual["Morale mdf"], 1);
  const specMorale = num(r.spec && r.spec["Morale mdf"], 1);
  const cultInfMorale = num(r.cult && r.cult["Inf morale mdf"], 1);
  const cultCavMorale = num(r.cult && r.cult["Cav morale mdf"], 1);
  const qualStartExp = num(r.qual && r.qual["Start exp"], 0);
  const isHorde = r.unit["horde unit"] ? 1 : 0;

  let morale;
  if (cat === "foot" || cat === "foot missile" || cat === "handler" || cat === "engine") {
    morale = gMorale * (unitMorale * qualMorale * specMorale * cultInfMorale
                        + unitPriArmour * armourMoraleMdf + isHorde * 3) - qualStartExp;
  } else if (cat === "mounted" || cat === "mounted missile" || cat === "special" || cat === "chariot") {
    morale = gMorale * (unitMorale * qualMorale * specMorale * cultCavMorale
                        + unitPriArmour * armourMoraleMdf + isHorde * 3) - qualStartExp;
  } else if (cat === "ship") {
    morale = num(r.ship && r.ship["Morale"], 0);
  } else {
    morale = 0;
  }
  out["morale"] = clamp(cint(morale), 0, 63);

  // ── Case 175 discipline ─────────────────────────────────────
  if (r.unit["impetuous unit"]) {
    out["discipline"] = "impetuous";
  } else {
    const unitDisc = num(globals.UnitDiscipline, 1);
    const qualTrainMdf = num(r.qual && r.qual["Training mdf"], 0);
    let soldierDisc;
    if (cat === "foot" || cat === "foot missile" || cat === "handler" || cat === "engine") {
      soldierDisc = unitDisc + qualTrainMdf + num(r.cult && r.cult["Inf discipline"], 0);
    } else if (cat === "mounted" || cat === "mounted missile" || cat === "special" || cat === "chariot") {
      soldierDisc = unitDisc + qualTrainMdf + num(r.cult && r.cult["Cav discipline"], 0);
    } else {
      soldierDisc = 1;
    }
    const specDisc = str(r.spec && r.spec["discipline"]).toLowerCase();
    if ((specDisc === "" && soldierDisc < 1) || specDisc === "low") out["discipline"] = "low";
    else if ((specDisc === "" && soldierDisc < 2) || specDisc === "normal") out["discipline"] = "normal";
    else out["discipline"] = "disciplined";
  }

  // ── Case 176 training ───────────────────────────────────────
  const unitTraining = num(globals.UnitTraining, 1);
  const qualTrainMdf = num(r.qual && r.qual["Training mdf"], 0);
  const formTraining = num(r.form && r.form["Training"], -1);
  let soldierTraining;
  if (cat === "foot" || cat === "foot missile" || cat === "handler" || cat === "engine") {
    soldierTraining = (formTraining === -1)
      ? unitTraining + qualTrainMdf + num(r.cult && r.cult["Inf training"], 0)
      : formTraining;
  } else if (cat === "mounted" || cat === "mounted missile" || cat === "special" || cat === "chariot") {
    soldierTraining = (formTraining === -1)
      ? unitTraining + qualTrainMdf + num(r.cult && r.cult["Cav training"], 0)
      : formTraining;
  } else {
    soldierTraining = 2;
  }
  const specTraining = str(r.spec && r.spec["training"]).toLowerCase();
  if ((specTraining === "" && soldierTraining < 1) || specTraining === "untrained") out["training"] = "untrained";
  else if ((specTraining === "" && soldierTraining < 2) || specTraining === "trained") out["training"] = "trained";
  else out["training"] = "highly_trained";

  // ── Case 177 mrl lock (only standard engines) ───────────────
  if (str(r.engine && r.engine["Engine type"]).toLowerCase() === "standard") {
    out["mrl lock"] = "lock_morale";
  }

  // ── Case 178 charge distance ────────────────────────────────
  // VBA: if the formation's special formation is "phalanx" AND culture
  // is not germanic_infantry, charge dist is 0; otherwise use the
  // category's charge distance.
  const spForm = str(r.form && r.form["Formation 2"]).toLowerCase();
  const cultName = str(r.cult && r.cult["Culture Type"]).toLowerCase();
  if (spForm === "phalanx" && cultName !== "germanic_infantry") {
    out["charge dist"] = 0;
  } else {
    out["charge dist"] = num(r.cat && r.cat["Charge dist"], 0);
  }

  // ── Case 179 fire delay / Case 180-181 food (constants) ────
  out["fire delay"] = 0;
  out["food1"] = 60;
  out["food2"] = 300;

  return out;
}

export { computeStats };
