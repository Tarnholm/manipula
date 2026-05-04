// formulas/primary.js — simple per-primary-weapon cases from CreateUnitData:
//
//   Case 85 'primary missile type'       — "no" if blank, else unit's pri missile type
//   Case 86 'primary missile range'      — GlobalRangeMdf × (PriWpnRange + ProjectileRange)
//   Case 87 'primary missile ammo'       — GlobalAmmoMdf × ProjectileAmmo × PriWpnAmmoMdf (0 if melee)
//   Case 88 'primary weapon type'        — "melee" if range=0, else projectile wpn type
//   Case 89 'primary weapon technology'  — ShipWpnTech/PriWpnTech/ProjectileTech by branch
//   Case 90 'primary damage type'        — PriWpnDmgType / ProjectileDmgType
//   Case 91 'primary sound type'         — PriWpnSndType / ProjectileSndType
//
// Integer-valued cells (range, ammo) use VBA CInt (banker's rounding).


import { cint } from "./attack";

function num(v, dflt) {
  if (v === null || v === undefined || v === "") return dflt;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : dflt;
}

function str(v) { return v == null ? "" : String(v); }

/**
 * @param {import("../resolve").ResolvedUnit} r
 * @param {import("../xlsmImporter").Project} project
 * @returns {object}  writeable fields
 */
function computePrimaryWeaponFields(r, project) {
  const out = {};
  const globals = project.globals || {};
  const catName = String((r.cat && r.cat["Category Type"]) || "").trim().toLowerCase();

  const priWpnRange = num(r.priWpn && r.priWpn["Range"], 0);
  const isShip = catName === "ship";

  // Case 85 — missile type (the unit's "pri missile type" field is the
  // projectile "type" the engine recognizes, e.g. "velite_javelin").
  const priMissileType = r.unit["pri missile type"];
  out["msl type"] = priMissileType ? priMissileType : "no";

  // Case 86 — range in tiles
  out["msl range"] = cint(num(globals.GlobalRangeMdf, 1) * (priWpnRange + num(r.projectile && r.projectile["Range"], 0)));

  // Case 87 — ammo per soldier
  if (priWpnRange !== 0) {
    const priWpnAmmoMdf = num(r.priWpn && r.priWpn["Ammo mdf"], 1);
    out["msl ammo"] = cint(num(globals.GlobalAmmoMdf, 1) * num(r.projectile && r.projectile["Ammo"], 0) * priWpnAmmoMdf);
  } else {
    out["msl ammo"] = 0;
  }

  // Case 88 — weapon type
  if (priWpnRange === 0) out["wpn type"] = "melee";
  else out["wpn type"] = str(r.projectile && r.projectile["wpn type"]);

  // Case 89 — weapon tech
  if (isShip) {
    out["wpn tech"] = str(r.ship && r.ship["wpn tech"]);
  } else if (priWpnRange === 0) {
    out["wpn tech"] = str(r.priWpn && r.priWpn["wpn tech"]);
  } else {
    out["wpn tech"] = str(r.projectile && r.projectile["wpn tech"]);
  }

  // Case 90 — damage type (VBA default is "piercing" when blank)
  if (priWpnRange === 0) out["dmg type"] = str((r.priWpn && r.priWpn["dmg type"]) || "piercing");
  else                   out["dmg type"] = str((r.projectile && r.projectile["dmg type"]) || "piercing");

  // Case 91 — sound type (VBA default is "none" when blank)
  if (priWpnRange === 0) out["sound type"] = str((r.priWpn && r.priWpn["sound type"]) || "none");
  else                   out["sound type"] = str((r.projectile && r.projectile["sound type"]) || "none");

  // Case 94 — primary lethality. VBA: RTW melee uses Lethality × wpnLethalMdf
  // × priMeleeSkeletonLethalityMdf. Ranged and M2/KGDM get 1.
  const platform = String(project.modInfo?.platform || "");
  const isM2 = platform === "M2TW" || platform === "KGDM";
  if (priWpnRange === 0 && !isM2) {
    const baseLeth = num(globals.Lethality, 1);
    const wpnMdf   = num(r.priWpn && r.priWpn["lethality mdf"], 1);
    const skelMdf  = num(r.priSkel && r.priSkel["Lethality Mdf"], 1);
    out["lethality"] = Math.round(baseLeth * wpnMdf * skelMdf * 100) / 100;
  } else {
    out["lethality"] = 1;
  }

  return out;
}

export { computePrimaryWeaponFields };
