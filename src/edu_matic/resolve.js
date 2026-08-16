// resolve.js — port of the VBA Sub ParseUnitDefs (Module1 L3802–4836).
//
// Given a unit row from UnitDefinitions and a Project, produce a
// ResolvedUnit: the unit + every referenced core-data row embedded under a
// short name. Downstream formula code reads `u.recr.AttackMdf` etc. instead
// of calling lookups itself — mirrors the VBA's "pull each field into a
// module-level variable" pattern, but cleaner.


/** @typedef {import("./xlsmImporter").Project} Project */

// VBA variable name prefix → unit-def column + core-data table.
const RESOLVE_MAP = [
  { slot: "recr",       col: "Recruitment",      table: "recruitmentClasses" },
  { slot: "qual",       col: "Quality",          table: "qualityClasses"     },
  { slot: "cat",        col: "Category",         table: "categories"         },
  { slot: "spec",       col: "Specialty",        table: "specialties"        },
  { slot: "spec2",      col: "Specialty 2",      table: "specialties"        },
  { slot: "form",       col: "Formation",        table: "formations"         },
  { slot: "dwel",       col: "Dwelling",         table: "dwellings"          },
  { slot: "cult",       col: "Culture",          table: "cultures"           },
  { slot: "priWpn",     col: "Weapon",           table: "weapons"            },
  { slot: "priWpnQual", col: "Wpn Quality",      table: "weaponQualities"    },
  { slot: "projectile", col: "Projectile",       table: "projectiles"        },
  { slot: "priSkel",    col: "Melee Skeleton",   table: "meleeSkeletons"     },
  { slot: "secWpn",     col: "Sec Weapon",       table: "weapons"            },
  { slot: "secWpnQual", col: "S Wpn Quality",    table: "weaponQualities"    },
  { slot: "secSkel",    col: "S Melee Skeleton", table: "meleeSkeletons"     },
  { slot: "mount",      col: "Mount",            table: "mounts"             },
  { slot: "spMount",    col: "Special",          table: "specialMounts"      },
  { slot: "mountSkel",  col: "Mount Skeleton",   table: "mountSkeletons"     },
  { slot: "engine",     col: "Engine",           table: "engines"            },
  { slot: "enginePri",  col: "Engine Pri Proj",  table: "engineProjectiles"  },
  { slot: "engineSec",  col: "Engine Sec Proj",  table: "engineProjectiles"  },
  { slot: "ship",       col: "Ship",             table: "ships"              },
];

function normKey(v) { return String(v).trim().toLowerCase(); }

// ── Specialty 1 + 2 merge ───────────────────────────────────────────
//
// A unit carries up to two specialties. Specialty 1 is the base; Specialty 2
// layers on top of it and is blank by default, so a unit using only
// Specialty 1 resolves exactly as it always did.
//
// Merge rules (every downstream formula reads the single merged `r.spec`,
// so none of them need to know two specialties exist):
//   - a NON-BLANK cell in Specialty 2 overrides Specialty 1's cell —
//     that's the "they contradict, 2 wins" case;
//   - a BLANK cell in Specialty 2 leaves Specialty 1's value alone —
//     that's what lets the two combine;
//   - the "special ability" slots are the exception: they UNION rather
//     than override, so "Very Hardy" + "Swim" gives a unit that is both,
//     instead of whichever ability happened to sit in slot 1. Duplicates
//     are dropped and the merged row spills into "special ability 4",
//     "special ability 5", … when the two specialties carry more than
//     three abilities between them.
//   - both specialty names are remembered under __specNames so the two
//     name-keyed special cases in the formulas (Naked Warriors mass,
//     Chariot primary HP) still fire when the name sits in either slot.

const ABILITY_SLOT_RX = /^special ability(\s+\d+)?$/i;

function isBlank(v) { return v === null || v === undefined || String(v).trim() === ""; }

/** Non-blank "special ability*" values of a specialty row, in column order. */
function abilitiesOf(spec) {
  const out = [];
  if (!spec) return out;
  for (const [k, v] of Object.entries(spec)) {
    if (!ABILITY_SLOT_RX.test(k) || isBlank(v)) continue;
    out.push(String(v).trim());
  }
  return out;
}

/** Every specialty name that went into a (possibly merged) specialty row. */
function specNames(spec) {
  if (!spec) return [];
  if (Array.isArray(spec.__specNames)) return spec.__specNames;
  return [spec["Specialty Type"]];
}

/** Case-insensitive "is this (merged) specialty <name>?" test. */
function specIs(spec, name) {
  const want = normKey(name);
  return specNames(spec).some((n) => n != null && normKey(n) === want);
}

/**
 * Layer Specialty 2 over Specialty 1. Either side may be null.
 * @returns {object|null} a NEW row — neither input is mutated.
 */
function mergeSpecialties(base, over) {
  if (!over) return base;
  if (!base) return over;
  const merged = { ...base };
  for (const [k, v] of Object.entries(over)) {
    if (ABILITY_SLOT_RX.test(k)) continue;   // unioned below, not overridden
    if (isBlank(v)) continue;                // blank in 2 = keep 1's value
    merged[k] = v;
  }
  // Abilities: Specialty 2's first (it's the overriding row), then any of
  // Specialty 1's it didn't already name.
  const abilities = [];
  const seen = new Set();
  for (const a of [...abilitiesOf(over), ...abilitiesOf(base)]) {
    const k = a.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    abilities.push(a);
  }
  for (const k of Object.keys(merged)) if (ABILITY_SLOT_RX.test(k)) delete merged[k];
  abilities.forEach((a, i) => {
    merged[i === 0 ? "special ability" : `special ability ${i + 1}`] = a;
  });
  merged.__specNames = [...specNames(base), ...specNames(over)];
  return merged;
}

/**
 * Build lookup indexes for a project once; reuse across all unit resolves.
 * @param {Project} project
 */
function buildIndex(project) {
  const tables = {};
  for (const [name, rows] of Object.entries(project.coreData || {})) {
    const byName = new Map();
    let keyCol = null;
    for (const row of rows) {
      if (!row) continue;
      if (!keyCol) keyCol = Object.keys(row)[0];
      const k = row[keyCol];
      if (k != null) byName.set(normKey(k), row);
    }
    tables[name] = { rows, byName, keyCol };
  }
  return { tables, project };
}

function lookup(idx, table, name) {
  if (name == null || name === "") return null;
  const t = idx.tables[table];
  if (!t) return null;
  return t.byName.get(normKey(name)) || null;
}

/**
 * Resolve one unit's FK slots into embedded core-data rows.
 * Unresolved slots get null (not undefined — explicit).
 *
 * @param {object} unit
 * @param {ReturnType<typeof buildIndex>} idx
 * @returns {object}  ResolvedUnit
 */
function resolveUnit(unit, idx) {
  const out = { unit };
  for (const { slot, col, table } of RESOLVE_MAP) {
    out[slot] = lookup(idx, table, unit[col]);
  }
  // Fold Specialty 2 into `spec` so every formula keeps reading one row.
  // spec2 stays on the resolved unit for anything that needs the raw pair.
  out.spec = mergeSpecialties(out.spec, out.spec2);
  // Keep the primary-weapon range easily accessible for downstream classifiers.
  out.priRange = toNum(out.priWpn && out.priWpn["Range"]);
  out.secRange = toNum(out.secWpn && out.secWpn["Range"]);
  return out;
}

function toNum(v) {
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

export { buildIndex, resolveUnit, lookup, mergeSpecialties, specIs };
