// Tests for parseDMB — the descr_model_battle parser whose bare-model and
// model_flexi extraction drives the asset orphan + missing-model audits.
// A regression here silently mis-flags assets, so lock the line shapes down.
import { parseDMB } from "./dmb";

const SAMPLE = `
type light_infantry_longshield
    skeleton fs_dagger
    pbr_texture data/characters/textures/foo_pbr.tga
    texture pontus, data/characters/textures/foo.tga
    model African    data/characters/light_spear_infantry_pontus
    model parni, African    data/characters/light_spear_infantry_parni
    no_variation model African    data/characters/light_spear_infantry_pontus
    model slave, African    data/characters/light_spear_infantry_slave    ; trailing comment

type some_flexi_unit
    model_flexi_m data/characters/foo_high_lod0.cas, 15
    model_flexi   data/characters/foo_high_lod1.cas, max
`;

describe("parseDMB", () => {
  const r = parseDMB(SAMPLE);

  test("collects every declared type", () => {
    expect(r.types.has("light_infantry_longshield")).toBe(true);
    expect(r.types.has("some_flexi_unit")).toBe(true);
  });

  test("bare-model paths: no .cas/_lodN suffix, faction/skin prefix stripped, attributed to the right type", () => {
    const paths = r.bareModels.map((m) => m.path);
    expect(paths).toContain("data/characters/light_spear_infantry_pontus");
    expect(paths).toContain("data/characters/light_spear_infantry_parni");
    expect(paths).toContain("data/characters/light_spear_infantry_slave");
    for (const m of r.bareModels) expect(m.type).toBe("light_infantry_longshield");
    // bare models must NOT capture the .cas model_flexi lines
    for (const p of paths) expect(/\.cas$/i.test(p)).toBe(false);
  });

  test("model_flexi[_m] paths captured as fully-qualified .cas (not bare)", () => {
    const flexi = r.models.map((m) => m.path);
    expect(flexi).toContain("data/characters/foo_high_lod0.cas");
    expect(flexi).toContain("data/characters/foo_high_lod1.cas");
    const bare = r.bareModels.map((m) => m.path);
    expect(bare).not.toContain("data/characters/foo_high_lod0.cas");
  });

  test("textures (pbr + faction-keyed) captured without the faction key", () => {
    const tex = r.textures.map((t) => t.path);
    expect(tex).toContain("data/characters/textures/foo_pbr.tga");
    expect(tex).toContain("data/characters/textures/foo.tga");
  });

  test("empty / non-string input is safe", () => {
    expect(parseDMB("").types.size).toBe(0);
    expect(parseDMB(null).bareModels).toEqual([]);
  });
});
