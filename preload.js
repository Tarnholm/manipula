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
  onUpdateStatus: (callback) => {
    ipcRenderer.on("update-status", (_event, data) => callback(data));
    return () => ipcRenderer.removeAllListeners("update-status");
  },
});
