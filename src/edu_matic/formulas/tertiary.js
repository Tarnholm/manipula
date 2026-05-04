// formulas/tertiary.js — port of Cases 130–153 (tertiary weapon stats,
// emitted only when the unit has a secondary engine projectile).


import { cint } from "./attack";

function num(v, dflt) {
  if (v === null || v === undefined || v === "") return dflt;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : dflt;
}
function str(v) { return v == null ? "" : String(v); }
function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }

/** @param {import("../resolve").ResolvedUnit} r */
function computeTertiary(r, project) {
  if (!r.engineSec) return {};   // no sec engine projectile → nothing to emit
  const out = {};
  const globals = project.globals || {};
  const gAtk   = num(globals.GlobalAttackMdf, 1);
  const gRange = num(globals.GlobalRangeMdf,  1);
  const gAmmo  = num(globals.GlobalAmmoMdf,   1);
  const engAtk = num(r.engine && r.engine["Attack"], 0);

  // Case 130 — attack
  out["t attack"] = clamp(cint(gAtk * (engAtk + num(r.engineSec["Attack"], 0))), 1, 63);
  // Case 131 — charge (always 0 for tertiary)
  out["t charge"] = 0;
  // Case 132 — missile type
  out["t msl type"] = str(r.unit["sec eng missile type"]);
  // Case 133 — missile range
  out["t msl range"] = cint(gRange * (num(r.engine && r.engine["Range"], 0) + num(r.engineSec["Range"], 0)));
  // Case 134 — missile ammo
  out["t msl ammo"] = cint(gAmmo * num(r.engineSec["Ammo"], 0));
  // Case 135 — weapon type
  out["t wpn type"] = "siege_missile";
  // Case 136 — wpn tech
  out["t wpn tech"] = str(r.engineSec["wpn tech"]);
  // Case 137 — dmg type
  out["t dmg type"] = str(r.engineSec["dmg type"]) || "piercing";
  // Case 138 — sound type
  out["t sound type"] = str(r.engineSec["sound type"]) || "none";
  // Case 140 — min delay
  out["t min delay"] = num(r.engineSec["min delay"], 0);
  // Case 141 — lethality (always 1 on RTW/ALX)
  out["t lethality"] = 1;
  // Case 145 — AP
  if (str(r.engineSec["AP"]) === "Y") out["t ap"] = "ap";
  // Case 146 — BP
  if (str(r.engineSec["BP"]) === "Y") out["t bp"] = "bp";
  // Case 152 — launch
  if (str(r.engineSec["launch"]) === "Y") out["t launch"] = "launching";
  // Case 153 — area
  if (str(r.engineSec["area"]) === "Y") out["t area"] = "area";

  return out;
}

export { computeTertiary };
