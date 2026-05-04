// formulas/attack.js — port of CreateUnitData Case 83 ("primary attack").
//
// Exact VBA source (from L6974–7017 of Module1):
//
//   If CatCategoryName = "Ship":
//     MyValue = CInt(ShipAttack × GlobalAttackMdf)  (clamped 1–63)
//
//   Else:
//     base = UnitAttack × QualClassAttackMdf × SpecCategoryAttackMdf
//     If (Foot or Handler) AND PriWpnRange == 0:    base × CultInfAttackMdf
//     If (Mounted or Special) AND PriWpnRange == 0: base × CultCavAttackMdf
//     If ((Foot or Mounted) AND PriWpnRange != 0) OR Special OR Handler OR Engine:
//                                                   base × CatCategoryMinorSkillMdf
//
//     If PriWpnRange != 0 (ranged primary):
//       val = GlobalAttackMdf × (base
//                              + PriWpnAttack × (1 + PriWpnQualStatMdf) / 2
//                              + ProjectileAttack
//                              − (1 − DefSkillFraction) × (SoldierMass − ManMass) / ExtraMassPerSkill)
//       On RTW/ALX, subtract QualClassStartExp
//
//     If PriWpnRange == 0 (melee primary):
//       val = GlobalAttackMdf × (base
//                              + PriWpnAttack × PriWpnQualStatMdf
//                              − (1 − DefSkillFraction) × (SoldierMass − ManMass) / ExtraMassPerSkill)
//       On RTW/ALX, subtract QualClassStartExp
//       On M2TW/KGDM, subtract (QualClassStartExp + 2) / 3
//
//     Clamp 1–63, CInt (banker's rounding).


function num(v, dflt) {
  if (v === null || v === undefined || v === "") return dflt;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : dflt;
}
/** VBA CInt uses banker's rounding (half to even). JS Math.round is half-away-from-zero. */
function cint(x) {
  const f = Math.floor(x);
  const d = x - f;
  if (d < 0.5) return f;
  if (d > 0.5) return f + 1;
  return (f % 2 === 0) ? f : f + 1;
}
function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }

/**
 * @param {import("../resolve").ResolvedUnit} r
 * @param {{mass:number|null, soldierMass:number, horseMass:number}} mr  from computeMass()
 * @param {import("../xlsmImporter").Project} project
 * @returns {number|null}
 */
function computeAttack(r, mr, project) {
  const globals = project.globals || {};
  const isM2 = project.modInfo?.platform === "M2TW" || project.modInfo?.platform === "KGDM";

  const catName = String((r.cat && r.cat["Category Type"]) || "").trim();
  if (/^ship$/i.test(catName)) {
    const shipAttack = num(r.ship && r.ship["Attack"], null);
    if (shipAttack == null) return null;
    return clamp(cint(shipAttack * num(globals.GlobalAttackMdf, 1)), 1, 63);
  }
  if (!r.priWpn) return null;

  const gAtk = num(globals.GlobalAttackMdf,    1);
  const unitAtk = num(globals.UnitAttack,      1);
  const defSkillFrac = num(globals.DefSkillFraction, 0);
  const extraMassPerSkill = num(globals.ExtraMassPerSkill, 1);
  const manMass = num(globals.ManMass, 0);

  const priWpnAtk = num(r.priWpn["Attack"], 0);
  const priRange  = num(r.priWpn["Range"],  0);

  // v0.7.0 split the quality attack-mdf into melee + ranged columns.
  // When the primary weapon is ranged (Range > 0), use "Ranged Attack mdf"
  // if present. Falls back to the generic "Attack mdf" for v2.6.
  const qualAtk = (priRange !== 0 && r.qual && r.qual["Ranged Attack mdf"] !== undefined)
    ? num(r.qual["Ranged Attack mdf"], 1)
    : num(r.qual && r.qual["Attack mdf"], 1);
  const specAtk = num(r.spec && r.spec["Attack mdf"],    1);
  const cultInfAtk = num(r.cult && r.cult["Inf atack mdf"], 1);
  const cultCavAtk = num(r.cult && r.cult["Cav attack mdf"], 1);
  const catMinor   = num(r.cat  && r.cat["Minor skill mdf"], 1);
  const qualStartExp = num(r.qual && r.qual["Start exp"], 0);
  const priWpnQualMdf = num(r.priWpnQual && r.priWpnQual["Stat mdf"], 1);
  const projAtk = num(r.projectile && r.projectile["Attack"], 0);

  let base = unitAtk * qualAtk * specAtk;
  const isFoot    = /^foot$/i.test(catName);
  const isHandler = /^handler$/i.test(catName);
  const isMounted = /^mounted$/i.test(catName);
  const isSpecial = /^special$/i.test(catName);
  const isChariot = /^chariot$/i.test(catName);
  const isFootMissile    = /^foot missile$/i.test(catName);
  const isMountedMissile = /^mounted missile$/i.test(catName);
  const isEngine  = /^engine$/i.test(catName);

  if ((isFoot || isHandler) && priRange === 0)                          base *= cultInfAtk;
  else if ((isMounted || isSpecial || isChariot) && priRange === 0)     base *= cultCavAtk;

  if (((isFoot || isMounted) && priRange !== 0) || isSpecial || isChariot || isHandler || isEngine) {
    base *= catMinor;
  }

  const massAdj = (1 - defSkillFrac) * (mr.soldierMass - manMass) / extraMassPerSkill;

  let v;
  if (priRange !== 0) {
    v = gAtk * (base + priWpnAtk * ((1 + priWpnQualMdf) / 2) + projAtk - massAdj);
    if (!isM2) v -= qualStartExp;
  } else {
    v = gAtk * (base + priWpnAtk * priWpnQualMdf - massAdj);
    if (isM2) v -= (qualStartExp + 2) / 3;
    else      v -= qualStartExp;
  }
  return clamp(cint(v), 1, 63);
}

export { computeAttack, cint };
