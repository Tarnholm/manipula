// Tests for recruit_priority_offset precedence.
//
// A value in the unit's own "rec priority" column (EDU Builder → Units)
// wins; a blank cell falls back to its Quality class "Recruitment
// Priority" (Core Data → Quality Classes).

import { compute } from "./compute";

const STANDARD = {
  "Specialty Type": "Standard",
  "Attack mdf": 1, "Charge mdf": 1, "Defence mdf": 1, "Morale mdf": 1,
  "Recr cost mdf": 1, "Unit size mdf": 1,
};

function projectWith(recPriority, extra = {}) {
  return {
    modInfo: { platform: "RR" },
    globals: {
      MenPerUnit: 40, GlobalUnitSizeMdf: 1, CostPerMan: 10,
      GlobalRecrCostMdf: 1, GlobalUpkCostMdf: 1, UpkeepToCostRatio: 0.5,
      aor_default_rec_priority: -100,
    },
    factions: [],
    units: [
      { kind: "unit", row: 1, name: "Slingers", Category: "Foot", Specialty: "Standard",
        Quality: "02. levy slinger", "rec priority": recPriority, ...extra },
    ],
    armour: [],
    coreData: {
      categories: [{ "Category Type": "Foot" }],
      specialties: [STANDARD],
      qualityClasses: [{ "Quality Class": "02. levy slinger", "Recruitment Priority": 215 }],
    },
  };
}

const prio = (project) => compute(project)[0]["recruit_priority_offset"];

describe("rec priority", () => {
  test("blank falls back to the Quality class Recruitment Priority", () => {
    expect(prio(projectWith(""))).toBe(215);
    expect(prio(projectWith(undefined))).toBe(215);
    expect(prio(projectWith(null))).toBe(215);
  });

  test("a whitespace-only cell counts as blank, not as 0", () => {
    expect(prio(projectWith("  "))).toBe(215);
  });

  test("a unit value overrides the class", () => {
    expect(prio(projectWith(74))).toBe(74);
    expect(prio(projectWith("74"))).toBe(74);
    expect(prio(projectWith(-20))).toBe(-20);
  });

  test("0 is a real override, not blank", () => {
    expect(prio(projectWith(0))).toBe(0);
    expect(prio(projectWith("0"))).toBe(0);
  });

  test("a unit value still applies when its class has no Recruitment Priority", () => {
    const p = projectWith(50);
    p.coreData.qualityClasses[0]["Recruitment Priority"] = "";
    expect(prio(p)).toBe(50);
  });
});
