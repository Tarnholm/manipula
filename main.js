// main.js — Electron entrypoint for Manipula
const { app, BrowserWindow, dialog, ipcMain, session, protocol } = require("electron");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const { spawn } = require("child_process");
const { readEdumatic } = require("./xlsmReader");
const { autoUpdater } = require("electron-updater");

// Stable AppUserModelID — must match the appId in package.json AND stay constant across
// every update so Windows treats taskbar/Start-menu pinned shortcuts as the same app
// after an auto-update. Without this, electron picks a per-run AUMID and the pin breaks
// on every reinstall.
if (process.platform === "win32") {
  app.setAppUserModelId("com.tarnholm.recruitment-tool");
}

// Defensive load: if tgaDecode.js fails to load, log it but keep the app running. The
// rticon protocol just won't work — icons will fall back to placeholder.
let tgaFileToPng = null;
let decodeTgaToRgba = null;
try {
  const tgaMod = require("./tgaDecode");
  tgaFileToPng = tgaMod.tgaFileToPng;
  decodeTgaToRgba = tgaMod.decodeTga;
} catch (e) { console.error("[main] failed to load tgaDecode:", e); }

// ── Worker pool for parallel TGA decoding ──
// Spawn up to N worker_threads that each run tgaDecode + write the PNG to disk. The protocol
// handler dispatches jobs to the pool, so multiple icons decode on multiple cores at once.
// In-flight requests for the same cache path coalesce so we never decode the same TGA twice.
const { Worker } = require("worker_threads");
const POOL_SIZE = Math.max(2, Math.min(8, require("os").cpus().length));
let pool = null;
let nextWorkerIdx = 0;
let nextJobId = 1;
const inflight = new Map();      // jobId → { resolve, reject }
const pathPromises = new Map();  // cachePath → Promise resolving when that path is ready
function workerScriptPath() {
  // app.asar.unpacked when packaged (asarUnpack lifts the worker out of the asar so
  // worker_threads can spawn it reliably). __dirname falls back to dev-time.
  const unpacked = __dirname.replace(/app\.asar([\\/])/, "app.asar.unpacked$1");
  const candidates = [path.join(unpacked, "iconWorker.js"), path.join(__dirname, "iconWorker.js")];
  for (const c of candidates) if (fs.existsSync(c)) return c;
  return path.join(__dirname, "iconWorker.js");
}
function spawnPool() {
  if (pool) return pool;
  pool = [];
  const script = workerScriptPath();
  try {
    for (let i = 0; i < POOL_SIZE; i++) {
      const w = new Worker(script);
      w.on("message", (m) => {
        const h = inflight.get(m.id);
        if (!h) return;
        inflight.delete(m.id);
        m.ok ? h.resolve(true) : h.resolve(false);
      });
      w.on("error", (e) => {
        console.error("[iconWorker] crash:", e.message);
        // Reject only jobs assigned to *this* worker — but we don't track per-worker, so
        // reject everything so the renderer falls back. Renderer just shows placeholder.
        for (const [, h] of inflight) h.resolve(false);
        inflight.clear();
      });
      pool.push(w);
    }
  } catch (e) {
    console.error("[iconWorker] failed to spawn pool:", e);
    pool = [];
  }
  return pool;
}
function decodeTgaInPool(tgaPath, cachePath) {
  // Coalesce duplicate requests for the same cache path so concurrent icon mounts don't
  // queue the same decode N times.
  if (pathPromises.has(cachePath)) return pathPromises.get(cachePath);
  const p = new Promise((resolve) => {
    const list = spawnPool();
    if (!list.length) { resolve(false); return; }
    const id = nextJobId++;
    inflight.set(id, { resolve });
    const w = list[nextWorkerIdx];
    nextWorkerIdx = (nextWorkerIdx + 1) % list.length;
    try { w.postMessage({ id, tgaPath, cachePath }); }
    catch (e) { inflight.delete(id); resolve(false); }
  }).finally(() => { pathPromises.delete(cachePath); });
  pathPromises.set(cachePath, p);
  return p;
}

// Register the rticon:// scheme as privileged so the renderer can use it as a regular <img src=>.
// Must be called BEFORE app.whenReady(). Wrapped in try/catch so a registration error doesn't
// take down the whole main process.
try {
  protocol.registerSchemesAsPrivileged([
    { scheme: "rticon", privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, bypassCSP: true } },
  ]);
} catch (e) {
  console.error("[main] registerSchemesAsPrivileged failed:", e);
}

const isDev = !app.isPackaged;
const useDevServer = isDev && process.env.DEV_USE_SERVER === "1";
const devServerURL = process.env.DEV_SERVER_URL || "http://localhost:3000";

const DEFAULT_DATA_DIR = "C:\\RIS\\RIS\\data";

// ── Window ──
function applyContentSecurityPolicy() {
  const csp = [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "img-src 'self' data: rticon:",
    "font-src 'self' data: https://fonts.gstatic.com",
    "connect-src 'self' https://fonts.googleapis.com https://fonts.gstatic.com",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
  ].join("; ");
  session.defaultSession.webRequest.onHeadersReceived((details, cb) => {
    cb({ responseHeaders: { ...details.responseHeaders, "Content-Security-Policy": [csp] } });
  });
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1600,
    height: 1000,
    minWidth: 1280,
    minHeight: 720,
    backgroundColor: "#1a1a1a",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      preload: path.join(__dirname, "preload.js"),
    },
  });
  if (useDevServer) {
    process.env.ELECTRON_DISABLE_SECURITY_WARNINGS = "true";
    win.loadURL(devServerURL);
    win.webContents.openDevTools({ mode: "detach" });
  } else {
    win.loadFile(path.join(__dirname, "build", "index.html"));
  }
}

// ── Mod data dir helpers ──
const settingsPath = () => path.join(app.getPath("userData"), "settings.json");
function readSettings() {
  try { return JSON.parse(fs.readFileSync(settingsPath(), "utf8")); } catch { return {}; }
}
function writeSettings(obj) {
  try {
    const cur = readSettings();
    fs.writeFileSync(settingsPath(), JSON.stringify({ ...cur, ...obj }, null, 2), "utf8");
    return true;
  } catch { return false; }
}

function dataDir() {
  const s = readSettings();
  return s.dataDir || DEFAULT_DATA_DIR;
}

function unitsJsonPath() {
  // Legacy single-file location. Profiles live in profilesDir() instead; this is the migration source.
  return path.join(app.getPath("userData"), "units.json");
}

function profilesDir() {
  const d = path.join(app.getPath("userData"), "profiles");
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
  return d;
}

function profilePath(name) {
  // sanitize: strip path separators and bad chars
  const safe = String(name || "default").replace(/[\\/:*?"<>|]/g, "_").slice(0, 64);
  return path.join(profilesDir(), `${safe}.json`);
}

function activeProfileName() {
  const s = readSettings();
  return s.activeProfile || "default";
}

// ── Read text files (handle UTF-8 and UTF-16LE BOMs) ──
function readSmart(p) {
  const buf = fs.readFileSync(p);
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) {
    // UTF-16LE BOM
    return buf.slice(2).toString("utf16le");
  }
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) {
    return buf.slice(3).toString("utf8");
  }
  return buf.toString("utf8");
}

// ── IPC ──
ipcMain.handle("get-data-dir", async () => dataDir());

ipcMain.handle("set-data-dir", async (_e, dir) => {
  if (!dir || !fs.existsSync(dir)) return { ok: false, reason: "Directory does not exist" };
  writeSettings({ dataDir: dir });
  // Path-resolution cache is keyed by dataDir; clear so we don't return
  // stale paths after a folder switch.
  if (typeof clearResolveTgaCache === "function") clearResolveTgaCache();
  return { ok: true };
});

ipcMain.handle("pick-data-dir", async () => {
  const r = await dialog.showOpenDialog({
    properties: ["openDirectory"],
    title: "Select your mod's data folder (e.g. C:\\RIS\\RIS\\data)",
    defaultPath: dataDir(),
  });
  if (r.canceled || !r.filePaths.length) return null;
  writeSettings({ dataDir: r.filePaths[0] });
  return r.filePaths[0];
});

// Returns { ok, files: { edb, edu, factions, resources, regions, units, buildings, expandedBi, events, eventScripts: { ... } }, missing: [] }
ipcMain.handle("load-mod-files", async () => {
  const d = dataDir();
  const paths = {
    edb: path.join(d, "export_descr_buildings.txt"),
    edu: path.join(d, "export_descr_unit.txt"),
    factions: path.join(d, "descr_sm_factions.txt"),
    resources: path.join(d, "descr_sm_resources.txt"),
    regions: path.join(d, "world", "maps", "base", "descr_regions.txt"),
    strat: path.join(d, "world", "maps", "campaign", "imperial_campaign", "descr_strat.txt"),
    units: path.join(d, "text", "export_units.txt"),
    buildings: path.join(d, "text", "export_buildings.txt"),
    expandedBi: path.join(d, "text", "expanded_bi.txt"),
    events: path.join(d, "descr_sm_major_events.txt"),
    eventScriptsDir: path.join(d, "major_event_scripts"),
  };

  const out = { ok: true, dataDir: d, files: {}, missing: [] };
  for (const [k, p] of Object.entries(paths)) {
    if (k === "eventScriptsDir") continue;
    if (!fs.existsSync(p)) { out.missing.push(k); continue; }
    try {
      out.files[k] = readSmart(p);
    } catch (e) {
      out.missing.push(`${k}: ${e.message}`);
    }
  }
  // List event-script files (names only, no contents needed for reform list)
  try {
    if (fs.existsSync(paths.eventScriptsDir)) {
      out.files.eventScriptFiles = fs.readdirSync(paths.eventScriptsDir).filter(f => f.endsWith(".txt"));
    } else {
      out.files.eventScriptFiles = [];
    }
  } catch { out.files.eventScriptFiles = []; }
  return out;
});

// Write EDB back, with timestamped backup. RTW's parser requires Windows CRLF line endings, so
// normalize to \r\n on write — even if the in-memory content used LF.
ipcMain.handle("write-edb", async (_e, content) => {
  const d = dataDir();
  const target = path.join(d, "export_descr_buildings.txt");
  if (!fs.existsSync(target)) return { ok: false, reason: "EDB file not found at " + target };
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const bak = target + ".bak_" + stamp;
  try {
    fs.copyFileSync(target, bak);
    // Normalize all line endings to CRLF, regardless of what the renderer produced.
    const normalized = content.replace(/\r\n/g, "\n").replace(/\n/g, "\r\n");
    fs.writeFileSync(target, normalized, "utf8");
    return { ok: true, backup: bak };
  } catch (e) {
    return { ok: false, reason: e.message };
  }
});

// Read raw EDB (renderer asks when it's about to write back to be sure of latest content)
ipcMain.handle("read-edb", async () => {
  try { return readSmart(path.join(dataDir(), "export_descr_buildings.txt")); }
  catch (e) { return null; }
});

// Units — read/write the active profile. On first run, migrate legacy units.json → profile "default".
function migrateLegacyUnitsJson() {
  const legacy = unitsJsonPath();
  const def = profilePath("default");
  if (fs.existsSync(legacy) && !fs.existsSync(def)) {
    try { fs.copyFileSync(legacy, def); } catch {}
  }
}

ipcMain.handle("read-units", async () => {
  migrateLegacyUnitsJson();
  const p = profilePath(activeProfileName());
  try { return JSON.parse(fs.readFileSync(p, "utf8")); }
  catch { return { units: [] }; }
});

ipcMain.handle("write-units", async (_e, obj) => {
  const p = profilePath(activeProfileName());
  try {
    // Auto-backup: before overwriting the active profile, rotate the previous file into a
    // dated .bak so a save bug or accidental Reset to Reference doesn't lose the user's
    // hours of authoring. Keep the last 8 backups per profile, drop older ones.
    if (fs.existsSync(p)) {
      try {
        const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
        const bakDir = path.join(profilesDir(), "_backups");
        if (!fs.existsSync(bakDir)) fs.mkdirSync(bakDir, { recursive: true });
        const profileName = path.basename(p, ".json");
        fs.copyFileSync(p, path.join(bakDir, `${profileName}_${stamp}.json`));
        const all = fs.readdirSync(bakDir)
          .filter(f => f.startsWith(profileName + "_") && f.endsWith(".json"))
          .sort();
        while (all.length > 8) {
          const drop = all.shift();
          try { fs.unlinkSync(path.join(bakDir, drop)); } catch {}
        }
      } catch (e) { console.warn("[backup] failed:", e.message); }
    }
    fs.writeFileSync(p, JSON.stringify(obj, null, 2), "utf8");
    return { ok: true, path: p };
  } catch (e) { return { ok: false, reason: e.message }; }
});

// Toggle a hidden_resource on a region in descr_regions.txt. Used by the map's brush mode:
// click a region → add or remove the active HR token from that region's traits line. Writes
// a timestamped .bak before modifying so the user can revert manually.
ipcMain.handle("toggle-region-hr", async (_e, regionName, hr, mode /* "add" | "remove" | "toggle" */) => {
  if (!regionName || !hr) return { ok: false, reason: "missing args" };
  const d = dataDir();
  const p = path.join(d, "world", "maps", "base", "descr_regions.txt");
  if (!fs.existsSync(p)) return { ok: false, reason: "descr_regions.txt not found" };
  try {
    const text = fs.readFileSync(p, "utf8");
    const useCRLF = /\r\n/.test(text);
    const eol = useCRLF ? "\r\n" : "\n";
    const lines = text.split(/\r?\n/);
    let i = 0, found = false, applied = "noop";
    while (i < lines.length) {
      const line = lines[i];
      if (!line || line.startsWith(";") || /^\s/.test(line)) { i++; continue; }
      if (line.trim() === regionName) {
        // The traits line is the 6th block-line (index 5 from the region name, 1-indented).
        // Step past indented lines counting until we reach line 5.
        let blockLine = 0, j = i + 1;
        while (j < lines.length) {
          const l = lines[j];
          if (!/^\s/.test(l)) break;
          if (l.startsWith(";")) { j++; continue; }
          blockLine++;
          if (blockLine === 5) {
            // This is the trait line. Extract leading whitespace + tokens.
            const lead = (l.match(/^\s*/) || [""])[0];
            const tokens = l.trim().split(/\s*,\s*/).filter(Boolean);
            const has = tokens.includes(hr);
            const wantRemove = mode === "remove" || (mode === "toggle" && has);
            const wantAdd = mode === "add" || (mode === "toggle" && !has);
            let nextTokens = tokens;
            if (wantRemove && has) { nextTokens = tokens.filter(t => t !== hr); applied = "removed"; }
            else if (wantAdd && !has) { nextTokens = [...tokens, hr]; applied = "added"; }
            lines[j] = lead + nextTokens.join(", ");
            found = true;
            break;
          }
          j++;
        }
        break;
      }
      i++;
    }
    if (!found) return { ok: false, reason: "region not found" };
    if (applied === "noop") return { ok: true, applied: "noop" };
    // Backup once per session is overkill; instead drop a single `.bak` if not present.
    const bak = p + ".bak";
    if (!fs.existsSync(bak)) fs.writeFileSync(bak, text, "utf8");
    fs.writeFileSync(p, lines.join(eol), "utf8");
    return { ok: true, applied };
  } catch (e) { return { ok: false, reason: e.message }; }
});

// Manipula project save/open — bundles authored units + EDU project + map view + active
// profile name into a single .manipula JSON file so it's portable across machines.
ipcMain.handle("save-manipula-project", async (_e, payload, suggestedName) => {
  const r = await dialog.showSaveDialog({
    title: "Save Manipula project",
    defaultPath: suggestedName || "manipula-project.manipula.json",
    filters: [{ name: "Manipula project", extensions: ["manipula.json", "json"] }],
  });
  if (r.canceled || !r.filePath) return { canceled: true };
  try {
    fs.writeFileSync(r.filePath, JSON.stringify(payload, null, 2), "utf8");
    return { ok: true, path: r.filePath };
  } catch (e) { return { ok: false, reason: e.message }; }
});
ipcMain.handle("open-manipula-project", async () => {
  const r = await dialog.showOpenDialog({
    title: "Open Manipula project",
    filters: [{ name: "Manipula project", extensions: ["manipula.json", "json"] }],
    properties: ["openFile"],
  });
  if (r.canceled || !r.filePaths[0]) return { canceled: true };
  try {
    const text = fs.readFileSync(r.filePaths[0], "utf8");
    return { ok: true, payload: JSON.parse(text), path: r.filePaths[0] };
  } catch (e) { return { ok: false, reason: e.message }; }
});

// Mod data file mtimes — used by the renderer to detect external changes (user edited a
// file in another tool) and prompt for a reload.
ipcMain.handle("get-mod-mtimes", async () => {
  const d = dataDir();
  const files = {
    edb: path.join(d, "export_descr_buildings.txt"),
    edu: path.join(d, "export_descr_unit.txt"),
    regions: path.join(d, "world", "maps", "base", "descr_regions.txt"),
    strat: path.join(d, "world", "maps", "campaign", "imperial_campaign", "descr_strat.txt"),
  };
  const out = {};
  for (const [k, p] of Object.entries(files)) {
    try { out[k] = fs.statSync(p).mtimeMs | 0; } catch { out[k] = 0; }
  }
  return out;
});

// Profiles
ipcMain.handle("list-profiles", async () => {
  migrateLegacyUnitsJson();
  try {
    return fs.readdirSync(profilesDir())
      .filter(f => f.endsWith(".json"))
      .map(f => f.slice(0, -5));
  } catch { return []; }
});

ipcMain.handle("get-active-profile", async () => activeProfileName());

ipcMain.handle("set-active-profile", async (_e, name) => {
  const safe = String(name || "default").replace(/[\\/:*?"<>|]/g, "_").slice(0, 64);
  writeSettings({ activeProfile: safe });
  // Ensure file exists
  const p = profilePath(safe);
  if (!fs.existsSync(p)) fs.writeFileSync(p, JSON.stringify({ units: [] }, null, 2), "utf8");
  return { ok: true, name: safe };
});

ipcMain.handle("delete-profile", async (_e, name) => {
  if (name === "default") return { ok: false, reason: "Cannot delete the default profile." };
  try {
    fs.unlinkSync(profilePath(name));
    if (activeProfileName() === name) writeSettings({ activeProfile: "default" });
    return { ok: true };
  } catch (e) { return { ok: false, reason: e.message }; }
});

ipcMain.handle("duplicate-profile", async (_e, fromName, toName) => {
  try {
    const src = profilePath(fromName);
    const dst = profilePath(toName);
    if (fs.existsSync(dst)) return { ok: false, reason: "Profile already exists" };
    fs.copyFileSync(src, dst);
    return { ok: true, name: toName };
  } catch (e) { return { ok: false, reason: e.message }; }
});

// Backups — list and restore .bak_* files next to EDB
ipcMain.handle("list-edb-backups", async () => {
  const d = dataDir();
  if (!fs.existsSync(d)) return [];
  try {
    return fs.readdirSync(d)
      .filter(f => /^export_descr_buildings\.txt\.bak_/.test(f))
      .map(f => {
        const full = path.join(d, f);
        const st = fs.statSync(full);
        return { name: f, path: full, mtime: st.mtimeMs, size: st.size };
      })
      .sort((a, b) => b.mtime - a.mtime);
  } catch { return []; }
});

ipcMain.handle("restore-edb-backup", async (_e, backupPath) => {
  const d = dataDir();
  const target = path.join(d, "export_descr_buildings.txt");
  if (!fs.existsSync(backupPath)) return { ok: false, reason: "Backup file missing" };
  // Make a "pre-restore" backup of the current EDB first, so a misclick is recoverable.
  try {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const preBak = target + ".bak_pre-restore_" + stamp;
    if (fs.existsSync(target)) fs.copyFileSync(target, preBak);
    fs.copyFileSync(backupPath, target);
    return { ok: true, preRestoreBackup: preBak };
  } catch (e) { return { ok: false, reason: e.message }; }
});

ipcMain.handle("delete-edb-backup", async (_e, backupPath) => {
  try { fs.unlinkSync(backupPath); return { ok: true }; }
  catch (e) { return { ok: false, reason: e.message }; }
});

ipcMain.handle("get-app-info", async () => ({
  version: app.getVersion(),
  userData: app.getPath("userData"),
  unitsJson: unitsJsonPath(),
  defaultDataDir: DEFAULT_DATA_DIR,
}));

// Faction icons — locate the mod's data/ui/faction_icons directory and read individual TGA files.
ipcMain.handle("find-faction-icons-dir", async () => {
  const d = dataDir();
  for (const p of [
    path.join(d, "ui", "faction_icons"),
    path.join(d, "..", "ui", "faction_icons"),
  ]) {
    if (fs.existsSync(p)) return p;
  }
  return null;
});

ipcMain.handle("read-faction-icon", async (_e, filePath) => {
  try {
    const buf = fs.readFileSync(filePath);
    return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  } catch { return null; }
});

// Resolve a unit's portrait TGA. Tries (in order):
//   1. <dataDir>/ui/units/<faction>/#<dictionary>.tga
//   2. <dataDir>/ui/units/<faction>/#<unit_type>.tga (with various prefix-strips)
//   3. ui/unit_info/<faction>/<name>_info.tga
//   4. mercs/ folder for merc units
// Returns { buffer, path } or null.
ipcMain.handle("resolve-unit-card", async (_e, faction, unitName, dictionary) => {
  if (!faction || !unitName) return null;
  const d = dataDir();
  const scrub = (s) => String(s).toLowerCase().replace(/['"`]/g, "").replace(/\s+/g, "_");
  const f = scrub(faction);
  const uBase = scrub(unitName);
  const variants = [];
  const pushUnique = (v) => { if (v && !variants.includes(v)) variants.push(v); };
  if (dictionary) pushUnique(scrub(dictionary));
  pushUnique(uBase);
  for (const v of [...variants]) {
    if (/s$/.test(v)) pushUnique(v.slice(0, -1));
    if (v.startsWith("aor_")) pushUnique(v.slice(4));
    if (v.startsWith("merc_")) pushUnique(v.slice(5));
  }
  const factions = [f];
  if (f === "greeks") factions.push("greek_cities");
  if (/^romans_/.test(f)) factions.push("romans");
  factions.push("mercs");

  const filenames = [];
  for (const uv of variants) {
    filenames.push(`#${uv}.tga`);
    filenames.push(`${uv}_info.tga`);
  }
  const dirs = [];
  for (const fac of factions) {
    dirs.push(path.join(d, "ui", "units", fac));
    dirs.push(path.join(d, "ui", "unit_info", fac));
  }
  for (const fn of filenames) {
    for (const dir of dirs) {
      if (!fs.existsSync(dir)) continue;
      const full = path.join(dir, fn);
      if (!fs.existsSync(full)) continue;
      try {
        const buf = fs.readFileSync(full);
        return { buffer: buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), path: full };
      } catch {}
    }
  }
  // Fallback: scan every faction folder under ui/units and ui/unit_info for our filenames.
  // Catches AOR units whose icon lives under the "natural owner" faction's folder.
  const fnSet = new Set(filenames);
  for (const subdir of ["units", "unit_info"]) {
    const base = path.join(d, "ui", subdir);
    let entries;
    try { entries = fs.readdirSync(base); } catch { continue; }
    for (const facDir of entries) {
      const facPath = path.join(base, facDir);
      try { if (!fs.statSync(facPath).isDirectory()) continue; } catch { continue; }
      for (const fn of fnSet) {
        const full = path.join(facPath, fn);
        if (!fs.existsSync(full)) continue;
        try {
          const buf = fs.readFileSync(full);
          return { buffer: buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), path: full };
        } catch {}
      }
    }
  }
  return null;
});

// Resolve a unit's larger info portrait — ui/unit_info/<faction>/<name>_info.tga.
// Used for the right-click full-size preview (the small thumbnail comes from ui/units).
ipcMain.handle("resolve-unit-info", async (_e, faction, unitName, dictionary) => {
  if (!unitName) return null;
  const d = dataDir();
  const scrub = (s) => String(s).toLowerCase().replace(/['"`]/g, "").replace(/\s+/g, "_");
  const f = faction ? scrub(faction) : null;
  const uBase = scrub(unitName);
  const variants = [];
  const pushUnique = (v) => { if (v && !variants.includes(v)) variants.push(v); };
  if (dictionary) pushUnique(scrub(dictionary));
  pushUnique(uBase);
  for (const v of [...variants]) {
    if (/s$/.test(v)) pushUnique(v.slice(0, -1));
    if (v.startsWith("aor_")) pushUnique(v.slice(4));
    if (v.startsWith("merc_")) pushUnique(v.slice(5));
  }
  const factions = [];
  if (f) factions.push(f);
  if (f === "greeks") factions.push("greek_cities");
  if (f && /^romans_/.test(f)) factions.push("romans");
  factions.push("mercs");

  const filenames = variants.map(v => `${v}_info.tga`);
  const base = path.join(d, "ui", "unit_info");
  for (const fac of factions) {
    const dir = path.join(base, fac);
    if (!fs.existsSync(dir)) continue;
    for (const fn of filenames) {
      const full = path.join(dir, fn);
      if (!fs.existsSync(full)) continue;
      try {
        const buf = fs.readFileSync(full);
        return { buffer: buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), path: full };
      } catch {}
    }
  }
  // Brute-force scan all faction folders under ui/unit_info.
  let entries;
  try { entries = fs.readdirSync(base); } catch { return null; }
  for (const facDir of entries) {
    const facPath = path.join(base, facDir);
    try { if (!fs.statSync(facPath).isDirectory()) continue; } catch { continue; }
    for (const fn of filenames) {
      const full = path.join(facPath, fn);
      if (!fs.existsSync(full)) continue;
      try {
        const buf = fs.readFileSync(full);
        return { buffer: buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), path: full };
      } catch {}
    }
  }
  return null;
});

// EDUMatic xlsm import
ipcMain.handle("pick-edumatic-xlsm", async () => {
  const r = await dialog.showOpenDialog({
    title: "Pick EDUMatic xlsm (e.g. BD's New Base.xlsm)",
    filters: [{ name: "Excel Macro-Enabled Workbook", extensions: ["xlsm", "xlsx"] }],
    defaultPath: "C:\\RIS\\_tools\\Biggus-tools",
    properties: ["openFile"],
  });
  if (r.canceled || !r.filePaths.length) return null;
  return r.filePaths[0];
});

ipcMain.handle("read-edumatic-xlsm", async (_e, xlsmPath) => {
  if (!xlsmPath || !fs.existsSync(xlsmPath)) return { ok: false, reason: "File not found: " + xlsmPath };
  try {
    const rows = readEdumatic(xlsmPath);
    return { ok: true, rows, source: xlsmPath, count: rows.length };
  } catch (e) {
    return { ok: false, reason: e.message };
  }
});

// Save preview/export to a file the user picks
ipcMain.handle("save-text-as", async (_e, defaultName, content) => {
  const r = await dialog.showSaveDialog({
    title: "Save export",
    defaultPath: defaultName || "recruitment-export.txt",
    filters: [{ name: "Text", extensions: ["txt"] }],
  });
  if (r.canceled || !r.filePath) return null;
  try { fs.writeFileSync(r.filePath, content, "utf8"); return r.filePath; }
  catch (e) { return null; }
});

// ── Auto-update (electron-updater) ──────────────────────────────────────
// Mirrors Provincia's update flow. Checks the GitHub Releases feed configured under
// build.publish in package.json. Fails silently (with a log line) if there's no network,
// no feed, or it's a dev run. Emits IPC events so the renderer can show a toast.
autoUpdater.autoDownload = true;
autoUpdater.autoInstallOnAppQuit = true;
autoUpdater.logger = { info: console.log, warn: console.warn, error: console.error, debug: () => {} };

// Cache the most recent update status so the renderer can query it on mount and recover from
// the inevitable race where the main process fires update events before the renderer is listening.
let lastUpdateStatus = null;
function sendUpdateEvent(channel, payload) {
  if (channel === "update-status") lastUpdateStatus = payload;
  const win = BrowserWindow.getAllWindows()[0];
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

ipcMain.handle("get-update-status", async () => lastUpdateStatus);

autoUpdater.on("update-available", (info) => {
  console.log("[updater] update available:", info.version);
  sendUpdateEvent("update-status", { state: "available", version: info.version });
});
autoUpdater.on("update-not-available", () => {
  sendUpdateEvent("update-status", { state: "none" });
});
autoUpdater.on("download-progress", (p) => {
  sendUpdateEvent("update-status", { state: "downloading", percent: Math.round(p.percent || 0) });
});
autoUpdater.on("update-downloaded", (info) => {
  console.log("[updater] downloaded:", info.version);
  sendUpdateEvent("update-status", { state: "downloaded", version: info.version });
});
autoUpdater.on("error", (err) => {
  console.warn("[updater] error:", err.message);
  sendUpdateEvent("update-status", { state: "error", message: err.message });
});

ipcMain.handle("updater-check", async () => {
  if (!app.isPackaged) return { ok: false, reason: "dev build" };
  try { await autoUpdater.checkForUpdates(); return { ok: true }; }
  catch (e) { return { ok: false, reason: e.message }; }
});

ipcMain.handle("updater-quit-and-install", () => {
  // Silent auto-update — skip the NSIS installer wizard (first true) and relaunch the
  // app afterwards (second true). Same call Provincia uses; the user clicks "install"
  // in the toast and the app simply restarts on the new version with no extra prompts.
  autoUpdater.quitAndInstall(true, true);
  return true;
});

// ── Native icon protocol (rticon://) ──
// The renderer used to fetch+decode TGAs in JS, which was slow for many icons. Now main.js
// decodes TGA → PNG once per icon, caches the PNG to userData/icon_cache/, and serves it via
// a custom Electron protocol. The renderer just uses `<img src="rticon://...">` — no JS work.
//
// URL shapes:
//   rticon://faction/<factionId>
//   rticon://unit/<faction>/<encodedName>?d=<dictionary>
//   rticon://info/<faction>/<encodedName>?d=<dictionary>
function iconCacheDir() {
  const d = path.join(app.getPath("userData"), "icon_cache");
  try { fs.mkdirSync(d, { recursive: true }); } catch {}
  return d;
}
function cachePathFor(tgaPath) {
  let mtime = 0;
  try { mtime = fs.statSync(tgaPath).mtimeMs | 0; } catch {}
  const hash = crypto.createHash("sha1").update(tgaPath + "|" + mtime).digest("hex").slice(0, 16);
  return path.join(iconCacheDir(), hash + ".png");
}
async function findOrEncodeToCache(tgaPath) {
  if (!tgaPath || !fs.existsSync(tgaPath)) return null;
  if (!tgaFileToPng) return null;
  const cachePath = cachePathFor(tgaPath);
  if (fs.existsSync(cachePath)) return cachePath;
  // Try the worker pool first (parallel, doesn't block main process I/O).
  const ok = await decodeTgaInPool(tgaPath, cachePath);
  if (ok && fs.existsSync(cachePath)) return cachePath;
  // Pool unavailable / failed → inline decode as a last resort.
  try {
    const png = tgaFileToPng(tgaPath);
    if (!png) return null;
    fs.writeFileSync(cachePath, png);
    return cachePath;
  } catch (e) { console.warn("[rticon] inline decode failed:", tgaPath, e.message); return null; }
}

// Pre-warm: walk the mod's faction_icons folder and queue every TGA for decode in the
// background. By the time the renderer mounts FactionIcon components, the cache is hot.
function prewarmFactionIcons() {
  if (!tgaFileToPng) return;
  const d = dataDir();
  const dirs = [path.join(d, "ui", "faction_icons"), path.join(d, "..", "ui", "faction_icons"), path.join(__dirname, "build", "faction_icons")];
  for (const dir of dirs) {
    if (!fs.existsSync(dir)) continue;
    let entries;
    try { entries = fs.readdirSync(dir); } catch { continue; }
    for (const name of entries) {
      if (!name.endsWith(".tga")) continue;
      const tga = path.join(dir, name);
      const cache = cachePathFor(tga);
      if (fs.existsSync(cache)) continue;
      decodeTgaInPool(tga, cache);
    }
  }
}
ipcMain.handle("prewarm-icons", async () => { prewarmFactionIcons(); return true; });

// Pre-warm unit_card.tga decode for a list of {faction, unit, dictionary} triples. Mirrors
// the rticon protocol's resolveUnitTga but pushes every result through the worker pool so
// scrolling the unit list is instant after mod load.
ipcMain.handle("prewarm-unit-cards", async (_e, list) => {
  if (!Array.isArray(list) || !tgaFileToPng) return false;
  for (const item of list) {
    if (!item || !item.unit) continue;
    const tga = resolveUnitTga(item.faction || null, item.unit, item.dictionary || null, "card");
    if (!tga) continue;
    const cache = cachePathFor(tga);
    if (fs.existsSync(cache)) continue;
    decodeTgaInPool(tga, cache);
  }
  return true;
});

// Validation helper — given a list of {unit, faction, dictionary}, return the names of units
// whose unit_card.tga can't be located in the mod data. Used by ValidationView to flag
// missing portraits as warnings.
// Locate the campaign map_regions.tga (the RGB region map) and return it as a PNG via the
// existing tga→png pipeline. The renderer pulls this once on mod load and uses it as the
// base for the recruitable-regions heatmap.
function findMapRegionsTga() {
  const d = dataDir();
  const candidates = [
    path.join(d, "world", "maps", "base", "map_regions.tga"),
    path.join(d, "world", "maps", "campaign", "imperial_campaign", "map_regions.tga"),
  ];
  for (const c of candidates) if (fs.existsSync(c)) return c;
  return null;
}
ipcMain.handle("get-map-regions-info", async () => {
  const tga = findMapRegionsTga();
  if (!tga) return { ok: false };
  return { ok: true, path: tga };
});
// Decode map_regions.tga and return the raw RGBA pixel buffer + dimensions. The renderer
// needs the *pixel data* (not just the PNG) so it can recolour regions matching HR
// requirements without re-decoding on every render. Cached by mtime.
const mapPixelCache = new Map();
ipcMain.handle("get-map-regions-pixels", async () => {
  const tga = findMapRegionsTga();
  if (!tga) return null;
  let mtime = 0;
  try { mtime = fs.statSync(tga).mtimeMs | 0; } catch {}
  const key = `${tga}|${mtime}`;
  if (mapPixelCache.has(key)) return mapPixelCache.get(key);
  if (!decodeTgaToRgba) return null;
  try {
    const buf = fs.readFileSync(tga);
    const img = decodeTgaToRgba(buf);
    // Transfer as ArrayBuffer so the renderer can wrap it directly without copying.
    const ab = img.pixels.buffer.slice(img.pixels.byteOffset, img.pixels.byteOffset + img.pixels.byteLength);
    const result = { width: img.width, height: img.height, pixels: ab };
    mapPixelCache.set(key, result);
    return result;
  } catch (e) {
    console.warn("[map] decode failed:", e.message);
    return null;
  }
});

ipcMain.handle("check-unit-cards", async (_e, list) => {
  if (!Array.isArray(list)) return [];
  const missing = [];
  for (const item of list) {
    if (!item || !item.unit) continue;
    const tga = resolveUnitTga(item.faction || null, item.unit, item.dictionary || null, "card");
    if (!tga) missing.push(item.unit);
  }
  return missing;
});
function bundledFactionIconPath(id) {
  // public/faction_icons/* gets copied into build/faction_icons/* by CRA, which is included
  // in the asar at <appPath>/build/faction_icons.
  const candidates = [
    path.join(__dirname, "build", "faction_icons", `${id}.tga`),
    path.join(__dirname, "public", "faction_icons", `${id}.tga`),
  ];
  for (const p of candidates) if (fs.existsSync(p)) return p;
  return null;
}
function resolveFactionIconTga(factionId) {
  const d = dataDir();
  const candidates = [];
  for (const base of [path.join(d, "ui", "faction_icons"), path.join(d, "..", "ui", "faction_icons")]) {
    candidates.push(path.join(base, `${factionId}.tga`));
    candidates.push(path.join(base, `slave.tga`));
  }
  candidates.push(bundledFactionIconPath(factionId));
  candidates.push(bundledFactionIconPath("slave"));
  for (const c of candidates) if (c && fs.existsSync(c)) return c;
  return null;
}
// Path-resolution cache. resolveUnitTga walks up to ~80 fs.existsSync
// candidates per unit; with 800-unit projects firing prewarm + img
// requests, that adds up to tens of thousands of disk hits on boot.
// Cache by (faction|unit|dict|kind|dataDir) so repeat lookups for the
// same unit are O(1). Cap growth and clear on dataDir change (see
// set-data-dir handler) so a project-folder switch doesn't return
// stale paths.
const resolveTgaCache = new Map();
const RESOLVE_CACHE_MAX = 5000;
function clearResolveTgaCache() { resolveTgaCache.clear(); }

function resolveUnitTga(faction, unitName, dictionary, kind /* "card" | "info" */) {
  if (!unitName) return null;
  const d = dataDir();
  const cacheKey = `${d}|${faction || ""}|${unitName}|${dictionary || ""}|${kind}`;
  if (resolveTgaCache.has(cacheKey)) return resolveTgaCache.get(cacheKey);
  const scrub = (s) => String(s).toLowerCase().replace(/['"`]/g, "").replace(/\s+/g, "_");
  const f = faction ? scrub(faction) : null;
  const variants = [];
  const pushUnique = (v) => { if (v && !variants.includes(v)) variants.push(v); };
  if (dictionary) pushUnique(scrub(dictionary));
  pushUnique(scrub(unitName));
  // Iterate until stable so derived variants (e.g. "aor_numidian_slingers" → "numidian_slingers"
  // → "numidian_slinger") all get explored. Bounded loop in case the data is pathological.
  for (let pass = 0; pass < 4; pass++) {
    const before = variants.length;
    for (const v of variants.slice()) {
      if (/s$/.test(v)) pushUnique(v.slice(0, -1));
      if (v.startsWith("aor_")) pushUnique(v.slice(4));
      if (v.startsWith("merc_")) pushUnique(v.slice(5));
    }
    if (variants.length === before) break;
  }
  const factions = [];
  if (f) factions.push(f);
  if (f === "greeks") factions.push("greek_cities");
  if (f && /^romans_/.test(f)) factions.push("romans");
  factions.push("mercs");

  const filenames = [];
  for (const v of variants) {
    if (kind === "info") filenames.push(`${v}_info.tga`);
    else { filenames.push(`#${v}.tga`); filenames.push(`${v}_info.tga`); }
  }
  const subdirs = kind === "info" ? ["unit_info"] : ["units", "unit_info"];
  const cache = (result) => {
    if (resolveTgaCache.size >= RESOLVE_CACHE_MAX) {
      // Cheap eviction — drop the first quarter when full. The hot
      // working set is well under RESOLVE_CACHE_MAX so this rarely fires.
      const drop = Math.floor(RESOLVE_CACHE_MAX / 4);
      let i = 0;
      for (const k of resolveTgaCache.keys()) { if (i++ >= drop) break; resolveTgaCache.delete(k); }
    }
    resolveTgaCache.set(cacheKey, result);
    return result;
  };

  for (const fac of factions) {
    for (const sub of subdirs) {
      const dir = path.join(d, "ui", sub, fac);
      if (!fs.existsSync(dir)) continue;
      for (const fn of filenames) {
        const full = path.join(dir, fn);
        if (fs.existsSync(full)) return cache(full);
      }
    }
  }
  // Brute-force scan all faction folders.
  for (const sub of subdirs) {
    const base = path.join(d, "ui", sub);
    let entries;
    try { entries = fs.readdirSync(base); } catch { continue; }
    for (const facDir of entries) {
      const facPath = path.join(base, facDir);
      try { if (!fs.statSync(facPath).isDirectory()) continue; } catch { continue; }
      for (const fn of filenames) {
        const full = path.join(facPath, fn);
        if (fs.existsSync(full)) return cache(full);
      }
    }
  }
  return cache(null);
}

function registerIconProtocol() {
  if (!tgaFileToPng) {
    console.warn("[rticon] decoder unavailable — protocol not registered");
    return;
  }
  if (typeof protocol.handle !== "function") {
    console.warn("[rticon] protocol.handle unavailable in this Electron version");
    return;
  }
  try {
    protocol.handle("rticon", async (request) => {
      try {
        const u = new URL(request.url);
        const kind = u.hostname; // faction | unit | info
        const segs = decodeURIComponent(u.pathname.replace(/^\/+/, "")).split("/").filter(Boolean);
        const dict = u.searchParams.get("d") || null;
        let tgaPath = null;
        if (kind === "faction" && segs.length >= 1) {
          tgaPath = resolveFactionIconTga(segs[0]);
        } else if (kind === "unit" || kind === "info") {
          // Faction may be omitted (AOR units that have no specific owner) — in which case the
          // resolver brute-force scans all faction folders. So accept length >= 1 too.
          if (segs.length >= 2) {
            tgaPath = resolveUnitTga(segs[0], segs.slice(1).join("/"), dict, kind === "info" ? "info" : "card");
          } else if (segs.length === 1) {
            tgaPath = resolveUnitTga(null, segs[0], dict, kind === "info" ? "info" : "card");
          }
        }
        const pngPath = tgaPath ? await findOrEncodeToCache(tgaPath) : null;
        if (!pngPath) return new Response("", { status: 404 });
        const data = fs.readFileSync(pngPath);
        return new Response(data, { status: 200, headers: { "Content-Type": "image/png", "Cache-Control": "public, max-age=86400" } });
      } catch (e) {
        return new Response(String((e && e.message) || e), { status: 500 });
      }
    });
  } catch (e) {
    console.error("[rticon] protocol.handle registration failed:", e);
  }
}

// ── EDU-matic IPC handlers ──
// Ports of EDU Tool's main.js handlers, namespaced under "edm-" so they don't collide
// with the recruitment-tool's existing handlers. Lets the bundled EDU-matic UI run
// unchanged inside this window via window.eduAPI.
const { shell } = require("electron");
ipcMain.handle("edm-pick-xlsm", async () => {
  const r = await dialog.showOpenDialog({
    title: "Import EDU-matic .xlsm",
    filters: [{ name: "Excel macro-enabled workbook", extensions: ["xlsm", "xlsx"] }],
    properties: ["openFile"],
  });
  if (r.canceled || !r.filePaths[0]) return null;
  return r.filePaths[0];
});
ipcMain.handle("edm-read-file-binary", async (_e, filePath) => {
  try { return fs.readFileSync(filePath); } catch (e) { console.error("[edm] read-file-binary:", e.message); return null; }
});
ipcMain.handle("edm-choose-export-dir", async () => {
  const r = await dialog.showOpenDialog({
    title: "Choose EDU output folder",
    properties: ["openDirectory", "createDirectory"],
  });
  if (r.canceled || !r.filePaths[0]) return null;
  return r.filePaths[0];
});
ipcMain.handle("edm-export-edu", async (_e, text, outDir, baseName) => {
  try {
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
    const hhmm = new Date().toTimeString().slice(0, 5).replace(":", "");
    const fileName = `${baseName || "export_descr_unit"}_${hhmm}.txt`;
    const full = path.join(outDir, fileName);
    fs.writeFileSync(full, text, "utf8");
    return full;
  } catch (e) { console.error("[edm] export-edu:", e.message); return null; }
});
ipcMain.handle("edm-reveal-in-folder", (_e, filePath) => {
  try { if (filePath && fs.existsSync(filePath)) shell.showItemInFolder(filePath); return true; } catch { return false; }
});
ipcMain.handle("edm-open-project", async () => {
  const r = await dialog.showOpenDialog({ title: "Open EDU-matic project folder", properties: ["openDirectory"] });
  if (r.canceled || !r.filePaths[0]) return null;
  return r.filePaths[0];
});
ipcMain.handle("edm-choose-save-dir", async () => {
  const r = await dialog.showOpenDialog({ title: "Choose project folder", properties: ["openDirectory", "createDirectory"] });
  if (r.canceled || !r.filePaths[0]) return null;
  return r.filePaths[0];
});
ipcMain.handle("edm-read-project-file", async (_e, dir, name) => {
  try { return fs.readFileSync(path.join(dir, name), "utf8"); } catch { return null; }
});
ipcMain.handle("edm-write-project-file", async (_e, dir, name, content) => {
  try {
    const target = path.join(dir, name);
    const parent = path.dirname(target);
    if (!fs.existsSync(parent)) fs.mkdirSync(parent, { recursive: true });
    fs.writeFileSync(target, content, "utf8");
    return true;
  } catch (e) { console.error("[edm] write-project-file:", e.message); return false; }
});
// List immediate file entries in <dir>/<subdir>. Returns []  if the subdir
// doesn't exist (cold project, not yet populated). Filters to .json only —
// the project format uses JSON for everything, and silently skipping
// stray .DS_Store / Thumbs.db / .git / .gitignore avoids loader errors.
ipcMain.handle("edm-list-project-files", async (_e, dir, subdir) => {
  try {
    const root = subdir ? path.join(dir, subdir) : dir;
    if (!fs.existsSync(root)) return [];
    return fs.readdirSync(root)
      .filter(name => name.endsWith(".json"))
      .filter(name => fs.statSync(path.join(root, name)).isFile());
  } catch (e) { console.error("[edm] list-project-files:", e.message); return []; }
});
// Delete a single project file. Used during save when a unit was renamed
// or removed: the writer dumps current state, then deletes any orphan
// files so the on-disk tree exactly reflects the project.
ipcMain.handle("edm-delete-project-file", async (_e, dir, name) => {
  try {
    const target = path.join(dir, name);
    if (fs.existsSync(target)) fs.unlinkSync(target);
    return true;
  } catch (e) { console.error("[edm] delete-project-file:", e.message); return false; }
});
// Batch project save — writes every file in one IPC round-trip and prunes
// orphans in named subdirs in the same pass. The per-file write/delete
// handlers above were fine for small projects, but a real mod project has
// ~800 units + ~200 factions + ~1000 armour rows + ~800 recruit-lines, and
// 2000+ sequential renderer→main IPC calls in a row can freeze the
// renderer long enough that Chromium blanks the window. This handler
// takes the whole batch as one payload and does all the I/O in the main
// process where a fs.writeFileSync loop runs in a few hundred ms instead
// of tens of seconds.
//
// Payload:
//   { writes: [{ relPath, content }, ...],
//     pruneSubdirs: [string, ...] }   // subdirs whose .json files not
//                                     // listed in `writes` get deleted
ipcMain.handle("edm-write-project-batch", async (_e, dir, payload) => {
  try {
    if (!dir) return { ok: false, reason: "no dir" };
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const writes = (payload && payload.writes) || [];
    const pruneSubdirs = (payload && payload.pruneSubdirs) || [];

    // Track every file we wrote, by absolute path, so the prune step can
    // tell new-and-listed from previously-existing-and-orphaned.
    const writtenAbs = new Set();
    for (const w of writes) {
      const target = path.join(dir, w.relPath);
      const parent = path.dirname(target);
      if (!fs.existsSync(parent)) fs.mkdirSync(parent, { recursive: true });
      fs.writeFileSync(target, w.content, "utf8");
      writtenAbs.add(path.resolve(target).toLowerCase());
    }

    // Prune. For each managed subdir, walk its .json files and delete any
    // that wasn't in the writes list — these are records the user removed
    // (or whose key changed) since the previous save. Without this, the
    // on-disk tree would accumulate ghost units forever.
    let pruned = 0;
    for (const sub of pruneSubdirs) {
      const subAbs = path.join(dir, sub);
      if (!fs.existsSync(subAbs)) continue;
      for (const name of fs.readdirSync(subAbs)) {
        if (!name.endsWith(".json")) continue;
        const f = path.join(subAbs, name);
        if (!fs.statSync(f).isFile()) continue;
        if (!writtenAbs.has(path.resolve(f).toLowerCase())) {
          try { fs.unlinkSync(f); pruned++; } catch (e) { console.warn("[edm] prune fail:", f, e.message); }
        }
      }
    }
    return { ok: true, written: writes.length, pruned };
  } catch (e) {
    console.error("[edm] write-project-batch:", e.message);
    return { ok: false, reason: e.message };
  }
});
// Batch project load — counterpart to write-batch. Walks the project dir
// recursively (within sane subdir limits) and returns every .json file's
// contents in one IPC call, instead of the renderer firing N round-trips
// to read N files.
ipcMain.handle("edm-read-project-batch", async (_e, dir) => {
  try {
    if (!dir || !fs.existsSync(dir)) return { ok: false, reason: "dir missing" };
    const files = [];
    const SUBDIRS = ["", "edu", "edu/coreData", "edu/factions", "edu/units", "edu/armour", "recruits"];
    for (const sub of SUBDIRS) {
      const subAbs = sub ? path.join(dir, sub) : dir;
      if (!fs.existsSync(subAbs)) continue;
      for (const name of fs.readdirSync(subAbs)) {
        if (!name.endsWith(".json")) continue;
        const f = path.join(subAbs, name);
        if (!fs.statSync(f).isFile()) continue;
        const relPath = sub ? `${sub}/${name}` : name;
        try { files.push({ relPath, content: fs.readFileSync(f, "utf8") }); }
        catch (e) { console.warn("[edm] read fail:", relPath, e.message); }
      }
    }
    return { ok: true, files };
  } catch (e) {
    console.error("[edm] read-project-batch:", e.message);
    return { ok: false, reason: e.message };
  }
});
ipcMain.handle("edm-log-message", async (_e, level, text) => {
  console.log(`[edm-${level}]`, text);
  // Also write to userData/edu-matic.log so we can inspect renderer-side
  // diagnostics (DOM dimensions, scroll widths, …) without needing DevTools.
  // Useful for debugging the EDU Builder layout against user reports.
  try {
    const logPath = path.join(app.getPath("userData"), "edu-matic.log");
    const ts = new Date().toISOString();
    fs.appendFileSync(logPath, `[${ts}] [${level}] ${text}\n`);
  } catch {}
});
ipcMain.handle("edm-get-log-path", () => path.join(app.getPath("userData"), "edu-matic.log"));
ipcMain.handle("edm-reveal-log-file", () => false);
ipcMain.handle("edm-get-user-data-path", () => app.getPath("userData"));

// ── Git wrappers ────────────────────────────────────────────────────
//
// Shell out to whatever `git` is on PATH. These are intentionally
// minimal — Manipula is not trying to be a git client, it's giving
// non-git teammates a one-click path through the common cases (pull
// before editing, commit + push when done). For anything more
// complicated (resolving a real merge, reviewing diffs, branch ops),
// users open their normal git tool and Manipula stays out of the way.
//
// All handlers take the project dir as the working directory rather
// than relying on the renderer's CWD. Output is captured and returned
// verbatim so the renderer can show what git said in a toast or
// status panel — no parsing on the renderer side beyond exit code.

// Resolve the git executable. Node's child_process.spawn on Windows
// doesn't do PATHEXT lookup as reliably as a real shell, so passing
// just "git" can silently fail with ENOENT even when `git --version`
// works in PowerShell. We probe a few candidates the first time we
// need git and cache the working one. Only when none respond do we
// give up and report "git not found" — distinct from "found git, but
// the dir isn't a repo", which the UI needs to differentiate.
let gitExePath = null;
let gitProbeDone = false;

async function findGit() {
  if (gitProbeDone) return gitExePath;
  const candidates = process.platform === "win32"
    ? [
        "git.exe",                             // PATHEXT-resolved
        "git",                                 // some shells
        "C:\\Program Files\\Git\\cmd\\git.exe",          // Git for Windows default
        "C:\\Program Files\\Git\\bin\\git.exe",
        "C:\\Program Files (x86)\\Git\\cmd\\git.exe",
      ]
    : ["git", "/usr/bin/git", "/usr/local/bin/git", "/opt/homebrew/bin/git"];

  for (const c of candidates) {
    try {
      const ok = await new Promise((resolve) => {
        const p = spawn(c, ["--version"], { env: process.env, windowsHide: true });
        let buf = "";
        p.stdout.on("data", (b) => { buf += b.toString(); });
        p.on("error", () => resolve(false));
        p.on("close", (code) => resolve(code === 0 && /^git version/i.test(buf)));
      });
      if (ok) {
        gitExePath = c;
        gitProbeDone = true;
        console.log("[git] using", c);
        return c;
      }
    } catch { /* try next */ }
  }
  gitProbeDone = true;
  gitExePath = null;
  return null;
}

function runGit(cwd, args) {
  return new Promise(async (resolve) => {
    if (!cwd || !fs.existsSync(cwd)) {
      resolve({ ok: false, code: -1, stdout: "", stderr: "project dir missing" });
      return;
    }
    const exe = await findGit();
    if (!exe) {
      resolve({ ok: false, code: -1, stdout: "", stderr: "git not found on PATH", missing: true });
      return;
    }
    let stdout = "", stderr = "";
    let proc;
    try {
      proc = spawn(exe, args, { cwd, env: process.env, windowsHide: true });
    } catch (e) {
      resolve({ ok: false, code: -1, stdout: "", stderr: "spawn failed: " + e.message, missing: true });
      return;
    }
    proc.stdout.on("data", (b) => { stdout += b.toString(); });
    proc.stderr.on("data", (b) => { stderr += b.toString(); });
    proc.on("error", (err) => {
      resolve({ ok: false, code: -1, stdout, stderr: stderr || err.message, missing: true });
    });
    proc.on("close", (code) => {
      resolve({ ok: code === 0, code, stdout, stderr });
    });
  });
}

ipcMain.handle("git-available", async () => {
  const exe = await findGit();
  return exe != null;
});

// Status: returns enough for the UI to decide what to offer. Counts
// dirty files, ahead/behind vs upstream, current branch.
ipcMain.handle("git-status", async (_e, dir) => {
  if (!dir) return { ok: false, stderr: "no project dir" };
  const isRepo = await runGit(dir, ["rev-parse", "--is-inside-work-tree"]);
  if (!isRepo.ok) return { ok: true, isRepo: false };
  const branch = await runGit(dir, ["rev-parse", "--abbrev-ref", "HEAD"]);
  const porcelain = await runGit(dir, ["status", "--porcelain"]);
  // ahead/behind requires upstream to exist. If not, those are null.
  const upstream = await runGit(dir, ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"]);
  let ahead = null, behind = null;
  if (upstream.ok) {
    const counts = await runGit(dir, ["rev-list", "--left-right", "--count", "HEAD...@{u}"]);
    if (counts.ok) {
      const m = counts.stdout.trim().split(/\s+/).map(n => parseInt(n, 10));
      if (m.length === 2 && m.every(Number.isFinite)) { ahead = m[0]; behind = m[1]; }
    }
  }
  const dirtyLines = porcelain.stdout.split("\n").filter(l => l.trim() !== "");
  return {
    ok: true,
    isRepo: true,
    branch: branch.stdout.trim(),
    upstream: upstream.ok ? upstream.stdout.trim() : null,
    dirtyCount: dirtyLines.length,
    ahead, behind,
  };
});

ipcMain.handle("git-pull", async (_e, dir) => runGit(dir, ["pull", "--ff-only"]));
ipcMain.handle("git-push", async (_e, dir) => runGit(dir, ["push"]));
// git-fetch — used as part of the pre-save "is anyone ahead of me on the
// remote?" check. We need to fetch first because git-status's behind/ahead
// counts compare HEAD to the LOCAL view of the remote, which is only as
// fresh as the last fetch / pull. Without this, save would silently miss
// teammate commits pushed in the last few hours.
ipcMain.handle("git-fetch", async (_e, dir) => runGit(dir, ["fetch", "--quiet"]));
// Diff stat for the working tree vs HEAD — used by Sync to preview what
// the user is about to commit. --stat is human-readable and short
// enough for an inline panel; we don't try to pretty-render the diff itself.
ipcMain.handle("git-diff-stat", async (_e, dir) => runGit(dir, ["diff", "--stat", "HEAD"]));
// Per-file blame summary — last N commits touching a path. Used to
// surface "last edited by X (3h ago)" tooltips on rows. Returns
// pipe-delimited "shortHash|author|relativeDate" lines.
ipcMain.handle("git-log-file", async (_e, dir, relPath, n) => {
  const limit = Math.max(1, Math.min(20, parseInt(n, 10) || 5));
  return runGit(dir, ["log", `--format=%h|%an|%ar`, `-n`, String(limit), "--", relPath]);
});
// Bulk per-file blame — one git log call, --name-only, with a sentinel
// separator on each commit. Renderer parses the output into a
// Map<relPath, mostRecentCommit> in O(commits + files) so a 800-unit
// table can render "last edited by X (3h ago)" tooltips on every row
// without making 800 separate IPC calls. Limit to 500 commits — that's
// plenty of history for a typical mod project and bounds the
// transferred data to a few hundred KB.
ipcMain.handle("git-log-bulk", async (_e, dir) => {
  return runGit(dir, [
    "log",
    "--name-only",
    "--pretty=format:!!!COMMIT!!!%h|%an|%ar",
    "-n", "500",
  ]);
});

// Open a path in the OS default editor / file association. Used by the
// EDB conflict resolver: when an external change is detected, the user
// can open the file directly to inspect/resolve before deciding whether
// to overwrite. shell.openPath is fire-and-forget; we surface the empty
// string return code as ok and the OS error message as failure.
ipcMain.handle("open-path", async (_e, p) => {
  if (!p) return { ok: false, reason: "no path" };
  try {
    const { shell } = require("electron");
    const err = await shell.openPath(p);
    return err ? { ok: false, reason: err } : { ok: true };
  } catch (e) { return { ok: false, reason: e.message }; }
});

// export_units integration — append a stub block for a new EDU unit so
// the user doesn't have to hand-edit text/export_units.txt every time
// they create one. Block format (3 lines, blank line separator after):
//   {<unitKey>}<Display Name>
//   {<unitKey>_descr_short}This unit needs a short description.
//   {<unitKey>_descr}\n\nThis unit needs a long description.
// Idempotent on the unit key — if the block already exists we leave it
// alone and report "exists" so the caller can show a non-noisy status.
ipcMain.handle("append-export-units-stub", async (_e, modDataDir, unitKey, displayName) => {
  if (!modDataDir || !unitKey) return { ok: false, reason: "missing args" };
  const candidates = [
    path.join(modDataDir, "text", "export_units.txt"),
    path.join(modDataDir, "data", "text", "export_units.txt"),
  ];
  const target = candidates.find(p => fs.existsSync(p));
  if (!target) return { ok: false, reason: "export_units.txt not found in " + modDataDir };
  try {
    const original = fs.readFileSync(target, "utf16le");
    // The mod's export_units.txt is UTF-16 LE with BOM (RTW convention).
    // Strip BOM for the existence check / writing, restore it on save.
    const text = original.charCodeAt(0) === 0xFEFF ? original.slice(1) : original;
    const has = new RegExp(`^\\{${unitKey}\\}`, "m").test(text);
    if (has) return { ok: true, status: "exists", path: target };
    const useCRLF = /\r\n/.test(text);
    const eol = useCRLF ? "\r\n" : "\n";
    const stub =
      `{${unitKey}}${displayName || unitKey}${eol}` +
      `{${unitKey}_descr_short}This unit needs a short description.${eol}` +
      `{${unitKey}_descr}\\n\\nThis unit needs a long description.${eol}`;
    // Backup once per session (mirrors descr_regions.txt convention).
    const bak = target + ".bak";
    if (!fs.existsSync(bak)) fs.writeFileSync(bak, original, { encoding: "binary" });
    // Re-attach BOM and write back as UTF-16 LE.
    const ensureTrailingNl = text.endsWith("\n") ? text : text + eol;
    const bomChar = "﻿";
    fs.writeFileSync(target, bomChar + ensureTrailingNl + stub, { encoding: "utf16le" });
    return { ok: true, status: "added", path: target };
  } catch (e) {
    return { ok: false, reason: e.message };
  }
});
ipcMain.handle("git-commit-all", async (_e, dir, message) => {
  const add = await runGit(dir, ["add", "."]);
  if (!add.ok) return add;
  // Empty commit (nothing to add) returns non-zero from git commit. Treat
  // "nothing to commit" as success-ish so the UI doesn't show a scary
  // error when the user clicks commit on a clean tree.
  const commit = await runGit(dir, ["commit", "-m", message || "Manipula update"]);
  if (!commit.ok && /nothing to commit/i.test(commit.stdout + commit.stderr)) {
    return { ok: true, code: 0, stdout: "nothing to commit", stderr: "" };
  }
  return commit;
});

// Unified bundle export: write both EDB (recruitment) and EDU (units) into the same
// chosen folder atomically (well, sequentially — but inside one user dialog). Returns
// { dir, edbPath, eduPath } or { error }.
ipcMain.handle("export-bundle", async (_e, edbText, eduText, baseEdb = "export_descr_buildings", baseEdu = "export_descr_unit") => {
  try {
    const r = await dialog.showOpenDialog({
      title: "Choose export folder for EDB + EDU",
      properties: ["openDirectory", "createDirectory"],
    });
    if (r.canceled || !r.filePaths[0]) return { canceled: true };
    const dir = r.filePaths[0];
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const hhmm = new Date().toTimeString().slice(0, 5).replace(":", "");
    const out = { dir };
    if (edbText) {
      const p = path.join(dir, `${baseEdb}_${hhmm}.txt`);
      fs.writeFileSync(p, edbText, "utf8");
      out.edbPath = p;
    }
    if (eduText) {
      const p = path.join(dir, `${baseEdu}_${hhmm}.txt`);
      fs.writeFileSync(p, eduText, "utf8");
      out.eduPath = p;
    }
    return out;
  } catch (e) {
    console.error("[export-bundle]", e);
    return { error: e.message };
  }
});

app.whenReady().then(() => {
  applyContentSecurityPolicy();
  registerIconProtocol();
  createWindow();
  // Run one check on startup (packaged builds only — dev builds would 404)
  if (app.isPackaged) {
    autoUpdater.checkForUpdates().catch(err =>
      console.warn("[updater] startup check failed:", err.message)
    );
  }
});
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
