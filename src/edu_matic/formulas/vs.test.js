// Tests for mount_effect (formulas/vs.js): every Core Data table adds its
// "vs horse / elephant / chariot / camel" value 1:1 — typing 3 on a weapon
// gives +3, whether that weapon sits in the primary or secondary slot.

import { computeVS } from "./vs";

const PROJECT = {
  globals: { MeleeFraction: 0.75, HorseFraction: 0.25, ElephantFraction: 0.01, ChariotFraction: 0.01, CamelFraction: 0.005 },
};
const vs = (r) => computeVS(r, PROJECT);

describe("mount_effect", () => {
  test("a secondary weapon's value is not divided", () => {
    const out = vs({ priWpn: { "vs horse": 0 }, secWpn: { "vs horse": 3 } });
    expect(out.vs_horse_n).toBe(3);
    expect(out.vs_horse).toBe("horse +3");
  });

  test("a primary weapon's value is not scaled when a secondary is present", () => {
    expect(vs({ priWpn: { "vs elephant": 4 }, secWpn: {} }).vs_elephant_n).toBe(4);
  });

  test("weapon values add on top of specialty / dwelling / mount values", () => {
    const out = vs({
      spec: { "vs horse": 1 }, dwel: { "vs horse": -1 }, mount: { "vs horse": 2 },
      priWpn: { "vs horse": 0 }, secWpn: { "vs horse": 3 },
    });
    expect(out.vs_horse_n).toBe(5);
  });

  test("primary weapon, its projectile and secondary weapon each count once", () => {
    const out = vs({ priWpn: { "vs camel": 1 }, projectile: { "vs camel": -2 }, secWpn: { "vs camel": 2 } });
    expect(out.vs_camel_n).toBe(1);
  });

  test("MeleeFraction no longer affects mount_effect", () => {
    const r = { priWpn: { "vs chariot": 2 }, secWpn: { "vs chariot": 2 } };
    const a = computeVS(r, { globals: { ...PROJECT.globals, MeleeFraction: 0.75 } });
    const b = computeVS(r, { globals: { ...PROJECT.globals, MeleeFraction: 0.1 } });
    expect(a.vs_chariot_n).toBe(4);
    expect(b.vs_chariot_n).toBe(4);
  });
});
