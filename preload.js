const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {
  isElectron: true,
  getAppInfo: () => ipcRenderer.invoke("get-app-info"),
  getDataDir: () => ipcRenderer.invoke("get-data-dir"),
  setDataDir: (dir) => ipcRenderer.invoke("set-data-dir", dir),
  pickDataDir: () => ipcRenderer.invoke("pick-data-dir"),
  loadModFiles: () => ipcRenderer.invoke("load-mod-files"),
  readEDB: () => ipcRenderer.invoke("read-edb"),
  writeEDB: (content) => ipcRenderer.invoke("write-edb", content),
  readUnits: () => ipcRenderer.invoke("read-units"),
  writeUnits: (obj) => ipcRenderer.invoke("write-units", obj),
  saveTextAs: (defaultName, content) => ipcRenderer.invoke("save-text-as", defaultName, content),
  // EDUMatic xlsm import
  pickEdumaticXlsm: () => ipcRenderer.invoke("pick-edumatic-xlsm"),
  readEdumaticXlsm: (xlsmPath) => ipcRenderer.invoke("read-edumatic-xlsm", xlsmPath),
  // Faction icons — TGA files in data/ui/faction_icons
  findFactionIconsDir: () => ipcRenderer.invoke("find-faction-icons-dir"),
  prewarmIcons: () => ipcRenderer.invoke("prewarm-icons"),
  getModMtimes: () => ipcRenderer.invoke("get-mod-mtimes"),
  toggleRegionHR: (region, hr, mode) => ipcRenderer.invoke("toggle-region-hr", region, hr, mode),
  saveManipulaProject: (payload, suggestedName) => ipcRenderer.invoke("save-manipula-project", payload, suggestedName),
  openManipulaProject: () => ipcRenderer.invoke("open-manipula-project"),
  exportBundle: (edbText, eduText, baseEdb, baseEdu) => ipcRenderer.invoke("export-bundle", edbText, eduText, baseEdb, baseEdu),
  prewarmUnitCards: (list) => ipcRenderer.invoke("prewarm-unit-cards", list),
  checkUnitCards: (list) => ipcRenderer.invoke("check-unit-cards", list),
  getMapRegionsInfo: () => ipcRenderer.invoke("get-map-regions-info"),
  getMapRegionsPixels: () => ipcRenderer.invoke("get-map-regions-pixels"),
  readFactionIcon: (filePath) => ipcRenderer.invoke("read-faction-icon", filePath),
  // Unit cards — TGA files in data/ui/units/<faction>/#<unit>.tga (with fallbacks)
  resolveUnitCard: (faction, unitName, dictionary) => ipcRenderer.invoke("resolve-unit-card", faction, unitName, dictionary),
  resolveUnitInfo: (faction, unitName, dictionary) => ipcRenderer.invoke("resolve-unit-info", faction, unitName, dictionary),
  // Profiles
  listProfiles: () => ipcRenderer.invoke("list-profiles"),
  getActiveProfile: () => ipcRenderer.invoke("get-active-profile"),
  setActiveProfile: (name) => ipcRenderer.invoke("set-active-profile", name),
  duplicateProfile: (from, to) => ipcRenderer.invoke("duplicate-profile", from, to),
  deleteProfile: (name) => ipcRenderer.invoke("delete-profile", name),
  // Backups
  listEdbBackups: () => ipcRenderer.invoke("list-edb-backups"),
  restoreEdbBackup: (path) => ipcRenderer.invoke("restore-edb-backup", path),
  deleteEdbBackup: (path) => ipcRenderer.invoke("delete-edb-backup", path),
  // Auto-updater
  updaterCheck: () => ipcRenderer.invoke("updater-check"),
  updaterQuitAndInstall: () => ipcRenderer.invoke("updater-quit-and-install"),
  getUpdateStatus: () => ipcRenderer.invoke("get-update-status"),
  onUpdateStatus: (callback) => {
    ipcRenderer.on("update-status", (_event, data) => callback(data));
    return () => ipcRenderer.removeAllListeners("update-status");
  },
});

// ── EDU-matic bridge ──
// Mirrors EDU Tool's preload.js. Lets the bundled EDU-matic UI run unmodified inside the
// recruitment-tool window. All handlers are namespaced under "edm-" in main.js so they
// don't collide with our existing "load-mod-files" / "export-edu" / etc.
contextBridge.exposeInMainWorld("eduAPI", {
  isElectron: true,
  pickXlsm: () => ipcRenderer.invoke("edm-pick-xlsm"),
  readFileBinary: (filePath) => ipcRenderer.invoke("edm-read-file-binary", filePath),
  chooseExportDir: () => ipcRenderer.invoke("edm-choose-export-dir"),
  exportEdu: (text, outDir, baseName) => ipcRenderer.invoke("edm-export-edu", text, outDir, baseName),
  revealInFolder: (filePath) => ipcRenderer.invoke("edm-reveal-in-folder", filePath),
  openProject: () => ipcRenderer.invoke("edm-open-project"),
  chooseSaveDir: () => ipcRenderer.invoke("edm-choose-save-dir"),
  readProjectFile: (dir, name) => ipcRenderer.invoke("edm-read-project-file", dir, name),
  writeProjectFile: (dir, name, content) => ipcRenderer.invoke("edm-write-project-file", dir, name, content),
  listProjectFiles: (dir, subdir) => ipcRenderer.invoke("edm-list-project-files", dir, subdir),
  deleteProjectFile: (dir, name) => ipcRenderer.invoke("edm-delete-project-file", dir, name),
  writeProjectBatch: (dir, payload) => ipcRenderer.invoke("edm-write-project-batch", dir, payload),
  readProjectBatch: (dir) => ipcRenderer.invoke("edm-read-project-batch", dir),
  gitAvailable: () => ipcRenderer.invoke("git-available"),
  gitStatus: (dir) => ipcRenderer.invoke("git-status", dir),
  gitPull: (dir) => ipcRenderer.invoke("git-pull", dir),
  gitPush: (dir) => ipcRenderer.invoke("git-push", dir),
  gitFetch: (dir) => ipcRenderer.invoke("git-fetch", dir),
  appendExportUnitsStub: (modDataDir, unitKey, displayName) => ipcRenderer.invoke("append-export-units-stub", modDataDir, unitKey, displayName),
  gitCommitAll: (dir, message) => ipcRenderer.invoke("git-commit-all", dir, message),
  logMessage: (level, text) => ipcRenderer.invoke("edm-log-message", level, text),
  getLogPath: () => ipcRenderer.invoke("edm-get-log-path"),
  revealLogFile: () => ipcRenderer.invoke("edm-reveal-log-file"),
  getUserDataPath: () => ipcRenderer.invoke("edm-get-user-data-path"),
  getAppVersion: () => ipcRenderer.invoke("get-app-info").then(i => i.version),
  // Auto-update bridge — re-uses the recruitment-tool updater so EDU-matic's UI doesn't
  // try to install its own.
  updaterCheck: () => ipcRenderer.invoke("updater-check"),
  updaterQuitAndInstall: () => ipcRenderer.invoke("updater-quit-and-install"),
  onUpdateStatus: (callback) => {
    ipcRenderer.on("update-status", (_event, data) => callback(data));
    return () => ipcRenderer.removeAllListeners("update-status");
  },
});
