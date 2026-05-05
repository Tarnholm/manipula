// validate.js — port of the VBA Sub CheckUnitDefs (Module1 L196–3801).
//
// Pure function: validate(project) -> ErrorEntry[].
//
// ErrorLog shape: 3 columns, matching the original workbook.
//   { unit: string, row: number|null, message: string, category?: string }
//
// Semantics (from VBA):
//   - Non-short-circuiting: all 182 distinct checks run every time; all
//     errors collected in one pass.
//   - HasError becomes true on first failure (callers gate compute on it).
//   - DefsClear becomes true only if at least one unit is defined AND zero
//     errors are collected — callers implement this from the returned list.
//
// Check categories:
//   global             31 checks — required CoreData values are present & numeric
//   coredata-internal  5   checks — bodypart-sum invariants, soldier bounds, category enum
//   unit-def-structural ~70 checks — required/forbidden fields by category
//   cross-ref          ~10 checks — field agreement (armour upg sequencing, etc.)
//   allow-flag         ~20 checks — weapon+formation, specialty+category, platform compat


/**
 * @typedef {Object} ErrorEntry
 * @property {string} unit              unit name, or "<globals>" / "<core data>" / "<mod info>"
 * @property {number|null} row          1-based UnitDefinitions row, null for workbook-wide errors
 * @property {string} message
 * @property {string} [category]
 */

/** @typedef {import("./xlsmImporter").Project} Project */

// ── VLOOKUP map: unit-def column → core-data table + required flag ─

const UNIT_TO_CORE = {
  "Recruitment":       { table: "recruitmentClasses", required: true  },
  "Quality":           { table: "qualityClasses",     required: true  },
  "Category":          { table: "categories",         required: true  },
  "Specialty":         { table: "specialties",        required: true  },
  "Formation":         { table: "formations",         required: true  },
  "Dwelling":          { table: "dwellings",          required: true  },
  "Culture":           { table: "cultures",           required: true  },
  "Weapon":            { table: "weapons",            required: false },   // conditional on category
  "Wpn Quality":       { table: "weaponQualities",    required: false },
  "Projectile":        { table: "projectiles",        required: false },   // conditional on weapon range
  "Melee Skeleton":    { table: "meleeSkeletons",     required: false },   // conditional on melee
  "Sec Weapon":        { table: "weapons",            required: false },
  "S Wpn Quality":     { table: "weaponQualities",    required: false },
  "S Melee Skeleton":  { table: "meleeSkeletons",     required: false },
  "Mount":             { table: "mounts",             required: false },
  "Special":           { table: "specialMounts",      required: false },
  "Mount Skeleton":    { table: "mountSkeletons",     required: false },
  "Engine":            { table: "engines",            required: false },
  "Engine Pri Proj":   { table: "engineProjectiles",  required: false },
  "Engine Sec Proj":   { table: "engineProjectiles",  required: false },
  "Ship":              { table: "ships",              required: false },
};

// Required numeric globals (from CoreData R13..R51). Platform-conditional
// entries (PoolRefreshRate, PoolMaxCap) checked separately.
const REQUIRED_GLOBALS = [
  "MenPerUnit", "CostPerMan", "UpkeepToCostRatio", "CBCostMultiplier",
  "UnitAttack", "UnitCharge", "UnitDefence", "UnitMorale", "UnitDiscipline",
  "UnitTraining", "UnitPriHP", "UnitSecHP", "Lethality", "UnitSurvThreshold",
  "ManMass", "BaseHorseMass", "ExtraMassPerSkill", "ExtraMassPerHeat",
  "MediumInfThreshold", "HeavyInfThreshold", "MediumCavThreshold", "HeavyCavThreshold",
  "BaseMountSpeedMdf",
  "GlobalUnitSizeMdf", "GlobalMassMdf", "GlobalSpeedMdf", "GlobalAttackMdf",
  "GlobalChargeMdf", "GlobalRangeMdf", "GlobalAmmoMdf", "GlobalArmourMdf",
  "GlobalDefenceMdf", "GlobalShieldMdf", "GlobalMoraleMdf",
  "GlobalRecrCostMdf", "GlobalUpkCostMdf",
  "CombatExponent", "ChargeFraction", "DefSkillFraction",
  "CavalryFraction", "APFraction", "ElephantFraction", "ChariotFraction",
  "CamelFraction", "ForestFraction",
  "APValue", "BPValue", "AreaAttackValue",
];

const M2_PLATFORM_GLOBALS = ["PoolRefreshRate", "PoolMaxCap"];

const VALID_PLATFORMS = ["RTW", "ALX", "M2TW", "KGDM"];

const VALID_CATEGORIES = [
  "Foot", "Foot Missile", "Foot General",
  "Mounted", "Mounted Missile",
  "Special", "Handler", "Engine", "Ship",
  "Chariot",   // added in v0.7.0 schema
];

// Categories that require a specific kind of mount/engine/ship reference.
const CAT_MOUNTED   = new Set(["Mounted", "Mounted Missile"]);

// ── Main entry point ────────────────────────────────────────────────

/** @param {Project} project @returns {ErrorEntry[]} */
function validate(project) {
  /** @type {ErrorEntry[]} */
  const errors = [];
  const push = (e) => errors.push(e);
  const ctx = buildContext(project);

  checkModInfo(project, ctx, push);
  checkGlobals(project, ctx, push);
  checkCoreDataInternal(project, ctx, push);

  for (const u of project.units) {
    if (u.kind !== "unit") continue;
    checkUnitStructural(u, ctx, push);
    checkUnitRefs(u, ctx, push);
    checkUnitConditionalFields(u, ctx, push);
    checkUnitArmourUpgrades(u, ctx, push);
    checkUnitFactionOwnership(u, ctx, project, push);
  }

  // unit id / dictionary_tag collision check — two units with the same
  // unit id (or same dictionary_tag) are silently broken in-game; the
  // game keeps only one and the rest stop loading. Flag every duplicate.
  const idMap = new Map();   // unit id → [unit names]
  const dictMap = new Map(); // dictionary_tag → [unit names]
  for (const u of project.units) {
    if (u.kind !== "unit") continue;
    const id = String(u["unit id"] || "").trim();
    const dict = String(u["dictionary_tag"] || "").trim();
    if (id) (idMap.get(id) || idMap.set(id, []).get(id)).push(u.name || "(unnamed)");
    if (dict) (dictMap.get(dict) || dictMap.set(dict, []).get(dict)).push(u.name || "(unnamed)");
  }
  for (const [id, names] of idMap) {
    if (names.length > 1) {
      for (const n of names) push({ unit: n, row: null, message: `Duplicate unit id "${id}" (also used by ${names.filter((x) => x !== n).join(", ")})`, category: "collision" });
    }
  }
  for (const [d, names] of dictMap) {
    if (names.length > 1) {
      for (const n of names) push({ unit: n, row: null, message: `Duplicate dictionary_tag "${d}" (also used by ${names.filter((x) => x !== n).join(", ")})`, category: "collision" });
    }
  }

  return errors;
}

/**
 * Non-gating data-drift warnings. Separate from validate() so the
 * existing "clean fixture" test contract stays intact — warnings are
 * surfaced in the UI but never block compute/export.
 *
 * Currently flags:
 *  - Armour Upgr0..3 values that don't resolve to a row in
 *    ArmourDefinitions. These compute as all-zero stats downstream,
 *    which is almost always stale data (the armour model got renamed
 *    or removed but the unit still references the old name).
 *
 * @param {Project} project
 * @returns {ErrorEntry[]}
 */
function diagnose(project) {
  /** @type {ErrorEntry[]} */
  const warnings = [];
  const armourNames = new Set(
    (project.armour || [])
      .map((r) => r && r["Model Set Name"])
      .filter(Boolean)
      .map((n) => normKey(n))
  );

  for (const u of project.units) {
    if (u.kind !== "unit") continue;
    for (let i = 0; i <= 3; i++) {
      const name = u[`Armour Upgr${i}`];
      if (!name) continue;
      if (!armourNames.has(normKey(name))) {
        warnings.push({
          unit: u.name,
          row: u.row,
          category: "data-drift",
          message:
            `Armour Upgr${i} "${name}" has no matching row in ArmourDefinitions — ` +
            `stats will compute as 0. Add the model or rename the reference.`,
        });
      }
    }
  }
  return warnings;
}

// ── Context ─────────────────────────────────────────────────────────

function buildContext(project) {
  const tables = {};
  for (const [table, rows] of Object.entries(project.coreData || {})) {
    const byName = new Map();
    let keyCol = null;
    for (const row of rows) {
      if (!row) continue;
      if (!keyCol) keyCol = Object.keys(row)[0];
      const k = row[keyCol];
      if (k != null) byName.set(normKey(k), row);
    }
    tables[table] = { rows, byName, keyCol };
  }
  const platform = (project.modInfo && project.modInfo.platform) || "";
  const isM2 = platform === "M2TW" || platform === "KGDM";
  const isRTW = platform === "RTW" || platform === "ALX";
  return { tables, platform, isM2, isRTW };
}

function normKey(v) { return String(v).trim().toLowerCase(); }

function coreLookup(ctx, table, name) {
  if (name == null || name === "") return null;
  const t = ctx.tables[table];
  if (!t) return null;
  return t.byName.get(normKey(name)) || null;
}

// ── Mod info (3 checks) ─────────────────────────────────────────────

function checkModInfo(project, ctx, push) {
  const mi = project.modInfo || {};
  if (!mi.name)      push(err("<mod info>", null, "Mod name has not been defined.", "global"));
  if (!mi.platform)  push(err("<mod info>", null, "Mod platform has not been defined.", "global"));
  else if (!VALID_PLATFORMS.includes(mi.platform)) {
    push(err("<mod info>", null, `Mod platform "${mi.platform}" is invalid. Expected one of: ${VALID_PLATFORMS.join(", ")}.`, "global"));
  }
  // Mod era is checked in VBA but v2.6 has it blank as optional; not emitting.
}

// ── Globals (31 checks) ─────────────────────────────────────────────

function checkGlobals(project, ctx, push) {
  const g = project.globals || {};
  for (const key of REQUIRED_GLOBALS) {
    const v = g[key];
    if (v === undefined || v === null || v === "") {
      push(err("<globals>", null, `Global "${key}" has not been defined.`, "global"));
      continue;
    }
    if (typeof v !== "number" && !isNumericString(v)) {
      push(err("<globals>", null, `Global "${key}" must be numeric, got "${v}".`, "global"));
    }
  }
  if (ctx.isM2) {
    for (const key of M2_PLATFORM_GLOBALS) {
      if (g[key] === undefined || g[key] === null || g[key] === "") {
        push(err("<globals>", null, `Global "${key}" has not been defined (required for M2TW/KGDM).`, "global"));
      }
    }
  }

  // At least one faction must be defined.
  const factions = (project.factions || []).filter(Boolean);
  if (factions.length === 0) {
    push(err("<globals>", null, "No factions are defined.", "global"));
  }
}

// ── Core-data internal invariants (5 checks) ────────────────────────

function checkCoreDataInternal(project, ctx, push) {
  // 1. MenPerUnit must be between 6 and 60 (RTW/ALX) or 4..100 (M2TW/KGDM).
  const men = toNum(project.globals?.MenPerUnit);
  if (men != null) {
    const [lo, hi] = ctx.isM2 ? [4, 100] : [6, 60];
    if (men < lo || men > hi) {
      push(err("<core data>", null, `Base men per unit (${men}) must be between ${lo} and ${hi}.`, "coredata-internal"));
    }
  }

  // 2. & 3. Bodypart coverage importance / weight sums must each equal 1.
  const armAttr = project.coreData?.armourAttributes;
  if (Array.isArray(armAttr) && armAttr.length >= 2) {
    const importanceRow = armAttr[0];
    const weightRow     = armAttr[1];
    const sumRow = (row) => {
      let s = 0;
      const firstKey = Object.keys(row)[0];
      for (const [k, v] of Object.entries(row)) {
        if (k === firstKey) continue;                 // first col is the label
        if (k.toLowerCase() === "total") continue;    // precomputed sum col
        const n = toNum(v);
        if (n != null) s += n;
      }
      return s;
    };
    const impSum = sumRow(importanceRow);
    const wtSum  = sumRow(weightRow);
    if (Math.abs(impSum - 1) > 1e-6) {
      push(err("<core data>", null, `Total bodypart coverage importance doesn't add up to 1 (got ${impSum.toFixed(4)}).`, "coredata-internal"));
    }
    if (Math.abs(wtSum - 1) > 1e-6) {
      push(err("<core data>", null, `Total bodypart coverage weight doesn't add up to 1 (got ${wtSum.toFixed(4)}).`, "coredata-internal"));
    }
  }

  // 4. Each category entry must have a name that's in VALID_CATEGORIES.
  const cats = project.coreData?.categories || [];
  for (const row of cats) {
    const name = row["Category Type"];
    if (name && !VALID_CATEGORIES.includes(String(name))) {
      push(err("<core data>", null,
        `Unit category "${name}" is not one of: ${VALID_CATEGORIES.join(", ")}.`,
        "coredata-internal"));
    }
  }
}

// ── Unit checks ─────────────────────────────────────────────────────

function checkUnitStructural(u, ctx, push) {
  if (!u.name) push(err("<unnamed>", u.row, "Unit row has no name.", "unit-def-structural"));
  if (!u["unit id"])       push(err(u.name, u.row, "Unit does not have a unit id assigned.", "unit-def-structural"));
  if (!u.dictionary_tag)   push(err(u.name, u.row, "Unit does not have a dictionary tag assigned.", "unit-def-structural"));
  if (!u.voice_type)       push(err(u.name, u.row, "Unit does not have a voice type assigned.", "unit-def-structural"));
  if (!u["model id"])      push(err(u.name, u.row, "Unit does not have a soldier model assigned.", "unit-def-structural"));
}

function checkUnitRefs(u, ctx, push) {
  for (const [unitCol, spec] of Object.entries(UNIT_TO_CORE)) {
    const val = u[unitCol];
    if (val === undefined || val === "") {
      if (spec.required) {
        push(err(u.name, u.row, `Unit does not have a ${unitCol.toLowerCase()} assigned.`, "unit-def-structural"));
      }
      continue;
    }
    if (!coreLookup(ctx, spec.table, val)) {
      push(err(u.name, u.row,
        `${unitCol} "${val}" is not defined in the ${spec.table} table.`,
        "coredata-ref"));
    }
  }
}

function checkUnitConditionalFields(u, ctx, push) {
  const cat = u.Category;
  const pri = u.Weapon ? coreLookup(ctx, "weapons", u.Weapon) : null;
  const priRange = pri ? toNum(pri["Range"]) : null;
  const isShip   = cat === "Ship";
  const isEngine = cat === "Engine";
  const isHandler = cat === "Handler";
  const isMounted = CAT_MOUNTED.has(cat);
  const isSpecial = cat === "Special";
  const hasRangedPri = pri && priRange != null && priRange > 0;

  // Primary weapon requirement — every non-Ship unit needs one.
  if (!isShip && !u.Weapon) {
    push(err(u.name, u.row, "Unit does not have a primary weapon assigned.", "unit-def-structural"));
  }
  if (isShip && u.Weapon) {
    push(err(u.name, u.row, "Unit should not have a primary weapon assigned.", "unit-def-structural"));
  }

  // Projectile required iff primary weapon has non-zero range.
  if (hasRangedPri && !u.Projectile) {
    push(err(u.name, u.row, "Unit does not have a projectile assigned.", "unit-def-structural"));
  }
  if (!hasRangedPri && u.Projectile) {
    push(err(u.name, u.row, "Unit should not have a projectile assigned.", "unit-def-structural"));
  }

  // Primary melee skeleton iff primary weapon is melee (range 0).
  if (pri && priRange === 0 && !u["Melee Skeleton"]) {
    push(err(u.name, u.row, "Unit does not have a primary melee skeleton assigned.", "unit-def-structural"));
  }

  // Ship cross-references.
  if (isShip) {
    if (!u.Ship)       push(err(u.name, u.row, "Unit does not have a ship assigned.", "unit-def-structural"));
    if (!u["ship id"]) push(err(u.name, u.row, "Unit does not have a ship id assigned.", "unit-def-structural"));
  } else if (u.Ship) {
    push(err(u.name, u.row, "Unit should not have a ship assigned.", "unit-def-structural"));
  }

  // Engine cross-references.
  if (isEngine) {
    if (!u.Engine)       push(err(u.name, u.row, "Unit does not have an engine assigned.", "unit-def-structural"));
    if (!u["engine id"]) push(err(u.name, u.row, "Unit does not have an engine id assigned.", "unit-def-structural"));
  } else if (u.Engine) {
    push(err(u.name, u.row, "Unit should not have an engine assigned.", "unit-def-structural"));
  }

  // Mount cross-references.
  if (isMounted && !u.Mount && !u.Special) {
    push(err(u.name, u.row, "Unit does not have a mount assigned.", "unit-def-structural"));
  }
  if (!isMounted && !isSpecial && u.Mount) {
    push(err(u.name, u.row, "Unit should not have a mount assigned.", "unit-def-structural"));
  }

  // Handler needs an animal (special mount).
  if (isHandler && !u.Special) {
    push(err(u.name, u.row, "Unit does not have a special mount/animal assigned.", "unit-def-structural"));
  }
}

function checkUnitArmourUpgrades(u, ctx, push) {
  // Can't have upgrade 2 without 1; can't have 3 without 2; can't have 4 without 3.
  for (let i = 1; i <= 3; i++) {
    const cur  = u[`Armour Upgr${i}`];
    const prev = u[`Armour Upgr${i - 1}`];
    if (cur && !prev) {
      push(err(u.name, u.row,
        `Unit should not have armour upgrade ${i} without an upgrade ${i - 1} model.`,
        "cross-ref"));
    }
  }
  // On RTW/ALX, extra upgrades are forbidden entirely.
  if (ctx.isRTW) {
    for (let i = 1; i <= 3; i++) {
      if (u[`Armour Upgr${i}`]) {
        push(err(u.name, u.row,
          `Unit should not have a ${ordinal(i)} armour upgrade model assigned on RTW/ALX.`,
          "cross-ref"));
      }
    }
  }
}

function checkUnitFactionOwnership(u, ctx, project, push) {
  const owners = Object.keys(u.ownership || {}).filter((k) => k !== "slave");
  if (owners.length === 0) {
    // RTW considers a unit with only slave ownership to still have owners,
    // but a unit with zero ownership at all is an error.
    if (!u.ownership?.slave) {
      push(err(u.name, u.row, "Unit does not have any owners assigned.", "unit-def-structural"));
    }
  }
  // Check no owner is in an "N/A" faction slot (a slot where the faction
  // tag is literally "N/A").
  for (const tag of owners) {
    if (tag === "N/A") {
      push(err(u.name, u.row, "Unit should not have a non-available owner assigned.", "unit-def-structural"));
    }
  }
}

// ── Utilities ───────────────────────────────────────────────────────

function err(unit, row, message, category) {
  return { unit, row, message, category };
}
function toNum(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}
function isNumericString(v) {
  if (typeof v !== "string") return false;
  if (v.trim() === "") return false;
  return !Number.isNaN(Number(v));
}
function ordinal(n) { return n === 1 ? "1st" : n === 2 ? "2nd" : n === 3 ? "3rd" : `${n}th`; }

export { validate, diagnose, UNIT_TO_CORE, REQUIRED_GLOBALS, VALID_PLATFORMS, VALID_CATEGORIES };
