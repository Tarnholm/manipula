// Tests for the two-specialty merge (Specialty1 + Specialty2) and the
// ArmorSoftCap / ArmorSoftCapMdf globals.

import { mergeSpecialties, specIs, resolveUnit, buildIndex } from "./resolve";
import { applyArmourSoftCap, computeDefensiveTriad } from "./formulas/defence";
import { computeAttributes } from "./formulas/attributes";
import { computeMass } from "./formulas/mass";
import { compute } from "./compute";

// Rows shaped like the real CoreData specialties table (sparse — a cell is
// only present when it carries a value).
const VERY_HARDY = { "Specialty Type": "Very Hardy", "special ability": "very_hardy" };
const SWIM       = { "Specialty Type": "Swim", "special ability": "very_hardy", "special ability 2": "can_swim" };
const FALXMEN    = {
  "Specialty Type": "Falxmen",
  "Attack mdf": 1.1, "Charge mdf": 1.2, "Defence mdf": 0.9, "Morale mdf": 1.1,
  "Recr cost mdf": 1, "vs horse": 1, "forest": 1,
  "special ability": "very_hardy", "special ability 2": "frighten_foot", "special ability 3": "warcry",
};
const NAKED      = { "Specialty Type": "Naked Warriors", "Attack mdf": 1, "mass multiplier": 1.2 };
const STANDARD   = {
  "Specialty Type": "Standard",
  "Attack mdf": 1, "Charge mdf": 1, "Defence mdf": 1, "Morale mdf": 1,
  "Recr cost mdf": 1, "Unit size mdf": 1,
};

describe("mergeSpecialties", () => {
  test("no second specialty leaves the first untouched", () => {
    expect(mergeSpecialties(FALXMEN, null)).toBe(FALXMEN);
    expect(mergeSpecialties(FALXMEN, undefined)).toBe(FALXMEN);
  });

  test("blank cells in Specialty2 do not clobber Specialty1", () => {
    const m = mergeSpecialties(FALXMEN, VERY_HARDY);
    expect(m["Attack mdf"]).toBe(1.1);
    expect(m["Charge mdf"]).toBe(1.2);
    expect(m["Defence mdf"]).toBe(0.9);
    expect(m["vs horse"]).toBe(1);
  });

  test("a filled cell in Specialty2 overrides Specialty1", () => {
    const m = mergeSpecialties(FALXMEN, { "Specialty Type": "Tweak", "Attack mdf": 2, "Defence mdf": "" });
    expect(m["Attack mdf"]).toBe(2);      // contradiction → 2 wins
    expect(m["Defence mdf"]).toBe(0.9);   // blank in 2 → 1 keeps its value
    expect(m["Specialty Type"]).toBe("Tweak");
  });

  test("whitespace-only cells count as blank", () => {
    const m = mergeSpecialties(FALXMEN, { "Specialty Type": "Blankish", "Attack mdf": "   " });
    expect(m["Attack mdf"]).toBe(1.1);
  });

  test("special abilities combine instead of overriding, de-duplicated", () => {
    const m = mergeSpecialties(VERY_HARDY, SWIM);
    const abilities = Object.entries(m)
      .filter(([k]) => /^special ability/.test(k))
      .map(([, v]) => v);
    expect(abilities).toContain("very_hardy");
    expect(abilities).toContain("can_swim");
    expect(abilities.filter((a) => a === "very_hardy")).toHaveLength(1);
  });

  test("more than three abilities spill into extra slots, none lost", () => {
    const m = mergeSpecialties(FALXMEN, SWIM);
    const abilities = Object.entries(m)
      .filter(([k]) => /^special ability/.test(k))
      .map(([, v]) => v)
      .sort();
    expect(abilities).toEqual(["can_swim", "frighten_foot", "very_hardy", "warcry"]);
    expect(m["special ability 4"]).toBeTruthy();
  });

  test("neither input row is mutated", () => {
    const before = JSON.stringify(FALXMEN);
    mergeSpecialties(FALXMEN, SWIM);
    expect(JSON.stringify(FALXMEN)).toBe(before);
  });

  test("only a second specialty resolves to that specialty alone", () => {
    expect(mergeSpecialties(null, SWIM)).toBe(SWIM);
  });
});

describe("specIs", () => {
  test("matches a plain (unmerged) specialty by name, case-insensitively", () => {
    expect(specIs(NAKED, "naked warriors")).toBe(true);
    expect(specIs(NAKED, "Naked Warriors")).toBe(true);
    expect(specIs(NAKED, "Swim")).toBe(false);
    expect(specIs(null, "Swim")).toBe(false);
  });

  test("matches when the name sits in either slot of a merged row", () => {
    expect(specIs(mergeSpecialties(NAKED, SWIM), "naked warriors")).toBe(true);
    expect(specIs(mergeSpecialties(SWIM, NAKED), "naked warriors")).toBe(true);
    expect(specIs(mergeSpecialties(NAKED, SWIM), "swim")).toBe(true);
  });
});

describe("resolveUnit with two specialties", () => {
  const project = {
    coreData: { specialties: [STANDARD, VERY_HARDY, SWIM, FALXMEN] },
    globals: {},
    modInfo: {},
  };
  const idx = buildIndex(project);

  test("no Specialty 2 → spec is exactly the Specialty1 row", () => {
    const r = resolveUnit({ Specialty: "Falxmen" }, idx);
    expect(r.spec).toBe(FALXMEN);
    expect(r.spec2).toBeNull();
  });

  test("blank Specialty 2 is treated as absent", () => {
    const r = resolveUnit({ Specialty: "Falxmen", "Specialty 2": "" }, idx);
    expect(r.spec).toBe(FALXMEN);
  });

  test("Specialty 2 layers over Specialty1", () => {
    const r = resolveUnit({ Specialty: "Falxmen", "Specialty 2": "Swim" }, idx);
    expect(r.spec["Attack mdf"]).toBe(1.1);          // kept from Falxmen
    expect(r.spec["Specialty Type"]).toBe("Swim");   // name overridden
    expect(r.spec2).toBe(SWIM);
  });

  test("the merged row is what drives the attribute flags", () => {
    const r = resolveUnit({ Specialty: "Very Hardy", "Specialty 2": "Swim" }, idx);
    r.unit = {};
    r.cat = { "Category Type": "Chariot" };   // reaches the spec-ability can_swim branch
    const attrs = computeAttributes(r, { soldierMass: 1, horseMass: 0 }, { globals: {}, modInfo: {} });
    expect(attrs["can_swim"]).toBe("can_swim");
  });

  test("a name-keyed rule still fires from the first slot after a merge", () => {
    const r = resolveUnit({ Specialty: "Naked Warriors", "Specialty 2": "Swim" },
      buildIndex({ coreData: { specialties: [NAKED, SWIM] } }));
    r.unit = { "Armour Upgr0": "" };
    r.cat = { "Category Type": "Foot" };
    const mr = computeMass(r, { globals: { ManMass: 1, GlobalMassMdf: 1 }, modInfo: {}, coreData: {}, armour: [] });
    expect(mr.mass).toBeCloseTo(1.3);   // 0.3 + 1×1 — the Naked Warriors rule
  });
});

describe("applyArmourSoftCap", () => {
  test("inactive unless BOTH globals carry a value", () => {
    expect(applyArmourSoftCap(19, {})).toBe(19);
    expect(applyArmourSoftCap(19, { ArmorSoftCap: 15 })).toBe(19);
    expect(applyArmourSoftCap(19, { ArmorSoftCapMdf: 0.5 })).toBe(19);
    expect(applyArmourSoftCap(19, { ArmorSoftCap: "", ArmorSoftCapMdf: "" })).toBe(19);
    expect(applyArmourSoftCap(19, { ArmorSoftCap: "", ArmorSoftCapMdf: 0.5 })).toBe(19);
  });

  test("tapers only the points above the cap", () => {
    const g = { ArmorSoftCap: 15, ArmorSoftCapMdf: 0.5 };
    expect(applyArmourSoftCap(19, g)).toBe(17);   // 15 + 4×0.5
    expect(applyArmourSoftCap(15, g)).toBe(15);   // at the cap → untouched
    expect(applyArmourSoftCap(9, g)).toBe(9);     // below the cap → untouched
    expect(applyArmourSoftCap(0, g)).toBe(0);
  });

  test("mdf 0 makes it a hard cap, mdf 1 a no-op", () => {
    expect(applyArmourSoftCap(19, { ArmorSoftCap: 15, ArmorSoftCapMdf: 0 })).toBe(15);
    expect(applyArmourSoftCap(19, { ArmorSoftCap: 15, ArmorSoftCapMdf: 1 })).toBe(19);
  });

  test("string globals (as typed into Mod Info) still work", () => {
    expect(applyArmourSoftCap(19, { ArmorSoftCap: "15", ArmorSoftCapMdf: "0.5" })).toBe(17);
  });
});

describe("armour stat with the soft cap", () => {
  const r = { unit: {}, cat: { "Category Type": "Foot" }, qual: {}, cult: {} };
  const mr = { soldierMass: 0, armour: { value: 19, shieldValue: 0, shieldDefence: 0, hitSound: "metal" } };
  const projectWith = (globals) => ({ globals: { GlobalArmourMdf: 1, ...globals }, modInfo: { platform: "RR" } });

  test("blank globals leave the armour stat alone", () => {
    expect(computeDefensiveTriad(r, mr, projectWith({}))["armour"]).toBe(19);
  });

  test("cap 15 / mdf 0.5 turns 19 armour into 17", () => {
    const out = computeDefensiveTriad(r, mr, projectWith({ ArmorSoftCap: 15, ArmorSoftCapMdf: 0.5 }));
    expect(out["armour"]).toBe(17);
  });
});

// End-to-end through compute(): the capped armour must be what the cost
// formula prices, not the raw value. A minimal project with one Foot unit
// wearing an armour model worth exactly 19 armour points.
describe("soft-capped armour reaches the cost calculation", () => {
  // armourMdf 1.9 → 19 raw armour points, 1.7 → 17.
  function projectWith(globals, armourMdf = 1.9) {
    return {
      modInfo: { platform: "RR" },
      globals: {
        MenPerUnit: 40, GlobalUnitSizeMdf: 1, GlobalArmourMdf: 1,
        CostPerMan: 10, GlobalRecrCostMdf: 1, UpkeepToCostRatio: 0.5,
        ...globals,
      },
      factions: [],
      units: [{ kind: "unit", row: 1, name: "Testers", Category: "Foot", Specialty: "Standard", "Armour Upgr0": "test set" }],
      armour: [{ "Model Set Name": "test set", Torso1: { type: "plate", material: "iron", instances: 1 } }],
      coreData: {
        categories: [{ "Category Type": "Foot" }],
        specialties: [STANDARD],
        // importance row then weight row — armour value = armourMdf × 10.
        armourAttributes: [{ Chest: 10 }, { Chest: 0 }],
        armourTorso: [{ "Armour Type": "plate", "Chest Coverage": 1, Cost: 100 }],
        armourMaterials: [{
          "Armour Material": "iron", "Armour mdf": armourMdf, "Mass mdf": 0,
          "Heat mdf": 0, "Cost mdf": 1, "Armour level": 1, "Hit sound": "metal",
        }],
      },
    };
  }

  const uncapped = compute(projectWith({}))[0];
  const capped = compute(projectWith({ ArmorSoftCap: 15, ArmorSoftCapMdf: 0.5 }))[0];
  const genuine17 = compute(projectWith({}, 1.7))[0];

  test("the emitted armour stat is capped", () => {
    expect(uncapped.armour).toBe(19);
    expect(capped.armour).toBe(17);
    expect(genuine17.armour).toBe(17);
  });

  test("the unit is priced as a 17-armour unit, not a 19-armour one", () => {
    expect(capped.price).not.toBe(uncapped.price);
    // Same armour materials cost, same everything else — a unit whose raw
    // armour really is 17 must come out at exactly the capped unit's price.
    expect(capped.price).toBe(genuine17.price);
  });
});
