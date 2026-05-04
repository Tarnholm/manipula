// formulas/secondary.js — port of Cases 107–115 (secondary weapon numeric
// stats: attack, charge, missile type/range/ammo, wpn type/tech/dmg/sound).


import { cint } from "./attack";
import { unitSpeed } from "./charge";

function num(v, dflt) {
  if (v === null || v === undefined || v === "") return dflt;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : dflt;
}
function str(v) { return v == null ? "" : String(v); }
function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }

function computeSecondary(r, mr, project) {
  const out = {};
  const globals = project.globals || {};
  const platform = String(project.modInfo?.platform || "");
  const isM2 = platform === "M2TW" || platform === "KGDM";
  const cat = str(r.cat && r.cat["Category Type"]).trim().toLowerCase();

  const gAtk = num(globals.GlobalAttackMdf, 1);
  const gChg = num(globals.GlobalChargeMdf, 1);
  const gRange = num(globals.GlobalRangeMdf, 1);
  const gAmmo  = num(globals.GlobalAmmoMdf,  1);
  const unitAtk = num(globals.UnitAttack, 1);
  const unitChg = num(globals.UnitCharge, 1);
  const defSkillFrac = num(globals.DefSkillFraction, 0);
  const extraMassPerSkill = num(globals.ExtraMassPerSkill, 1);
  const manMass = num(globals.ManMass, 0);

  // ── Case 107 secondary attack ───────────────────────────────
  let secAttack = null;
  if (cat !== "special" && cat !== "handler" && cat !== "engine" && cat !== "chariot") {
    if (!r.secWpn) secAttack = 0;
    else {
      let base = unitAtk
               * num(r.qual && r.qual["Attack mdf"], 1)
               * num(r.spec && r.spec["Attack mdf"], 1);
      if (cat === "foot" || cat === "foot missile") base *= num(r.cult && r.cult["Inf atack mdf"], 1);
      else if (cat === "mounted" || cat === "mounted missile") base *= num(r.cult && r.cult["Cav attack mdf"], 1);
      if (cat === "foot missile" || cat === "mounted missile") base *= num(r.cat && r.cat["Minor skill mdf"], 1);
      const secWpnAtk = num(r.secWpn["Attack"], 0);
      const secWpnQualMdf = num(r.secWpnQual && r.secWpnQual["Stat mdf"], 1);
      const qualStartExp = num(r.qual && r.qual["Start exp"], 0);
      const massAdj = (1 - defSkillFrac) * (mr.soldierMass - manMass) / extraMassPerSkill;
      let v = gAtk * (base + secWpnAtk * secWpnQualMdf - massAdj);
      if (isM2) v -= (qualStartExp + 2) / 3;
      else      v -= qualStartExp;
      secAttack = clamp(cint(v), 1, 63);
    }
  } else if (cat === "special" || cat === "handler" || cat === "chariot") {
    secAttack = clamp(cint(gAtk * num(r.spMount && r.spMount["Sec attack"], 0)), 1, 63);
  } else if (cat === "engine") {
    if (r.enginePri) {
      secAttack = clamp(cint(gAtk * (num(r.engine && r.engine["Attack"], 0) +
                                     num(r.enginePri["Attack"], 0))), 1, 63);
    } else secAttack = 0;
  }
  if (secAttack != null) out["s attack"] = secAttack;

  // ── Case 108 secondary charge ───────────────────────────────
  let secCharge = null;
  if (cat === "special" || cat === "handler" || cat === "chariot") {
    secCharge = cint(gChg * num(r.spMount && r.spMount["Sec charge"], 0));
  } else if (cat === "ship" || cat === "engine" || !r.secWpn) {
    secCharge = 0;
  } else {
    const secWpnChg = num(r.secWpn["Charge"], 0);
    const qualChg = num(r.qual && r.qual["Charge mdf"], 1);
    const specChg = num(r.spec && r.spec["Charge mdf"], 1);
    const speed = unitSpeed(r);
    let v = 0;
    if (cat === "foot" || cat === "foot missile" || cat === "handler") {
      const cultInf = num(r.cult && r.cult["Inf charge mdf"], 1);
      v = gChg * (unitChg * qualChg * specChg * cultInf + secWpnChg) *
          Math.sqrt(speed) * Math.sqrt(mr.soldierMass / (manMass || 1));
    } else if (cat === "mounted" || cat === "mounted missile") {
      const cultCav = num(r.cult && r.cult["Cav charge mdf"], 1);
      v = gChg * (unitChg * qualChg * specChg * cultCav + secWpnChg) *
          Math.sqrt(speed) * (mr.soldierMass + mr.horseMass) * 0.17 / (manMass || 1);
    }
    secCharge = clamp(cint(v), 0, 63);
  }
  out["s charge"] = secCharge;

  // ── Case 109 sec missile type ───────────────────────────────
  // VBA's "SecMissileType" maps to the unit's "engine missile type"
  // column (labelled "sec missile type" in the CheckUnitDefs ParseDefs
  // — an alias left over from older schema). Tertiary is
  // "sec eng missile type".
  const secMissile = str(r.unit["engine missile type"]);
  out["s msl type"] = secMissile || "no";

  // ── Case 110 sec missile range (engine) ─────────────────────
  const engineRange = num(r.engine && r.engine["Range"], 0);
  if (engineRange !== 0) {
    out["s msl range"] = cint(gRange * (engineRange + num(r.enginePri && r.enginePri["Range"], 0)));
  } else {
    out["s msl range"] = 0;
  }

  // ── Case 111 sec missile ammo (engine) ──────────────────────
  if (engineRange !== 0) {
    out["s msl ammo"] = cint(gAmmo * num(r.enginePri && r.enginePri["Ammo"], 0));
  } else {
    out["s msl ammo"] = 0;
  }

  // ── Case 112 sec weapon type ────────────────────────────────
  out["s wpn type"] = cat === "engine" ? "siege_missile" : "melee";

  // ── Case 113 sec wpn tech ───────────────────────────────────
  let secTech;
  if (cat === "engine") secTech = str(r.enginePri && r.enginePri["wpn tech"]);
  else if (cat === "special" || cat === "handler" || cat === "chariot") secTech = str(r.spMount && r.spMount["wpn tech"]);
  else secTech = str(r.secWpn && r.secWpn["wpn tech"]);
  if (secTech) out["s wpn tech"] = secTech;

  // ── Case 114 sec dmg type ───────────────────────────────────
  let secDmg;
  if (cat === "special" || cat === "handler" || cat === "chariot") secDmg = str(r.spMount && r.spMount["dmg type"]);
  else if (cat === "engine")                  secDmg = str(r.enginePri && r.enginePri["dmg type"]);
  else                                        secDmg = str(r.secWpn && r.secWpn["dmg type"]);
  out["s dmg type"] = secDmg || "piercing";

  // ── Case 115 sec sound type ─────────────────────────────────
  let secSnd;
  if (cat === "special" || cat === "handler" || cat === "chariot") secSnd = str(r.spMount && r.spMount["sound type"]);
  else if (cat === "engine")                  secSnd = str(r.enginePri && r.enginePri["sound type"]);
  else                                        secSnd = str(r.secWpn && r.secWpn["sound type"]);
  out["s sound type"] = secSnd || "none";

  // ── Case 117 sec lethality (RTW-only, else 1) ────────────────
  if (!isM2) {
    const baseLeth = num(globals.Lethality, 1);
    let leth = 1;
    if (cat === "special" || cat === "handler" || cat === "chariot") {
      const spMdf = num(r.spMount && r.spMount["lethality mdf"], 1);
      const mskel = num(r.mountSkel && r.mountSkel["Lethality Mdf"], 1);
      leth = baseLeth * spMdf * mskel;
    } else if (cat !== "engine" && cat !== "ship") {
      const secMdf = num(r.secWpn && r.secWpn["lethality mdf"], 1);
      const sskel  = num(r.secSkel && r.secSkel["Lethality Mdf"], 1);
      leth = baseLeth * secMdf * sskel;
    } else {
      leth = baseLeth;
    }
    out["s lethality"] = Math.round(leth * 100) / 100;
  } else {
    out["s lethality"] = 1;
  }

  return out;
}

export { computeSecondary };
