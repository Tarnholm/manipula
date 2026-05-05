import React, { useEffect, useMemo, useState, useCallback, useRef, Component } from "react";
import { createPortal } from "react-dom";

// Global error trap. The AppErrorBoundary only catches errors thrown
// during render; this picks up everything else (uncaught exceptions
// in event handlers, unhandled promise rejections from async useEffects,
// resource-load failures) and pipes them to the persistent log so we
// can diagnose white-marble crashes that happen before the boundary
// gets a chance to mount.
if (typeof window !== "undefined" && !window.__manipulaErrorTrap) {
  window.__manipulaErrorTrap = true;
  const log = (kind, msg) => {
    try {
      if (window.eduAPI?.logMessage) window.eduAPI.logMessage("error", `[${kind}] ${msg}`);
    } catch {}
  };
  window.addEventListener("error", (e) => {
    log("window.error", (e.error && e.error.stack) || e.message || String(e));
  });
  window.addEventListener("unhandledrejection", (e) => {
    const r = e.reason;
    log("unhandledrejection", (r && r.stack) || (r && r.message) || String(r));
  });
}

// Error boundary so a crash in the editor pane (e.g. a Hook order bug) doesn't blank the
// whole app — it shows a recoverable error message + stack trace instead.
class EditorErrorBoundary extends Component {
  constructor(p) { super(p); this.state = { error: null }; }
  static getDerivedStateFromError(error) { return { error }; }
  componentDidCatch(error, info) { console.error("[editor]", error, info); }
  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: 30, color: "#e88", fontFamily: "Consolas, monospace", fontSize: 12 }}>
          <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 10 }}>Editor crashed: {String(this.state.error.message || this.state.error)}</div>
          <pre style={{ whiteSpace: "pre-wrap", fontSize: 11, color: "#888" }}>{(this.state.error.stack || "").split("\n").slice(0, 8).join("\n")}</pre>
          <button onClick={() => this.setState({ error: null })} style={{ marginTop: 14, background: "#dca64a", color: "#1a1a1a", border: "none", padding: "8px 14px", borderRadius: 6, fontWeight: 700, cursor: "pointer" }}>Try again</button>
        </div>
      );
    }
    return this.props.children;
  }
}
// Top-level error boundary — catches anything that escapes the main App
// tree (e.g. a bad eduProject shape from a malformed project dir on disk
// at startup). Without this, an unhandled render error during boot
// produces a fully-blank window with only the body-background visible
// — the "white marble screen" symptom that's hard to diagnose because
// there's nothing on-screen to copy. This boundary surfaces the actual
// error message and a button to clear the cached project dir so the
// user can recover without reinstalling.
class AppErrorBoundary extends Component {
  constructor(p) { super(p); this.state = { error: null }; }
  static getDerivedStateFromError(error) { return { error }; }
  componentDidCatch(error, info) {
    console.error("[app]", error, info);
    // Tee the failure into the persistent edu-matic.log so the user can
    // send the stack from a fresh boot even when DevTools won't open.
    try {
      if (window.eduAPI?.logMessage) {
        const stack = (error && error.stack) || String(error);
        window.eduAPI.logMessage("error",
          "AppErrorBoundary: " + stack +
          (info && info.componentStack ? "\nComponent stack:" + info.componentStack : "")
        );
      }
    } catch {}
  }
  render() {
    if (!this.state.error) return this.props.children;
    const msg = String(this.state.error.message || this.state.error);
    return (
      <div style={{ padding: 40, color: "#fff", fontFamily: "Consolas, monospace", fontSize: 13, maxWidth: 720, margin: "40px auto", background: "rgba(20,22,23,0.9)", border: "1px solid #d66c6c", borderRadius: 8 }}>
        <div style={{ fontSize: 18, fontWeight: 700, color: "#d66c6c", marginBottom: 12 }}>Manipula failed to start</div>
        <div style={{ marginBottom: 8 }}>{msg}</div>
        <pre style={{ background: "#0e0e0e", padding: 8, borderRadius: 4, fontSize: 11, color: "#bbb", maxHeight: 240, overflow: "auto", whiteSpace: "pre-wrap" }}>{(this.state.error.stack || "").split("\n").slice(0, 12).join("\n")}</pre>
        <div style={{ marginTop: 16, display: "flex", gap: 10, flexWrap: "wrap" }}>
          <button onClick={() => this.setState({ error: null })} style={{ background: "#dca64a", color: "#1a1a1a", border: "none", padding: "8px 14px", borderRadius: 6, fontWeight: 700, cursor: "pointer" }}>Try again</button>
          <button
            onClick={() => { localStorage.removeItem("rt:projectDir"); localStorage.removeItem("rt:lastXlsmPath"); window.location.reload(); }}
            style={{ background: "#3a4a5a", color: "#fff", border: "none", padding: "8px 14px", borderRadius: 6, fontWeight: 700, cursor: "pointer" }}
            title="Clears the cached project + xlsm paths and reloads — use this if the auto-load is what's failing."
          >Forget last project & reload</button>
        </div>
      </div>
    );
  }
}
import UnitList from "./components/UnitList";
import UnitEditor from "./components/UnitEditor";
import BulkEditor from "./components/BulkEditor";
import ValidationView from "./components/ValidationView";
import RosterOverview from "./components/RosterOverview";
import { LightboxProvider } from "./components/UnitCard";
// EDU-matic — bundled second app for generating export_descr_unit.txt from an EDUMatic xlsm.
// Lives in src/edu_matic/ and shares window.eduAPI (defined in preload.js).
import EduMaticApp from "./edu_matic/App";
import { validateUnits, validateFactions, summarize } from "./validation";
import useHistory, { useUndoShortcuts } from "./useHistory";
import { parseEDB, parseEDBAsync, groupByUnit, extractCoreRequires, extractFactions, detectMinTier } from "./parsers/edb";
import { parseFactions } from "./parsers/factions";
import { parseResources } from "./parsers/resources";
import { parseRegions, regionsByHiddenResource } from "./parsers/regions";
import { parseDescrStratFactions, regionToFaction } from "./parsers/strat";
import { parseEDU, parseEDUAsync } from "./parsers/edu";
import { parseStrings, parseStringsAsync } from "./parsers/strings";
import { parseReforms } from "./parsers/reforms";
import { renderAllPreview, applyUnitsToEDB, diffEDB, verifyRoundTrip } from "./generator";
import { migrateV1 } from "./grades";

const api = window.electronAPI;

export default function App() {
  const [info, setInfo] = useState(null);
  const [dataDir, setDataDir] = useState("");
  const [modIndex, setModIndex] = useState({}); // { factions, resources, hiddenResources, regions, aliases, buildings, reforms, unitsByDict, regionsByHR }
  const history = useHistory([], { capacity: 80 });
  const units = history.value;
  const setUnits = history.set;
  // Ctrl+Z / Ctrl+Y route to whichever tab the user is on: EDU Builder
  // walks eduHistory, every other tab walks the recruit-line `history`.
  // Defined further down (eduHistory) and wired via the activeTab read
  // inside the dispatcher closure.

  const [selectedId, setSelectedId] = useState(null);
  const [selectedIds, setSelectedIds] = useState(() => new Set()); // multi-select for bulk-edit
  const [lastClickedId, setLastClickedId] = useState(null); // anchor for shift-click range
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState("");
  const [showImport, setShowImport] = useState(false);
  const [edbText, setEdbText] = useState(""); // raw EDB, kept so we can write back
  const [activeTab, setActiveTab] = useState("editor"); // editor | exportAll
  const [profiles, setProfiles] = useState([]);
  const [activeProfile, setActiveProfile] = useState("default");
  const [showBackups, setShowBackups] = useState(false);
  const [backups, setBackups] = useState([]);
  const [listFilter, setListFilter] = useState({ mode: "none", value: "" });

  // ── Initial load ──
  useEffect(() => {
    if (!api) return;
    api.getAppInfo().then(setInfo);
    api.getDataDir().then(setDataDir);
    api.getActiveProfile().then(setActiveProfile);
    api.listProfiles().then(setProfiles);
    api.readUnits().then(d => history.reset((d.units || []).map(migrateV1)));
    // Pull cached update status (for events the main process fired before this listener attached).
    if (api.getUpdateStatus) api.getUpdateStatus().then(s => { if (s) setUpdateStatus(s); });
    // Subscribe to live update events going forward.
    const unsub = api.onUpdateStatus && api.onUpdateStatus((s) => setUpdateStatus(s));

    // Auto-load on launch. Project directory takes priority — once a user
    // has saved a Manipula project folder, that's the source of truth for
    // every subsequent session. Falls back to the last imported xlsm only
    // if no project dir is remembered (first run after install, or before
    // the user has saved their first project).
    let cancelled = false;
    (async () => {
      const lastProject = localStorage.getItem("rt:projectDir");
      if (lastProject) {
        try {
          const { isProjectDir, loadProject } = await import("./projectStore");
          if (await isProjectDir(lastProject)) {
            const { eduProject: loadedEdu, units: loadedUnits, exports: loadedExports } = await loadProject(lastProject);
            if (cancelled) return;
            if (loadedEdu && (loadedEdu.units || loadedEdu.factions || loadedEdu.coreData)) eduHistory.reset(loadedEdu);
            if (loadedUnits && loadedUnits.length) {
              history.reset(loadedUnits.map(migrateV1));
              if (api && api.writeUnits) api.writeUnits({ units: loadedUnits });
            }
            setEduProjectSource(lastProject);
            setProjectDir(lastProject);
            setProjectExports(loadedExports || {});
            setStatus(`Loaded project — ${(loadedUnits || []).length} recruit-lines · ${(loadedEdu?.units || []).length} EDU units`);
            return;
          }
        } catch (e) {
          // Corrupt / moved project dir — fall through to xlsm auto-load.
          console.warn("[project] auto-load skipped:", e && e.message);
        }
      }
      // Fallback: last xlsm.
      const lastPath = localStorage.getItem("rt:lastXlsmPath");
      if (!lastPath || !window.eduAPI || !window.eduAPI.readFileBinary) return;
      try {
        const bytes = await window.eduAPI.readFileBinary(lastPath);
        if (cancelled || !bytes) return;
        const buf = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
        const { importXlsmBuffer } = await import("./edu_matic/xlsmImporter");
        const eduProj = importXlsmBuffer(buf);
        if (cancelled) return;
        eduHistory.reset(eduProj);
        captureEduSnapshot(eduProj);
        setEduProjectSource(lastPath);
        setStatus(`Auto-loaded ${lastPath.split(/[\\/]/).pop()}`);
      } catch (e) {
        console.warn("[edu] auto-load skipped:", e && e.message);
      }
    })();

    return () => {
      cancelled = true;
      if (typeof unsub === "function") unsub();
    };
    // eslint-disable-next-line
  }, []);

  const switchProfile = useCallback(async (name) => {
    if (!api) return;
    await api.setActiveProfile(name);
    setActiveProfile(name);
    setProfiles(await api.listProfiles());
    const d = await api.readUnits();
    history.reset((d.units || []).map(migrateV1));
    setSelectedId(null);
    setStatus(`Switched to profile "${name}".`);
  }, []);

  const newProfile = useCallback(async () => {
    if (!api) return;
    const name = window.prompt("New profile name:", "experimental");
    if (!name) return;
    const r = await api.duplicateProfile(activeProfile, name);
    if (r.ok) { switchProfile(name); }
    else setStatus("Failed to create profile: " + r.reason);
  }, [activeProfile, switchProfile]);

  const deleteCurrentProfile = useCallback(async () => {
    if (!api) return;
    if (activeProfile === "default") { alert("Cannot delete the default profile."); return; }
    if (!window.confirm(`Delete profile "${activeProfile}"? This cannot be undone.`)) return;
    await api.deleteProfile(activeProfile);
    switchProfile("default");
  }, [activeProfile, switchProfile]);

  const openBackups = useCallback(async () => {
    if (!api) return;
    const list = await api.listEdbBackups();
    setBackups(list);
    setShowBackups(true);
  }, []);

  const restoreBackup = useCallback(async (b) => {
    if (!window.confirm(`Restore EDB from ${b.name}?\nA pre-restore backup will be saved automatically.`)) return;
    const r = await api.restoreEdbBackup(b.path);
    if (r.ok) {
      setStatus(`Restored. Pre-restore backup: ${r.preRestoreBackup}`);
      setShowBackups(false);
      await loadMod();
    } else setStatus("Restore failed: " + r.reason);
  }, []);

  const loadMod = useCallback(async () => {
    setLoading(true); setStatus("Loading mod files…");
    // Yield to the event loop between each big parse step so the UI stays responsive while
    // mod data (potentially 10MB+ of text) is parsed. Without this, the renderer thread
    // is blocked for seconds on app start and the window appears frozen.
    const tick = () => new Promise(r => setTimeout(r, 0));
    try {
      const r = await api.loadModFiles();
      if (!r.ok) { setStatus("Failed: " + (r.reason || "?")); return; }
      if (r.missing && r.missing.length) {
        setStatus("Missing: " + r.missing.join(", "));
      }
      const f = r.files;
      setStatus("Parsing factions…"); await tick();
      const factions = f.factions ? parseFactions(f.factions) : [];
      setStatus("Parsing resources…"); await tick();
      const { resources, hiddenResources } = f.resources ? parseResources(f.resources) : { resources: [], hiddenResources: [] };
      setStatus("Parsing regions…"); await tick();
      const regions = f.regions ? parseRegions(f.regions) : [];
      setStatus("Parsing campaign ownership…"); await tick();
      const stratFactions = f.strat ? parseDescrStratFactions(f.strat) : {};
      const regionOwner = regionToFaction(stratFactions);
      for (const r of regions) {
        const stratOwner = regionOwner[r.region];
        if (stratOwner) r.stratOwner = stratOwner;
      }
      setStatus("Parsing units (EDU)…"); await tick();
      const edu = f.edu ? await parseEDUAsync(f.edu) : [];
      setStatus("Parsing strings…"); await tick();
      const unitStrings = f.units ? await parseStringsAsync(f.units) : {};
      await tick();

      // Region HR index — needed by the unit list / map filters, fast to build.
      const regionsByHR = {};
      for (const r of regions) for (const t of r.traits) {
        if (!regionsByHR[t]) regionsByHR[t] = [];
        regionsByHR[t].push(r);
      }
      const hrEffective = hiddenResources.slice();

      const eduByType = new Map(edu.map(u => [u.type, u]));
      const unitDisplayName = (recruitName) => {
        const u = eduByType.get(recruitName);
        if (!u) return null;
        const k = u.dictionary || recruitName.replace(/\s+/g, "_");
        return unitStrings[k] || null;
      };
      let factionIconsDir = null;
      try { factionIconsDir = await api.findFactionIconsDir(); } catch {}
      try { if (api.prewarmIcons) api.prewarmIcons(); } catch {}

      // ── PARTIAL setModIndex (≈70% point) ──
      // We have everything the UI needs to render the unit list, faction icons, region map,
      // and unit editor. Reforms / building strings / EDB parse are still expensive — defer
      // them to the next ticks so the splash can drop and the user can interact.
      setModIndex({
        factions, resources, hiddenResources: hrEffective, regions, regionsByHR,
        stratFactions, regionOwner,
        aliases: [], buildings: [], recruits: [],
        reforms: [], scriptFiles: [], edu, eduByType,
        strings: { units: unitStrings, buildings: {}, expandedBi: {} },
        unitDisplayName,
        factionIconsDir,
      });
      setLoadComplete(true);
      setStatus("Loading the rest in background…");
      // Yield enough for the splash drop animation + initial paint to settle.
      await tick(); await tick();

      // Background: finish parsing reforms, building strings, expanded_bi, and EDB. Each
      // step uses the async variant so the renderer thread stays responsive while parsing
      // the multi-MB string and EDB files.
      const buildingStrings = f.buildings ? await parseStringsAsync(f.buildings) : {};
      await tick();
      const expandedBi = f.expandedBi ? await parseStringsAsync(f.expandedBi) : {};
      setStatus("Parsing reforms…"); await tick();
      const { reforms, scriptFiles } = f.events ? parseReforms(f.events, f.eventScriptFiles || []) : { reforms: [], scriptFiles: [] };
      setStatus("Parsing buildings (EDB)…"); await tick();
      const edb = f.edb ? await parseEDBAsync(f.edb) : { aliases: [], buildings: [], recruits: [] };
      await tick();

      setModIndex(prev => ({
        ...prev,
        aliases: edb.aliases, buildings: edb.buildings, recruits: edb.recruits,
        reforms, scriptFiles,
        strings: { ...prev.strings, buildings: buildingStrings, expandedBi },
      }));
      setEdbText(f.edb || "");
      setStatus(`Loaded: ${factions.length} factions, ${resources.length} resources, ${hiddenResources.length} hidden, ${regions.length} regions, ${edb.recruits.length} recruit lines, ${reforms.length} reforms.`);
    } catch (e) {
      console.error(e);
      setStatus("Error: " + e.message);
      setLoadComplete(true);
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { if (api && dataDir) loadMod(); }, [dataDir, loadMod]);

  // mtime watch — when the user returns to the window after editing files in another tool
  // (e.g. EDU-matic standalone, a text editor), check the key mod files and prompt for a
  // reload if any are newer than what we last loaded.
  const lastLoadMtimes = React.useRef({});
  useEffect(() => {
    if (!api?.getModMtimes) return;
    api.getModMtimes().then(m => { lastLoadMtimes.current = m || {}; });
    let prompting = false;
    const onFocus = async () => {
      if (prompting) return;
      try {
        const cur = await api.getModMtimes();
        if (!cur) return;
        const last = lastLoadMtimes.current || {};
        const stale = Object.entries(cur).filter(([k, v]) => v && last[k] && v > last[k]).map(([k]) => k);
        if (stale.length === 0) return;
        prompting = true;
        const ok = window.confirm(`Mod files changed on disk: ${stale.join(", ")}\n\nReload now?`);
        prompting = false;
        if (ok) { lastLoadMtimes.current = cur; loadMod(); }
        else lastLoadMtimes.current = cur; // dismiss — don't keep prompting for the same change
      } catch {}
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [loadMod]);

  const selected = units.find(u => u.id === selectedId);
  const bulkSelected = units.filter(u => selectedIds.has(u.id));

  const onUnitClick = (id, ev) => {
    if (ev && (ev.ctrlKey || ev.metaKey)) {
      const next = new Set(selectedIds);
      next.has(id) ? next.delete(id) : next.add(id);
      setSelectedIds(next);
      setLastClickedId(id);
      setSelectedId(null); // bulk mode
    } else if (ev && ev.shiftKey && lastClickedId) {
      // Range select between lastClickedId and id (over the current filtered list).
      // For simplicity, range = positions in `units`.
      const a = units.findIndex(u => u.id === lastClickedId);
      const b = units.findIndex(u => u.id === id);
      if (a >= 0 && b >= 0) {
        const [lo, hi] = a < b ? [a, b] : [b, a];
        const next = new Set(selectedIds);
        for (let i = lo; i <= hi; i++) next.add(units[i].id);
        setSelectedIds(next);
        setSelectedId(null);
      }
    } else {
      setSelectedIds(new Set());
      setSelectedId(id);
      setLastClickedId(id);
    }
  };
  const clearSelection = () => { setSelectedIds(new Set()); };

  const applyBulk = (transform) => {
    const next = units.map(u => selectedIds.has(u.id) ? transform(u) : u);
    persistUnits(next);
    setStatus(`Bulk-applied to ${selectedIds.size} units.`);
  };

  const persistUnits = useCallback((next) => {
    setUnits(next);
  }, [setUnits]);

  // Debounced persistence: every history change writes to disk after 350ms idle.
  useEffect(() => {
    if (!api) return;
    const t = setTimeout(() => { api.writeUnits({ units }); }, 350);
    return () => clearTimeout(t);
  }, [units]);

  const onChangeUnit = (patched) => {
    const next = units.map(u => u.id === patched.id ? patched : u);
    persistUnits(next);
  };

  const onAdd = () => {
    const id = "unit_" + Date.now().toString(36);
    const newUnit = migrateV1({
      id, unit: "new unit", enabled: true, minTier: 1, factions: [], requires: [],
    });
    newUnit.writeBack = true;
    persistUnits([newUnit, ...units]);
    setSelectedId(id);
  };

  const onCreateFromEDU = (eduEntry) => {
    if (!eduEntry) return;
    const id = "unit_" + Date.now().toString(36);
    const factions = (eduEntry.ownership || []).filter(o => o !== "slave");
    const isAor = eduEntry.type.startsWith("aor ");
    const v1 = {
      id, unit: eduEntry.type, enabled: true, minTier: 1,
      factions: isAor ? ["all"] : factions,
      excludeFactions: isAor ? factions : [],
      unitType: isAor ? "aor" : "faction",
      requires: [],
      notes: `Created from EDU entry (${eduEntry.category || "?"} / ${eduEntry.class || "?"})`,
    };
    const u = migrateV1(v1);
    u.writeBack = true; // user is actively authoring this from a ghost — default to writable
    persistUnits([u, ...units]);
    setSelectedId(id);
    setStatus(`Created "${eduEntry.type}" from EDU. Pick a Grade and set any required hidden_resource before saving.`);
  };

  const onDelete = (id) => {
    persistUnits(units.filter(u => u.id !== id));
    if (selectedId === id) setSelectedId(null);
  };

  const onDuplicate = (id) => {
    const src = units.find(u => u.id === id);
    if (!src) return;
    // Prompt for the new recruit name up front so the user doesn't have to immediately
    // rename "X (copy)" to something sensible. Defaults to the (copy) form on cancel.
    const proposed = window.prompt(`Duplicate "${src.unit}" — new recruit name:`, src.unit + "_2");
    if (proposed === null) return; // user cancelled
    const newName = (proposed || "").trim() || (src.unit + " (copy)");
    const newId = "unit_" + Date.now().toString(36);
    const dup = migrateV1({ ...src, id: newId, unit: newName });
    persistUnits([dup, ...units]);
    setSelectedId(newId);
  };

  // One-click cleanup: set every unit whose notes mention "Imported" (or contain a typical
  // import-source phrase) to reference-only. Handy for profiles where writeBack got flipped
  // accidentally across many imports.
  const resetImportsToReferenceOnly = useCallback(() => {
    if (!units.length) return;
    const matchedCount = units.filter(u => isImportedUnit(u)).length;
    if (matchedCount === 0) { setStatus("No imported units found in this profile."); return; }
    if (!window.confirm(
      `Set ${matchedCount} imported units to reference-only (writeBack: off)?\n\n` +
      `This affects every unit whose notes mention "Imported" — i.e. units brought in via\n` +
      `Import-from-EDB or Import-EDUMatic. Manually authored units stay untouched.`
    )) return;
    const next = units.map(u => isImportedUnit(u) ? { ...u, writeBack: false, writeBackUserSet: true } : u);
    persistUnits(next);
    setStatus(`Set ${matchedCount} imported units to reference-only.`);
  }, [units]);

  const importFromEdumatic = async () => {
    if (!api) return;
    const p = await api.pickEdumaticXlsm();
    if (!p) return;
    // Re-import detection: if the user picks the same xlsm twice in a row, ask whether
    // they want to refresh (replace existing imported units) vs append (current default).
    const lastSrc = localStorage.getItem("rt:lastXlsmPath");
    if (lastSrc === p && eduProject) {
      const choice = window.confirm(`This is the same xlsm you imported last time:\n${p}\n\nRefresh (replace existing imported units) — OK\nAppend (keep current + add new) — Cancel`);
      if (choice) {
        // refresh: reset eduProject + drop import-flagged units before re-importing
        eduHistory.reset(null);
      }
    }
    localStorage.setItem("rt:lastXlsmPath", p);
    setStatus("Reading " + p + "…");
    const r = await api.readEdumaticXlsm(p);
    if (!r.ok) { setStatus("Failed: " + r.reason); return; }
    const sel = new Set(r.rows.map((_, i) => i));
    setEdumaticPreview({ source: r.source, rows: r.rows, selected: sel });
    // Same xlsm — feed it to the EDU Builder side too. One pick = one project across both
    // halves of the app, instead of forcing the user to import twice.
    try {
      if (window.eduAPI && window.eduAPI.readFileBinary) {
        const bytes = await window.eduAPI.readFileBinary(p);
        if (bytes) {
          const buf = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
          const { importXlsmBuffer } = await import("./edu_matic/xlsmImporter");
          const eduProj = importXlsmBuffer(buf);
          eduHistory.reset(eduProj);
          captureEduSnapshot(eduProj);
          setEduProjectSource(p);
        }
      }
    } catch (e) { console.warn("[edu] import failed:", e.message); }
    setStatus(`Parsed ${r.count} rows from ${r.source}` + (eduProject ? " · EDU project also loaded" : ""));
    toast(`Imported ${r.count} units from ${r.source.split(/[\\/]/).pop()}`, "success");
  };

  const confirmEdumaticImport = () => {
    if (!edumaticPreview) return;
    const existing = new Set(units.map(u => u.unit));
    const toImport = edumaticPreview.rows.filter((_, i) => edumaticPreview.selected.has(i));
    const newUnits = [];
    let skipped = 0;
    for (const row of toImport) {
      if (existing.has(row.unit)) { skipped++; continue; }
      const v1 = {
        id: "u_" + row.unit.replace(/[^a-z0-9]+/gi, "_").toLowerCase().slice(0, 40) + "_" + Math.random().toString(36).slice(2, 6),
        unit: row.unit,
        enabled: true,
        unitType: row.isAor ? "aor" : "faction",
        chain: "MIC",
        minTier: row.tier,
        factions: row.factions,
        excludeFactions: row.excludeFactions,
        requires: row.commonRequires,
        xp: row.xpVal > 0 ? { startTier: row.tier, value: row.xpVal } : null,
        notes: `Imported from EDUMatic: ${edumaticPreview.source.split(/[/\\]/).pop()}`,
      };
      const u = migrateV1(v1);
      u.qualityClass = row.qualityClass || null;
      u.colonyTier = row.colonyTier;
      u.outsideExtras = row.outsideExtras;
      u.writeBack = false; // EDUMatic imports are reference-only by default — flip in editor to write
      newUnits.push(u);
    }
    persistUnits([...newUnits, ...units]);
    setStatus(`Imported ${newUnits.length} units${skipped ? ` (${skipped} skipped — already authored)` : ""}.`);
    setEdumaticPreview(null);
  };

  const importFromEDB = async () => {
    if (!modIndex.recruits) { alert("Load mod files first."); return; }
    const groups = groupByUnit(modIndex.recruits);
    const imported = [];
    for (const [unitName, g] of groups) {
      // Sub-group by (factions, excludeFactions, core requires) signature so that units with
      // multiple per-faction or per-region variants in the original EDB stay as separate entries.
      // Without this, e.g. `merc bithynian thureophoroi` ptolemaic variant and antigonid variant
      // would be unioned into one over-broad unit. Each distinct signature becomes its own entry.
      const sigKey = (e) => {
        const facs = extractFactions(e.requires).slice().sort().join("|");
        const ex = (e.requires.match(/not factions\s*\{\s*([^}]*)\}/) || [, ""])[1]
          .split(",").map(s => s.trim()).filter(Boolean).sort().join("|");
        const core = extractCoreRequires(e.requires).slice().sort().join("|");
        return `${facs}::${ex}::${core}`;
      };
      const variants = new Map(); // sigKey → entries[]
      for (const e of g.entries) {
        const k = sigKey(e);
        if (!variants.has(k)) variants.set(k, []);
        variants.get(k).push(e);
      }
      const variantList = [...variants.values()];
      const variantCount = variantList.length;

      for (let vi = 0; vi < variantList.length; vi++) {
        const variantEntries = variantList[vi];
        const aiLines = variantEntries.filter(e => /\bnot is_player\b/.test(e.requires));
        const playerLines = variantEntries.filter(e => /\bis_player\b/.test(e.requires) && !/\bnot is_player\b/.test(e.requires));
        const sample = playerLines[0] || aiLines[0];
        if (!sample) continue;

        const unitType = playerLines.some(e => e.building === "hinterland_region") ? "aor" : "faction";

        // Variant-specific factions + excludeFactions + requires (no union across variants).
        const factions = extractFactions(sample.requires);
        const excludeFactions = (() => {
          const m = sample.requires.match(/not factions\s*\{\s*([^}]*)\}/);
          return m ? m[1].split(",").map(s => s.trim()).filter(Boolean) : [];
        })();
        const tiers = playerLines.map(e => detectMinTier(e.requires)).filter(t => t != null);
        const minTier = tiers.length ? Math.min(...tiers) : 1;
        const requires = uniqueRequires(variantEntries.map(e => extractCoreRequires(e.requires)));

        const xpEntries = aiLines.filter(e => e.xp > 0);
        let xp = null;
        if (xpEntries.length) {
          const micXp = xpEntries.filter(e => e.building === "military_industrial_complex");
          if (micXp.length) {
            const t = Math.min(...micXp.map(e => parseInt((e.level.match(/^mic_(\d)$/) || [])[1] || "99", 10)));
            xp = { startTier: t, value: Math.max(...xpEntries.map(e => e.xp)) };
          } else {
            xp = { startTier: 4, value: Math.max(...xpEntries.map(e => e.xp)) };
          }
        }

        // Discriminator label for multi-variant units (helps in the list).
        const variantLabel = variantCount > 1
          ? ` [variant ${vi + 1}/${variantCount}: ${factions.slice(0, 3).join(",") || "all"}]`
          : "";

        const v1Unit = {
          id: "u_" + unitName.replace(/[^a-z0-9]+/gi, "_").toLowerCase().slice(0, 40) + "_v" + vi + "_" + Math.random().toString(36).slice(2, 6),
          unit: unitName,
          enabled: true,
          unitType,
          chain: "MIC",
          minTier: Number.isFinite(minTier) ? minTier : 1,
          factions,
          excludeFactions,
          requires,
          xp,
          notes: `Imported from EDB (${variantEntries.length} lines, ${unitType})${variantLabel}`,
        };
        const u = migrateV1(v1Unit);
        u.writeBack = false;
        imported.push(u);
      }
    }
    if (!window.confirm(`Import ${imported.length} units from EDB?\nThis replaces your current units.json.`)) return;
    history.reset(imported);
    if (api) await api.writeUnits({ units: imported });
    setStatus(`Imported ${imported.length} units from EDB.`);
  };

  const [diff, setDiff] = useState(null); // { added, removed, kept } | null
  // Conflict resolver state — populated when previewWriteBack detects
  // that the on-disk EDB has changed since Manipula's last export.
  // Keeps the freshly-read EDB text on hand so the resolver's actions
  // (Show diff / Overwrite anyway) don't have to re-read it. null
  // when no conflict is active.
  const [edbConflict, setEdbConflict] = useState(null);
  const [edumaticPreview, setEdumaticPreview] = useState(null); // { source, rows, selected: Set } | null
  const [updateStatus, setUpdateStatus] = useState(null); // { state: "available"|"downloading"|"downloaded"|"error", ... } | null
  // EDU-matic shared state — when set, the EDU Builder tab uses this project. A single xlsm
  // import populates both this and the recruitment-side import in one action.
  // (Bulk-blame useEffect moved further down — its deps array reads
  // `projectDir` and `projectSaveTick`, which are declared after this
  // point in the file. JS deps-array evaluation at the original location
  // hit those constants in TDZ and threw ReferenceError ("Cannot access
  // 'Ee' before initialization") — the marble-window crash. Effect now
  // sits after both state declarations so deps eval is safe.)

  // Capture an EDU import snapshot — keyed by canonical unit key, value
  // is a djb2 *hash* of the JSON at import time (not the JSON itself).
  // The Units screen compares hashes to flag "modified since import" in
  // O(1) per unit; storing full JSON would be ~500KB-1MB and force a
  // full string-compare per row on every render under bulk edit.
  const captureEduSnapshot = useCallback((eduProj) => {
    if (!eduProj || !Array.isArray(eduProj.units)) { setEduImportSnapshot(null); return; }
    const out = {};
    for (const u of eduProj.units) {
      if (!u || u.kind !== "unit") continue;
      const key = String(u["unit id"] || u.dictionary_tag || u.name || "").trim();
      if (!key) continue;
      try {
        const s = JSON.stringify(u);
        let h = 5381;
        for (let j = 0; j < s.length; j++) h = ((h << 5) + h + s.charCodeAt(j)) | 0;
        out[key] = (h >>> 0).toString(16);
      } catch {}
    }
    setEduImportSnapshot(out);
  }, []);

  // EDU project history — Ctrl+Z / Ctrl+Y on the EDU Builder tab walks
  // back through every project mutation (cell edit, add/duplicate/delete
  // row, etc). useHistory snapshots via JSON.stringify so the past stack
  // is robust to nested object refs. Initial null is reset(...) when a
  // project is loaded / imported / opened.
  const eduHistory = useHistory(null, { capacity: 50 });
  const eduProject = eduHistory.value;
  const setEduProject = eduHistory.set;
  useUndoShortcuts({
    undo: () => (activeTab === "edu" ? eduHistory.undo() : history.undo()),
    redo: () => (activeTab === "edu" ? eduHistory.redo() : history.redo()),
  });

  // (loadProjectFromDir moved further down — its deps reference eduDirty
  // and the project-state setters that are declared later in the function.
  // Defined after every binding it reads so deps-array eval is safe.)
  const [eduView, setEduView] = useState("project"); // sub-view inside EDU Builder tab
  const [eduProjectSource, setEduProjectSource] = useState(null); // path of the xlsm last imported, for the topbar pill
  // Active Manipula project directory — null means "no project open yet,
  // working from a fresh xlsm import or empty state". Persisted to
  // localStorage so the tool reopens the last project on launch.
  const [projectDir, setProjectDir] = useState(null);
  // Clone-from-GitHub modal state. null when closed; { url, parent, leaf,
  // busy?, log? } when open. Lets teammates onboard without a terminal.
  const [cloneModal, setCloneModal] = useState(null);
  // Snapshot of the EDU units at the last xlsm import, keyed by canonical
  // unit key (unit id || dictionary_tag || name). Used to drive the
  // "modified since last import" row marker in the Units table — at a
  // glance the user can see which rows have drifted from the spreadsheet
  // since the last reimport.
  const [eduImportSnapshot, setEduImportSnapshot] = useState(null);
  // Bulk per-file git blame for the project dir. Shape:
  //   Map<relPathLowercase, { hash, author, age }>
  // Keyed by lowercased relative path so the lookup is case-insensitive
  // (Windows). Populated once on project-dir set + after every save tick;
  // empty when the project isn't a git repo or git isn't on PATH. Drives
  // the per-row "last edited by …" tooltip in the EDU Units table.
  const [projectBlame, setProjectBlame] = useState(() => new Map());
  // Bumped on every successful Save Project. Watched by SyncButton so it
  // re-runs git status the moment the user hits save — without this the
  // dot stays stale on green for up to 5s (the polling cadence) after
  // touching disk.
  const [projectSaveTick, setProjectSaveTick] = useState(0);

  // Bulk-blame fetch + parse. One git log --name-only call returns every
  // touched file in the recent 500 commits; we walk it once and remember
  // the FIRST commit each file appears in (which by git log's reverse-
  // chronological default is the most recent commit). 800 lookups for
  // tooltips become O(1) Map.get instead of 800 IPC calls.
  // *Must live after projectDir / projectSaveTick declarations* — its
  // deps array reads those bindings, and they're TDZ-protected
  // until the const lines above complete.
  useEffect(() => {
    if (!projectDir || !window.eduAPI?.gitLogBulk) { setProjectBlame(new Map()); return; }
    let cancelled = false;
    (async () => {
      try {
        const r = await window.eduAPI.gitLogBulk(projectDir);
        if (cancelled || !r || !r.ok) { setProjectBlame(new Map()); return; }
        const map = new Map();
        const commits = (r.stdout || "").split("!!!COMMIT!!!").filter(Boolean);
        for (const block of commits) {
          const lines = block.split(/\r?\n/);
          const meta = lines[0] || "";
          const [hash, author, age] = meta.split("|");
          if (!hash) continue;
          for (let i = 1; i < lines.length; i++) {
            const path = lines[i].trim();
            if (!path) continue;
            const key = path.toLowerCase();
            // First time we see a file is the most recent commit (git log
            // is reverse-chrono by default). Skip if already mapped.
            if (!map.has(key)) map.set(key, { hash, author, age });
          }
        }
        setProjectBlame(map);
      } catch (e) {
        console.warn("[blame] bulk fetch failed:", e && e.message);
        setProjectBlame(new Map());
      }
    })();
    return () => { cancelled = true; };
  }, [projectDir, projectSaveTick]);

  // Export hashes per file kind ("edb" / "edu") captured at last write-out.
  // Used to detect "the game file changed under us since we last exported"
  // and warn before clobbering external edits — the missing piece between
  // round-trip and clean-break for hand-authored EDB tweaks.
  const [projectExports, setProjectExports] = useState({});
  // EDU dirty state — flips on whenever the eduProject is mutated post-import (bulk
  // edit, stub creation, etc.). Cleared when the user exports or re-imports.
  const [eduDirty, setEduDirty] = useState(false);
  const setEduProjectAndMark = useCallback((proj) => {
    setEduProject(proj);
    setEduDirty(true);
  }, []);
  // Warn before window close if EDU has unsaved changes.
  useEffect(() => {
    const handler = (e) => {
      if (eduDirty) { e.preventDefault(); e.returnValue = ""; return ""; }
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [eduDirty]);
  // Welcome panel — first-launch onboarding. Dismissible forever via the
  // "don't show again" checkbox. The checkbox state is tracked here (not
  // via defaultChecked on the <input>) so that the dismissed flag is
  // persisted whenever the user clicks Get Started — including the
  // common case where they never interact with the checkbox at all and
  // just expect "yes, please don't show this again" to be the default.
  const [showWelcome, setShowWelcome] = useState(() => localStorage.getItem("rt:welcomeDismissed") !== "1");
  const [welcomeDontShow, setWelcomeDontShow] = useState(true);
  // Toast notifications — small queue with auto-expiry so action feedback (writes, exports,
  // imports) is visible at a glance instead of buried in the status bar.
  const [toasts, setToasts] = useState([]);
  const toast = useCallback((text, kind = "info", ms = 3500) => {
    const id = Date.now() + Math.random();
    setToasts(t => [...t, { id, text, kind }]);
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), ms);
  }, []);

  // Shared "open this directory as a project" path — used by the Open
  // Project picker AND by the Clone-from-GitHub flow once the clone
  // finishes. Validates the sentinel, loads, sets all the surrounding
  // state (eduHistory, units history, projectDir, projectExports,
  // eduProjectSource), persists to localStorage, surfaces a toast.
  // Lives here so it's positioned AFTER all state-setter declarations
  // it reads (eduDirty et al) — moving it earlier hits the same
  // useEffect-deps TDZ trap that produced the v0.25.5 marble window.
  const loadProjectFromDir = useCallback(async (dir) => {
    if (!dir) return false;
    try {
      const { isProjectDir, loadProject } = await import("./projectStore");
      if (!(await isProjectDir(dir))) {
        toast("Not a Manipula project folder (no manipula.project.json)", "error");
        return false;
      }
      if (eduDirty && !window.confirm("You have unsaved changes. Open another project anyway?")) return false;
      const { eduProject: loadedEdu, units: loadedUnits, exports: loadedExports } = await loadProject(dir);
      if (loadedEdu && (loadedEdu.units || loadedEdu.factions || loadedEdu.coreData)) eduHistory.reset(loadedEdu);
      if (loadedUnits && loadedUnits.length) {
        history.reset(loadedUnits.map(migrateV1));
        if (api) await api.writeUnits({ units: loadedUnits });
      }
      setEduProjectSource(dir);
      setProjectDir(dir);
      setProjectExports(loadedExports || {});
      setEduDirty(false);
      localStorage.setItem("rt:projectDir", dir);
      toast(`Loaded project — ${(loadedUnits || []).length} recruit-lines · ${(loadedEdu?.units || []).length} EDU units`, "success");
      return true;
    } catch (e) { toast("Open failed: " + e.message, "error"); return false; }
    // eslint-disable-next-line
  }, [api, eduDirty, toast]);

  // Splash overlay — shown for SPLASH_MIN_MS (or until loadMod completes, whichever is later).
  // Mirrors Provincia's pattern: the user sees a polished cover instead of a blank, half-rendered
  // window while the parsers chew through ~10MB of mod text.
  const [showSplash, setShowSplash] = useState(true);
  const [loadComplete, setLoadComplete] = useState(false);
  const SPLASH_MIN_MS = 350;
  useEffect(() => {
    const splashStart = Date.now();
    const tick = () => {
      const elapsed = Date.now() - splashStart;
      const remaining = Math.max(0, SPLASH_MIN_MS - elapsed);
      if (loadComplete) setTimeout(() => setShowSplash(false), remaining);
    };
    tick();
  }, [loadComplete]);
  const [missingCards, setMissingCards] = useState(() => new Set()); // recruit names with no unit_card.tga in mod data
  const [findReplaceOpen, setFindReplaceOpen] = useState(false);
  // Resizable left-sidebar — persisted in localStorage so the user's preferred width sticks
  // across launches.
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    const v = parseInt(localStorage.getItem("rt:sidebarWidth") || "320", 10);
    return Number.isFinite(v) && v >= 220 && v <= 720 ? v : 320;
  });
  useEffect(() => { localStorage.setItem("rt:sidebarWidth", String(sidebarWidth)); }, [sidebarWidth]);
  const sidebarDragRef = React.useRef(null);
  // Theme — sepia is the original gold-on-dark, "ink" is a colder grayscale alternative.
  const [theme, setTheme] = useState(() => localStorage.getItem("rt:theme") || "sepia");
  useEffect(() => {
    localStorage.setItem("rt:theme", theme);
    document.documentElement.setAttribute("data-rt-theme", theme);
  }, [theme]);

  // Drag-and-drop a .xlsm onto the window — same effect as clicking Import xlsm.
  useEffect(() => {
    const onDragOver = (e) => { e.preventDefault(); e.dataTransfer.dropEffect = "copy"; };
    const onDrop = async (e) => {
      e.preventDefault();
      const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if (!f || !/\.xlsm?$|\.xlsx?$/i.test(f.name)) return;
      try {
        const buf = new Uint8Array(await f.arrayBuffer());
        const { importXlsmBuffer } = await import("./edu_matic/xlsmImporter");
        const eduProj = importXlsmBuffer(buf);
        eduHistory.reset(eduProj);
        captureEduSnapshot(eduProj);
        setEduProjectSource(f.name);
        setStatus(`Imported ${f.name} via drag-drop · ${eduProj.units.length} EDU rows`);
        toast(`Imported ${f.name}`, "success");
      } catch (err) { setStatus("Drag-drop import failed: " + err.message); toast("Drag-drop failed: " + err.message, "error"); }
    };
    window.addEventListener("dragover", onDragOver);
    window.addEventListener("drop", onDrop);
    return () => { window.removeEventListener("dragover", onDragOver); window.removeEventListener("drop", onDrop); };
  }, []);

  // Keyboard shortcuts. Ctrl+S writes to EDB, Ctrl+E exports the bundle, Ctrl+F focuses
  // the topbar quick-search, Ctrl+1..4 cycles tabs. Skipped when typing in an input/
  // textarea so we don't steal Ctrl+A / Ctrl+Z from text editing.
  useEffect(() => {
    const handler = (e) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      const tag = (e.target && e.target.tagName) || "";
      const isText = tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
      const k = e.key.toLowerCase();
      if (k === "s" && !isText) { e.preventDefault(); document.querySelector("[data-rtshortcut='write-edb']")?.click(); }
      else if (k === "e" && !isText) { e.preventDefault(); document.querySelector("[data-rtshortcut='export-bundle']")?.click(); }
      else if (k === "f" && !isText) { e.preventDefault(); document.querySelector("[data-rtshortcut='quick-search']")?.focus(); }
      else if (k === "1") { e.preventDefault(); setActiveTab("editor"); }
      else if (k === "2") { e.preventDefault(); setActiveTab("validation"); }
      else if (k === "3") { e.preventDefault(); setActiveTab("exportAll"); }
      else if (k === "4") { e.preventDefault(); setActiveTab("edu"); }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  const applyFindReplace = useCallback(({ find, replace }) => {
    if (!find) return 0;
    let n = 0;
    const next = units.map(u => {
      let changed = false;
      const sub = (arr) => {
        if (!Array.isArray(arr)) return arr;
        const out = arr.map(s => {
          if (typeof s !== "string") return s;
          if (s.includes(find)) { changed = true; return s.split(find).join(replace); }
          return s;
        });
        return out;
      };
      const patched = {
        ...u,
        commonRequires: sub(u.commonRequires),
        outsideExtras: sub(u.outsideExtras),
        aorRequires: sub(u.aorRequires),
        requires: sub(u.requires),
      };
      if (changed) n++;
      return patched;
    });
    if (n > 0) persistUnits(next);
    return n;
    // eslint-disable-next-line
  }, [units]);

  // Stable icon-key for the units' icon-relevant fields ONLY (unit name +
  // primary faction + dictionary tag). Without this the previous useEffect
  // re-fired on every keystroke because `units` was a fresh ref each
  // render, and prewarmUnitCards was doing ~64,000 fs.existsSync calls
  // per fire on a real project — which on an 800-unit list locked the
  // renderer for several seconds at boot AND on every edit afterward.
  const iconKey = useMemo(() => {
    const stripPrefix = (s) => String(s || "").replace(/^(aor|merc)\s+/i, "");
    const parts = [];
    for (const u of units) {
      const eduEntry = modIndex.eduByType
        ? (modIndex.eduByType.get(u.unit) || modIndex.eduByType.get(stripPrefix(u.unit)))
        : null;
      const faction =
        (u.factions || []).find(f => f && f !== "all") ||
        (eduEntry?.ownership || []).find(f => f && f !== "slave") ||
        "";
      parts.push(`${u.unit}|${faction}|${eduEntry?.dictionary || ""}`);
    }
    return parts.join("\n");
  }, [units, modIndex.eduByType]);

  // Re-check missing unit cards + prewarm the PNG cache when the icon
  // identity set actually changes — not on every cell edit.
  useEffect(() => {
    if (!api?.checkUnitCards) return;
    if (!units.length) { setMissingCards(new Set()); return; }
    const stripPrefix = (s) => String(s || "").replace(/^(aor|merc)\s+/i, "");
    const list = units.map(u => {
      const eduEntry = modIndex.eduByType
        ? (modIndex.eduByType.get(u.unit) || modIndex.eduByType.get(stripPrefix(u.unit)))
        : null;
      const faction =
        (u.factions || []).find(f => f && f !== "all") ||
        (eduEntry?.ownership || []).find(f => f && f !== "slave") ||
        null;
      return { unit: u.unit, faction, dictionary: eduEntry?.dictionary || null };
    });
    const t = setTimeout(() => {
      api.checkUnitCards(list).then(missing => {
        setMissingCards(new Set(missing || []));
      }).catch(() => {});
      // Fire-and-forget: pre-warm the PNG cache for every authored unit's portrait so the
      // first scroll through UnitList shows them without any decode latency. The path-
      // resolution cache in main makes repeat lookups O(1), so this is cheap on subsequent
      // calls; only the very first call after a mod-data folder change actually walks disk.
      try { if (api.prewarmUnitCards) api.prewarmUnitCards(list); } catch {}
    }, 300);
    return () => clearTimeout(t);
  }, [iconKey]);

  // Single-click bundle export. Builds both texts in the renderer (EDB via applyUnitsToEDB,
  // EDU via compute + formatEdu when an EDU project is loaded), then writes both into one
  // user-picked folder. The recruitment side requires a fresh EDB read — same as the
  // existing Write-to-EDB flow — and respects writeBack flags on each unit.
  const exportBundle = async () => {
    if (!api) return;
    let edbText = null, eduText = null;
    try {
      if (units.length) {
        const fresh = await api.readEDB();
        if (fresh) edbText = applyUnitsToEDB(fresh, units);
      }
    } catch (e) { setStatus("EDB build failed: " + e.message); return; }
    try {
      if (eduProject) {
        const { compute } = await import("./edu_matic/compute");
        const { formatEdu } = await import("./edu_matic/format");
        eduText = formatEdu(compute(eduProject), eduProject);
      }
    } catch (e) { setStatus("EDU build failed: " + e.message); return; }
    if (!edbText && !eduText) { alert("Nothing to export — load a mod or import an xlsm first."); return; }
    if (!api.exportBundle) { alert("Bundle export needs a newer build of the app."); return; }
    const r = await api.exportBundle(edbText, eduText);
    if (r.canceled) return;
    if (r.error) { setStatus("Bundle export failed: " + r.error); return; }
    const parts = [];
    if (r.edbPath) parts.push("EDB → " + r.edbPath);
    if (r.eduPath) parts.push("EDU → " + r.eduPath);
    setStatus("Exported · " + parts.join(" · "));
    // Record export hashes so subsequent writes can warn on external edits.
    try {
      const { hashOfText } = await import("./projectStore");
      setProjectExports(e => ({
        ...e,
        ...(edbText ? { edb: { hashAtExport: hashOfText(edbText), path: r.edbPath, exportedAt: new Date().toISOString() } } : {}),
        ...(eduText ? { edu: { hashAtExport: hashOfText(eduText), path: r.eduPath, exportedAt: new Date().toISOString() } } : {}),
      }));
    } catch {}
    setEduDirty(false);
  };

  // Shared "compute the proposed diff modal payload" closure — used by
  // both the normal write-back flow and the conflict-resolver's
  // "overwrite anyway" path so the integrity check is identical either
  // way. Returns the payload that setDiff() should be called with.
  const buildWriteBackDiff = useCallback((fresh) => {
    const d = diffEDB(fresh, units);
    let integrity = null;
    try {
      const proposed = applyUnitsToEDB(fresh, units);
      integrity = verifyRoundTrip(proposed, units);
    } catch (e) { integrity = { ok: false, missing: [], error: e.message, expectedCount: 0 }; }
    return { ...d, fresh, integrity };
  }, [units]);

  const previewWriteBack = async () => {
    if (!api) return;
    if (!units.length) { alert("No units to write."); return; }
    const fresh = await api.readEDB();
    if (!fresh) { alert("Could not read EDB."); return; }
    // Stale-export detection: if we exported EDB before, compare the live
    // file's hash against the hash we recorded at export time. A mismatch
    // means the EDB was edited externally (teammate ran the game,
    // hand-authored a section, or pulled a newer commit). Open the
    // conflict resolver instead of just bailing — it shows the diff,
    // offers to open the file in the default editor, and lets the user
    // pick "overwrite anyway" with full information.
    if (projectExports?.edb?.hashAtExport) {
      const { hashOfText } = await import("./projectStore");
      const liveHash = hashOfText(fresh);
      if (liveHash !== projectExports.edb.hashAtExport) {
        setEdbConflict({
          fresh,
          exportedAt: projectExports.edb.exportedAt,
          path: projectExports.edb.path,
        });
        return;
      }
    }
    setDiff(buildWriteBackDiff(fresh));
  };

  const confirmWriteBack = async () => {
    if (!diff) return;
    const out = applyUnitsToEDB(diff.fresh, units);
    const r = await api.writeEDB(out);
    if (r.ok) {
      setStatus(`Wrote EDB. Backup: ${r.backup}`);
      // Record the hash of what we just wrote so the next write-back can
      // detect external edits.
      try {
        const { hashOfText } = await import("./projectStore");
        setProjectExports(e => ({ ...e, edb: { hashAtExport: hashOfText(out), exportedAt: new Date().toISOString() } }));
      } catch {}
    }
    else setStatus("Write failed: " + r.reason);
    setDiff(null);
  };

  const exportAllText = useMemo(() => renderAllPreview(units), [units]);
  // EDU-side validation results for the Sync gate. Lazy-imported because
  // validate.js lives in the EDU subtree. Debounced 800ms — validate()
  // walks the whole project (200-500ms on a real one) and running it on
  // every keystroke / bulk-edit step pinned the renderer hard enough
  // that Task Manager wouldn't open (v0.24.2 fix). Sync popover reads
  // the array to surface the actual error messages, not just a count.
  const [eduValidationErrors, setEduValidationErrors] = useState([]);
  const eduValidationErrorCount = eduValidationErrors.length;
  useEffect(() => {
    if (!eduProject) { setEduValidationErrors([]); return; }
    let cancelled = false;
    const id = setTimeout(async () => {
      if (cancelled) return;
      try {
        const { validate } = await import("./edu_matic/validate");
        const errs = validate(eduProject);
        if (!cancelled) setEduValidationErrors(Array.isArray(errs) ? errs : []);
      } catch (e) { if (!cancelled) setEduValidationErrors([]); }
    }, 800);
    return () => { cancelled = true; clearTimeout(id); };
  }, [eduProject]);

  const validationSummary = useMemo(() => {
    // The summary runs on every render — keep it lightweight by skipping the O(n²) cross-unit
    // conflict pass. The full validation view (which only mounts when the user opens the tab)
    // runs the full set including conflicts.
    const sum = summarize(validateUnits(units, modIndex, { missingCards, skipCrossUnit: true }));
    const factionIssues = validateFactions(units, modIndex);
    return { ...sum, factionIssues: factionIssues.length };
  }, [units, modIndex, missingCards]);

  return (
    <AppErrorBoundary>
    <LightboxProvider>
    {/* Toast queue — fixed top-right, stacks bottom-down. */}
    {toasts.length > 0 && (
      <div style={{ position: "fixed", top: 16, right: 16, zIndex: 7000, display: "flex", flexDirection: "column", gap: 8, pointerEvents: "none" }}>
        {toasts.map(t => (
          <div key={t.id} style={{
            background: "rgba(28,30,32,0.96)",
            border: `1px solid ${t.kind === "error" ? "rgba(232,136,136,0.5)" : t.kind === "success" ? "rgba(124,201,153,0.5)" : "rgba(220,166,74,0.5)"}`,
            borderRadius: 6, padding: "8px 14px", color: "#ddd", fontSize: 13,
            boxShadow: "0 4px 14px rgba(0,0,0,0.5)",
            minWidth: 220, maxWidth: 380, pointerEvents: "auto",
          }}>{t.text}</div>
        ))}
      </div>
    )}
    {/* First-launch welcome — covers the editor with a 3-step quick-start so a brand-new
        user knows what to do. Dismissible forever via the checkbox. */}
    {showWelcome && !showSplash && (
      <div style={{ position: "fixed", inset: 0, zIndex: 5500, background: "rgba(0,0,0,0.65)", backdropFilter: "blur(4px)", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{ background: "rgba(28,30,32,0.98)", border: "1px solid rgba(220,166,74,0.35)", borderRadius: 12, padding: 30, maxWidth: 560, color: "#ddd", boxShadow: "0 12px 40px rgba(0,0,0,0.6)" }}>
          <div style={{ fontSize: 22, fontWeight: 700, color: "#dca64a", marginBottom: 4, fontFamily: "Georgia, serif", letterSpacing: 1 }}>Welcome to Manipula</div>
          <div style={{ fontSize: 12, color: "#888", marginBottom: 20, fontStyle: "italic" }}>Author RTW recruitment + EDU stats in one window.</div>
          <ol style={{ paddingLeft: 22, lineHeight: 1.7, fontSize: 13 }}>
            <li style={{ marginBottom: 8 }}><strong style={{ color: "#dca64a" }}>Pick your mod data folder.</strong> Top-left "Mod data folder…" — point at your <code style={{ color: "#7c9" }}>RIS/data</code> directory (or wherever your <code>export_descr_buildings.txt</code> lives).</li>
            <li style={{ marginBottom: 8 }}><strong style={{ color: "#dca64a" }}>Drop in your EDUMatic xlsm</strong> (optional but recommended). Drag the <code style={{ color: "#7c9" }}>.xlsm</code> straight onto this window — populates both recruitment data and EDU stats.</li>
            <li style={{ marginBottom: 8 }}><strong style={{ color: "#dca64a" }}>Start authoring.</strong> Pick a unit on the left, edit recruitment in the centre, watch the recruitable-regions map update live. <strong>Ctrl+S</strong> writes to EDB, <strong>Ctrl+E</strong> exports both files.</li>
          </ol>
          <div style={{ marginTop: 12, fontSize: 11, color: "#888" }}>
            EDU pipeline based on Aradan's original EDU-matic, with the bulk of the VBA / DATA-layout work by <em>Tone</em>; smaller recent updates from Biggus_Dickus' <em>BD's New Base</em>. Full credits in the EDU Builder tab.
          </div>
          <div style={{ marginTop: 22, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <label style={{ fontSize: 11, color: "#888", display: "flex", alignItems: "center", gap: 6 }}>
              <input
                type="checkbox"
                checked={welcomeDontShow}
                onChange={(e) => setWelcomeDontShow(e.target.checked)}
              />
              Don't show again
            </label>
            <button
              onClick={() => {
                if (welcomeDontShow) localStorage.setItem("rt:welcomeDismissed", "1");
                else localStorage.removeItem("rt:welcomeDismissed");
                setShowWelcome(false);
              }}
              style={{ background: "#dca64a", color: "#1a1a1a", border: "none", padding: "8px 18px", borderRadius: 6, fontWeight: 700, cursor: "pointer" }}
            >Get started</button>
          </div>
        </div>
      </div>
    )}
    {showSplash && (
      <div style={{
        position: "fixed", inset: 0, zIndex: 6000, display: "flex", flexDirection: "column",
        alignItems: "center", justifyContent: "center", gap: 18,
        // ONE 2400×2400 leather image as cover — no tiling, period. Source has fine
        // uniform grain so cover-scaling on a 1920×1080 window shows the texture at
        // ~0.8× source resolution: still sharp, no visible upscale, and structurally
        // impossible to show seams because there's only one image.
        backgroundImage: [
          "linear-gradient(rgba(0,0,0,0.40), rgba(0,0,0,0.40))",
          "url('./leather.jpg')",
        ].join(","),
        backgroundSize: "cover, cover",
        backgroundRepeat: "no-repeat, no-repeat",
        backgroundPosition: "center, center",
        backgroundColor: "#3a1f0e",
        color: "#dca64a", fontFamily: "Cinzel, Georgia, serif",
      }}>
        <div style={{ position: "absolute", inset: 28, border: "2px dashed #d4a85a", borderRadius: 14, pointerEvents: "none", boxShadow: "inset 0 0 120px rgba(0,0,0,0.45), 0 4px 30px rgba(0,0,0,0.6)" }} />
        <div style={{ position: "absolute", inset: 30, border: "1px solid rgba(255,220,150,0.18)", borderRadius: 13, pointerEvents: "none" }} />
        <div style={{ fontSize: 42, fontWeight: 700, letterSpacing: 6, textShadow: "0 2px 14px rgba(0,0,0,0.7), 0 0 20px rgba(220,166,74,0.4)", color: "#f1c878", zIndex: 1 }}>MANIPULA</div>
        <div style={{ fontSize: 11, color: "#cba88a", letterSpacing: 1, textTransform: "uppercase", marginTop: -6, textShadow: "0 1px 4px rgba(0,0,0,0.7)", zIndex: 1 }}>handle the maniple · recruitment · units · map</div>
        <div style={{ fontSize: 13, color: "#a8855a", letterSpacing: 1.2, textTransform: "uppercase", textShadow: "0 1px 4px rgba(0,0,0,0.7)", zIndex: 1 }}>{info && info.version ? `v${info.version}` : ""}</div>
        <div style={{ marginTop: 30, fontSize: 12, color: "#e6cda0", fontStyle: "italic", letterSpacing: 0.5, fontFamily: "Georgia, serif", textShadow: "0 1px 3px rgba(0,0,0,0.6)", zIndex: 1 }}>{status || "Loading…"}</div>
        <div style={{ marginTop: 16, width: 240, height: 3, background: "rgba(40,20,8,0.6)", borderRadius: 2, overflow: "hidden", boxShadow: "inset 0 1px 2px rgba(0,0,0,0.7)", zIndex: 1 }}>
          <div style={{
            width: "30%", height: "100%",
            background: "linear-gradient(90deg, transparent, #f1c878, transparent)",
            animation: "splash-bar 1.4s linear infinite",
          }} />
        </div>
        <style>{`
          @keyframes splash-bar { 0% { transform: translateX(-100%); } 100% { transform: translateX(800%); } }
        `}</style>
      </div>
    )}
    <div style={{ height: "100vh", display: "flex", flexDirection: "column" }}>
      <Topbar
        dataDir={dataDir}
        loading={loading}
        status={status}
        eduProject={eduProject}
        eduProjectSource={eduProjectSource}
        eduDirty={eduDirty}
        eduValidationErrors={eduValidationErrors}
        setEduView={setEduView}
        setActiveTab={setActiveTab}
        projectDir={projectDir}
        unitsCount={units.length}
        units={units}
        theme={theme}
        onThemeToggle={() => setTheme(t => t === "sepia" ? "ink" : "sepia")}
        onSaveProject={async () => {
          // Save bundles the EDU project AND the EDB recruit-line authoring
          // units into the same project dir. Either side may be empty (a
          // fresh project might just be authored recruit-lines, or just an
          // xlsm-imported EDU side); we still write the sentinel so the
          // dir is recognisable next time.
          if (!eduProject && !units.length) { toast("Nothing to save — import an xlsm or set up some units first.", "error"); return; }
          let dir = projectDir;
          if (!dir) {
            if (!window.eduAPI?.chooseSaveDir) return;
            dir = await window.eduAPI.chooseSaveDir();
            if (!dir) return;
            setProjectDir(dir);
            localStorage.setItem("rt:projectDir", dir);
          }

          // Pre-save remote-state check: if the project dir is a git repo
          // and the upstream has commits we haven't pulled, ask before
          // writing. The risk is teammate parallel edits — if Alice pushed
          // changes to unit X and we save without pulling, our save
          // creates a divergence. Pulling first surfaces conflicts cleanly
          // through git instead of "whoever pushes last wins". Network
          // failure on the fetch (offline / private repo without auth) is
          // non-fatal — just skip the check and proceed.
          if (window.eduAPI?.gitFetch && window.eduAPI?.gitStatus) {
            try {
              await window.eduAPI.gitFetch(dir);
              const s = await window.eduAPI.gitStatus(dir);
              if (s && s.isRepo && (s.behind || 0) > 0) {
                const ok = window.confirm(
                  `Remote has ${s.behind} commit${s.behind === 1 ? "" : "s"} you haven't pulled. ` +
                  `Saving now will create a divergence — your local will need a merge or rebase before it can push.\n\n` +
                  `Recommended: cancel, click Sync → Pull, then save.\n\n` +
                  `Save anyway?`
                );
                if (!ok) return;
              }
            } catch (e) {
              // Don't block the save on a fetch failure.
              console.warn("[save] pre-save fetch failed:", e && e.message);
            }
          }

          try {
            const { saveProject } = await import("./projectStore");
            await saveProject(dir, { eduProject, units, exports: projectExports });
            setEduDirty(false);
            // Bump so the SyncButton refreshes its dot the moment the
            // user hits save, instead of waiting up to 5s for the poll.
            setProjectSaveTick(t => t + 1);
            toast(`Saved project → ${dir}`, "success");
          } catch (e) { toast("Save failed: " + e.message, "error"); }
        }}
        onOpenProject={async () => {
          if (!window.eduAPI?.openProject) return;
          const dir = await window.eduAPI.openProject();
          if (!dir) return;
          await loadProjectFromDir(dir);
        }}
        onCloneProject={() => setCloneModal({ url: "", parent: "", leaf: "ris-manipula" })}
        onJumpToUnit={(id) => { setSelectedIds(new Set()); setSelectedId(id); setActiveTab("editor"); }}
        onJumpToEdu={() => { setEduView("units"); setActiveTab("edu"); }}
        onFindReplace={() => setFindReplaceOpen(true)}
        onPick={async () => { const d = await api.pickDataDir(); if (d) { setDataDir(d); } }}
        onReload={loadMod}
        onImport={importFromEDB}
        onImportEdumatic={importFromEdumatic}
        onResetImportsToReferenceOnly={resetImportsToReferenceOnly}
        onWriteBack={previewWriteBack}
        onExportBundle={exportBundle}
        onSaveText={async () => {
          const p = await api.saveTextAs("recruitment-export.txt", exportAllText);
          if (p) setStatus("Saved: " + p);
        }}
        onOpenBackups={openBackups}
        profiles={profiles}
        activeProfile={activeProfile}
        onSwitchProfile={switchProfile}
        onNewProfile={newProfile}
        onDeleteProfile={deleteCurrentProfile}
        onUndo={history.undo}
        onRedo={history.redo}
        canUndo={history.canUndo}
        canRedo={history.canRedo}
        onCheckUpdates={async () => {
          if (!api) return;
          // Pop the toast immediately so the click always produces visible feedback. autoUpdater
          // events that follow will replace this state with available/none/downloaded/error.
          setUpdateStatus({ state: "checking" });
          setStatus("Checking for updates…");
          const r = await api.updaterCheck();
          if (!r.ok) {
            setUpdateStatus({ state: "error", message: r.reason || "Update check failed" });
            setStatus("Update check failed: " + (r.reason || "?"));
            return;
          }
          // If autoUpdater is silent (already-cached state, no events emitted), pull whatever
          // the main process last knew about and surface that — otherwise the toast hangs on "checking".
          setTimeout(async () => {
            if (api.getUpdateStatus) {
              const s = await api.getUpdateStatus();
              if (s) setUpdateStatus(s);
              else setUpdateStatus({ state: "error", message: "no response from updater (check console)" });
            }
          }, 4000);
        }}
        info={info}
      />
      {diff && (
        <DiffModal diff={diff} onCancel={() => setDiff(null)} onConfirm={confirmWriteBack} />
      )}
      {edbConflict && (
        <EdbConflictModal
          conflict={edbConflict}
          onCancel={() => setEdbConflict(null)}
          onShowDiff={() => {
            const fresh = edbConflict.fresh;
            setEdbConflict(null);
            setDiff(buildWriteBackDiff(fresh));
          }}
          onOpenInEditor={async () => {
            if (api && api.openPath && edbConflict.path) {
              await api.openPath(edbConflict.path);
            }
          }}
          onOverwrite={() => {
            const fresh = edbConflict.fresh;
            setEdbConflict(null);
            setDiff(buildWriteBackDiff(fresh));
          }}
        />
      )}
      {cloneModal && (
        <CloneRepoModal
          state={cloneModal}
          setState={setCloneModal}
          onLoaded={loadProjectFromDir}
          onClose={() => setCloneModal(null)}
        />
      )}
      {showBackups && (
        <BackupsModal
          backups={backups}
          onClose={() => setShowBackups(false)}
          onRestore={restoreBackup}
          onDelete={async (b) => {
            if (!window.confirm(`Delete ${b.name}?`)) return;
            await api.deleteEdbBackup(b.path);
            setBackups(await api.listEdbBackups());
          }}
        />
      )}
      {updateStatus && (
        <UpdateToast status={updateStatus} currentVersion={info && info.version} onInstall={() => api.updaterQuitAndInstall()} onDismiss={() => setUpdateStatus(null)} />
      )}
      {findReplaceOpen && (
        <FindReplaceModal
          units={units}
          onApply={applyFindReplace}
          onClose={() => setFindReplaceOpen(false)}
        />
      )}
      {edumaticPreview && (
        <EdumaticPreviewModal
          preview={edumaticPreview}
          existing={new Set(units.map(u => u.unit))}
          onCancel={() => setEdumaticPreview(null)}
          onConfirm={confirmEdumaticImport}
          onToggle={(idx) => {
            const sel = new Set(edumaticPreview.selected);
            sel.has(idx) ? sel.delete(idx) : sel.add(idx);
            setEdumaticPreview({ ...edumaticPreview, selected: sel });
          }}
          onSelectAll={() => setEdumaticPreview({ ...edumaticPreview, selected: new Set(edumaticPreview.rows.map((_, i) => i)) })}
          onSelectNone={() => setEdumaticPreview({ ...edumaticPreview, selected: new Set() })}
        />
      )}
      <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
        {/* Hide the recruit-line UnitList sidebar on the EDU Builder tab —
            EDU work happens in wide tables (Units has 52+ columns) and the
            recruit-line list is irrelevant there. The sidebar reappears
            on every other tab. */}
        {activeTab !== "edu" && (
          <>
            <div style={{ width: sidebarWidth, minWidth: 220, height: "100%", position: "relative" }}>
              <UnitList
                units={units}
                selectedId={selectedId}
                selectedIds={selectedIds}
                onSelect={onUnitClick}
                onAdd={onAdd}
                onDelete={onDelete}
                onDuplicate={onDuplicate}
                onCreateFromEDU={onCreateFromEDU}
                modIndex={modIndex}
                filter={listFilter}
                onFilterChange={setListFilter}
                eduProject={eduProject}
              />
            </div>
        <div
          onMouseDown={(e) => {
            sidebarDragRef.current = { startX: e.clientX, startWidth: sidebarWidth };
            e.preventDefault();
            const onMove = (ev) => {
              if (!sidebarDragRef.current) return;
              const w = sidebarDragRef.current.startWidth + (ev.clientX - sidebarDragRef.current.startX);
              setSidebarWidth(Math.max(220, Math.min(720, w)));
            };
            const onUp = () => {
              sidebarDragRef.current = null;
              window.removeEventListener("mousemove", onMove);
              window.removeEventListener("mouseup", onUp);
            };
            window.addEventListener("mousemove", onMove);
            window.addEventListener("mouseup", onUp);
          }}
          title="Drag to resize"
          style={{ width: 4, cursor: "col-resize", background: "rgba(220,166,74,0.10)", flexShrink: 0 }}
        />
          </>
        )}
        <div style={{ flex: 1, height: "100%", minWidth: 0, minHeight: 0, display: "flex", flexDirection: "column" }}>
          <Tabs activeTab={activeTab} onChange={setActiveTab} validationSummary={validationSummary} />
          <div style={{ flex: 1, minWidth: 0, overflow: "hidden" }}>
            {activeTab === "editor" && (
              <div style={{ height: "100%", overflow: "auto" }}>
                {listFilter.mode === "faction" && listFilter.value && (
                  <div style={{ padding: "12px 16px 0" }}>
                    <RosterOverview units={units} faction={listFilter.value} modIconsDir={modIndex.factionIconsDir} modIndex={modIndex} onCreateFromEDU={onCreateFromEDU} onUnitClick={(id) => { setSelectedIds(new Set()); setSelectedId(id); }} />
                  </div>
                )}
                <EditorErrorBoundary>
                  {selectedIds.size > 1
                    ? <BulkEditor selectedUnits={bulkSelected} onApply={applyBulk} modIndex={modIndex} onClearSelection={clearSelection} />
                    : <UnitEditor unit={selected} onChange={onChangeUnit} modIndex={modIndex} allUnits={units} onFilterFaction={(faction) => { setListFilter({ mode: "faction", value: faction }); }} onSelectUnit={(id) => { setSelectedIds(new Set()); setSelectedId(id); }} eduProject={eduProject} onJumpToEdu={() => { setEduView("units"); setActiveTab("edu"); }} onCreateEduStub={(authoredUnit) => {
                    if (!eduProject) return;
                    // Append a minimal EDU row for this unit. User fills in the rest in the
                    // EDU Builder Units screen — this just removes the friction of opening it
                    // up and adding a row by hand.
                    const stub = {
                      kind: "unit",
                      Unit: authoredUnit.unit,
                      row: (eduProject.units || []).length + 3,
                      Ownership: (authoredUnit.factions || []).filter(f => f && f !== "all").join(", "),
                    };
                    setEduProjectAndMark({ ...eduProject, units: [...(eduProject.units || []), stub] });
                    setStatus(`Added EDU stub for "${authoredUnit.unit}" — open EDU Builder → Units to fill in stats.`);
                  }} />}
                </EditorErrorBoundary>
              </div>
            )}
            {activeTab === "validation" && (
              <ValidationView
                units={units}
                modIndex={modIndex}
                missingCards={missingCards}
                eduProject={eduProject}
                onJump={(id) => { setSelectedIds(new Set()); setSelectedId(id); setActiveTab("editor"); }}
                onFilterFaction={(faction) => { setListFilter({ mode: "faction", value: faction }); setActiveTab("editor"); }}
                onCreateEduStubs={(missing) => {
                  if (!eduProject) return;
                  const stubs = missing.map(u => ({
                    kind: "unit",
                    Unit: u.unit,
                    row: 0,
                    Ownership: (u.factions || []).filter(f => f && f !== "all").join(", "),
                  }));
                  setEduProjectAndMark({ ...eduProject, units: [...(eduProject.units || []), ...stubs] });
                  setStatus(`Added ${stubs.length} EDU stubs.`);
                }}
              />
            )}
            {activeTab === "exportAll" && (
              <pre style={{ height: "100%", overflow: "auto", padding: 16, margin: 0, fontFamily: "Consolas, monospace", fontSize: 11.5, color: "#bbb", background: "rgba(15,17,18,0.7)", whiteSpace: "pre-wrap" }}>{exportAllText}</pre>
            )}
            {activeTab === "edu" && (
              <div style={{ height: "100%", display: "flex", flexDirection: "column" }}>
                <EduSubTabs view={eduView} onView={setEduView} project={eduProject} />
                <div style={{ flex: 1, overflow: "hidden", minWidth: 0, minHeight: 0 }}>
                  <EduMaticApp
                    externalProject={eduProject}
                    onProjectChange={setEduProject}
                    controlledView={eduView}
                    onControlledView={setEduView}
                    hideSidebar={true}
                    modDataDir={dataDir}
                    recruitUnits={units}
                    lastImportedSnapshot={eduImportSnapshot}
                    projectBlame={projectBlame}
                    projectDir={projectDir}
                    onJumpToRecruit={(unitId) => {
                      // Switch to the recruit-line editor and select the
                      // matched unit. Lets users hop from an EDU row to the
                      // recruit-line side via the row context menu.
                      setSelectedIds(new Set());
                      setSelectedId(unitId);
                      setActiveTab("editor");
                    }}
                  />
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
    </LightboxProvider>
    </AppErrorBoundary>
  );
}

function Topbar({ dataDir, loading, status, eduProject, eduProjectSource, eduDirty, eduValidationErrors = [], setEduView, setActiveTab, unitsCount, units, theme, onThemeToggle, onJumpToUnit, onJumpToEdu, onFindReplace, onExportBundle, onSaveProject, onOpenProject, onCloneProject, projectDir, projectSaveTick, onPick, onReload, onImport, onImportEdumatic, onResetImportsToReferenceOnly, onWriteBack, onSaveText, onOpenBackups, profiles, activeProfile, onSwitchProfile, onNewProfile, onDeleteProfile, onUndo, onRedo, canUndo, canRedo, onCheckUpdates, info }) {
  return (
    <div style={{ borderBottom: "1px solid rgba(220,166,74,0.15)", padding: "8px 12px", display: "flex", alignItems: "center", gap: 8, background: "rgba(20,22,23,0.78)", backdropFilter: "blur(8px)", WebkitBackdropFilter: "blur(8px)", flexWrap: "wrap" }}>
      <div style={{ fontWeight: 700, fontSize: 14, marginRight: 4 }}>Manipula</div>
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginRight: 6, fontSize: 10, color: "#888", fontFamily: "Consolas, monospace" }}>
        <span title={`${unitsCount} authored recruit entries`} style={{ background: unitsCount > 0 ? "rgba(124,201,153,0.10)" : "rgba(255,255,255,0.04)", border: "1px solid " + (unitsCount > 0 ? "rgba(124,201,153,0.25)" : "rgba(255,255,255,0.08)"), color: unitsCount > 0 ? "#7c9" : "#666", padding: "1px 6px", borderRadius: 3 }}>
          EDB · {unitsCount}
        </span>
        <span title={eduProject ? `${eduProject.units?.length ?? 0} EDU rows from ${eduProject.modInfo?.name || "(unnamed)"}\n${eduProjectSource || ""}${eduDirty ? "\n— unsaved changes since import —" : ""}` : "No EDU project loaded"} style={{ background: eduProject ? "rgba(220,166,74,0.10)" : "rgba(255,255,255,0.04)", border: "1px solid " + (eduProject ? "rgba(220,166,74,0.25)" : "rgba(255,255,255,0.08)"), color: eduProject ? "#dca64a" : "#666", padding: "1px 6px", borderRadius: 3 }}>
          EDU · {eduProject ? (eduProject.units?.length ?? 0) : "—"}{eduDirty ? "*" : ""}
        </span>
        {eduProjectSource && (
          <span title={eduProjectSource} style={{ color: "#888", fontSize: 10, fontStyle: "italic", maxWidth: 180, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {eduProjectSource.split(/[\\/]/).pop()}
          </span>
        )}
      </div>
      {info && info.version && (
        <span
          onClick={onCheckUpdates}
          title="Click to check for updates"
          style={{ color: "#777", fontSize: 11, marginRight: 8, fontFamily: "Consolas, monospace", cursor: "pointer", padding: "2px 4px", borderRadius: 3 }}
          onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(220,166,74,0.12)"; e.currentTarget.style.color = "#dca64a"; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = ""; e.currentTarget.style.color = "#777"; }}
        >v{info.version}</span>
      )}
      <QuickSearch units={units} eduProject={eduProject} onJumpToUnit={onJumpToUnit} onJumpToEdu={onJumpToEdu} />
      <button onClick={onPick} style={tbtn("#3a4a5a")}>Mod data folder…</button>
      <span style={{ color: "#999", fontSize: 12, fontFamily: "Consolas, monospace" }}>{dataDir}</span>
      <button onClick={onReload} disabled={loading} style={tbtn("#446")}>{loading ? "Loading…" : "Reload"}</button>
      <button onClick={onImport} style={tbtn("#665")}>Import from EDB</button>
      <button onClick={onImportEdumatic} style={tbtn("#665")} title="Import an EDUMatic .xlsm — populates both recruitment data and EDU stats">Import xlsm…</button>
      <button onClick={onSaveProject} style={tbtn("#465")} title="Save project — writes one JSON file per unit/faction/armour into a folder you pick (git-friendly for team sharing)">Save project</button>
      <button onClick={onOpenProject} style={tbtn("#465")} title="Open a Manipula project folder">Open project</button>
      {onCloneProject && (
        <button onClick={onCloneProject} style={tbtn("#465")} title="Clone a Manipula project from a GitHub URL into a local folder">Clone from GitHub…</button>
      )}
      <SyncButton
        projectDir={projectDir}
        saveTick={projectSaveTick}
        validationErrors={eduValidationErrors}
        onViewValidation={() => { setEduView("validate"); setActiveTab("edu"); }}
        webhookUrl={(eduProject && eduProject.modInfo && eduProject.modInfo.webhookUrl) || ""}
      />

      <button onClick={onFindReplace} title="Bulk find/replace across all units' requires" style={tbtn("#564")}>Find/Replace…</button>
      <button
        onClick={onResetImportsToReferenceOnly}
        title="Set every imported unit to reference-only (writeBack: false). Manually authored units are untouched."
        style={tbtn("#553")}
      >Imports → reference</button>
      <span style={{ color: "#666", margin: "0 4px" }}>|</span>
      <button onClick={onUndo} disabled={!canUndo} title="Undo (Ctrl+Z)" style={tbtn("rgba(255,255,255,0.06)")}>↶</button>
      <button onClick={onRedo} disabled={!canRedo} title="Redo (Ctrl+Y)" style={tbtn("rgba(255,255,255,0.06)")}>↷</button>
      <span style={{ color: "#666", margin: "0 4px" }}>|</span>
      <span style={{ fontSize: 11, color: "#999" }}>Profile:</span>
      <select
        value={activeProfile}
        onChange={(e) => onSwitchProfile(e.target.value)}
        style={{ background: "#252525", border: "1px solid #333", color: "#ddd", padding: "4px 6px", borderRadius: 3, fontSize: 12 }}
      >
        {profiles.map(p => <option key={p} value={p}>{p}</option>)}
      </select>
      <button onClick={onNewProfile} title="Duplicate active profile to new name" style={tbtn("#446")}>＋</button>
      <button onClick={onDeleteProfile} disabled={activeProfile === "default"} title="Delete active profile" style={tbtn(activeProfile === "default" ? "#333" : "#733")}>×</button>
      <div style={{ flex: 1 }} />
      <button onClick={onOpenBackups} style={tbtn("#446")}>Backups…</button>
      <button onClick={onSaveText} style={tbtn("#446")}>Save preview…</button>
      <button data-rtshortcut="write-edb" onClick={onWriteBack} title="Write to EDB (Ctrl+S)" style={{ ...tbtn(ACCENT), color: "#1a1a1a", fontWeight: 700 }}>Write to EDB</button>
      <button data-rtshortcut="export-bundle" onClick={onExportBundle} title="Export both EDB and EDU together (Ctrl+E)" style={{ ...tbtn("#5a4a36"), color: "#dca64a", fontWeight: 700, border: "1px solid rgba(220,166,74,0.4)" }}>Export all</button>
      <button onClick={onThemeToggle} title={`Theme: ${theme} — click to switch`} style={{ ...tbtn("rgba(255,255,255,0.05)"), color: "#bbb", padding: "4px 7px", fontSize: 12 }}>{theme === "sepia" ? "🌒" : "🜂"}</button>
      <span style={{ color: "#bbb", fontSize: 11, marginLeft: 8, flexBasis: "100%" }}>{status}</span>
    </div>
  );
}

function EdumaticPreviewModal({ preview, existing, onCancel, onConfirm, onToggle, onSelectAll, onSelectNone }) {
  const { source, rows, selected } = preview;
  const newCount = rows.filter((r, i) => selected.has(i) && !existing.has(r.unit)).length;
  const dupCount = rows.filter((r, i) => selected.has(i) && existing.has(r.unit)).length;
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)", backdropFilter: "blur(4px)", WebkitBackdropFilter: "blur(4px)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ background: "rgba(28,30,32,0.95)", border: "1px solid rgba(220,166,74,0.18)", borderRadius: 14, padding: 24, width: "82%", maxWidth: 1100, maxHeight: "85vh", display: "flex", flexDirection: "column", boxShadow: "0 12px 48px rgba(0,0,0,0.5)" }}>
        <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 6 }}>Import from EDUMatic</div>
        <div style={{ marginBottom: 12, color: "#999", fontSize: 12, fontFamily: "Consolas, monospace" }}>{source}</div>
        <div style={{ marginBottom: 12, fontSize: 12, color: "#cba" }}>
          Parsed <strong>{rows.length}</strong> unit rows. Will add{" "}
          <strong style={{ color: "#dca64a" }}>{newCount}</strong> new units
          {dupCount > 0 && <> · skip <strong style={{ color: "#888" }}>{dupCount}</strong> already-authored duplicates</>}
          .
        </div>
        <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
          <button onClick={onSelectAll} style={tbtn("#446")}>Select all</button>
          <button onClick={onSelectNone} style={tbtn("rgba(255,255,255,0.06)")}>Select none</button>
        </div>
        <div style={{ flex: 1, overflow: "auto", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 6 }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11.5 }}>
            <thead>
              <tr style={{ background: "rgba(255,255,255,0.03)", position: "sticky", top: 0 }}>
                <th style={{ padding: "6px 8px", textAlign: "left" }}></th>
                <th style={{ padding: "6px 8px", textAlign: "left" }}>Unit</th>
                <th style={{ padding: "6px 8px" }}>Tier</th>
                <th style={{ padding: "6px 8px" }}>Type</th>
                <th style={{ padding: "6px 8px" }}>Quality Class</th>
                <th style={{ padding: "6px 8px", textAlign: "left" }}>Factions</th>
                <th style={{ padding: "6px 8px" }}>Colony</th>
                <th style={{ padding: "6px 8px" }}>Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, 800).map((r, i) => {
                const dup = existing.has(r.unit);
                return (
                  <tr key={i} style={{ borderBottom: "1px solid rgba(255,255,255,0.04)", color: dup ? "#666" : "#bbb", fontStyle: dup ? "italic" : "normal" }}>
                    <td style={{ padding: "4px 8px" }}>
                      <input type="checkbox" checked={selected.has(i)} onChange={() => onToggle(i)} />
                    </td>
                    <td style={{ padding: "4px 8px", fontFamily: "Consolas, monospace" }}>{r.unit}</td>
                    <td style={{ padding: "4px 8px", textAlign: "center" }}>{r.tier}</td>
                    <td style={{ padding: "4px 8px", textAlign: "center" }}>{r.isAor ? "AOR" : r.isFactional ? "Faction" : r._meta.type}</td>
                    <td style={{ padding: "4px 8px", textAlign: "center" }}>{r.qualityClass || "—"}</td>
                    <td style={{ padding: "4px 8px" }}>{(r.factions || []).slice(0, 4).join(", ")}{(r.factions || []).length > 4 ? `, +${r.factions.length - 4}` : ""}</td>
                    <td style={{ padding: "4px 8px", textAlign: "center" }}>{r.colonyTier || "—"}</td>
                    <td style={{ padding: "4px 8px", textAlign: "center", color: dup ? "#888" : "#7a9" }}>{dup ? "duplicate" : "new"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {rows.length > 800 && (
            <div style={{ padding: 8, textAlign: "center", color: "#888", fontSize: 11 }}>Showing first 800 rows of {rows.length}.</div>
          )}
        </div>
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 12 }}>
          <button onClick={onCancel} style={tbtn("#444")}>Cancel</button>
          <button onClick={onConfirm} style={{ ...tbtn(ACCENT), color: "#1a1a1a", fontWeight: 700 }}>
            Import {newCount} units
          </button>
        </div>
      </div>
    </div>
  );
}

function BackupsModal({ backups, onClose, onRestore, onDelete }) {
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)", backdropFilter: "blur(4px)", WebkitBackdropFilter: "blur(4px)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ background: "rgba(28,30,32,0.95)", border: "1px solid rgba(220,166,74,0.18)", borderRadius: 14, padding: 24, boxShadow: "0 12px 48px rgba(0,0,0,0.5)", width: "70%", maxWidth: 900, maxHeight: "85vh", overflow: "auto" }}>
        <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 12 }}>EDB backups</div>
        <div style={{ marginBottom: 12, color: "#999", fontSize: 12 }}>
          Each "Write to EDB" creates a timestamped <code>.bak_*</code> next to the EDB. Restore puts it back as the live file
          (and saves the current EDB as <code>.bak_pre-restore_*</code> first, so a misclick is also reversible).
        </div>
        {backups.length === 0 && <div style={{ color: "#666", padding: 20, textAlign: "center" }}>No backups found.</div>}
        {backups.map(b => (
          <div key={b.path} style={{ display: "flex", alignItems: "center", padding: "6px 0", borderBottom: "1px solid #2a2a2a", gap: 8 }}>
            <div style={{ flex: 1, fontFamily: "Consolas, monospace", fontSize: 12, color: "#ddd" }}>
              {b.name}
              <div style={{ color: "#777", fontSize: 11 }}>{new Date(b.mtime).toLocaleString()} · {(b.size / 1024 / 1024).toFixed(2)} MB</div>
            </div>
            <button onClick={() => onRestore(b)} style={tbtn("#3a6")}>Restore</button>
            <button onClick={() => onDelete(b)} style={tbtn("#733")}>Delete</button>
          </div>
        ))}
        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 14 }}>
          <button onClick={onClose} style={tbtn("#444")}>Close</button>
        </div>
      </div>
    </div>
  );
}

// Quick-jump search box in the topbar. Searches both authored recruitment units AND the
// loaded EDU project simultaneously; the dropdown shows where each match exists with a
// small badge ("EDB" / "EDU" / "EDB+EDU"). Picking a result jumps to the right view.
function QuickSearch({ units, eduProject, onJumpToUnit, onJumpToEdu }) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [history, setHistory] = useState(() => {
    try { return JSON.parse(localStorage.getItem("rt:searchHistory") || "[]"); } catch { return []; }
  });
  const pushHistory = (term) => {
    if (!term) return;
    const next = [term, ...history.filter(h => h !== term)].slice(0, 8);
    setHistory(next);
    try { localStorage.setItem("rt:searchHistory", JSON.stringify(next)); } catch {}
  };
  const matches = useMemo(() => {
    if (!q || q.length < 2) return [];
    const lc = q.toLowerCase();
    const out = [];
    const seen = new Set();
    for (const u of units || []) {
      const name = u.unit || "";
      if (name.toLowerCase().includes(lc)) {
        out.push({ name, id: u.id, edb: true, edu: false });
        seen.add(name);
      }
    }
    if (eduProject && Array.isArray(eduProject.units)) {
      for (const eu of eduProject.units) {
        const name = eu.Unit || eu.unit || eu.Type || eu.type;
        if (!name) continue;
        const lcname = String(name).toLowerCase();
        if (lcname.includes(lc)) {
          if (seen.has(name)) {
            const ex = out.find(x => x.name === name);
            if (ex) ex.edu = true;
          } else {
            out.push({ name, id: null, edb: false, edu: true });
            seen.add(name);
          }
        }
      }
    }
    return out.slice(0, 12);
  }, [q, units, eduProject]);
  return (
    <div style={{ position: "relative" }}>
      <input
        data-rtshortcut="quick-search"
        type="text"
        value={q}
        onChange={(e) => { setQ(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        placeholder="Find unit (Ctrl+F)…"
        style={{ background: "#252525", border: "1px solid #333", color: "#ddd", padding: "5px 8px", borderRadius: 4, fontSize: 11.5, width: 200, fontFamily: "Consolas, monospace" }}
      />
      {open && q.length < 2 && history.length > 0 && (
        <div style={{ position: "absolute", top: "100%", left: 0, marginTop: 4, background: "rgba(20,22,23,0.98)", border: "1px solid rgba(220,166,74,0.3)", borderRadius: 6, padding: 4, minWidth: 280, maxHeight: 360, overflowY: "auto", zIndex: 800, boxShadow: "0 8px 24px rgba(0,0,0,0.5)" }}>
          <div style={{ padding: "4px 8px", fontSize: 9, color: "#888", textTransform: "uppercase", letterSpacing: 0.6 }}>Recent</div>
          {history.map((h, i) => (
            <div key={i} onMouseDown={(e) => { e.preventDefault(); setQ(h); }}
              style={{ padding: "4px 8px", cursor: "pointer", borderRadius: 3, fontSize: 12, fontFamily: "Consolas, monospace", color: "#bbb" }}
              onMouseEnter={(e) => e.currentTarget.style.background = "rgba(220,166,74,0.08)"}
              onMouseLeave={(e) => e.currentTarget.style.background = "transparent"}>
              {h}
            </div>
          ))}
        </div>
      )}
      {open && matches.length > 0 && (
        <div style={{ position: "absolute", top: "100%", left: 0, marginTop: 4, background: "rgba(20,22,23,0.98)", border: "1px solid rgba(220,166,74,0.3)", borderRadius: 6, padding: 4, minWidth: 280, maxHeight: 360, overflowY: "auto", zIndex: 800, boxShadow: "0 8px 24px rgba(0,0,0,0.5)" }}>
          {matches.map((m, i) => (
            <div
              key={i}
              onMouseDown={(e) => {
                e.preventDefault();
                pushHistory(q);
                if (m.edb && m.id && onJumpToUnit) onJumpToUnit(m.id);
                else if (m.edu && onJumpToEdu) onJumpToEdu();
                setOpen(false);
              }}
              style={{ padding: "5px 8px", cursor: "pointer", borderRadius: 3, display: "flex", alignItems: "center", gap: 6, fontSize: 12 }}
              onMouseEnter={(e) => e.currentTarget.style.background = "rgba(220,166,74,0.10)"}
              onMouseLeave={(e) => e.currentTarget.style.background = "transparent"}
            >
              <span style={{ flex: 1, fontFamily: "Consolas, monospace" }}>{m.name}</span>
              {m.edb && <span style={{ fontSize: 9, color: "#7c9", border: "1px solid rgba(124,201,153,0.4)", padding: "0 4px", borderRadius: 2, fontWeight: 700 }}>EDB</span>}
              {m.edu && <span style={{ fontSize: 9, color: "#dca64a", border: "1px solid rgba(220,166,74,0.4)", padding: "0 4px", borderRadius: 2, fontWeight: 700 }}>EDU</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// Sub-tab strip for the EDU Builder tab. Picks which EDU-matic screen is shown.
// Disabled until a project is loaded (matches EDU-matic's own sidebar logic).
function EduSubTabs({ view, onView, project }) {
  const VIEWS = [
    { key: "project",  label: "Project" },
    { key: "modinfo",  label: "Mod Info" },
    { key: "coredata", label: "Core Data" },
    { key: "units",    label: "Units" },
    { key: "bulk",     label: "Bulk Edit" },
    { key: "armour",   label: "Armour" },
    { key: "merc",     label: "Mercenaries" },
    { key: "validate", label: "Validate" },
    { key: "preview",  label: "Preview EDU" },
    { key: "export",   label: "Export EDU" },
  ];
  return (
    <div style={{ display: "flex", borderBottom: "1px solid rgba(255,255,255,0.06)", background: "rgba(20,22,23,0.4)", padding: "0 8px", flexWrap: "wrap" }}>
      {VIEWS.map(v => {
        const disabled = !project && v.key !== "project";
        const active = view === v.key;
        return (
          <div
            key={v.key}
            onClick={() => !disabled && onView(v.key)}
            style={{
              padding: "6px 14px",
              borderBottom: active ? "2px solid #dca64a" : "2px solid transparent",
              cursor: disabled ? "not-allowed" : "pointer",
              color: disabled ? "#555" : active ? "#fff" : "#999",
              fontSize: 12,
              fontWeight: active ? 600 : 400,
            }}
          >{v.label}</div>
        );
      })}
    </div>
  );
}

function Tabs({ activeTab, onChange, validationSummary }) {
  const tab = (id, label, badge) => (
    <div
      key={id}
      onClick={() => onChange(id)}
      style={{
        padding: "8px 16px",
        borderBottom: activeTab === id ? "2px solid #dca64a" : "2px solid transparent",
        cursor: "pointer",
        color: activeTab === id ? "#fff" : "#999",
        fontWeight: activeTab === id ? 600 : 400,
        display: "flex",
        alignItems: "center",
        gap: 6,
        transition: "color 0.12s",
      }}
    >
      {label}
      {badge}
    </div>
  );
  const errBadge = validationSummary.error > 0 ? (
    <span style={{ background: "#e88", color: "#1a1a1a", borderRadius: 8, padding: "1px 6px", fontSize: 10, fontWeight: 700 }}>{validationSummary.error}</span>
  ) : validationSummary.warn > 0 ? (
    <span style={{ background: "#dca64a", color: "#1a1a1a", borderRadius: 8, padding: "1px 6px", fontSize: 10, fontWeight: 700 }}>{validationSummary.warn}</span>
  ) : null;
  return (
    <div style={{ display: "flex", borderBottom: "1px solid rgba(255,255,255,0.08)", background: "rgba(20,22,23,0.55)", backdropFilter: "blur(6px)", WebkitBackdropFilter: "blur(6px)" }}>
      {tab("editor", "Editor")}
      {tab("validation", "Validation", errBadge)}
      {tab("exportAll", "All units (preview)")}
      {tab("edu", "EDU Builder")}
    </div>
  );
}

function tbtn(color) {
  return { background: color, color: "#fff", border: "none", padding: "6px 12px", borderRadius: 6, fontSize: 12, fontWeight: 500 };
}

// Sync-dropdown action button. Enabled buttons get the active colour;
// disabled buttons drop to a desaturated dark fill so the eye lands on
// the action that's actually useful given the current repo state.
// Width: 100% so the dropdown's three buttons always lay out cleanly
// in a stack instead of wrapping at awkward widths.
function syncBtn(activeColor, isActive) {
  return {
    background: isActive ? activeColor : "#2a2a2a",
    color: isActive ? "#fff" : "#666",
    border: isActive ? "none" : "1px solid #333",
    padding: "8px 12px",
    borderRadius: 6,
    fontSize: 12,
    fontWeight: 600,
    width: "100%",
    textAlign: "left",
    cursor: isActive ? "pointer" : "not-allowed",
    fontFamily: "inherit",
  };
}

// SyncButton — small "Sync" entry in the topbar that wraps git pull /
// commit / push for the active project dir. Designed for the team
// member who doesn't want to learn git: one click pulls the latest,
// one click commits everything dirty + pushes. Hidden when there's no
// project dir, no git on PATH, or the dir isn't a git repo — Manipula
// stays out of the way unless it can actually help. Real merges,
// branch ops, history review etc. are out of scope; users open their
// usual git tool for those.
function SyncButton({ projectDir, saveTick = 0, validationErrors = [], onViewValidation = null, webhookUrl = "" }) {
  const validationErrorCount = validationErrors.length;
  const api = window.eduAPI;
  const [open, setOpen] = useState(false);
  const [available, setAvailable] = useState(null);
  const [status, setStatus] = useState(null);
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState("");
  // Inline commit-message prompt — Electron 6+ disables window.prompt() and
  // it returns "" without showing UI, so the previous version of "Commit +
  // Push" appeared to do nothing on click. State machine:
  //   commitPrompt = null      → no prompt active
  //                  string    → prompt is showing with that as the draft
  const [commitPrompt, setCommitPrompt] = useState(null);
  // Anchor coordinates for the portal-rendered popover. The popover
  // can't live inside the topbar's DOM tree because the tabs row below
  // has its own stacking context (backdrop-filter / sticky) that clips
  // a regular absolute-positioned descendant. Rendering via a portal
  // into document.body sidesteps every ancestor's stacking and overflow.
  const btnRef = useRef(null);
  const [pos, setPos] = useState(null);

  const [diffStat, setDiffStat] = useState("");
  const [activity, setActivity] = useState([]);
  const refresh = useCallback(async () => {
    if (!projectDir || !api?.gitStatus) { setStatus(null); return; }
    const s = await api.gitStatus(projectDir);
    setStatus(s);
    if (api.gitDiffStat && s && s.isRepo && s.dirtyCount > 0) {
      try {
        const d = await api.gitDiffStat(projectDir);
        setDiffStat((d && d.stdout) || "");
      } catch { setDiffStat(""); }
    } else {
      setDiffStat("");
    }
    // Recent commits — single git log call, parsed into the structured
    // activity panel below the action buttons. Only fired when the
    // dropdown is open, so we don't run a child process every 5s for
    // a panel the user isn't looking at.
    if (api.gitLogFile && s && s.isRepo) {
      try {
        const r = await api.gitLogFile(projectDir, ".", 8);
        if (r && r.ok) {
          const lines = (r.stdout || "").trim().split("\n").filter(Boolean);
          setActivity(lines.map(l => {
            const [hash, author, age] = l.split("|");
            return { hash, author, age };
          }));
        }
      } catch { setActivity([]); }
    } else { setActivity([]); }
  }, [projectDir, api]);

  useEffect(() => {
    if (!api?.gitAvailable) { setAvailable(false); return; }
    let cancelled = false;
    api.gitAvailable().then(v => { if (!cancelled) setAvailable(v); });
    return () => { cancelled = true; };
  }, [api]);

  useEffect(() => { refresh(); }, [refresh]);
  // Refresh the moment the parent reports a successful save — this is the
  // hot path: user hits Save Project, we want the dot to flip red
  // immediately so they can Commit + Push without waiting for the next
  // poll tick.
  useEffect(() => { if (saveTick > 0) refresh(); }, [saveTick, refresh]);
  // Light polling so the dot tracks reality between saves (e.g. teammate
  // pushes new commits, or the user touched a file outside Manipula).
  // 5s is brisk enough that transitions feel live, cheap enough that
  // running `git status --porcelain` in the background isn't noticed.
  useEffect(() => {
    if (!projectDir) return;
    const id = setInterval(refresh, 5000);
    return () => clearInterval(id);
  }, [projectDir, refresh]);

  // Reposition the popover when it opens, and keep it anchored if the
  // window resizes / scrolls while it's open. Same pattern as the
  // combobox popover in DataTable.
  useEffect(() => {
    if (!open) return;
    refresh();   // pull fresh status the instant the user looks
    const reposition = () => {
      if (!btnRef.current) return;
      const r = btnRef.current.getBoundingClientRect();
      // Anchor to the right edge of the button so the popover never
      // pokes outside the right side of the window. Width 320 is fixed
      // below in the popover style.
      setPos({ top: r.bottom + 6, right: window.innerWidth - r.right });
    };
    reposition();
    const onDocMouseDown = (e) => {
      if (btnRef.current && btnRef.current.contains(e.target)) return;
      // Allow clicks inside the portal-rendered popover. We tag it with
      // a data attribute since it's not a descendant of btnRef.
      const pop = document.querySelector("[data-sync-popover]");
      if (pop && pop.contains(e.target)) return;
      setOpen(false);
    };
    window.addEventListener("scroll", reposition, true);
    window.addEventListener("resize", reposition);
    document.addEventListener("mousedown", onDocMouseDown);
    return () => {
      window.removeEventListener("scroll", reposition, true);
      window.removeEventListener("resize", reposition);
      document.removeEventListener("mousedown", onDocMouseDown);
    };
  }, [open, refresh]);

  if (!projectDir || available === false) return null;

  const dirty = status && status.isRepo && status.dirtyCount > 0;
  const ahead = status && status.ahead;
  const behind = status && status.behind;
  const indicator = !status?.isRepo ? "no-git"
    : dirty ? "dirty"
    : (ahead && ahead > 0) ? "ahead"
    : (behind && behind > 0) ? "behind"
    : "clean";
  const indicatorColour = {
    "no-git": "#666",
    dirty:   "#d66c6c",
    ahead:   "#dca64a",
    behind:  "#4f8fd6",
    clean:   "#7c9",
  }[indicator];
  // Build labels via optional-chaining so the eager object-literal evaluation
  // doesn't read `status.dirtyCount` when status is still null (which it is
  // for one render after mount, while git-status is in-flight). The previous
  // version crashed at boot whenever the project dir loaded faster than the
  // git status probe — caught by the new AppErrorBoundary in v0.20.3.
  const indicatorLabel = {
    "no-git": "Sync · not a git repo",
    dirty:   `Sync · ${status?.dirtyCount ?? 0} dirty`,
    ahead:   `Sync · ${ahead ?? 0} to push`,
    behind:  `Sync · ${behind ?? 0} to pull`,
    clean:   "Sync · up to date",
  }[indicator];

  const run = async (label, fn) => {
    setBusy(true);
    setLog(label + "…");
    try {
      const r = await fn();
      const out = (r.stdout || "") + (r.stderr ? "\n" + r.stderr : "");
      setLog(`${label} ${r.ok ? "✓" : "✗"}\n${out.trim() || "(no output)"}`);
      await refresh();
    } catch (e) {
      setLog(`${label} ✗\n${e.message}`);
    } finally { setBusy(false); }
  };

  return (
    <>
      <button
        ref={btnRef}
        onClick={() => setOpen(o => !o)}
        style={{ ...tbtn("#465"), display: "inline-flex", alignItems: "center", gap: 6 }}
        title={indicatorLabel}
      >
        <span style={{ width: 8, height: 8, borderRadius: 4, background: indicatorColour }} />
        Sync
      </button>
      {open && pos && createPortal(
        <div
          data-sync-popover
          style={{
            position: "fixed", top: pos.top, right: pos.right,
            background: "#1c1c1c", border: "1px solid #3a3a3a", borderRadius: 8,
            padding: 14, width: 320, zIndex: 10000,
            fontFamily: "Consolas, monospace", fontSize: 12, color: "#bbb",
            boxShadow: "0 8px 24px rgba(0,0,0,0.6)",
          }}
        >
          {!status?.isRepo ? (
            <div>
              <div style={{ color: "#dca64a", fontWeight: 700, fontSize: 13, marginBottom: 6 }}>Not a git repo</div>
              <div style={{ marginBottom: 10, lineHeight: 1.4, color: "#999" }}>
                Run <code style={{ background: "#0e0e0e", padding: "1px 4px", borderRadius: 3 }}>git init</code> in the project folder, push it to a remote (e.g. GitHub), then teammates clone and use <b>Open Project</b> here.
              </div>
              <button onClick={refresh} style={syncBtn("#3a4a5a", false)} disabled={busy}>Re-check</button>
            </div>
          ) : (
            <>
              {/* Header — branch + upstream + counters in two compact rows. */}
              <div style={{ marginBottom: 12, paddingBottom: 10, borderBottom: "1px solid #2a2a2a" }}>
                <div style={{ color: "#dca64a", fontWeight: 700, fontSize: 13 }}>
                  {status.branch}
                  {status.upstream ? <span style={{ color: "#555", fontWeight: 400 }}> → <span style={{ color: "#888" }}>{status.upstream}</span></span> : <span style={{ color: "#666", fontWeight: 400 }}> · no upstream</span>}
                </div>
                <div style={{ color: "#888", fontSize: 11, marginTop: 4, display: "flex", gap: 10 }}>
                  <span style={{ color: dirty ? "#d66c6c" : "#666" }}>● {status.dirtyCount} dirty</span>
                  <span style={{ color: (ahead || 0) > 0 ? "#dca64a" : "#666" }}>↑ {ahead ?? 0} ahead</span>
                  <span style={{ color: (behind || 0) > 0 ? "#4f8fd6" : "#666" }}>↓ {behind ?? 0} behind</span>
                  {validationErrorCount > 0 && <span style={{ color: "#d66c6c" }}>⚠ {validationErrorCount} errors</span>}
                </div>
                {dirty && diffStat && (
                  <pre style={{ margin: "8px 0 0", padding: 6, background: "#0e0e0e", border: "1px solid #2a2a2a", borderRadius: 4, fontSize: 10, color: "#bbb", maxHeight: 120, overflow: "auto", whiteSpace: "pre" }}>
                    {diffStat.trim()}
                  </pre>
                )}
                {validationErrorCount > 0 && (
                  <div style={{ marginTop: 8, padding: 6, background: "rgba(214,108,108,0.08)", border: "1px solid rgba(214,108,108,0.4)", borderRadius: 4, fontSize: 10, color: "#e88", maxHeight: 160, overflow: "auto" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                      <span style={{ color: "#d66c6c", fontWeight: 700 }}>
                        ⚠ {validationErrorCount} validation error{validationErrorCount === 1 ? "" : "s"}
                      </span>
                      {onViewValidation && (
                        <button
                          type="button"
                          onClick={() => { onViewValidation(); setOpen(false); }}
                          style={{ background: "none", border: "none", color: "#dca64a", cursor: "pointer", padding: 0, fontSize: 10, textDecoration: "underline" }}
                          title="Open the Validate screen to see all errors and fix them"
                        >view all in Validate tab →</button>
                      )}
                    </div>
                    {validationErrors.slice(0, 5).map((e, i) => (
                      <div key={i} style={{ padding: "2px 0", fontFamily: "Consolas, monospace", lineHeight: 1.4, color: "#ddd" }}>
                        <span style={{ color: "#d66c6c" }}>{e.unit || "<project>"}</span>
                        <span style={{ color: "#888" }}>{e.row != null ? ` r${e.row}` : ""}: </span>
                        <span>{e.message}</span>
                      </div>
                    ))}
                    {validationErrorCount > 5 && (
                      <div style={{ padding: "2px 0", color: "#888", fontStyle: "italic" }}>+ {validationErrorCount - 5} more — open Validate tab to see them all</div>
                    )}
                  </div>
                )}
              </div>

              {/* Action buttons — stacked full-width so they always lay out
                  cleanly regardless of label length / count badges. The
                  primary action (the one most likely to be useful right
                  now, based on state) gets the brighter colour. */}
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <button
                  disabled={busy || (behind || 0) === 0}
                  onClick={() => run("Pull", () => api.gitPull(projectDir))}
                  style={syncBtn("#4f8fd6", (behind || 0) > 0)}
                  title="git pull --ff-only"
                >
                  Pull {behind ? `(${behind})` : ""}
                </button>
                <button
                  disabled={busy || !dirty}
                  onClick={() => {
                    if (validationErrorCount > 0) {
                      const ok = window.confirm(
                        `Validation reports ${validationErrorCount} error${validationErrorCount === 1 ? "" : "s"} in this project. ` +
                        `Pushing now means teammates will pull broken state.\n\nPush anyway?`
                      );
                      if (!ok) return;
                    }
                    setCommitPrompt("Manipula update");
                  }}
                  style={syncBtn("#7c9", dirty)}
                  title={validationErrorCount > 0
                    ? `git add . && git commit -m && git push  ⚠ ${validationErrorCount} validation errors`
                    : "git add . && git commit -m && git push"}
                >
                  Commit + Push {dirty ? `(${status.dirtyCount})` : ""}
                  {validationErrorCount > 0 ? ` ⚠` : ""}
                </button>
                {commitPrompt !== null && (
                  <div style={{ background: "#0e0e0e", border: "1px solid #2a2a2a", borderRadius: 4, padding: 8, display: "flex", flexDirection: "column", gap: 6 }}>
                    <div style={{ color: "#dca64a", fontSize: 11 }}>Commit message</div>
                    <input
                      autoFocus
                      type="text"
                      value={commitPrompt}
                      onChange={(e) => setCommitPrompt(e.target.value)}
                      onKeyDown={async (e) => {
                        if (e.key === "Escape") { setCommitPrompt(null); }
                        else if (e.key === "Enter" && commitPrompt.trim()) {
                          const msg = commitPrompt;
                          setCommitPrompt(null);
                          await run("Commit + push", async () => {
                            const c = await api.gitCommitAll(projectDir, msg);
                            if (!c.ok) return c;
                            const p = await api.gitPush(projectDir);
                            if (p.ok && webhookUrl) {
                              // Fire-and-forget Discord-style POST. Failures
                              // are non-fatal and we don't surface them in
                              // the log so a stale webhook URL doesn't
                              // distract from a successful push.
                              try {
                                await fetch(webhookUrl, {
                                  method: "POST",
                                  headers: { "Content-Type": "application/json" },
                                  body: JSON.stringify({ content: `**Manipula push** — ${msg}` }),
                                });
                              } catch {}
                            }
                            return p;
                          });
                        }
                      }}
                      style={{ background: "#1c1c1c", color: "#fff", border: "1px solid #3a3a3a", borderRadius: 4, padding: "5px 8px", fontFamily: "Consolas, monospace", fontSize: 12, outline: "none" }}
                    />
                    <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
                      <button
                        onClick={() => setCommitPrompt(null)}
                        style={{ background: "#2a2a2a", color: "#999", border: "1px solid #333", padding: "4px 10px", borderRadius: 4, fontSize: 11, cursor: "pointer" }}
                      >Cancel</button>
                      <button
                        disabled={!commitPrompt.trim()}
                        onClick={async () => {
                          const msg = commitPrompt;
                          setCommitPrompt(null);
                          await run("Commit + push", async () => {
                            const c = await api.gitCommitAll(projectDir, msg);
                            if (!c.ok) return c;
                            const p = await api.gitPush(projectDir);
                            if (p.ok && webhookUrl) {
                              // Fire-and-forget Discord-style POST. Failures
                              // are non-fatal and we don't surface them in
                              // the log so a stale webhook URL doesn't
                              // distract from a successful push.
                              try {
                                await fetch(webhookUrl, {
                                  method: "POST",
                                  headers: { "Content-Type": "application/json" },
                                  body: JSON.stringify({ content: `**Manipula push** — ${msg}` }),
                                });
                              } catch {}
                            }
                            return p;
                          });
                        }}
                        style={{ background: "#7c9", color: "#fff", border: "none", padding: "4px 10px", borderRadius: 4, fontSize: 11, fontWeight: 600, cursor: "pointer" }}
                      >Commit + Push</button>
                    </div>
                  </div>
                )}
                <button
                  disabled={busy || (ahead || 0) === 0}
                  onClick={() => run("Push", () => api.gitPush(projectDir))}
                  style={syncBtn("#465", (ahead || 0) > 0)}
                  title="git push (no commit)"
                >
                  Push only {ahead ? `(${ahead})` : ""}
                </button>
              </div>

              {/* Footer — refresh + log. Tucked below the action area so it
                  doesn't compete with the primary buttons for attention. */}
              <div style={{ marginTop: 10, paddingTop: 8, borderTop: "1px solid #2a2a2a", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <button
                  disabled={busy}
                  onClick={refresh}
                  style={{ background: "none", border: "none", color: "#888", cursor: busy ? "default" : "pointer", padding: "2px 4px", fontSize: 11, textDecoration: "underline" }}
                  title="Re-check git state"
                >
                  Refresh
                </button>
                {busy && <span style={{ color: "#dca64a", fontSize: 11 }}>Working…</span>}
              </div>

              {log && (
                <pre style={{
                  background: "#0e0e0e", border: "1px solid #2a2a2a", borderRadius: 4,
                  padding: 8, marginTop: 10, maxHeight: 140, overflow: "auto",
                  fontSize: 10, color: "#ccc", whiteSpace: "pre-wrap", lineHeight: 1.4,
                }}>{log}</pre>
              )}

              {activity.length > 0 && (
                <div style={{ marginTop: 10, paddingTop: 8, borderTop: "1px solid #2a2a2a" }}>
                  <div style={{ color: "#888", fontSize: 10, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 4 }}>Recent activity</div>
                  {activity.map((c, i) => (
                    <div key={i} style={{ fontSize: 11, color: "#bbb", padding: "2px 0", display: "flex", gap: 8 }}>
                      <span style={{ color: "#888", fontFamily: "Consolas, monospace" }}>{c.hash}</span>
                      <span style={{ color: "#dca64a", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.author}</span>
                      <span style={{ color: "#666" }}>{c.age}</span>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>,
        document.body
      )}
    </>
  );
}
const ACCENT = "#dca64a";

function isImportedUnit(u) {
  const n = (u.notes || "").toLowerCase();
  return n.includes("imported");
}

// Auto-update toast (top-right). Surfaces every state so manual update checks always give feedback:
//   - "available"   → "Update v0.X available. Downloading…"
//   - "downloading" → percent progress
//   - "downloaded"  → "Update v0.X ready. [Restart and install]"
//   - "none"        → "You're on the latest version (v0.X)."
//   - "error"       → "Update check failed: <reason>"
function UpdateToast({ status, currentVersion, onInstall, onDismiss }) {
  const isError = status.state === "error";
  const isInfo = status.state === "none";
  const accentBorder = isError ? "rgba(232,136,136,0.35)" : isInfo ? "rgba(122,154,170,0.35)" : "rgba(220,166,74,0.35)";
  const wrap = {
    position: "fixed", top: 16, right: 16, zIndex: 1500,
    background: "rgba(28,30,32,0.96)", border: `1px solid ${accentBorder}`, borderRadius: 10,
    padding: "12px 16px", fontSize: 13, color: "#eee", minWidth: 280, maxWidth: 380,
    boxShadow: "0 8px 24px rgba(0,0,0,0.5)",
  };
  let body, action;
  if (status.state === "available") {
    body = <>Update <strong style={{ color: ACCENT }}>v{status.version}</strong> available. Downloading…</>;
  } else if (status.state === "downloading") {
    body = <>Downloading update — <strong style={{ color: ACCENT }}>{status.percent || 0}%</strong></>;
  } else if (status.state === "downloaded") {
    body = <>Update <strong style={{ color: ACCENT }}>v{status.version}</strong> ready.</>;
    action = <button onClick={onInstall} style={{ ...tbtn(ACCENT), color: "#1a1a1a", fontWeight: 700, marginTop: 8 }}>Restart and install</button>;
  } else if (status.state === "none") {
    body = <>You're on the latest version{currentVersion ? ` (v${currentVersion})` : ""}.</>;
  } else if (status.state === "checking") {
    body = <>Checking for updates…</>;
  } else if (isError) {
    body = <>Update check failed: <span style={{ color: "#e88" }}>{status.message || "(unknown)"}</span></>;
  } else {
    return null;
  }
  return (
    <div style={wrap}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
        <div style={{ flex: 1 }}>{body}</div>
        <button onClick={onDismiss} style={{ background: "transparent", border: "none", color: "#888", cursor: "pointer", fontSize: 16, lineHeight: 1, padding: 0 }} title="Dismiss">×</button>
      </div>
      {action && <div>{action}</div>}
    </div>
  );
}

// Bulk find/replace dialog. Operates on every requires-clause of every unit (commonRequires,
// outsideExtras, aorRequires, legacy requires). Shows a live preview of how many lines will
// change before the user commits.
function FindReplaceModal({ units, onApply, onClose }) {
  const [find, setFind] = useState("");
  const [replace, setReplace] = useState("");
  const preview = useMemo(() => {
    if (!find) return { unitCount: 0, lineCount: 0, samples: [] };
    let unitCount = 0, lineCount = 0;
    const samples = [];
    for (const u of units) {
      const arrs = [u.commonRequires, u.outsideExtras, u.aorRequires, u.requires];
      let hit = false;
      for (const arr of arrs) {
        if (!Array.isArray(arr)) continue;
        for (const s of arr) {
          if (typeof s !== "string") continue;
          if (s.includes(find)) {
            hit = true; lineCount++;
            if (samples.length < 6) samples.push({ unit: u.unit, before: s, after: s.split(find).join(replace) });
          }
        }
      }
      if (hit) unitCount++;
    }
    return { unitCount, lineCount, samples };
  }, [units, find, replace]);
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 4000 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: "rgba(28,30,32,0.98)", border: "1px solid rgba(220,166,74,0.3)", borderRadius: 10, padding: 20, width: 720, maxWidth: "90vw", maxHeight: "85vh", display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ fontSize: 16, fontWeight: 700, color: "#dca64a" }}>Bulk find &amp; replace</div>
        <div style={{ fontSize: 12, color: "#bca" }}>Substring match across every unit's <code>commonRequires</code>, <code>outsideExtras</code>, <code>aorRequires</code>, and legacy <code>requires</code>. Use this to rename hidden_resources, reforms, aliases, etc.</div>
        <div style={{ display: "flex", gap: 8 }}>
          <input
            type="text" value={find} onChange={(e) => setFind(e.target.value)}
            placeholder='find — e.g. "hidden_resource iberia"'
            style={{ flex: 1, background: "#252525", border: "1px solid #333", color: "#ddd", padding: "8px 10px", borderRadius: 6, fontFamily: "Consolas, monospace", fontSize: 12 }}
          />
          <input
            type="text" value={replace} onChange={(e) => setReplace(e.target.value)}
            placeholder='replace with — e.g. "hidden_resource iberian_peninsula"'
            style={{ flex: 1, background: "#252525", border: "1px solid #333", color: "#ddd", padding: "8px 10px", borderRadius: 6, fontFamily: "Consolas, monospace", fontSize: 12 }}
          />
        </div>
        <div style={{ fontSize: 12, color: preview.lineCount > 0 ? "#7c9" : "#888" }}>
          {find ? `Will change ${preview.lineCount} line${preview.lineCount === 1 ? "" : "s"} across ${preview.unitCount} unit${preview.unitCount === 1 ? "" : "s"}.` : "Type a search string to preview."}
        </div>
        {preview.samples.length > 0 && (
          <div style={{ background: "rgba(15,17,18,0.6)", border: "1px solid #2a2a2a", borderRadius: 6, padding: 10, fontFamily: "Consolas, monospace", fontSize: 11.5, maxHeight: 280, overflow: "auto" }}>
            {preview.samples.map((s, i) => (
              <div key={i} style={{ marginBottom: 6 }}>
                <div style={{ color: "#888", fontSize: 10 }}>{s.unit}</div>
                <div style={{ color: "#e88" }}>− {s.before}</div>
                <div style={{ color: "#7c9" }}>+ {s.after}</div>
              </div>
            ))}
            {preview.lineCount > preview.samples.length && (
              <div style={{ color: "#888", fontStyle: "italic" }}>…and {preview.lineCount - preview.samples.length} more</div>
            )}
          </div>
        )}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: "auto" }}>
          <button onClick={onClose} style={{ background: "rgba(255,255,255,0.06)", color: "#bbb", border: "1px solid rgba(255,255,255,0.08)", padding: "8px 16px", borderRadius: 6, fontSize: 12 }}>Cancel</button>
          <button
            disabled={!find || preview.lineCount === 0}
            onClick={() => { const n = onApply({ find, replace }); onClose(); }}
            style={{ background: !find || preview.lineCount === 0 ? "rgba(220,166,74,0.2)" : "#dca64a", color: !find || preview.lineCount === 0 ? "#888" : "#1a1a1a", border: "none", padding: "8px 16px", borderRadius: 6, fontSize: 12, fontWeight: 700, cursor: !find || preview.lineCount === 0 ? "default" : "pointer" }}
          >Replace {preview.lineCount} {preview.lineCount === 1 ? "line" : "lines"}</button>
        </div>
      </div>
    </div>
  );
}

// Clone-from-GitHub modal — onboarding helper for teammates who don't
// want to use a terminal. They paste a repo URL, pick a parent folder,
// confirm the leaf name, and the app shells out to `git clone`. On
// success we automatically load the cloned dir as the active project.
// Auth is handled by whatever Git Credential Manager / GitHub Desktop
// they have set up — same as any other git clone from their machine.
function CloneRepoModal({ state, setState, onLoaded, onClose }) {
  const { url, parent, leaf, busy, log } = state;
  // Auto-fill the leaf folder name from the URL path's last segment so
  // the user doesn't have to think about naming. Strips ".git" suffix.
  const inferLeaf = (u) => {
    if (!u) return "";
    const m = u.match(/\/([^/?#]+?)(?:\.git)?(?:[?#].*)?$/);
    return m ? m[1] : "";
  };
  const setUrl = (u) => {
    const cur = state.leaf;
    setState({ ...state, url: u, leaf: cur && cur !== inferLeaf(state.url) ? cur : inferLeaf(u) });
  };
  const pickParent = async () => {
    if (!window.eduAPI?.chooseCloneParent) return;
    const p = await window.eduAPI.chooseCloneParent();
    if (p) setState({ ...state, parent: p });
  };
  const dest = parent && leaf ? `${parent.replace(/[\\/]+$/, "")}\\${leaf}` : "";
  const startClone = async () => {
    if (!window.eduAPI?.gitClone || !url || !parent || !leaf) return;
    setState({ ...state, busy: true, log: `Cloning ${url}…` });
    const r = await window.eduAPI.gitClone(url, dest);
    const out = (r.stdout || "") + (r.stderr ? "\n" + r.stderr : "");
    if (!r.ok) {
      setState({ ...state, busy: false, log: `Clone failed:\n${out.trim() || (r.stderr || "?")}` });
      return;
    }
    setState({ ...state, busy: false, log: `Cloned to ${dest}\n${out.trim()}\n\nOpening project…` });
    const ok = await onLoaded(dest);
    if (ok) onClose();
  };
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 6000, background: "rgba(0,0,0,0.65)", backdropFilter: "blur(4px)", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ background: "rgba(28,30,32,0.98)", border: "1px solid rgba(220,166,74,0.35)", borderRadius: 10, padding: 24, maxWidth: 560, width: "90%", color: "#ddd", boxShadow: "0 12px 40px rgba(0,0,0,0.6)" }}>
        <div style={{ fontSize: 20, fontWeight: 700, color: "#dca64a", marginBottom: 4 }}>Clone Manipula project from GitHub</div>
        <div style={{ fontSize: 12, color: "#aaa", marginBottom: 18, lineHeight: 1.5 }}>
          Paste a repo URL, pick where on disk to put it, and click Clone. Auth uses whatever Git client (GitHub Desktop, Credential Manager, gh CLI) is already set up on this machine.
        </div>
        <div className="field" style={{ alignItems: "center" }}>
          <span>Repo URL</span>
          <input
            className="input"
            placeholder="https://github.com/Tarnholm/ris-manipula.git"
            value={url}
            autoFocus
            onChange={(e) => setUrl(e.target.value)}
            disabled={busy}
            style={{ flex: 1, minWidth: 280 }}
          />
        </div>
        <div className="field" style={{ alignItems: "center" }}>
          <span>Parent folder</span>
          <input
            className="input"
            placeholder="C:\dev"
            value={parent}
            onChange={(e) => setState({ ...state, parent: e.target.value })}
            disabled={busy}
            style={{ flex: 1, minWidth: 200 }}
          />
          <button className="btn" onClick={pickParent} disabled={busy} style={{ marginLeft: 6 }}>Browse…</button>
        </div>
        <div className="field" style={{ alignItems: "center" }}>
          <span>Folder name</span>
          <input
            className="input"
            placeholder="ris-manipula"
            value={leaf}
            onChange={(e) => setState({ ...state, leaf: e.target.value })}
            disabled={busy}
            style={{ flex: 1, minWidth: 200 }}
          />
        </div>
        {dest && (
          <div className="field" style={{ alignItems: "center" }}>
            <span>Destination</span>
            <strong style={{ color: "#aaa", fontFamily: "Consolas, monospace", fontSize: 11, wordBreak: "break-all" }}>{dest}</strong>
          </div>
        )}
        {log && (
          <pre style={{ background: "#0e0e0e", border: "1px solid #2a2a2a", borderRadius: 4, padding: 8, marginTop: 12, maxHeight: 160, overflow: "auto", fontSize: 11, color: "#ccc", whiteSpace: "pre-wrap", lineHeight: 1.4 }}>{log}</pre>
        )}
        <div style={{ marginTop: 20, display: "flex", gap: 10, justifyContent: "flex-end" }}>
          <button className="btn" onClick={onClose} disabled={busy}>Cancel</button>
          <button
            className="btn btn-accent"
            onClick={startClone}
            disabled={busy || !url || !parent || !leaf}
          >{busy ? "Cloning…" : "Clone & open"}</button>
        </div>
      </div>
    </div>
  );
}

// Conflict resolver — surfaces when previewWriteBack detects that the
// game's EDB has been modified externally since Manipula's last export.
// Replaces the previous bare window.confirm() so the user can:
//   - See *when* the last export was, so they can correlate
//   - Open the EDB in their default text editor to inspect what changed
//   - Show the about-to-be-written diff (jumps to the existing DiffModal)
//   - Overwrite anyway (the .bak rotation in main still fires)
//   - Cancel without writing
// Three-way merge / per-line cherry-pick is out of scope here — that
// belongs in the user's normal git client. This modal exists to make
// the "I'm about to clobber someone's work" moment legible and
// recoverable.
function EdbConflictModal({ conflict, onCancel, onShowDiff, onOpenInEditor, onOverwrite }) {
  const filename = conflict.path ? String(conflict.path).split(/[\\/]/).pop() : "export_descr_buildings.txt";
  const exportedAt = conflict.exportedAt ? new Date(conflict.exportedAt) : null;
  const ago = exportedAt ? Math.round((Date.now() - exportedAt.getTime()) / 60000) : null;
  const agoLabel = ago == null ? "" :
    ago < 1 ? "just now" :
    ago < 60 ? `${ago} min ago` :
    ago < 24 * 60 ? `${Math.round(ago / 60)} hr ago` :
    `${Math.round(ago / 60 / 24)} day ago`;
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 6000, background: "rgba(0,0,0,0.65)", backdropFilter: "blur(4px)", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ background: "rgba(28,30,32,0.98)", border: "1px solid #d66c6c", borderRadius: 10, padding: 24, maxWidth: 560, color: "#ddd", boxShadow: "0 12px 40px rgba(0,0,0,0.6)" }}>
        <div style={{ fontSize: 20, fontWeight: 700, color: "#d66c6c", marginBottom: 6 }}>Conflict on {filename}</div>
        <div style={{ fontSize: 12, color: "#aaa", marginBottom: 14, lineHeight: 1.5 }}>
          The file on disk has been modified since Manipula's last export
          {agoLabel ? ` (${agoLabel})` : ""}. Writing now will overwrite those external
          changes — possibly someone else's work or hand-edits to a section the tool
          doesn't manage.
        </div>
        {conflict.path && (
          <div style={{ fontSize: 11, color: "#888", marginBottom: 16, fontFamily: "Consolas, monospace", padding: "6px 8px", background: "#0e0e0e", border: "1px solid #2a2a2a", borderRadius: 4, wordBreak: "break-all" }}>
            {conflict.path}
          </div>
        )}
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <button
            onClick={onShowDiff}
            style={{ background: "#3a4a5a", color: "#fff", border: "1px solid #4f8fd6", padding: "8px 14px", borderRadius: 6, fontWeight: 600, cursor: "pointer", textAlign: "left", fontSize: 12 }}
            title="See exactly what Manipula would change vs the current EDB"
          >Show diff (what Manipula would write)</button>
          <button
            onClick={onOpenInEditor}
            style={{ background: "#2a2a2a", color: "#ddd", border: "1px solid #3a3a3a", padding: "8px 14px", borderRadius: 6, fontWeight: 600, cursor: "pointer", textAlign: "left", fontSize: 12 }}
            title="Open the file in your default text editor so you can inspect the external changes directly"
          >Open EDB in default editor</button>
          <button
            onClick={onOverwrite}
            style={{ background: "#d66c6c", color: "#fff", border: "none", padding: "8px 14px", borderRadius: 6, fontWeight: 700, cursor: "pointer", textAlign: "left", fontSize: 12 }}
            title="Proceed to the diff modal and overwrite the on-disk EDB. .bak is created by main."
          >Overwrite anyway</button>
          <button
            onClick={onCancel}
            style={{ background: "transparent", color: "#aaa", border: "1px solid #3a3a3a", padding: "8px 14px", borderRadius: 6, fontWeight: 500, cursor: "pointer", textAlign: "left", fontSize: 12 }}
          >Cancel</button>
        </div>
      </div>
    </div>
  );
}

function DiffModal({ diff, onCancel, onConfirm }) {
  const { added, removed, kept } = diff;
  const Section = ({ title, color, items }) => (
    <details open style={{ marginBottom: 8 }}>
      <summary style={{ cursor: "pointer", color, fontWeight: 600 }}>{title} ({items.length})</summary>
      <pre style={{ margin: "4px 0 0 0", maxHeight: 200, overflow: "auto", background: "rgba(15,17,18,0.7)", padding: 6, fontFamily: "Consolas, monospace", fontSize: 11.5, color: "#bbb", border: "1px solid #2a2a2a", whiteSpace: "pre-wrap" }}>
{items.slice(0, 200).map(e => `${e.building}/${e.level}  xp=${e.xp}  "${e.unit}"\n  ${e.requires}`).join("\n")}
{items.length > 200 ? `\n…and ${items.length - 200} more` : ""}
      </pre>
    </details>
  );
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)", backdropFilter: "blur(4px)", WebkitBackdropFilter: "blur(4px)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ background: "rgba(28,30,32,0.95)", border: "1px solid rgba(220,166,74,0.18)", borderRadius: 14, padding: 24, boxShadow: "0 12px 48px rgba(0,0,0,0.5)", width: "80%", maxWidth: 1100, maxHeight: "85vh", overflow: "auto" }}>
        <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 12 }}>Confirm changes to export_descr_buildings.txt</div>
        <div style={{ marginBottom: 12, color: "#999" }}>
          A timestamped <code>.bak</code> will be created next to the original. Review what will change:
        </div>
        {diff.integrity && !diff.integrity.ok && (
          <div style={{ marginBottom: 12, padding: 10, background: "rgba(232,136,136,0.08)", border: "1px solid rgba(232,136,136,0.4)", borderRadius: 6, color: "#ddd", fontSize: 12 }}>
            <strong style={{ color: "#e88" }}>⚠ Round-trip check failed</strong>
            <div style={{ marginTop: 4 }}>
              {diff.integrity.error
                ? <>Verifier crashed: {diff.integrity.error}</>
                : <>{diff.integrity.missing.length} of {diff.integrity.expectedCount} expected lines wouldn't land in the file (anchor heuristic drift). Sample:</>}
            </div>
            {diff.integrity.missing && diff.integrity.missing.length > 0 && (
              <pre style={{ margin: "6px 0 0 0", maxHeight: 120, overflow: "auto", background: "rgba(15,17,18,0.6)", padding: 6, fontFamily: "Consolas, monospace", fontSize: 11, color: "#cba", border: "1px solid rgba(232,136,136,0.2)", borderRadius: 3 }}>
{diff.integrity.missing.slice(0, 8).map(m => `${m.building}/${m.level}  "${m.unit}"`).join("\n")}
{diff.integrity.missing.length > 8 ? `\n…and ${diff.integrity.missing.length - 8} more` : ""}
              </pre>
            )}
          </div>
        )}
        <Section title="To remove" color="#e88" items={removed} />
        <Section title="To add" color="#8e8" items={added} />
        <Section title="Unchanged (kept)" color="#888" items={kept} />
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 12 }}>
          <button onClick={onCancel} style={tbtn("#444")}>Cancel</button>
          <button onClick={onConfirm} style={{ ...tbtn(ACCENT), color: "#1a1a1a", fontWeight: 700 }}>Write {added.length} added · {removed.length} removed</button>
        </div>
      </div>
    </div>
  );
}

function unionAcross(arrays) {
  const s = new Set();
  for (const a of arrays) for (const x of a) s.add(x);
  return [...s];
}

function uniqueRequires(arrays) {
  const seen = new Set();
  const out = [];
  for (const a of arrays) for (const x of a) {
    if (!seen.has(x)) { seen.add(x); out.push(x); }
  }
  return out;
}
