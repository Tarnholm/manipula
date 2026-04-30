// Grade (Quality Class) — drives the default per-gov emission shape and tier requirements.
// Each grade defines defaults. The user can override any field per unit.
//
// Grade table (from RIS workflow conversation):
//   Levy         → tier 1 canonical, tier 1 homeland, GovB/C/D, no homeland discount
//   Standard     → tier 1 canonical, tier 1 homeland, GovB/C/D, no homeland discount
//   Professional → tier 2 canonical, tier 2 homeland, GovB/C/D, no homeland discount
//   Elite        → tier 3 canonical, tier 2 homeland, GovC/D only, -1 homeland discount
//   Veteran      → tier 3 canonical, tier 2 homeland, GovC/D only, -1 homeland discount
//
// Colony tier defaults are best-guess — confirm with mod author and tweak as needed.

export const GRADE_DEFAULTS = {
  Levy:         { canonicalMicTier: 1, homelandMicTier: 1, colonyTier: 1, emitGovB: true,  emitGovC: true, emitGovD: true },
  Standard:     { canonicalMicTier: 1, homelandMicTier: 1, colonyTier: 1, emitGovB: true,  emitGovC: true, emitGovD: true },
  Professional: { canonicalMicTier: 2, homelandMicTier: 2, colonyTier: 1, emitGovB: true,  emitGovC: true, emitGovD: true },
  Elite:        { canonicalMicTier: 3, homelandMicTier: 2, colonyTier: 2, emitGovB: false, emitGovC: true, emitGovD: true },
  Veteran:      { canonicalMicTier: 3, homelandMicTier: 2, colonyTier: 2, emitGovB: false, emitGovC: true, emitGovD: true },
};

export const GRADES = Object.keys(GRADE_DEFAULTS);

// EDUMatic Quality Class → Grade mapping (from RIS workflow conversation).
// Matches Quality Class labels (case-insensitive) to one of our 5 grades.
// Filled out incrementally as the mod author confirms each tier; missing classes default to "Standard".
//
// Levy class confirmed:
//   Levy Slinger, Levy Archer, Levy Javelinmen, Levy Infantry, Levy Spearmen, Levy Hoplite,
//   light HA, missile cavalry, light cavalry
export const QUALITY_CLASS_TO_GRADE = {
  // Levy
  "levy slinger": "Levy",
  "levy archer": "Levy",
  "levy javelinman": "Levy",
  "levy javelinmen": "Levy",
  "levy infantry": "Levy",
  "levy spearman": "Levy",
  "levy spearmen": "Levy",
  "levy hoplite": "Levy",
  "light ha": "Levy",
  "missile cavalry": "Levy",
  "light cav": "Levy",
  "light cavalry": "Levy",
  // Standard / Professional / Elite / Veteran rows pending confirmation from mod author.
};

// Lookup by Quality Class string (case-insensitive, ignores leading "NN. " or "NNa. " prefixes).
export function gradeFromQualityClass(qc) {
  if (!qc) return null;
  const cleaned = String(qc)
    .toLowerCase()
    .replace(/^\d+[a-z]?\.\s*/, "")
    .trim();
  return QUALITY_CLASS_TO_GRADE[cleaned] || null;
}

// Apply grade defaults for any field that's missing on the unit. The unit's explicit values win.
// This lets us keep the data model lean — minimal authored unit just has { grade, factions, unit, … } and the
// generator fills in the rest.
export function fillDefaults(unit) {
  const g = GRADE_DEFAULTS[unit.grade] || GRADE_DEFAULTS.Standard;
  return {
    enabled: true,
    grade: "Standard",
    canonicalMicTier: g.canonicalMicTier,
    homelandMicTier: g.homelandMicTier,
    colonyTier: g.colonyTier,
    emitGovB: g.emitGovB,
    emitGovC: g.emitGovC,
    emitGovD: g.emitGovD,
    outsideExtras: [],
    factions: [],
    excludeFactions: [],
    commonRequires: [],
    aiHomeland: false,
    xp: null,
    aor: null,
    ...unit,
  };
}

// Migrate a v1-shape unit (with `minTier`, `chain`, `unitType`, `requires`) to the v2 shape.
// Best-effort: the old shape didn't distinguish grade, so we infer:
//   minTier 1 → Levy or Standard (default Standard)
//   minTier 2 → Professional
//   minTier 3-4 → Elite
// The user can change the grade afterwards.
export function migrateV1(u) {
  if (u.canonicalMicTier !== undefined) {
    // Already v2 — apply small idempotent fixes.
    let next = u;
    // 1) Re-assert writeBack default for any unit the user hasn't explicitly toggled. The
    //    `writeBackUserSet` flag is set to true the moment the user actively flips writeBack
    //    via the editor toggle or bulk-edit. If they haven't, treat writeBack as a default and
    //    re-apply: imported units → false, hand-authored → true. This guarantees the
    //    "only user-driven changes touch the EDB" invariant survives upgrades and stale state.
    if (!next.writeBackUserSet) {
      const looksImported = (next.notes || "").toLowerCase().includes("imported");
      const desired = !looksImported;
      if (next.writeBack !== desired) {
        next = { ...next, writeBack: desired };
      }
    }
    // 2) Strip AOR sibling on merc units — mercs don't pair with AOR variants in EDB.
    if (next.aor && next.aor.enabled && /^merc\s+/i.test(next.unit || "")) {
      next = { ...next, aor: null };
    }
    return next;
  }
  const inferredGrade = u.minTier <= 1 ? "Standard" : u.minTier === 2 ? "Professional" : "Elite";
  const def = GRADE_DEFAULTS[inferredGrade];
  const looksImported = (u.notes || "").toLowerCase().includes("imported");
  return {
    id: u.id,
    unit: u.unit,
    enabled: u.enabled !== false,
    notes: u.notes || "",
    grade: inferredGrade,
    canonicalMicTier: u.minTier || def.canonicalMicTier,
    homelandMicTier: u.minTier || def.homelandMicTier,
    colonyTier: def.colonyTier,
    outsideExtras: [],
    emitGovB: def.emitGovB,
    emitGovC: def.emitGovC,
    emitGovD: def.emitGovD,
    factions: u.factions || [],
    excludeFactions: u.excludeFactions || [],
    commonRequires: u.requires || [],
    aiHomeland: false,
    xp: u.xp || null,
    aor: shouldHaveAorSibling(u)
      ? { enabled: true, govTier: 1, aorOnly: true, recruitName: u.unit }
      : null,
    writeBack: !looksImported,
  };
}

// Mercenary units (e.g. "merc bithynian thureophoroi") are recruited via descr_mercenaries.txt
// and don't have an AOR sibling in EDB. We never auto-pair them.
function shouldHaveAorSibling(u) {
  if (u.unitType !== "aor") return false;
  if (/^merc\s+/i.test(u.unit || "")) return false;
  return true;
}
