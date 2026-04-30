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
  { id: "29. forest elephant",                  role: "cavalry",  tierHint: 3 },
  { id: "30. indian elephant",                  role: "cavalry",  tierHint: 3 },
  { id: "31. armoured elephant",                role: "cavalry",  tierHint: 3 },
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

// Roles for the roster grid — the columns. "general" gets its own swimlane.
export const ROSTER_ROLES = ["missile", "infantry", "cavalry", "general", "siege", "naval"];

export function roleOf(qc) {
  const q = findQualityClass(qc);
  return q ? q.role : "infantry";
}
