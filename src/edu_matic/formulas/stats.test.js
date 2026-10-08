// Tests for the MeleeFractionImpactingTerrainEffect global (Mod Info →
// Globals): with a secondary weapon present, terrain bonuses blend the two
// weapons by MeleeFraction unless the global is set to 0.

import { computeStats } from "./stats";

const MR = { mass: null, soldierMass: 1, horseMass: 0, armour: { heatMdf: 0 } };
// Both weapons carry +2 in every terrain; MeleeFraction 0.75 blends them to
// 2 × 0.75 + 2 × 0.25 = 2, while 1:1 gives 4.
const UNIT = {
  unit: {},
  cat: { "Category Type": "Foot" },
  priWpn: { "Weapon Type": "Gladius", scrub: 2, sand: 2, forest: 2, snow: 2 },
  secWpn: { "Weapon Type": "Pilum", scrub: 2, sand: 2, forest: 2, snow: 2 },
};
function terrain(setting, r = UNIT, meleeFraction = 0.75) {
  const globals = { MeleeFraction: meleeFraction };
  if (setting !== undefined) globals.MeleeFractionImpactingTerrainEffect = setting;
  const out = computeStats(r, MR, { modInfo: { platform: "RR" }, globals }, 0);
  return [out.scrub, out.sand, out.forest, out.snow];
}

describe("MeleeFractionImpactingTerrainEffect", () => {
  test("blank, 1 and Y keep the MeleeFraction blend (the VBA result)", () => {
    for (const v of [undefined, "", 1, "1", "Y"]) expect(terrain(v)).toEqual([2, 2, 2, 2]);
  });

  test("0 / N switches the blend off: both weapons add 1:1", () => {
    for (const v of [0, "0", "N", "no"]) expect(terrain(v)).toEqual([4, 4, 4, 4]);
  });

  test("with the blend off, MeleeFraction no longer moves terrain", () => {
    // Primary +4 forest, secondary 0: blended it is 4 × MeleeFraction.
    const r = { ...UNIT, priWpn: { ...UNIT.priWpn, forest: 4 }, secWpn: { ...UNIT.secWpn, forest: 0 } };
    expect(terrain(1, r, 0.75)[2]).toBe(3);
    expect(terrain(1, r, 0.25)[2]).toBe(1);
    expect(terrain(0, r, 0.75)[2]).toBe(4);
    expect(terrain(0, r, 0.25)[2]).toBe(4);
  });

  test("units without a secondary weapon are unaffected either way", () => {
    const r = { unit: {}, cat: UNIT.cat, priWpn: UNIT.priWpn };
    expect(terrain(0, r)).toEqual(terrain(1, r));
    expect(terrain(0, r)).toEqual([2, 2, 2, 2]);
  });
});
