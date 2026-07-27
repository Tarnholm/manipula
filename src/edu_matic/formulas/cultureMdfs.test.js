// Tests for the per-culture Horde upkeep / CB cost multipliers and the
// elephant+chariot exclusion from the culture "Secondary HP" bonus.

import { computeCosts } from "./cost";
import { computeSecHP } from "./misc";

// Minimal v2.6-style project (no CombatExp → linear cost path).
const GLOBALS = {
  CostPerMan: 10,
  UpkeepToCostRatio: 0.5,
  CBCostMultiplier: 2,
};
const PROJECT = { globals: GLOBALS, modInfo: { platform: "RR" } };

function footUnit(cult) {
  return {
    unit: {},
    cat: { "Category Type": "Foot" },
    cult,
  };
}
function mountedUnit(cult) {
  return {
    unit: {},
    cat: { "Category Type": "Mounted" },
    mount: { Cost: 0 },
    cult,
  };
}

const MR = { armour: { cost: 0 } };
const SOLDIERS = 40;

function costsOf(r, entryType) {
  return computeCosts(r, MR, PROJECT, SOLDIERS, 0, 0, {}, entryType || null);
}

describe("Horde upk cost mdf", () => {
  // Baseline: price = CostPerMan × soldiers = 400, upkeep = 400 × 0.5 = 200.
  test("no multiplier → upkeep unchanged", () => {
    const out = costsOf(footUnit({}), "Horde");
    expect(out.price).toBe(400);
    expect(out.upkeep).toBe(200);
  });

  test("multiplier scales upkeep of a Horde entry", () => {
    const out = costsOf(footUnit({ "Horde upk cost mdf": 0.5 }), "Horde");
    expect(out.upkeep).toBe(100);
  });

  test("multiplier 0 gives horde units free upkeep", () => {
    const out = costsOf(footUnit({ "Horde upk cost mdf": 0 }), "Horde");
    expect(out.upkeep).toBe(0);
  });

  test("v2.6 'horde unit' flag also counts as horde", () => {
    const r = footUnit({ "Horde upk cost mdf": 0 });
    r.unit["horde unit"] = "Y";
    const out = costsOf(r, null);
    expect(out.upkeep).toBe(0);
  });

  test("non-horde entries of the same culture are unaffected", () => {
    const out = costsOf(footUnit({ "Horde upk cost mdf": 0 }), "Factional");
    expect(out.upkeep).toBe(200);
  });

  test("stacks with the Inf upk cost mdf", () => {
    const out = costsOf(
      footUnit({ "Inf upk cost mdf": 0.5, "Horde upk cost mdf": 0.5 }), "Horde");
    expect(out.upkeep).toBe(50);
  });
});

describe("Inf / Cav CB cost mdf", () => {
  // Baseline cb cost = CBCostMultiplier × price = 2 × 400 = 800.
  test("no multiplier → cb cost unchanged", () => {
    expect(costsOf(footUnit({}))["cb cost"]).toBe(800);
    expect(costsOf(mountedUnit({}))["cb cost"]).toBe(800);
  });

  test("Inf CB cost mdf scales foot custom-battle cost", () => {
    const out = costsOf(footUnit({ "Inf CB cost mdf": 0.5 }));
    expect(out["cb cost"]).toBe(400);
    expect(out.price).toBe(400);    // recruitment price untouched
    expect(out.upkeep).toBe(200);   // upkeep untouched
  });

  test("Cav CB cost mdf scales mounted custom-battle cost", () => {
    const out = costsOf(mountedUnit({ "Cav CB cost mdf": 2 }));
    expect(out["cb cost"]).toBe(1600);
  });

  test("Inf mdf does not touch mounted units and vice versa", () => {
    expect(costsOf(mountedUnit({ "Inf CB cost mdf": 0.5 }))["cb cost"]).toBe(800);
    expect(costsOf(footUnit({ "Cav CB cost mdf": 0.5 }))["cb cost"]).toBe(800);
  });
});

describe("Secondary HP culture bonus exclusions", () => {
  const CULT = { "Secondary HP": 2 };

  test("foot units still get the bonus", () => {
    const r = { unit: {}, cat: { "Category Type": "Foot" }, cult: CULT };
    expect(computeSecHP(r, MR, {})).toBe(2);   // UnitSecHP default 0 + 2
  });

  test("elephants (Is Elephant special mount) are excluded", () => {
    const r = {
      unit: {},
      cat: { "Category Type": "Special" },
      spMount: { "Is Elephant": "Y", "Sec HP": 8 },
      cult: CULT,
    };
    expect(computeSecHP(r, MR, {})).toBe(8);
  });

  test("chariots are excluded", () => {
    const r = {
      unit: {},
      cat: { "Category Type": "Chariot" },
      spMount: { "Sec HP": 4 },
      cult: CULT,
    };
    expect(computeSecHP(r, MR, {})).toBe(4);
  });

  test("non-elephant handlers (dogs/pigs) still get the bonus", () => {
    const r = {
      unit: {},
      cat: { "Category Type": "Handler" },
      spMount: { "Sec HP": 1 },
      cult: CULT,
    };
    expect(computeSecHP(r, MR, {})).toBe(3);
  });
});
