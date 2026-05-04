// formulas/mass.js — port of CreateUnitData Case 14 ("mass").
//
// Reference VBA (from first-subagent analysis):
//   SoldierMass = ManMass + Upgr0ArmourMass
//   HorseMass   = MountMassMdf × BaseHorseMass
//
// Per category:
//   Foot / Handler / Engine: GlobalMassMdf × SoldierMass
//   Mounted:                 GlobalMassMdf × (SoldierMass + HorseMass)
//   Special (elephants/…):   GlobalMassMdf × (Sqrt(SoldierMass × SpMountMenPerMount) + SpMountMass)
//   Ship:                    0  (not emitted)
//
// Overrides:
//   Naked Warriors specialty: mass = 0.3 + GlobalMassMdf × SoldierMass
//   Specialty has its own Mass mdf: SpecialtyMassMdf × GlobalMassMdf × SoldierMass


import { resolveArmour } from "../armour";

function num(v, dflt) {
  if (v === null || v === undefined || v === "") return dflt;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : dflt;
}

/**
 * @param {import("../resolve").ResolvedUnit} r
 * @param {import("../xlsmImporter").Project} project
 * @returns {{mass:number|null, soldierMass:number, armour:object, horseMass:number}}
 */
function computeMass(r, project) {
  const globals = project.globals || {};
  const platform = String(project.modInfo?.platform || "");

  const manMass  = num(globals.ManMass,        0);
  const gMassMdf = num(globals.GlobalMassMdf,  1);
  const baseHorseMass = num(globals.BaseHorseMass, 0);

  const upgr0Name = r.unit["Armour Upgr0"];
  const armour = resolveArmour(upgr0Name, project, platform);
  const soldierMass = manMass + armour.mass;

  const mountMassMdf = num(r.mount && r.mount["Mount mass mdf"], 0);
  const horseMass    = mountMassMdf * baseHorseMass;

  const catName  = String((r.cat  && r.cat["Category Type"])   || "").toLowerCase();
  const specName = String((r.spec && r.spec["Specialty Type"]) || "").toLowerCase();
  const specMassMult = num(r.spec && r.spec["mass multiplier"], null);

  let mass = null;
  if (catName === "ship") {
    mass = 1;   // VBA Case 14 L8684 — ships use flat mass=1
  } else if (catName === "special" || catName === "chariot") {
    const menPerMount = num(r.spMount && r.spMount["Men per mount"], 0);
    const spMountMass = num(r.spMount && r.spMount["Mount mass"], 0);
    mass = gMassMdf * (Math.sqrt(soldierMass * menPerMount) + spMountMass);
  } else if (catName === "mounted" || catName === "mounted missile") {
    mass = gMassMdf * (soldierMass + horseMass);
  } else {
    // Foot / Foot Missile / Foot General / Handler / Engine
    mass = gMassMdf * soldierMass;
    if (specName === "naked warriors") {
      mass = 0.3 + gMassMdf * soldierMass;
    } else if (specMassMult != null) {
      mass = specMassMult * gMassMdf * soldierMass;
    }
  }
  return { mass, soldierMass, horseMass, armour };
}

export { computeMass };
