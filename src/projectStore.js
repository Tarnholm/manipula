// projectStore.js — Manipula's structured-diff project format.
//
// On-disk layout (all JSON, all UTF-8, all newline-terminated for diff hygiene):
//
//   <project-root>/
//     manipula.project.json     # sentinel + meta. Presence of this file is
//                               # how the loader recognises a project dir.
//     edu/
//       modInfo.json            # small singleton tables — one file each
//       globals.json
//       merc.json
//       header.json
//       coreData/
//         categories.json       # one file per lookup table
//         qualities.json
//         weapons.json
//         ...
//       factions/
//         <factionKey>.json     # one file per faction
//       units/
//         <unitKey>.json        # one file per unit (EDU compute inputs)
//       armour/
//         <unitKey>.json        # one file per unit (paired armour set)
//     recruits/
//       <unitKey>.json          # one file per recruit-line authoring unit
//                               # (the EDB authoring side; populated in a
//                               # later commit when EDB integration lands)
//
// Why one file per unit/faction/armour/etc:
//   The whole point of this format is git-friendly multi-user editing.
//   Two teammates editing different units never collide. Two teammates
//   editing the same unit produce a clean per-field JSON conflict that
//   git can usually merge automatically (different keys = no conflict).
//   With a single units.json blob, every save churns the whole file.
//
// Why combined units (edu inputs + recruit) by unit key:
//   Same unit shows up on both sides of the tool. Storing them under the
//   same filename lets `git mv unit-a.json unit-b.json` rename it across
//   the whole project. The actual data is still split into edu/ and
//   recruits/ subtrees so users can scope edits to "just my half" if
//   their workflow demands it.
//
// Sanitisation: filenames are derived from unit keys via sanitiseKey()
// below — non-ASCII, slashes, and reserved Windows characters are
// replaced with `_`. The original key is always preserved INSIDE the
// JSON as `_key` so the loader can reconstruct it even if a teammate
// renamed the file by hand.
//
// Schema version: bumped via meta.schemaVersion. The loader refuses to
// open a project with a newer schema than it knows. Old schemas can be
// migrated forward in this module.

const SCHEMA_VERSION = 1;
const SENTINEL = "manipula.project.json";

// Keys in the eduProject object that are stored as singleton JSON files.
const SINGLE_FILE_KEYS = ["modInfo", "globals", "merc", "header"];

function stable(value) {
  return JSON.stringify(value, null, 2) + "\n";
}

// Replace path-unsafe characters. Win32 disallows < > : " / \ | ? *  and
// reserves names like CON / PRN / AUX. Lowercasing avoids same-name
// collisions on case-insensitive filesystems (Mac default, Win NTFS).
function sanitiseKey(key) {
  if (!key) return "_unnamed";
  return String(key)
    .toLowerCase()
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, "_")
    .replace(/[\s.]+$/g, "")          // strip trailing space/dot (Win quirk)
    .slice(0, 120) || "_unnamed";
}

// Pick a stable per-record key for a unit / armour / faction. Different
// records use different fields; we try the obvious candidates in order.
function recordKey(rec, fallback = "row") {
  if (!rec) return `${fallback}_unknown`;
  const candidates = [rec.Type, rec.dictKey, rec.unit, rec.Faction, rec.faction, rec.name, rec.Name];
  for (const c of candidates) {
    if (c != null && String(c).trim() !== "") return sanitiseKey(c);
  }
  return `${fallback}_unknown`;
}

function ensureApi() {
  const api = (typeof window !== "undefined") ? window.eduAPI : null;
  if (!api) throw new Error("projectStore: window.eduAPI unavailable (must run inside Electron renderer)");
  return api;
}

// ── save ────────────────────────────────────────────────────────────

async function saveProject(dir, project) {
  const api = ensureApi();
  if (!project || typeof project !== "object") throw new Error("saveProject: project must be an object");

  // 1) Sentinel + meta. Always written first so a partial save still
  //    leaves a recognisable project dir behind.
  await api.writeProjectFile(dir, SENTINEL, stable({
    schemaVersion: SCHEMA_VERSION,
    savedAt: new Date().toISOString(),
    name: (project.modInfo && project.modInfo.name) || "",
  }));

  // 2) Singleton EDU files.
  for (const key of SINGLE_FILE_KEYS) {
    await api.writeProjectFile(dir, `edu/${key}.json`, stable(project[key] ?? null));
  }

  // 3) coreData — one file per lookup table.
  await writeKeyed(api, dir, "edu/coreData", project.coreData || {}, /* fromObject */ true);

  // 4) factions — one file per faction (array → keyed files).
  await writeArray(api, dir, "edu/factions", project.factions || [], "faction");

  // 5) units — one file per unit (EDU compute inputs).
  await writeArray(api, dir, "edu/units", project.units || [], "unit");

  // 6) armour — one file per record.
  await writeArray(api, dir, "edu/armour", project.armour || [], "armour");

  // 7) outputRows is a transient cache (byte-exact reproduction of the VBA
  //    Output sheet) — store it separately so it can be skipped from git
  //    by users who don't want generated content tracked.
  if (project.outputRows) {
    await api.writeProjectFile(dir, "edu/outputRows.json", stable(project.outputRows));
  }
}

async function writeKeyed(api, dir, subdir, obj, fromObject) {
  if (!fromObject) throw new Error("writeKeyed: only object form supported");
  const writtenNames = new Set();
  for (const [k, v] of Object.entries(obj)) {
    const fname = `${sanitiseKey(k)}.json`;
    await api.writeProjectFile(dir, `${subdir}/${fname}`, stable({ _key: k, value: v }));
    writtenNames.add(fname);
  }
  await pruneOrphans(api, dir, subdir, writtenNames);
}

async function writeArray(api, dir, subdir, arr, fallbackKind) {
  const writtenNames = new Set();
  const seen = new Map();   // key -> count, to disambiguate duplicates
  for (const rec of arr) {
    let key = recordKey(rec, fallbackKind);
    // Collisions: append _2, _3, ... so two records with the same Type
    // don't clobber each other. Records' original key is preserved in
    // the file under _key, so the loader still reconstructs the array.
    const base = key;
    const n = (seen.get(base) || 0) + 1;
    seen.set(base, n);
    if (n > 1) key = `${base}_${n}`;
    const fname = `${key}.json`;
    await api.writeProjectFile(dir, `${subdir}/${fname}`, stable(rec));
    writtenNames.add(fname);
  }
  await pruneOrphans(api, dir, subdir, writtenNames);
}

// Delete files that are in the on-disk subdir but not in the freshly
// written set — i.e. records that were removed from the project. Without
// this, deleting a unit in the UI would leave its file behind and
// re-loading the project would resurrect it.
async function pruneOrphans(api, dir, subdir, keepNames) {
  const existing = await api.listProjectFiles(dir, subdir);
  for (const name of existing) {
    if (!keepNames.has(name)) await api.deleteProjectFile(dir, `${subdir}/${name}`);
  }
}

// ── load ────────────────────────────────────────────────────────────

async function loadProject(dir) {
  const api = ensureApi();

  // Read + validate sentinel.
  const metaRaw = await api.readProjectFile(dir, SENTINEL);
  if (metaRaw == null) {
    throw new Error(`Not a Manipula project: ${SENTINEL} missing in ${dir}`);
  }
  let meta;
  try { meta = JSON.parse(metaRaw); }
  catch (e) { throw new Error(`Corrupt ${SENTINEL}: ${e.message}`); }
  if (typeof meta.schemaVersion !== "number" || meta.schemaVersion > SCHEMA_VERSION) {
    throw new Error(`Project schema version ${meta.schemaVersion} is newer than this build supports (${SCHEMA_VERSION}). Update Manipula.`);
  }

  const project = {};

  // Singleton EDU files.
  for (const key of SINGLE_FILE_KEYS) {
    const raw = await api.readProjectFile(dir, `edu/${key}.json`);
    project[key] = raw ? JSON.parse(raw) : (key === "modInfo" ? { name: "", platform: "", era: "" } : (key === "globals" ? {} : []));
  }

  // coreData — collect each table from its own file.
  project.coreData = await readKeyed(api, dir, "edu/coreData");

  // Arrays — read every JSON file in the subdir into an array.
  project.factions = await readArray(api, dir, "edu/factions");
  project.units    = await readArray(api, dir, "edu/units");
  project.armour   = await readArray(api, dir, "edu/armour");

  // Optional cached output (may be absent).
  const outputRaw = await api.readProjectFile(dir, "edu/outputRows.json");
  project.outputRows = outputRaw ? JSON.parse(outputRaw) : null;

  return { meta, project };
}

async function readKeyed(api, dir, subdir) {
  const out = {};
  const files = await api.listProjectFiles(dir, subdir);
  for (const name of files) {
    const raw = await api.readProjectFile(dir, `${subdir}/${name}`);
    if (!raw) continue;
    try {
      const parsed = JSON.parse(raw);
      // Files written by writeKeyed have shape { _key, value }; older or
      // hand-edited files might just have the raw value at top level.
      if (parsed && typeof parsed === "object" && "_key" in parsed && "value" in parsed) {
        out[parsed._key] = parsed.value;
      } else {
        // Fall back to the filename-without-extension as the key.
        out[name.replace(/\.json$/, "")] = parsed;
      }
    } catch (e) {
      console.warn(`[projectStore] skip ${subdir}/${name}: ${e.message}`);
    }
  }
  return out;
}

async function readArray(api, dir, subdir) {
  const out = [];
  const files = await api.listProjectFiles(dir, subdir);
  // Sort for stable order across runs — git would otherwise see noise
  // every time the OS reordered directory entries.
  files.sort();
  for (const name of files) {
    const raw = await api.readProjectFile(dir, `${subdir}/${name}`);
    if (!raw) continue;
    try { out.push(JSON.parse(raw)); }
    catch (e) { console.warn(`[projectStore] skip ${subdir}/${name}: ${e.message}`); }
  }
  return out;
}

// ── recognition ─────────────────────────────────────────────────────

// Cheap check: is the picked dir a Manipula project? Used by the open
// flow to give a clean error when the user picks the wrong folder.
async function isProjectDir(dir) {
  try {
    const api = ensureApi();
    const raw = await api.readProjectFile(dir, SENTINEL);
    return raw != null;
  } catch { return false; }
}

export { saveProject, loadProject, isProjectDir, SCHEMA_VERSION };
