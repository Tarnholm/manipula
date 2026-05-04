// formulas/attributes.js — port of CreateUnitData Cases 42–72 (boolean
// attribute flags emitted into the EDU `attributes` line).
//
// Each emit returns a string (the flag keyword) or "" when not applicable.
// The DATA sheet uses abbreviated column names (hide_forest(3), hardy(2),
// gunmen_cav/xbow/pike/..., etc.); we write under those exact labels.


function str(v) { return v == null ? "" : String(v); }
function num(v, dflt) {
  if (v === null || v === undefined || v === "") return dflt;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : dflt;
}
function has(s, v) { return s === v; }

/** Quality-vs-minimum check. The culture table holds a threshold quality
 *  class; the unit qualifies if its quality is lexically ≥ that threshold
 *  AND the threshold is actually defined. Undefined threshold → never
 *  qualifies (otherwise every unit would match because any string ≥ ""). */
function qualMeets(qualName, thresholdFromCulture) {
  const t = str(thresholdFromCulture).trim();
  if (!t) return false;
  return qualName >= t;
}

/** True if the unit's specialty has the given "special ability" in any of
 *  its three ability slots. */
function specHasAbility(spec, ability) {
  if (!spec) return false;
  for (const k of ["special ability", "special ability 2", "special ability 3"]) {
    if (str(spec[k]).toLowerCase() === ability) return true;
  }
  return false;
}

/**
 * @param {import("../resolve").ResolvedUnit} r
 * @param {{soldierMass:number, horseMass:number}} mr
 * @param {import("../xlsmImporter").Project} project
 * @returns {object}   flag key → flag string
 */
function computeAttributes(r, mr, project) {
  const out = {};
  const g = project.globals || {};
  const platform = String(project.modInfo?.platform || "");
  const isM2 = platform === "M2TW" || platform === "KGDM";
  const catName = str(r.cat && r.cat["Category Type"]).trim();
  const cat = catName.toLowerCase();
  const isGeneralUnit = str(r.unit["general unit"]);

  const sMass = mr.soldierMass, hMass = mr.horseMass;
  const medInf = num(g.MediumInfThreshold, Infinity);
  const hvyInf = num(g.HeavyInfThreshold,  Infinity);
  const medCav = num(g.MediumCavThreshold, Infinity);
  const hvyCav = num(g.HeavyCavThreshold,  Infinity);

  const spec = r.spec, dwel = r.dwel;
  const dwelAb = str(dwel && dwel["special ability"]).toLowerCase();
  const qualName = str(r.qual && r.qual["Quality Class"]);
  const cultInfFat = num(r.cult && r.cult["Inf fatigue mdf"], 0);
  const cultCavFat = num(r.cult && r.cult["Cav fatigue mdf"], 0);
  const catAllowSea  = has(str(r.cat && r.cat["Allows sea_faring"]), "Y");
  const catAllowSwim = has(str(r.cat && r.cat["Allows swim"]),       "Y");
  const catAllowHide = has(str(r.cat && r.cat["Allows hide"]),       "Y");

  // Case 42 sea_faring
  if (catAllowSea || isGeneralUnit) out["sea_faring"] = "sea_faring";

  // Case 43 can_swim
  let canSwim = false;
  if (cat === "foot" || cat === "foot missile" || cat === "handler") {
    if (catAllowSwim && (sMass < medInf || (sMass < hvyInf && dwelAb === "can_swim"))) canSwim = true;
  } else if (cat === "mounted" || cat === "mounted missile") {
    if (catAllowSwim && (2 * sMass) + (hMass / 2) < medCav) canSwim = true;
  } else if (specHasAbility(spec, "can_swim")) {
    canSwim = true;
  } else if ((cat === "special" || cat === "engine") && catAllowSwim) {
    canSwim = true;
  }
  if (canSwim) out["can_swim"] = "can_swim";

  // Case 44 hide_forest / hide_improved_forest / hide_anywhere
  let hideVal = "";
  if (cat === "foot" || cat === "foot missile" || cat === "handler") {
    if (catAllowHide) {
      const foot = sMass < hvyInf;
      const dwelOrSpec = (ability) => dwelAb === ability || specHasAbility(spec, ability);
      if (foot && dwelOrSpec("hide_anywhere")) hideVal = "hide_anywhere";
      else if ((foot && dwelOrSpec("hide_improved_forest")) ||
               (!foot && dwelOrSpec("hide_anywhere")))       hideVal = "hide_improved_forest";
      else                                                     hideVal = "hide_forest";
    }
  } else if (cat === "mounted" || cat === "mounted missile") {
    if (catAllowHide) {
      const light = (2 * sMass) + (hMass / 2) < hvyCav;
      const dwelOrSpec = (ability) => dwelAb === ability || specHasAbility(spec, ability);
      if (light && dwelOrSpec("hide_anywhere")) hideVal = "hide_anywhere";
      else if ((light && dwelOrSpec("hide_improved_forest")) ||
               (!light && dwelOrSpec("hide_anywhere")))       hideVal = "hide_improved_forest";
      else                                                    hideVal = "hide_forest";
    }
  } else if ((cat === "special" || cat === "engine") && catAllowHide) {
    hideVal = "hide_forest";
  }
  if (hideVal) out["hide_forest(3)"] = hideVal;

  // Case 45 hide_long_grass (VBA L8970). Dwelling/specialty ability
  // "hide_long_grass" (or "hide_anywhere" at heavy mass) for foot; mirror
  // logic on mounted using "hide_improved_forest"/"hide_anywhere".
  let hideLG = "";
  if (cat === "foot" || cat === "foot missile" || cat === "handler") {
    if (catAllowHide) {
      const light = sMass < hvyInf;
      const dwelOrSpec = (ab) => dwelAb === ab || specHasAbility(spec, ab);
      if ((light && dwelOrSpec("hide_long_grass")) ||
          (!light && dwelOrSpec("hide_anywhere"))) hideLG = "hide_long_grass";
    }
  } else if (cat === "mounted" || cat === "mounted missile") {
    if (catAllowHide) {
      const light = (2 * sMass) + (hMass / 2) < hvyCav;
      const dwelOrSpec = (ab) => dwelAb === ab || specHasAbility(spec, ab);
      if ((light && dwelOrSpec("hide_improved_forest")) ||
          (!light && dwelOrSpec("hide_anywhere"))) hideLG = "hide_long_grass";
    }
  }
  if (hideLG) out["hide_l_grass"] = hideLG;

  // Case 46 can_sap
  const recrSap = has(str(r.recr && r.recr["Allows sap"]), "Y");
  const qualSap = has(str(r.qual && r.qual["Allows sap"]), "Y");
  if (specHasAbility(spec, "can_sap") ||
      ((cat === "foot" || cat === "foot missile") && recrSap && qualSap)) {
    out["can_sap"] = "can_sap";
  }

  // Case 47 frighten_foot
  const priFright = str(r.priWpn && r.priWpn["Frightens"]);
  const secFright = str(r.secWpn && r.secWpn["Frightens"]);
  const qualFrightFoot = has(str(r.qual && r.qual["Allows frighten foot"]), "Y");
  if (priFright === "Infantry" || priFright === "Both" || secFright === "Infantry" || secFright === "Both") {
    out["frighten_f"] = "frighten_foot";
  } else if ((cat === "mounted" || cat === "mounted missile") &&
             ((((2 * sMass) + (hMass / 2)) >= hvyCav && qualFrightFoot) ||
              specHasAbility(spec, "frighten_foot"))) {
    out["frighten_f"] = "frighten_foot";
  } else if ((cat === "foot" || cat === "foot missile" || cat === "handler") &&
             (specHasAbility(spec, "frighten_foot") || specHasAbility(spec, "berserker"))) {
    out["frighten_f"] = "frighten_foot";
  } else if (cat === "special" || cat === "chariot") {
    out["frighten_f"] = "frighten_foot";
  }

  // Case 48 frighten_mounted
  if (priFright === "Cavalry" || priFright === "Both" || secFright === "Cavalry" || secFright === "Both") {
    out["frighten_m"] = "frighten_mounted";
  } else if (cat === "special" && str(r.spMount && r.spMount["frighten_mounted"]) === "Y") {
    out["frighten_m"] = "frighten_mounted";
  } else if (specHasAbility(spec, "frighten_mounted")) {
    out["frighten_m"] = "frighten_mounted";
  }

  // Case 49 can_run_amok
  if (cat === "special" && str(r.spMount && r.spMount["run_amok"]) === "Y") {
    out["can_amok"] = "can_run_amok";
  }

  // Case 50 general_unit / general_unit_upgrade
  if (isGeneralUnit) out["gen_unit"] = isGeneralUnit;

  // Case 51 cantabrian_circle / warcry / druid
  const warcryMin = r.cult && r.cult["Warcry min class"];
  const cantMin   = r.cult && r.cult["Cantabrian min class"];
  if (cat === "foot" && specHasAbility(spec, "druid")) {
    out["cant_circle/warcry/druid"] = "druid";
  } else if (cat === "foot" && (qualMeets(qualName, warcryMin) || specHasAbility(spec, "berserker"))) {
    out["cant_circle/warcry/druid"] = "warcry";
  } else if (cat === "mounted missile" && qualMeets(qualName, cantMin)) {
    out["cant_circle/warcry/druid"] = "cantabrian_circle";
  }

  // Case 52 no_custom
  if (str(r.unit["no CBs"])) out["no_custom"] = "no_custom";

  // Case 53 command
  const recrCmd = has(str(r.recr && r.recr["Allows command"]), "Y");
  const qualCmd = has(str(r.qual && r.qual["Allows command"]), "Y");
  if (recrCmd && qualCmd) out["command"] = "command";

  // Case 54 merc_unit
  if (str(r.unit["merc unit"])) out["merc_unit"] = "mercenary_unit";

  // Case 55 hardy / very_hardy / extremely_hardy
  if (cat !== "special" && cat !== "engine" && cat !== "ship" && cat !== "chariot") {
    const cultFat = (cat === "mounted" || cat === "mounted missile") ? cultCavFat : cultInfFat;
    const specHV = specHasAbility(spec, "very_hardy");
    const specH  = specHasAbility(spec, "hardy");
    const specEH = specHasAbility(spec, "extremely_hardy");
    if (specEH && cultFat > -1) out["hardy(2)"] = "extremely_hardy";
    else if ((specHV && cultFat > -1) || (specH && cultFat > 0) ||
             (!specHV && !specH && cultFat > 1))
      out["hardy(2)"] = "very_hardy";
    else if ((specHV && cultFat === -1) || (specH && cultFat === 0) ||
             (!specHV && !specH && cultFat === 1))
      out["hardy(2)"] = "hardy";
  }

  // Case 56 power_charge
  const pwrMin = r.cult && r.cult["Powercharge min class"];
  if ((cat === "mounted" || cat === "mounted missile") && qualMeets(qualName, pwrMin)) {
    out["p_charge"] = "power_charge";
  }

  // Case 57 is_peasant
  const recrPeas = has(str(r.recr && r.recr["Allows is_peasant"]), "Y");
  const qualPeas = has(str(r.qual && r.qual["Allows is_peasant"]), "Y");
  if (cat !== "special" && cat !== "engine" && cat !== "ship" &&
      ((recrPeas && qualPeas) || specHasAbility(spec, "peasant"))) {
    out["is_peas"] = "is_peasant";
  }

  // Case 58 can_horde
  if (str(r.unit["horde unit"])) out["can_horde"] = "can_horde";

  // Case 59 free_upkeep_unit  (M2TW/KGDM only)
  if (isM2) {
    const recrFree = has(str(r.recr && r.recr["Allows free_upkeep"]), "Y");
    const qualFree = has(str(r.qual && r.qual["Allows free_upkeep"]), "Y");
    if (cat !== "special" && cat !== "engine" && cat !== "ship" && recrFree && qualFree) {
      out["free_upk"] = "free_upkeep_unit";
    }
  }

  // Case 60 knight (M2TW/KGDM only)
  if (isM2) {
    const recrKn = has(str(r.recr && r.recr["Allows knight"]), "Y");
    const qualKn = has(str(r.qual && r.qual["Allows knight"]), "Y");
    if ((cat === "mounted" || cat === "mounted missile") && recrKn && qualKn) {
      out["knight"] = "knight";
    }
  }

  // Case 61 can_withdraw (M2TW/KGDM only, inverted logic)
  if (isM2) {
    const engAllowWd = str(r.engine && r.engine["Allow withdraw"]) === "Y";
    if (cat !== "engine" || (cat === "engine" && !engAllowWd)) {
      out["can_withdraw"] = "can_withdraw";
    }
  }

  // Case 62 stakes (M2TW/KGDM only, Foot Missile with quality allowance)
  if (isM2 && cat === "foot missile" && has(str(r.qual && r.qual["Allows stakes"]), "Y")) {
    out["stakes"] = "stakes";
  }

  // Case 63 can_formed_charge (M2TW/KGDM only)
  if (isM2) {
    const fcMin = r.cult && r.cult["Formcharge min class"];
    if ((cat === "mounted" || cat === "mounted missile") && qualMeets(qualName, fcMin)) {
      out["form_charge"] = "can_formed_charge";
    }
  }

  // Case 64 cannot_skirmish (KGDM only)
  const priRange = num(r.priWpn && r.priWpn["Range"], 0);
  if (platform === "KGDM" && (cat === "foot" || cat === "mounted") && priRange !== 0) {
    out["cannot_skrm"] = "cannot_skirmish";
  }

  // Case 65 gunpowder_unit (M2TW/KGDM only)
  const priRangedType = str(r.priWpn && r.priWpn["Ranged weapon type"]);
  const engineType = str(r.engine && r.engine["Engine type"]);
  if (isM2 && (priRangedType === "gunpowder_unit" ||
               engineType === "cannon" || engineType === "rocket" || engineType === "mortar")) {
    out["gunpowder"] = "gunpowder_unit";
  }

  // Case 66 gunmen/guncavalry/crossbow/pike/incendiary/artillery
  if (isM2) {
    if (priRangedType === "gunpowder_unit" && (cat === "foot" || cat === "foot missile")) {
      out["gunmen_cav/xbow/pike/incendiary/artillery"] = "gunmen";
    } else if (priRangedType === "gunpowder_unit" && (cat === "mounted" || cat === "mounted missile")) {
      out["gunmen_cav/xbow/pike/incendiary/artillery"] = "guncavalry";
    } else if (priRangedType === "crossbow" && /^(foot|foot missile|mounted|mounted missile)$/i.test(cat)) {
      out["gunmen_cav/xbow/pike/incendiary/artillery"] = "crossbow";
    } else if (str(r.priWpn && r.priWpn["Short pike"]) === "long_pike") {
      out["gunmen_cav/xbow/pike/incendiary/artillery"] = "pike";
    } else if (str(r.projectile && r.projectile["Incendiary"]) === "Y") {
      out["gunmen_cav/xbow/pike/incendiary/artillery"] = "incendiary";
    } else if (cat === "engine" && engineType !== "standard" && engineType !== "wagon_fort") {
      out["gunmen_cav/xbow/pike/incendiary/artillery"] = "artillery";
    }
  }

  // Case 67 start_not_phalanxing / start_not_skirmishing (M2TW/KGDM only)
  if (isM2) {
    const sk = has(str(r.recr && r.recr["Allows no-start-skrm"]), "Y");
    if ((cat === "foot missile" || cat === "mounted missile") && sk) {
      out["st_n_phlnx/skrm"] = "start_not_skirmishing";
    }
  }

  // Case 68 fire_by_rank (M2TW/KGDM only)
  if (isM2) {
    const fbrMin = r.cult && r.cult["Fire-by-rank min class"];
    if (priRangedType === "gunpowder_unit" && (cat === "foot" || cat === "foot missile") && qualMeets(qualName, fbrMin)) {
      out["fire_rank"] = "fire_by_rank";
    }
  }

  // Case 69 peasant (M2TW/KGDM — already set via is_peasant on RTW; here an
  // extra "peasant" flag emitted only on M2)
  if (isM2 && specHasAbility(spec, "peasant")) out["peasant"] = "peasant";

  // Case 70 cannon/rocket/mortar/standard/wagon_fort (engine subtype, M2 only)
  if (isM2 && /^(cannon|rocket|mortar|standard|wagon_fort)$/.test(engineType)) {
    out["can/mor/roc/wag/stdr"] = engineType;
  }

  // Case 71 explode (M2/KGDM only)
  if (isM2 && str(r.engine && r.engine["Explode"]) === "Y") {
    out["explode"] = "explode";
  }

  // Case 72 unique_unit
  if (str(r.unit["unique unit"])) out["unique unit"] = "unique_unit";

  return out;
}

export { computeAttributes };
