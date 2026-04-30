import React, { useEffect, useMemo, useState, useCallback } from "react";
import UnitList from "./components/UnitList";
import UnitEditor from "./components/UnitEditor";
import BulkEditor from "./components/BulkEditor";
import ValidationView from "./components/ValidationView";
import RosterOverview from "./components/RosterOverview";
import { validateUnits, validateFactions, summarize } from "./validation";
import useHistory, { useUndoShortcuts } from "./useHistory";
import { parseEDB, groupByUnit, extractCoreRequires, extractFactions, detectMinTier } from "./parsers/edb";
import { parseFactions } from "./parsers/factions";
import { parseResources } from "./parsers/resources";
import { parseRegions, regionsByHiddenResource } from "./parsers/regions";
import { parseEDU } from "./parsers/edu";
import { parseStrings } from "./parsers/strings";
import { parseReforms } from "./parsers/reforms";
import { renderAllPreview, applyUnitsToEDB, diffEDB } from "./generator";
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
    // Subscribe to update events so we can show a toast when an update is available/downloaded.
    const unsub = api.onUpdateStatus && api.onUpdateStatus((s) => setUpdateStatus(s));
    return () => { if (typeof unsub === "function") unsub(); };
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
    try {
      const r = await api.loadModFiles();
      if (!r.ok) { setStatus("Failed: " + (r.reason || "?")); return; }
      if (r.missing && r.missing.length) {
        setStatus("Missing: " + r.missing.join(", "));
      }
      const f = r.files;
      const factions = f.factions ? parseFactions(f.factions) : [];
      const { resources, hiddenResources } = f.resources ? parseResources(f.resources) : { resources: [], hiddenResources: [] };
      const regions = f.regions ? parseRegions(f.regions) : [];
      const edu = f.edu ? parseEDU(f.edu) : [];
      const unitStrings = f.units ? parseStrings(f.units) : {};
      const buildingStrings = f.buildings ? parseStrings(f.buildings) : {};
      const expandedBi = f.expandedBi ? parseStrings(f.expandedBi) : {};
      const { reforms, scriptFiles } = f.events ? parseReforms(f.events, f.eventScriptFiles || []) : { reforms: [], scriptFiles: [] };
      const edb = f.edb ? parseEDB(f.edb) : { aliases: [], buildings: [], recruits: [] };

      const regionsByHR = {};
      for (const r of regions) for (const t of r.traits) {
        if (!regionsByHR[t]) regionsByHR[t] = [];
        regionsByHR[t].push(r);
      }
      // Dedup hiddenResource list to ones actually mentioned somewhere (resources file can list dozens that are unused).
      const hrSet = new Set(hiddenResources.map(h => h.id));
      const hrEffective = hiddenResources.slice();

      // Build a quick lookup: EDB recruit name (with spaces) → friendly display name (from strings).
      const eduByType = new Map(edu.map(u => [u.type, u]));
      const unitDisplayName = (recruitName) => {
        const u = eduByType.get(recruitName);
        if (!u) return null;
        const k = u.dictionary || recruitName.replace(/\s+/g, "_");
        return unitStrings[k] || null;
      };
      setModIndex({
        factions, resources, hiddenResources: hrEffective, regions, regionsByHR,
        aliases: edb.aliases, buildings: edb.buildings, recruits: edb.recruits,
        reforms, scriptFiles, edu, eduByType,
        strings: { units: unitStrings, buildings: buildingStrings, expandedBi },
        unitDisplayName,
      });
      setEdbText(f.edb || "");
      setStatus(`Loaded: ${factions.length} factions, ${resources.length} resources, ${hiddenResources.length} hidden, ${regions.length} regions, ${edb.recruits.length} recruit lines, ${reforms.length} reforms.`);
    } catch (e) {
      console.error(e);
      setStatus("Error: " + e.message);
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { if (api && dataDir) loadMod(); }, [dataDir, loadMod]);

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
    const newId = "unit_" + Date.now().toString(36);
    const dup = migrateV1({ ...src, id: newId, unit: src.unit + " (copy)" });
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
    setStatus("Reading " + p + "…");
    const r = await api.readEdumaticXlsm(p);
    if (!r.ok) { setStatus("Failed: " + r.reason); return; }
    const sel = new Set(r.rows.map((_, i) => i));
    setEdumaticPreview({ source: r.source, rows: r.rows, selected: sel });
    setStatus(`Parsed ${r.count} rows from ${r.source}`);
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

  const previewWriteBack = async () => {
    if (!api) return;
    if (!units.length) { alert("No units to write."); return; }
    const fresh = await api.readEDB();
    if (!fresh) { alert("Could not read EDB."); return; }
    const d = diffEDB(fresh, units);
    setDiff({ ...d, fresh });
  };

  const confirmWriteBack = async () => {
    if (!diff) return;
    const out = applyUnitsToEDB(diff.fresh, units);
    const r = await api.writeEDB(out);
    if (r.ok) setStatus(`Wrote EDB. Backup: ${r.backup}`);
    else setStatus("Write failed: " + r.reason);
    setDiff(null);
  };

  const exportAllText = useMemo(() => renderAllPreview(units), [units]);
  const validationSummary = useMemo(() => {
    const sum = summarize(validateUnits(units, modIndex));
    const factionIssues = validateFactions(units, modIndex);
    return { ...sum, factionIssues: factionIssues.length };
  }, [units, modIndex]);

  return (
    <div style={{ height: "100vh", display: "flex", flexDirection: "column" }}>
      <Topbar
        dataDir={dataDir}
        loading={loading}
        status={status}
        onPick={async () => { const d = await api.pickDataDir(); if (d) { setDataDir(d); } }}
        onReload={loadMod}
        onImport={importFromEDB}
        onImportEdumatic={importFromEdumatic}
        onResetImportsToReferenceOnly={resetImportsToReferenceOnly}
        onWriteBack={previewWriteBack}
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
      {updateStatus && updateStatus.state !== "none" && updateStatus.state !== "error" && (
        <UpdateToast status={updateStatus} onInstall={() => api.updaterQuitAndInstall()} onDismiss={() => setUpdateStatus(null)} />
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
        <div style={{ width: 320, minWidth: 280, height: "100%" }}>
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
          />
        </div>
        <div style={{ flex: 1, height: "100%", display: "flex", flexDirection: "column" }}>
          <Tabs activeTab={activeTab} onChange={setActiveTab} validationSummary={validationSummary} />
          <div style={{ flex: 1, overflow: "hidden" }}>
            {activeTab === "editor" && (
              <div style={{ height: "100%", overflow: "auto" }}>
                {listFilter.mode === "faction" && listFilter.value && (
                  <div style={{ padding: "12px 16px 0" }}>
                    <RosterOverview units={units} faction={listFilter.value} onUnitClick={(id) => { setSelectedIds(new Set()); setSelectedId(id); }} />
                  </div>
                )}
                {selectedIds.size > 1
                  ? <BulkEditor selectedUnits={bulkSelected} onApply={applyBulk} modIndex={modIndex} onClearSelection={clearSelection} />
                  : <UnitEditor unit={selected} onChange={onChangeUnit} modIndex={modIndex} />}
              </div>
            )}
            {activeTab === "validation" && (
              <ValidationView
                units={units}
                modIndex={modIndex}
                onJump={(id) => { setSelectedIds(new Set()); setSelectedId(id); setActiveTab("editor"); }}
                onFilterFaction={(faction) => { setListFilter({ mode: "faction", value: faction }); setActiveTab("editor"); }}
              />
            )}
            {activeTab === "exportAll" && (
              <pre style={{ height: "100%", overflow: "auto", padding: 16, margin: 0, fontFamily: "Consolas, monospace", fontSize: 11.5, color: "#bbb", background: "#161616", whiteSpace: "pre-wrap" }}>{exportAllText}</pre>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function Topbar({ dataDir, loading, status, onPick, onReload, onImport, onImportEdumatic, onResetImportsToReferenceOnly, onWriteBack, onSaveText, onOpenBackups, profiles, activeProfile, onSwitchProfile, onNewProfile, onDeleteProfile, onUndo, onRedo, canUndo, canRedo, info }) {
  return (
    <div style={{ borderBottom: "1px solid #333", padding: "8px 12px", display: "flex", alignItems: "center", gap: 8, background: "#161616", flexWrap: "wrap" }}>
      <div style={{ fontWeight: 700, fontSize: 14, marginRight: 8 }}>Recruitment Tool</div>
      <button onClick={onPick} style={tbtn("#3a4a5a")}>Mod data folder…</button>
      <span style={{ color: "#999", fontSize: 12, fontFamily: "Consolas, monospace" }}>{dataDir}</span>
      <button onClick={onReload} disabled={loading} style={tbtn("#446")}>{loading ? "Loading…" : "Reload"}</button>
      <button onClick={onImport} style={tbtn("#665")}>Import from EDB</button>
      <button onClick={onImportEdumatic} style={tbtn("#665")}>Import EDUMatic…</button>
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
      <button onClick={onWriteBack} style={{ ...tbtn(ACCENT), color: "#1a1a1a", fontWeight: 700 }}>Write to EDB</button>
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
    <div style={{ display: "flex", borderBottom: "1px solid rgba(255,255,255,0.08)", background: "rgba(255,255,255,0.02)" }}>
      {tab("editor", "Editor")}
      {tab("validation", "Validation", errBadge)}
      {tab("exportAll", "All units (preview)")}
    </div>
  );
}

function tbtn(color) {
  return { background: color, color: "#fff", border: "none", padding: "6px 12px", borderRadius: 6, fontSize: 12, fontWeight: 500 };
}
const ACCENT = "#dca64a";

function isImportedUnit(u) {
  const n = (u.notes || "").toLowerCase();
  return n.includes("imported");
}

// Auto-update toast (top-right). Three states surfaced:
//   - "available"  → "Update v0.X available. Downloading…"
//   - "downloading" → percent
//   - "downloaded" → "Restart to install"
function UpdateToast({ status, onInstall, onDismiss }) {
  const wrap = {
    position: "fixed", top: 16, right: 16, zIndex: 1500,
    background: "rgba(28,30,32,0.96)", border: "1px solid rgba(220,166,74,0.35)", borderRadius: 10,
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

function DiffModal({ diff, onCancel, onConfirm }) {
  const { added, removed, kept } = diff;
  const Section = ({ title, color, items }) => (
    <details open style={{ marginBottom: 8 }}>
      <summary style={{ cursor: "pointer", color, fontWeight: 600 }}>{title} ({items.length})</summary>
      <pre style={{ margin: "4px 0 0 0", maxHeight: 200, overflow: "auto", background: "#161616", padding: 6, fontFamily: "Consolas, monospace", fontSize: 11.5, color: "#bbb", border: "1px solid #2a2a2a", whiteSpace: "pre-wrap" }}>
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
