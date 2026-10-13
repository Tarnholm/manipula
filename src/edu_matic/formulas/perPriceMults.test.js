// Tests for the Per-Weapon Cost (Core Data → weapons) and Per-Projectile
// Cost (Core Data → projectiles) price multipliers. Each scales the part of
// the recruitment price that its row adds: 0.8 on a row whose share of the
// price is 100 takes that share to 80. Blank = 1 = no change.

import { computeCosts } from "./cost";

const V070_GLOBALS = {
  CombatExp: 1.04, AttackCostCoeff: 12, DefenceCostCoeff: 10,
  AverageAttack: 12.8, AverageDefenceTotal: 29.7,
  CostPerMan: 30, UpkeepToCostRatio: 0.4, CBCostMultiplier: 0.3,
};
const V070 = { globals: V070_GLOBALS, modInfo: { platform: "RTW" } };
const V26 = { globals: { CostPerMan: 10, UpkeepToCostRatio: 0.5 }, modInfo: { platform: "RR" } };
const MR = { armour: { cost: 0 } };
const SOLDIERS = 40;

function price(project, r, stats, extras = 0) {
  return computeCosts(r, MR, project, SOLDIERS, extras, 0, stats || {}, null).price;
}

// Slinger: ranged primary (Sling + Stone bullet) and a knife sidearm.
function slinger(priMult, projMult, secMult) {
  const priWpn = { "Weapon Type": "Sling", Range: 140, Cost: 0.01 };
  const projectile = { "Projectile Type": "Stone bullet", Cost: 1 };
  const secWpn = { "Weapon Type": "Knife", Cost: 0.01 };
  if (priMult !== undefined) priWpn["Per-Weapon Cost"] = priMult;
  if (projMult !== undefined) projectile["Per-Projectile Cost"] = projMult;
  if (secMult !== undefined) secWpn["Per-Weapon Cost"] = secMult;
  return { unit: {}, cat: { "Category Type": "Foot Missile" }, priWpn, projectile, secWpn };
}
const SLINGER_STATS = { attack: 9, "msl range": 140, "msl ammo": 30, "s attack": 5, armour: 1, defence: 4, morale: 6, hp: 1 };

// Swordsman with a secondary weapon: melee primary + melee secondary.
function swordsman(priMult, secMult) {
  const priWpn = { "Weapon Type": "Longsword", Cost: 0.01 };
  const secWpn = { "Weapon Type": "Knife", Cost: 0.01 };
  if (priMult !== undefined) priWpn["Per-Weapon Cost"] = priMult;
  if (secMult !== undefined) secWpn["Per-Weapon Cost"] = secMult;
  return { unit: {}, cat: { "Category Type": "Foot" }, priWpn, secWpn };
}
const SWORD_STATS = { attack: 14, charge: 6, "s attack": 6, armour: 5, defence: 6, shield: 4, morale: 9, hp: 1 };

describe("exponential (v0.7.0) branches", () => {
  test("blank and 1 leave the price exactly as before", () => {
    const base = price(V070, slinger(), SLINGER_STATS);
    expect(price(V070, slinger(1, 1, 1), SLINGER_STATS)).toBe(base);
    expect(price(V070, slinger("", "", ""), SLINGER_STATS)).toBe(base);
    const sBase = price(V070, swordsman(), SWORD_STATS);
    expect(price(V070, swordsman(1, 1), SWORD_STATS)).toBe(sBase);
  });

  test("Per-Projectile Cost 0.8 cuts the projectile's share of the price by 20%", () => {
    const full = price(V070, slinger(), SLINGER_STATS);
    const without = price(V070, slinger(undefined, 0), SLINGER_STATS);
    const share = full - without;
    expect(share).toBeGreaterThan(100);              // a real share, not noise
    const scaled = price(V070, slinger(undefined, 0.8), SLINGER_STATS);
    expect(Math.abs(scaled - (full - 0.2 * share))).toBeLessThanOrEqual(1);
  });

  test("the ranged term also takes the ranged weapon's Per-Weapon Cost", () => {
    const viaProj = price(V070, slinger(undefined, 0.8), SLINGER_STATS);
    const viaWpn  = price(V070, slinger(0.8, undefined), SLINGER_STATS);
    expect(viaWpn).toBe(viaProj);
    // Both at 0.8 → ranged share × 0.64.
    const full = price(V070, slinger(), SLINGER_STATS);
    const share = full - price(V070, slinger(undefined, 0), SLINGER_STATS);
    const both = price(V070, slinger(0.8, 0.8), SLINGER_STATS);
    expect(Math.abs(both - (full - 0.36 * share))).toBeLessThanOrEqual(1);
  });

  test("a multiplier above 1 raises the price", () => {
    const full = price(V070, slinger(), SLINGER_STATS);
    expect(price(V070, slinger(undefined, 1.5), SLINGER_STATS)).toBeGreaterThan(full);
  });

  test("primary and secondary weapons scale their own melee shares", () => {
    const full = price(V070, swordsman(), SWORD_STATS);
    const priShare = full - price(V070, swordsman(0), SWORD_STATS);
    const secShare = full - price(V070, swordsman(undefined, 0), SWORD_STATS);
    expect(priShare).toBeGreaterThan(0);
    expect(secShare).toBeGreaterThan(0);
    expect(Math.abs(price(V070, swordsman(0.5), SWORD_STATS) - (full - 0.5 * priShare))).toBeLessThanOrEqual(1);
    expect(Math.abs(price(V070, swordsman(undefined, 0.5), SWORD_STATS) - (full - 0.5 * secShare))).toBeLessThanOrEqual(1);
  });

  test("a melee unit's projectile row does not touch its price", () => {
    const r = swordsman();
    r.projectile = { "Projectile Type": "Light javelin", "Per-Projectile Cost": 0.5 };
    expect(price(V070, r, SWORD_STATS)).toBe(price(V070, swordsman(), SWORD_STATS));
  });

  test("upkeep follows the scaled price; weapon upgrade cost is untouched", () => {
    const run = (r) => computeCosts(r, MR, V070, SOLDIERS, 0, 0, SLINGER_STATS, null);
    const a = run(slinger());
    const b = run(slinger(undefined, 0.5));
    expect(b.price).toBeLessThan(a.price);
    expect(b.upkeep).toBeLessThan(a.upkeep);
    expect(b["wpn upg"]).toBe(a["wpn upg"]);
  });
});

describe("linear branches", () => {
  // Chariot (v0.7.0 linear branch): price = (CostPerMan + weapon + projectile) × soldiers.
  function chariot(priMult, projMult) {
    const r = {
      unit: {}, cat: { "Category Type": "Chariot" },
      priWpn: { Cost: 10 }, projectile: { Cost: 20 },
    };
    if (priMult !== undefined) r.priWpn["Per-Weapon Cost"] = priMult;
    if (projMult !== undefined) r.projectile["Per-Projectile Cost"] = projMult;
    return r;
  }

  test("chariot: each row's term is multiplied directly", () => {
    expect(price(V070, chariot())).toBe((30 + 10 + 20) * SOLDIERS);          // 2400
    expect(price(V070, chariot(undefined, 0.8))).toBe((30 + 10 + 16) * SOLDIERS);
    expect(price(V070, chariot(0.5, undefined))).toBe((30 + 5 + 20) * SOLDIERS);
  });

  test("v2.6 linear model: weapon term is multiplied directly", () => {
    const r = { unit: {}, cat: { "Category Type": "Foot" }, priWpn: { Cost: 5 } };
    expect(price(V26, r)).toBe((10 + 5) * SOLDIERS);
    r.priWpn["Per-Weapon Cost"] = 0.5;
    expect(price(V26, r)).toBe((10 + 2.5) * SOLDIERS);
  });
});
