// EDUMatic Quality Class master list — used as autocomplete for the Quality Class field on each unit.
// Source: EDUMatic spreadsheet (RIS workflow conversation).
// Each entry maps to a unit role + an implied tier hint (1..3 based on the tier prefix in the name).
//
// Tier inference from the prefix:
//   "levy" / "peasant"      → tier 1
//   no prefix / "a" suffix  → tier 1 (e.g. "spearman", "hoplite", "infantry")
//   "professional" / "b"    → tier 2
//   "elite" / "c"           → tier 3
//   "veteran" / "d"         → tier 3
//
// Unit role inferred from the noun (slinger/archer/javelinman = missile, infantry/spearman/hoplite = infantry, etc.).
//
// The user can override the per-unit canonical mic_tier even after picking a Quality Class — this is just a hint.

export const QUALITY_CLASSES = [
  { id: "01. peasant",                          role: "infantry", tierHint: 1 },
  { id: "02. levy slinger",                     role: "missile",  tierHint: 1 },
  { id: "02a. slinger",                         role: "missile",  tierHint: 1 },
  { id: "02b. elite slinger",                   role: "missile",  tierHint: 3 },
  { id: "03. levy archer",                      role: "missile",  tierHint: 1 },
  { id: "03a. archer",                          role: "missile",  tierHint: 1 },
  { id: "03b. professional archer",             role: "missile",  tierHint: 2 },
  { id: "03c. elite archer",                    role: "missile",  tierHint: 3 },
  { id: "04. levy javelinman",                  role: "missile",  tierHint: 1 },
  { id: "04a. javelinman",                      role: "missile",  tierHint: 1 },
  { id: "04b. professional javelinman",         role: "missile",  tierHint: 2 },
  { id: "04c. elite javelinman",                role: "missile",  tierHint: 3 },
  { id: "5. levy infantry",                     role: "infantry", tierHint: 1 },
  { id: "5a. infantry",                         role: "infantry", tierHint: 1 },
  { id: "5b. professional infantry",            role: "infantry", tierHint: 2 },
  { id: "5c. elite infantry",                   role: "infantry", tierHint: 3 },
  { id: "5d. veteran infantry",                 role: "infantry", tierHint: 3 },
  { id: "06. levy spearman",                    role: "infantry", tierHint: 1 },
  { id: "06a. spearman",                        role: "infantry", tierHint: 1 },
  { id: "06b. professional spearman",           role: "infantry", tierHint: 2 },
  { id: "06c. elite spearman",                  role: "infantry", tierHint: 3 },
  { id: "06d. veteran spearman",                role: "infantry", tierHint: 3 },
  { id: "07. levy hoplite",                     role: "infantry", tierHint: 1 },
  { id: "07a. hoplite",                         role: "infantry", tierHint: 1 },
  { id: "07b. professional hoplite",            role: "infantry", tierHint: 2 },
  { id: "07c. elite hoplite",                   role: "infantry", tierHint: 3 },
  { id: "16B. naked fanatics",                  role: "infantry", tierHint: 1 },
  { id: "17. light HA",                         role: "cavalry",  tierHint: 1 },
  { id: "18. medium HA",                        role: "cavalry",  tierHint: 2 },
  { id: "19. heavy HA",                         role: "cavalry",  tierHint: 3 },
  { id: "20. cataphract HA",                    role: "cavalry",  tierHint: 3 },
  { id: "21. missile cavalry",                  role: "cavalry",  tierHint: 1 },
  { id: "22. light cav",                        role: "cavalry",  tierHint: 1 },
  { id: "23. medium cav",                       role: "cavalry",  tierHint: 2 },
  { id: "24. heavy cav",                        role: "cavalry",  tierHint: 3 },
  { id: "25. elite cav",                        role: "cavalry",  tierHint: 3 },
  { id: "26. cataphract",                       role: "cavalry",  tierHint: 3 },
  { id: "27. chariot",                          role: "cavalry",  tierHint: 2 },
  { id: "28. scythed chariot",                  role: "cavalry",  tierHint: 2 },
  { id: "29. forest elephant",                  role: "elephant", tierHint: 3 },
  { id: "30. indian elephant",                  role: "elephant", tierHint: 3 },
  { id: "31. armoured elephant",                role: "elephant", tierHint: 3 },
  { id: "32. general",                          role: "general",  tierHint: 1 },
  { id: "32. chariot general",                  role: "general",  tierHint: 1 },
  { id: "33. infantry general",                 role: "general",  tierHint: 1 },
  { id: "35. greek royal guards",               role: "infantry", tierHint: 3 },
  { id: "36. greek royal pikes",                role: "infantry", tierHint: 3 },
  { id: "36B. epigonoi phalangites",            role: "infantry", tierHint: 3 },
  { id: "37A. roman auxilia (no testudo)",      role: "infantry", tierHint: 2 },
  { id: "37B. roman auxilia",                   role: "infantry", tierHint: 2 },
  { id: "38. early imperial legionary",         role: "infantry", tierHint: 3 },
  { id: "39. early imperial legionary 1st",     role: "infantry", tierHint: 3 },
  { id: "40. late imperial legionary",          role: "infantry", tierHint: 3 },
  { id: "41. late imperial legionary 1st",      role: "infantry", tierHint: 3 },
  { id: "42. siege",                            role: "siege",    tierHint: 2 },
  { id: "43. ship",                             role: "naval",    tierHint: 1 },
];

// Lookup helpers
export function findQualityClass(id) {
  if (!id) return null;
  const norm = id.toLowerCase().trim();
  return QUALITY_CLASSES.find(q => q.id.toLowerCase() === norm) || null;
}

// Roster overview row order (top → bottom). Matches the recruitment output order.
// Camels and elephants are conditional rows in the UI — hidden when the faction has zero
// authored units in those categories. Same for siege and naval.
export const ROSTER_ROLES = ["infantry", "missile", "cavalry", "camel", "elephant", "general", "siege", "naval"];

// Classify a unit into a role bucket. Uses the Quality Class first (most reliable), then falls
// back to recruit-name heuristics so manually authored units without a QC still land in the right
// row. Same logic as the generator's bucketOf — kept unified to prevent the two views drifting.
export function categorizeUnit(unit) {
  if (!unit) return "infantry";
  const qc = String(unit.qualityClass || "");
  if (qc) {
    if (/camel/i.test(qc)) return "camel";
    if (/elephant/i.test(qc)) return "elephant";
    if (/general/i.test(qc)) return "general";
    if (/(slinger|archer|javelin|missile)/i.test(qc)) return "missile";
    if (/(hoplite|spearman|infantry|fanatic|legionary|auxilia|phalangite|guard)/i.test(qc)) return "infantry";
    if (/(cav|HA\b)/i.test(qc)) return "cavalry";
  }
  const n = String(unit.unit || "").toLowerCase();
  if (/(elephant|olifant)/.test(n)) return "elephant";
  if (/camel/.test(n)) return "camel";
  if (/(\bgeneral\b|legatus|imperator|royal\s+escort)/.test(n)) return "general";
  if (/(slinger|funditor|archer|toxotai|toxotes|javelinman|javelin|akontistai)/.test(n)) return "missile";
  if (/(cavalry|horseman|equit(es)?\b|lancer|cataphract)/.test(n)) return "cavalry";
  return "infantry";
}

export function roleOf(qc) {
  const q = findQualityClass(qc);
  return q ? q.role : "infantry";
}

// Units the tool ignores entirely — ships are out until the ports/recruitment overhaul,
// and "mob" units (peasant mob, town mob, rebel mob, etc.) are uprising spawns that
// don't get authored recruitment lines. Pass either the unit family or the EDU entry.
export function isNonRecruitable(unitOrEdu) {
  if (!unitOrEdu) return false;
  const cat = String(unitOrEdu.category || "").toLowerCase();
  const cls = String(unitOrEdu.class || "").toLowerCase();
  if (cat === "ship") return true;
  if (cat === "non_combatant") return true;
  const name = String(unitOrEdu.unit || unitOrEdu.type || "").toLowerCase();
  // Mob units = peasant rabble (peasants, barb peasants, slave/eastern/etc. peasants).
  // These are uprising spawns / placeholder garrisons, never authored as proper recruits.
  if (/\bmob\b/.test(name)) return true;
  if (/\bpeasants?\b/.test(name)) return true;
  if (/\bmob\b/.test(cls)) return true;
  const qc = String(unitOrEdu.qualityClass || "").toLowerCase();
  if (/\bship\b/.test(qc)) return true;
  if (/\bpeasant\b/.test(qc)) return true;
  return false;
}
