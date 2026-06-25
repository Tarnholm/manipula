import { generateAORPlayerLines } from "./generator";

// aor_tier_N alias should suppress our gov_tier_1 + cap entirely.
test("aor_tier_2 alias omits gov_tier_1 cap on AOR line", () => {
  const unit = {
    unit: "latin cohort",
    enabled: true,
    canonicalMicTier: 2,
    factions: [],
    aor: { enabled: true, aorOnly: true, recruitName: "aor latin cohort", govTier: 1 },
    aorRequires: [
      "hidden_resource aor_latin",
      "aor_tier_2",
      'not major_event "polybian_reforms"',
      'not major_event "marian_reforms"',
    ],
  };
  const lines = generateAORPlayerLines(unit);
  const text = lines[0].text.trim();
  expect(text).toBe(
    'recruit "aor latin cohort" 0 requires factions { all, } and is_player and mic_tier_2 and hidden_resource aor_latin and aor_tier_2 and not major_event "polybian_reforms" and not major_event "marian_reforms"'
  );
});

test("no alias still emits gov_tier_1 + tier-2 cap", () => {
  const unit = {
    unit: "latin cohort",
    enabled: true,
    canonicalMicTier: 2,
    factions: [],
    aor: { enabled: true, aorOnly: true, recruitName: "aor latin cohort", govTier: 1 },
    aorRequires: ["hidden_resource aor_latin"],
  };
  const text = generateAORPlayerLines(unit)[0].text.trim();
  expect(text).toContain("and gov_tier_1 and not gov_tier_3 and not colony_tier_1");
});
