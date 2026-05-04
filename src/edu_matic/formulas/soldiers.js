// formulas/soldiers.js — port of CreateUnitData Case 12 ("# of men").
//
// The unit's soldier count is category-specific:
//
//  Foot / Foot Missile / Foot General:
//    MenPerUnit × RecrUnitSizeMdf × QualUnitSizeMdf × CatUnitSizeMdf
//              × SpecUnitSizeMdf × CultInfUnitSizeMdf × DwelUnitSizeMdf
//              × GlobalUnitSizeMdf
//    → clamp to platform min/max, round to nearest 5
//
//  Mounted / Mounted Missile:
//    (same product but uses the Culture row's Cav-side unit size mdf)
//    → clamp, round to nearest 2
//
//  Special (elephants/chariots):
//    SpMountMountsPerUnit × SpMountMenPerMount   (no mdf, no rounding)
//
//  Engine:
//    EngineEnginesPerUnit × EngineMenPerEngine
//
//  Ship:
//    ShipMenPerShip
//
//  Handler:
//    falls through to the Foot formula (same unit-size chain)
//
// Missing modifier cells default to 1 — matches VBA's GetDataFromDef
// behaviour for multiplicative modifiers.


/** One or five — platform-dependent clamping bounds. */
function platformMinMax(isM2) {
  return isM2 ? { min: 4, max: 100 } : { min: 6, max: 60 };
}

function clamp(n, min, max) { return Math.max(min, Math.min(max, n)); }
/** VBA CInt uses banker's rounding (half-to-even). */
function cint(x) {
  const f = Math.floor(x);
  const d = x - f;
  if (d < 0.5) return f;
  if (d > 0.5) return f + 1;
  return (f % 2 === 0) ? f : f + 1;
}
function roundTo(n, step) { return cint(n / step) * step; }
function num(v, dflt)     { const n = Number(v); return Number.isFinite(n) ? n : dflt; }

/**
 * @param {import("../resolve").ResolvedUnit} r
 * @param {object} globals
 * @param {boolean} isM2
 * @returns {number|null}   null if not determinable yet (missing ref)
 */
function computeSoldierCount(r, globals, isM2) {
  const catName = String((r.cat && r.cat["Category Type"]) || "").toLowerCase();
  const mpu = num(globals.MenPerUnit, null);
  const gMdf = num(globals.GlobalUnitSizeMdf, 1);
  const { min, max } = platformMinMax(isM2);

  // ─ Special / Chariot / Engine / Ship take their count from an embedded ref ─
  if (catName === "special" || catName === "chariot") {
    const per  = num(r.spMount && r.spMount["Mounts per unit"], null);
    const each = num(r.spMount && r.spMount["Men per mount"], null);
    if (per == null || each == null) return null;
    return Math.round(per * each * gMdf);
  }
  if (catName === "engine") {
    const per  = num(r.engine && r.engine["Engines per unit"], null);
    const each = num(r.engine && r.engine["Men per engine"], null);
    if (per == null || each == null) return null;
    return Math.round(per * each * gMdf);
  }
  if (catName === "ship") {
    const each = num(r.ship && r.ship["Men per ship"], null);
    if (each == null) return null;
    return Math.round(each * gMdf);
  }

  if (mpu == null) return null;

  // Infantry vs cavalry selects a different Culture column; for
  // handler/foot-general/unknown categories we fall back to the Inf column.
  const isMounted = catName === "mounted" || catName === "mounted missile";
  // VBA L8640: round to multiples of 2 when category is mounted OR the
  // unit's "general unit" cell (col AS) is non-empty — i.e. any unit
  // with a general_unit / general_unit_upgrade attribute is treated as
  // a small elite bodyguard regardless of Foot/Mounted category.
  const isGeneralUnit = !!(r.unit && r.unit["general unit"]);
  const cultSizeKey = isMounted ? "Cav unit size mdf" : "Inf unit size mdf";

  const factors = [
    mpu,
    num(r.recr  && r.recr["Unit size mdf"], 1),
    num(r.qual  && r.qual["Unit size mdf"], 1),
    num(r.cat   && r.cat["Unit size mdf"],  1),
    num(r.spec  && r.spec["Unit size mdf"], 1),
    num(r.cult  && r.cult[cultSizeKey],     1),
    num(r.dwel  && r.dwel["Unit size mdf"], 1),
    gMdf,
  ];
  const raw = factors.reduce((a, b) => a * b, 1);

  // General bodyguards (small elite units) round to 2 along with cavalry;
  // regular foot units round to 5.
  const step = (isMounted || isGeneralUnit) ? 2 : 5;
  return clamp(roundTo(raw, step), min, max);
}

export { computeSoldierCount };
