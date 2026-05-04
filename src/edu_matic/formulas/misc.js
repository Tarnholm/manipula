// formulas/misc.js — class determination, HP, spacing, formation 1/2.
//
//   Case 5  'class'               — spearmen/light/heavy/missile/skirmish
//   Case 74 'h. cl. spacing'      — CatHrClSpace × FormHrClSpaceMdf
//   Case 75 'v. cl. spacing'      — CatVrClSpace × FormVrClSpaceMdf
//   Case 76 'h. l. spacing'       — CatHrLsSpace × FormHrLsSpaceMdf
//   Case 77 'v. l. spacing'       — CatVrLsSpace × FormVrLsSpaceMdf
//   Case 78 'ranks'               — FormationRanks (or CatRanks if -1)
//   Case 79 'formation1'          — FormationPriFormation
//   Case 80 'formation2'          — conditional wedge/phalanx/testudo/shield_wall/schiltrom/horde
//   Case 81 'hp'                  — UnitPriHP (×2 for Chariot specialty)
//   Case 82 'sec hp'              — category-dependent; Case 82 branches heavily


import { cint } from "./attack";

function num(v, dflt) {
  if (v === null || v === undefined || v === "") return dflt;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : dflt;
}
function str(v) { return v == null ? "" : String(v); }

function computeClass(r, mr, globals) {
  const catName = str(r.cat && r.cat["Category Type"]).trim();
  const cat = catName.toLowerCase();
  const priWpnLS = str(r.priWpn && r.priWpn["(light_)spear"]);
  const priWpnSP = str(r.priWpn && r.priWpn["short/long_pike"]);
  const secWpnLS = str(r.secWpn && r.secWpn["(light_)spear"]);
  const secWpnSP = str(r.secWpn && r.secWpn["short/long_pike"]);
  const isGeneral = str(r.unit["general unit"]);
  const cavBG = num(globals.CavBGSkirmish, 0);
  const medInf = num(globals.MediumInfThreshold, Infinity);
  const hvyInf = num(globals.HeavyInfThreshold,  Infinity);
  const medCav = num(globals.MediumCavThreshold, Infinity);
  const hvyCav = num(globals.HeavyCavThreshold,  Infinity);
  const sMass = mr.soldierMass, hMass = mr.horseMass;
  const engSubtype = str(r.unit["engine missile type"]) || str(r.engine && r.engine["Engine type"]);

  if (cat === "foot") {
    if (priWpnLS || priWpnSP || secWpnLS || secWpnSP) return "spearmen";
    return sMass < (medInf + hvyInf) / 2 ? "light" : "heavy";
  }
  if (cat === "mounted") {
    if (isGeneral && cavBG) return "skirmish";
    return (sMass * 1.5 + hMass / 1.5) < (medCav + hvyCav) / 2 ? "light" : "heavy";
  }
  if (cat === "handler" || cat === "special" || cat === "chariot") return "heavy";
  if (cat === "ship") return str(r.ship && r.ship["Class"]) === "L" ? "light" : "heavy";
  if (cat === "foot missile") return "missile";
  if (cat === "mounted missile") return (isGeneral && cavBG) ? "skirmish" : "missile";
  if (cat === "engine") {
    // VBA uses unit's EngineWagonStandard hint (one of "S"/"W"/"F") — the
    // "engine missile type" or engine subtype field. "S" → light (standard).
    return engSubtype === "S" ? "light" : "missile";
  }
  return "heavy";
}

function computeSpacing(r) {
  const catHrCl = num(r.cat  && r.cat["Hr Cl Spacing"], 0);
  const catVrCl = num(r.cat  && r.cat["Vr Cl Spacing"], 0);
  const catHrLs = num(r.cat  && r.cat["Hr Ls Spacing"], 0);
  const catVrLs = num(r.cat  && r.cat["Vr ls Spacing"], 0);   // sheet has lowercase "ls"
  const fHrCl   = num(r.form && r.form["Hr Cl Spacing Mdf"], 1);
  const fVrCl   = num(r.form && r.form["Vr Cl Spacing Mdf"], 1);
  const fHrLs   = num(r.form && r.form["Hr Ls Spacing Mdf"], 1);
  const fVrLs   = num(r.form && r.form["Vr ls Spacing Mdf"], 1);
  const catRanks = num(r.cat && r.cat["Formation ranks"], 0);
  const fRanks   = num(r.form && r.form["Formation ranks"], -1);
  return {
    "h. cl. spacing": catHrCl * fHrCl,
    "v. cl. spacing": catVrCl * fVrCl,
    "h. l. spacing":  catHrLs * fHrLs,
    "v. l. spacing":  catVrLs * fVrLs,
    "ranks": fRanks === -1 ? catRanks : fRanks,
    "formation1": str(r.form && r.form["Formation 1"]),
  };
}

function computeFormation2(r, mr, globals, platform) {
  const isM2 = platform === "M2TW" || platform === "KGDM";
  const catName = str(r.cat && r.cat["Category Type"]).trim();
  const cat = catName.toLowerCase();
  const qualName = str(r.qual && r.qual["Quality Class"]);
  const spForm = str(r.form && r.form["Formation 2"]).toLowerCase();
  const priRange = num(r.priWpn && r.priWpn["Range"], 0);

  // Min-class threshold helper — blank threshold means "no unit qualifies"
  // (otherwise every unit ≥ "" would trigger).
  const meets = (thr) => {
    const t = str(thr).trim();
    return t !== "" && qualName >= t;
  };
  const wedgeMin   = r.cult && r.cult["Wedge min class"];
  const tortMin    = r.cult && r.cult["Tortoise min class"];
  const shldWallMin= r.cult && r.cult["Shieldwall min class"];
  const hedgeMin   = r.cult && r.cult["Hedgehog min class"];

  const priAllowSW = str(r.priWpn && r.priWpn["Allows shld-wall/trts"]) === "Y";
  const secAllowSW = str(r.secWpn && r.secWpn["Allows shld-wall/trts"]) === "Y";
  const priAllowPH = str(r.priWpn && r.priWpn["Allows phalanx/hedgehog"]) === "Y";
  const secAllowPH = str(r.secWpn && r.secWpn["Allows phalanx/hedgehog"]) === "Y";
  const shldAllowSW = !!(mr.armour && mr.armour.shieldAllowSW);

  const shieldOnBack = mr.armour ? mr.armour.shieldOnBack : 0;

  if (cat === "mounted" && (spForm === "wedge" || meets(wedgeMin))) return "wedge";
  if (cat === "foot") {
    if (spForm === "phalanx") return "phalanx";
    if (spForm === "testudo" ||
        (!isM2 && meets(tortMin) && (priAllowSW || (priRange !== 0 && secAllowSW)) &&
         shldAllowSW && shieldOnBack === 0)) return "testudo";
    if (spForm === "shield_wall" ||
        (isM2 && meets(shldWallMin) && (priAllowSW || (priRange !== 0 && secAllowSW)) &&
         shldAllowSW && shieldOnBack === 0)) return "shield_wall";
    if (spForm === "schiltrom" ||
        (isM2 && meets(hedgeMin) && (priAllowPH || (priRange !== 0 && secAllowPH)))) return "schiltrom";
    if (spForm === "horde" ||
        (isM2 && meets(hedgeMin) && (priAllowPH || (priRange !== 0 && secAllowPH)))) return "horde";
  }
  return "";
}

function computePriHP(r, globals) {
  const base = num(globals.UnitPriHP, 1);
  const specName = str(r.spec && r.spec["Specialty Type"]);
  return specName === "Chariot" ? base * 2 : base;
}

function computeSecHP(r, mr, globals) {
  const catName = str(r.cat && r.cat["Category Type"]).trim().toLowerCase();
  if (catName === "special" || catName === "handler" || catName === "chariot") {
    return num(r.spMount && r.spMount["Sec HP"], 0);
  }
  if (catName === "ship") return 0;
  const unitSec = num(globals.UnitSecHP, 0);
  const gAtk    = num(globals.GlobalAttackMdf, 1);
  const gChg    = num(globals.GlobalChargeMdf, 1);
  const priWpnAtk = num(r.priWpn && r.priWpn["Attack"], 0);
  const priWpnChg = num(r.priWpn && r.priWpn["Charge"], 0);
  const projAtk = num(r.projectile && r.projectile["Attack"], 0);
  const qualChg = num(r.qual && r.qual["Charge mdf"], 1);
  const specChg = num(r.spec && r.spec["Charge mdf"], 1);
  const cultCavChg = num(r.cult && r.cult["Cav charge mdf"], 1);
  const unitChg = num(globals.UnitCharge, 1);
  const priMissile = str(r.unit["pri missile type"]);
  const priRange = num(r.priWpn && r.priWpn["Range"], 0);
  const cavChargeBase = unitChg * qualChg * specChg * cultCavChg + priWpnChg;

  let v;
  if (catName === "mounted missile") {
    // Both arrow and non-arrow use the same ×0.4 charge term; the arrow
    // branch just adds a flat +2 baseline.
    const core = unitSec + (gAtk * (priWpnAtk + projAtk) + 4) / 10 + (gChg * cavChargeBase / 3.7 * 0.4);
    v = (priMissile === "arrow") ? 2 + core : core;
  } else if ((catName === "foot" || catName === "foot missile") && priRange !== 0) {
    v = unitSec + (gAtk * (priWpnAtk + projAtk) + 4) / 10;
  } else if (catName === "mounted") {
    v = unitSec + ((gChg * cavChargeBase - 20) / 3.7);
  } else {
    v = unitSec;
  }
  // v0.7.0 post-adjustments (detect by CombatExp global):
  //   +1 for roman culture, ×1.6 for "32. general" quality class.
  const isV070 = globals.CombatExp !== undefined;
  if (isV070) {
    const cultName = str(r.cult && r.cult["Culture Type"]).toLowerCase();
    const qualName = str(r.qual && r.qual["Quality Class"]).toLowerCase();
    if (cultName === "roman") v += 1;
    if (qualName.startsWith("32. general")) v *= 1.6;
  }
  return cint(v);
}

export { computeClass, computeSpacing, computeFormation2, computePriHP, computeSecHP };
