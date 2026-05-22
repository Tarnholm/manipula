// factionOrder.js — canonical faction ordering for the EDU side.
//
// The mod team wants faction availability columns (EDU Builder → Units)
// and the EDU ownership output to ALWAYS list factions in this exact
// order, regardless of the order the xlsm's Faction1..N defined names
// happen to be in. "slave" is always last. Any faction tag not in this
// list sorts to the end (after slave is special-cased out), keeping its
// relative order so a newly-added faction is still visible rather than
// silently dropped.

export const EDU_FACTION_ORDER = [
  "sparta", "galatians", "romans_julii", "carthage", "massylii", "arevaci",
  "greeks", "antigonid", "ptolemaic", "seleucid", "pontus", "parni",
  "armenia", "arverni", "trinovantes", "suebi", "getae", "odrysians",
  "siraces", "pergamon", "bosporan", "achaea", "aetolia", "athens",
  "massalia", "rhodes", "syracuse", "bactria", "boeotia", "cyrene",
  "epirus", "saka", "lusitani", "edeta", "masaesyli", "volcae",
  "allobroges", "aedui", "belgae", "insubres", "boii", "scordisci",
  "tylis", "bithynia", "chatti", "lugii", "cimbri", "ardiaei",
  "cappadocia", "atropatene", "nabataea", "saba", "kush", "mauryan",
  "seleucid_rebels", "seleucid_rebels2", "ptolemaic_rebels", "egypt",
  "hellenistic_rebels", "chrysaoria", "lycia", "lysiad", "indians",
  "emporion", "acragas", "taras", "acarnania", "elis", "messene", "argos",
  "thessaly", "knossos", "gortyn", "lyttos", "megalopolis", "kydonia",
  "byzantium", "pentapolis", "histria", "chersonesus", "chios", "miletus",
  "priene", "cius", "sinope", "olbia", "cyzicus", "heraclea_pontica",
  "trapezus", "issa", "paeonia", "dentheletae", "maedi", "bessi", "cabyle",
  "asti", "triballi", "cilicians", "paphlagonia", "selge", "histri",
  "liburni", "iapodes", "delmatae", "daesitiates", "labeatae", "dardania",
  "illyrian_kingdom", "roman_rebels_1", "roman_rebels_2", "roman_senate",
  "volsinii", "picentes", "capua", "samnites", "lucanians", "messapians",
  "bruttians", "italics", "mamertines", "sardinians", "mauri", "garamantes",
  "musulamii", "nasamones", "asta", "basti", "ilici", "oretani", "celtici",
  "carpetani", "vettones", "gallaeci", "astures", "cantabri", "vaccaei",
  "vascones", "ilergetes", "lacetani", "sotiates", "salluvii", "sequani",
  "senones", "osismii", "veneti_gallia", "bituriges", "aulerci", "nervii",
  "eburones", "treveri", "ingauni", "apuani", "cenomani", "salassi",
  "veneti", "vindelici", "norici", "taurisci", "eravisci", "anartes",
  "helvetii", "ubii", "tencteri", "usipetes", "catuvellauni", "durotriges",
  "dumnonii", "silures", "ordovices", "brigantes", "caledonii", "frisii",
  "sugambri", "chauci", "cherusci", "langobardi", "hermunduri", "marcomanni",
  "quadi", "bastarnae", "gauts", "buri", "crobyzi", "costoboci",
  "royal_scythians", "royal_sarmatians", "aorsi", "iazyges", "rhoxolani",
  "chorasmia", "scythians", "arshi", "kucha", "armenia_minor", "colchians",
  "iberians", "albanians", "sophene", "commagene", "arados", "tyre",
  "hasmonean", "osrhoene", "characene", "persis", "thamud", "lihyan",
  "minaeans", "qataban", "himyar", "hadhramaut", "gerrha", "libyans",
  "gades", "carmo", "arse", "belli", "corsi", "cadurci", "volcae_gallia",
  "cisalpine_boii", "breuni", "teurisci", "ambrones", "slave",
];

// Factions that exist in the faction list (for ownership / availability
// columns) but are NOT real recruiting factions, so they must never get
// per-faction `ethnicity` lines: culture-group umbrellas and placeholder
// / rebel slots. Used as the default for the editable
// EthnicityExcludeFactions global. Lowercase.
export const DEFAULT_ETHNICITY_EXCLUDE = [
  "greeks", "germanics", "gauls", "scythians", "hellenistic_rebels", "dummies",
  // rhaetians was renamed to breuni mod-wide; it lingers in some projects'
  // faction lists as a ghost (renamed before the full cascade existed), so
  // keep it out of ethnicity permanently.
  "rhaetians",
];

// Lowercased tag → rank. Built once at module load.
const RANK = new Map(EDU_FACTION_ORDER.map((f, i) => [f.toLowerCase(), i]));

function rankOf(tag) {
  const r = RANK.get(String(tag).toLowerCase());
  return r === undefined ? Number.POSITIVE_INFINITY : r;
}

/**
 * Sort an array of faction tags into the canonical order. Tags not in
 * the canonical list keep their incoming relative order and land at the
 * end (Array.prototype.sort is stable in modern V8 / Electron).
 * @param {string[]} tags
 * @returns {string[]} a new, sorted array
 */
export function sortByEduFactionOrder(tags) {
  return [...tags].sort((a, b) => rankOf(a) - rankOf(b));
}

/**
 * Reorder a comma-separated ownership string ("romans_julii, sparta, …")
 * into canonical order. Preserves the exact set of tags — only reorders
 * — so it's safe to run on output without changing which factions own a
 * unit. Whitespace around tags is trimmed; empties dropped.
 * @param {string} str
 * @returns {string}
 */
export function reorderOwnershipString(str) {
  if (!str) return str;
  const tags = String(str).split(",").map((t) => t.trim()).filter(Boolean);
  if (tags.length < 2) return tags.join(", ");
  return sortByEduFactionOrder(tags).join(", ");
}
