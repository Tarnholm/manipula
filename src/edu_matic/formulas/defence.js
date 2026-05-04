// formulas/defence.js — port of CreateUnitData Cases 154–168.
//
//   Case 154 'primary armour'     — (Upgr0ArmourValue + MountArmour) × GlobalArmourMdf
//   Case 155 'primary defence'    — see formula below
//   Case 156 'primary shield'     — Upgr0ShieldValue
//   Case 157 'primary hit sound'  — Upgr0ArmourHitSoundValue
//   Case 166 'secondary armour'   — GlobalArmourMdf × SpMountSecArmour
//   Case 167 'secondary defence'  — GlobalDefenceMdf × SpMountSecDefence
//   Case 168 'secondary hit sound'— SpMountHitSound
//
// Defence formula (VBA L7499–7519):
//
//   If Ship:
//     value = ShipDefence × GlobalDefenceMdf
//   Else:
//     base = UnitDefence × QualDefenceMdf × SpecDefenceMdf
//     If (Foot|Foot Missile|Handler|Engine):  base × CultInfDefenceMdf
//     If (Mounted|Mounted Missile|Special):   base × CultCavDefenceMdf
//     If CatName != "Foot" AND != "Mounted":  base × CatMinorSkillMdf
//     value = GlobalDefenceMdf × (base
//                               + PriWeaponDefence + SecWeaponDefence
//                               + Upgr0ShieldDefenceValue + MountDefence
//                               − DefSkillFraction × (SoldierMass − ManMass) / ExtraMassPerSkill)
//     On M2TW: value −= (QualStartExp + 2) / 3
//     On KGDM: no start-exp adjustment
//     On RTW/ALX: value −= QualStartExp
//   Clamp 0–63, CInt.


import { cint } from "./attack";

function num(v, dflt) {
  if (v === null || v === undefined || v === "") return dflt;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : dflt;
}
function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }

/**
 * Compute the full defensive triad + sec mount stats in one pass since
 * they all share the armour-resolver result and the unit mass context.
 *
 * @param {import("../resolve").ResolvedUnit} r
 * @param {{soldierMass:number, armour: {value:number,
 *          shieldValue:number, shieldDefence:number, hitSound:string}}} mr
 * @param {import("../xlsmImporter").Project} project
 * @returns {object}  { armour, defence, shield, hitSound, secArmour, secDefence, secHitSound }
 */
function computeDefensiveTriad(r, mr, project) {
  const out = {};
  const globals = project.globals || {};
  const platform = String(project.modInfo?.platform || "");
  const catName = String((r.cat && r.cat["Category Type"]) || "").trim();
  const cat = catName.toLowerCase();

  const gArm = num(globals.GlobalArmourMdf,  1);
  const gDef = num(globals.GlobalDefenceMdf, 1);

  // ── Case 154: primary armour ────────────────────────────────
  // Ships take armour straight from the ships table (VBA L9683, no
  // GlobalArmourMdf). Everything else uses the armour upgrade model
  // plus any mount-armour bonus.
  const mountArmour = num(r.mount && r.mount["Armour mdf"], 0);
  if (cat === "ship") {
    const shipArmour = num(r.ship && r.ship["Armour"], 0);
    out["armour"] = clamp(cint(shipArmour), 0, 63);
  } else {
    out["armour"] = clamp(cint((mr.armour.value + mountArmour) * gArm), 0, 63);
  }

  // ── Case 155: primary defence ───────────────────────────────
  let def;
  if (cat === "ship") {
    // VBA L9696: `MyValue = ShipDefence '* GlobalDefenceMdf` — the
    // global multiplier is commented out for ships.
    def = num(r.ship && r.ship["Defence"], 0);
  } else {
    const unitDef = num(globals.UnitDefence, 1);
    const qualDef = num(r.qual && r.qual["Defence mdf"], 1);
    const specDef = num(r.spec && r.spec["Defence mdf"], 1);
    let base = unitDef * qualDef * specDef;

    const isFoot      = /^foot$/i.test(catName);
    const isFootMissile = /^foot missile$/i.test(catName);
    const isMounted   = /^mounted$/i.test(catName);
    const isMountedM  = /^mounted missile$/i.test(catName);
    const isSpecial   = /^special$/i.test(catName);
    const isChariot   = /^chariot$/i.test(catName);
    const isHandler   = /^handler$/i.test(catName);
    const isEngine    = /^engine$/i.test(catName);

    if (isFoot || isFootMissile || isHandler || isEngine) {
      base *= num(r.cult && r.cult["Inf defence mdf"], 1);
    } else if (isMounted || isMountedM || isSpecial || isChariot) {
      base *= num(r.cult && r.cult["Cav defence mdf"], 1);
    }
    // Minor skill applies to everything except plain Foot and plain Mounted.
    if (!isFoot && !isMounted) {
      base *= num(r.cat && r.cat["Minor skill mdf"], 1);
    }

    const priWpnDef = num(r.priWpn   && r.priWpn["Defence"], 0);
    const secWpnDef = num(r.secWpn   && r.secWpn["Defence"], 0);
    const mountDef  = num(r.mount    && r.mount["Defence mdf"], 0);
    const defSkillFrac = num(globals.DefSkillFraction, 0);
    const extraMassPerSkill = num(globals.ExtraMassPerSkill, 1);
    const manMass = num(globals.ManMass, 0);
    const qualStartExp = num(r.qual && r.qual["Start exp"], 0);

    const massAdj = defSkillFrac * (mr.soldierMass - manMass) / extraMassPerSkill;
    // v0.7.0 (VBA L9707) uses MAX(pri,sec) weapon defence with flat
    // qualStartExp subtraction regardless of platform. v2.6 (L7513) uses
    // SUM with platform-specific adjustment.
    const isV070 = globals.CombatExp !== undefined;
    if (isV070) {
      def = gDef * (base + Math.max(priWpnDef, secWpnDef) + mr.armour.shieldDefence + mountDef - massAdj) - qualStartExp;
    } else {
      def = gDef * (base + priWpnDef + secWpnDef + mr.armour.shieldDefence + mountDef - massAdj);
      if      (platform === "M2TW") def -= (qualStartExp + 2) / 3;
      else if (platform === "KGDM") {/* no adjustment */}
      else                          def -= qualStartExp;
    }
  }
  out["defence"] = clamp(cint(def), 0, 63);

  // ── Case 156: primary shield ────────────────────────────────
  out["shield"] = clamp(cint(mr.armour.shieldValue), 0, 31);

  // ── Case 157: primary hit sound ─────────────────────────────
  // Ships have no Torso armour to vote — the engine convention (and
  // every base-game RTW ship in vanilla export_descr_unit.txt) uses
  // "flesh" as the per-category default. Other categories fall through
  // to the formula's voted value (defaults to "metal" when no votes).
  if (cat === "ship") {
    out["hit sound"] = "flesh";
  } else if (mr.armour.hitSound) {
    out["hit sound"] = mr.armour.hitSound;
  }

  // ── Case 166, 167, 168: secondary (special mount) stats ─────
  // sec hit sound defaults to "flesh" for every unit per VBA GetDataFromDef,
  // even when there's no special mount; sec armour/defence are only
  // emitted when a special mount is present.
  if (r.spMount) {
    const spSecArm = num(r.spMount["Sec armour"],  0);
    const spSecDef = num(r.spMount["Sec defence"], 0);
    out["sec armour"]  = clamp(cint(gArm * spSecArm), 0, 63);
    out["sec defence"] = clamp(cint(gDef * spSecDef), 0, 63);
  }
  const sound = (r.spMount && r.spMount["Hit sound"]) || "flesh";
  out["sec hit sound"] = String(sound);

  return out;
}

export { computeDefensiveTriad };
