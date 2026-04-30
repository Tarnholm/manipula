// Validation: scans every unit against the parsed mod indices and returns issue records.
//
// Issue shape: { unitId, unit, severity: "error"|"warn"|"info", code, message }
// Severity:
//   error — will produce broken EDB output (missing HR, missing reform, no factions, empty unit name)
//   warn  — likely wrong but not fatal (unit name not in EDU, AOR with no exclusions, duplicate)
//   info  — style/consistency hints (very short faction list with "all" alongside, etc.)

export function validateUnits(units, modIndex) {
  const issues = [];
  if (!modIndex) return issues;

  // Known names that are valid inside `factions { ... }` clauses:
  //   - Faction IDs from descr_sm_factions.txt
  //   - "all" (the catch-all)
  //   - Culture names (e.g. "roman", "barbarian", "greek") — RTW accepts these as group names
  //     in faction clauses. Each faction's culture field gives us the singular form.
  //   - Plural variants (e.g. "germanics" alongside "germanic") since both forms appear in EDBs.
  const knownFactions = new Set((modIndex.factions || []).map(f => f.id).concat(["all"]));
  for (const f of (modIndex.factions || [])) {
    if (f.culture) {
      knownFactions.add(f.culture);
      knownFactions.add(f.culture + "s"); // tolerate the plural form some EDBs use
    }
  }
  // Common culture group names that may not appear as a `culture` field but are valid in EDB clauses.
  for (const g of ["w_hellenistic", "e_hellenistic", "civilized", "barbarian"]) knownFactions.add(g);
  const knownHR = new Set((modIndex.hiddenResources || []).map(r => r.id));
  const knownResources = new Set((modIndex.resources || []).map(r => r.id));
  const knownAliases = new Set((modIndex.aliases || []).map(a => a.name));
  const knownReforms = new Set((modIndex.reforms || []).map(r => r.id));
  const knownEDUTypes = new Set((modIndex.edu || []).map(u => u.type));

  // Detect duplicate "unit" names (different ids, same recruit string)
  const seenUnitNames = new Map();
  for (const u of units) {
    if (!u.unit || !u.unit.trim()) {
      issues.push(issue(u, "error", "empty-name", "Empty unit recruit name"));
      continue;
    }
    if (seenUnitNames.has(u.unit)) {
      issues.push(issue(u, "warn", "duplicate-unit", `Duplicate of ${seenUnitNames.get(u.unit)} — both will emit lines for "${u.unit}"`));
    } else {
      seenUnitNames.set(u.unit, u.id);
    }

    // Unit name should exist in EDU (or it won't recruit)
    if (knownEDUTypes.size && !knownEDUTypes.has(u.unit)) {
      issues.push(issue(u, "warn", "unknown-edu", `"${u.unit}" not found in export_descr_unit.txt`));
    }

    // Tier sanity
    const tier = u.canonicalMicTier ?? u.minTier;
    if (tier == null || tier < 1 || tier > 4) {
      issues.push(issue(u, "error", "bad-canonical-tier", `Canonical mic_tier must be 1–4 (got ${tier})`));
    }
    if (u.homelandMicTier != null && (u.homelandMicTier < 1 || u.homelandMicTier > 4)) {
      issues.push(issue(u, "error", "bad-homeland-tier", `Homeland mic_tier must be 1–4 (got ${u.homelandMicTier})`));
    }
    // Outside-only extras shouldn't be set if no outside-homeland gov is emitted
    if ((u.outsideExtras && u.outsideExtras.length) && !u.emitGovB && !u.emitGovC) {
      issues.push(issue(u, "warn", "outside-extras-orphaned", `Outside-homeland-only extras set, but neither GovB nor GovC is emitted — they will not appear in any line`));
    }
    // No emitted gov lines at all
    if (!u.emitGovB && !u.emitGovC && !u.emitGovD && !(u.aor && u.aor.enabled)) {
      issues.push(issue(u, "error", "no-emit", `No gov lines emitted and no AOR sibling — unit will not produce any player recruitment`));
    }

    // Factions: positive list ⊆ known
    const fac = u.factions || [];
    if (fac.length === 0) {
      issues.push(issue(u, "error", "no-factions", `No positive factions — recruit line will be invalid`));
    }
    for (const f of fac) {
      if (!knownFactions.has(f)) {
        issues.push(issue(u, "error", "unknown-faction", `Unknown faction "${f}"`));
      }
    }
    for (const f of (u.excludeFactions || [])) {
      if (!knownFactions.has(f)) {
        issues.push(issue(u, "warn", "unknown-exclude-faction", `Unknown excluded faction "${f}"`));
      }
    }

    // Inspect every requires-list (commonRequires + outsideExtras + legacy `requires`)
    const allRequires = [
      ...(u.commonRequires || []),
      ...(u.outsideExtras || []),
      ...(u.requires || []),
    ];
    for (const r of allRequires) {
      const t = r.trim();
      let m;
      if ((m = t.match(/^hidden_resource\s+(\S+)$/))) {
        if (!knownHR.has(m[1])) {
          issues.push(issue(u, "error", "unknown-hr", `Unknown hidden_resource "${m[1]}"`));
        }
      } else if ((m = t.match(/^not hidden_resource\s+(\S+)$/))) {
        if (!knownHR.has(m[1])) {
          issues.push(issue(u, "warn", "unknown-hr-negated", `Unknown hidden_resource (negated) "${m[1]}"`));
        }
      } else if ((m = t.match(/^resource\s+(\S+)$/))) {
        if (!knownResources.has(m[1])) {
          issues.push(issue(u, "warn", "unknown-resource", `Unknown resource "${m[1]}"`));
        }
      } else if ((m = t.match(/^major_event\s+"([^"]+)"$/))) {
        if (knownReforms.size && !knownReforms.has(m[1])) {
          issues.push(issue(u, "error", "unknown-reform", `Unknown major_event/reform "${m[1]}"`));
        }
      } else if ((m = t.match(/^building_present_min_level\s+(\S+)\s+(\S+)$/))) {
        // We could cross-check against known building/levels here, but not worth a hard error if unknown.
        // Skipped to avoid false positives.
      } else if (/^[a-z_][a-z0-9_]*$/.test(t)) {
        // bare alias (e.g. "colony_tier_1")
        if (knownAliases.size && !knownAliases.has(t)) {
          issues.push(issue(u, "warn", "unknown-alias", `Unknown alias "${t}"`));
        }
      }
    }
  }
  return issues;
}

function issue(u, severity, code, message) {
  return { unitId: u.id, unit: u.unit, severity, code, message };
}

// Roll up totals
export function summarize(issues) {
  let error = 0, warn = 0, info = 0;
  for (const i of issues) {
    if (i.severity === "error") error++;
    else if (i.severity === "warn") warn++;
    else info++;
  }
  return { error, warn, info, total: issues.length };
}

// Faction-level analysis: tier gaps within each faction's roster.
// Returns: [{ faction, severity: "info", code, message, missingTiers: [1, 2, 3], unitCount }]
// Tier 4 is excluded — it's typically AI-only territory in this mod.
export function validateFactions(units, modIndex) {
  const issues = [];
  const byFaction = new Map();
  for (const u of units) {
    if (u.enabled === false) continue;
    for (const f of (u.factions || [])) {
      if (f === "all") continue; // skip the catch-all
      if (!byFaction.has(f)) byFaction.set(f, []);
      byFaction.get(f).push(u);
    }
  }
  for (const [faction, factionUnits] of byFaction) {
    if (factionUnits.length < 3) continue; // small rosters aren't worth flagging
    const tiersWithUnits = new Set();
    for (const u of factionUnits) {
      tiersWithUnits.add(u.canonicalMicTier ?? u.minTier ?? 1);
    }
    // A "gap" is a missing tier 1, 2, or 3 when *higher* tiers exist (i.e. you skipped over a tier).
    // We compute the highest tier present, then look for missing tiers below it.
    const highest = Math.max(...tiersWithUnits, 0);
    if (highest < 2) continue; // need at least tier 2 to have a gap
    const missing = [];
    for (let t = 1; t < Math.min(highest, 4); t++) {
      if (!tiersWithUnits.has(t)) missing.push(t);
    }
    // Also flag if highest tier is 1 or 2 (i.e. the faction has no Tier 3 units)
    // — only when the user has 5+ units in that faction (otherwise probably intentional).
    if (factionUnits.length >= 5 && highest < 3) {
      missing.push(highest + 1);
    }
    if (missing.length === 0) continue;
    issues.push({
      faction,
      severity: "info",
      code: "tier-gap",
      missingTiers: missing,
      unitCount: factionUnits.length,
      message: `${faction} has ${factionUnits.length} units across tiers ${[...tiersWithUnits].sort().join("/")} — missing tier${missing.length > 1 ? "s" : ""} ${missing.join(", ")}`,
    });
  }
  return issues;
}
