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
//
// `bundle` is the unified Manipula project: the EDU compute-inputs side
// (under bundle.eduProject) plus the EDB recruit-line authoring side
// (under bundle.units). Loading returns the same shape so callers can
// hand it off to the existing in-app state setters without translation.
//
// Optional `bundle.exports` carries the last-exported EDB/EDU hashes
// (see hashOfExport in this module) so subsequent exports can detect
// external edits to the game files and warn before clobbering them.

async function saveProject(dir, bundle) {
  const api = ensureApi();
  if (!bundle || typeof bundle !== "object") throw new Error("saveProject: bundle must be an object");
  const project = bundle.eduProject || {};

  // Build the entire write-list in renderer memory (cheap), then send it
  // to the main process as one batched IPC call. The previous version
  // did one IPC per file — fine for tens of files, fatal for thousands
  // (the renderer froze long enough that Chromium blanked the window).
  const writes = [];
  const pruneSubdirs = [];

  // 1) Sentinel + meta.
  writes.push({ relPath: SENTINEL, content: stable({
    schemaVersion: SCHEMA_VERSION,
    savedAt: new Date().toISOString(),
    name: (project.modInfo && project.modInfo.name) || "",
    exports: bundle.exports || {},
  })});

  // 2) Singleton EDU files.
  for (const key of SINGLE_FILE_KEYS) {
    writes.push({ relPath: `edu/${key}.json`, content: stable(project[key] ?? null) });
  }

  // 3) coreData — one file per lookup table (object → keyed files).
  collectKeyed(writes, "edu/coreData", project.coreData || {});
  pruneSubdirs.push("edu/coreData");

  // 4) factions, units, armour — one file per record (array → keyed files).
  collectArray(writes, "edu/factions", project.factions || [], "faction");
  pruneSubdirs.push("edu/factions");

  collectArray(writes, "edu/units", project.units || [], "unit");
  pruneSubdirs.push("edu/units");

  collectArray(writes, "edu/armour", project.armour || [], "armour");
  pruneSubdirs.push("edu/armour");

  // 5) recruit-line authoring (EDB side).
  collectArray(writes, "recruits", bundle.units || [], "recruit");
  pruneSubdirs.push("recruits");

  // 6) outputRows — transient cache, single file. Not pruned because
  //    it's the only file in its slot.
  if (project.outputRows) {
    writes.push({ relPath: "edu/outputRows.json", content: stable(project.outputRows) });
  }

  // Fast path: one IPC, main process writes everything synchronously.
  if (api.writeProjectBatch) {
    const r = await api.writeProjectBatch(dir, { writes, pruneSubdirs });
    if (!r || !r.ok) throw new Error("writeProjectBatch failed: " + (r && r.reason));
    return;
  }

  // Fallback for older builds — sequential per-file. Slow but works.
  for (const w of writes) {
    await api.writeProjectFile(dir, w.relPath, w.content);
  }
}

function collectKeyed(writes, subdir, obj) {
  for (const [k, v] of Object.entries(obj)) {
    const fname = `${sanitiseKey(k)}.json`;
    writes.push({ relPath: `${subdir}/${fname}`, content: stable({ _key: k, value: v }) });
  }
}

function collectArray(writes, subdir, arr, fallbackKind) {
  const seen = new Map();
  for (const rec of arr) {
    let key = recordKey(rec, fallbackKind);
    const base = key;
    const n = (seen.get(base) || 0) + 1;
    seen.set(base, n);
    if (n > 1) key = `${base}_${n}`;
    writes.push({ relPath: `${subdir}/${key}.json`, content: stable(rec) });
  }
}

// ── load ────────────────────────────────────────────────────────────

async function loadProject(dir) {
  const api = ensureApi();

  // Fast path: one IPC, main process slurps every .json file in the
  // managed subdirs and returns them as { relPath, content } pairs.
  // Renderer parses + sorts in memory.
  let allFiles = null;
  if (api.readProjectBatch) {
    const r = await api.readProjectBatch(dir);
    if (!r || !r.ok) throw new Error("readProjectBatch failed: " + (r && r.reason));
    allFiles = r.files;
  } else {
    // Fallback (older builds without batch IPC) — fall through to the
    // per-file load below by setting allFiles to null.
  }

  // Validate sentinel.
  let metaRaw = null;
  if (allFiles) {
    const sentinel = allFiles.find(f => f.relPath === SENTINEL);
    metaRaw = sentinel ? sentinel.content : null;
  } else {
    metaRaw = await api.readProjectFile(dir, SENTINEL);
  }
  if (metaRaw == null) {
    throw new Error(`Not a Manipula project: ${SENTINEL} missing in ${dir}`);
  }
  let meta;
  try { meta = JSON.parse(metaRaw); }
  catch (e) { throw new Error(`Corrupt ${SENTINEL}: ${e.message}`); }
  if (typeof meta.schemaVersion !== "number" || meta.schemaVersion > SCHEMA_VERSION) {
    throw new Error(`Project schema version ${meta.schemaVersion} is newer than this build supports (${SCHEMA_VERSION}). Update Manipula.`);
  }

  // Group files by subdir for the parsers below.
  const indexed = new Map(); // subdir -> [{name, content}]
  if (allFiles) {
    for (const f of allFiles) {
      const slash = f.relPath.lastIndexOf("/");
      const sub = slash >= 0 ? f.relPath.slice(0, slash) : "";
      const name = slash >= 0 ? f.relPath.slice(slash + 1) : f.relPath;
      if (!indexed.has(sub)) indexed.set(sub, []);
      indexed.get(sub).push({ name, content: f.content });
    }
    for (const list of indexed.values()) list.sort((a, b) => a.name.localeCompare(b.name));
  }

  const project = {};

  // Singleton EDU files. Defaults applied both when the file is missing
  // AND when the file contains the literal JSON `null` — which is what
  // the v0.20.0 saver wrote for any singleton that happened to be
  // undefined at save time. Without this, `project.modInfo` came back
  // as null and downstream code that does `eduProject.modInfo.name`
  // crashed React at mount, producing the white-marble (background-only)
  // symptom on launch.
  const SINGLETON_DEFAULTS = {
    modInfo: { name: "", platform: "", era: "" },
    globals: {},
    merc: [],
    header: [],
  };
  for (const key of SINGLE_FILE_KEYS) {
    const raw = pickFile(indexed, "edu", `${key}.json`)
      ?? (allFiles ? null : await api.readProjectFile(dir, `edu/${key}.json`));
    let parsed = null;
    if (raw) {
      try { parsed = JSON.parse(raw); }
      catch (e) { console.warn(`[projectStore] corrupt edu/${key}.json: ${e.message}`); }
    }
    project[key] = (parsed == null) ? SINGLETON_DEFAULTS[key] : parsed;
  }

  project.coreData = parseKeyedFromIndex(indexed, "edu/coreData");
  project.factions = parseArrayFromIndex(indexed, "edu/factions");
  project.units    = parseArrayFromIndex(indexed, "edu/units");
  project.armour   = parseArrayFromIndex(indexed, "edu/armour");

  const outputRaw = pickFile(indexed, "edu", "outputRows.json")
    ?? (allFiles ? null : await api.readProjectFile(dir, "edu/outputRows.json"));
  project.outputRows = outputRaw ? JSON.parse(outputRaw) : null;

  const units = parseArrayFromIndex(indexed, "recruits");

  return { meta, eduProject: project, units, exports: meta.exports || {} };
}

function pickFile(indexed, subdir, name) {
  const list = indexed.get(subdir);
  if (!list) return null;
  const f = list.find(x => x.name === name);
  return f ? f.content : null;
}

function parseKeyedFromIndex(indexed, subdir) {
  const out = {};
  const list = indexed.get(subdir) || [];
  for (const f of list) {
    try {
      const parsed = JSON.parse(f.content);
      if (parsed && typeof parsed === "object" && "_key" in parsed && "value" in parsed) {
        out[parsed._key] = parsed.value;
      } else {
        out[f.name.replace(/\.json$/, "")] = parsed;
      }
    } catch (e) { console.warn(`[projectStore] skip ${subdir}/${f.name}: ${e.message}`); }
  }
  return out;
}

function parseArrayFromIndex(indexed, subdir) {
  const out = [];
  const list = indexed.get(subdir) || [];
  for (const f of list) {
    try { out.push(JSON.parse(f.content)); }
    catch (e) { console.warn(`[projectStore] skip ${subdir}/${f.name}: ${e.message}`); }
  }
  return out;
}

// ── export hashing ──────────────────────────────────────────────────
//
// Used by the EDB / EDU write-back paths to detect "the file changed
// under us since we last exported" — the moral equivalent of a stale
// optimistic-lock. djb2-style 53-bit hash is enough for change
// detection; we don't need cryptographic strength here. Using a small
// hand-rolled hash keeps this module browser-only with no Node crypto
// dependency.

function hashOfText(text) {
  if (typeof text !== "string") text = String(text ?? "");
  let h = 5381;
  for (let i = 0; i < text.length; i++) {
    h = ((h << 5) + h + text.charCodeAt(i)) | 0;
  }
  // Convert to unsigned 32-bit hex for stable on-disk representation.
  return (h >>> 0).toString(16).padStart(8, "0");
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

export { saveProject, loadProject, isProjectDir, hashOfText, SCHEMA_VERSION };
