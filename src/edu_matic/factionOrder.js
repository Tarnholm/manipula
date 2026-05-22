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
 * Sort + clean a list of faction tags for output: dedupe (case-insensitive,
 * first occurrence wins), order canonically, and force "slave" to the very
 * end (it's a real tag in the canonical list, but non-canonical tags would
 * otherwise sort past it). Shared by ownership strings and ethnicity lines
 * so both stay clean.
 * @param {string[]} tags
 * @returns {string[]}
 */
export function cleanFactionList(tags, excludeSet) {
  // Order by the canonical EDU faction list (EDU_FACTION_ORDER), dedupe,
  // drop excluded placeholder factions, slave last. The canonical list is
  // the authoritative order the mod team wants — the project's own
  // Faction1..N globals can be scrambled (Faction1 ended up = Kydonia in
  // one project), so we sort by the canonical list rather than trust the
  // raw faction-list order. Tags not in the canonical list keep their
  // incoming relative order and fall after the known ones, before slave.
  const seen = new Set();
  const uniq = [];
  for (const t of tags) {
    const s = String(t || "").trim();
    if (!s) continue;
    const lc = s.toLowerCase();
    if (excludeSet && excludeSet.has(lc)) continue;   // placeholder / culture-group faction
    if (seen.has(lc)) continue;
    seen.add(lc);
    uniq.push(s);
  }
  const slaves = uniq.filter((t) => t.toLowerCase() === "slave");
  const rest = uniq.filter((t) => t.toLowerCase() !== "slave");
  return [...sortByEduFactionOrder(rest), ...slaves];
}

/**
 * Build the faction-exclude Set for a project: the built-in defaults
 * (culture umbrellas / placeholder / rebel slots) UNION any extra tags
 * from the EthnicityExcludeFactions global (comma-separated). Used for
 * BOTH the ethnicity block and the ownership line so neither references
 * a non-recruiting faction. Tags are lowercased.
 * @param {string|undefined} globalValue project.globals.EthnicityExcludeFactions
 * @returns {Set<string>}
 */
export function buildExcludeSet(globalValue) {
  const set = new Set(DEFAULT_ETHNICITY_EXCLUDE.map((s) => s.toLowerCase()));
  if (typeof globalValue === "string" && globalValue.trim()) {
    for (const s of globalValue.split(",")) { const t = s.trim().toLowerCase(); if (t) set.add(t); }
  }
  return set;
}

/**
 * Reorder a comma-separated ownership string ("romans_julii, sparta, …")
 * into canonical order, de-duplicated, with slave last. Duplicates and a
 * misplaced slave were leaking into the EDU ownership line when the stored
 * string (or the faction list it was derived from) carried repeats.
 * @param {string} str
 * @returns {string}
 */
export function reorderOwnershipString(str, excludeSet) {
  if (!str) return str;
  const tags = String(str).split(",").map((t) => t.trim()).filter(Boolean);
  if (tags.length < 2 && !excludeSet) return tags.join(", ");
  return cleanFactionList(tags, excludeSet).join(", ");
}
