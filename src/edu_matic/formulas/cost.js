// formulas/cost.js — recruitment + upkeep + upgrade costs.
//
// Two formula families, dispatched by workbook version:
//
//  v2.6 (linear): price = CostPerMan + weapon + armour + mdfs × soldiers.
//                 Simple per-component sum.
//
//  v0.7.0 (exponential): price = cost-component-mean × mdfs × morale-factor
//                                → ^0.8 × 1.98 × HP × soldiers.
//                        Attack and defence costs become:
//                          AttackCostCoeff × CombatExp^(attack + charge×f − AverageAttack)
//                          DefenceCostCoeff × CombatExp^(armour×mdf + def + shield×mdf − AverageDefenceTotal)
//                        Combined via WorksheetFunction.Average (arithmetic mean).
//                        Morale factor: (1 − (1 − (0.25 + 0.55×morale×0.0833)) × FactorByCategory).
//
// v0.7.0 is chosen when the workbook has the new globals (CombatExp, AttackCostCoeff, …).


import { cint } from "./attack";

function num(v, dflt) {
  if (v === null || v === undefined || v === "") return dflt;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : dflt;
}
function str(v) { return v == null ? "" : String(v); }
function getAttr(v) {
  if (v === null || v === undefined || v === "") return 0;
  const n = typeof v === "number" ? v : Number(v);
  if (Number.isFinite(n)) return n;
  return 1;
}
function avg(...xs) {
  const vals = xs.filter((x) => Number.isFinite(x));
  if (!vals.length) return 0;
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}

/** Is the workbook using the v0.7.0 cost model? */
function isV070(globals) {
  return globals.CombatExp !== undefined &&
         globals.AttackCostCoeff !== undefined &&
         globals.DefenceCostCoeff !== undefined;
}

// ── Shared weapon-expansion multipliers ─────────────────────────────

function priWpnExpansion(r, g) {
  return 1
    + getAttr(r.priWpn && r.priWpn["AP"])              * num(g.APValue, 0)
    + getAttr(r.priWpn && r.priWpn["(light_)spear"])   * num(g.LightSpearValue, 0)
    + getAttr(r.priWpn && r.priWpn["spear_bonus"])     * num(g.SpearBonusValue, 0)
    + getAttr(r.priWpn && r.priWpn["short/long_pike"]) * num(g.ShortPikeValue, 0);
}
function secWpnExpansion(r, g) {
  return 1
    + getAttr(r.secWpn && r.secWpn["AP"])              * num(g.APValue, 0)
    + getAttr(r.secWpn && r.secWpn["(light_)spear"])   * num(g.LightSpearValue, 0)
    + getAttr(r.secWpn && r.secWpn["spear_bonus"])     * num(g.SpearBonusValue, 0)
    + getAttr(r.secWpn && r.secWpn["short/long_pike"]) * num(g.ShortPikeValue, 0);
}
function projectileExpansion(r, g) {
  return 1
    + getAttr(r.projectile && r.projectile["AP"])     * num(g.APValue, 0)
    + getAttr(r.projectile && r.projectile["BP"])     * num(g.BPValue, 0)
    + getAttr(r.projectile && r.projectile["thrown"]) * num(g.ThrownValue, 0)
    + getAttr(r.projectile && r.projectile["launch"]) * num(g.LaunchingValue, 0)
    + getAttr(r.projectile && r.projectile["area"])   * num(g.AreaAttackValue, 0);
}
function spMountExpansion(r, g) {
  if (!r.spMount) return 0;
  return 1
    + getAttr(r.spMount["AP"])     * num(g.APValue, 0)
    + getAttr(r.spMount["BP"])     * num(g.BPValue, 0)
    + getAttr(r.spMount["launch"]) * num(g.LaunchingValue, 0)
    + getAttr(r.spMount["area"])   * num(g.AreaAttackValue, 0);
}
function engineProjExpansion(row, g) {
  if (!row) return 0;
  return 1
    + getAttr(row["AP"])     * num(g.APValue, 0)
    + getAttr(row["BP"])     * num(g.BPValue, 0)
    + getAttr(row["launch"]) * num(g.LaunchingValue, 0)
    + getAttr(row["area"])   * num(g.AreaAttackValue, 0);
}

// ── v2.6 legacy formula ────────────────────────────────────────────

function v26WpnTerm(r, g) {
  const priWpnCost = num(r.priWpn && r.priWpn["Cost"], 0);
  const projCost   = num(r.projectile && r.projectile["Cost"], 0);
  const secWpnCost = num(r.secWpn && r.secWpn["Cost"], 0);
  const priQualMdf = num(r.priWpnQual && r.priWpnQual["Cost mdf"], 1);
  const secQualMdf = num(r.secWpnQual && r.secWpnQual["Cost mdf"], 1);
  return priWpnCost * priWpnExpansion(r, g) * priQualMdf
       + projCost   * projectileExpansion(r, g)
       + secWpnCost * secWpnExpansion(r, g) * secQualMdf;
}
function v26SpMountTerm(r, g) {
  if (!r.spMount) return 0;
  return num(r.spMount["Cost"], 0) * spMountExpansion(r, g);
}
function v26EngineProjTerm(r, g) {
  const engCost = num(r.engine && r.engine["Cost"], 0);
  const priP = num(r.enginePri && r.enginePri["Cost"], 0) * engineProjExpansion(r.enginePri, g);
  const secP = num(r.engineSec && r.engineSec["Cost"], 0) * engineProjExpansion(r.engineSec, g);
  return engCost + priP + secP;
}

function computeCostsV26(r, mr, project, unitSoldiers, unitExtras, unitPriArmour, isM2) {
  const out = {};
  const g = project.globals || {};
  const cat = str(r.cat && r.cat["Category Type"]).trim().toLowerCase();
  const isMerc = str(r.unit["merc unit"]);
  const upgradeBonusWpn = isM2 ? 6    : 1;
  const upgradeBonusArm = isM2 ? 7/3  : 1;

  let recrCostMdf = num(r.recr && r.recr["Recr cost mdf"], 1);
  if (isMerc === "Recruitable" && num(r.recr && r.recr["Recruitment time"], 0) === 0 &&
      num(r.qual && r.qual["Recruitment time"], 0) > 0) recrCostMdf *= 2;
  const qualCostMdf = num(r.qual && r.qual["Recr cost mdf"], 1);
  const catCostMdf  = num(r.cat  && r.cat["Recr cost mdf"],  1);
  const specCostMdf = num(r.spec && r.spec["Recr cost mdf"], 1);

  // v0.7.0 has an explicit "Turns" column on the unit definition
  // (col NI, ~373). VBA Case 182 is commented out, so the DATA cell
  // comes from this direct unit-def column. Fall back to the old
  // recruitment-class / quality-class formula for v2.6 compat.
  if (r.unit["Turns"] !== undefined) {
    out["turns"] = num(r.unit["Turns"], 0);
  } else {
    out["turns"] = num(r.recr && r.recr["Recruitment time"], -1) !== -1
      ? num(r.recr["Recruitment time"], 0)
      : num(r.qual && r.qual["Recruitment time"], 0);
  }

  const costPerMan = num(g.CostPerMan, 0);
  const wpnT = v26WpnTerm(r, g);
  const armCost0 = num(mr.armour && mr.armour.cost, 0);
  let price = 0;
  if (cat === "ship") price = num(r.ship && r.ship["Cost"], 0) * catCostMdf;
  else if (cat === "foot" || cat === "foot missile") {
    let sub = costPerMan + wpnT;
    if (!isM2) sub += armCost0 * (1 + (unitPriArmour + upgradeBonusWpn) / (unitPriArmour + 0.5));
    sub *= recrCostMdf * qualCostMdf * catCostMdf * specCostMdf * num(r.cult && r.cult["Inf recr cost mdf"], 1);
    price = sub * unitSoldiers;
  } else if (cat === "mounted" || cat === "mounted missile") {
    const mountCost = num(r.mount && r.mount["Cost"], 0);
    let sub = costPerMan + mountCost + wpnT;
    if (!isM2) sub += armCost0 * (1 + (unitPriArmour + upgradeBonusWpn) / (unitPriArmour + 0.5));
    sub *= recrCostMdf * qualCostMdf * catCostMdf * specCostMdf * num(r.cult && r.cult["Cav recr cost mdf"], 1);
    price = sub * unitSoldiers;
  } else if (cat === "handler" || cat === "special" || cat === "chariot") {
    let sub = costPerMan + wpnT;
    if (!isM2) sub += armCost0 * (1 + (unitPriArmour + upgradeBonusWpn) / (unitPriArmour + 0.5));
    sub *= recrCostMdf * qualCostMdf * catCostMdf * specCostMdf;
    price = sub * unitSoldiers + v26SpMountTerm(r, g) * unitExtras;
  } else if (cat === "engine") {
    let sub = costPerMan + wpnT;
    if (!isM2) sub += armCost0 * (1 + (unitPriArmour + upgradeBonusWpn) / (unitPriArmour + 0.5));
    sub *= recrCostMdf * qualCostMdf * catCostMdf * specCostMdf;
    price = sub * unitSoldiers + v26EngineProjTerm(r, g) * unitExtras;
  }
  price = Math.round(num(g.GlobalRecrCostMdf, 1) * price);
  out["price"] = price;

  let upkMdf = num(r.recr && r.recr["Upk cost mdf"], 1);
  if (isMerc === "Recruitable" && num(r.recr && r.recr["Recruitment time"], 0) === 0 &&
      num(r.qual && r.qual["Recruitment time"], 0) > 0) upkMdf *= 1.5;
  const upkToCost = num(g.UpkeepToCostRatio, 0);
  const qualUpk = num(r.qual && r.qual["Upk cost mdf"], 1);
  const catUpk  = num(r.cat  && r.cat["Upk cost mdf"],  1);
  let upkeep = 0;
  if (cat === "ship") upkeep = num(r.ship && r.ship["Upkeep"], 0) * catUpk;
  else if (cat === "foot" || cat === "foot missile") upkeep = price * upkToCost * upkMdf * qualUpk * catUpk * num(r.cult && r.cult["Inf upk cost mdf"], 1);
  else if (cat === "mounted" || cat === "mounted missile") upkeep = price * upkToCost * upkMdf * qualUpk * catUpk * num(r.cult && r.cult["Cav upk cost mdf"], 1);
  else upkeep = price * upkToCost * upkMdf * qualUpk * catUpk;
  out["upkeep"] = cint(num(g.GlobalUpkCostMdf, 1) * upkeep);

  return { out, price, recrCostMdf, upgradeBonusWpn, upgradeBonusArm, armCost0, wpnT };
}

// ── v0.7.0 exponential cost formula ────────────────────────────────

/** AttackCostCoeff × CombatExp^(attack + charge*factor - AverageAttack) × wpnExpansion × qualityCostMdf */
function atkCost(coeff, ce, atk, chg, f, avgAtk, wpnExp, qualMdf) {
  return coeff * Math.pow(ce, (atk + chg * f) - avgAtk) * wpnExp * qualMdf;
}
function defCost(coeff, ce, armour, armourMdf, def, shield, shieldMdf, avgDef) {
  return coeff * Math.pow(ce, (armour * armourMdf + def + shield * shieldMdf) - avgDef);
}

function computeCostsV070(r, out, mr, project, unitSoldiers, unitExtras, stats, isM2) {
  const g = project.globals || {};
  const cat = str(r.cat && r.cat["Category Type"]).trim().toLowerCase();
  const isMerc = str(r.unit["merc unit"]);

  let recrCostMdf = num(r.recr && r.recr["Recr cost mdf"], 1);
  if (isMerc === "Recruitable" && num(r.recr && r.recr["Recruitment time"], 0) === 0 &&
      num(r.qual && r.qual["Recruitment time"], 0) > 0) recrCostMdf *= 2;
  const qualCostMdf = num(r.qual && r.qual["Recr cost mdf"], 1);
  const catCostMdf  = num(r.cat  && r.cat["Recr cost mdf"],  1);
  const specCostMdf = num(r.spec && r.spec["Recr cost mdf"], 1);
  const cultInfRecr = num(r.cult && r.cult["Inf recr cost mdf"], 1);
  const cultCavRecr = num(r.cult && r.cult["Cav recr cost mdf"], 1);

  // ── turns ─────────────────────────────────────────────────
  // Prefer the per-unit "Turns" column (v0.7.0), fall back to the
  // recr-class / quality formula for older workbooks.
  if (r.unit["Turns"] !== undefined) {
    out["turns"] = num(r.unit["Turns"], 0);
  } else {
    out["turns"] = num(r.recr && r.recr["Recruitment time"], -1) !== -1
      ? num(r.recr["Recruitment time"], 0)
      : num(r.qual && r.qual["Recruitment time"], 0);
  }

  // ── Constants ────────────────────────────────────────────
  const CE = num(g.CombatExp, 1.04);
  const atkCoeff = num(g.AttackCostCoeff, 12);
  const defCoeff = num(g.DefenceCostCoeff, 10);
  const avgAtk = num(g.AverageAttack, 12.8);
  const avgDef = num(g.AverageDefenceTotal, 29.7);
  const infChgF = num(g.InfChargeCostFactor, 0.2);
  const cavChgF = num(g.CavChargeCostFactor, 1);
  const mmFrac = num(g.MissileMeleeFraction, 0.4);
  const armMdf = num(g.ArmourCostMdf, 1.7);
  const shdMdf = num(g.ShieldCostMdf, 1);
  const costPerMan = num(g.CostPerMan, 0);

  // Unit-side numeric stats (from the compute pipeline's outputs so far)
  const uAtk = num(stats.attack, 0);
  const uChg = num(stats.charge, 0);
  const uSecAtk = num(stats["s attack"], 0);
  const uSecChg = num(stats["s charge"], 0);
  const uArm = num(stats.armour, 0);
  const uDef = num(stats.defence, 0);
  const uShd = num(stats.shield, 0);
  const uMsl = num(stats["msl range"], 0);
  const uAmmo = num(stats["msl ammo"], 0);
  const uMorale = num(stats.morale, 0);
  const uHP = num(stats.hp, 1);

  const priQualMdf = num(r.priWpnQual && r.priWpnQual["Cost mdf"], 1);
  const secQualMdf = num(r.secWpnQual && r.secWpnQual["Cost mdf"], 1);
  const priRange = num(r.priWpn && r.priWpn["Range"], 0);

  const priExp = priWpnExpansion(r, g);
  const secExp = secWpnExpansion(r, g);
  const projExp = projectileExpansion(r, g);
  // Foot Missile projectile term uses AP × 1.1 (VBA L9959) so we build
  // a bespoke expansion with the bonus; other branches use projExp.
  const projExpFootMsl = 1
    + getAttr(r.projectile && r.projectile["AP"])     * num(g.APValue, 0) * 1.1
    + getAttr(r.projectile && r.projectile["BP"])     * num(g.BPValue, 0)
    + getAttr(r.projectile && r.projectile["thrown"]) * num(g.ThrownValue, 0)
    + getAttr(r.projectile && r.projectile["launch"]) * num(g.LaunchingValue, 0)
    + getAttr(r.projectile && r.projectile["area"])   * num(g.AreaAttackValue, 0);
  const priRangedCost = Math.pow(CE, uAtk) * uMsl * 0.012 * projExp;   // Foot/Mounted with pri range
  // Foot Missile range exponent is 0.5 (VBA L9959), Mounted Missile is 0.4 (L9985).
  const pxMslRangedCost = Math.pow(CE, uAtk) * Math.pow(uMsl, 0.5) * 0.17 * (1 + uAmmo / 5) * projExpFootMsl;
  const mmMslRangedCost = 0.9 * Math.pow(CE, uAtk) * Math.pow(uMsl, 0.4) * 0.17 * (1 + uAmmo / 5) * projExp;

  // Defence cost term (common to all branches).
  const dcost = defCost(defCoeff, CE, uArm, armMdf, uDef, uShd, shdMdf, avgDef);
  // Secondary attack cost (used in many branches).
  const secAtkCost = (chgFactor) => atkCost(atkCoeff, CE, uSecAtk, uSecChg, chgFactor, avgAtk, secExp, secQualMdf);
  // Primary melee attack cost (for melee branches).
  const priMeleeAtkCost = (chgFactor) => atkCost(atkCoeff, CE, uAtk, uChg, chgFactor, avgAtk, priExp, priQualMdf);

  // Morale factor per category.
  function moraleFactor(factorVal) {
    return 1 - (1 - (0.25 + 0.55 * uMorale * 0.0833)) * num(factorVal, 1);
  }

  let sub = 0, moraleF = 1, finalize = true;

  if (cat === "ship") {
    sub = num(r.ship && r.ship["Cost"], 0) * catCostMdf;
    finalize = false;           // no exponential transform for ships
  } else if (cat === "foot" && priRange !== 0) {
    sub = costPerMan + priRangedCost + avg(secAtkCost(infChgF), dcost);
    sub *= recrCostMdf * qualCostMdf * catCostMdf * specCostMdf * cultInfRecr;
    moraleF = moraleFactor(g.FootMoraleFactor);
  } else if (cat === "foot" && priRange === 0 && uSecAtk !== 0) {
    sub = costPerMan + avg(priMeleeAtkCost(infChgF), secAtkCost(infChgF), dcost);
    sub *= recrCostMdf * qualCostMdf * catCostMdf * specCostMdf * cultInfRecr;
    moraleF = moraleFactor(g.FootMoraleFactor);
  } else if (cat === "foot" && priRange === 0) {
    sub = costPerMan + avg(priMeleeAtkCost(infChgF), dcost);
    sub *= recrCostMdf * qualCostMdf * catCostMdf * specCostMdf * cultInfRecr;
    moraleF = moraleFactor(g.FootMoraleFactor);
  } else if (cat === "foot missile") {
    sub = costPerMan + pxMslRangedCost + avg(secAtkCost(infChgF * mmFrac), dcost);
    sub *= recrCostMdf * qualCostMdf * catCostMdf * specCostMdf * cultInfRecr;
    moraleF = moraleFactor(g.FootMissileMoraleFactor);
  } else if (cat === "mounted" && priRange !== 0) {
    sub = costPerMan + priRangedCost + avg(secAtkCost(cavChgF), dcost);
    sub *= recrCostMdf * qualCostMdf * catCostMdf * specCostMdf * cultCavRecr;
    moraleF = moraleFactor(g.CavMoraleFactor);
  } else if (cat === "mounted" && priRange === 0 && uSecAtk !== 0) {
    sub = costPerMan + avg(priMeleeAtkCost(cavChgF), secAtkCost(cavChgF), dcost);
    sub *= recrCostMdf * qualCostMdf * catCostMdf * specCostMdf * cultCavRecr;
    moraleF = moraleFactor(g.CavMoraleFactor);
  } else if (cat === "mounted" && priRange === 0) {
    sub = costPerMan + avg(priMeleeAtkCost(cavChgF), dcost);
    sub *= recrCostMdf * qualCostMdf * catCostMdf * specCostMdf * cultCavRecr;
    moraleF = moraleFactor(g.CavMoraleFactor);
  } else if (cat === "mounted missile") {
    sub = costPerMan + mmMslRangedCost + 1.1 * avg(secAtkCost(cavChgF * mmFrac * 2), defCost(defCoeff, CE, uArm, armMdf * 2, uDef, uShd, shdMdf, avgDef));
    sub *= recrCostMdf * qualCostMdf * catCostMdf * specCostMdf * cultCavRecr;
    moraleF = moraleFactor(g.CavMissileMoraleFactor);
  } else if (cat === "handler" || cat === "special" || cat === "chariot") {
    // Linear branch — no exponential transform. Resembles v2.6.
    const wpnT = v26WpnTerm(r, g);
    let s = costPerMan + wpnT + (armMdf * uArm + shdMdf * uShd);
    s *= recrCostMdf * qualCostMdf * catCostMdf * specCostMdf;
    s *= unitSoldiers;
    s += (r.spMount ? num(r.spMount["Cost"], 0) * spMountExpansion(r, g) : 0) * unitExtras;
    out["price"] = Math.round(num(g.GlobalRecrCostMdf, 1) * s);
    finalize = false;
  } else if (cat === "engine") {
    const wpnT = v26WpnTerm(r, g);
    let s = costPerMan + wpnT + (armMdf * uArm + shdMdf * uShd);
    s *= recrCostMdf * qualCostMdf * catCostMdf * specCostMdf;
    s *= unitSoldiers;
    s += v26EngineProjTerm(r, g) * unitExtras;
    out["price"] = Math.round(num(g.GlobalRecrCostMdf, 1) * s);
    finalize = false;
  }

  if (finalize && cat !== "ship") {
    sub *= moraleF;
    sub = Math.pow(Math.max(sub, 0), 0.8) * 1.98;
    sub *= uHP * unitSoldiers;
    out["price"] = Math.round(num(g.GlobalRecrCostMdf, 1) * sub);
  } else if (cat === "ship") {
    out["price"] = Math.round(num(g.GlobalRecrCostMdf, 1) * sub);
  }

  // ── upkeep ─────────────────────────────────────────────────
  let upkMdf = num(r.recr && r.recr["Upk cost mdf"], 1);
  const upkToCost = num(g.UpkeepToCostRatio, 0);
  const qualUpk = num(r.qual && r.qual["Upk cost mdf"], 1);
  const catUpk  = num(r.cat  && r.cat["Upk cost mdf"],  1);
  const price = out["price"];
  let upkeep = 0;
  if (cat === "ship") upkeep = num(r.ship && r.ship["Upkeep"], 0) * catUpk;
  else if (cat === "foot" || cat === "foot missile") upkeep = price * upkToCost * upkMdf * qualUpk * catUpk * num(r.cult && r.cult["Inf upk cost mdf"], 1);
  else if (cat === "mounted" || cat === "mounted missile") upkeep = price * upkToCost * upkMdf * qualUpk * catUpk * num(r.cult && r.cult["Cav upk cost mdf"], 1);
  else upkeep = price * upkToCost * upkMdf * qualUpk * catUpk;
  out["upkeep"] = cint(num(g.GlobalUpkCostMdf, 1) * upkeep);

  return { price, recrCostMdf };
}

// ── Shared upgrade-cost helpers (identical across versions) ────────

function computeUpgradeCosts(r, out, project, unitSoldiers, unitExtras, unitPriArmour, isM2, price, recrCostMdf, armCost0) {
  const g = project.globals || {};
  const cat = str(r.cat && r.cat["Category Type"]).trim().toLowerCase();
  const upgradeBonusWpn = isM2 ? 6   : 1;
  const upgradeBonusArm = isM2 ? 7/3 : 1;

  // Case 185 weapon upgrade cost
  let wpnUpg = 0;
  const shipAtk = num(r.ship && r.ship["Attack"], 0);
  const engAtk  = num(r.engine && r.engine["Attack"], 0);
  const priEngAtk = num(r.enginePri && r.enginePri["Attack"], 0);
  const priWpnAtk = num(r.priWpn && r.priWpn["Attack"], 0);
  const projAtk   = num(r.projectile && r.projectile["Attack"], 0);
  const secWpnAtk = num(r.secWpn && r.secWpn["Attack"], 0);
  const spMntAtk  = num(r.spMount && r.spMount["Sec attack"], 0);
  const priWpnQCM = num(r.priWpnQual && r.priWpnQual["Cost mdf"], 1);
  const secWpnQCM = num(r.secWpnQual && r.secWpnQual["Cost mdf"], 1);
  if (shipAtk !== 0) {
    const shipDef = num(r.ship && r.ship["Defence"], 0);
    const shipCost = num(r.ship && r.ship["Cost"], 0);
    wpnUpg = shipCost * (shipAtk / (shipDef + shipAtk)) * (shipAtk + upgradeBonusWpn) / shipAtk;
  } else if (cat === "engine") {
    const engCost = num(r.engine && r.engine["Cost"], 0);
    wpnUpg = unitExtras * engCost * (engAtk + priEngAtk + upgradeBonusWpn) / (engAtk + priEngAtk || 1);
  } else if (cat === "special" || cat === "chariot") {
    const spCost = num(r.spMount && r.spMount["Cost"], 0);
    wpnUpg = unitExtras * spCost * (spMntAtk + upgradeBonusWpn) / (spMntAtk || 1);
  } else if (secWpnAtk === 0) {
    const priWpnCost = num(r.priWpn && r.priWpn["Cost"], 0);
    wpnUpg = unitSoldiers * priWpnCost * priWpnQCM * (priWpnAtk + projAtk + upgradeBonusWpn) / (priWpnAtk + projAtk || 1);
  } else {
    const secWpnCost = num(r.secWpn && r.secWpn["Cost"], 0);
    wpnUpg = unitSoldiers * secWpnCost * secWpnQCM * (secWpnAtk + upgradeBonusWpn) / (secWpnAtk || 1);
  }
  out["wpn upg"] = cint(wpnUpg);

  // Case 186 armour upgrade. v0.7.0 dropped the armCost factor entirely:
  //   MyValue = UnitSoldiers * (UnitPriArmour + UpgradeBonus) / (UnitPriArmour + 0.5)
  // v2.6 kept armCost as a multiplier. Detect by isV070.
  let armUpg = 0;
  if (cat === "ship") {
    const shipDef = num(r.ship && r.ship["Defence"], 0);
    const shipAtkL = num(r.ship && r.ship["Attack"], 0);
    const shipCost = num(r.ship && r.ship["Cost"], 0);
    armUpg = shipCost * (shipDef / (shipDef + shipAtkL)) * (shipDef + upgradeBonusArm) / (shipDef + 0.5);
  } else if (isV070(g)) {
    armUpg = unitSoldiers * (unitPriArmour + upgradeBonusArm) / (unitPriArmour + 0.5);
  } else if (!isM2) {
    // v2.6 RTW path — include armCost multiplier (threaded through from caller).
    armUpg = unitSoldiers * (armCost0 || 0) * (unitPriArmour + upgradeBonusArm) / (unitPriArmour + 0.5);
  }
  out["arm upg"] = cint(armUpg);

  out["cb cost"] = cint(num(g.CBCostMultiplier, 0) * price / (recrCostMdf || 1));
  if (isM2) {
    out["cb unit lim"] = num(r.qual && r.qual["CB unit limit"], 0);
    out["cb cost pen"] = cint(price * num(g.CBCostMultiplier, 0) / 2);
  }
}

/**
 * Single dispatch entry point — chooses v0.7.0 exponential model when the
 * new globals are present, else falls back to the v2.6 linear formula.
 */
function computeCosts(r, mr, project, unitSoldiers, unitExtras, unitPriArmour, stats, entryType) {
  const out = {};
  const g = project.globals || {};
  const isM2 = String(project.modInfo?.platform || "") === "M2TW" ||
               String(project.modInfo?.platform || "") === "KGDM";

  if (isV070(g)) {
    const { price, recrCostMdf } = computeCostsV070(r, out, mr, project,
                                                     unitSoldiers, unitExtras, stats, isM2);
    computeUpgradeCosts(r, out, project, unitSoldiers, unitExtras, unitPriArmour, isM2, price, recrCostMdf, 0);
  } else {
    const res = computeCostsV26(r, mr, project, unitSoldiers, unitExtras, unitPriArmour, isM2);
    Object.assign(out, res.out);
    computeUpgradeCosts(r, out, project, unitSoldiers, unitExtras, unitPriArmour, isM2, res.price, res.recrCostMdf, res.armCost0);
  }

  // Merc entry-type price inflation (VBA Case 183 L10006–10008): post-
  // rounding ×1.5 on price. Upkeep and upgrades use the pre-inflation
  // value so they stay unchanged. CLng does banker's rounding.
  if (entryType === "Merc" && out["price"] != null) {
    out["price"] = cint(1.5 * out["price"]);
  }

  return out;
}

export { computeCosts };
