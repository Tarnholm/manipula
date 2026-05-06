// compute.js — port of the VBA Sub CreateUnitData (Module1 L6136–9526).
//
// Pure function: compute(project) -> DataRow[].
//
// Semantics mirror the DATA sheet exactly: fields that the VBA leaves
// blank stay absent from the output (undefined), not set to 0 / "". That
// matters for format.js, which emits a line only when the underlying
// value is present.
//
// The 512 DATA columns are organized into a pipeline:
//   1. resolveUnit()                — ParseUnitDefs equivalent
//   2. writeMetadata()              — passthroughs (type/dictionary/voice/…)
//   3. writeCategoryAndClass()      — "category" literal, "class" classifier
//   4. writeSoldierSlots()          — model / model1..7 depending on variation
//   5. writeOfficers()              — officer1..5
//   6. writeCategorySpecific()      — ship/engine/animal/mount based on category
//   7. writeOwnership()              — faction ownership map (passthrough)
//   8. [TODO] formulas/              — mass, soldiers, HP, attack, …


import { buildIndex, resolveUnit } from "./resolve";
import { computeSoldierCount } from "./formulas/soldiers";
import { computeMass } from "./formulas/mass";
import { computeAttack } from "./formulas/attack";
import { computeCharge } from "./formulas/charge";
import { computePrimaryWeaponFields } from "./formulas/primary";
import { computeDefensiveTriad } from "./formulas/defence";
import { computeStats } from "./formulas/stats";
import { computeAttributes } from "./formulas/attributes";
import { computeClass, computeSpacing, computeFormation2, computePriHP, computeSecHP } from "./formulas/misc";
import { computeWeaponAttrs } from "./formulas/weaponAttrs";
import { computeSecondary } from "./formulas/secondary";
import { computeVS } from "./formulas/vs";
import { computeTertiary } from "./formulas/tertiary";
import { computeCosts } from "./formulas/cost";

/** @typedef {import("./xlsmImporter").Project} Project */

/** @param {Project} project */
function compute(project) {
  const idx = buildIndex(project);
  const isM2 = String(project.modInfo?.platform || "") === "M2TW" || String(project.modInfo?.platform || "") === "KGDM";
  const isV070 = project.globals && project.globals.CombatExp !== undefined;
  // Master lookup for the linked-variant feature (v0.34.3+). When a
  // unit carries `linkedTo: "<master Unit name>"`, every empty field on
  // it inherits from the master at compute time. The user authors
  // stats once on the master and references propagate automatically.
  const masterByName = new Map();
  for (const u of project.units) {
    if (u && u.kind === "unit" && u.Unit) masterByName.set(String(u.Unit), u);
  }
  const resolveLinks = (u) => {
    if (!u || u.kind !== "unit" || !u.linkedTo) return u;
    const master = masterByName.get(String(u.linkedTo));
    if (!master || master === u) return u;
    // Detect cycles by walking up; cap at 4 to keep this trivial.
    let chain = master, depth = 0;
    while (chain && chain.linkedTo && depth < 4) {
      const next = masterByName.get(String(chain.linkedTo));
      if (!next || next === u) break;
      chain = next; depth++;
    }
    // Merge: master's fields fill any missing on the reference. Don't
    // overwrite Unit / linkedTo / availability / kind / row — those are
    // identity / structural fields that should stay per-unit.
    const merged = { ...chain, ...u };
    // Restore identity fields explicitly (... spread above re-applies u
    // last, so they're already correct, but be defensive).
    merged.Unit = u.Unit;
    merged.kind = u.kind;
    merged.row = u.row;
    merged.linkedTo = u.linkedTo;
    if (u.availability) merged.availability = u.availability;
    return merged;
  };
  const rows = [];
  for (const raw of project.units) {
    if (raw.kind === "comment") {
      rows.push({ kind: "comment", text: raw.text, row: raw.row });
      continue;
    }
    if (raw.kind === "wip") {
      rows.push({ kind: "wip", name: raw.name, row: raw.row });
      continue;
    }
    const u = resolveLinks(raw);
    // v0.7.0: each unit produces one DATA row per entry type listed in
    // its `Entries` field (e.g. "Factional + AoR + Merc" → 3 rows).
    // Older workbooks have no Entries field — emit a single row.
    const entries = (isV070 && u.Entries) ? String(u.Entries).split(/\s*\+\s*/) : [null];
    for (const et of entries) {
      rows.push(computeUnit(u, idx, project, isM2, et));
    }
  }
  return rows;
}

function computeUnit(unit, idx, project, isM2, entryType) {
  const r = resolveUnit(unit, idx);
  const out = { kind: "data", row: unit.row, name: unit.name, entryType: entryType || null };
  writeMetadata(out, unit, r, project.globals, entryType);
  writeCategoryAndClass(out, r);
  writeSoldierSlots(out, unit);
  writeOfficers(out, unit);
  writeCategorySpecific(out, unit, r);
  writeOwnership(out, unit, entryType);

  // Pass through ethnicity info — format.js reads these when emitting
  // the per-faction `ethnicity` lines at the end of each unit block.
  if (unit["ethnicity region"])     out.ethnicityRegion     = unit["ethnicity region"];
  if (unit["ethnicity attributes"]) out.ethnicityAttributes = unit["ethnicity attributes"];

  // Ethnicity tag list (VBA L10142 + Case 504). All paths iterate
  // Faction1..Faction(FactionQuantity + 1) — the same cap VBA's two
  // ethnicity loops (L10138, L11161) impose. Anything past the cap is
  // invisible to VBA even if Y/M-flagged.
  //   - AoR     : faction[k] name non-empty
  //   - Factional: unit's Faction<k>Available = "Y"
  //   - Merc    : unit's Faction<k>Available = "M"
  // Slave (Case 504) fires whenever the slave flag is set, after the
  // numbered factions.
  if (out.ethnicityRegion) {
    const fq = Number(project.globals && project.globals.FactionQuantity);
    const allFactions = project.factions || [];
    const cap = Number.isFinite(fq) && fq > 0
      ? Math.min(fq + 1, allFactions.length)
      : allFactions.length;
    const avail = unit.availability || {};
    const tags = [];
    for (let k = 0; k < cap; k++) {
      const tag = allFactions[k];
      if (!tag) continue;
      if (entryType === "AoR") {
        tags.push(tag);
      } else if (entryType === "Merc") {
        if (String(avail[tag] || "").toUpperCase() === "M") tags.push(tag);
      } else {
        if (String(avail[tag] || "").toUpperCase() === "Y") tags.push(tag);
      }
    }
    if (unit.ownership && unit.ownership.slave) tags.push("slave");
    out.ethnicityTags = tags;
  }
  writeRecruitPriority(out, unit, entryType, project.globals);

  // ── Formula: # of men ────────────────────────────────────────
  // Write under both v2.6 name ("# of men") and v0.7.0 rename ("No. of men")
  // so per-column audits match regardless of workbook version.
  const men = computeSoldierCount(r, project.globals || {}, isM2);
  if (men != null) { out["# of men"] = men; out["No. of men"] = men; }

  // ── # of extras (engines, special mounts) ──────────────────
  const catName = String((r.cat && r.cat["Category Type"]) || "").toLowerCase();
  const gSizeMdf = Number(project.globals?.GlobalUnitSizeMdf ?? 1) || 1;
  let extras = 0;
  if (catName === "engine") {
    extras = Math.round(Number(r.engine?.["Engines per unit"] ?? 0) * gSizeMdf);
  } else if (catName === "special" || catName === "handler" || catName === "chariot") {
    extras = Math.round(Number(r.spMount?.["Mounts per unit"] ?? 0) * gSizeMdf);
  }
  out["# of extras"] = extras;
  out["No. of extras"] = extras;

  // ── Formula: mass (and its armour/soldier/horse mass deps) ──
  const mr = computeMass(r, project);
  if (mr.mass != null) out["mass"] = mr.mass;

  // ── Formula: primary attack ─────────────────────────────────
  const atk = computeAttack(r, mr, project);
  if (atk != null) out["attack"] = atk;

  // ── Formula: primary charge ─────────────────────────────────
  const chg = computeCharge(r, mr, project);
  if (chg != null) out["charge"] = chg;

  // ── Simple primary-weapon fields (missile type/range/ammo, wpn type,
  //    tech, dmg, sound) ─────────────────────────────────────
  Object.assign(out, computePrimaryWeaponFields(r, project));

  // ── Defensive triad: armour, defence, shield, hit sound +
  //    secondary mount armour/defence/hit sound ─────────────
  Object.assign(out, computeDefensiveTriad(r, mr, project));

  // ── stat_* cases: heat / ground / morale / discipline /
  //    training / mrl-lock / charge-dist / fire-delay / food
  //    (depends on `armour` stat we just wrote) ──────────────
  Object.assign(out, computeStats(r, mr, project, out["armour"] || 0));

  // ── Attribute flags (sea_faring, can_swim, hide_forest, …) ──
  Object.assign(out, computeAttributes(r, mr, project));

  // Entry-type flag overrides (v0.7.0 Cases 37, 49, 58).
  if (entryType === "AoR" || entryType === "Horde") out["no_custom"] = "no_custom";
  if (entryType && entryType !== "Factional" && entryType !== "Horde") {
    out["merc_unit"] = "mercenary_unit";
  }
  if (entryType === "Horde") out["can_horde"] = "can_horde";
  // general_unit only for the Factional variant (VBA line 9017).
  if (entryType && entryType !== "Factional") delete out["gen_unit"];

  // ── Class / HP / spacing / formation 1&2 ───────────────────
  out["class"] = computeClass(r, mr, project.globals || {});
  out["hp"]    = computePriHP(r, project.globals || {});
  out["sec hp"] = computeSecHP(r, mr, project.globals || {});
  Object.assign(out, computeSpacing(r));
  const f2 = computeFormation2(r, mr, project.globals || {}, String(project.modInfo?.platform || ""));
  if (f2) out["formation2"] = f2;

  // ── Weapon attribute flags (ap/bp/spear/pike/prec/thrown/…) ─
  Object.assign(out, computeWeaponAttrs(r, project));

  // ── Secondary weapon numeric stats (attack/charge/missile/…) ─
  Object.assign(out, computeSecondary(r, mr, project));

  // ── Tertiary weapon stats (engines with a secondary projectile) ─
  Object.assign(out, computeTertiary(r, project));

  // ── VS horse / elephant / chariot / camel bonuses ───────────
  Object.assign(out, computeVS(r, project));

  // ── Costs: turns, price, upkeep, wpn/arm upgrades, cb ──────
  // v0.7.0's cost model depends on computed stats (attack/defence/…),
  // so it must run last — after all the other formulas have filled out.
  Object.assign(out, computeCosts(r, mr, project,
                                   men || 0, extras, out["armour"] || 0, out, entryType));

  return out;
}

// ── helpers ────────────────────────────────────────────────────────

function put(out, col, value) {
  // Mirrors VBA: blank strings and null/undefined are omitted entirely.
  // Zero is allowed (some numeric columns legitimately carry 0); callers
  // use putNonZero when the default should be skipped.
  if (value === null || value === undefined || value === "") return;
  out[col] = value;
}
function putNonZero(out, col, value) {
  if (value === null || value === undefined || value === "" || value === 0) return;
  out[col] = value;
}

function toNum(v) {
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

// ── Section writers ────────────────────────────────────────────────

function writeMetadata(out, unit, r, globals, entryType) {
  put(out, "Name / Comments",  buildNameComment(unit, r, globals, entryType));
  // Type / dictionary prefix per entry type (VBA Case 2 & 3).
  const unitId   = unit["unit id"]   || "";
  const unitDict = unit.dictionary_tag || "";
  if (entryType === "Merc")       { put(out, "type", "merc "  + unitId); put(out, "dictionary", "merc_"  + unitDict); }
  else if (entryType === "AoR")   { put(out, "type", "aor "   + unitId); put(out, "dictionary", unitDict); }
  else if (entryType === "Horde") { put(out, "type", "horde " + unitId); put(out, "dictionary", unitDict); }
  else                            { put(out, "type", unitId);            put(out, "dictionary", unitDict); }
  put(out, "voice_type",       unit.voice_type);
  put(out, "voice_indexes",    unit.voice_indexes);
  put(out, "banner fac",       unit["faction banner"]);
  put(out, "banner holy",      unit["holy banner"]);
  putNonZero(out, "unit variation", toNum(unit["unit variation"]));
}

function writeCategoryAndClass(out, r) {
  put(out, "category", mapCategory(r.cat));
  put(out, "class",    classifyUnit(r));
}

/** "model" (single) or "model1".."model7" (ethnicity variants) —
 *  decided by the unit's "unit variation" value.
 *  - variation = 0 → single "model" cell = unit's "model id"
 *  - variation > 0 → model1..N cells = baseModelId + index (e.g. variation=4
 *     with base "roman_velite" gives roman_velite1, roman_velite2, …)
 */
function writeSoldierSlots(out, unit) {
  const variation = toNum(unit["unit variation"]) || 0;
  const base = unit["model id"];
  if (!base) return;
  if (variation === 0) {
    put(out, "model", base);
  } else {
    const cap = Math.min(variation, 7);
    for (let i = 1; i <= cap; i++) {
      put(out, "model" + i, base + i);
    }
  }
}

function writeOfficers(out, unit) {
  for (let i = 1; i <= 5; i++) {
    // Unit-def header uses "officer 1".."officer 5" (with space).
    put(out, "officer" + i, unit["officer " + i]);
  }
}

function writeCategorySpecific(out, unit, r) {
  const catName = String((r.cat && r.cat["Category Type"]) || "").toLowerCase();
  if (catName === "ship") {
    put(out, "ship", unit["ship id"]);
  } else if (catName === "engine") {
    put(out, "engine", unit["engine id"]);
  } else if (catName === "handler") {
    put(out, "animal", unit["animal id"]);
  } else if (catName === "mounted" || catName === "mounted missile" || catName === "special" || catName === "chariot") {
    put(out, "mount", unit["mount id"]);
  }
}

function writeOwnership(out, unit, entryType) {
  // v0.7.0 stores the authoritative ownership string per entry type in
  // pre-built cells:
  //   Factional entry → unit.factionalOwnership  (col MU / 359)
  //   Merc      entry → unit.mercOwnership       (col MW / 361)
  //   AoR       entry → literal "all" (VBA Case 200 L10095)
  // We trust these strings verbatim — they already reflect exactly what
  // the user has configured. Only fall back to the Y-flag map on older
  // workbooks (v2.6) that don't carry the pre-built columns.
  const pre = entryType === "AoR" ? "all"
            : entryType === "Merc" ? unit.mercOwnership
            : unit.factionalOwnership;
  if (pre !== undefined && pre !== null) {
    out.ownershipString = String(pre);
    return;
  }
  if (unit.ownership && Object.keys(unit.ownership).length > 0) {
    const tags = Object.keys(unit.ownership).filter((k) => k !== "slave");
    if (unit.ownership.slave) tags.push("slave");
    if (tags.length) out.ownershipString = tags.join(", ");
  }
}

function writeRecruitPriority(out, unit, entryType, globals) {
  // VBA Case 199 in v0.7.0: AoR and Merc variants use a fixed global
  // `aor_default_rec_priority` instead of the unit's rec priority.
  let v;
  if ((entryType === "AoR" || entryType === "Merc") && globals) {
    v = toNum(globals["aor_default_rec_priority"] ?? globals["AorRecrPriority"]);
  } else {
    v = toNum(unit["rec priority"]);
  }
  if (v != null) out["recruit_priority_offset"] = v;
}

// ── Classifiers ────────────────────────────────────────────────────

function buildNameComment(unit, r, globals, entryType) {
  // v0.7.0 prefixes per entry type: "AoR <name>" / "Mercenary <name>" /
  // "<name> - Horde". v2.6 has no entry types. Ships omit "Start exp";
  // v0.7.0 drops it for all categories.
  //
  // VBA Case 1 (L8493) joins an explicit "Comments" field only — never
  // the model_id. Many units leave Comments blank, producing a bare
  // "; COMMENTS              Unit Name" with no suffix.
  let base = unit.name;
  if (entryType === "AoR")       base = "AoR " + base;
  else if (entryType === "Merc") base = "Mercenary " + base;
  else if (entryType === "Horde") base = base + " - Horde";
  const parts = [base];
  const comments = unit.comments || unit.Comments || "";
  if (comments) parts.push(comments);
  const catName = String((r.cat && r.cat["Category Type"]) || "").toLowerCase();
  const isV070 = globals && globals.CombatExp !== undefined;
  if (!isV070 && catName !== "ship") {
    const startExp = toNum(r.qual && r.qual["Start exp"]) ?? 0;
    parts.push(`Start exp: ${startExp}`);
  }
  return parts.join(" / ");
}

function mapCategory(catRow) {
  if (!catRow) return "";
  const name = String(catRow["Category Type"] || "").toLowerCase();
  switch (name) {
    case "foot":
    case "foot missile":
    case "foot general":      return "infantry";
    case "mounted":
    case "mounted missile":
    case "special":
    case "chariot":           return "cavalry";
    case "engine":            return "siege";
    case "ship":              return "ship";
    case "handler":           return "handler";
    default:                  return name;
  }
}

/** Placeholder class-classifier. Real logic (mass thresholds, spearmen
 *  detection) lands with the mass formula. Engines / missile specialties
 *  already match VBA output. */
function classifyUnit(r) {
  const catName = String((r.cat && r.cat["Category Type"]) || "").toLowerCase();
  if (catName === "engine" || catName === "foot missile" || catName === "mounted missile") {
    return "missile";
  }
  if (catName === "ship") return "missile";
  return "heavy";
}

export { compute, computeUnit };
