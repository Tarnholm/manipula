// Tests for the faction ordering / ownership-cleaning helpers — the logic
// behind EDU ownership + ethnicity output. These have churned a lot
// (canonical order → Mod-Info order, exclude sets, slave-last, dedupe), so
// they're the highest-value thing to lock down with a regression test.
import {
  factionOrderFromGlobals,
  cleanFactionList,
  buildExcludeSet,
  reorderOwnershipString,
  DEFAULT_ETHNICITY_EXCLUDE,
} from "./factionOrder";

describe("factionOrderFromGlobals", () => {
  test("reads Faction1..N in NUMERIC order (not lexical)", () => {
    const globals = { Faction2: "carthage", Faction1: "sparta", Faction10: "epirus", Faction3: "pontus" };
    expect(factionOrderFromGlobals(globals)).toEqual(["sparta", "carthage", "pontus", "epirus"]);
  });
  test("trims values and drops empties; ignores non-Faction keys", () => {
    const globals = { Faction1: " sparta ", Faction2: "", Faction3: "pontus", MercCostMultiplier: 1.8 };
    expect(factionOrderFromGlobals(globals)).toEqual(["sparta", "pontus"]);
  });
  test("empty / missing globals → []", () => {
    expect(factionOrderFromGlobals(null)).toEqual([]);
    expect(factionOrderFromGlobals({})).toEqual([]);
  });
});

describe("cleanFactionList", () => {
  test("preserves input order, dedupes case-insensitively, slave last", () => {
    const out = cleanFactionList(["romans_julii", "Sparta", "slave", "sparta", "pontus"], new Set());
    expect(out).toEqual(["romans_julii", "Sparta", "pontus", "slave"]);
  });
  test("drops excluded (placeholder) factions, lowercased compare + trim", () => {
    const excl = new Set(["greeks", "gauls"]);
    const out = cleanFactionList([" Greeks ", "sparta", "GAULS", "pontus"], excl);
    expect(out).toEqual(["sparta", "pontus"]);
  });
  test("multiple slaves collapse to a single trailing slave", () => {
    const out = cleanFactionList(["slave", "sparta", "slave"], new Set());
    expect(out).toEqual(["sparta", "slave"]);
  });
});

describe("buildExcludeSet", () => {
  test("includes the built-in defaults, lowercased", () => {
    const set = buildExcludeSet("");
    for (const d of DEFAULT_ETHNICITY_EXCLUDE) expect(set.has(d)).toBe(true);
  });
  test("unions comma-separated extras from the global, trimmed + lowercased", () => {
    const set = buildExcludeSet(" Foo , bar ");
    expect(set.has("foo")).toBe(true);
    expect(set.has("bar")).toBe(true);
  });
});

describe("reorderOwnershipString", () => {
  test("cleans a comma string: dedupe, exclude, slave last", () => {
    const excl = buildExcludeSet(""); // greeks/gauls/... excluded by default
    expect(reorderOwnershipString("sparta, slave, greeks, sparta, pontus", excl))
      .toBe("sparta, pontus, slave");
  });
  test("empty string passes through", () => {
    expect(reorderOwnershipString("", buildExcludeSet(""))).toBe("");
  });
});
