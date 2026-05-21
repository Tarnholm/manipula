import React, { useEffect, useMemo, useState, useCallback, useRef, Component } from "react";
import { createPortal } from "react-dom";
import ShortcutOverlay from "./components/ShortcutOverlay";

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
import { parseDMB } from "./parsers/dmb";
import { parseDMS } from "./parsers/dms";
import { parseDescrMount } from "./parsers/dmount";
import { parseDescrProjectile } from "./parsers/dprojectile";
import { parseDescrEngine } from "./parsers/dengine";
import { renderAllPreview, applyUnitsToEDB, diffEDB, verifyRoundTrip } from "./generator";
import { migrateV1 } from "./grades";
import { findQualityClass } from "./qualityClasses";

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
              // history.reset triggers the units→dirty effect; mark the
              // change as silent so the user isn't prompted to save a
              // project they just auto-loaded without touching.
              silentUnitChangeRef.current++;
              history.reset(loadedUnits.map(migrateV1));
              if (api && api.writeUnits) api.writeUnits({ units: loadedUnits });
            }
            setEduProjectSource(lastProject);
            setProjectDir(lastProject);
            setProjectExports(loadedExports || {});
            setProjectDirty(false);
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
      // DMB — extracts declared model types + every texture/model_flexi
      // path. Used by EDU validation in three ways:
      //   • flag units whose `model id` doesn't resolve to a `type X`
      //     block in DMB (game crashes on load)
      //   • flag DMB texture / model_flexi paths whose file is missing
      //     from the mod data folder
      //   • flag DMB types that no EDU unit references (cleanup target)
      //   • flag asset files (.tga / .cas) under data/characters that
      //     no DMB block references (cleanup target)
      const dmbParse = f.dmb ? parseDMB(f.dmb) : { types: new Set(), textures: [], models: [] };
      const dmbModels = dmbParse.types;
      // descr_character.txt's `battle_model X` lines also reference DMB
      // types (for general / admiral / captain models). Without including
      // those, the orphan-DMB-type check false-flags every general model
      // that no EDU unit happens to use as `model id`.
      const dmbExtraUsage = new Set();
      if (f.descrCharacter) {
        for (const raw of f.descrCharacter.split(/\r?\n/)) {
          const m = raw.replace(/;.*$/, "").match(/^\s*battle_model\s+(\S+)/i);
          if (m) dmbExtraUsage.add(m[1]);
        }
      }
      // descr_mount.txt: every `type X` block's `model Y` line points
      // at a DMB type. Add those Ys to dmbExtraUsage so the orphan-DMB
      // check doesn't false-flag mount models (horse_medium, camel,
      // elephant variants, chariot models, etc).
      const mountParse = f.dmount ? parseDescrMount(f.dmount) : { types: new Set(), typesLower: new Set(), modelByType: new Map() };
      for (const m of mountParse.modelByType.values()) dmbExtraUsage.add(m);
      // descr_projectile_new.txt — projectile type names for EDU's
      // 'pri missile type' / 'sec missile type' fields. Each block
      // declares one or more `model <path>` LOD lines (under
      // data/models_missile/) we'll asset-check.
      const projectileParse = f.dprojectile ? parseDescrProjectile(f.dprojectile) : { types: new Set(), modelPaths: [] };
      // descr_engines.txt — engine type names + their projectile +
      // every model_/missile_ path. EDU's `engine` column references
      // the type names; engines' projectile field references
      // descr_projectile_new.
      const engineParse = f.dengine ? parseDescrEngine(f.dengine) : { types: new Set(), projectileByType: new Map(), modelPaths: [] };
      // descr_model_strat.txt — strat-map character models. Parsed
      // up-front (not just inside the asset audit) because some sm_*
      // blocks reuse DMB-declared battle models via a shared `.cas`
      // path (e.g. sm_illyrian_general's model_flexi line points at
      // data/characters/illyria_officer_lod0.cas, the same file DMB's
      // `type illyria_officer` declares). Without crediting that DMB
      // type as "in use via DMS", it false-flags as orphan even though
      // deleting it would break the strat character.
      const dmsParse = f.dms ? parseDMS(f.dms) : { types: new Set(), modelPaths: [], flexiModels: [], textures: [] };
      // Map every DMB model_flexi/bare-model path → its declaring DMB
      // type. Used to translate DMS path-references into DMB-type
      // references so dmbExtraUsage can include them.
      const dmbPathToType = new Map();
      for (const m of dmbParse.models) {
        if (m.path && m.type) dmbPathToType.set(m.path.toLowerCase(), m.type);
      }
      for (const m of (dmbParse.bareModels || [])) {
        if (!m.path || !m.type) continue;
        const base = m.path.toLowerCase();
        for (let i = 0; i < 4; i++) dmbPathToType.set(`${base}_lod${i}.cas`, m.type);
      }
      // Credit DMB types used by DMS — flexi-form (path → direct
      // lookup) and bare-form (LOD-expand and try each variant).
      for (const m of (dmsParse.flexiModels || [])) {
        if (!m.path) continue;
        const t = dmbPathToType.get(m.path.toLowerCase().replace(/^[\\/]+/, ""));
        if (t) dmbExtraUsage.add(t);
      }
      for (const p of (dmsParse.modelPaths || [])) {
        if (!p) continue;
        const base = p.toLowerCase().replace(/^[\\/]+/, "");
        for (let i = 0; i < 4; i++) {
          const t = dmbPathToType.get(`${base}_lod${i}.cas`);
          if (t) dmbExtraUsage.add(t);
        }
      }
      // Recency tracking — persist a {typeName: ISO firstSeen} map in
      // localStorage so we can flag DMB types added recently as "likely
      // WIP" rather than safe-to-delete orphans. The user's workflow:
      //   1. create models + textures
      //   2. add to DMB
      //   3. add to local-only EDU, test
      //   4. add to repo EDU (often days later)
      // Steps 2–4 leave the type orphan from the repo's perspective. We
      // don't want bulk-strip-DMB to nuke a teammate's mid-workflow
      // additions. NEW_WINDOW_MS = 30 days.
      const FIRST_SEEN_KEY = "rt:dmbTypesFirstSeen:v1";
      const NEW_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;
      const dmbNewTypes = new Set();
      try {
        let stored = {};
        try { stored = JSON.parse(localStorage.getItem(FIRST_SEEN_KEY) || "{}") || {}; } catch {}
        const now = Date.now();
        const wasEmpty = Object.keys(stored).length === 0;
        // First-ever run on this machine: seed every current type as
        // "old" (timestamp pre-window) so the user isn't ambushed by
        // every existing DMB type being flagged new.
        const seedNew = new Date(now).toISOString();
        const seedOld = new Date(now - NEW_WINDOW_MS - 1000).toISOString();
        for (const t of dmbModels) {
          if (!stored[t]) {
            stored[t] = wasEmpty ? seedOld : seedNew;
            if (!wasEmpty) dmbNewTypes.add(t);
          } else {
            const firstSeen = Date.parse(stored[t]);
            if (Number.isFinite(firstSeen) && (now - firstSeen) < NEW_WINDOW_MS) dmbNewTypes.add(t);
          }
        }
        // Drop types no longer in DMB so the map doesn't grow unbounded.
        for (const t of Object.keys(stored)) if (!dmbModels.has(t)) delete stored[t];
        localStorage.setItem(FIRST_SEEN_KEY, JSON.stringify(stored));
      } catch (e) { console.warn("[dmb-recency] tracking failed:", e && e.message); }

      setModIndex(prev => ({
        ...prev,
        aliases: edb.aliases, buildings: edb.buildings, recruits: edb.recruits,
        reforms, scriptFiles,
        dmbModels,
        dmbExtraUsage,
        dmbNewTypes,
        mountTypesLower: mountParse.typesLower,
        mountModelByType: mountParse.modelByType,
        projectileTypes: projectileParse.types,
        projectileModelPaths: projectileParse.modelPaths,
        engineTypes: engineParse.types,
        engineProjectileByType: engineParse.projectileByType,
        engineModelPaths: engineParse.modelPaths,
        dmbTextures: dmbParse.textures,
        dmbModelFiles: dmbParse.models,
        strings: { ...prev.strings, buildings: buildingStrings, expandedBi },
      }));
      setEdbText(f.edb || "");
      setStatus(`Loaded: ${factions.length} factions, ${resources.length} resources, ${hiddenResources.length} hidden, ${regions.length} regions, ${edb.recruits.length} recruit lines, ${reforms.length} reforms, ${dmbModels.size} DMB models.`);

      // Async DMB asset audit — bulk-check every referenced texture +
      // model file, then walk data/characters to find orphan assets.
      // Both calls are bounded (cap on the file walk) and the results
      // land in modIndex when ready; the validator picks them up on its
      // next debounced tick. Failures are non-fatal (e.g. the user
      // hasn't pointed at a mod data dir yet).
      (async () => {
        try {
          const referenced = new Set();
          // Both the original (display) and lowercased path go in: original
          // for the missing-file lookup (where Windows' case-insensitive
          // fs.existsSync handles the OS comparison), lowercased for the
          // orphan diff (compared case-insensitively against on-disk
          // filenames so e.g. EBUnit_X.cas in DMB matches ebunit_x.cas on
          // disk and doesn't false-flag as orphan).
          const referencedLower = new Set();
          // Normalize away accidental leading slashes (some RIS lines
          // are written as `/data/models_missile/foo.cas` instead of
          // `data/...`). The on-disk walker emits `data/...` form, so
          // unnormalized refs would orphan-flag every such file.
          const norm = (p) => String(p || "").replace(/^[\\/]+/, "");
          const addRef = (p) => { if (!p) return; const n = norm(p); referenced.add(n); referencedLower.add(n.toLowerCase()); };
          for (const t of dmbParse.textures) addRef(t.path);
          for (const m of dmbParse.models) addRef(m.path);
          // DMB bare-model form (`model African data/characters/foo`
          // with no .cas / _lodN suffix — legacy RIS form used by e.g.
          // light_infantry_longshield). Game implicitly LOD-expands;
          // mirror that here so pontus/parni/slave _lodN.cas files
          // don't false-flag as orphan.
          for (const m of (dmbParse.bareModels || [])) {
            const base = norm(m.path).toLowerCase();
            if (!base) continue;
            for (let i = 0; i < 4; i++) referencedLower.add(`${base}_lod${i}.cas`);
          }
          // DMS (descr_model_strat). Two forms — bare paths (LOD-
          // expanded) and DMB-style model_flexi[_m] + texture lines
          // used by sm_*_general / sm_*_captain blocks (fully qualified
          // paths, no expansion needed). dmsParse is hoisted above so
          // its DMB-type linkage feeds into dmbExtraUsage.
          for (const p of dmsParse.modelPaths) {
            const base = norm(p).toLowerCase();
            for (let i = 0; i < 4; i++) referencedLower.add(`${base}_lod${i}.cas`);
          }
          for (const m of (dmsParse.flexiModels || [])) addRef(m.path);
          for (const t of (dmsParse.textures || [])) addRef(t.path);
          // Projectile model paths from descr_projectile_new — each
          // block has one or more `model data/models_missile/...cas`
          // lines, paths are fully-qualified including the .cas. Add
          // for both missing-check (mod or vanilla fallback) and
          // orphan diff.
          for (const m of projectileParse.modelPaths) addRef(m.path);
          // Engine model paths from descr_engines — collision /
          // outline / engine_model / engine_platforms / missile_model.
          // Same pattern as projectiles (mod-or-vanilla resolution +
          // orphan diff).
          for (const m of engineParse.modelPaths) addRef(m.path);
          // Implicit texture prefixes — for projectile + engine models,
          // textures are *not* declared in their text files; the game
          // looks for sibling .tga files in `<modelDir>/textures/` keyed
          // off the model's basename (foo.cas → foo_pbr.tga, foo_n.tga,
          // foo_s.tga, …). Build a prefix set so the orphan filter can
          // mark every matching .tga as implicitly referenced rather
          // than false-flagging the projectile/engine texture set.
          const implicitTexturePrefixes = new Set();
          const addImplicitFromModel = (path) => {
            const lower = norm(path).toLowerCase();
            const slash = lower.lastIndexOf("/");
            const dot = lower.lastIndexOf(".");
            if (slash < 0 || dot <= slash) return;
            const dir = lower.slice(0, slash);
            const stem = lower.slice(slash + 1, dot);
            if (!stem) return;
            implicitTexturePrefixes.add(`${dir}/textures/${stem}`);
          };
          for (const m of projectileParse.modelPaths) addImplicitFromModel(m.path);
          for (const m of engineParse.modelPaths) addImplicitFromModel(m.path);
          let dmbAssetMissing = new Set();
          let dmbAssetOrphans = [];
          if (window.eduAPI && window.eduAPI.checkModPaths && referenced.size > 0) {
            const r = await window.eduAPI.checkModPaths([...referenced]);
            if (r && Array.isArray(r.missing)) dmbAssetMissing = new Set(r.missing);
          }
          if (window.eduAPI && window.eduAPI.listModAssetFiles) {
            // Walk data/characters, data/animals, data/models_missile
            // and data/models_engine recursively (textures/ subfolders
            // are included by the recursive walker).
            const r = await window.eduAPI.listModAssetFiles(["characters", "animals", "models_missile", "models_engine"], [".tga", ".cas"]);
            if (r && Array.isArray(r.files)) {
              for (const f of r.files) {
                const lower = f.toLowerCase();
                if (referencedLower.has(lower)) continue;
                let implicit = false;
                for (const pfx of implicitTexturePrefixes) {
                  if (lower.startsWith(pfx)) { implicit = true; break; }
                }
                if (!implicit) dmbAssetOrphans.push(f);
              }
            }
          }
          setModIndex(prev => ({ ...prev, dmbAssetMissing, dmbAssetOrphans }));
        } catch (e) { console.warn("[dmb-audit] failed:", e && e.message); }
      })();
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
    // Stamp manualOrder = 0 so the new unit lands at the top of the
    // sidebar regardless of the existing category/grade sort. Without
    // this the new "new unit" sorted to the bottom (no grade → bucket
    // 99) and looked like the action did nothing.
    newUnit.manualOrder = 0;
    const renumbered = [newUnit, ...units].map((u, i) => ({ ...u, manualOrder: i }));
    persistUnits(renumbered);
    setSelectedId(id);
  };

  // Drag-and-drop reorder from UnitList. orderedIds is the new sequence
  // of unit ids the user wants to see — typically the visible-filtered
  // set in their dragged order. Units not in orderedIds keep their
  // existing relative order, appended at the end.
  const onReorder = useCallback((orderedIds) => {
    if (!Array.isArray(orderedIds) || orderedIds.length === 0) return;
    const idToUnit = new Map(units.map(u => [u.id, u]));
    const seen = new Set();
    const next = [];
    for (const id of orderedIds) {
      const u = idToUnit.get(id);
      if (u && !seen.has(id)) { next.push(u); seen.add(id); }
    }
    for (const u of units) if (!seen.has(u.id)) next.push(u);
    const renumbered = next.map((u, i) => ({ ...u, manualOrder: i }));
    persistUnits(renumbered);
  }, [units, persistUnits]);

  // Context menu "Insert blank above/below" — creates a new unit and
  // splices it next to the reference unit, then re-stamps manualOrder
  // on every unit so the visual ordering persists across reloads.
  const onInsertNear = useCallback((refId, position /* "above" | "below" */) => {
    const idx = units.findIndex(u => u.id === refId);
    if (idx < 0) return;
    const id = "unit_" + Date.now().toString(36);
    const newUnit = migrateV1({
      id, unit: "new unit", enabled: true, minTier: 1, factions: [], requires: [],
    });
    newUnit.writeBack = true;
    const insertAt = position === "above" ? idx : idx + 1;
    const next = [...units];
    next.splice(insertAt, 0, newUnit);
    const renumbered = next.map((u, i) => ({ ...u, manualOrder: i }));
    persistUnits(renumbered);
    setSelectedId(id);
  }, [units, persistUnits]);

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

  // Mark / unmark a unit for removal. The next Write to EDB strips
  // its existing recruit lines from the EDB AND skips emitting any
  // new ones — see generator.js applyUnitsToEDB for the writeBack /
  // pendingRemoval interaction. Once the write completes successfully,
  // the unit is auto-deleted from the project (handled in
  // previewWriteBack's success path).
  const onMarkForRemoval = useCallback((id, mark = true) => {
    persistUnits(units.map(u => u.id === id ? { ...u, pendingRemoval: !!mark } : u));
  }, [units, persistUnits]);

  // Sidebar view mode — split ref-only units off from the active editor
  // pool so the writable list isn't cluttered. Persisted across launches.
  const [sidebarMode, setSidebarMode] = useState(() => localStorage.getItem("rt:sidebarMode") || "edit");
  useEffect(() => { localStorage.setItem("rt:sidebarMode", sidebarMode); }, [sidebarMode]);

  // Variant-diff modal — when the user wants to see why N variants of
  // the same recruit name remain separate (i.e. what the merge tool
  // can't collapse), this surfaces a field-by-field comparison. Set
  // by sidebar right-click → "Compare variants" or the link in the
  // UnitEditor's variant tab strip.
  const [variantDiff, setVariantDiff] = useState(null);
  const showVariantDiff = useCallback((unitId) => {
    const u = units.find(x => x.id === unitId);
    if (!u) return;
    // Strip aor/merc prefix to match the sidebar's grouping. Picks up
    // sibling variants that live under a prefixed recruit name (e.g.
    // an AOR-only "aor X" sibling of factional "X").
    const stripPrefix = (s) => String(s || "").replace(/^(aor|merc)\s+/i, "");
    const baseKey = stripPrefix(u.unit);
    const siblings = units.filter(x => stripPrefix(x.unit) === baseKey);
    if (siblings.length < 2) {
      toast(`"${u.unit}" has only one variant — nothing to diff.`, "info");
      return;
    }
    setVariantDiff({ variants: siblings, recruitName: baseKey });
  }, [units]);

  // Merge variants of the same unit that share every recruit-line-
  // affecting field except their faction list. Per the user's rule:
  // unless a unit has DIFFERENT recruitment requirements per faction,
  // it should be one entry with a unioned faction list — splitting
  // identical variants is just noise. Returns a list of merge groups
  // ready to confirm + apply.
  const findMergeCandidates = useCallback((arr = units) => {
    // Fields that are identity / cosmetic / per-instance and should
    // NOT count as differences when comparing variants. `factions` and
    // `excludeFactions` are the explicit merge axis.
    const OMIT = new Set([
      "id", "unit", "factions", "excludeFactions",
      "notes", "manualOrder", "pendingRemoval",
    ]);
    const recruitSig = (u) => {
      const keys = Object.keys(u).filter((k) => !OMIT.has(k)).sort();
      const out = {};
      for (const k of keys) out[k] = u[k];
      return JSON.stringify(out);
    };
    const buckets = new Map();   // `${unit}|${sig}` → unit[]
    for (const u of arr) {
      if (!u || typeof u !== "object") continue;
      const key = String(u.unit || "") + "|" + recruitSig(u);
      const list = buckets.get(key);
      if (list) list.push(u); else buckets.set(key, [u]);
    }
    const groups = [];
    for (const list of buckets.values()) {
      if (list.length > 1) groups.push(list);
    }
    return groups;
  }, [units]);

  // Detect + collapse AI / AOR pairing. Two-pass:
  //   1. Project-side collapse — when two project variants share the
  //      same recruit name AND the same faction list but differ in
  //      canonicalMicTier (e.g. one Professional t2 and one Standard t1
  //      from the same import), the higher-tier is treated as the
  //      player variant; we set its u.ai.enabled with the lower tier
  //      AND DELETE the lower-tier variant. This is what actually
  //      collapses "Achaian Epilektoi × 4" down to "× 2" (one per
  //      faction list).
  //   2. EDB-side scan — for each surviving unit, look up its existing
  //      EDB recruit lines and tick u.aor.enabled (AOR-paired or
  //      AOR-only) when the EDB carries a `recruit "aor X"` clause.
  const detectAiAorPairing = useCallback(() => {
    if (!modIndex.recruits) { toast("Load the mod files first.", "error"); return; }
    const tierOf = (lvl) => {
      const m = String(lvl || "").match(/^mic_(\d)$/);
      return m ? parseInt(m[1], 10) : null;
    };

    // ── Pass 1: project-side AI collapse ─────────────────────────
    // Group variants by (recruit name + sorted factions list). Within
    // each group, if multiple entries have different canonicalMicTier
    // values, collapse: keeper = highest tier, set keeper.ai with the
    // lowest tier, drop the other entries.
    const groupKey = (u) => String(u.unit || "") + "|" + (u.factions || []).slice().sort().join(",");
    const groups = new Map();
    for (const u of units) (groups.get(groupKey(u)) || groups.set(groupKey(u), []).get(groupKey(u))).push(u);
    const drop = new Set();          // unit ids being deleted
    const updates = new Map();       // unit id → patched unit
    let collapsed = 0;
    let aiEnabled = 0;
    for (const list of groups.values()) {
      if (list.length < 2) continue;
      // Highest canonicalMicTier first; ties broken by writeBack (writable
      // beats ref-only as the keeper) so we don't promote a ref-only
      // entry over a writable one.
      const sorted = list.slice().sort((a, b) => {
        const ta = a.canonicalMicTier ?? 1, tb = b.canonicalMicTier ?? 1;
        if (ta !== tb) return tb - ta;
        const wa = a.writeBack === false ? 1 : 0, wb = b.writeBack === false ? 1 : 0;
        return wa - wb;
      });
      const keeper = sorted[0];
      const lowestTier = sorted[sorted.length - 1].canonicalMicTier ?? 1;
      if (lowestTier >= (keeper.canonicalMicTier ?? 1)) continue;     // no real tier spread
      updates.set(keeper.id, {
        ...keeper,
        ai: { enabled: true, canonicalMicTier: lowestTier },
      });
      aiEnabled++;
      for (let i = 1; i < sorted.length; i++) { drop.add(sorted[i].id); collapsed++; }
    }

    // ── Pass 2: EDB-side AOR detect on the surviving units ───────
    const linesByName = new Map();
    for (const r of modIndex.recruits) {
      const list = linesByName.get(r.unit) || [];
      list.push(r);
      linesByName.set(r.unit, list);
    }
    let aorPaired = 0, aorOnly = 0, aiFromEdb = 0, untouched = 0;
    const survivors = units.filter(u => !drop.has(u.id));
    for (const original of survivors) {
      const u = updates.get(original.id) || original;
      const factional = linesByName.get(u.unit) || [];
      const aor = linesByName.get("aor " + u.unit) || [];
      const hasFactional = factional.some(e => /\bis_player\b/.test(e.requires) && !/\bnot is_player\b/.test(e.requires));
      const hasAor = aor.length > 0;
      const aiLines = factional.filter(e => /\bnot is_player\b/.test(e.requires));
      const playerLines = factional.filter(e => /\bis_player\b/.test(e.requires) && !/\bnot is_player\b/.test(e.requires));
      let patched = u;
      // AOR pairing.
      if (hasAor && hasFactional) {
        if (!patched.aor || !patched.aor.enabled) {
          patched = { ...patched, aor: { enabled: true, govTier: (patched.aor && patched.aor.govTier) || 1, aorOnly: false, recruitName: "aor " + patched.unit } };
          aorPaired++;
        }
      } else if (hasAor && !hasFactional) {
        if (!patched.aor || !patched.aor.enabled || !patched.aor.aorOnly) {
          patched = { ...patched, aor: { enabled: true, govTier: (patched.aor && patched.aor.govTier) || 1, aorOnly: true, recruitName: "aor " + patched.unit } };
          aorOnly++;
        }
      }
      // AI sibling — only set if pass 1 didn't already (it's authoritative
      // when the project carries explicit lower-tier siblings).
      if ((!patched.ai || !patched.ai.enabled) && aiLines.length && playerLines.length) {
        const aiTiers = aiLines.map(e => tierOf(e.level)).filter(t => t != null);
        const playerTiers = playerLines.map(e => tierOf(e.level)).filter(t => t != null);
        if (aiTiers.length && playerTiers.length) {
          const aiMin = Math.min(...aiTiers);
          const playerMin = Math.min(...playerTiers);
          if (aiMin !== playerMin) {
            patched = { ...patched, ai: { enabled: true, canonicalMicTier: aiMin } };
            aiFromEdb++;
          }
        }
      }
      if (patched !== u) updates.set(original.id, patched);
      else if (!updates.has(original.id)) untouched++;
    }

    if (collapsed + aorPaired + aorOnly + aiEnabled + aiFromEdb === 0) {
      toast("Nothing to do — pairings already match the EDB and no collapsible AI variants found.", "info");
      return;
    }
    const summary =
      `${collapsed} variant${collapsed === 1 ? "" : "s"} collapsed into AI siblings, ` +
      `${aorPaired} AOR-paired + ${aorOnly} AOR-only ticked, ` +
      `${aiFromEdb} AI siblings ticked from EDB scan.`;
    if (collapsed > 0) {
      const ok = window.confirm(
        `Detected ${aiEnabled} unit${aiEnabled === 1 ? "" : "s"} that can collapse a lower-tier sibling into an AI variant — ${collapsed} entr${collapsed === 1 ? "y" : "ies"} will be deleted from the project (their data captured on the keeper's AI sibling toggle).\n\n` +
        `Recoverable via Ctrl+Z. Continue?`
      );
      if (!ok) return;
    }
    const next = [];
    for (const u of units) {
      if (drop.has(u.id)) continue;
      next.push(updates.get(u.id) || u);
    }
    if (selectedId && drop.has(selectedId)) setSelectedId(null);
    persistUnits(next);
    toast(summary, "success", 6500);
  }, [modIndex, units, persistUnits, selectedId]);

  const mergeIdenticalVariants = useCallback(() => {
    const groups = findMergeCandidates();
    if (!groups.length) {
      toast("No merge candidates — every variant already differs in something more than its faction list.", "info");
      return;
    }
    const totalIn = groups.reduce((n, g) => n + g.length, 0);
    const willCollapse = totalIn - groups.length;
    const ok = window.confirm(
      `Found ${groups.length} unit${groups.length === 1 ? "" : "s"} with ${totalIn} variants that share every recruit-line setting except their faction list.\n\n` +
      `Merge them? ${willCollapse} variant${willCollapse === 1 ? "" : "s"} will be collapsed into ${groups.length} (the faction lists are unioned, all other settings are kept).\n\n` +
      `This is recoverable via Ctrl+Z.`
    );
    if (!ok) return;
    // Build the new units array. For each merge group: keep the first
    // entry, union the factions, drop the others. Preserve original
    // order so the sidebar doesn't shuffle.
    const drop = new Set();
    const update = new Map();   // id → patched unit
    for (const list of groups) {
      const keeper = list[0];
      const factions = new Set(keeper.factions || []);
      const excludeFactions = new Set(keeper.excludeFactions || []);
      for (let i = 1; i < list.length; i++) {
        for (const f of (list[i].factions || [])) factions.add(f);
        for (const f of (list[i].excludeFactions || [])) excludeFactions.add(f);
        drop.add(list[i].id);
      }
      update.set(keeper.id, {
        ...keeper,
        factions: [...factions],
        excludeFactions: [...excludeFactions],
      });
    }
    const next = [];
    for (const u of units) {
      if (drop.has(u.id)) continue;
      next.push(update.get(u.id) || u);
    }
    persistUnits(next);
    toast(`Merged ${willCollapse} variant${willCollapse === 1 ? "" : "s"} into ${groups.length} unit${groups.length === 1 ? "" : "s"}. Faction lists unioned.`, "success");
  }, [findMergeCandidates, units, persistUnits]);

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

  // Parse modIndex.recruits into authored-unit records. Used by both the destructive
  // "Import from EDB" (replaces everything) and the additive "Import new from EDB" (only
  // the unit names that aren't already authored). Pure transform — no state writes.
  const parseRecruitsFromEDB = () => {
    if (!modIndex.recruits) return [];
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

        // Detect whether the existing EDB recruits this unit from a
        // garrison building. Original heuristic in generator.js was "tier
        // 1 ⇒ also emit garrison," but real mods (RIS) recruit tier-2+
        // units from garrison too, and re-emitting only MIC + AOR lines
        // dropped those entries on write-back. Recording the actual
        // building presence at import means we preserve whatever the
        // source EDB had instead of guessing from tier.
        const garrisonRecruit = variantEntries.some(e => e.building === "garrison");

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
          garrisonRecruit,
          notes: `Imported from EDB (${variantEntries.length} lines, ${unitType})${variantLabel}`,
        };
        const u = migrateV1(v1Unit);
        u.writeBack = false;
        imported.push(u);
      }
    }
    return imported;
  };

  const importFromEDB = async () => {
    if (!modIndex.recruits) { alert("Load mod files first."); return; }
    const imported = parseRecruitsFromEDB();
    if (!window.confirm(`Import ${imported.length} units from EDB?\nThis replaces your current units.json.`)) return;
    history.reset(imported);
    if (api) await api.writeUnits({ units: imported });
    setStatus(`Imported ${imported.length} units from EDB.`);
  };

  // Non-destructive companion to importFromEDB. Scans the live EDB and adds authored
  // entries only for unit names that have no existing authored entry yet — leaves
  // every hand-tuned entry untouched. Use case: the EDB has been edited externally
  // (or by a different Manipula session) and the project's authored snapshot drifted
  // out of date. Match key is `u.unit` — if any variant of a name is already authored,
  // none of its variants are re-imported (avoids stomping merge/split decisions).
  const importNewFromEDB = async () => {
    if (!modIndex.recruits) { alert("Load mod files first."); return; }
    const all = parseRecruitsFromEDB();
    const existing = new Set(units.map(u => u.unit));
    const newOnly = all.filter(u => !existing.has(u.unit));
    if (newOnly.length === 0) {
      setStatus("Nothing new — every EDB recruit unit name already has an authored entry.");
      return;
    }
    const sample = newOnly.slice(0, 8).map(u => `  • ${u.unit}`).join("\n");
    const more = newOnly.length > 8 ? `\n  …and ${newOnly.length - 8} more` : "";
    if (!window.confirm(
      `Found ${newOnly.length} unit name${newOnly.length === 1 ? "" : "s"} in the EDB with no authored entry yet:\n\n${sample}${more}\n\n` +
      `Add them to your project? Existing authored entries will not be touched.`
    )) return;
    persistUnits([...newOnly, ...units]);
    setStatus(`Added ${newOnly.length} new authored entries from EDB.`);
  };

  // Auto-reconcile project entries against the live EDB on load. The EDB
  // is the in-game source of truth, so reference-only project entries
  // (writeBack: false) are always re-derived from the current EDB. This
  // catches both:
  //   • new recruit lines added since the last load (creates entries)
  //   • factions / tier / requires changed since the last load (refreshes
  //     the stale entry to match what's actually in the EDB now)
  // and silently dedupes stale duplicate variants that arose from earlier
  // parser revisions (a unit that appears N times in `units` because old
  // imports split it into N variants gets collapsed into the count of
  // variants the current EDB actually has).
  //
  // writeBack: true entries are sacrosanct — those are units the user is
  // actively authoring through Manipula's editor, and Write to EDB will
  // regenerate the EDB lines from them. Refreshing them from EDB would
  // overwrite the user's in-progress edits. Leave them alone.
  //
  // Fires every time modIndex.recruits changes (initial mod load + manual
  // Reload), so any EDB edit made outside Manipula gets reflected on the
  // next refresh.
  const autoImportFiredRef = React.useRef(false);
  useEffect(() => {
    const recruits = modIndex && modIndex.recruits;
    if (!recruits || recruits.length === 0) return;
    // Wait one extra tick on the very first run so a project load
    // happening in parallel can settle its `units` first; otherwise the
    // race would have us refresh everything against an empty `units` and
    // immediately get overwritten by the project's saved entries.
    if (!autoImportFiredRef.current && projectDir && units.length === 0) return;
    autoImportFiredRef.current = true;
    const fresh = parseRecruitsFromEDB();
    // Keep every writeBack: true entry verbatim (active authoring).
    const writable = units.filter(u => u.writeBack);
    const writableNames = new Set(writable.map(u => u.unit));
    // Refresh ref-only entries from the EDB. parseRecruitsFromEDB returns
    // entries already with writeBack: false, so this is a clean swap.
    let refreshed = fresh.filter(u => !writableNames.has(u.unit));
    // Enrich qualityClass from the EDU project's "Quality" column when
    // we have an eduProject loaded. parseRecruitsFromEDB only sees recruit
    // lines, which carry no quality info — without this lookup every
    // refreshed entry comes back with qualityClass=null and the editor
    // shows "— none —" even when EDUMatic has a perfectly good value.
    const eduByUnitId = (eduProject && Array.isArray(eduProject.units))
      ? new Map(eduProject.units
          .filter(eu => eu && (eu["unit id"] || eu.name))
          .map(eu => [String(eu["unit id"] || eu.name).trim(), eu]))
      : null;
    if (eduByUnitId) {
      refreshed = refreshed.map(u => {
        // Match factional name and AOR-prefixed siblings to the same EDU row
        // (the EDU only has one entry per unit; AOR siblings share it).
        const lookupName = String(u.unit || "").replace(/^aor\s+/i, "").trim();
        const eu = eduByUnitId.get(lookupName);
        if (!eu) return u;
        const q = eu.Quality || eu.quality;
        if (!q) return u;
        // Normalise to the canonical id from QUALITY_CLASSES so the editor's
        // <select> can match it case-sensitively. EDU uses TitleCase
        // ("5a. Infantry") but QUALITY_CLASSES are all lowercase
        // ("5a. infantry") — without this normalisation the dropdown shows
        // "— none —" even though findQualityClass (case-insensitive) finds it.
        const canonical = findQualityClass(q);
        const value = canonical ? canonical.id : q;
        // When the QC resolves to a known entry, propagate its tier hint
        // through the recruitment dials so the project mirrors the RIS
        // tier guide instead of whatever stale mic_tier_X value the EDB
        // happens to carry. Without this Triarii (Early) → 5d. Veteran
        // Infantry stayed at canonicalMicTier:2 because the EDB's
        // mic_tier_2 line is what parseRecruitsFromEDB inferred. Tier
        // hints drive: canonical/homeland mic_tier (mirror), emitGovB
        // (only tier 1), colony tier (1 if tier 1 else 2). Same shape
        // as the editor's QC-onChange handler.
        if (canonical) {
          const t = canonical.tierHint;
          const canonMic = Math.min(t, 3);     // RIS caps mic_tier at 3 (mic_4 is buff-only, no recruits)
          const homeland = t <= 2 ? 1 : 2;     // GovD: tier 1-2 → 1, tier 3+ → 2
          const govBOn = t === 1;
          const colony = t === 1 ? 1 : 2;
          if (
            u.qualityClass === value &&
            u.canonicalMicTier === canonMic &&
            u.homelandMicTier === homeland &&
            u.emitGovB === govBOn &&
            u.colonyTier === colony
          ) return u;
          return {
            ...u,
            qualityClass: value,
            canonicalMicTier: canonMic,
            homelandMicTier: homeland,
            emitGovB: govBOn,
            colonyTier: colony,
          };
        }
        if (u.qualityClass === value) return u;
        return { ...u, qualityClass: value };
      });
    }
    const beforeMerge = [...writable, ...refreshed];
    // Post-process: pair AOR siblings + flag AI siblings automatically.
    // The standalone "aor X" entries that parseRecruitsFromEDB emits get
    // collapsed into the factional X's aor.enabled toggle (the EDB
    // already paired them — no reason for the UI to show two separate
    // cards). Likewise every unit with not-is_player recruit lines in
    // the EDB gets ai.enabled=true so the AI Sibling section reflects
    // reality. Both passes only modify writeBack=false entries — active
    // authoring is sacrosanct.
    const linesByName = new Map();
    for (const r of recruits) {
      const list = linesByName.get(r.unit) || [];
      list.push(r);
      linesByName.set(r.unit, list);
    }
    const tierOfLevel = (lvl) => {
      const m = String(lvl || "").match(/^mic_(\d)$/);
      return m ? parseInt(m[1], 10) : null;
    };
    const indexedByUnit = new Map(beforeMerge.map(u => [u.unit, u]));
    const dropIds = new Set();
    const paired = beforeMerge.map(u => {
      if (u.writeBack) return u;
      const factional = linesByName.get(u.unit) || [];
      const aorLines = linesByName.get("aor " + u.unit) || [];
      const aiLines = factional.filter(e => /\bnot is_player\b/.test(e.requires));
      const playerLines = factional.filter(e => /\bis_player\b/.test(e.requires) && !/\bnot is_player\b/.test(e.requires));
      let patched = u;
      // AOR pairing: factional + AOR sibling → set aor.enabled on the
      // factional entry, copy the standalone "aor X" entry's AOR-specific
      // requires (e.g. hidden_resource picentine) into aorRequires so the
      // generator knows what gates the AOR variant, then drop the
      // standalone ref-only aor entry.
      if (aorLines.length > 0 && playerLines.length > 0) {
        const aorEntry = indexedByUnit.get("aor " + u.unit);
        if (!patched.aor || !patched.aor.enabled || patched.aor.aorOnly) {
          patched = { ...patched, aor: { enabled: true, govTier: (patched.aor && patched.aor.govTier) || 1, aorOnly: false, recruitName: "aor " + patched.unit } };
        }
        // Always re-derive aorRequires from the standalone aor entry so a
        // subsequent EDB change to the AOR sibling propagates here too.
        // The standalone's commonRequires holds clauses that the EDB has
        // ON the aor lines but NOT on the factional lines (the AOR's
        // hidden_resource gate, etc.) — those belong on the factional's
        // aorRequires under the new merged shape.
        if (aorEntry && Array.isArray(aorEntry.commonRequires)) {
          patched = { ...patched, aorRequires: aorEntry.commonRequires };
        }
        if (aorEntry && !aorEntry.writeBack) dropIds.add(aorEntry.id);
      }
      // AI sibling: any not-is_player lines in the EDB → ai.enabled.
      // AI canonical mic_tier capped at 3 — mic_4 is buff-only in RIS,
      // so any EDB line that says mic_tier_4 gets pinned to 3 here.
      if (aiLines.length > 0 && (!patched.ai || !patched.ai.enabled)) {
        const aiTiers = aiLines.map(e => tierOfLevel(e.level)).filter(t => t != null);
        const aiMin = aiTiers.length ? Math.min(...aiTiers) : (patched.canonicalMicTier ?? 1);
        patched = { ...patched, ai: { enabled: true, canonicalMicTier: Math.min(aiMin, 3) } };
      }
      return patched;
    });
    let next = paired.filter(u => !dropIds.has(u.id));
    // Auto-merge identical ref-only variants. Two variants of the same
    // unit name that share every recruit-line setting except their
    // factions list get unioned (faction lists merged) and the
    // duplicates dropped. Mirrors the old manual "Merge identical
    // variants" button — now silent because the user shouldn't have to
    // click anything for the project to land in a clean canonical shape.
    const OMIT = new Set([
      "id", "unit", "factions", "excludeFactions",
      "notes", "manualOrder", "pendingRemoval", "writeBackUserSet",
    ]);
    const recruitSig = (u) => {
      const keys = Object.keys(u).filter(k => !OMIT.has(k)).sort();
      const out = {};
      for (const k of keys) out[k] = u[k];
      return JSON.stringify(out);
    };
    const mergeBuckets = new Map();
    for (const u of next) {
      if (u.writeBack) continue;                 // writable entries are sacrosanct
      const key = String(u.unit || "") + "|" + recruitSig(u);
      const list = mergeBuckets.get(key);
      if (list) list.push(u); else mergeBuckets.set(key, [u]);
    }
    const mergeDrop = new Set();
    const mergeUpdate = new Map();
    for (const list of mergeBuckets.values()) {
      if (list.length < 2) continue;
      const keeper = list[0];
      const factions = new Set(keeper.factions || []);
      const excludeFactions = new Set(keeper.excludeFactions || []);
      for (let i = 1; i < list.length; i++) {
        for (const f of (list[i].factions || [])) factions.add(f);
        for (const f of (list[i].excludeFactions || [])) excludeFactions.add(f);
        mergeDrop.add(list[i].id);
      }
      mergeUpdate.set(keeper.id, { ...keeper, factions: [...factions], excludeFactions: [...excludeFactions] });
    }
    if (mergeDrop.size > 0) {
      next = next.filter(u => !mergeDrop.has(u.id))
                 .map(u => mergeUpdate.get(u.id) || u);
    }
    // Auto-collapse same-(unit, factions) variants that differ only in
    // canonicalMicTier into one entry with ai.enabled at the lowest tier.
    // Mirrors pass 1 of the old "Detect AI / AOR pairing" button. Only
    // runs over ref-only entries to keep writable authoring intact.
    const tierGroups = new Map();
    for (const u of next) {
      if (u.writeBack) continue;
      const k = String(u.unit || "") + "|" + (u.factions || []).slice().sort().join(",");
      (tierGroups.get(k) || tierGroups.set(k, []).get(k)).push(u);
    }
    const tierDrop = new Set();
    const tierUpdate = new Map();
    for (const list of tierGroups.values()) {
      if (list.length < 2) continue;
      const sorted = list.slice().sort((a, b) => (b.canonicalMicTier ?? 1) - (a.canonicalMicTier ?? 1));
      const keeper = sorted[0];
      const lowest = sorted[sorted.length - 1].canonicalMicTier ?? 1;
      const top = keeper.canonicalMicTier ?? 1;
      if (lowest >= top) continue;
      tierUpdate.set(keeper.id, { ...keeper, ai: { enabled: true, canonicalMicTier: Math.min(lowest, 3) } });
      for (let i = 1; i < sorted.length; i++) tierDrop.add(sorted[i].id);
    }
    if (tierDrop.size > 0) {
      next = next.filter(u => !tierDrop.has(u.id))
                 .map(u => tierUpdate.get(u.id) || u);
    }
    // Idempotency check — only fire setUnits when something actually
    // differs, so a clean reload doesn't mark the project dirty for no
    // reason. Compare a normalized signature: unit name + a few key
    // fields. If those are stable, treat as unchanged.
    const sig = (arr) => arr
      .map(u => `${u.unit}|${(u.factions || []).join(",")}|${(u.excludeFactions || []).join(",")}|${u.canonicalMicTier ?? ""}|${u.writeBack ? 1 : 0}|aor:${u.aor && u.aor.enabled ? (u.aor.aorOnly ? "only" : "pair") : "0"}|ai:${u.ai && u.ai.enabled ? (u.ai.canonicalMicTier ?? "") : "0"}`)
      .sort()
      .join("\n");
    if (sig(next) === sig(units)) return;
    const created = refreshed.filter(r => !units.some(u => u.unit === r.unit));
    const updated = refreshed.length - created.length;
    const collapsed = dropIds.size;
    // Don't flip the project-dirty flag for auto-reconcile updates —
    // they're idempotent re-derivations from the live EDB, not user
    // edits. The next load reproduces the same shape, so losing them
    // is harmless and the user shouldn't be prompted to save.
    silentUnitChangeRef.current++;
    persistUnits(next);
    const parts = [];
    if (created.length) parts.push(`${created.length} new`);
    if (updated) parts.push(`${updated} refreshed`);
    if (collapsed) parts.push(`${collapsed} AOR siblings paired`);
    setStatus(`Reconciled with EDB — ${parts.join(", ") || "nothing changed"} (writable entries preserved).`);
    // eslint-disable-next-line
  }, [modIndex?.recruits]);

  const [diff, setDiff] = useState(null); // { added, removed, kept } | null
  // Conflict resolver state — populated when previewWriteBack detects
  // that the on-disk EDB has changed since Manipula's last export.
  // Keeps the freshly-read EDB text on hand so the resolver's actions
  // (Show diff / Overwrite anyway) don't have to re-read it. null
  // when no conflict is active.
  const [edbConflict, setEdbConflict] = useState(null);
  // Per-variant preview modal for the sidebar's "Remove faction from
  // project" action. null when closed; { faction, entries[], selected:Set }
  // when open. Each entry carries the proposed action (strip /
  // convert-to-aor / delete) plus the before/after factions so the user
  // can opt-out per row before applying. See the sidebar
  // onRemoveFactionFromAll handler for entry construction and
  // applyFactionStrip below for the apply step.
  const [factionStripModal, setFactionStripModal] = useState(null);
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
  // EDB-on-disk drift detection. After every successful Write to EDB, we
  // record a hash of the file we just wrote. On load (and on every mod
  // reload), we hash the live EDB and compare. A mismatch means the EDB
  // has been touched outside Manipula since the last write — either
  // hand-edited or a teammate wrote it via a different Manipula clone
  // without committing the project's manipula.project.json. Banner shown
  // until the user dismisses it for the session OR runs Write to EDB
  // (which updates the recorded hash). null = "can't tell yet" (no
  // hashAtExport on file, e.g. brand-new project) — no banner.
  const [edbDrift, setEdbDrift] = useState(null);
  const [edbDriftDismissed, setEdbDriftDismissed] = useState(false);
  useEffect(() => {
    if (!edbText || !projectExports?.edb?.hashAtExport) { setEdbDrift(null); return; }
    let cancelled = false;
    (async () => {
      try {
        const { hashOfText } = await import("./projectStore");
        const liveHash = hashOfText(edbText);
        if (!cancelled) setEdbDrift(liveHash !== projectExports.edb.hashAtExport);
      } catch { /* projectStore unavailable — leave drift null */ }
    })();
    return () => { cancelled = true; };
  }, [edbText, projectExports]);
  // Reset the dismissal whenever the EDB content itself changes — a fresh
  // Reload should re-prompt if the file is still drifted.
  useEffect(() => { setEdbDriftDismissed(false); }, [edbText]);
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
  // Expose to window so callbacks deep in the tree (and the merc /
  // export-units IPC handlers) can surface failure as a sticky toast
  // without prop-drilling.
  useEffect(() => {
    if (typeof window !== "undefined") window.toast = toast;
  }, [toast]);

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
        // The history.reset triggers the units→dirty effect; flag it as
        // a silent change so the user isn't prompted to save right after
        // opening a project they haven't even touched yet.
        silentUnitChangeRef.current++;
        history.reset(loadedUnits.map(migrateV1));
        if (api) await api.writeUnits({ units: loadedUnits });
      }
      setEduProjectSource(dir);
      setProjectDir(dir);
      setProjectExports(loadedExports || {});
      setEduDirty(false);
      setProjectDirty(false);
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
      // Drive the "is the user typing?" gate off the focused element
      // rather than the keystroke target — e.target can be the body
      // after focus drifts, which previously caused Ctrl+F to override
      // text input it should have left alone (and vice versa).
      const ae = document.activeElement;
      const aeTag = (ae && ae.tagName) || "";
      const isText =
        aeTag === "INPUT" || aeTag === "TEXTAREA" || aeTag === "SELECT" ||
        (ae && ae.isContentEditable);
      const k = e.key.toLowerCase();
      // Ctrl+S / Ctrl+F always fire, even when typing — that's the
      // standard browser convention. Ctrl+E and Ctrl+D respect the
      // text-input gate so they don't interrupt an edit.
      if (k === "s") { e.preventDefault(); document.querySelector("[data-rtshortcut='save-project']")?.click() || document.querySelector("[data-rtshortcut='write-edb']")?.click(); }
      else if (k === "f") { e.preventDefault(); document.querySelector("[data-rtshortcut='quick-search']")?.focus(); }
      else if (k === "e" && !isText) { e.preventDefault(); document.querySelector("[data-rtshortcut='export-bundle']")?.click(); }
      else if (k === "1") { e.preventDefault(); setActiveTab("editor"); }
      else if (k === "2") { e.preventDefault(); setActiveTab("validation"); }
      else if (k === "3") { e.preventDefault(); setActiveTab("exportAll"); }
      else if (k === "4") { e.preventDefault(); setActiveTab("edu"); }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  // ? opens the keyboard cheatsheet. Skipped when typing so it doesn't
  // intercept literal "?" in unit notes / search input.
  const [shortcutOpen, setShortcutOpen] = useState(false);
  useEffect(() => {
    const onKey = (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const ae = document.activeElement;
      const aeTag = (ae && ae.tagName) || "";
      const isText = aeTag === "INPUT" || aeTag === "TEXTAREA" || aeTag === "SELECT" || (ae && ae.isContentEditable);
      if (e.key === "?" && !isText) { e.preventDefault(); setShortcutOpen((o) => !o); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Project-dirty tracking for the topbar pill + the beforeunload guard.
  // Bumped on every mutating operation; cleared by Save project / Open
  // project. See projectDirtyRef for the live value the unload listener
  // reads (state would lag behind by one render).
  const [projectDirty, setProjectDirty] = useState(false);
  const projectDirtyRef = useRef(false);
  useEffect(() => { projectDirtyRef.current = projectDirty; }, [projectDirty]);
  // Two guards on the units→dirty link so the user isn't prompted to
  // save when they didn't actually edit anything:
  //   • didMountRef skips the initial mount (React's useEffect fires
  //     once on mount with the dep value, even when nothing changed).
  //   • silentUnitChangeRef is bumped by callers that mutate `units`
  //     for non-user reasons (auto-reconcile, project load) so the
  //     next dirty flip is suppressed. Decremented in the effect so
  //     stacked silent updates are all absorbed in order.
  const didMountUnitsRef = useRef(false);
  const silentUnitChangeRef = useRef(0);
  useEffect(() => {
    if (!didMountUnitsRef.current) { didMountUnitsRef.current = true; return; }
    if (silentUnitChangeRef.current > 0) { silentUnitChangeRef.current--; return; }
    setProjectDirty(true);
  }, [units]);
  useEffect(() => { if (eduDirty) setProjectDirty(true); }, [eduDirty]);

  useEffect(() => {
    const onBeforeUnload = (e) => {
      if (!projectDirtyRef.current) return;
      e.preventDefault();
      e.returnValue = "You have unsaved changes — close anyway?";
      return e.returnValue;
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, []);

  // Keep the main process aware of unsaved-changes state so its
  // window-close and updater-install handlers can show a Save /
  // Discard / Cancel dialog instead of letting Electron close
  // silently. Updates whenever projectDirty changes.
  useEffect(() => {
    if (window.electronAPI?.setRendererDirty) window.electronAPI.setRendererDirty(projectDirty);
    if (window.eduAPI?.setRendererDirty) window.eduAPI.setRendererDirty(projectDirty);
  }, [projectDirty]);

  // Save-then-exit / save-then-update handlers. The Save button is
  // already wired to a click handler with the right behaviour, so
  // for "trigger save flow" we just click it and wait for the dirty
  // flag to clear before proceeding to exit / install. If the user
  // cancels the save dialog (e.g. they cancel the folder picker),
  // they end up back in the app with their data intact.
  useEffect(() => {
    if (!window.electronAPI) return;
    const off1 = window.electronAPI.onSaveThenExit && window.electronAPI.onSaveThenExit(async () => {
      const btn = document.querySelector("[data-rtshortcut='save-project']");
      if (!btn) { window.electronAPI.exitNow(); return; }
      btn.click();
      // Poll for the dirty flag to clear (save flow is async). Cap
      // at 30s — beyond that something's gone wrong with the save
      // dialog and we leave the user in the app.
      const start = Date.now();
      const tick = () => {
        if (!projectDirtyRef.current) { window.electronAPI.exitNow(); return; }
        if (Date.now() - start > 30000) return;
        setTimeout(tick, 200);
      };
      setTimeout(tick, 200);
    });
    const off2 = window.electronAPI.onSaveThenUpdate && window.electronAPI.onSaveThenUpdate(async () => {
      const btn = document.querySelector("[data-rtshortcut='save-project']");
      if (!btn) { window.electronAPI.updaterQuitAndInstallNow(); return; }
      btn.click();
      const start = Date.now();
      const tick = () => {
        if (!projectDirtyRef.current) { window.electronAPI.updaterQuitAndInstallNow(); return; }
        if (Date.now() - start > 30000) return;
        setTimeout(tick, 200);
      };
      setTimeout(tick, 200);
    });
    return () => { off1 && off1(); off2 && off2(); };
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
    // Validate-on-write gate. When the user has flipped
    // modInfo.blockWriteOnError on, an error count > 0 (from the EDU
    // validation) blocks Write to EDB until they fix or override.
    const blockOnErr = !!(eduProject && eduProject.modInfo && eduProject.modInfo.blockWriteOnError);
    if (blockOnErr && eduValidationErrors && eduValidationErrors.length > 0) {
      const ok = window.confirm(
        `Validation has ${eduValidationErrors.length} error${eduValidationErrors.length === 1 ? "" : "s"} and "Block writes on errors" is on.\n\n` +
        `Continue anyway? (Recommended: Cancel, fix the errors in the Validate tab, then write back.)`
      );
      if (!ok) { setActiveTab("edu"); setEduView("validate"); return; }
    }
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
      // Auto-prune units that were marked for removal — their lines are
      // now scrubbed from the EDB, so the project no longer needs to
      // carry them. Hands the user a clean slate.
      const pending = units.filter(u => u.pendingRemoval);
      if (pending.length) {
        const remaining = units.filter(u => !u.pendingRemoval);
        if (selectedId && pending.some(u => u.id === selectedId)) setSelectedId(null);
        persistUnits(remaining);
        toast(`Removed ${pending.length} unit${pending.length === 1 ? "" : "s"} from the project (EDB lines stripped on this write).`, "success");
      }
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
        const errs = validate(eduProject, {
          dmbModels: modIndex.dmbModels,
          dmbExtraUsage: modIndex.dmbExtraUsage,
          dmbNewTypes: modIndex.dmbNewTypes,
          mountTypesLower: modIndex.mountTypesLower,
          mountModelByType: modIndex.mountModelByType,
          projectileTypes: modIndex.projectileTypes,
          projectileModelPaths: modIndex.projectileModelPaths,
          dmbTextures: modIndex.dmbTextures,
          dmbModelFiles: modIndex.dmbModelFiles,
          dmbAssetMissing: modIndex.dmbAssetMissing,
          dmbAssetOrphans: modIndex.dmbAssetOrphans,
          unitStringTags: modIndex.strings && modIndex.strings.units ? new Set(Object.keys(modIndex.strings.units)) : null,
        });
        if (!cancelled) setEduValidationErrors(Array.isArray(errs) ? errs : []);
      } catch (e) { if (!cancelled) setEduValidationErrors([]); }
    }, 800);
    return () => { cancelled = true; clearTimeout(id); };
  }, [eduProject, modIndex.dmbModels, modIndex.dmbExtraUsage, modIndex.dmbNewTypes, modIndex.mountTypesLower, modIndex.mountModelByType, modIndex.projectileTypes, modIndex.projectileModelPaths, modIndex.dmbTextures, modIndex.dmbModelFiles, modIndex.dmbAssetMissing, modIndex.dmbAssetOrphans, modIndex.strings]);

  const validationSummary = useMemo(() => {
    // The summary runs on every render — keep it lightweight by skipping the O(n²) cross-unit
    // conflict pass. The full validation view (which only mounts when the user opens the tab)
    // runs the full set including conflicts. EDU-validator errors (which include DMB cross-file
    // checks: dmb-orphan-asset, dmb-orphan-type, unit-dmb-missing, etc.) are folded in via
    // eduValidationErrors so the topbar tab badge matches the count the Validate panel shows.
    const sum = summarize(validateUnits(units, modIndex, { missingCards, skipCrossUnit: true }));
    const factionIssues = validateFactions(units, modIndex);
    // EDU validator results carry per-issue severity (default "error").
    // Recent-orphan-type entries downgrade to "warn" so the badge
    // counts them under warnings rather than blockers.
    let eduErrCount = 0, eduWarnCount = 0;
    for (const e of (eduValidationErrors || [])) {
      const sev = e.severity || "error";
      if (sev === "warn") eduWarnCount++;
      else eduErrCount++;
    }
    return {
      ...sum,
      error: sum.error + eduErrCount,
      warn: sum.warn + eduWarnCount,
      total: sum.total + eduErrCount + eduWarnCount,
      factionIssues: factionIssues.length,
    };
  }, [units, modIndex, missingCards, eduValidationErrors]);

  return (
    <AppErrorBoundary>
    <LightboxProvider>
    <ShortcutOverlay open={shortcutOpen} onClose={() => setShortcutOpen(false)} />
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
        projectDirty={projectDirty}
        onShowShortcuts={() => setShortcutOpen(true)}
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
            setProjectDirty(false);
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
        onImportNewFromEDB={importNewFromEDB}
        onImportEdumatic={importFromEdumatic}
        onResetImportsToReferenceOnly={resetImportsToReferenceOnly}
        onMarkOrphanUnits={(ids) => {
          if (!ids || !ids.length) return;
          if (!window.confirm(
            `Mark ${ids.length} orphan unit${ids.length === 1 ? "" : "s"} for removal?\n\n` +
            `These units have no positive factions left — they won't recruit anywhere as-is.\n` +
            `Marking sets pendingRemoval=true; the next Write to EDB strips their recruit lines and the project entry deletes itself afterwards.\n\n` +
            `Recoverable via Ctrl+Z.`
          )) return;
          const idSet = new Set(ids);
          const next = units.map(u => idSet.has(u.id) ? { ...u, pendingRemoval: true } : u);
          persistUnits(next);
          toast(`Marked ${ids.length} orphan unit${ids.length === 1 ? "" : "s"} for removal.`, "success");
        }}
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
      {edbDrift && !edbDriftDismissed && (
        <div style={{ background: "rgba(184,115,51,0.15)", borderBottom: "1px solid rgba(220,166,74,0.4)", padding: "8px 14px", display: "flex", alignItems: "center", gap: 12, color: "#dca64a", fontSize: 12 }}>
          <span style={{ fontSize: 16, lineHeight: 1 }}>⚠</span>
          <div style={{ flex: 1, color: "#ddd" }}>
            <strong style={{ color: "#dca64a" }}>EDB on disk has been edited outside Manipula since the last Write to EDB.</strong>
            <span style={{ marginLeft: 8, color: "#bbb" }}>
              Hand edits to <code style={{ background: "rgba(0,0,0,0.3)", padding: "1px 4px", borderRadius: 3 }}>export_descr_buildings.txt</code> won't round-trip — Write to EDB regenerates from the project, so any manual changes to recruit lines will be lost. Verify before writing.
            </span>
          </div>
          <button
            onClick={async () => {
              // openPath lives on window.eduAPI, not window.electronAPI —
              // the original wiring used `api` (electronAPI) which silently
              // no-op'd because openPath was undefined there.
              const opener = (window.eduAPI && window.eduAPI.openPath) || (api && api.openPath);
              if (opener && dataDir) await opener(`${dataDir}\\export_descr_buildings.txt`);
            }}
            style={{ background: "rgba(220,166,74,0.15)", color: "#dca64a", border: "1px solid rgba(220,166,74,0.4)", padding: "4px 10px", borderRadius: 4, fontSize: 11, cursor: "pointer" }}
            title="Open the EDB file in your default text editor to inspect the changes"
          >Open EDB</button>
          <button
            onClick={() => setEdbDriftDismissed(true)}
            style={{ background: "transparent", color: "#999", border: "1px solid #444", padding: "4px 10px", borderRadius: 4, fontSize: 11, cursor: "pointer" }}
            title="Hide the warning for this session — re-appears on next Reload"
          >Dismiss</button>
        </div>
      )}
      {diff && (
        <DiffModal diff={diff} onCancel={() => setDiff(null)} onConfirm={confirmWriteBack} />
      )}
      {variantDiff && (
        <VariantDiffModal variantDiff={variantDiff} onClose={() => setVariantDiff(null)} />
      )}
      {factionStripModal && (
        <FactionStripModal
          state={factionStripModal}
          onToggle={(id) => {
            const next = new Set(factionStripModal.selected);
            if (next.has(id)) next.delete(id); else next.add(id);
            setFactionStripModal({ ...factionStripModal, selected: next });
          }}
          onSelectAll={(filterFn) => {
            const next = new Set(factionStripModal.selected);
            for (const e of factionStripModal.entries) if (filterFn(e)) next.add(e.id);
            setFactionStripModal({ ...factionStripModal, selected: next });
          }}
          onDeselectAll={(filterFn) => {
            const next = new Set(factionStripModal.selected);
            for (const e of factionStripModal.entries) if (filterFn(e)) next.delete(e.id);
            setFactionStripModal({ ...factionStripModal, selected: next });
          }}
          onCancel={() => setFactionStripModal(null)}
          onApply={async (alsoStripEdb) => {
            const { faction, entries, selected } = factionStripModal;
            const byId = new Map(entries.filter(e => selected.has(e.id)).map(e => [e.id, e]));
            let stripped = 0, converted = 0, deleted = 0;
            const next = [];
            for (const u of units) {
              const e = byId.get(u.id);
              if (!e) { next.push(u); continue; }
              if (e.action === "delete") {
                deleted++;
                continue;   // drop
              }
              if (e.action === "convert-to-aor") {
                const aorName = (u.aor && u.aor.recruitName) || ("aor " + u.unit);
                next.push({
                  ...u,
                  unit: aorName,
                  factions: ["all"],
                  excludeFactions: (u.excludeFactions || []).filter(f => f !== faction),
                  aor: { ...(u.aor || {}), enabled: true, aorOnly: true, recruitName: aorName },
                });
                converted++;
                continue;
              }
              // strip
              next.push({
                ...u,
                factions: e.facsAfter,
                excludeFactions: (u.excludeFactions || []).filter(f => f !== faction),
              });
              stripped++;
            }
            persistUnits(next);
            const projectParts = [];
            if (stripped) projectParts.push(`${stripped} stripped`);
            if (converted) projectParts.push(`${converted} converted to AOR-only`);
            if (deleted) projectParts.push(`${deleted} deleted`);
            const projectMsg = projectParts.join(", ") || "nothing changed";

            // Optional EDB-side surgical strip — same faction, walks the
            // live EDB recruit lines. Backs up before writing. Reloads
            // mod files after so the project picks up the new EDB state.
            // Critically: also re-records projectExports.edb.hashAtExport
            // off the freshly-written file so the drift banner stops
            // firing on what is, from the user's perspective, a
            // deliberate Manipula write.
            let edbMsg = "";
            if (alsoStripEdb && window.eduAPI && window.eduAPI.edbStripFaction) {
              try {
                const r = await window.eduAPI.edbStripFaction(faction, false);
                if (r && r.ok) {
                  edbMsg = ` · EDB: ${r.removed} removed, ${r.modified} rewritten`;
                  await loadMod();
                  // Re-fetch the EDB and update the recorded export hash
                  // so the drift detector treats this as an authorized
                  // write (same shape as confirmWriteBack does after
                  // Write to EDB).
                  try {
                    if (api && api.readEDB) {
                      const fresh = await api.readEDB();
                      if (typeof fresh === "string") {
                        const { hashOfText } = await import("./projectStore");
                        setProjectExports(e => ({ ...e, edb: { hashAtExport: hashOfText(fresh), exportedAt: new Date().toISOString(), path: e?.edb?.path || `${dataDir}\\export_descr_buildings.txt` } }));
                      }
                    }
                  } catch {}
                } else {
                  edbMsg = ` · EDB strip failed: ${(r && r.reason) || "unknown"}`;
                }
              } catch (e) { edbMsg = ` · EDB strip threw: ${e.message}`; }
            }
            toast(`"${faction}" cleanup — project: ${projectMsg}${edbMsg}.`, "success", 6500);
            setFactionStripModal(null);
          }}
        />
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
                onReorder={onReorder}
                onInsertNear={onInsertNear}
                onMarkForRemoval={onMarkForRemoval}
                onToggleWriteBack={(id, value) => {
                  // Right-click → "Mark for editing" / "Stop editing".
                  // Stamp writeBackUserSet so migrateV1's reset-to-default
                  // logic doesn't undo this on the next reload.
                  const next = units.map(u => u.id === id ? { ...u, writeBack: !!value, writeBackUserSet: true } : u);
                  persistUnits(next);
                }}
                onRemoveFactionFromAll={(faction) => {
                  // Open a per-variant preview modal instead of stripping
                  // silently. Each affected entry gets a row showing the
                  // resulting factions[] and the proposed action:
                  //   • strip  — entry has other factions; drop just this one
                  //   • delete — entry's only positive faction; remove the
                  //              project entry entirely (Write to EDB then
                  //              prunes the recruit lines on next push)
                  // The user can opt-out per entry before applying.
                  if (!faction) return;
                  const affected = units.filter(u =>
                    (u.factions || []).includes(faction) ||
                    (u.excludeFactions || []).includes(faction)
                  );
                  // Even when zero project entries are left referencing the
                  // faction (e.g. the user already ran the strip and now
                  // wants to clean up the live EDB), still open the modal —
                  // the 'Also strip the live EDB' checkbox + Apply path
                  // works without any project entries selected.
                  const entries = affected.map(u => {
                    const facsBefore = u.factions || [];
                    const facsAfter = facsBefore.filter(f => f !== faction);
                    // "only positive faction other than 'all' is the target" — after
                    // stripping, factions[] is empty or contains only "all". The
                    // unit can't recruit factionally as itself anymore.
                    const onlyAll = facsAfter.length === 0 || facsAfter.every(f => f === "all");
                    let action;
                    if (onlyAll && facsBefore.includes(faction)) {
                      // If the unit already has an AOR sibling, keep that side
                      // alive by flipping it to AOR-only. Otherwise delete the
                      // entry entirely (no recruitment path remains).
                      action = (u.aor && u.aor.enabled) ? "convert-to-aor" : "delete";
                    } else {
                      action = "strip";
                    }
                    return {
                      id: u.id,
                      unit: u.unit,
                      factionsBefore: facsBefore,
                      excludeBefore: u.excludeFactions || [],
                      facsAfter,
                      hasAor: !!(u.aor && u.aor.enabled),
                      action,
                    };
                  });
                  setFactionStripModal({ faction, entries, selected: new Set(entries.map(e => e.id)) });
                }}
                onShowVariantDiff={showVariantDiff}
                viewMode={sidebarMode}
                onViewModeChange={setSidebarMode}
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
                    : <UnitEditor unit={selected} onChange={onChangeUnit} modIndex={modIndex} allUnits={units} onFilterFaction={(faction) => { setListFilter({ mode: "faction", value: faction }); }} onSelectUnit={(id) => { setSelectedIds(new Set()); setSelectedId(id); }} onShowVariantDiff={showVariantDiff} eduProject={eduProject} onJumpToEdu={() => { setEduView("units"); setActiveTab("edu"); }} onCreateEduStub={(authoredUnit) => {
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

function Topbar({ dataDir, loading, status, eduProject, eduProjectSource, eduDirty, eduValidationErrors = [], setEduView, setActiveTab, unitsCount, units, theme, onThemeToggle, onJumpToUnit, onJumpToEdu, onFindReplace, onExportBundle, onSaveProject, onOpenProject, onCloneProject, projectDir, projectSaveTick, projectDirty, onPick, onReload, onImport, onImportNewFromEDB, onImportEdumatic, onResetImportsToReferenceOnly, onMarkOrphanUnits, onWriteBack, onSaveText, onOpenBackups, profiles, activeProfile, onSwitchProfile, onNewProfile, onDeleteProfile, onUndo, onRedo, canUndo, canRedo, onCheckUpdates, onShowShortcuts, info }) {
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
      <VanillaDirControl />
      <button onClick={onReload} disabled={loading} style={tbtn("#446")}>{loading ? "Loading…" : "Reload"}</button>
      <button onClick={onImport} style={tbtn("#665")} title="Replace every authored entry with a fresh parse of the current EDB. Destructive — loses any hand-tuned authoring.">Import from EDB</button>
      <button onClick={onImportNewFromEDB} style={tbtn("#566")} title="Add authored entries only for unit names that exist in the EDB but have no entry in this project yet. Existing authored entries are not touched.">Import new from EDB</button>
      <button onClick={onImportEdumatic} style={tbtn("#665")} title="Import an EDUMatic .xlsm — populates both recruitment data and EDU stats">Import xlsm…</button>
      <button data-rtshortcut="save-project" onClick={onSaveProject} style={tbtn(projectDirty ? "#dca64a" : "#465")} title={`Save project (Ctrl+S) — writes one JSON file per unit/faction/armour into a folder you pick (git-friendly for team sharing)${projectDirty ? "\n— You have unsaved changes —" : ""}`}>
        {projectDirty ? "● Save project" : "Save project"}
      </button>
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
      {onMarkOrphanUnits && (() => {
        const orphans = (units || []).filter(u => !u.pendingRemoval && (!u.factions || u.factions.length === 0));
        return orphans.length > 0 ? (
          <button
            onClick={() => onMarkOrphanUnits(orphans.map(u => u.id))}
            title={`Mark for removal every unit with an empty factions[] (orphan units that won't recruit anywhere — typically left over after a Remove-faction-from-project run). Lines get stripped from the EDB on the next Write to EDB.`}
            style={tbtn("#754")}
          >Mark {orphans.length} orphan unit{orphans.length === 1 ? "" : "s"}</button>
        ) : null;
      })()}
      {/* Merge-identical-variants and Detect-AI/AOR-pairing buttons used to
          live here. Both are now run automatically as part of every
          mod-load reconcile (App.js auto-import effect), so the user
          never has to click them — the project always lands in canonical
          shape on its own. */}
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
      <button onClick={onShowShortcuts} title="Keyboard shortcuts (?)" style={{ ...tbtn("rgba(255,255,255,0.05)"), color: "#bbb", padding: "4px 9px", fontSize: 12, fontWeight: 700 }}>?</button>
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
  // Anchor for the portal-rendered dropdown. The sidebar wraps with
  // backdrop-filter:blur which creates its own stacking context, so a
  // plain absolute-positioned dropdown loses the z-index fight against
  // the unit-list controls right below the topbar (the user reported
  // the search results being hidden behind the +New unit / Duplicate /
  // Delete row). Same fix as the Sync popover — render via portal to
  // document.body with position:fixed coords.
  const inputRef = useRef(null);
  const [pos, setPos] = useState(null);
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
  // Reposition popover relative to the input on open / scroll / resize.
  useEffect(() => {
    if (!open) return;
    const reposition = () => {
      const el = inputRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      setPos({ left: r.left, top: r.bottom + 4, width: Math.max(r.width, 280) });
    };
    reposition();
    window.addEventListener("scroll", reposition, true);
    window.addEventListener("resize", reposition);
    return () => {
      window.removeEventListener("scroll", reposition, true);
      window.removeEventListener("resize", reposition);
    };
  }, [open]);

  const popStyle = pos
    ? { position: "fixed", top: pos.top, left: pos.left, minWidth: pos.width, background: "rgba(20,22,23,0.98)", border: "1px solid rgba(220,166,74,0.3)", borderRadius: 6, padding: 4, maxHeight: 360, overflowY: "auto", zIndex: 11000, boxShadow: "0 8px 24px rgba(0,0,0,0.5)" }
    : null;

  return (
    <div>
      <input
        ref={inputRef}
        data-rtshortcut="quick-search"
        type="text"
        value={q}
        onChange={(e) => { setQ(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        placeholder="Find unit (Ctrl+F)…"
        style={{ background: "#252525", border: "1px solid #333", color: "#ddd", padding: "5px 8px", borderRadius: 4, fontSize: 11.5, width: 200, fontFamily: "Consolas, monospace" }}
      />
      {open && pos && q.length < 2 && history.length > 0 && createPortal(
        <div style={popStyle}>
          <div style={{ padding: "4px 8px", fontSize: 9, color: "#888", textTransform: "uppercase", letterSpacing: 0.6 }}>Recent</div>
          {history.map((h, i) => (
            <div key={i} onMouseDown={(e) => { e.preventDefault(); setQ(h); }}
              style={{ padding: "4px 8px", cursor: "pointer", borderRadius: 3, fontSize: 12, fontFamily: "Consolas, monospace", color: "#bbb" }}
              onMouseEnter={(e) => e.currentTarget.style.background = "rgba(220,166,74,0.08)"}
              onMouseLeave={(e) => e.currentTarget.style.background = "transparent"}>
              {h}
            </div>
          ))}
        </div>,
        document.body
      )}
      {open && pos && matches.length > 0 && createPortal(
        <div style={popStyle}>
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
        </div>,
        document.body
      )}
    </div>
  );
}

// Sub-tab strip for the EDU Builder tab. Picks which EDU-matic screen is shown.
// Disabled until a project is loaded (matches EDU-matic's own sidebar logic).
function EduSubTabs({ view, onView, project }) {
  const VIEWS = [
    { key: "project",  label: "Project",     hint: "Import / re-import xlsm and see project totals." },
    { key: "modinfo",  label: "Mod Info",    hint: "Mod name, platform, era, Discord webhook URL." },
    { key: "coredata", label: "Core Data",   hint: "Lookup tables (categories, qualities, weapons, armour materials…). Password-locked." },
    { key: "units",    label: "Units",       hint: "Edit every EDU unit: stats, ownership, recruitment. Drag rows to reorder." },
    { key: "bulk",     label: "Bulk Edit",   hint: "Apply a column change across many units at once." },
    { key: "armour",   label: "Armour",      hint: "Per-model armour set: # Instances, Type, Material per body slot. Drives EDU armour value." },
    { key: "merc",     label: "Mercenaries", hint: "Pools, regions, per-unit cost / max / replenish. Cross-check vs descr_mercenaries." },
    { key: "validate", label: "Validate",    hint: "Errors and warnings across the project." },
    { key: "preview",  label: "Preview EDU", hint: "Computed DATA + formatted EDU text — read-only preview of the export." },
    { key: "export",   label: "Export EDU",  hint: "Write export_descr_unit.txt; sync export_units.txt order." },
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
            title={v.hint}
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

// Topbar control for the vanilla data dir setting. Used by the asset-
// existence check (check-mod-paths) as a fallback so vanilla-shipped
// files (data/models_missile/weapon_arrow.cas etc) the mod reuses
// without copying don't false-flag as missing. Auto-detects common
// Steam paths on first launch via the IPC; user can override via the
// folder picker. Compact display: just the basename of the dir + a
// short button. null state shows 'set vanilla dir…' to encourage setup.
function VanillaDirControl() {
  const [dir, setDir] = React.useState(null);
  const [loading, setLoading] = React.useState(true);
  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        if (window.eduAPI && window.eduAPI.getVanillaDataDir) {
          const v = await window.eduAPI.getVanillaDataDir();
          if (!cancelled) setDir(v);
        }
      } finally { if (!cancelled) setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, []);
  const pick = async () => {
    if (!window.eduAPI || !window.eduAPI.pickVanillaDataDir) return;
    const v = await window.eduAPI.pickVanillaDataDir();
    if (v !== null) setDir(v);
  };
  if (loading) return null;
  const tail = dir ? dir.split(/[\\/]/).slice(-3).join("\\") : null;
  return (
    <button
      onClick={pick}
      style={{ ...tbtn(dir ? "#3a4a3a" : "#3a3a4a"), fontSize: 11 }}
      title={dir
        ? `Vanilla data dir: ${dir}\n\nUsed as a fallback when checking whether DMB / projectile asset paths exist on disk. Click to change.`
        : "No vanilla data dir set — vanilla-shipped assets (e.g. data/models_missile/weapon_arrow.cas) will false-flag as missing. Click to pick the Steam install's Total War ROME REMASTERED → Contents/Resources/Data/data folder."}
    >
      {dir ? `Vanilla: …\\${tail}` : "Set vanilla dir…"}
    </button>
  );
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
  // Ref + effect to keep the commit input focused as long as the prompt is
  // open. The plain `autoFocus` attribute only fires once on mount; users
  // reported the input would stop accepting keystrokes after they cleared
  // the default text (some intermittent focus loss inside the portal-
  // rendered popover that we couldn't pin down). Re-focusing on every
  // commitPrompt change is a no-op while the input is already focused and
  // a one-call rescue when something has stolen focus mid-edit.
  const commitInputRef = useRef(null);
  useEffect(() => {
    if (commitPrompt === null) return;
    if (!commitInputRef.current) return;
    if (document.activeElement === commitInputRef.current) return;
    commitInputRef.current.focus();
  }, [commitPrompt]);
  // Anchor coordinates for the portal-rendered popover. The popover
  // can't live inside the topbar's DOM tree because the tabs row below
  // has its own stacking context (backdrop-filter / sticky) that clips
  // a regular absolute-positioned descendant. Rendering via a portal
  // into document.body sidesteps every ancestor's stacking and overflow.
  const btnRef = useRef(null);
  const [pos, setPos] = useState(null);

  const [diffStat, setDiffStat] = useState("");
  // Full diff body for the expand-to-view-diff button. Loaded lazily on
  // expand to avoid hauling potentially-megabytes of patch text on
  // every popover open. Capped on render so a giant diff doesn't lock
  // the renderer.
  const [diffFull, setDiffFull] = useState(null);     // null | string
  const [diffLoading, setDiffLoading] = useState(false);
  const [activity, setActivity] = useState([]);
  const refresh = useCallback(async () => {
    if (!projectDir || !api?.gitStatus) { setStatus(null); return; }
    const s = await api.gitStatus(projectDir);
    setStatus(s);
    setDiffFull(null);   // any working-tree change invalidates the cached diff body

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
    if (api.gitLogRecent && s && s.isRepo) {
      try {
        const r = await api.gitLogRecent(projectDir, 8);
        if (r && r.ok) {
          // Format: per commit, a header line "hash|author|age" followed by
          // %B (subject + body, possibly multi-line) and a sentinel line
          // "<<<MANIPULA-COMMIT-END>>>". Split on the sentinel, then within
          // each chunk peel the first line as the metadata strip and treat
          // the rest as the message body.
          const chunks = (r.stdout || "").split(/<<<MANIPULA-COMMIT-END>>>\r?\n?/);
          const commits = [];
          for (const chunk of chunks) {
            if (!chunk.trim()) continue;
            const lines = chunk.replace(/^\r?\n+/, "").split("\n");
            const head = lines[0] || "";
            const body = lines.slice(1).join("\n").trim();
            const parts = head.split("|");
            const [hash, author, age] = parts;
            const subject = body.split("\n", 1)[0] || "";
            const rest = body.slice(subject.length).replace(/^\r?\n+/, "");
            commits.push({ hash, author, age, subject, body: rest });
          }
          setActivity(commits);
        }
      } catch { setActivity([]); }
    } else { setActivity([]); }
  }, [projectDir, api]);

  // Fetch from the remote, then refresh status. Used when the popover opens
  // and after every action — the only times the user is about to make a
  // sync decision. The 5s status polling skips the fetch so it doesn't hit
  // the network 12× per minute for a panel the user isn't looking at.
  // Without this, gitStatus's behind count is stale (it compares against the
  // LOCAL view of the remote, which only updates on fetch/pull) and Pull is
  // greyed out even when the actual remote has new commits — leading to push
  // rejections with the "fetch first" hint that the user can't act on.
  const refreshWithFetch = useCallback(async () => {
    if (!projectDir || !api?.gitFetch) return refresh();
    try { await api.gitFetch(projectDir); } catch {}
    return refresh();
  }, [projectDir, api, refresh]);

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
    refreshWithFetch();   // fetch + status the instant the user looks
    const reposition = () => {
      if (!btnRef.current) return;
      const r = btnRef.current.getBoundingClientRect();
      // Default: right-align with the button (so the popover doesn't poke
      // out past the right edge). Width 320 is fixed below in the style.
      // Then clamp left so the popover never spills past either window
      // edge — needed because the Sync button can sit close to the left
      // when the topbar wraps onto a narrow window.
      const POP_WIDTH = 320;
      const MARGIN = 8;
      const desiredLeft = r.right - POP_WIDTH;
      const maxLeft = Math.max(MARGIN, window.innerWidth - POP_WIDTH - MARGIN);
      const left = Math.max(MARGIN, Math.min(desiredLeft, maxLeft));
      setPos({ top: r.bottom + 6, left });
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
      // Fetch-then-status so the behind count is fresh after the action —
      // critical when push fails with "fetch first": the user needs Pull to
      // un-grey before they can actually unblock themselves.
      await refreshWithFetch();
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
            position: "fixed", top: pos.top, left: pos.left,
            background: "#1c1c1c", border: "1px solid #3a3a3a", borderRadius: 8,
            padding: 14, width: 320, zIndex: 10000,
            fontFamily: "Consolas, monospace", fontSize: 12, color: "#bbb",
            boxShadow: "0 8px 24px rgba(0,0,0,0.6)",
            // Cap height so multi-paragraph commit bodies in Recent activity
            // don't push the popover off the bottom of the viewport — the
            // inner content scrolls instead.
            maxHeight: "calc(100vh - 80px)", overflow: "auto",
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
                  <>
                    <pre style={{ margin: "8px 0 0", padding: 6, background: "#0e0e0e", border: "1px solid #2a2a2a", borderRadius: 4, fontSize: 10, color: "#bbb", maxHeight: 120, overflow: "auto", whiteSpace: "pre" }}>
                      {diffStat.trim()}
                    </pre>
                    <div style={{ marginTop: 4, display: "flex", gap: 6 }}>
                      {diffFull == null ? (
                        <button
                          disabled={diffLoading}
                          onClick={async () => {
                            if (!api.gitDiff || !projectDir) return;
                            setDiffLoading(true);
                            try {
                              const r = await api.gitDiff(projectDir);
                              const text = (r && (r.stdout || "")) || "";
                              // Cap at ~500KB so a refactor-the-world diff
                              // doesn't lock up the renderer with millions
                              // of DOM characters.
                              const CAP = 500 * 1024;
                              setDiffFull(text.length > CAP ? text.slice(0, CAP) + `\n\n…[truncated; ${text.length - CAP} more chars hidden]` : text);
                            } finally { setDiffLoading(false); }
                          }}
                          style={{ background: "rgba(255,255,255,0.04)", color: "#aaa", border: "1px solid #333", padding: "2px 8px", borderRadius: 3, fontSize: 10, cursor: "pointer" }}
                          title="Show full unified diff vs HEAD — proofread the lines about to be pushed"
                        >{diffLoading ? "Loading…" : "▸ Show diff"}</button>
                      ) : (
                        <button
                          onClick={() => setDiffFull(null)}
                          style={{ background: "rgba(220,166,74,0.10)", color: "#dca64a", border: "1px solid rgba(220,166,74,0.3)", padding: "2px 8px", borderRadius: 3, fontSize: 10, cursor: "pointer" }}
                        >▾ Hide diff</button>
                      )}
                    </div>
                    {diffFull != null && (
                      <pre style={{ margin: "6px 0 0", padding: 6, background: "#0a0a0a", border: "1px solid #2a2a2a", borderRadius: 4, fontSize: 10, color: "#bbb", maxHeight: 280, overflow: "auto", whiteSpace: "pre", lineHeight: 1.4 }}>
                        {diffFull.split(/\r?\n/).map((line, i) => {
                          const c = line.startsWith("+") && !line.startsWith("+++") ? "#7c9"
                                  : line.startsWith("-") && !line.startsWith("---") ? "#e88"
                                  : line.startsWith("@@") ? "#dca64a"
                                  : line.startsWith("diff ") || line.startsWith("index ") ? "#888"
                                  : "#bbb";
                          return <div key={i} style={{ color: c }}>{line || " "}</div>;
                        })}
                      </pre>
                    )}
                  </>
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
                  title="git pull --rebase  (per-file JSON layout makes this silent in nearly all cases — your local commits replay cleanly on top of the remote)"
                >
                  Pull {behind ? `(${behind})` : ""}
                </button>
                {/* Destructive escape hatch — wipes every local change and
                    pulls. For when the user is stuck (unstaged changes
                    block the rebase, or they just want to throw away
                    local edits and match the remote). Confirm dialog
                    spells out exactly what dies. */}
                <button
                  disabled={busy || !(dirty || (behind || 0) > 0)}
                  onClick={() => {
                    if (!api.gitDiscardAndPull) return;
                    const dirtyCount = (status && status.dirtyCount) || 0;
                    const ok = window.confirm(
                      `Discard local changes and pull?\n\n` +
                      `This will run:\n` +
                      `  git reset --hard HEAD   ← wipes ${dirtyCount} uncommitted change${dirtyCount === 1 ? "" : "s"} in tracked files\n` +
                      `  git clean -fd           ← deletes any untracked files\n` +
                      `  git pull --rebase       ← then pulls from origin\n\n` +
                      `NOT recoverable. Use this only when you don't care about your local state.`
                    );
                    if (!ok) return;
                    run("Discard + pull", () => api.gitDiscardAndPull(projectDir));
                  }}
                  style={{ ...syncBtn("#a44", (dirty || (behind || 0) > 0)), fontWeight: 500 }}
                  title="git reset --hard HEAD && git clean -fd && git pull --rebase  (destructive — wipes local changes)"
                >
                  ⚠ Discard local + pull
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
                      ref={commitInputRef}
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
                    // One entry per commit: metadata strip, then subject
                    // (wraps to as many lines as it needs — no ellipsis), then
                    // the body if there is one. We give the whole panel a
                    // generous max-height + scroll so long messages can
                    // expand vertically without the popover overflowing the
                    // viewport.
                    <div key={i} style={{ fontSize: 11, color: "#bbb", padding: "4px 0", borderBottom: i < activity.length - 1 ? "1px solid rgba(255,255,255,0.04)" : "none" }}>
                      <div style={{ display: "flex", gap: 8 }}>
                        <span style={{ color: "#888", fontFamily: "Consolas, monospace" }}>{c.hash}</span>
                        <span style={{ color: "#dca64a", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.author}</span>
                        <span style={{ color: "#666" }}>{c.age}</span>
                      </div>
                      {c.subject && (
                        <div style={{ color: "#ccc", marginTop: 2, paddingLeft: 2, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                          {c.subject}
                        </div>
                      )}
                      {c.body && (
                        <pre style={{
                          color: "#999", marginTop: 3, marginBottom: 0, paddingLeft: 8,
                          borderLeft: "2px solid rgba(220,166,74,0.25)",
                          whiteSpace: "pre-wrap", wordBreak: "break-word",
                          fontFamily: "inherit", fontSize: 10.5, lineHeight: 1.4,
                        }}>{c.body}</pre>
                      )}
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

// Variant comparison modal — side-by-side field grid for siblings
// sharing a recruit name. Differing rows surface in amber at the top;
// matching rows are dimmed below so the user can see at-a-glance what
// keeps two variants from merging cleanly.
// Per-variant preview modal for "Remove faction from project". Groups
// the affected entries by proposed action (strip / convert-to-aor /
// delete) so the user can opt-out per row before applying.
function FactionStripModal({ state, onToggle, onSelectAll, onDeselectAll, onCancel, onApply }) {
  const { faction, entries, selected } = state;
  const [alsoStripEdb, setAlsoStripEdb] = useState(true);
  const [busy, setBusy] = useState(false);
  const groups = {
    strip: entries.filter(e => e.action === "strip"),
    "convert-to-aor": entries.filter(e => e.action === "convert-to-aor"),
    "delete": entries.filter(e => e.action === "delete"),
  };
  const selectedCount = entries.filter(e => selected.has(e.id)).length;
  const headerStyle = { fontSize: 11, color: "#dca64a", textTransform: "uppercase", letterSpacing: 0.6, fontWeight: 700, padding: "8px 0 4px" };
  const renderRow = (e) => (
    <label key={e.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "3px 8px", cursor: "pointer", borderRadius: 3, fontSize: 12, color: "#ddd" }}
      onMouseEnter={(ev) => ev.currentTarget.style.background = "rgba(220,166,74,0.06)"}
      onMouseLeave={(ev) => ev.currentTarget.style.background = ""}>
      <input type="checkbox" checked={selected.has(e.id)} onChange={() => onToggle(e.id)} />
      <span style={{ flex: 1, fontFamily: "Consolas, monospace" }}>{e.unit}</span>
      <span style={{ color: "#888", fontSize: 11 }}>
        [{e.factionsBefore.join(", ")}] →{" "}
        {e.action === "strip" && <span style={{ color: "#7c9" }}>[{e.facsAfter.join(", ")}]</span>}
        {e.action === "convert-to-aor" && <span style={{ color: "#dca64a" }}>aor-only (factional dropped, AOR sibling kept)</span>}
        {e.action === "delete" && <span style={{ color: "#e88" }}>delete entry</span>}
      </span>
    </label>
  );
  return createPortal(
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", zIndex: 11000, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ background: "#1c1c1c", border: "1px solid rgba(220,166,74,0.4)", borderRadius: 10, padding: 18, width: "min(960px, 92vw)", maxHeight: "85vh", display: "flex", flexDirection: "column" }}>
        <div style={{ fontSize: 16, fontWeight: 700, color: "#dca64a", marginBottom: 4 }}>Remove "{faction}" from project</div>
        <div style={{ fontSize: 12, color: "#aaa", marginBottom: 10 }}>
          {entries.length} entr{entries.length === 1 ? "y" : "ies"} reference "{faction}". Each row shows what would happen — uncheck any you want to skip. Recoverable via Ctrl+Z after Apply.
        </div>
        <div style={{ display: "flex", gap: 8, marginBottom: 10, fontSize: 11, color: "#999" }}>
          <button onClick={() => onSelectAll(() => true)} style={{ background: "rgba(255,255,255,0.06)", color: "#ddd", border: "1px solid #333", padding: "3px 10px", borderRadius: 4, cursor: "pointer" }}>Select all</button>
          <button onClick={() => onDeselectAll(() => true)} style={{ background: "rgba(255,255,255,0.06)", color: "#ddd", border: "1px solid #333", padding: "3px 10px", borderRadius: 4, cursor: "pointer" }}>Deselect all</button>
          <span style={{ flex: 1 }} />
          <span>{selectedCount} / {entries.length} selected</span>
        </div>
        <div style={{ flex: 1, overflow: "auto", paddingRight: 4 }}>
          {entries.length === 0 && (
            <div style={{ padding: "30px 12px", textAlign: "center", color: "#888", fontSize: 12, fontStyle: "italic" }}>
              No project entries reference "{faction}" — the project's already clean.
              Tick the "Also strip the live EDB" box below if you want to scrub the live EDB recruit lines anyway.
            </div>
          )}
          {groups.strip.length > 0 && (
            <>
              <div style={{ ...headerStyle, color: "#7c9" }}>Strip "{faction}" only — {groups.strip.length} entr{groups.strip.length === 1 ? "y" : "ies"}</div>
              {groups.strip.map(renderRow)}
            </>
          )}
          {groups["convert-to-aor"].length > 0 && (
            <>
              <div style={{ ...headerStyle, color: "#dca64a" }}>Convert to AOR-only (factional dropped, AOR kept) — {groups["convert-to-aor"].length} entr{groups["convert-to-aor"].length === 1 ? "y" : "ies"}</div>
              {groups["convert-to-aor"].map(renderRow)}
            </>
          )}
          {groups["delete"].length > 0 && (
            <>
              <div style={{ ...headerStyle, color: "#e88" }}>Delete entry (no AOR sibling, no recruitment path remains) — {groups["delete"].length} entr{groups["delete"].length === 1 ? "y" : "ies"}</div>
              {groups["delete"].map(renderRow)}
            </>
          )}
        </div>
        <div style={{ display: "flex", gap: 12, alignItems: "center", marginTop: 12, paddingTop: 10, borderTop: "1px solid rgba(255,255,255,0.06)" }}>
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "#ccc", cursor: "pointer" }} title="Also walk export_descr_buildings.txt and surgically strip every recruit line that mentions this faction. Lines whose only positive faction is the target are removed; lines with other factions are rewritten. Backs up the EDB before writing.">
            <input type="checkbox" checked={alsoStripEdb} onChange={() => setAlsoStripEdb(v => !v)} />
            Also strip the live EDB
          </label>
          <span style={{ flex: 1 }} />
          <button disabled={busy} onClick={onCancel} style={{ background: "rgba(255,255,255,0.06)", color: "#aaa", border: "1px solid #333", padding: "6px 14px", borderRadius: 4, cursor: busy ? "not-allowed" : "pointer" }}>Cancel</button>
          {(() => {
            // Apply is enabled when there's *something* to do: either
            // selected project entries OR the EDB-strip checkbox is on
            // (the EDB pass works standalone, e.g. when the project has
            // already been cleaned but the live EDB still has greek lines).
            const hasWork = selectedCount > 0 || alsoStripEdb;
            const label = busy ? "Working…"
              : selectedCount > 0 && alsoStripEdb ? `Apply to ${selectedCount} + strip EDB`
              : selectedCount > 0 ? `Apply to ${selectedCount}`
              : alsoStripEdb ? "Strip EDB only"
              : "Nothing to apply";
            return (
              <button
                onClick={async () => { setBusy(true); try { await onApply(alsoStripEdb); } finally { setBusy(false); } }}
                disabled={busy || !hasWork}
                style={{ background: hasWork && !busy ? "rgba(220,166,74,0.2)" : "rgba(255,255,255,0.04)", color: hasWork && !busy ? "#dca64a" : "#666", border: "1px solid " + (hasWork && !busy ? "rgba(220,166,74,0.5)" : "#333"), padding: "6px 14px", borderRadius: 4, fontWeight: 600, cursor: hasWork && !busy ? "pointer" : "not-allowed" }}
              >{label}</button>
            );
          })()}
        </div>
      </div>
    </div>,
    document.body
  );
}

function VariantDiffModal({ variantDiff, onClose }) {
  const { variants, recruitName } = variantDiff;
  // Field set: union of every key across the variants, minus identity
  // / ordering / per-instance cosmetics that don't affect recruit lines.
  const OMIT = new Set(["id", "manualOrder", "pendingRemoval", "_ghost"]);
  const fieldKeys = useMemo(() => {
    const s = new Set();
    for (const v of variants) for (const k of Object.keys(v || {})) if (!OMIT.has(k)) s.add(k);
    return [...s].sort();
  }, [variants]);
  const norm = (v) => {
    // Make arrays / objects deterministically comparable.
    if (Array.isArray(v)) return JSON.stringify([...v].sort());
    if (v && typeof v === "object") return JSON.stringify(v, Object.keys(v).sort());
    if (v == null) return "";
    return String(v);
  };
  const render = (v) => {
    if (Array.isArray(v)) return v.length ? v.join(", ") : <span style={{ color: "#666" }}>—</span>;
    if (v && typeof v === "object") return <code style={{ color: "#aaa", fontSize: 10 }}>{JSON.stringify(v)}</code>;
    if (v == null || v === "") return <span style={{ color: "#666" }}>—</span>;
    if (v === true) return <span style={{ color: "#7c9" }}>✓ true</span>;
    if (v === false) return <span style={{ color: "#888" }}>✗ false</span>;
    return String(v);
  };
  const rows = useMemo(() => {
    return fieldKeys.map((k) => {
      const cells = variants.map((v) => v[k]);
      const sigs = cells.map(norm);
      const allSame = sigs.every((s) => s === sigs[0]);
      return { key: k, cells, allSame };
    });
  }, [fieldKeys, variants]);
  const differing = rows.filter((r) => !r.allSame);
  const matching = rows.filter((r) => r.allSame);
  return createPortal(
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.65)", zIndex: 13000, display: "flex", alignItems: "flex-start", justifyContent: "center", paddingTop: "5vh", overflow: "auto" }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: "#1a1a1a", border: "1px solid rgba(220,166,74,0.4)", borderRadius: 10, padding: 22, minWidth: 720, maxWidth: "90vw", maxHeight: "85vh", overflow: "auto", boxShadow: "0 12px 40px rgba(0,0,0,0.6)", color: "#ddd" }}>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 10 }}>
          <h2 style={{ margin: 0, color: "#dca64a", fontWeight: 600, fontSize: 16 }}>
            Variant diff <span style={{ color: "#999", fontWeight: 400, fontSize: 13 }}>· "{recruitName}" · {variants.length} variants</span>
          </h2>
          <button onClick={onClose} style={{ background: "transparent", border: "1px solid #444", color: "#bbb", borderRadius: 4, padding: "4px 10px", cursor: "pointer", fontSize: 11 }}>Esc / close</button>
        </div>
        <p style={{ color: "#999", fontSize: 12, marginTop: 0 }}>
          {differing.length === 0
            ? <>All fields match — these variants <strong style={{ color: "#7c9" }}>are identical</strong> and will be auto-merged on the next mod reload (the merge runs as part of the auto-reconcile pass).</>
            : <>The amber rows below are why these variants haven't merged. Edit them in the editor to align if you want a single entry.</>}
        </p>
        <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: "Consolas, monospace", fontSize: 11.5 }}>
          <thead>
            <tr style={{ background: "rgba(220,166,74,0.06)", color: "#dca64a" }}>
              <th style={{ textAlign: "left", padding: "6px 10px", borderBottom: "1px solid rgba(220,166,74,0.25)", whiteSpace: "nowrap" }}>Field</th>
              {variants.map((v, i) => (
                <th key={i} style={{ textAlign: "left", padding: "6px 10px", borderBottom: "1px solid rgba(220,166,74,0.25)" }}>
                  Variant {i + 1}
                  <div style={{ fontSize: 10, color: "#888", fontWeight: 400, marginTop: 2 }}>
                    {v.aor && v.aor.enabled ? (v.aor.aorOnly ? "AOR-only" : "Factional + AOR") : "Factional"}
                    {v.writeBack === false && " · ref-only"}
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {differing.length > 0 && (
              <tr><td colSpan={variants.length + 1} style={{ padding: "8px 10px", color: "#dca64a", fontSize: 10, textTransform: "uppercase", letterSpacing: 0.5, background: "rgba(220,166,74,0.04)" }}>Differing — {differing.length}</td></tr>
            )}
            {differing.map((r) => (
              <tr key={r.key} style={{ background: "rgba(220,166,74,0.05)" }}>
                <td style={{ padding: "5px 10px", color: "#dca64a", verticalAlign: "top", whiteSpace: "nowrap", borderBottom: "1px solid rgba(255,255,255,0.04)" }}>{r.key}</td>
                {r.cells.map((c, i) => (
                  <td key={i} style={{ padding: "5px 10px", color: "#ddd", verticalAlign: "top", borderBottom: "1px solid rgba(255,255,255,0.04)" }}>{render(c)}</td>
                ))}
              </tr>
            ))}
            {matching.length > 0 && (
              <tr><td colSpan={variants.length + 1} style={{ padding: "8px 10px", color: "#666", fontSize: 10, textTransform: "uppercase", letterSpacing: 0.5, background: "rgba(255,255,255,0.02)" }}>Matching — {matching.length}</td></tr>
            )}
            {matching.map((r) => (
              <tr key={r.key}>
                <td style={{ padding: "4px 10px", color: "#666", verticalAlign: "top", whiteSpace: "nowrap", borderBottom: "1px solid rgba(255,255,255,0.03)" }}>{r.key}</td>
                {r.cells.map((c, i) => (
                  <td key={i} style={{ padding: "4px 10px", color: "#888", verticalAlign: "top", borderBottom: "1px solid rgba(255,255,255,0.03)" }}>{render(c)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>,
    document.body
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
