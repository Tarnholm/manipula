// xlsmSchema.js — authoritative v2.6 EDU-matic workbook schema.
//
// Only hardcodes information the workbook's defined-name list doesn't carry:
// the header-row and the corrected last-row for each table (several of the
// workbook's *Range defined names extend one row into the next section; the
// matching *RangeNames ranges are tight, so we use those bounds here).
//
// Global variables, faction tags, and per-table column headers are all
// resolved at import time from the workbook itself — so when a newer
// EDU-matic adds a new global or faction, no code change here is needed.
//
// CommonJS on purpose (matches Provincia): Node's require() consumes it
// directly, and Vite interops when the renderer uses `import ... from`.

/**
 * @typedef {Object} TableSpec
 * @property {string} name         key under coreData in the project
 * @property {string} sheet        worksheet name
 * @property {number} headerRow    1-based row containing column headers
 * @property {number} firstRow     1-based first data row
 * @property {number} lastRow      1-based last data row (inclusive)
 * @property {string} firstCol     column letter of name / first data col
 * @property {string} lastCol      column letter of last data col
 */

/** @type {TableSpec[]} */
const TABLE_SPECS = [
  { name: "recruitmentClasses", sheet: "CoreData", headerRow: 57,  firstRow: 58,  lastRow: 63,  firstCol: "B", lastCol: "O"  },
  { name: "qualityClasses",     sheet: "CoreData", headerRow: 64,  firstRow: 65,  lastRow: 115, firstCol: "B", lastCol: "Y"  },
  { name: "categories",         sheet: "CoreData", headerRow: 118, firstRow: 119, lastRow: 127, firstCol: "B", lastCol: "Q"  },
  { name: "specialties",        sheet: "CoreData", headerRow: 129, firstRow: 130, lastRow: 171, firstCol: "B", lastCol: "W"  },
  { name: "dwellings",          sheet: "CoreData", headerRow: 172, firstRow: 173, lastRow: 184, firstCol: "B", lastCol: "M"  },
  { name: "cultures",           sheet: "CoreData", headerRow: 185, firstRow: 186, lastRow: 199, firstCol: "B", lastCol: "AI" },
  { name: "formations",         sheet: "CoreData", headerRow: 202, firstRow: 203, lastRow: 218, firstCol: "B", lastCol: "N"  },
  { name: "weapons",            sheet: "CoreData", headerRow: 221, firstRow: 222, lastRow: 277, firstCol: "B", lastCol: "AF" },
  { name: "projectiles",        sheet: "CoreData", headerRow: 280, firstRow: 281, lastRow: 312, firstCol: "B", lastCol: "U"  },

  { name: "armourAttributes",   sheet: "CoreData", headerRow: 315, firstRow: 316, lastRow: 318, firstCol: "B", lastCol: "Q"  },
  { name: "armourHead",         sheet: "CoreData", headerRow: 319, firstRow: 320, lastRow: 332, firstCol: "B", lastCol: "Q"  },
  { name: "armourTorso",        sheet: "CoreData", headerRow: 333, firstRow: 334, lastRow: 354, firstCol: "B", lastCol: "Q"  },
  { name: "armourUpperArm",     sheet: "CoreData", headerRow: 355, firstRow: 356, lastRow: 359, firstCol: "B", lastCol: "Q"  },
  { name: "armourLowerArm",     sheet: "CoreData", headerRow: 360, firstRow: 361, lastRow: 363, firstCol: "B", lastCol: "Q"  },
  { name: "armourHand",         sheet: "CoreData", headerRow: 364, firstRow: 365, lastRow: 367, firstCol: "B", lastCol: "Q"  },
  { name: "armourUpperLeg",     sheet: "CoreData", headerRow: 368, firstRow: 369, lastRow: 371, firstCol: "B", lastCol: "Q"  },
  { name: "armourLowerLeg",     sheet: "CoreData", headerRow: 372, firstRow: 373, lastRow: 376, firstCol: "B", lastCol: "Q"  },
  { name: "armourFoot",         sheet: "CoreData", headerRow: 377, firstRow: 378, lastRow: 381, firstCol: "B", lastCol: "R"  },
  { name: "armourMaterials",    sheet: "CoreData", headerRow: 382, firstRow: 383, lastRow: 405, firstCol: "B", lastCol: "H"  },

  { name: "shieldSizes",        sheet: "CoreData", headerRow: 408, firstRow: 409, lastRow: 416, firstCol: "B", lastCol: "G"  },
  { name: "shieldMaterials",    sheet: "CoreData", headerRow: 417, firstRow: 418, lastRow: 423, firstCol: "B", lastCol: "F"  },

  { name: "weaponQualities",    sheet: "CoreData", headerRow: 426, firstRow: 427, lastRow: 430, firstCol: "B", lastCol: "D"  },

  { name: "mounts",             sheet: "CoreData", headerRow: 433, firstRow: 434, lastRow: 444, firstCol: "B", lastCol: "O"  },
  { name: "specialMounts",      sheet: "CoreData", headerRow: 445, firstRow: 446, lastRow: 452, firstCol: "B", lastCol: "AF" },
  { name: "engines",            sheet: "CoreData", headerRow: 453, firstRow: 454, lastRow: 460, firstCol: "B", lastCol: "J"  },
  { name: "engineProjectiles",  sheet: "CoreData", headerRow: 461, firstRow: 462, lastRow: 467, firstCol: "B", lastCol: "N"  },
  { name: "ships",              sheet: "CoreData", headerRow: 468, firstRow: 469, lastRow: 477, firstCol: "B", lastCol: "J"  },

  { name: "meleeSkeletons",     sheet: "CoreData", headerRow: 480, firstRow: 481, lastRow: 512, firstCol: "B", lastCol: "D"  },
  { name: "mountSkeletons",     sheet: "CoreData", headerRow: 480, firstRow: 481, lastRow: 497, firstCol: "F", lastCol: "H"  },
];

// v2.6 ends at HG (215); v0.7.0 extends to ZD (680) with pre-built
// ownership strings around col 359-360 and ethnicity blocks further out.
// Reading the wider range costs a little memory but handles both.
const UNIT_DEFS   = { sheet: "UnitDefinitions",  headerRow: 2, firstRow: 3, lastCol: "ZD" };
const ARMOUR_DEFS = { sheet: "ArmourDefinitions", headerRow: 1, firstRow: 2, lastCol: "AL" };
const MERC_DEFS   = { sheet: "Merc Definitions", headerRow: 2, firstRow: 3, lastCol: "X"  };
const HEADER      = { sheet: "Header", col: "A", maxRows: 100 };

export { TABLE_SPECS, UNIT_DEFS, ARMOUR_DEFS, MERC_DEFS, HEADER };
