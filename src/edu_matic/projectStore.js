// projectStore.js — splits a Project into multiple JSON files on disk
// (diffable, team-shareable via git) and loads it back.
//
// Files:
//   modInfo.json, globals.json, factions.json, coreData.json,
//   units.json, armour.json, merc.json, header.json
//
// Split intentionally: one file per logical section so two people editing
// different parts don't conflict on the same 10k-line JSON.
//
// CommonJS so both Node scripts and Vite renderer can consume it.

const FILES = {
  modInfo:  "modInfo.json",
  globals:  "globals.json",
  factions: "factions.json",
  coreData: "coreData.json",
  units:    "units.json",
  armour:   "armour.json",
  merc:     "merc.json",
  header:   "header.json",
};

function stable(value) {
  return JSON.stringify(value, null, 2) + "\n";
}

/** @param {string} dir  @param {object} project */
async function saveProject(dir, project) {
  const write = pickWriter();
  for (const [key, file] of Object.entries(FILES)) {
    await write(dir, file, stable(project[key]));
  }
}

/** @param {string} dir  @returns {Promise<object>} */
async function loadProject(dir) {
  const read = pickReader();
  const project = {};
  for (const [key, file] of Object.entries(FILES)) {
    const text = await read(dir, file);
    project[key] = text ? JSON.parse(text) : defaultValueFor(key);
  }
  return project;
}

function defaultValueFor(key) {
  switch (key) {
    case "modInfo":  return { name: "", platform: "", era: "" };
    case "globals":  return {};
    case "factions": return [];
    case "coreData": return {};
    case "units":    return [];
    case "armour":   return [];
    case "merc":     return [];
    case "header":   return [];
    default:         return null;
  }
}

function pickWriter() {
  if (typeof window !== "undefined" && window.eduAPI) {
    return (dir, name, content) => window.eduAPI.writeProjectFile(dir, name, content);
  }
  return writeNode;
}
function pickReader() {
  if (typeof window !== "undefined" && window.eduAPI) {
    return (dir, name) => window.eduAPI.readProjectFile(dir, name);
  }
  return readNode;
}
// Node fallbacks unreachable in the recruitment-tool integration — eduAPI is always wired
// via the main process. Kept as stubs so webpack doesn't try to bundle node:fs / node:path.
async function writeNode() { throw new Error("writeNode unavailable in renderer"); }
async function readNode() { return null; }

export { saveProject, loadProject, FILES };
