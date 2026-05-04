// armour.js — port of the VBA Sub GetArmourUpgr (Module1 L4894–6135).
//
// Resolves an armour model (by name) at a given upgrade level into a
// consolidated set of stats: mass, armour value, heat modifier, shield
// value, shield defence, hit sound, cost, armour level.
//
// The formula per body-part slot (from VBA L5915):
//
//   ModelSlotArmourMass =
//     SlotInstances × SlotMatMassMdf × Σ_bp (weight[bp] × cover[bp])
//
//   ModelSlotArmourValue =
//     SlotInstances × SlotMatArmourMdf × Σ_bp (importance[bp] × cover[bp])
//
//   ModelSlotArmourHeatMdf =
//     SlotInstances × SlotMatHeatMdf × Σ_bp (weight[bp] × cover[bp])
//
//   ModelSlotArmourCost =
//     SlotInstances × SlotTypeCost × SlotMatCostMdf
//
// The shield block (L5914, L5927, L5952–5956):
//
//   ModelShieldMass        = ShieldInstances × ShieldSize.Mass   × ShieldMat.MassMdf
//   ModelShieldArmourValue = ShieldInstances × GetAttr(onBack,"Y") × ShieldSize.Shield × ShieldMat.DefenceMdf
//   ModelShieldValue       = ShieldInstances × (GlobalShieldMdf × ShieldSize.Shield × ShieldMat.ShieldMdf + …) × (1 − GetAttr(onBack,"Y"))
//   ModelShieldDefenceVal  = ShieldInstances × ShieldSize.Defence × ShieldMat.DefenceMdf × (1 − GetAttr(onBack,"Y"))
//   ModelShieldCost        = ShieldInstances × ShieldSize.Cost    × ShieldMat.CostMdf
//
// For multi-variation models (only honored on M2TW/KGDM), the per-variation
// sums are divided by total instances across variations. For single-variation
// models (RTW path), instance counts cancel and the average reduces to the
// single value.


// Slot → the core-data table it looks up its Type in, and a short key used
// in the result object. Instances default to 1 when missing (per VBA L5262).
const SLOTS = [
  { slot: "Head1",  table: "armourHead",     key: "Head1"  },
  { slot: "Head2",  table: "armourHead",     key: "Head2"  },
  { slot: "Torso1", table: "armourTorso",    key: "Torso1" },
  { slot: "Torso2", table: "armourTorso",    key: "Torso2" },
  { slot: "Torso3", table: "armourTorso",    key: "Torso3" },
  { slot: "UpArm",  table: "armourUpperArm", key: "UpArm"  },
  { slot: "LowArm", table: "armourLowerArm", key: "LowArm" },
  { slot: "Hand",   table: "armourHand",     key: "Hand"   },
  { slot: "UpLeg",  table: "armourUpperLeg", key: "UpLeg"  },
  { slot: "LowLeg", table: "armourLowerLeg", key: "LowLeg" },
  { slot: "Foot",   table: "armourFoot",     key: "Foot"   },
];

// The 14 body-parts used by the coverage × weight/importance dot-product.
// Keys match both armourAttributes column labels and the "X Coverage" suffix
// pattern used in every armour-type table.
const BODY_PARTS = [
  "Head", "Face", "Shoulders", "Chest", "Up. Back", "Abdom.",
  "Low. Back", "Loins", "Up. Arm", "Low. Arm", "Hands",
  "Up. Leg", "Low. Leg", "Feet",
];

/** Read "X Coverage" values from an armour-type row as a 14-part vector. */
function readCoverage(typeRow) {
  const out = {};
  for (const bp of BODY_PARTS) {
    const v = typeRow ? typeRow[`${bp} Coverage`] : undefined;
    out[bp] = num(v, 0);
  }
  return out;
}

/** Dot product of coverage with a 14-part weight vector. */
function dot(coverage, weightVec) {
  let s = 0;
  for (const bp of BODY_PARTS) s += coverage[bp] * weightVec[bp];
  return s;
}

function normKey(v) { return String(v).trim().toLowerCase(); }
function num(v, dflt) {
  if (v === null || v === undefined || v === "") return dflt;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : dflt;
}

/** Case-insensitive row lookup in a core-data table. */
function tableLookup(rows, keyCol, name) {
  if (name == null || name === "") return null;
  const want = normKey(name);
  for (const r of rows) if (r && r[keyCol] != null && normKey(r[keyCol]) === want) return r;
  return null;
}

/**
 * Resolve an armour model to its consolidated stats.
 *
 * @param {string} modelName           the "Armour Upgr0/1/2/3" cell value
 * @param {import("./xlsmImporter").Project} project
 * @param {string} platform            "RTW" | "ALX" | "M2TW" | "KGDM"
 * @returns {{mass:number,value:number,heatMdf:number,
 *           shieldValue:number,shieldDefence:number,shieldOnBack:number,
 *           hitSound:string,cost:number,level:number}}
 */
function resolveArmour(modelName, project, platform) {
  const empty = {
    mass: 0, value: 0, heatMdf: 0,
    shieldValue: 0, shieldDefence: 0, shieldOnBack: 0,
    // VBA with zero votes falls to the "metal" branch; match that.
    hitSound: "metal", cost: 0, level: 0,
  };
  if (!modelName) return empty;

  const cd = project.coreData || {};
  const armourRows = project.armour || [];
  const globals = project.globals || {};

  // importance + weight weighting vectors (row 0 / row 1 of armourAttributes).
  const attrRows = cd.armourAttributes || [];
  const imp = {}, wt = {};
  for (const bp of BODY_PARTS) {
    imp[bp] = num(attrRows[0] && attrRows[0][bp], 0);
    wt[bp]  = num(attrRows[1] && attrRows[1][bp], 0);
  }

  // Per-slot materials/sizes tables.
  const mats = cd.armourMaterials || [];
  const shieldSizes = cd.shieldSizes || [];
  const shieldMats  = cd.shieldMaterials || [];

  // Collect all rows matching this model name. On RTW/ALX use only the first.
  const wanted = normKey(modelName);
  const matchingRows = armourRows.filter((r) => normKey(r["Model Set Name"] || "") === wanted);
  const isM2 = platform === "M2TW" || platform === "KGDM";
  // v0.7.0 processes all variations on RTW too (VBA loop condition
  // dropped the ModPlatform<>"RTW" guard). Detect by presence of the
  // v0.7.0-only CombatExp global.
  const isV070 = globals.CombatExp !== undefined;
  const allowAllVariations = isM2 || isV070;
  const variations = allowAllVariations ? matchingRows : matchingRows.slice(0, 1);
  if (variations.length === 0) return empty;

  // Accumulators, parallel to VBA Head1ArmourMass / TotalHead1ArmourInstances.
  const slotSum   = {};   // SlotArmourMass accumulator, per slot key
  const slotInst  = {};   // TotalSlotInstances accumulator
  const slotValue = {};
  const slotHeat  = {};
  const slotCost  = {};
  for (const s of SLOTS) { slotSum[s.key] = 0; slotInst[s.key] = 0; slotValue[s.key] = 0; slotHeat[s.key] = 0; slotCost[s.key] = 0; }
  let shieldSum = 0, shieldValueSum = 0, shieldDefSum = 0, shieldCostSum = 0;
  let primShieldValueSum = 0;
  let shieldInstTotal = 0;
  let shieldOnBackCount = 0;
  let shieldAllowSW = false;
  // Hit-sound voting (VBA L6032–6038): only the Torso1 material casts a
  // vote, weighted by Torso1 instances. Other slots do NOT contribute.
  let hitSoundVotes = { flesh: 0, leather: 0, metal: 0 };
  let shieldMatSound = "";       // v0.7.0 appends shield material's sound
  let maxLevel = 0;

  for (const row of variations) {
    // ── body parts ──────────────────────────────────────────────
    for (const s of SLOTS) {
      const cell = row[s.slot];
      // VBA accumulates SlotArmourInstances for every variation (L8309),
      // regardless of whether that variation has a type in the slot —
      // the no-type case contributes 0 to the numerator but still widens
      // the denominator when slot sums are averaged.
      const inst = num(cell && cell.instances, 1);
      slotInst[s.key] += inst;
      if (!cell || !cell.type) continue;
      const typeRow = tableLookup(cd[s.table] || [], "Armour Type", cell.type);
      const matRow  = tableLookup(mats, "Armour Material", cell.material);
      if (!typeRow) continue;
      const massMdf = num(matRow && matRow["Mass mdf"],   0);
      const armMdf  = num(matRow && matRow["Armour mdf"], 0);
      const heatMdf = num(matRow && matRow["Heat mdf"],   0);
      const costMdf = num(matRow && matRow["Cost mdf"],   0);
      const cost    = num(typeRow["Cost"], 0);
      const level   = num(matRow && matRow["Armour level"], 0);
      const cov = readCoverage(typeRow);
      const weightDot = dot(cov, wt);
      const impDot    = dot(cov, imp);
      slotSum[s.key]   += inst * massMdf * weightDot;
      slotValue[s.key] += inst * armMdf  * impDot;
      slotHeat[s.key]  += inst * heatMdf * weightDot;
      slotCost[s.key]  += inst * cost    * costMdf;
      if (level > maxLevel) maxLevel = level;
      // Torso1 material is the sole voter on hit sound (VBA L6032–6038).
      // Votes accumulate across variations; weighted by instances count.
      if (s.slot === "Torso1") {
        const sound = String((matRow && matRow["Hit sound"]) || "metal").toLowerCase();
        if (sound === "flesh" || sound === "leather" || sound === "metal") {
          hitSoundVotes[sound] += inst;
        } else {
          hitSoundVotes.metal += inst;    // VBA else-branch: unknown → metal
        }
      }
    }
    // ── shield ──────────────────────────────────────────────────
    const shield = row.Shield;
    // Match slot-accumulator behaviour: grow denominator every variation,
    // even when that variation has no shield.
    {
      const shInst = num(shield && shield.instances, 1);
      shieldInstTotal += shInst;
    }
    // VBA L8289 assigns ShieldMatSound unconditionally from the cell —
    // so a later variation with no shield material OVERWRITES any value
    // captured by earlier variations. Replicate that: take the sound
    // from the LAST variation regardless of whether it's empty.
    {
      const matRow = shield && shield.material
        ? tableLookup(shieldMats, "Shield Material", shield.material)
        : null;
      const matSound = String((matRow && (matRow["Shield sound"] || matRow["Hit sound"])) || "").toLowerCase();
      shieldMatSound = matSound;
    }
    if (shield && (shield.size || shield.onBack)) {
      const sizeRow = tableLookup(shieldSizes, "Shield Size", shield.size || shield.onBack);
      const matRow  = tableLookup(shieldMats,  "Shield Material", shield.material);
      const inst = num(shield.instances, 1);
      const sizeMass     = num(sizeRow && sizeRow["Mass"],    0);
      const sizeShield   = num(sizeRow && sizeRow["Shield"],  0);
      const sizeDefence  = num(sizeRow && sizeRow["Defence"], 0);
      const sizeCost     = num(sizeRow && sizeRow["Cost"],    0);
      const matMass      = num(matRow && matRow["Mass mdf"],    0);
      const matShield    = num(matRow && matRow["Shield mdf"],  0);
      const matDefence   = num(matRow && matRow["Defence mdf"], 0);
      const matCost      = num(matRow && matRow["Cost mdf"],    0);
      const gShield      = num(globals.GlobalShieldMdf, 1);
      const onBack = shield.onBack ? 1 : 0;
      if (onBack) shieldOnBackCount += inst;
      // v0.7.0 / v2.6 shieldSizes carry an "Allows ShldWall/Trts" column
      // gating testudo / shield_wall formations (VBA L8264).
      const sizeAllowSW = String((sizeRow && (sizeRow["Allows ShldWall/Trts"] || sizeRow["Allows shld-wall/trts"])) || "").toUpperCase() === "Y";
      if (sizeAllowSW) shieldAllowSW = true;

      shieldSum       += inst * sizeMass * matMass;
      // ArmourValue contribution from shield (VBA L5927):
      //   ShieldInstances × GetAttribute(ShieldOnBack,"Y") × ShieldSizeShield × ShieldMatDefenceMdf
      shieldValueSum  += inst * onBack * sizeShield * matDefence;
      // Primary shield stats (VBA L5952, L5954): gated by (1 − onBack) so
      // an on-back shield gives no shield-skill bonus, only its armour
      // contribution above.
      shieldDefSum    += inst * sizeDefence * matDefence * (1 - onBack);
      shieldCostSum   += inst * sizeCost * matCost;
      // Primary shield ("shield" stat in EDU) — value without onBack zeros it:
      //   ShieldInstances × (GlobalShieldMdf × ShieldSize.Shield × ShieldMat.ShieldMdf
      //                      + GetAttribute(UnitShieldWall,"Y"))
      //                   × (1 − onBack)
      // UnitShieldWall handling (for shield-wall formation bonus) is TODO
      // — most units are 0, and the term doesn't apply until that formation
      // resolver lands.
      primShieldValueSum += inst * gShield * sizeShield * matShield * (1 - onBack);
    }
  }

  // ── divide slot sums by total instances (VBA L6047) ──────────
  // If instances is 0 for a slot, the term drops to 0 (avoid NaN).
  const safeDiv = (num, inst) => (inst > 0 ? num / inst : 0);
  let armourMass = 0;
  let armourValue = 0;
  let armourHeatMdf = 0;
  let armourCost = 0;
  for (const s of SLOTS) {
    armourMass    += safeDiv(slotSum[s.key],   slotInst[s.key]);
    armourValue   += safeDiv(slotValue[s.key], slotInst[s.key]);
    armourHeatMdf += safeDiv(slotHeat[s.key],  slotInst[s.key]);
    armourCost    += safeDiv(slotCost[s.key],  slotInst[s.key]);
  }
  // Shield contribution to soldier mass + armour value + cost are added too.
  armourMass   += safeDiv(shieldSum,      shieldInstTotal);
  armourValue  += safeDiv(shieldValueSum, shieldInstTotal);
  armourCost   += safeDiv(shieldCostSum,  shieldInstTotal);

  // Shield fields emitted separately on stat_pri_armour:
  const primShieldValue   = safeDiv(primShieldValueSum, shieldInstTotal);
  const primShieldDefence = safeDiv(shieldDefSum, shieldInstTotal);

  // Hit-sound picker (VBA L6066–6078) — peculiar nested-if structure
  // that defaults to "metal" when all votes are zero:
  //   If Flesh > Leather:
  //     If Flesh > Metal: "flesh" else "metal"
  //   Else:
  //     If Leather > Metal: "leather" else "metal"
  let hitSound;
  if (hitSoundVotes.flesh > hitSoundVotes.leather) {
    hitSound = (hitSoundVotes.flesh > hitSoundVotes.metal) ? "flesh" : "metal";
  } else {
    hitSound = (hitSoundVotes.leather > hitSoundVotes.metal) ? "leather" : "metal";
  }
  // v0.7.0 appends the shield material's hit sound ("leather, metal").
  if (shieldMatSound) hitSound = `${hitSound}, ${shieldMatSound}`;

  return {
    mass: armourMass,
    value: armourValue,
    heatMdf: armourHeatMdf,
    shieldValue: primShieldValue,     // filled in by compute.js (depends on globals)
    shieldDefence: primShieldDefence,
    shieldOnBack: shieldOnBackCount > 0 ? 1 : 0,
    shieldAllowSW,
    hitSound,
    cost: armourCost,
    level: maxLevel,
  };
}

export { resolveArmour };
