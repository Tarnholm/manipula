// Tests for the RoundedUnitCosts global (Mod Info → Globals).
//
// With the toggle on, every denarii figure on stat_cost (price, upkeep,
// weapon / armour upgrade, custom battle cost) is rounded to the nearest 10,
// an exact 5 upwards. Recruitment turns never move.

import { compute } from "./compute";
import { roundToTen } from "./formulas/cost";

const STANDARD = {
  "Specialty Type": "Standard",
  "Attack mdf": 1, "Charge mdf": 1, "Defence mdf": 1, "Morale mdf": 1,
  "Recr cost mdf": 1, "Unit size mdf": 1,
};

function projectWith(rounded) {
  const globals = {
    MenPerUnit: 40, GlobalUnitSizeMdf: 1, CostPerMan: 10.37,
    GlobalRecrCostMdf: 1, GlobalUpkCostMdf: 1, UpkeepToCostRatio: 0.33,
    CBCostMultiplier: 1.37,
  };
  if (rounded !== undefined) globals.RoundedUnitCosts = rounded;
  return {
    modInfo: { platform: "RR" },
    globals,
    factions: [],
    units: [
      { kind: "unit", row: 1, name: "Hastati", Category: "Foot", Specialty: "Standard" },
      { kind: "unit", row: 2, name: "Bireme",  Category: "Ship", Specialty: "Standard", Ship: "Naval Bireme" },
    ],
    armour: [],
    coreData: {
      categories: [{ "Category Type": "Foot" }, { "Category Type": "Ship" }],
      specialties: [STANDARD],
      ships: [{ "Ship Type": "Naval Bireme", "Men per ship": 6, Attack: 6, Armour: 2, Defence: 5, Morale: 8, Cost: 403, Upkeep: 113 }],
    },
  };
}

const COST_COLS = ["price", "upkeep", "wpn upg", "arm upg", "cb cost"];

describe("roundToTen", () => {
  test("nearest 10, an exact 5 upwards", () => {
    expect(roundToTen(743)).toBe(740);
    expect(roundToTen(735)).toBe(740);
    expect(roundToTen(734)).toBe(730);
    expect(roundToTen(746)).toBe(750);
    expect(roundToTen(740)).toBe(740);
    expect(roundToTen(5)).toBe(10);
    expect(roundToTen(4)).toBe(0);
    expect(roundToTen(0)).toBe(0);
  });
});

describe("RoundedUnitCosts", () => {
  const off  = compute(projectWith(undefined));
  const zero = compute(projectWith(0));
  const on   = compute(projectWith(1));
  const onY  = compute(projectWith("Y"));

  test("blank / 0 leave every cost as it was", () => {
    expect(zero).toEqual(off);
  });

  test("on — each cost is the off value rounded to 10, turns untouched", () => {
    for (let i = 0; i < off.length; i++) {
      expect(on[i]["turns"]).toBe(off[i]["turns"]);
      for (const col of COST_COLS) {
        if (off[i][col] == null) continue;
        expect(on[i][col]).toBe(roundToTen(off[i][col]));
        expect(on[i][col] % 10).toBe(0);
      }
    }
    // The fixture has to exercise real rounding, not already-round numbers.
    expect(off.some((r) => COST_COLS.some((c) => r[c] != null && r[c] % 10 !== 0))).toBe(true);
  });

  test("nothing but the costs changes", () => {
    for (let i = 0; i < off.length; i++) {
      const strip = (r) => Object.fromEntries(Object.entries(r).filter(([k]) => !COST_COLS.includes(k)));
      expect(strip(on[i])).toEqual(strip(off[i]));
    }
  });

  test("Y behaves exactly like 1", () => {
    expect(onY).toEqual(on);
  });
});
