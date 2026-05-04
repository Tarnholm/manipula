// formulas/weaponAttrs.js — port of CreateUnitData Cases 93–106 and
// 116–129 (primary + secondary weapon attribute flags + min delay).
//
// Primary (Cases 93, 98–106):   min_delay, ap, bp, spear/light_spear,
//                               spear_bonus_x, pike, prec, thrown, launch, area
// Secondary (Cases 116, 121–129): min delay + same flag set


function num(v, dflt) {
  if (v === null || v === undefined || v === "") return dflt;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : dflt;
}
function str(v) { return v == null ? "" : String(v); }

const SPEAR_BONUS = { "4": "spear_bonus_4", "6": "spear_bonus_6", "8": "spear_bonus_8", "10": "spear_bonus_10", "12": "spear_bonus_12" };

/** @param {import("../resolve").ResolvedUnit} r */
function computeWeaponAttrs(r, project) {
  const out = {};
  const platform = String(project.modInfo?.platform || "");
  const isM2 = platform === "M2TW" || platform === "KGDM";
  const cat = str(r.cat && r.cat["Category Type"]).trim().toLowerCase();
  const priRange = num(r.priWpn && r.priWpn["Range"], 0);
  const priWpnAP     = str(r.priWpn && r.priWpn["AP"]);
  const priWpnLS     = str(r.priWpn && r.priWpn["(light_)spear"]);
  const priWpnSB     = str(r.priWpn && r.priWpn["spear_bonus"]);
  const priWpnSP     = str(r.priWpn && r.priWpn["short/long_pike"]);
  const projAP   = str(r.projectile && r.projectile["AP"]);
  const projBP   = str(r.projectile && r.projectile["BP"]);
  const projThr  = str(r.projectile && r.projectile["thrown"]);
  const projLau  = str(r.projectile && r.projectile["launch"]);
  const projArea = str(r.projectile && r.projectile["area"]);
  const specNoPrec = str(r.spec && r.spec["no precursor"]);

  // Case 93 primary min delay. VBA default is 25 when the weapon is
  // missing (ships carry no pri weapon).
  const priMinDelay = num(r.priWpn && r.priWpn["min delay"], 25) +
                      num(r.projectile && r.projectile["min delay mdf"], 0);
  out["min delay"] = priMinDelay;

  // Case 98 AP
  if (priWpnAP === "Y" || projAP === "Y") out["ap"] = "ap";

  // Case 99 BP (only when ranged)
  if (priRange !== 0 && projBP === "Y") out["bp"] = "bp";

  // Case 100 spear/light_spear
  if (priWpnLS === "spear" || priWpnLS === "light_spear") out["spear-attr"] = priWpnLS;

  // Case 101 spear_bonus_x
  if (SPEAR_BONUS[priWpnSB]) out["spear_bon"] = SPEAR_BONUS[priWpnSB];

  // Case 102 pike
  if (priWpnSP === "long_pike" || priWpnSP === "short_pike") out["pike"] = priWpnSP;

  // Case 103 prec (RTW/ALX only; not applicable to missile categories)
  if (!isM2 && priRange !== 0 &&
      cat !== "foot missile" && cat !== "mounted missile" &&
      cat !== "special" && cat !== "chariot" && specNoPrec !== "Y") {
    out["prec"] = "prec";
  }

  // Case 104 thrown
  if (projThr === "Y") out["thrown"] = "thrown";

  // Case 105 launch
  if (projLau === "Y") out["launch"] = "launching";

  // Case 106 area
  if (projArea === "Y") out["area"] = "area";

  // ── Secondary weapon attribute flags ─────────────────────────
  const secWpnAP = str(r.secWpn && r.secWpn["AP"]);
  const secWpnLS = str(r.secWpn && r.secWpn["(light_)spear"]);
  const secWpnSB = str(r.secWpn && r.secWpn["spear_bonus"]);
  const secWpnSP = str(r.secWpn && r.secWpn["short/long_pike"]);
  const spMountAP  = str(r.spMount && r.spMount["AP"]);
  const spMountBP  = str(r.spMount && r.spMount["BP"]);
  const spMountLau = str(r.spMount && r.spMount["launch"]);
  const spMountArea= str(r.spMount && r.spMount["area"]);
  const priEngAP   = str(r.enginePri && r.enginePri["AP"]);
  const priEngBP   = str(r.enginePri && r.enginePri["BP"]);
  const priEngLau  = str(r.enginePri && r.enginePri["launch"]);
  const priEngArea = str(r.enginePri && r.enginePri["area"]);

  // Case 116 secondary min delay. VBA GetDataFromDef returns 25 as the
  // default for missing weapon min-delay (seen in ParseUnitDefs defaults).
  let secMinDelay;
  if (cat === "special" || cat === "handler") secMinDelay = num(r.spMount && r.spMount["min delay"], 25);
  else if (cat === "engine")                  secMinDelay = num(r.enginePri && r.enginePri["min delay"], 25);
  else                                        secMinDelay = num(r.secWpn && r.secWpn["min delay"], 25);
  out["s min delay"] = secMinDelay;

  // Case 121 sec AP (weapon OR special mount OR engine projectile)
  if (secWpnAP === "Y" || spMountAP === "Y" || priEngAP === "Y") out["s ap"] = "ap";

  // Case 122 sec BP (special mount OR engine projectile only)
  if (spMountBP === "Y" || priEngBP === "Y") out["s bp"] = "bp";

  // Case 123 sec spear/light_spear
  if (secWpnLS === "spear" || secWpnLS === "light_spear") out["s spear-att"] = secWpnLS;

  // Case 124 sec spear_bonus_x
  if (SPEAR_BONUS[secWpnSB]) out["s spear_b"] = SPEAR_BONUS[secWpnSB];

  // Case 125 sec pike
  if (secWpnSP === "long_pike" || secWpnSP === "short_pike") out["s pike"] = secWpnSP;

  // Case 128 sec launch
  if (spMountLau === "Y" || priEngLau === "Y") out["s launch"] = "launching";

  // Case 129 sec area
  if (spMountArea === "Y" || priEngArea === "Y") out["s area"] = "area";

  return out;
}

export { computeWeaponAttrs };
