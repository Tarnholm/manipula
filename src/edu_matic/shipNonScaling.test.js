// Tests for the ShipNonScaling global (Mod Info → Globals).
//
// With the toggle on, every ship entry must:
//   1. write a crew of 1 into the EDU soldier line, while
//   2. still being priced/upkept on its real "Men per ship" crew, and
//   3. carry the non_scaling attribute.
// Non-ship units must be untouched either way.

import { compute } from "./compute";
import { formatEdu } from "./format";
import { globalFlagOn } from "./formulas/attributes";

const STANDARD = {
  "Specialty Type": "Standard",
  "Attack mdf": 1, "Charge mdf": 1, "Defence mdf": 1, "Morale mdf": 1,
  "Recr cost mdf": 1, "Unit size mdf": 1,
};

// One ship unit + one foot unit, sharing everything else.
function projectWith(shipNonScaling) {
  const globals = {
    MenPerUnit: 40, GlobalUnitSizeMdf: 1, CostPerMan: 10,
    GlobalRecrCostMdf: 1, GlobalUpkCostMdf: 1, UpkeepToCostRatio: 0.5,
  };
  if (shipNonScaling !== undefined) globals.ShipNonScaling = shipNonScaling;
  return {
    modInfo: { platform: "RR" },
    globals,
    factions: [],
    units: [
      { kind: "unit", row: 1, name: "Bireme",  Category: "Ship", Specialty: "Standard", Ship: "Naval Bireme" },
      { kind: "unit", row: 2, name: "Hastati", Category: "Foot", Specialty: "Standard" },
    ],
    armour: [],
    coreData: {
      categories: [{ "Category Type": "Ship" }, { "Category Type": "Foot" }],
      specialties: [STANDARD],
      ships: [{ "Ship Type": "Naval Bireme", "Men per ship": 6, Attack: 6, Armour: 2, Defence: 5, Morale: 8, Cost: 400, Upkeep: 110 }],
    },
  };
}

describe("globalFlagOn", () => {
  test("1 / Y / yes / true (any case) read as on", () => {
    for (const v of [1, "1", "Y", "y", " y ", "Yes", "TRUE", true]) expect(globalFlagOn(v)).toBe(true);
  });
  test("blank, 0 and N read as off", () => {
    for (const v of [undefined, null, "", "  ", 0, "0", "N", "n", "no", "off"]) expect(globalFlagOn(v)).toBe(false);
  });
});

describe("ShipNonScaling", () => {
  const off  = compute(projectWith(undefined));
  const zero = compute(projectWith(0));
  const on   = compute(projectWith(1));
  const onY  = compute(projectWith("Y"));
  const byName = (rows, name) => rows.find((u) => String(u["Name / Comments"] || "").startsWith(name));
  const ship = (rows) => byName(rows, "Bireme");
  const foot = (rows) => byName(rows, "Hastati");
  // The EDU is one block per unit, each opened by a "; COMMENTS <name>" line.
  const blockFor = (rows, name) =>
    formatEdu(rows, { modInfo: { platform: "RR" } })
      .split(/^; COMMENTS\s+/m)
      .find((b) => b.startsWith(name));

  test("off by default — the ship keeps its Men per ship crew", () => {
    expect(ship(off)["No. of men"]).toBe(6);
    expect(ship(off)["# of men"]).toBe(6);
    expect(ship(off)["non_scaling"]).toBeUndefined();
    expect(ship(zero)["No. of men"]).toBe(6);
    expect(ship(zero)["non_scaling"]).toBeUndefined();
  });

  test("on — the ship sails with one man and is tagged non_scaling", () => {
    expect(ship(on)["No. of men"]).toBe(1);
    expect(ship(on)["# of men"]).toBe(1);
    expect(ship(on)["non_scaling"]).toBe("non_scaling");
  });

  test("Y behaves exactly like 1", () => {
    expect(ship(onY)["No. of men"]).toBe(1);
    expect(ship(onY)["non_scaling"]).toBe("non_scaling");
  });

  test("cost and upkeep are unchanged — still priced on the 6-man crew", () => {
    expect(ship(on).price).toBe(ship(off).price);
    expect(ship(on).upkeep).toBe(ship(off).upkeep);
    expect(ship(on)["wpn upg"]).toBe(ship(off)["wpn upg"]);
    expect(ship(on)["arm upg"]).toBe(ship(off)["arm upg"]);
  });

  test("non-ship units are untouched", () => {
    expect(foot(on)["No. of men"]).toBe(foot(off)["No. of men"]);
    expect(foot(on)["non_scaling"]).toBeUndefined();
    expect(foot(on).price).toBe(foot(off).price);
  });

  test("the written EDU carries the attribute and the 1-man soldier line", () => {
    const onBlock = blockFor(on, "Bireme");
    expect(onBlock).toMatch(/^soldier\s+1, 0,/m);
    expect(onBlock).toMatch(/^attributes\s+.*non_scaling/m);

    const offBlock = blockFor(off, "Bireme");
    expect(offBlock).toMatch(/^soldier\s+6, 0,/m);
    expect(offBlock).not.toMatch(/non_scaling/);
  });
});
