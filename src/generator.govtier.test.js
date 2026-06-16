import { generateAORPlayerLines } from "./generator";

// User rule: AoR lines gated at gov_tier_1 get a per-tier upper cap on both
// government tier and colony tier, keyed on the unit's canonical MIC tier:
//   tier 1      → gov_tier_1 and not colony_tier_2
//   tier 2      → gov_tier_1 and not gov_tier_3 and not colony_tier_1
//   tier 3 or 4 → gov_tier_1 and not gov_tier_2 and not colony_tier_1
function aorLine(canonicalMicTier) {
  const u = {
    unit: "picentine skirmishers",
    enabled: true,
    factions: ["romans_julii"],
    canonicalMicTier,
    homelandMicTier: canonicalMicTier,
    aor: { enabled: true, govTier: 1 },
  };
  return generateAORPlayerLines(u)[0].text;
}

describe("AoR gov_tier / colony cap by canonical MIC tier", () => {
  test("tier 1 → gov_tier_1 and not colony_tier_2 (no gov_tier cap)", () => {
    const line = aorLine(1);
    expect(line).toContain("gov_tier_1 and not colony_tier_2");
    expect(line).not.toMatch(/not\s+gov_tier_\d/);
  });
  test("tier 2 → gov_tier_1 and not gov_tier_3 and not colony_tier_1", () => {
    expect(aorLine(2)).toContain("gov_tier_1 and not gov_tier_3 and not colony_tier_1");
  });
  test("tier 3 → gov_tier_1 and not gov_tier_2 and not colony_tier_1", () => {
    expect(aorLine(3)).toContain("gov_tier_1 and not gov_tier_2 and not colony_tier_1");
  });
  test("tier 4 → gov_tier_1 and not gov_tier_2 and not colony_tier_1", () => {
    expect(aorLine(4)).toContain("gov_tier_1 and not gov_tier_2 and not colony_tier_1");
  });
});
