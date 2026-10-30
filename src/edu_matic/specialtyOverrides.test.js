// Tests for the 0.45.0 rule set:
//   - specialty "special ability" overrides (attributes, the special-ability
//     button, formation2, hardy / not_hardy);
//   - cantabrian_circle for cavalry with non-precursor missiles;
//   - the DisableGeneralWedge global;
//   - ranged + melee units showing the melee charge on both weapons.

import { computeAttributes } from "./formulas/attributes";
import { computeFormation2 } from "./formulas/misc";
import { compute } from "./compute";

const MR = { soldierMass: 1, horseMass: 1, armour: null };
const PROJECT = { modInfo: { platform: "RR" }, globals: {} };

/** A hand-built resolved unit: only the slots the formulas read. */
function unit({ cat = "Foot", abilities = [], qual = "10. trained", cult = {}, range = 0, unitFields = {}, spec = {} } = {}) {
  const s = { "Specialty Type": "Test", ...spec };
  abilities.forEach((a, i) => { s[i === 0 ? "special ability" : `special ability ${i + 1}`] = a; });
  return {
    unit: { ...unitFields },
    cat: { "Category Type": cat },
    spec: s,
    qual: { "Quality Class": qual },
    cult,
    priWpn: range ? { Range: range } : {},
  };
}
const attrs = (r, project = PROJECT) => computeAttributes(r, MR, project);
const f2 = (r, globals = {}, isGeneral = false) => computeFormation2(r, MR, globals, "RR", isGeneral);

describe("specialty attribute overrides", () => {
  test("each attribute override is granted regardless of category or class", () => {
    const a = attrs(unit({ cat: "Engine", abilities: ["power_charge", "command", "hide_long_grass"] }));
    expect(a["p_charge"]).toBe("power_charge");
    expect(a["command"]).toBe("command");
    expect(a["hide_l_grass"]).toBe("hide_long_grass");
    expect(attrs(unit({ abilities: ["hide_improved_forest"] }))["hide_forest(3)"]).toBe("hide_improved_forest");
  });

  test("special-ability button: specialty wins, any category", () => {
    for (const ab of ["screeching_women", "druid", "warcry", "cantabrian_circle"]) {
      expect(attrs(unit({ cat: "Mounted", abilities: [ab] }))["cant_circle/warcry/druid"]).toBe(ab);
    }
  });

  test("hardy is exact; not_hardy strips every level", () => {
    const veryHardyCulture = { "Inf fatigue mdf": 2 };
    expect(attrs(unit({ cult: veryHardyCulture }))["hardy(2)"]).toBe("very_hardy");
    expect(attrs(unit({ cult: veryHardyCulture, abilities: ["hardy"] }))["hardy(2)"]).toBe("hardy");
    expect(attrs(unit({ cult: veryHardyCulture, abilities: ["not_hardy"] }))["hardy(2)"]).toBeUndefined();
    expect(attrs(unit({ abilities: ["extremely_hardy", "not_hardy"] }))["hardy(2)"]).toBeUndefined();
    expect(attrs(unit({ abilities: ["hardy", "not_hardy"] }))["hardy(2)"]).toBeUndefined();
  });

  test("no ability → previous behaviour", () => {
    const a = attrs(unit());
    expect(a["p_charge"]).toBeUndefined();
    expect(a["command"]).toBeUndefined();
    expect(a["cant_circle/warcry/druid"]).toBeUndefined();
  });
});

describe("cantabrian_circle for non-precursor missile cavalry", () => {
  const cult = { "Cantabrian min class": "21. missile cavalry" };
  const q = "22. light cav";
  const cc = (r) => attrs(r)["cant_circle/warcry/druid"];

  test("Mounted Missile with a ranged weapon gets it", () => {
    expect(cc(unit({ cat: "Mounted Missile", cult, qual: q, range: 120 }))).toBe("cantabrian_circle");
  });
  test("Mounted with no-precursor javelins gets it; with precursor javelins it doesn't", () => {
    expect(cc(unit({ cat: "Mounted", cult, qual: q, range: 60, spec: { "no precursor": "Y" } }))).toBe("cantabrian_circle");
    expect(cc(unit({ cat: "Mounted", cult, qual: q, range: 60 }))).toBeUndefined();
  });
  test("Precursor Override 'on' takes it away", () => {
    expect(cc(unit({ cat: "Mounted Missile", cult, qual: q, range: 120, unitFields: { "Precursor Override": "on" } }))).toBeUndefined();
  });
  test("no missile, foot, or below the culture class → none", () => {
    expect(cc(unit({ cat: "Mounted", cult, qual: q, spec: { "no precursor": "Y" } }))).toBeUndefined();
    expect(cc(unit({ cat: "Foot", cult, qual: q, range: 60, spec: { "no precursor": "Y" } }))).toBeUndefined();
    expect(cc(unit({ cat: "Mounted Missile", cult, qual: "17. light HA", range: 120 }))).toBeUndefined();
  });
});

describe("formation2 overrides + DisableGeneralWedge", () => {
  const cult = { "Wedge min class": "24. heavy cav" };
  const heavy = (abilities = []) => unit({ cat: "Mounted", cult, qual: "24. heavy cav", abilities });

  test("a specialty formation wins over the auto value", () => {
    for (const f of ["wedge", "schiltrom", "shield_wall", "testudo", "phalanx"]) {
      expect(f2(unit({ abilities: [f] }))).toBe(f);
    }
  });
  test("off (blank / 0): generals wedge as before", () => {
    expect(f2(heavy(), {}, true)).toBe("wedge");
    expect(f2(heavy(), { DisableGeneralWedge: 0 }, true)).toBe("wedge");
  });
  test("on: generals lose the auto wedge, other units keep it", () => {
    expect(f2(heavy(), { DisableGeneralWedge: 1 }, true)).toBe("");
    expect(f2(heavy(), { DisableGeneralWedge: "Y" }, true)).toBe("");
    expect(f2(heavy(), { DisableGeneralWedge: 1 }, false)).toBe("wedge");
  });
  test("on: a specialty wedge still gives a general one", () => {
    expect(f2(heavy(["wedge"]), { DisableGeneralWedge: 1 }, true)).toBe("wedge");
  });
});

describe("ranged + melee units show the melee charge on both weapons", () => {
  const STANDARD = { "Specialty Type": "Standard", "Attack mdf": 1, "Charge mdf": 1, "Defence mdf": 1, "Morale mdf": 1, "Recr cost mdf": 1, "Unit size mdf": 1 };
  function project(secWeapon) {
    return {
      modInfo: { platform: "RR" },
      globals: { MenPerUnit: 40, GlobalUnitSizeMdf: 1, CostPerMan: 10, GlobalRecrCostMdf: 1, GlobalUpkCostMdf: 1, UpkeepToCostRatio: 0.5, ManMass: 1, UnitCharge: 4 },
      factions: [],
      units: [{ kind: "unit", row: 1, name: "Skirmisher", Category: "Foot", Specialty: "Standard",
                Weapon: "Javelin", "Sec Weapon": secWeapon, Quality: "Q" }],
      armour: [],
      coreData: {
        categories: [{ "Category Type": "Foot" }],
        specialties: [STANDARD],
        qualityClasses: [{ "Quality Class": "Q" }],
        weapons: [
          { "Weapon Type": "Javelin", Attack: 8, Charge: 9, Range: 60 },
          { "Weapon Type": "Spear", Attack: 5, Charge: 2 },
        ],
      },
    };
  }
  const row = (p) => compute(p)[0];

  test("primary charge = secondary charge", () => {
    const r = row(project("Spear"));
    expect(r["msl range"]).toBeGreaterThan(0);
    expect(r["s attack"]).toBeGreaterThan(0);
    expect(r["charge"]).toBe(r["s charge"]);
  });

  test("the javelin's own charge no longer reaches the written charge", () => {
    // (Costs: no ranged-primary cost branch reads the primary charge, and the
    // copy runs after computeCosts anyway — on the RIS roster not one
    // stat_cost line moved.)
    const a = project("Spear");
    const b = project("Spear");
    b.coreData.weapons[0].Charge = 30;
    expect(row(b)["charge"]).toBe(row(a)["charge"]);
    expect(row(b)["price"]).toBe(row(a)["price"]);
  });

  test("no melee secondary → primary charge untouched", () => {
    const r = row(project(undefined));
    expect(r["s attack"]).toBe(0);
    expect(r["charge"]).not.toBe(r["s charge"]);
  });
});
