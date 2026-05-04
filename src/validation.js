// Validation: scans every unit against the parsed mod indices and returns issue records.
//
// Issue shape: { unitId, unit, severity: "error"|"warn"|"info", code, message }
// Severity:
//   error — will produce broken EDB output (missing HR, missing reform, no factions, empty unit name)
//   warn  — likely wrong but not fatal (unit name not in EDU, AOR with no exclusions, duplicate)
//   info  — style/consistency hints (very short faction list with "all" alongside, etc.)

export function validateUnits(units, modIndex, opts = {}) {
  const issues = [];
  if (!modIndex) return issues;
  // opts.missingCards: Set<string> — recruit names whose unit_card.tga couldn't be located.
  // Surface those as warnings so the validation view lists them alongside other issues.
  const missingCards = opts.missingCards instanceof Set ? opts.missingCards : null;
  // opts.skipCrossUnit: bypass the O(n²) conflict detector — used by the lightweight
  // summary computation that runs on every render, since it can take 500ms+ for large profiles.
  const skipCrossUnit = !!opts.skipCrossUnit;

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
      // Typo detector — Levenshtein distance ≤ 2 against any known EDU type. If we find
      // a near-match, surface it as a stronger hint (the user almost certainly typo'd).
      const near = findNearMatch(u.unit, knownEDUTypes, 2);
      if (near) issues.push(issue(u, "warn", "typo-suspect", `Did you mean "${near}"? (one or two characters away from a real EDU type)`));
    }

    // Missing unit_card.tga — main process couldn't locate a portrait for this recruit name.
    if (missingCards && missingCards.has(u.unit)) {
      issues.push(issue(u, "warn", "missing-unit-card", `No unit_card.tga found in mod data for "${u.unit}"`));
    }

    // Tier sanity
    const tier = u.canonicalMicTier ?? u.minTier;
    if (tier == null || tier < 1 || tier > 4) {
      issues.push(issue(u, "error", "bad-canonical-tier", `Canonical mic_tier must be 1–4 (got ${tier})`));
    }
    if (u.homelandMicTier != null && (u.homelandMicTier < 1 || u.homelandMicTier > 4)) {
      issues.push(issue(u, "error", "bad-homeland-tier", `Homeland mic_tier must be 1–4 (got ${u.homelandMicTier})`));
    }

    // gov_tier mismatch: AOR sibling's gov_tier must be ≥ canonicalMicTier, otherwise the
    // AOR variant becomes unrecruitable in regions that hit the MIC tier check first.
    if (u.aor && u.aor.enabled && u.canonicalMicTier != null && u.aor.govTier != null) {
      if (u.aor.govTier < u.canonicalMicTier) {
        issues.push(issue(u, "warn", "gov-tier-below-mic", `AOR gov_tier_${u.aor.govTier} is below canonical mic_tier_${u.canonicalMicTier} — AOR variant won't recruit until MIC tier is reached`));
      }
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

  // ── Cross-unit conflict detector ──
  // O(n²) — skip when caller explicitly asks (lightweight summary path) or when there are
  // simply too many units to make the cost worth it.
  if (skipCrossUnit || units.length > 1500) return issues;
  const factionTierGroups = new Map(); // `${faction}|${tier}` → [{ unit, hrSet, notHrSet }]
  for (const u of units) {
    if (!u.unit || u.enabled === false) continue;
    if (u.aor && u.aor.aorOnly) continue;
    const tier = u.canonicalMicTier ?? u.minTier;
    if (tier == null) continue;
    const hrSet = new Set();
    const notHrSet = new Set();
    for (const c of [...(u.commonRequires || []), ...(u.outsideExtras || [])]) {
      let m;
      if ((m = c.match(/^hidden_resource\s+(\S+)$/))) hrSet.add(m[1]);
      else if ((m = c.match(/^not\s+hidden_resource\s+(\S+)$/))) notHrSet.add(m[1]);
    }
    for (const f of (u.factions || [])) {
      if (f === "all") continue;
      const k = `${f}|${tier}`;
      if (!factionTierGroups.has(k)) factionTierGroups.set(k, []);
      factionTierGroups.get(k).push({ unit: u, hrSet, notHrSet });
    }
  }
  const seenPair = new Set();
  for (const [key, members] of factionTierGroups) {
    if (members.length < 2) continue;
    const [faction, tier] = key.split("|");
    for (let i = 0; i < members.length; i++) {
      for (let j = i + 1; j < members.length; j++) {
        const a = members[i], b = members[j];
        if (a.unit.id === b.unit.id) continue;
        // Two units conflict if their HR-region sets overlap. Cheap upper-bound:
        //   - both have empty positive HR sets → they overlap on every region (definite collision)
        //   - they share at least one positive HR AND don't have mutually-exclusive negative HRs
        const aPos = a.hrSet, bPos = b.hrSet;
        const sharedPos = [...aPos].some(x => bPos.has(x));
        const eitherEmpty = aPos.size === 0 && bPos.size === 0;
        // Each side's negative HRs against the other's positives — if any of A's negatives is in B's positives, they don't share regions.
        const mutuallyExclusive = [...a.notHrSet].some(x => bPos.has(x)) || [...b.notHrSet].some(x => aPos.has(x));
        if (mutuallyExclusive) continue;
        if (!eitherEmpty && !sharedPos && (aPos.size > 0 && bPos.size > 0)) continue;
        const pairKey = [a.unit.id, b.unit.id].sort().join("|") + "|" + faction + "|" + tier;
        if (seenPair.has(pairKey)) continue;
        seenPair.add(pairKey);
        issues.push(issue(a.unit, "info", "tier-conflict", `Recruits at the same (${faction}, mic_tier_${tier}) as "${b.unit.unit}" — overlapping regions, may collide`));
      }
    }
  }

  return issues;
}

// Orphan detector — find recruit lines in the parsed EDB that reference units missing
// from the EDU. Each becomes a `warn` issue surfaced in the validation tab. Useful for
// catching dangling references after a unit rename.
export function eduOrphanIssues(modIndex) {
  if (!modIndex || !Array.isArray(modIndex.recruits) || !Array.isArray(modIndex.edu)) return [];
  const eduSet = new Set(modIndex.edu.map(u => u.type));
  const seen = new Set();
  const out = [];
  for (const r of modIndex.recruits) {
    if (!r.unit || eduSet.has(r.unit) || seen.has(r.unit)) continue;
    if (/^aor\s+/i.test(r.unit)) continue;        // AOR aliases — base type lookup elsewhere
    if (/^merc\s+/i.test(r.unit)) continue;       // mercs declared in descr_mercenaries
    seen.add(r.unit);
    out.push({
      unitId: `orphan:${r.unit}`,
      unit: r.unit,
      severity: "warn",
      code: "edu-orphan",
      message: `EDB references "${r.unit}" but no EDU entry exists for it (recruit will fail at game load)`,
      source: "orphan",
    });
  }
  return out;
}

// Cross-side consistency — for each authored recruitment unit, if the loaded EDU project
// has a matching row, compare its EDB factions list with the EDU ownership field. Mismatches
// usually mean the user renamed a faction on one side and forgot the other.
export function crossSideIssues(units, eduProject) {
  if (!units || !eduProject || !Array.isArray(eduProject.units)) return [];
  const eduByName = new Map();
  for (const eu of eduProject.units) {
    const n = eu.Unit || eu.unit || eu.Type || eu.type;
    if (n) eduByName.set(String(n), eu);
  }
  const out = [];
  for (const u of units) {
    if (!u.unit || u.enabled === false) continue;
    const eu = eduByName.get(u.unit);
    if (!eu) continue;
    const eduOwnership = String(eu.Ownership || eu.ownership || "").split(/[,\s]+/).map(s => s.trim()).filter(Boolean);
    if (eduOwnership.length === 0) continue;
    const edbFacs = (u.factions || []).filter(f => f && f !== "all");
    if (edbFacs.length === 0) continue;
    const overlap = edbFacs.some(f => eduOwnership.includes(f));
    if (!overlap) {
      out.push({
        unitId: u.id,
        unit: u.unit,
        severity: "warn",
        code: "cross-faction-mismatch",
        message: `EDB factions [${edbFacs.join(", ")}] don't overlap with EDU ownership [${eduOwnership.slice(0, 3).join(", ")}${eduOwnership.length > 3 ? "…" : ""}]`,
        source: "cross",
      });
    }
  }
  return out;
}

// Wrap an EDU-matic ErrorEntry list as recruitment-tool-shaped issues so the unified
// validation view can display both halves side by side. The EDU validator is statically
// imported via the helper below so this module stays pure JS without a top-level import
// cycle (validation.js is also pulled into App.js paths that don't need EDU).
export function eduValidationIssues(eduProject, validateFn) {
  if (!eduProject || typeof validateFn !== "function") return [];
  try {
    const errors = validateFn(eduProject) || [];
    return errors.map(e => ({
      unitId: `edu:${e.unit}`,
      unit: e.unit,
      severity: "error",
      code: "edu-" + (e.category || "validate"),
      message: `[EDU] ${e.message}`,
      source: "edu",
    }));
  } catch (err) {
    return [{ unitId: "edu:_self", unit: "(EDU validator)", severity: "warn", code: "edu-validator-failed", message: `EDU validator threw: ${err.message}`, source: "edu" }];
  }
}

// Levenshtein distance, capped — if the running cost exceeds maxDist we bail early
// without computing the rest. Only used for short strings (unit names) so the O(n²)
// cost is fine.
function levenshtein(a, b, maxDist) {
  if (Math.abs(a.length - b.length) > maxDist) return maxDist + 1;
  const m = a.length, n = b.length;
  const dp = new Array(n + 1);
  for (let j = 0; j <= n; j++) dp[j] = j;
  for (let i = 1; i <= m; i++) {
    let prev = dp[0];
    dp[0] = i;
    let rowMin = dp[0];
    for (let j = 1; j <= n; j++) {
      const tmp = dp[j];
      dp[j] = a[i - 1] === b[j - 1] ? prev : Math.min(prev, dp[j], dp[j - 1]) + 1;
      prev = tmp;
      if (dp[j] < rowMin) rowMin = dp[j];
    }
    if (rowMin > maxDist) return maxDist + 1;
  }
  return dp[n];
}
function findNearMatch(query, candidates, maxDist) {
  let bestMatch = null;
  let bestDist = maxDist + 1;
  for (const c of candidates) {
    if (c === query) continue;
    const d = levenshtein(query, c, maxDist);
    if (d < bestDist) { bestDist = d; bestMatch = c; if (d === 1) break; }
  }
  return bestDist <= maxDist ? bestMatch : null;
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
