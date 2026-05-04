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

export { buildIndex, resolveUnit, lookup };
