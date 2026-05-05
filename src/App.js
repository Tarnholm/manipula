import React, { useEffect, useMemo, useState, useCallback, Component } from "react";

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
  componentDidCatch(error, info) { console.error("[app]", error, info); }
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
  useUndoShortcuts({ undo: history.undo, redo: history.redo });
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
            if (loadedEdu && (loadedEdu.units || loadedEdu.factions || loadedEdu.coreData)) setEduProject(loadedEdu);
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
        setEduProject(eduProj);
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
        setEduProject(null);
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
          setEduProject(eduProj);
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
  const [edumaticPreview, setEdumaticPreview] = useState(null); // { source, rows, selected: Set } | null
  const [updateStatus, setUpdateStatus] = useState(null); // { state: "available"|"downloading"|"downloaded"|"error", ... } | null
  // EDU-matic shared state — when set, the EDU Builder tab uses this project. A single xlsm
  // import populates both this and the recruitment-side import in one action.
  const [eduProject, setEduProject] = useState(null);
  const [eduView, setEduView] = useState("project"); // sub-view inside EDU Builder tab
  const [eduProjectSource, setEduProjectSource] = useState(null); // path of the xlsm last imported, for the topbar pill
  // Active Manipula project directory — null means "no project open yet,
  // working from a fresh xlsm import or empty state". Persisted to
  // localStorage so the tool reopens the last project on launch.
  const [projectDir, setProjectDir] = useState(null);
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
  // Welcome panel — first-launch onboarding. Dismissible forever via the "don't show again" checkbox.
  const [showWelcome, setShowWelcome] = useState(() => localStorage.getItem("rt:welcomeDismissed") !== "1");
  // Toast notifications — small queue with auto-expiry so action feedback (writes, exports,
  // imports) is visible at a glance instead of buried in the status bar.
  const [toasts, setToasts] = useState([]);
  const toast = useCallback((text, kind = "info", ms = 3500) => {
    const id = Date.now() + Math.random();
    setToasts(t => [...t, { id, text, kind }]);
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), ms);
  }, []);
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
        setEduProject(eduProj);
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

  // Re-check missing unit cards whenever the unit set or EDU index changes. Runs through
  // an IPC so main does the file existence checks (we don't want hundreds of fs.existsSync
  // calls in the renderer). Debounced so a typing burst doesn't thrash main.
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
      // first scroll through UnitList shows them without any decode latency.
      try { if (api.prewarmUnitCards) api.prewarmUnitCards(list); } catch {}
    }, 300);
    return () => clearTimeout(t);
  }, [units, modIndex]);

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

  const previewWriteBack = async () => {
    if (!api) return;
    if (!units.length) { alert("No units to write."); return; }
    const fresh = await api.readEDB();
    if (!fresh) { alert("Could not read EDB."); return; }
    // Stale-export detection: if we exported EDB before, compare the live
    // file's hash against the hash we recorded at export time. A mismatch
    // means the EDB was edited externally (teammate ran the game,
    // hand-authored a section, or pulled a newer commit) — we want the
    // user to confirm before overwriting that work.
    if (projectExports?.edb?.hashAtExport) {
      const { hashOfText } = await import("./projectStore");
      const liveHash = hashOfText(fresh);
      if (liveHash !== projectExports.edb.hashAtExport) {
        const ok = window.confirm(
          "External changes detected: export_descr_buildings.txt has been modified " +
          "since Manipula last wrote it. Continuing will overwrite those changes " +
          "(a .bak is created either way).\n\nWrite back anyway?"
        );
        if (!ok) return;
      }
    }
    const d = diffEDB(fresh, units);
    let integrity = null;
    try {
      const proposed = applyUnitsToEDB(fresh, units);
      integrity = verifyRoundTrip(proposed, units);
    } catch (e) { integrity = { ok: false, missing: [], error: e.message, expectedCount: 0 }; }
    setDiff({ ...d, fresh, integrity });
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
              <input type="checkbox" defaultChecked onChange={(e) => {
                if (e.target.checked) localStorage.setItem("rt:welcomeDismissed", "1");
                else localStorage.removeItem("rt:welcomeDismissed");
              }} />
              Don't show again
            </label>
            <button onClick={() => setShowWelcome(false)} style={{ background: "#dca64a", color: "#1a1a1a", border: "none", padding: "8px 18px", borderRadius: 6, fontWeight: 700, cursor: "pointer" }}>Get started</button>
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
          try {
            const { saveProject } = await import("./projectStore");
            await saveProject(dir, { eduProject, units, exports: projectExports });
            setEduDirty(false);
            toast(`Saved project → ${dir}`, "success");
          } catch (e) { toast("Save failed: " + e.message, "error"); }
        }}
        onOpenProject={async () => {
          if (!window.eduAPI?.openProject) return;
          const dir = await window.eduAPI.openProject();
          if (!dir) return;
          try {
            const { isProjectDir, loadProject } = await import("./projectStore");
            if (!(await isProjectDir(dir))) {
              toast("Not a Manipula project folder (no manipula.project.json)", "error");
              return;
            }
            if (eduDirty && !window.confirm("You have unsaved changes. Open another project anyway?")) return;
            const { eduProject: loadedEdu, units: loadedUnits, exports: loadedExports } = await loadProject(dir);
            if (loadedEdu && (loadedEdu.units || loadedEdu.factions || loadedEdu.coreData)) setEduProject(loadedEdu);
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
          } catch (e) { toast("Open failed: " + e.message, "error"); }
        }}
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

function Topbar({ dataDir, loading, status, eduProject, eduProjectSource, eduDirty, unitsCount, units, theme, onThemeToggle, onJumpToUnit, onJumpToEdu, onFindReplace, onExportBundle, onSaveProject, onOpenProject, projectDir, onPick, onReload, onImport, onImportEdumatic, onResetImportsToReferenceOnly, onWriteBack, onSaveText, onOpenBackups, profiles, activeProfile, onSwitchProfile, onNewProfile, onDeleteProfile, onUndo, onRedo, canUndo, canRedo, onCheckUpdates, info }) {
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
      <SyncButton projectDir={projectDir} />

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

// SyncButton — small "Sync" entry in the topbar that wraps git pull /
// commit / push for the active project dir. Designed for the team
// member who doesn't want to learn git: one click pulls the latest,
// one click commits everything dirty + pushes. Hidden when there's no
// project dir, no git on PATH, or the dir isn't a git repo — Manipula
// stays out of the way unless it can actually help. Real merges,
// branch ops, history review etc. are out of scope; users open their
// usual git tool for those.
function SyncButton({ projectDir }) {
  const api = window.eduAPI;
  const [open, setOpen] = useState(false);
  const [available, setAvailable] = useState(null);
  const [status, setStatus] = useState(null);
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState("");

  const refresh = useCallback(async () => {
    if (!projectDir || !api?.gitStatus) { setStatus(null); return; }
    setStatus(await api.gitStatus(projectDir));
  }, [projectDir, api]);

  useEffect(() => {
    if (!api?.gitAvailable) { setAvailable(false); return; }
    let cancelled = false;
    api.gitAvailable().then(v => { if (!cancelled) setAvailable(v); });
    return () => { cancelled = true; };
  }, [api]);

  useEffect(() => { refresh(); }, [refresh]);

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
  const indicatorLabel = {
    "no-git": "Sync · not a git repo",
    dirty:   `Sync · ${status.dirtyCount} dirty`,
    ahead:   `Sync · ${ahead} to push`,
    behind:  `Sync · ${behind} to pull`,
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
    <div style={{ position: "relative" }}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{ ...tbtn("#465"), display: "inline-flex", alignItems: "center", gap: 6 }}
        title={indicatorLabel}
      >
        <span style={{ width: 8, height: 8, borderRadius: 4, background: indicatorColour }} />
        Sync
      </button>
      {open && (
        <div
          style={{
            position: "absolute", top: "calc(100% + 4px)", right: 0,
            background: "#1c1c1c", border: "1px solid #3a3a3a", borderRadius: 6,
            padding: 12, minWidth: 320, zIndex: 1000, fontFamily: "Consolas, monospace",
            fontSize: 11, color: "#bbb",
          }}
        >
          {!status?.isRepo ? (
            <div>
              <div style={{ color: "#dca64a", fontWeight: 600, marginBottom: 4 }}>Project dir is not a git repo</div>
              <div style={{ marginBottom: 6 }}>Initialise it with your usual git tool, or run <code>git init</code> in {projectDir}.</div>
              <button onClick={refresh} style={tbtn("#3a4a5a")} disabled={busy}>Re-check</button>
            </div>
          ) : (
            <>
              <div style={{ marginBottom: 6, color: "#dca64a" }}>{status.branch}{status.upstream ? ` → ${status.upstream}` : " · no upstream"}</div>
              <div style={{ marginBottom: 8 }}>
                {status.dirtyCount} uncommitted file{status.dirtyCount === 1 ? "" : "s"}
                {status.ahead != null ? ` · ${status.ahead} ahead, ${status.behind} behind` : ""}
              </div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 8 }}>
                <button disabled={busy || behind === 0} onClick={() => run("Pull", () => api.gitPull(projectDir))} style={tbtn("#4f8fd6")} title="git pull --ff-only">Pull{behind ? ` (${behind})` : ""}</button>
                <button disabled={busy || !dirty} onClick={async () => {
                  const msg = window.prompt("Commit message:", "Manipula update");
                  if (!msg) return;
                  await run("Commit + push", async () => {
                    const c = await api.gitCommitAll(projectDir, msg);
                    if (!c.ok) return c;
                    return await api.gitPush(projectDir);
                  });
                }} style={tbtn("#7c9")} title="git add . && git commit -m && git push">Commit + Push</button>
                <button disabled={busy || (ahead === 0)} onClick={() => run("Push", () => api.gitPush(projectDir))} style={tbtn("#465")}>Push{ahead ? ` (${ahead})` : ""}</button>
                <button disabled={busy} onClick={refresh} style={tbtn("#3a4a5a")}>Refresh</button>
              </div>
              {log && (
                <pre style={{ background: "#0e0e0e", border: "1px solid #2a2a2a", borderRadius: 4, padding: 6, maxHeight: 160, overflow: "auto", fontSize: 10, color: "#ccc", whiteSpace: "pre-wrap", margin: 0 }}>{log}</pre>
              )}
            </>
          )}
        </div>
      )}
    </div>
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
