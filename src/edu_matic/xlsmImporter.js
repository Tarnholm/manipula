// xlsmImporter.js — v2.6 EDU-matic workbook → structured Project.
//
// Pure JS, no Electron dependency. CommonJS so Node's require() and Vite's
// import both work — same style as Provincia's parsers.js.

import * as XLSX from "xlsx";
import { TABLE_SPECS, UNIT_DEFS, ARMOUR_DEFS, MERC_DEFS, HEADER } from "./xlsmSchema";

/**
 * @typedef {Object} Project
 * @property {Object}   modInfo    { name, platform, era }
 * @property {Object}   globals    named-range constants (ModName, UnitAttack, …)
 * @property {Object}   coreData   { recruitmentClasses, qualityClasses, … }
 * @property {string[]} factions   150 faction tags ordered by Faction1..Faction150
 * @property {Object[]} units      unit definitions (or comment/wip rows)
 * @property {Object[]} armour     armour model-set definitions
 * @property {Object[]} merc       mercenary-unit definitions
 * @property {string[]} header     free-form header lines (no terminator)
 */

// ── Helpers ─────────────────────────────────────────────────────────

function colLetter(n) {
  let s = "";
  while (n > 0) { s = String.fromCharCode(65 + ((n - 1) % 26)) + s; n = Math.floor((n - 1) / 26); }
  return s;
}
function colIndex(letters) {
  let n = 0;
  for (const ch of letters.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n;
}
function readCell(ws, row, col) {
  const addr = colLetter(col) + row;
  const cell = ws[addr];
  if (!cell) return undefined;
  const v = cell.v;
  if (v === null || v === undefined || v === "") return undefined;
  if (typeof v === "string") {
    // Preserve whitespace as-is — VBA reads cell values verbatim, and
    // some user-edited cells carry meaningful trailing spaces (e.g.
    // unit names like "Argyraspides " and pre-built ownership strings
    // like "seleucid, ..., lysiad, "). Only treat fully-blank cells as
    // undefined.
    if (v.trim() === "") return undefined;
    return v;
  }
  return v;
}
function readRow(ws, row, firstCol, lastCol) {
  const out = [];
  const a = colIndex(firstCol);
  const b = colIndex(lastCol);
  for (let c = a; c <= b; c++) out.push(readCell(ws, row, c));
  return out;
}

/** Single-cell defined-name resolution. Returns null for 2D ranges or
 *  names pointing at an unknown sheet. */
function resolveSingleName(wb, name) {
  const names = wb.Workbook && wb.Workbook.Names;
  if (!Array.isArray(names)) return null;
  const entry = names.find((n) => n.Name === name);
  if (!entry || !entry.Ref) return null;
  if (entry.Ref.includes(":")) return null;
  const m = entry.Ref.match(/^(?:'([^']+)'|([^!]+))!\$?([A-Z]+)\$?(\d+)$/);
  if (!m) return null;
  return { sheet: m[1] || m[2], col: m[3], row: parseInt(m[4], 10) };
}

/** Parse a 2D-range defined name into { sheet, firstCol, firstRow, lastCol, lastRow }.
 *  Returns null if the name is missing or single-cell. */
function resolveRange(wb, name) {
  const names = wb.Workbook && wb.Workbook.Names;
  if (!Array.isArray(names)) return null;
  const entry = names.find((n) => n.Name === name);
  if (!entry || !entry.Ref) return null;
  const m = entry.Ref.match(/^(?:'([^']+)'|([^!]+))!\$?([A-Z]+)\$?(\d+):\$?([A-Z]+)\$?(\d+)$/);
  if (!m) return null;
  return {
    sheet: m[1] || m[2],
    firstCol: m[3], firstRow: parseInt(m[4], 10),
    lastCol:  m[5], lastRow:  parseInt(m[6], 10),
  };
}

/** Given a TABLE_SPEC, try to resolve its bounds dynamically from the
 *  workbook's defined names (preferred) and fall back to hardcoded specs.
 *  Data row bounds come from the *RangeNames named range (tighter); column
 *  bounds come from the matching *Range named range (full width). */
const TABLE_RANGE_NAMES = {
  recruitmentClasses: ["RecrClassRange", "RecrClassRangeNames"],
  qualityClasses:     ["QualClassRange", "QualClassRangeNames"],
  categories:         ["CatCategoryRange", "CatCategoryRangeNames"],
  specialties:        ["SpecCategoryRange", "SpecCategoryRangeNames"],
  dwellings:          ["DwelCategoryRange", "DwelCategoryRangeNames"],
  cultures:           ["CultCategoryRange", "CultCategoryRangeNames"],
  formations:         ["FormationRange",    "FormationRangeNames"],
  weapons:            ["WeaponRange",       "WeaponRangeNames"],
  projectiles:        ["ProjectileRange",   "ProjectileRangeNames"],
  armourAttributes:   ["ArmourAttributeRange", null],
  armourHead:         ["ArmourTypeHeadRange",   null],
  armourTorso:        ["ArmourTypeTorsoRange",  null],
  armourUpperArm:     ["ArmourTypeUpArmRange",  null],
  armourLowerArm:     ["ArmourTypeLowArmRange", null],
  armourHand:         ["ArmourTypeHandRange",   null],
  armourUpperLeg:     ["ArmourTypeUpLegRange",  null],
  armourLowerLeg:     ["ArmourTypeLowLegRange", null],
  armourFoot:         ["ArmourTypeFootRange",   null],
  armourMaterials:    ["ArmourMatRange",        "ArmourMatRangeNames"],
  shieldSizes:        ["ShieldSizeRange",     "ShieldSizeRangeNames"],
  shieldMaterials:    ["ShieldMatRange",      "ShieldMatRangeNames"],
  weaponQualities:    ["QualityRange",        "QualityRangeNames"],
  mounts:             ["MountRange",          "MountRangeNames"],
  specialMounts:      ["SpMountRange",        "SpMountRangeNames"],
  engines:            ["EngineRange",         "EngineRangeNames"],
  engineProjectiles:  ["EngineProjRange",     "EngineProjRangeNames"],
  ships:              ["ShipRange",           "ShipRangeNames"],
  meleeSkeletons:     ["MeleeSkeletonRange",  "MeleeSkeletonRangeNames"],
  mountSkeletons:     ["MountSkeletonRange",  "MountSkeletonRangeNames"],
};

function resolveTableSpec(wb, fallback) {
  const pair = TABLE_RANGE_NAMES[fallback.name];
  if (!pair) return fallback;
  const rng     = resolveRange(wb, pair[0]);
  const namesR  = pair[1] ? resolveRange(wb, pair[1]) : null;
  if (!rng) return fallback;
  // Data rows prefer the tighter Names range; columns come from full range.
  const firstRow = namesR ? namesR.firstRow : rng.firstRow;
  const lastRow  = namesR ? namesR.lastRow  : rng.lastRow;
  return {
    name:      fallback.name,
    sheet:     rng.sheet,
    headerRow: firstRow - 1,
    firstRow,
    lastRow,
    firstCol:  rng.firstCol,
    lastCol:   rng.lastCol,
  };
}

// ── Section readers ─────────────────────────────────────────────────

function readTable(ws, spec) {
  const headers = readRow(ws, spec.headerRow, spec.firstCol, spec.lastCol)
    .map((h) => (h === undefined ? "" : String(h)));
  const rows = [];
  for (let r = spec.firstRow; r <= spec.lastRow; r++) {
    const vals = readRow(ws, r, spec.firstCol, spec.lastCol);
    if (!vals[0]) continue;
    const obj = {};
    for (let i = 0; i < headers.length; i++) {
      const key = headers[i];
      if (!key) continue;
      if (vals[i] !== undefined) obj[key] = vals[i];
    }
    rows.push(obj);
  }
  return rows;
}

/** Every non-range defined name → a global entry keyed by the name itself. */
function readGlobals(wb) {
  const out = {};
  const names = (wb.Workbook && wb.Workbook.Names) || [];
  for (const entry of names) {
    if (!entry || !entry.Ref) continue;
    if (entry.Ref.includes(":")) continue;
    const resolved = resolveSingleName(wb, entry.Name);
    if (!resolved) continue;
    const ws = wb.Sheets[resolved.sheet];
    if (!ws) continue;
    const v = readCell(ws, resolved.row, colIndex(resolved.col));
    if (v !== undefined) out[entry.Name] = v;
  }
  return out;
}

/** Read Faction1..FactionN from defined names, scanning up to 500 slots
 *  (v2.6 has 150, v0.7.0 has 320). Stops when ten consecutive FactionN
 *  defined names are missing in a row. */
function readFactions(wb) {
  const tags = [];
  let missStreak = 0;
  for (let i = 1; i <= 500; i++) {
    const resolved = resolveSingleName(wb, `Faction${i}`);
    if (!resolved) {
      missStreak++;
      if (missStreak >= 10 && tags.length > 0) break;
      tags.push(null);
      continue;
    }
    missStreak = 0;
    const ws = wb.Sheets[resolved.sheet];
    const v = ws ? readCell(ws, resolved.row, colIndex(resolved.col)) : undefined;
    tags.push(v === undefined ? null : v);
  }
  // Trim trailing nulls.
  while (tags.length && tags[tags.length - 1] === null) tags.pop();
  return tags;
}

function readModInfo(globals) {
  return {
    name:     globals.ModName     || "",
    platform: globals.ModPlatform || "",
    era:      globals.ModEra      || "",
  };
}

function readUnitDefs(ws, factions, factionQuantity) {
  const headers = readRow(ws, UNIT_DEFS.headerRow, "A", UNIT_DEFS.lastCol)
    .map((h) => (h === undefined ? "" : String(h)));
  // Determine where the faction-flag block starts. In v2.6 it's col 57
  // (right after "rec priority" at col 56); in v0.7.0 "rec priority"
  // moved to col 57, pushing factions to col 58. Detect by looking for
  // the first header that matches a faction tag.
  const factionSet = new Set(factions.filter(Boolean).map((t) => String(t).toLowerCase()));
  let factionFirstCol = 57;
  for (let i = 0; i < headers.length; i++) {
    const h = headers[i].toLowerCase();
    if (factionSet.has(h)) { factionFirstCol = i + 1; break; }
  }
  // Slave column sits right after the faction flags. Find it by header
  // since the faction count can be noisy (trailing nulls in the defined
  // names). Fall back to factionFirstCol + factions.length otherwise.
  let slaveCol = null;
  for (let i = factionFirstCol; i < headers.length; i++) {
    if (headers[i].toLowerCase() === "slave") { slaveCol = i + 1; break; }
  }
  if (!slaveCol) slaveCol = factionFirstCol + factions.length;
  const factionLastCol = slaveCol - 1;

  const units = [];
  for (let r = UNIT_DEFS.firstRow; ; r++) {
    const nameCell = readCell(ws, r, 1);
    // VBA's ParseUnitDefs (.research/v070/vba.txt L5804) loops
    // `Do Until Cells(ActiveRow, 1).Value = ""` — it stops at the FIRST
    // blank row in column A. Anything after that gap (e.g. a `#TEST
    // GROUP` section in this workbook at row 974) is invisible to VBA.
    // Mirror the cap exactly so we don't emit "test bench" units.
    if (nameCell === undefined) break;
    const name = String(nameCell);

    if (name.startsWith("#")) {
      units.push({ kind: "comment", row: r, text: name.slice(1).trim() });
      continue;
    }
    const isWip = name.startsWith("!");
    const cleanName = isWip ? name.slice(1).trim() : name;

    const vals = readRow(ws, r, "A", UNIT_DEFS.lastCol);
    const u = { kind: isWip ? "wip" : "unit", row: r, name: cleanName };

    // Faction flags + slave column handled as an ownership map; the
    // remaining columns are copied by header name. Bounds are dynamic:
    // factionFirstCol resolves to col 57 on v2.6 or col 58 on v0.7.0.
    for (let i = 1; i < headers.length; i++) {
      const colNum = i + 1;
      if (colNum >= factionFirstCol && colNum <= slaveCol) continue;
      const label = headers[i];
      if (!label) continue;
      if (vals[i] !== undefined) u[label] = vals[i];
    }

    // VBA caps faction iteration at FactionQuantity + 1 (.research/v070/
    // vba.txt L6354: `For ActiveColumn = 58 To 58 + FactionQuantity`).
    // With FactionQuantity = N, that reads cols 58..58+N → N+1 factions
    // (Faction1..Faction(N+1)). Anything past that is invisible to VBA
    // even if the user has Y-flagged it, so we mirror the cap exactly.
    // Falls back to the full column range when FactionQuantity is missing
    // (older workbooks without that named range).
    //
    // Per-faction availability (Y / M / "") is stored on the unit so the
    // ethnicity emitter can distinguish Factional ("Y") from Merc ("M").
    const ownership = {};
    const availability = {};   // tag → "Y" | "M" | other char
    const colCount = factionLastCol - factionFirstCol + 1;
    const cap = (typeof factionQuantity === "number" && factionQuantity > 0)
      ? factionQuantity + 1
      : colCount;
    const factionCount = Math.min(colCount, cap, factions.length);
    for (let k = 0; k < factionCount; k++) {
      const v = vals[factionFirstCol + k - 1];
      if (v === undefined) continue;
      const tag = factions[k];
      if (!tag) continue;
      ownership[tag] = true;
      availability[tag] = String(v);
    }
    if (vals[slaveCol - 1] !== undefined) {
      ownership.slave = true;
      availability.slave = String(vals[slaveCol - 1]);
    }
    u.ownership = ownership;
    u.availability = availability;

    // v0.7.0 stores pre-built ownership strings in columns
    //   slaveCol+1  Factional Ownership (VBA col 359)
    //   slaveCol+3  Merc Ownership       (VBA col 361) — col 360 is an
    //                                     unused filler between the two
    // so we read mercOwn with a gap of 1 between the fields.
    const factOwn = vals[slaveCol];        // 0-indexed → col slaveCol+1
    const mercOwn = vals[slaveCol + 2];    // 0-indexed → col slaveCol+3
    if (factOwn !== undefined) u.factionalOwnership = String(factOwn);
    if (mercOwn !== undefined) u.mercOwnership      = String(mercOwn);

    units.push(u);
  }
  return units;
}

// Armour-sheet columns use a repeating (instances, type, material) triplet
// per body-part slot, plus a 3-column shield block. Reading by header name
// loses information (duplicate "Material" headers collapse), so we parse
// positionally with this explicit layout.
// Columns (1-based):
//   1: Model Set Name
//   Body-part slots (triplet: instances, type, material):
//     2-4   Head1           17-19 UpArm
//     5-7   Head2            20-22 LowArm
//     8-10  Torso1           23-25 Hand
//     11-13 Torso2           26-28 UpLeg
//     14-16 Torso3           29-31 LowLeg
//                            32-34 Foot
//   Shield block (4 cols):
//     35 Shield size         36 On Back        37 Material
//                            (38 is blank/reserved)
const ARMOUR_SLOTS = [
  { slot: "Head1",   cols: [2,  3,  4]  },
  { slot: "Head2",   cols: [5,  6,  7]  },
  { slot: "Torso1",  cols: [8,  9,  10] },
  { slot: "Torso2",  cols: [11, 12, 13] },
  { slot: "Torso3",  cols: [14, 15, 16] },
  { slot: "UpArm",   cols: [17, 18, 19] },
  { slot: "LowArm",  cols: [20, 21, 22] },
  { slot: "Hand",    cols: [23, 24, 25] },
  { slot: "UpLeg",   cols: [26, 27, 28] },
  { slot: "LowLeg",  cols: [29, 30, 31] },
  { slot: "Foot",    cols: [32, 33, 34] },
];
const ARMOUR_SHIELD = { instancesCol: 35, sizeCol: 36, onBackCol: 37, materialCol: 38 };

function readArmourDefs(ws) {
  const rows = [];
  let blankStreak = 0;
  for (let r = ARMOUR_DEFS.firstRow; ; r++) {
    const name = readCell(ws, r, 1);
    if (name === undefined) {
      blankStreak++;
      if (blankStreak >= 5) break;
      continue;
    }
    blankStreak = 0;
    const obj = { row: r, "Model Set Name": String(name) };
    // body-part slots
    for (const { slot, cols } of ARMOUR_SLOTS) {
      const inst = readCell(ws, r, cols[0]);
      const type = readCell(ws, r, cols[1]);
      const mat  = readCell(ws, r, cols[2]);
      if (inst !== undefined || type !== undefined || mat !== undefined) {
        obj[slot] = {
          instances: inst !== undefined ? inst : null,
          type:      type !== undefined ? String(type) : null,
          material:  mat  !== undefined ? String(mat)  : null,
        };
      }
    }
    // shield block
    const sInst     = readCell(ws, r, ARMOUR_SHIELD.instancesCol);
    const sSize     = readCell(ws, r, ARMOUR_SHIELD.sizeCol);
    const sOnBack   = readCell(ws, r, ARMOUR_SHIELD.onBackCol);
    const sMaterial = readCell(ws, r, ARMOUR_SHIELD.materialCol);
    if (sInst !== undefined || sSize !== undefined || sOnBack !== undefined || sMaterial !== undefined) {
      obj.Shield = {
        instances: sInst     !== undefined ? sInst           : null,
        size:      sSize     !== undefined ? String(sSize)     : null,
        onBack:    sOnBack   !== undefined ? String(sOnBack)   : null,
        material:  sMaterial !== undefined ? String(sMaterial) : null,
      };
    }
    rows.push(obj);
  }
  return rows;
}

// Merc Definitions is not a standard table — it's a positional layout of
// pool / regions / unit lines that together define descr_mercenaries.txt.
// Column layout (1-based):
//   A(1):  "pool "/"regions "/"unit " keyword (the row's kind)
//   B(2):  primary value (pool name, regions list, or "unit_id,")
//   E(5):  exp
//   H(8):  cost (manual override; blank = auto-fill from EDU)
//   K(11): replenish min
//   N(14): replenish max
//   Q(17): max in pool
//   T(20): initial in pool
//   W(23): reference unit id for cost lookup
//   X(24): calibration / extra (multiplier-adjusted cost)
function readMercDefs(ws) {
  const rows = [];
  let blankStreak = 0;
  for (let r = MERC_DEFS.firstRow; r <= 1000; r++) {
    const keyword = readCell(ws, r, 1);
    const value   = readCell(ws, r, 2);
    const refUnit = readCell(ws, r, 23);
    if (keyword === undefined && value === undefined && refUnit === undefined) {
      blankStreak++;
      if (blankStreak >= 3) break;
      rows.push({ row: r, kind: "blank" });
      continue;
    }
    blankStreak = 0;
    const k = String(keyword || "").trim().toLowerCase();
    if (k === "pool") {
      rows.push({ row: r, kind: "pool", name: String(value || "").trim() });
    } else if (k === "regions") {
      rows.push({ row: r, kind: "regions", list: String(value || "").trim() });
    } else if (k === "unit") {
      rows.push({
        row: r, kind: "unit",
        // col B holds "unit_id," (trailing comma in the original); strip it.
        unitId:  String(value || "").replace(/,\s*$/, "").trim(),
        exp:     readCell(ws, r, 5),
        cost:    readCell(ws, r, 8),
        replenishMin: readCell(ws, r, 11),
        replenishMax: readCell(ws, r, 14),
        maxInPool:    readCell(ws, r, 17),
        initial:      readCell(ws, r, 20),
        refUnitId:    refUnit != null ? String(refUnit).trim() : null,
      });
    } else {
      // Something else (header/instruction row). Skip silently.
    }
  }
  // Trim trailing blanks.
  while (rows.length && rows[rows.length - 1].kind === "blank") rows.pop();
  return rows;
}

function readHeader(ws) {
  const lines = [];
  for (let r = 1; r <= HEADER.maxRows; r++) {
    const v = readCell(ws, r, colIndex(HEADER.col));
    if (typeof v === "string" && v.trim().toUpperCase() === "END") break;
    lines.push(v === undefined ? "" : String(v));
  }
  return lines;
}

// ── Public API ──────────────────────────────────────────────────────

/** Parse an xlsm buffer into a Project.
 *  @param {Buffer|Uint8Array|ArrayBuffer} buffer
 *  @returns {Project} */
function importXlsmBuffer(buffer) {
  const wb = XLSX.read(buffer, { type: "buffer", bookVBA: false, cellDates: false });

  const globals  = readGlobals(wb);
  const factions = readFactions(wb);
  const modInfo  = readModInfo(globals);

  const coreData = {};
  for (const fallbackSpec of TABLE_SPECS) {
    const spec = resolveTableSpec(wb, fallbackSpec);
    const ws = wb.Sheets[spec.sheet];
    if (!ws) throw new Error(`importXlsm: sheet "${spec.sheet}" not found`);
    coreData[spec.name] = readTable(ws, spec);
  }

  const unitsSheet = wb.Sheets[UNIT_DEFS.sheet];
  if (!unitsSheet) throw new Error(`importXlsm: sheet "${UNIT_DEFS.sheet}" not found`);
  // FactionQuantity (CoreData!$O$12 in v0.7.0) caps how many faction
  // slots VBA actually iterates. Without this, our tool reads Y/M flags
  // and ethnicity for faction slots that VBA ignores.
  const fqRaw = globals.FactionQuantity;
  const factionQuantity = (typeof fqRaw === "number") ? fqRaw : Number(fqRaw);
  const units = readUnitDefs(unitsSheet, factions, Number.isFinite(factionQuantity) ? factionQuantity : null);

  const armour = wb.Sheets[ARMOUR_DEFS.sheet] ? readArmourDefs(wb.Sheets[ARMOUR_DEFS.sheet]) : [];
  const merc   = wb.Sheets[MERC_DEFS.sheet]   ? readMercDefs(wb.Sheets[MERC_DEFS.sheet])     : [];
  const header = wb.Sheets[HEADER.sheet]      ? readHeader(wb.Sheets[HEADER.sheet])          : [];

  // If the workbook carries a cached "Output" sheet (populated by the VBA
  // pipeline) extract its rows so the renderer can emit the EDU directly
  // from it — a byte-exact reproduction of what the VBA tool produced,
  // bypassing any residual formula drift in our compute pipeline.
  const outputRows = wb.Sheets.Output ? readOutputSheet(wb.Sheets.Output) : null;

  return { modInfo, globals, factions, coreData, units, armour, merc, header, outputRows };
}

/** Read the Output worksheet into a dense row array. Each row is an
 *  array of cell values (strings); trailing empties are preserved so
 *  the caller can detect blank rows vs. empty-valued keyword rows. */
function readOutputSheet(ws) {
  const ref = ws["!ref"];
  if (!ref) return null;
  const m = ref.match(/^([A-Z]+)\d+:([A-Z]+)(\d+)$/);
  if (!m) return null;
  const lastCol = Math.min(colIndex(m[2]), 12);    // cap at column L
  const lastRow = parseInt(m[3], 10);
  const rows = [];
  for (let r = 1; r <= lastRow; r++) {
    const row = [];
    let anyValue = false;
    for (let c = 1; c <= lastCol; c++) {
      const cell = ws[colLetter(c) + r];
      let v = "";
      if (cell && cell.v !== null && cell.v !== undefined) {
        if (typeof cell.v === "number") {
          v = Number.isInteger(cell.v)
            ? String(cell.v)
            : String(+cell.v.toFixed(6)).replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "");
        } else {
          // Preserve trailing whitespace — the VBA-generated "ethnicity"
          // cells include a literal trailing space after the comma, and
          // dropping it breaks byte-exact reproduction. Only strip \r.
          v = String(cell.v).replace(/\r/g, "");
        }
      }
      if (v !== "") anyValue = true;
      row.push(v);
    }
    // Trim trailing empties, but keep at least one slot for blank rows
    while (row.length > 1 && row[row.length - 1] === "") row.pop();
    rows.push(row);
    // Stop scanning once we hit 200 consecutive all-blank rows (sheet
    // can extend far past the real data).
    if (!anyValue) {
      let blankRun = 0;
      for (let rr = rows.length - 1; rr >= 0 && rows[rr].every((v) => v === ""); rr--) blankRun++;
      if (blankRun > 200) { rows.length -= blankRun; break; }
    }
  }
  return rows;
}

// Node-side helper not used in the renderer; the main process reads the file and hands
// us a Uint8Array via window.eduAPI.readFileBinary instead.
function importXlsmFile() { throw new Error("importXlsmFile unavailable in renderer"); }

export { importXlsmBuffer, importXlsmFile };
