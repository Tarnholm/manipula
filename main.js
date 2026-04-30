// main.js — Electron entrypoint for Recruitment Tool
const { app, BrowserWindow, dialog, ipcMain, session } = require("electron");
const path = require("path");
const fs = require("fs");
const { readEdumatic } = require("./xlsmReader");
const { autoUpdater } = require("electron-updater");

const isDev = !app.isPackaged;
const useDevServer = isDev && process.env.DEV_USE_SERVER === "1";
const devServerURL = process.env.DEV_SERVER_URL || "http://localhost:3000";

const DEFAULT_DATA_DIR = "C:\\RIS\\RIS\\data";

// ── Window ──
function applyContentSecurityPolicy() {
  const csp = [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self' data:",
    "connect-src 'self'",
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
    fs.writeFileSync(p, JSON.stringify(obj, null, 2), "utf8");
    return { ok: true, path: p };
  } catch (e) { return { ok: false, reason: e.message }; }
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

function sendUpdateEvent(channel, payload) {
  const win = BrowserWindow.getAllWindows()[0];
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

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
  autoUpdater.quitAndInstall();
  return true;
});

app.whenReady().then(() => {
  applyContentSecurityPolicy();
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
