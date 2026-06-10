// Tests for parseEDB / parseEDBAsync — the EDB recruitment parser that feeds
// "current EDB" panels, Import from EDB, and write-back diffing. v0.36.98
// introduced a ReferenceError in parseEDBAsync (`raw` used but never declared),
// which made every mod load with zero recruits — units showed as "not coded
// into EDB" and Import from EDB wiped projects. Lock both variants down.
import { parseEDB, parseEDBAsync } from "./edb";

const SAMPLE = `
alias gov_all
{
    requires factions { all, }
}

building military_industrial_complex
{
    levels mic_1 mic_2
    {
        mic_1 requires factions { all, }
        {
            capability
            {
                recruit "roman hastati"  0  requires factions { roman, } and is_player and mic_tier_1
                recruit "roman velites"  0  requires factions { roman, } and not is_player ; inline comment
            }
        }
        mic_2 requires factions { all, }
        {
            capability
            {
                recruit "roman princeps"  1  requires factions { roman, } and is_player and mic_tier_2
            }
        }
    }
}
`;

function checkResult(r) {
  test("finds the alias", () => {
    expect(r.aliases.map((a) => a.name)).toContain("gov_all");
  });

  test("finds the building and both levels", () => {
    expect(r.buildings).toHaveLength(1);
    expect(r.buildings[0].name).toBe("military_industrial_complex");
    expect(r.buildings[0].levels.map((l) => l.name)).toEqual(["mic_1", "mic_2"]);
  });

  test("collects every recruit line with building/level attribution", () => {
    expect(r.recruits).toHaveLength(3);
    expect(r.recruits.map((x) => x.unit)).toEqual(["roman hastati", "roman velites", "roman princeps"]);
    expect(r.recruits[2].level).toBe("mic_2");
    expect(r.recruits[2].xp).toBe(1);
  });

  test("strips inline ; comments from requires but keeps them in raw", () => {
    const velites = r.recruits[1];
    expect(velites.requires).toBe("factions { roman, } and not is_player");
    expect(velites.raw).toContain("; inline comment");
  });
}

describe("parseEDB (sync)", () => {
  checkResult(parseEDB(SAMPLE));
});

describe("parseEDBAsync", () => {
  let r;
  beforeAll(async () => {
    r = await parseEDBAsync(SAMPLE);
  });
  // beforeAll fills `r` before the lambdas in checkResult run via closure below.
  test("finds the alias", () => expect(r.aliases.map((a) => a.name)).toContain("gov_all"));
  test("finds the building and both levels", () => {
    expect(r.buildings[0].levels.map((l) => l.name)).toEqual(["mic_1", "mic_2"]);
  });
  test("collects every recruit line", () => {
    expect(r.recruits.map((x) => x.unit)).toEqual(["roman hastati", "roman velites", "roman princeps"]);
  });
  test("strips inline ; comments from requires but keeps them in raw", () => {
    expect(r.recruits[1].requires).toBe("factions { roman, } and not is_player");
    expect(r.recruits[1].raw).toContain("; inline comment");
  });
});
