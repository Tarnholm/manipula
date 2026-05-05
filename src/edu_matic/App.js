// App.js — scaffold UI that exercises the full pipeline end-to-end.
// Sidebar-nav single window: one screen per stage (Project, Mod Info,
// Core Data, Units, Armour, Mercenaries, Validate, Preview, Export).
//
// Philosophy: minimal plumbing, read-only tables, visible state. Swap in
// your own edit UX, grid library, and styling later — the core pipeline
// modules beside this file are stable.
//
// All computation runs in the renderer (importXlsmBuffer, validate,
// compute). File I/O (file dialogs, binary reads, EDU writes) goes
// through window.eduAPI (see preload.js).

import React, { useState, useEffect, useMemo, useCallback } from "react";
import "./App.css";
import { importXlsmBuffer } from "./xlsmImporter";
import { validate, diagnose } from "./validate";
import { compute } from "./compute";
import { formatEdu } from "./format";
import { formatMerc } from "./merc";
import DataTable from "./components/DataTable";

// Natural-sort comparator — sorts "Faction1, Faction2, ... Faction10" the
// way humans expect instead of the lexicographic "Faction1, Faction10,
// Faction178, Faction179, Faction18, Faction180, ..." that String.compare
// produces. Reused across the Mod Info and Core Data screens.
const NATURAL_COLLATOR = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

const VIEWS = [
  { key: "project",  label: "Project",        hint: "Load / save"          },
  { key: "modinfo",  label: "Mod Info",       hint: "Name, platform, era"  },
  { key: "coredata", label: "Core Data",      hint: "Lookup tables"        },
  { key: "units",    label: "Units",          hint: "Unit definitions"     },
  { key: "bulk",     label: "Bulk Edit",      hint: "Filter + apply field changes" },
  { key: "armour",   label: "Armour",         hint: "Armour models"        },
  { key: "merc",     label: "Mercenaries",    hint: "Merc units"           },
  { key: "validate", label: "Validate",       hint: "Error check"          },
  { key: "preview",  label: "Preview EDU",    hint: "Computed output"      },
  { key: "export",   label: "Export",         hint: "Write .txt file"      },
];

// Preview EDU column order — mirrors the EDUMatic spreadsheet's DATA
// sheet layout. Compute may not produce every key here (sparse / conditional
// fields) and may produce keys not in this list; both cases are handled in
// PreviewScreen by intersecting with the actually-present keys.
const PREVIEW_EDU_ORDER = [
  "entryType", "Name / Comments", "type", "dictionary",
  "category", "class", "voice_type", "voice_indexes",
  "unit variation", "model", "No. of men", "No. of extras",
  "mass", "radius", "height",
  "model1", "model2", "model3", "model4", "model5", "model6", "model7",
  "officer1", "officer2", "officer3", "officer4", "officer5",
  "ship", "engine", "animal", "mount",
  "vs_horse", "vs_elephant", "vs_chariot", "vs_camel",
  "sea_faring", "can_swim", "hide_forest", "hide_l_grass", "can_sap",
  "frighten_f", "frighten_m", "can_amok", "gen_unit",
  "cant_circle/warcry/druid", "no_custom", "command", "merc_unit",
  "hardy", "p_charge", "is_peas", "can_horde",
  "h. cl. spacing", "v. cl. spacing", "h. l. spacing", "v. l. spacing", "ranks",
  "formation1", "formation2",
  "hp", "sec hp",
  "attack", "charge", "msl type", "msl range", "msl ammo",
  "wpn type", "wpn tech", "dmg type", "sound type",
  "min delay", "lethality", "ap", "bp",
  "spear-attr", "spear_bon", "pike", "prec", "thrown", "launch", "area",
  "s attack", "s charge", "s msl type", "s msl range", "s msl ammo",
  "s wpn type", "s wpn tech", "s dmg type", "s sound type",
  "s min delay", "s lethality", "s ap", "s bp",
  "s spear-att", "s spear_b", "s pike", "s prec", "s thrown", "s launch", "s area",
  "armour", "defence", "shield", "hit sound",
  "sec armour", "sec defence", "sec hit sound",
  "heat", "scrub", "sand", "forest", "snow",
  "morale", "discipline", "training", "charge dist", "fire delay",
  "food1", "food2", "turns", "price", "upkeep", "wpn upg", "arm upg",
  "recruit_priority_offset",
  "ownership", "ownershipStrings",
  "ethnicity",
  "tattoo colour", "hair colour", "hair style",
];

// Embedded mode: when running inside the recruitment-tool, the parent owns the project
// state, the import action, and which sub-view is shown. We become a thin renderer.
//   - externalProject: parent-owned project (when set, overrides internal state)
//   - onProjectChange: called after a successful import so the parent can lift the state
//   - controlledView / onControlledView: parent drives the sub-view tab strip
//   - hideSidebar: hide EDU-matic's own brand + nav (parent has its own)
//   - jumpToUnit: when the parent jumps from the recruitment editor, scroll the Units screen
//                 to that unit on mount
export default function App({ externalProject = null, onProjectChange, controlledView, onControlledView, hideSidebar = false, jumpToUnit = null, modDataDir = null, recruitUnits = null, lastImportedSnapshot = null, onJumpToRecruit = null, projectBlame = null, projectDir = null } = {}) {
  const [internalView, setInternalView] = useState("project");
  const view = controlledView || internalView;
  const setView = onControlledView || setInternalView;
  const [internalProject, setInternalProject] = useState(null);
  const project = externalProject !== null ? externalProject : internalProject;
  const setProject = (p) => {
    if (onProjectChange) onProjectChange(p);
    if (externalProject === null) setInternalProject(p);
  };
  const [toast, setToast] = useState(null);
  const [appVersion, setAppVersion] = useState("");

  useEffect(() => {
    if (window.eduAPI) {
      window.eduAPI.getAppVersion().then(setAppVersion).catch(() => {});
    }
  }, []);

  const showToast = useCallback((text, kind = "info") => {
    setToast({ text, kind, id: Date.now() });
    setTimeout(() => setToast((t) => (t && Date.now() - t.id > 3500 ? null : t)), 4000);
  }, []);

  const importXlsm = useCallback(async () => {
    if (!window.eduAPI) { showToast("No eduAPI — run from Electron.", "error"); return; }
    const filePath = await window.eduAPI.pickXlsm();
    if (!filePath) return;
    try {
      const bytes = await window.eduAPI.readFileBinary(filePath);
      if (!bytes) throw new Error("Failed to read file.");
      const buf = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
      const p = importXlsmBuffer(buf);
      setProject(p);
      showToast(`Imported "${p.modInfo.name || filePath}" — ${p.units.length} unit rows`, "success");
      setView("modinfo");
    } catch (err) {
      showToast(`Import failed: ${err.message}`, "error");
      window.eduAPI?.logMessage?.("error", `import: ${err.stack || err.message}`);
    }
  }, [showToast]);

  const exportEdu = useCallback(async (text, baseName) => {
    if (!window.eduAPI) return null;
    const dir = await window.eduAPI.chooseExportDir();
    if (!dir) return null;
    const out = await window.eduAPI.exportEdu(text, dir, baseName || "export_descr_unit");
    if (out) {
      showToast(`Wrote ${out}`, "success");
      window.eduAPI.revealInFolder?.(out);
    } else {
      showToast("Export failed — see log.", "error");
    }
    return out;
  }, [showToast]);

  // (kept for future uses — currently consumed only by ExportScreen)

  return (
    <div className="app">
      {!hideSidebar && (
        <Sidebar
          view={view}
          onView={setView}
          project={project}
          appVersion={appVersion}
          onImport={importXlsm}
        />
      )}
      <main className="app-main">
        {view === "project"  && <ProjectScreen  project={project} onImport={importXlsm} projectDir={projectDir} />}
        {view === "modinfo"  && <ModInfoScreen  project={project} setProject={setProject} />}
        {view === "coredata" && <CoreDataScreen project={project} setProject={setProject} />}
        {view === "units"    && <UnitsScreen    project={project} setProject={setProject} modDataDir={modDataDir} recruitUnits={recruitUnits} lastImportedSnapshot={lastImportedSnapshot} onJumpToRecruit={onJumpToRecruit} projectBlame={projectBlame} />}
        {view === "bulk"     && <BulkEditScreen project={project} setProject={setProject} />}
        {view === "armour"   && <ArmourScreen   project={project} setProject={setProject} projectBlame={projectBlame} />}
        {view === "merc"     && <MercScreen     project={project} modDataDir={modDataDir} />}
        {view === "validate" && <ValidateScreen project={project} onView={setView} />}
        {view === "preview"  && <PreviewScreen  project={project} />}
        {view === "export"   && <ExportScreen   project={project} onExport={exportEdu} modDataDir={modDataDir} />}
      </main>
      {toast && <div className={`toast toast-${toast.kind}`}>{toast.text}</div>}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────

function Sidebar({ view, onView, project, appVersion, onImport }) {
  return (
    <aside className="sidebar">
      <div className="brand">
        <div className="brand-title">EDU-matic</div>
        <div className="brand-sub">v{appVersion || "dev"}</div>
      </div>
      <div className="brand-proj">
        {project ? (
          <>
            <div className="proj-name">{project.modInfo.name || "(unnamed mod)"}</div>
            <div className="proj-meta">{project.modInfo.platform || "?"} · {project.units.length} units</div>
          </>
        ) : (
          <button className="btn btn-accent" onClick={onImport}>Import .xlsm…</button>
        )}
      </div>
      <nav className="nav">
        {VIEWS.map((v) => (
          <button
            key={v.key}
            className={`nav-item ${view === v.key ? "active" : ""}`}
            disabled={!project && v.key !== "project"}
            onClick={() => onView(v.key)}
          >
            <div className="nav-label">{v.label}</div>
            <div className="nav-hint">{v.hint}</div>
          </button>
        ))}
      </nav>
    </aside>
  );
}

// ─── Screens ─────────────────────────────────────────────────────────

function ProjectScreen({ project, onImport, projectDir }) {
  return (
    <div className="screen">
      <h2>Project</h2>
      {project ? (
        <div className="card">
          <div className="field"><span>Name</span><strong>{project.modInfo.name || "—"}</strong></div>
          <div className="field"><span>Platform</span><strong>{project.modInfo.platform || "—"}</strong></div>
          <div className="field"><span>Era</span><strong>{project.modInfo.era || "—"}</strong></div>
          <div className="field"><span>Units</span><strong>{project.units.length}</strong></div>
          <div className="field"><span>Factions</span><strong>{project.factions.filter(Boolean).length}</strong></div>
          <div className="field"><span>Armour models</span><strong>{project.armour.length}</strong></div>
          <div className="field"><span>Mercenary rows</span><strong>{project.merc.length}</strong></div>
          <div className="field"><span>Core-data tables</span><strong>{Object.keys(project.coreData).length}</strong></div>
          {projectDir && (
            <div className="field" style={{ alignItems: "center" }}>
              <span>Project folder</span>
              <strong style={{ fontFamily: "Consolas, monospace", fontSize: 11, wordBreak: "break-all" }}>{projectDir}</strong>
            </div>
          )}
          <div className="actions"><button className="btn" onClick={onImport}>Re-import .xlsm…</button></div>
        </div>
      ) : (
        <div className="card">
          <p>No project loaded. Import a .xlsm to get started:</p>
          <div className="actions"><button className="btn btn-accent" onClick={onImport}>Import .xlsm…</button></div>
          <p className="dim" style={{ marginTop: 24 }}>
            Tested with EDU-matic_RIS_0.7.0 239 factions.xlsm.
          </p>
        </div>
      )}
      <div style={{ marginTop: 18, padding: 12, background: "rgba(220,166,74,0.05)", border: "1px solid rgba(220,166,74,0.2)", borderRadius: 8, fontSize: 12, color: "#bca", lineHeight: 1.6 }}>
        <strong style={{ color: "#dca64a" }}>Credits — EDU pipeline:</strong> The compute / format / validate pipeline used here ports the VBA macros from the <strong>EDU-matic</strong> spreadsheet. <strong>Aradan</strong> built the original spreadsheet that this whole lineage descends from. <strong>Tone</strong> did the bulk of the adaptation work on top of Aradan's original — most of the VBA coding, the 512-column DATA layout, the VLOOKUP-driven core-data tables, and the balance-formula semantics that this JavaScript port mirrors are Tone's work. <strong>BiggusDickus (BD)</strong> contributed smaller more recent updates ("BD's New Base"). Manipula bundles their work into the same window as recruitment authoring; the EDU-matic logic and the underlying balance design are theirs.
      </div>
    </div>
  );
}

function ModInfoScreen({ project, setProject }) {
  const [hookStatus, setHookStatus] = useState(null);
  const [hookBusy, setHookBusy] = useState(false);
  if (!project) return <EmptyScreen />;
  const mi = project.modInfo;
  const g = project.globals;
  // All meta fields are inline-editable now. Each setter does a structural
  // replace ({...mi, [key]: value}) so React picks up the change and
  // useHistory captures it for undo.
  const setMI = (key) => (e) => {
    setProject({ ...project, modInfo: { ...mi, [key]: e.target.value } });
  };
  const testWebhook = async () => {
    if (!mi.webhookUrl) { setHookStatus({ ok: false, msg: "No URL set" }); return; }
    setHookBusy(true); setHookStatus(null);
    try {
      const r = await fetch(mi.webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: `Manipula webhook test — ${mi.name || "(unnamed mod)"}` }),
      });
      setHookStatus({ ok: r.ok, msg: `${r.status} ${r.statusText || ""}`.trim() });
    } catch (e) {
      setHookStatus({ ok: false, msg: e.message || "fetch failed" });
    } finally { setHookBusy(false); }
  };
  return (
    <div className="screen">
      <h2>Mod Info</h2>
      <div className="card">
        <div className="field" style={{ alignItems: "center" }}>
          <span>Name</span>
          <input className="input" value={mi.name || ""} onChange={setMI("name")} style={{ flex: 1, minWidth: 240 }} />
        </div>
        <div className="field" style={{ alignItems: "center" }}>
          <span>Platform</span>
          <input className="input" value={mi.platform || ""} onChange={setMI("platform")} placeholder="e.g. RTW Vanilla / RTW Alex / RTR" style={{ flex: 1, minWidth: 240 }} />
        </div>
        <div className="field" style={{ alignItems: "center" }}>
          <span>Era</span>
          <input className="input" value={mi.era || ""} onChange={setMI("era")} placeholder="e.g. Imperial / Classical" style={{ flex: 1, minWidth: 240 }} />
        </div>
        <div className="field" style={{ alignItems: "center" }}>
          <span>Webhook URL</span>
          <input
            className="input"
            placeholder="https://discord.com/api/webhooks/…"
            value={mi.webhookUrl || ""}
            onChange={setMI("webhookUrl")}
            style={{ flex: 1, minWidth: 280 }}
            title="Posted to as {content: 'Manipula push — <message>'} on every successful push. Discord webhooks work directly; for Slack/Teams adapt the payload server-side."
          />
          <button className="btn" disabled={hookBusy || !mi.webhookUrl} onClick={testWebhook} style={{ marginLeft: 6 }}>
            {hookBusy ? "Testing…" : "Test"}
          </button>
        </div>
        {hookStatus && (
          <div className="field" style={{ alignItems: "center" }}>
            <span></span>
            <strong style={{ color: hookStatus.ok ? "var(--ok)" : "var(--err)" }}>
              {hookStatus.ok ? "✓ webhook delivered" : "✗ "}{hookStatus.msg}
            </strong>
          </div>
        )}
        <div className="field" style={{ alignItems: "center" }}>
          <span>Safety</span>
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "#cba" }}>
            <input
              type="checkbox"
              checked={!!mi.blockWriteOnError}
              onChange={(e) => setProject({ ...project, modInfo: { ...mi, blockWriteOnError: e.target.checked } })}
            />
            Block <strong style={{ color: "#dca64a" }}>Write to EDB</strong> when validation has errors
          </label>
        </div>
      </div>
      <h3 style={{ marginTop: 24 }}>Globals ({Object.keys(g).length})</h3>
      <DataTable
        columns={["Name", "Value"]}
        rows={Object.entries(g).sort(([a],[b]) => NATURAL_COLLATOR.compare(a, b)).map(([k, v]) => [k, v])}
        maxHeight="60vh"
        searchable
      />
    </div>
  );
}

// Hash a password to hex SHA-256 via Web Crypto. Used for the optional
// password gate on Core Data editing — the hash is stored in the
// project's manipula.project.json (modInfo.coreDataLockHash) so the
// project itself carries the lock and travels with git, but the
// password is never persisted in plaintext.
async function sha256Hex(text) {
  const buf = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", buf);
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, "0")).join("");
}

function CoreDataScreen({ project, setProject }) {
  const tables = project?.coreData || {};
  const names = Object.keys(tables);
  const [active, setActive] = useState(names[0] || null);
  // Lock state for editable mode. The project's modInfo carries the hash
  // (set on first lock), so a teammate cloning the repo inherits the gate.
  const lockHash = (project && project.modInfo && project.modInfo.coreDataLockHash) || null;
  const [unlocked, setUnlocked] = useState(false);
  const [pwPrompt, setPwPrompt] = useState(null);   // null | "set" | "verify"
  const [pwInput, setPwInput] = useState("");
  const [pwError, setPwError] = useState(null);

  // Defer early-returns until after every hook below has been called.
  // Same Rules-of-Hooks fix as UnitsScreen / ArmourScreen.
  const rows = tables[active] || [];
  // Order columns by union of keys in this table's rows so a sparse row
  // with missing keys doesn't drop the columns entirely.
  const columns = useMemo(() => {
    const s = new Set();
    for (const r of rows) for (const k of Object.keys(r)) s.add(k);
    return [...s];
  }, [rows]);

  const tryUnlock = async () => {
    setPwError(null);
    if (!pwInput) return;
    if (lockHash) {
      const h = await sha256Hex(pwInput);
      if (h === lockHash) {
        setUnlocked(true); setPwPrompt(null); setPwInput("");
      } else {
        setPwError("Wrong password.");
      }
    } else {
      // First-time set — hash and stash on the project.
      const h = await sha256Hex(pwInput);
      const nextProject = { ...project, modInfo: { ...(project.modInfo || {}), coreDataLockHash: h } };
      setProject(nextProject);
      setUnlocked(true); setPwPrompt(null); setPwInput("");
    }
  };

  const onEdit = useCallback((rowIdx, columnKey, newValue) => {
    if (!unlocked) return;
    const t = tables[active];
    if (!Array.isArray(t)) return;
    const cur = t[rowIdx];
    if (!cur) return;
    if (String(cur[columnKey] ?? "") === String(newValue ?? "")) return;
    const next = { ...cur };
    if (newValue === "" || newValue == null) delete next[columnKey];
    else next[columnKey] = newValue;
    const nextTable = t.slice(); nextTable[rowIdx] = next;
    setProject({ ...project, coreData: { ...tables, [active]: nextTable } });
  }, [unlocked, tables, active, project, setProject]);

  const addBlank = useCallback(() => {
    if (!unlocked) return;
    const t = tables[active] || [];
    // Seed a blank row using the first existing row's keys (so the column
    // shape stays consistent) — empty strings everywhere.
    const seed = t[0] ? Object.fromEntries(Object.keys(t[0]).map(k => [k, ""])) : {};
    setProject({ ...project, coreData: { ...tables, [active]: [...t, seed] } });
  }, [unlocked, tables, active, project, setProject]);
  const duplicateRow = useCallback((idx) => {
    if (!unlocked) return;
    const t = tables[active] || [];
    const cur = t[idx]; if (!cur) return;
    const copy = JSON.parse(JSON.stringify(cur));
    const next = t.slice(); next.splice(idx + 1, 0, copy);
    setProject({ ...project, coreData: { ...tables, [active]: next } });
  }, [unlocked, tables, active, project, setProject]);
  const deleteRow = useCallback((idx) => {
    if (!unlocked) return;
    const t = tables[active] || [];
    const next = t.slice(); next.splice(idx, 1);
    setProject({ ...project, coreData: { ...tables, [active]: next } });
  }, [unlocked, tables, active, project, setProject]);

  // Bulk operations on selected rows of the active core-data table.
  const bulkSetCoreData = useCallback((rowIdxs, column, value) => {
    if (!unlocked || !rowIdxs || !rowIdxs.length || !column) return;
    const t = tables[active] || [];
    const sel = new Set(rowIdxs);
    const next = t.map((r, i) => {
      if (!sel.has(i)) return r;
      const out = { ...r };
      if (value === "" || value == null) delete out[column];
      else out[column] = value;
      return out;
    });
    setProject({ ...project, coreData: { ...tables, [active]: next } });
  }, [unlocked, tables, active, project, setProject]);
  const bulkDeleteCoreData = useCallback((rowIdxs) => {
    if (!unlocked || !rowIdxs || !rowIdxs.length) return;
    if (!window.confirm(`Delete ${rowIdxs.length} selected row${rowIdxs.length === 1 ? "" : "s"} from "${active}"?`)) return;
    const t = tables[active] || [];
    const sel = new Set(rowIdxs);
    const next = t.filter((_, i) => !sel.has(i));
    setProject({ ...project, coreData: { ...tables, [active]: next } });
  }, [unlocked, tables, active, project, setProject]);
  const bulkDuplicateCoreData = useCallback((rowIdxs) => {
    if (!unlocked || !rowIdxs || !rowIdxs.length) return;
    const t = tables[active] || [];
    const sel = rowIdxs.slice().sort((a, b) => b - a);
    let next = t.slice();
    for (const idx of sel) {
      const cur = next[idx]; if (!cur) continue;
      const copy = JSON.parse(JSON.stringify(cur));
      next.splice(idx + 1, 0, copy);
    }
    setProject({ ...project, coreData: { ...tables, [active]: next } });
  }, [unlocked, tables, active, project, setProject]);

  // Add a brand-new core data table. Used when a teammate needs a
  // category set the xlsm didn't ship with — e.g. a new specialMounts
  // row. Tables are arrays of objects keyed by column name; we seed
  // the new one as an empty array so the user can add rows.
  const addNewTable = useCallback(() => {
    if (!unlocked) { window.alert("Unlock core-data editing first."); return; }
    const name = window.prompt("New table name (lowercase camelCase, e.g. 'specialFormations'):", "");
    if (!name) return;
    const safe = name.trim();
    if (!safe) return;
    if (tables[safe]) { window.alert(`Table "${safe}" already exists.`); return; }
    setProject({ ...project, coreData: { ...tables, [safe]: [] } });
    setActive(safe);
  }, [unlocked, tables, project, setProject]);

  // Now that all hooks have been called we can early-return safely.
  if (!project) return <EmptyScreen />;
  if (!active) return <div className="screen"><h2>Core Data</h2><p>No tables.</p></div>;

  return (
    <div className="screen">
      <h2 style={{ display: "flex", alignItems: "center", gap: 12 }}>
        Core Data
        {unlocked ? (
          <span style={{ fontSize: 11, color: "#7c9", border: "1px solid #7c9", padding: "2px 8px", borderRadius: 12, fontWeight: 400 }}>editing unlocked</span>
        ) : (
          <button
            className="btn"
            onClick={() => setPwPrompt(lockHash ? "verify" : "set")}
            style={{ marginLeft: 8 }}
            title={lockHash ? "Enter the team password to edit core data" : "Set a password to gate core-data edits for this project"}
          >🔒 {lockHash ? "Unlock for editing" : "Set lock + edit"}</button>
        )}
      </h2>

      {pwPrompt && (
        <div style={{ background: "#1c1c1c", border: "1px solid #3a3a3a", borderRadius: 6, padding: 12, marginBottom: 14, maxWidth: 420, display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ color: "#dca64a", fontSize: 12 }}>
            {pwPrompt === "set"
              ? "Set a password to gate Core Data edits for this project. Hashed and stored in manipula.project.json — teammates need to know it to edit."
              : "Enter the project's Core Data password."}
          </div>
          <input
            type="password"
            autoFocus
            value={pwInput}
            onChange={(e) => setPwInput(e.target.value)}
            onKeyDown={async (e) => { if (e.key === "Enter") await tryUnlock(); else if (e.key === "Escape") { setPwPrompt(null); setPwInput(""); setPwError(null); } }}
            style={{ background: "#0e0e0e", color: "#fff", border: "1px solid #3a3a3a", borderRadius: 4, padding: "6px 10px", fontFamily: "Consolas, monospace", outline: "none" }}
          />
          {pwError && <div style={{ color: "#d66c6c", fontSize: 11 }}>{pwError}</div>}
          <div style={{ display: "flex", gap: 8 }}>
            <button className="btn" onClick={tryUnlock}>{pwPrompt === "set" ? "Set" : "Unlock"}</button>
            <button className="btn" onClick={() => { setPwPrompt(null); setPwInput(""); setPwError(null); }}>Cancel</button>
          </div>
        </div>
      )}

      <div className="tabs">
        {names.map((n) => (
          <button
            key={n}
            className={`tab ${n === active ? "active" : ""}`}
            onClick={() => setActive(n)}
          >
            {n}
            <span className="tab-count"> ({tables[n].length})</span>
          </button>
        ))}
        {unlocked && (
          <button
            className="tab"
            onClick={addNewTable}
            style={{ color: "#7c9", borderStyle: "dashed" }}
            title="Add a new core-data table"
          >+ table</button>
        )}
      </div>
      <DataTable
        columns={columns}
        rows={rows.map((r) => columns.map((c) => r[c]))}
        rowIds={rows.map((_, i) => i)}
        searchPersistKey={`edu-coredata-${active}`}
        onEdit={onEdit}
        editable={unlocked}
        maxHeight="65vh"
        searchable
        onAddRow={unlocked ? addBlank : null}
        onDuplicateRow={unlocked ? duplicateRow : null}
        onDeleteRow={unlocked ? deleteRow : null}
        addRowLabel="+ New row"
        bulkActions={unlocked ? [
          { label: "Set field on selected…", setField: { onApply: bulkSetCoreData } },
          { label: "Duplicate selected", onClick: bulkDuplicateCoreData },
          { label: "Delete selected", destructive: true, onClick: bulkDeleteCoreData },
        ] : null}
      />
    </div>
  );
}

// Unit templates — sensible-default starting points for new units.
// Adding a new template here makes it appear in the "+ New from
// template" picker. Values are deliberately partial: only the columns
// where a default carries semantic meaning (Category, Quality,
// Recruitment) are set; everything else stays empty so the user sees
// the spec rows they need to fill in.
const UNIT_TEMPLATES = [
  {
    key: "light_infantry",
    label: "Light Infantry",
    seed: { Category: "Foot", Recruitment: "Standard", Specialty: "Standard", Entries: "Factional", "Wpn Quality": "1. Light", Formation: "Standard" },
  },
  {
    key: "heavy_infantry",
    label: "Heavy Infantry",
    seed: { Category: "Foot", Recruitment: "Standard", Specialty: "Very Hardy", Entries: "Factional", "Wpn Quality": "3. Heavy", Formation: "Standard" },
  },
  {
    key: "missile_infantry",
    label: "Missile Infantry",
    seed: { Category: "Foot Missile", Recruitment: "Standard", Specialty: "Missiles", Entries: "Factional", "Wpn Quality": "2. Medium", Formation: "Standard" },
  },
  {
    key: "spearmen",
    label: "Spearmen",
    seed: { Category: "Foot", Recruitment: "Standard", Specialty: "Standard", Entries: "Factional", Weapon: "Spear (overhand)", "Wpn Quality": "2. Medium" },
  },
  {
    key: "cavalry",
    label: "Light Cavalry",
    seed: { Category: "Mounted", Recruitment: "Standard", Specialty: "Standard", Entries: "Factional", "Wpn Quality": "2. Medium" },
  },
  {
    key: "heavy_cavalry",
    label: "Heavy Cavalry",
    seed: { Category: "Mounted", Recruitment: "Standard", Specialty: "Very Hardy", Entries: "Factional", "Wpn Quality": "3. Heavy" },
  },
  {
    key: "missile_cavalry",
    label: "Missile Cavalry",
    seed: { Category: "Mounted Missile", Recruitment: "Standard", Specialty: "Missiles", Entries: "Factional", "Wpn Quality": "2. Medium" },
  },
  {
    key: "general",
    label: "General",
    seed: { Category: "Mounted", Recruitment: "General", Specialty: "Very Hardy", Entries: "Factional", "Wpn Quality": "3. Heavy" },
  },
];

// Synthetic column-key prefixes. Real EDU column keys never contain a
// colon, so these can't collide with genuine fields.
//   AVAIL_PREFIX → expands the unit's `availability` object
//                  ({sparta:"Y", romans_julii:"Y", ...}) into one column
//                  per faction, in the canonical order from project.factions.
//   OWN_PREFIX   → splits the unit's `ownership` array into four "ownership_N"
//                  columns. Reading is array index; writing back updates the
//                  array and trims trailing empties.
const AVAIL_PREFIX = "avail:";
const OWN_PREFIX = "own:";

// Canonical column order for the EDU Units table — matches the layout the
// modteam expects (and that the EDU spreadsheet historically used). Columns
// not present in any actual unit are omitted; columns present but not in
// HEAD/TAIL fall through to the catch-all bucket at the end so nothing is
// silently dropped.
// Column order for the Units edit screen. Mirrors the EDUMatic
// UnitDefinitions sheet — identification first (name / id / dictionary
// / category / specialty), then the source fields that drive the
// emit-side EDU output in roughly the order they show up there
// (voice → model → officers → category-specific → flags → formation
// → weapons → armour → banners → priority). Per-faction availability
// columns are emitted separately, between HEAD and TAIL, by the screen.
// Anything not in HEAD/TAIL falls through to a catch-all bucket so we
// never silently drop a key.
const UNITS_HEAD = [
  "name", "Entries", "comments",
  "unit id", "dictionary_tag",
  "Category", "Specialty",
  "Recruitment", "Quality",
  "voice_type", "voice_indexes",
  "unit variation", "model id",
  "officer 1", "officer 2", "officer 3", "officer 4", "officer 5",
  "ship id", "engine id", "animal id", "mount id",
  "general unit", "merc unit", "horde unit", "unique unit",
  "impetuous unit", "no CBs",
  "Formation", "Dwelling", "Culture",
  "Weapon", "Wpn Quality", "Projectile", "Melee Skeleton",
  "pri missile type",
  "Sec Weapon", "S Wpn Quality", "S Melee Skeleton",
  "Engine", "Engine Pri Proj", "Engine Sec Proj",
  "engine missile type", "sec eng missile type",
  "Mount", "Special", "Mount Skeleton",
  "Ship",
  "Armour Upgr0", "Armour Upgr1", "Armour Upgr2", "Armour Upgr3",
  "arm upg mdl 1", "arm upg mdl 2", "arm upg mdl 3",
  "faction banner", "holy banner",
  "rec priority",
  "Tier", "Turns",
];
const UNITS_TAIL = [
  "ethnicity region", "ethnicity attributes",
  "tattoo colour", "hair colour", "hair style",
  "info pic dir", "card pic dir",
];

// Mirror of projectStore.js's sanitiseKey — used to derive the on-disk
// filename (and therefore the git path) for a given unit / armour
// record so we can look up its blame entry.
function unitFilePath(u, kind /* "unit" | "armour" */) {
  const candidates = [u && (u.Type || u.dictKey || u.unit || u.Faction || u.faction || u.name || u.Name || u["Model Set Name"])];
  let key = "";
  for (const c of candidates) {
    if (c != null && String(c).trim() !== "") { key = String(c); break; }
  }
  if (!key) return null;
  const safe = key.toLowerCase()
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, "_")
    .replace(/[\s.]+$/g, "")
    .slice(0, 120);
  if (!safe) return null;
  if (kind === "armour") return `edu/armour/${safe}.json`;
  return `edu/units/${safe}.json`;
}

function UnitsScreen({ project: rawProject, setProject, modDataDir, recruitUnits, lastImportedSnapshot, onJumpToRecruit, projectBlame }) {
  // Rules of Hooks: hooks must run in the same order on every render,
  // so we CAN'T early-return before them when project might transition
  // from null → loaded across renders (which previously corrupted React's
  // hook table and produced "Cannot access 'Ee' before initialization"
  // marble-window crashes). Shadow the prop with a safe fallback so all
  // hooks below see a valid shape; the real EmptyScreen render happens
  // at the bottom after every hook has been called.
  const project = rawProject || { units: [], factions: [], coreData: {}, armour: [], modInfo: {} };
  // Stable across renders unless the underlying array changed. Without
  // this, every render of UnitsScreen produced a new units[] reference,
  // cascading useMemo invalidation through allKeys → tableRows → rowFlags
  // → filteredTable on every keystroke.
  const units = useMemo(
    () => project.units.filter((u) => u.kind === "unit"),
    [project.units]
  );
  // Filter chips: faction (from availability) and category. Empty string
  // means "no filter on this axis." Stored as state local to the screen.
  const [filterFaction, setFilterFaction] = useState("");
  const [filterCategory, setFilterCategory] = useState("");
  // Last-selected rowIds (= project.units indices) so the preview pane
  // shows live computed cost / upkeep / armour for the user's selection.
  const [selectedRowIdxs, setSelectedRowIdxs] = useState([]);
  // Faction order from project.factions — the index in this array IS the
  // faction id used by the underlying VBA / EDU pipeline.
  const factionKeys = useMemo(() => {
    const arr = Array.isArray(project.factions) ? project.factions : [];
    return arr.map(f => typeof f === "string" ? f : (f && (f.Faction || f.faction || f.name || f.Name) || "")).filter(Boolean);
  }, [project.factions]);
  // Build the column order: explicit HEAD list, then per-faction availability
  // columns + slave, then 4 ownership_N columns, then TAIL list, then any
  // remaining unrecognised keys at the end so we never silently drop one.
  const allKeys = useMemo(() => {
    const present = new Set();
    let hasAvailability = false;
    let hasOwnership = false;
    for (const u of units) {
      for (const k of Object.keys(u)) {
        if (k === "kind" || k === "row") continue;
        if (k === "availability") { hasAvailability = true; continue; }
        if (k === "ownership") { hasOwnership = true; continue; }
        present.add(k);
      }
    }
    const ordered = [];
    for (const k of UNITS_HEAD) if (present.has(k)) { ordered.push(k); present.delete(k); }
    if (hasAvailability) {
      for (const f of factionKeys) ordered.push(AVAIL_PREFIX + f);
      ordered.push(AVAIL_PREFIX + "slave");
    }
    if (hasOwnership) for (let i = 0; i < 4; i++) ordered.push(OWN_PREFIX + i);
    for (const k of UNITS_TAIL) if (present.has(k)) { ordered.push(k); present.delete(k); }
    for (const k of present) ordered.push(k);
    return ordered;
  }, [units, factionKeys]);

  // Build per-column edit metadata. Lookup columns become dropdowns sourced
  // from the project's coreData tables; the dropdown options are the first
  // column of each table (the canonical id). Free-text fields fall through
  // to a plain input. The "Entries" column is enum but its values aren't in
  // coreData — so we synthesize options from the data itself.
  const columnMeta = useMemo(() => {
    const meta = {};
    const cd = project.coreData || {};
    const idsOf = (tableName) => {
      const t = cd[tableName];
      if (!Array.isArray(t) || t.length === 0) return [];
      const idKey = Object.keys(t[0])[0];
      const out = [];
      const seen = new Set();
      for (const row of t) {
        const v = row[idKey];
        if (v == null || v === "") continue;
        const s = String(v);
        if (seen.has(s)) continue;
        seen.add(s);
        out.push(s);
      }
      return out;
    };
    // header-name → coreData table key
    const COLUMN_TO_TABLE = {
      "Recruitment":      "recruitmentClasses",
      "Quality":          "qualityClasses",
      "Category":         "categories",
      "Specialty":        "specialties",
      "Formation":        "formations",
      "Dwelling":         "dwellings",
      "Culture":          "cultures",
      "Weapon":           "weapons",
      "Wpn Quality":      "weaponQualities",
      "Projectile":       "projectiles",
      "Melee Skeleton":   "meleeSkeletons",
      "Sec Weapon":       "weapons",
      "S Wpn Quality":    "weaponQualities",
      "S Melee Skeleton": "meleeSkeletons",
      "Mount":            "mounts",
      "Special":          "specialMounts",
      "Mount Skeleton":   "mountSkeletons",
      "Engine":           "engines",
      "Engine Pri Proj":  "engineProjectiles",
      "Engine Sec Proj":  "engineProjectiles",
      "Ship":             "ships",
    };
    for (const [col, tbl] of Object.entries(COLUMN_TO_TABLE)) {
      const opts = idsOf(tbl);
      if (opts.length) meta[col] = { type: "select", options: opts };
    }
    // Armour upgrades — pulled from the user's Armour Definitions sheet, not
    // coreData. The "Model Set Name" column is what gets referenced from a
    // unit's Armour Upgr0..3 fields. (Note: Object.keys(armour[0])[0] is "row",
    // an internal ordering field, not the id we want — use the explicit key.)
    if (Array.isArray(project.armour) && project.armour.length) {
      const opts = [...new Set(
        project.armour.map((r) => r["Model Set Name"]).filter((v) => v && !String(v).startsWith("#")).map(String)
      )];
      for (const c of ["Armour Upgr0", "Armour Upgr1", "Armour Upgr2", "Armour Upgr3"]) {
        if (allKeys.includes(c)) meta[c] = { type: "select", options: opts };
      }
    }
    // Entries — enum derived from the existing data (Factional / AOR / Merc /
    // Horde combinations). Listing in roughly canonical order.
    if (allKeys.includes("Entries")) {
      const seen = new Set();
      for (const u of units) {
        const v = u["Entries"];
        if (v) seen.add(String(v));
      }
      const canonical = [
        "Factional", "AoR", "Merc", "Horde",
        "Factional + AoR", "Factional + Merc", "Factional + Horde",
        "Factional + AoR + Merc", "Factional + AoR + Horde",
        "Factional + Merc + Horde", "Factional + AoR + Merc + Horde",
        "AoR + Merc",
      ];
      const opts = [...new Set([...canonical.filter((c) => seen.has(c)), ...seen])];
      meta["Entries"] = { type: "select", options: opts };
    }
    // Per-faction availability columns are Y/blank toggles.
    for (const f of factionKeys) {
      meta[AVAIL_PREFIX + f] = { type: "select", options: ["", "Y"] };
    }
    meta[AVAIL_PREFIX + "slave"] = { type: "select", options: ["", "Y"] };
    // Other free-text columns get a plain text editor by default — no entry
    // in `meta` is needed for that, the table treats unknown columns as text.
    return meta;
  }, [project.coreData, project.armour, allKeys, units, factionKeys]);

  // Display labels:
  //   - "name" header reads "Unit Name" (matches the EDU spreadsheet).
  //   - avail:<faction> columns are labelled with the faction's name from
  //     project.factions (the same list the Mod Info pulls from). The
  //     index-only "faction 1..N" labels were unreadable when the user
  //     just wanted to know which column is `romans_julii`.
  //   - own:<i> columns labeled "ownership_1 .. ownership_4".
  const columnLabels = useMemo(() => {
    const out = { name: "Unit Name" };
    factionKeys.forEach((f) => { out[AVAIL_PREFIX + f] = f; });
    out[AVAIL_PREFIX + "slave"] = "slave";
    for (let i = 0; i < 4; i++) out[OWN_PREFIX + i] = `ownership_${i + 1}`;
    return out;
  }, [factionKeys]);

  // Walk the original units list (including kind:"comment" markers) to interleave
  // section dividers between faction blocks. We track each row's index in the
  // source `project.units` array so cell edits map back to the right object
  // regardless of how DataTable later filters by search.
  const { rows: tableRows, rowIds } = useMemo(() => {
    const rows = [];
    const ids = [];
    for (let idx = 0; idx < project.units.length; idx++) {
      const u = project.units[idx];
      if (u.kind === "comment") {
        const t = String(u.text || "").trim();
        if (!t) continue;
        rows.push({ section: t });
        ids.push(-1);
      } else if (u.kind === "unit") {
        rows.push(allKeys.map((k) => {
          if (k.startsWith(AVAIL_PREFIX)) {
            const f = k.slice(AVAIL_PREFIX.length);
            return (u.availability && u.availability[f]) || "";
          }
          if (k.startsWith(OWN_PREFIX)) {
            const i = parseInt(k.slice(OWN_PREFIX.length), 10);
            return (Array.isArray(u.ownership) && u.ownership[i]) || "";
          }
          return u[k];
        }));
        ids.push(idx);
      }
    }
    while (rows.length && rows[0] && !Array.isArray(rows[0])) { rows.shift(); ids.shift(); }
    while (rows.length && rows[rows.length - 1] && !Array.isArray(rows[rows.length - 1])) { rows.pop(); ids.pop(); }
    return { rows, rowIds: ids };
  }, [project.units, allKeys]);

  // Row mutators — add/duplicate/insert/delete on the project.units array.
  // All operate on raw indices into project.units (NOT filtered table rows);
  // the DataTable resolves rowOrigIdx → rowIds[rowOrigIdx] before calling
  // these so we always get a true source-array index.
  //
  // New units also try to drop a matching stub block into the mod's
  // text/export_units.txt — RTW reads the unit's display strings from
  // there, so a freshly-added EDU row without an export_units entry
  // shows up in-game as raw key text. The IPC handler is idempotent on
  // the unit key, so re-firing for an existing key is a safe no-op.
  const stubInExportUnits = useCallback(async (unit) => {
    if (!modDataDir || !window.eduAPI?.appendExportUnitsStub) return;
    // Prefer dictionary_tag — RTW reads display strings from export_units
    // keyed by dictionary tag (with underscores), not by the unit id.
    const key = unit && (unit["dictionary_tag"] || unit["unit id"] || unit.name);
    if (!key) return;
    const display = unit && (unit.name || key);
    try {
      const r = await window.eduAPI.appendExportUnitsStub(modDataDir, String(key), String(display));
      if (!r || !r.ok) console.warn("[edu] export_units stub failed:", r && r.reason);
    } catch (e) { console.warn("[edu] export_units stub threw:", e.message); }
  }, [modDataDir]);

  // New units land at the TOP of project.units (index 0) rather than at
  // the end. With ~800 existing rows, appending hides the new unit far
  // below the user's viewport and looks like the action did nothing.
  // Prepending makes the new row the first thing they see post-add.
  const addBlankUnit = useCallback(() => {
    const blank = { kind: "unit", row: 0, name: "" };
    setProject({ ...project, units: [blank, ...project.units] });
  }, [project, setProject]);
  const addUnitFromTemplate = useCallback((tplKey) => {
    const tpl = UNIT_TEMPLATES.find(t => t.key === tplKey);
    if (!tpl) return null;
    // Slugify the template label for an immediate dictionary_tag /
    // unit id default so the new row doesn't validate-fail with
    // "Duplicate (empty)" right away. User can rewrite to taste.
    const slug = String(`new ${tpl.label}`).toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "");
    const seed = { kind: "unit", row: 0, name: `New ${tpl.label}`, "dictionary_tag": slug, "unit id": slug.replace(/_/g, " "), ...tpl.seed };
    setProject({ ...project, units: [seed, ...project.units] });
    return seed.name;
  }, [project, setProject]);
  // Template-picker popover state. Native <select> was controlled to ""
  // so the user got no visual feedback when picking an item — looked
  // like the menu did nothing even though the unit was being added.
  // Button-with-explicit-popover is unambiguous: click → list → click
  // one → menu closes → new unit appears at the top of the table.
  const [tplPickerOpen, setTplPickerOpen] = useState(false);
  const duplicateUnit = useCallback((unitIdx) => {
    if (typeof unitIdx !== "number" || unitIdx < 0) return;
    const cur = project.units[unitIdx];
    if (!cur || cur.kind !== "unit") return;
    const copy = JSON.parse(JSON.stringify(cur));
    if (copy.name) copy.name = copy.name + " (copy)";
    if (copy["unit id"]) copy["unit id"] = "";       // dedupe required scalar fields
    if (copy["dictionary_tag"]) copy["dictionary_tag"] = "";
    const nextUnits = project.units.slice();
    nextUnits.splice(unitIdx + 1, 0, copy);
    setProject({ ...project, units: nextUnits });
  }, [project, setProject]);
  const insertBlankUnitBelow = useCallback((unitIdx) => {
    if (typeof unitIdx !== "number" || unitIdx < 0) return;
    const blank = { kind: "unit", row: 0, name: "" };
    const nextUnits = project.units.slice();
    nextUnits.splice(unitIdx + 1, 0, blank);
    setProject({ ...project, units: nextUnits });
  }, [project, setProject]);
  const insertBlankUnitAbove = useCallback((unitIdx) => {
    if (typeof unitIdx !== "number" || unitIdx < 0) return;
    const blank = { kind: "unit", row: 0, name: "" };
    const nextUnits = project.units.slice();
    nextUnits.splice(unitIdx, 0, blank);
    setProject({ ...project, units: nextUnits });
  }, [project, setProject]);
  const insertSectionHeader = useCallback((unitIdx, position /* "above" | "below" */) => {
    const text = (window.prompt("Section header text:", "NEW SECTION") || "").trim();
    if (!text) return;
    const marker = { kind: "comment", text };
    const nextUnits = project.units.slice();
    if (typeof unitIdx === "number" && unitIdx >= 0) {
      const at = position === "below" ? unitIdx + 1 : unitIdx;
      nextUnits.splice(at, 0, marker);
    } else {
      nextUnits.unshift(marker);
    }
    setProject({ ...project, units: nextUnits });
  }, [project, setProject]);
  // Replace a unit's record from a clipboard-pasted JSON. Preserves
  // kind / row to avoid corrupting the project shape; everything else
  // structural-replaces.
  const onPasteUnit = useCallback((unitIdx, parsed) => {
    if (typeof unitIdx !== "number" || unitIdx < 0) return;
    if (!parsed || typeof parsed !== "object") return;
    const cur = project.units[unitIdx];
    if (!cur) return;
    const next = { ...parsed, kind: cur.kind || "unit", row: cur.row != null ? cur.row : 0 };
    const nextUnits = project.units.slice();
    nextUnits[unitIdx] = next;
    setProject({ ...project, units: nextUnits });
  }, [project, setProject]);
  // Move a row up or down within project.units. Skips section/comment
  // rows so the move feels like a 1-row jump in the visible table even
  // when the underlying array has interleaved comment markers.
  const moveUnit = useCallback((unitIdx, dir /* "up" | "down" */) => {
    if (typeof unitIdx !== "number" || unitIdx < 0) return;
    const arr = project.units;
    if (unitIdx >= arr.length) return;
    const step = dir === "up" ? -1 : 1;
    let target = unitIdx + step;
    while (target >= 0 && target < arr.length && arr[target] && arr[target].kind !== "unit") target += step;
    if (target < 0 || target >= arr.length) return;
    const next = arr.slice();
    [next[unitIdx], next[target]] = [next[target], next[unitIdx]];
    setProject({ ...project, units: next });
  }, [project, setProject]);
  // Drag-and-drop multi-row reorder. srcIds + targetId are indices into
  // project.units (DataTable passes raw rowIds back unchanged). Position
  // is "above" or "below" relative to the target. Preserves the relative
  // order of dragged rows; section/comment markers stay where they are.
  const onMoveRowsUnits = useCallback((srcIds, targetId, position) => {
    if (!Array.isArray(srcIds) || srcIds.length === 0) return;
    const arr = project.units;
    const srcSet = new Set(srcIds);
    if (srcSet.has(targetId)) return;
    // Preserve original relative order of moved rows.
    const moved = srcIds.slice().sort((a, b) => a - b).map((i) => arr[i]).filter(Boolean);
    const filtered = [];
    let targetPos = -1;
    for (let i = 0; i < arr.length; i++) {
      if (srcSet.has(i)) continue;
      if (i === targetId) targetPos = filtered.length;
      filtered.push(arr[i]);
    }
    if (targetPos < 0) return;
    const insertAt = position === "above" ? targetPos : targetPos + 1;
    filtered.splice(insertAt, 0, ...moved);
    setProject({ ...project, units: filtered });
  }, [project, setProject]);
  const deleteUnit = useCallback((unitIdx) => {
    if (typeof unitIdx !== "number" || unitIdx < 0) return;
    const nextUnits = project.units.slice();
    nextUnits.splice(unitIdx, 1);
    setProject({ ...project, units: nextUnits });
  }, [project, setProject]);

  const onEdit = useCallback((unitIdx, columnKey, newValue) => {
    if (typeof unitIdx !== "number" || unitIdx < 0) return;
    const cur = project.units[unitIdx];
    if (!cur || cur.kind !== "unit") return;
    // Synthetic per-faction availability column: write into the nested
    // availability dict instead of as a top-level field. Empty value
    // deletes the faction's entry entirely so the JSON stays compact.
    if (typeof columnKey === "string" && columnKey.startsWith(AVAIL_PREFIX)) {
      const f = columnKey.slice(AVAIL_PREFIX.length);
      const curAvail = (cur.availability && cur.availability[f]) || "";
      if (curAvail === (newValue || "")) return;
      const nextAvail = { ...(cur.availability || {}) };
      if (newValue === "" || newValue == null) delete nextAvail[f];
      else nextAvail[f] = newValue;
      // Re-derive factionalOwnership from the Y cells. Order follows
      // factionKeys (i.e. project.factions order) with slave at the end
      // — matches the order the EDU spreadsheet exported.
      const ownList = factionKeys.filter((k) => nextAvail[k] === "Y");
      if (nextAvail.slave === "Y") ownList.push("slave");
      const next = { ...cur, availability: nextAvail, factionalOwnership: ownList.join(", ") };
      const nextUnits = project.units.slice();
      nextUnits[unitIdx] = next;
      setProject({ ...project, units: nextUnits });
      return;
    }
    // Synthetic ownership column: write into the array slot, trim trailing
    // empties so the persisted JSON doesn't carry [..., "", "", ""] noise.
    if (typeof columnKey === "string" && columnKey.startsWith(OWN_PREFIX)) {
      const i = parseInt(columnKey.slice(OWN_PREFIX.length), 10);
      const curOwn = (Array.isArray(cur.ownership) && cur.ownership[i]) || "";
      if (curOwn === (newValue || "")) return;
      const nextOwn = Array.isArray(cur.ownership) ? cur.ownership.slice() : [];
      while (nextOwn.length <= i) nextOwn.push("");
      nextOwn[i] = newValue || "";
      while (nextOwn.length && !nextOwn[nextOwn.length - 1]) nextOwn.pop();
      const next = { ...cur, ownership: nextOwn };
      const nextUnits = project.units.slice();
      nextUnits[unitIdx] = next;
      setProject({ ...project, units: nextUnits });
      return;
    }
    if (String(cur[columnKey] ?? "") === String(newValue ?? "")) return; // no-op
    const next = { ...cur };
    if (newValue === "" || newValue == null) delete next[columnKey];
    else next[columnKey] = newValue;
    const nextUnits = project.units.slice();
    nextUnits[unitIdx] = next;
    setProject({ ...project, units: nextUnits });
  }, [project, setProject]);

  // Per-row validation flags. validate(project) walks 800+ units and
  // takes ~200-500ms on a real project — too expensive to run on every
  // keystroke. Debounce to 600ms after the last project change so the
  // user can edit / bulk-modify without the UI thread freezing. The
  // stale flags between edits are acceptable; once they stop typing
  // for half a second the dots refresh.
  const [validationByName, setValidationByName] = useState(() => new Map());
  useEffect(() => {
    let cancelled = false;
    const id = setTimeout(() => {
      if (cancelled) return;
      try {
        const out = new Map();
        for (const e of validate(project)) {
          if (!e.unit || e.unit.startsWith("<")) continue;
          if (!out.has(e.unit)) out.set(e.unit, { error: e.message, warn: null });
          else if (!out.get(e.unit).error) out.get(e.unit).error = e.message;
        }
        for (const e of diagnose(project)) {
          if (!e.unit || e.unit.startsWith("<")) continue;
          if (!out.has(e.unit)) out.set(e.unit, { error: null, warn: e.message });
          else if (!out.get(e.unit).warn) out.get(e.unit).warn = e.message;
        }
        if (!cancelled) setValidationByName(out);
      } catch (err) { console.warn("[edu] validate failed:", err && err.message); }
    }, 600);
    return () => { cancelled = true; clearTimeout(id); };
  }, [project]);

  // Recruit-line index — quick lookup from EDU "unit id" / dictionary
  // tag / name to the recruit-line authoring records that target the
  // same unit. Drives the "linked recruit-lines" tooltip and the
  // jump-to-recruit context menu item.
  const recruitsByKey = useMemo(() => {
    const out = new Map();
    if (!Array.isArray(recruitUnits)) return out;
    for (const r of recruitUnits) {
      const key = (r.unit || "").trim();
      if (!key) continue;
      const arr = out.get(key) || [];
      arr.push(r);
      out.set(key, arr);
    }
    return out;
  }, [recruitUnits]);

  // Re-import diff. lastImportedSnapshot maps canonical-unit-key → a
  // *djb2 hash* of the unit at import time (not the full JSON). Compare
  // the current unit's hash against the stored one to detect drift in
  // O(1) per unit instead of O(N) for a JSON.stringify each render.
  // Also debounced — comparing 800 units' hashes still adds up under
  // bulk-edit fire, and the result only feeds an inline visual hint.
  const [importDiffByIdx, setImportDiffByIdx] = useState(() => new Map());
  useEffect(() => {
    if (!lastImportedSnapshot) { setImportDiffByIdx(new Map()); return; }
    let cancelled = false;
    const id = setTimeout(() => {
      if (cancelled) return;
      const out = new Map();
      for (let i = 0; i < project.units.length; i++) {
        const u = project.units[i];
        if (!u || u.kind !== "unit") continue;
        const key = String(u["unit id"] || u.dictionary_tag || u.name || "").trim();
        if (!key) continue;
        const prev = lastImportedSnapshot[key];
        if (prev == null) continue;            // new unit since import
        // Cheap djb2 hash inlined here so the loop body stays tight.
        let h = 5381;
        try {
          const s = JSON.stringify(u);
          for (let j = 0; j < s.length; j++) h = ((h << 5) + h + s.charCodeAt(j)) | 0;
        } catch { continue; }
        const hex = (h >>> 0).toString(16);
        if (hex !== prev) out.set(i, "modified since last xlsm import");
      }
      if (!cancelled) setImportDiffByIdx(out);
    }, 600);
    return () => { cancelled = true; clearTimeout(id); };
  }, [project.units, lastImportedSnapshot]);

  // rowFlags keyed by rowId (= original index in project.units, per
  // UnitsScreen's rowIds construction). Severity tiers: error > warn >
  // info ("modified-since-import" lives at the info tier — it's a state
  // signal, not a problem, but the user wants to see it inline).
  const rowFlags = useMemo(() => {
    const out = {};
    for (let idx = 0; idx < project.units.length; idx++) {
      const u = project.units[idx];
      if (!u || u.kind !== "unit") continue;
      const f = validationByName.get(u.name) || {};
      const importNote = importDiffByIdx.get(idx);
      if (importNote) f.info = importNote;
      // Recruit-line linkage hint — encoded into the flag tooltip so
      // hovering the Unit Name cell shows a quick summary.
      const rec = recruitsByKey.get(u["unit id"]) || recruitsByKey.get(u.name);
      if (rec && rec.length) {
        const factions = new Set();
        for (const r of rec) for (const fac of (r.factions || [])) factions.add(fac);
        f.recruitNote = `Linked to ${rec.length} recruit-line entr${rec.length === 1 ? "y" : "ies"}` +
          (factions.size ? ` · factions: ${[...factions].slice(0, 5).join(", ")}${factions.size > 5 ? "…" : ""}` : "");
      }
      // Per-row git blame — "last edited by X (3h ago)". Looked up via
      // the bulk-blame Map from App.js; key is the unit's projected
      // on-disk file path (must match what projectStore.js writes).
      if (projectBlame && projectBlame.size) {
        const fp = unitFilePath(u, "unit");
        const blame = fp ? projectBlame.get(fp.toLowerCase()) : null;
        if (blame) f.blame = `${blame.author} · ${blame.age}`;
      }
      if (f.error || f.warn || f.info || f.recruitNote || f.blame) out[idx] = f;
    }
    return out;
  }, [project.units, validationByName, importDiffByIdx, recruitsByKey, projectBlame]);

  // Filter chips. We narrow the table by patching tableRows + rowIds
  // through filters before passing them to DataTable. Search-bar text
  // (inside DataTable) layers on top of this.
  const categoryOptions = useMemo(() => {
    const s = new Set();
    for (const u of units) if (u.Category) s.add(u.Category);
    return [...s].sort();
  }, [units]);
  const filteredTable = useMemo(() => {
    if (!filterFaction && !filterCategory) return { rows: tableRows, rowIds };
    const rows = []; const ids = [];
    for (let i = 0; i < tableRows.length; i++) {
      const r = tableRows[i];
      const id = rowIds[i];
      if (!Array.isArray(r)) { rows.push(r); ids.push(id); continue; }
      const u = project.units[id];
      if (!u || u.kind !== "unit") continue;
      if (filterCategory && u.Category !== filterCategory) continue;
      if (filterFaction && (!u.availability || u.availability[filterFaction] !== "Y")) continue;
      rows.push(r); ids.push(id);
    }
    return { rows, rowIds: ids };
  }, [tableRows, rowIds, filterFaction, filterCategory, project.units]);

  // Bulk-set field for selected rows. The button opens an inline picker
  // that lets the user choose a column then a value, then applies the
  // value to every selected unit's matching field. Avoids the user
  // having to click 30 cells one-by-one to set Category=Foot Missile.
  const [bulkColumn, setBulkColumn] = useState(null);
  const [bulkValue, setBulkValue] = useState("");
  const applyBulk = useCallback((rowIds, column, value) => {
    if (!rowIds || !rowIds.length || !column) return;
    const selSet = new Set(rowIds);
    const nextUnits = project.units.slice();
    for (let i = 0; i < nextUnits.length; i++) {
      if (!selSet.has(i)) continue;
      const cur = nextUnits[i];
      if (!cur || cur.kind !== "unit") continue;
      const next = { ...cur };
      if (value === "" || value == null) delete next[column];
      else next[column] = value;
      nextUnits[i] = next;
    }
    setProject({ ...project, units: nextUnits });
  }, [project, setProject]);
  const bulkDelete = useCallback((rowIds) => {
    if (!rowIds || !rowIds.length) return;
    if (!window.confirm(`Delete ${rowIds.length} selected unit${rowIds.length === 1 ? "" : "s"}?`)) return;
    const selSet = new Set(rowIds);
    const nextUnits = project.units.filter((_, i) => !selSet.has(i));
    setProject({ ...project, units: nextUnits });
  }, [project, setProject]);

  // Find/Replace across visible rows in the active column. Replaces
  // case-sensitively across all string-valued cells whose column key
  // matches the current bulkColumn (defaults to "name" if none picked
  // yet). Cheap implementation; can broaden later.
  const onReplaceAll = useCallback((rowIds, find, replace) => {
    if (!find || !rowIds || !rowIds.length) return;
    const col = bulkColumn || "name";
    const selSet = new Set(rowIds);
    let changed = 0;
    const nextUnits = project.units.map((u, i) => {
      if (!selSet.has(i)) return u;
      if (!u || u.kind !== "unit") return u;
      const v = u[col];
      if (typeof v !== "string" || !v.includes(find)) return u;
      changed++;
      return { ...u, [col]: v.split(find).join(replace) };
    });
    if (!changed) return;
    setProject({ ...project, units: nextUnits });
  }, [bulkColumn, project, setProject]);

  // Now that all hooks have been called we can safely early-return for
  // the no-project state — bottom-of-function is the only place an
  // early-return is allowed without violating Rules of Hooks.
  if (!rawProject) return <EmptyScreen />;

  return (
    <div className="screen">
      <h2>Units <span className="dim">({units.length})</span></h2>
      <p className="dim" style={{ marginTop: -6, marginBottom: 8, fontSize: 12 }}>
        Click any cell to edit. Lookup fields (Category, Quality, Weapon, …) open as dropdowns. Ctrl/Shift-click rows to multi-select. Right-click for row ops.
      </p>
      <CostPreviewPane project={project} selectedIdxs={selectedRowIdxs} />
      {/* Filter chips: quick faction / category narrowing. The columns
          picker still narrows columns; these narrow rows. */}
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8, flexWrap: "wrap" }}>
        <span style={{ fontSize: 11, color: "#999" }}>Filter:</span>
        <select
          value={filterFaction}
          onChange={(e) => setFilterFaction(e.target.value)}
          className="input"
          style={{ minWidth: 160 }}
          title="Show only units recruitable for this faction"
        >
          <option value="">— any faction —</option>
          {factionKeys.map((f, i) => <option key={f} value={f}>faction {i + 1}: {f}</option>)}
        </select>
        <select
          value={filterCategory}
          onChange={(e) => setFilterCategory(e.target.value)}
          className="input"
          style={{ minWidth: 140 }}
          title="Show only units of this Category"
        >
          <option value="">— any category —</option>
          {categoryOptions.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        {(filterFaction || filterCategory) && (
          <button
            className="btn"
            onClick={() => { setFilterFaction(""); setFilterCategory(""); }}
          >clear filters</button>
        )}
        <span style={{ flex: 1 }} />
        <button
          className="btn"
          onClick={() => insertSectionHeader(null, "above")}
          title="Insert a section header line at the top of the table (e.g. MID-REPUBLICAN ROMANS). For mid-list placement, right-click any row → Insert section header above/below."
        >+ Section header</button>
        <div style={{ position: "relative" }}>
          <button
            className="btn"
            onClick={() => setTplPickerOpen(o => !o)}
            title="Insert a new unit pre-populated from a template"
          >+ New from template ▾</button>
          {tplPickerOpen && (
            <>
              {/* Click-outside backdrop. Lower z than the menu so menu
                  clicks fire normally. */}
              <div
                style={{ position: "fixed", inset: 0, zIndex: 999 }}
                onClick={() => setTplPickerOpen(false)}
              />
              <div
                style={{
                  position: "absolute", top: "calc(100% + 4px)", right: 0,
                  background: "#1c1c1c", border: "1px solid #3a3a3a", borderRadius: 6,
                  padding: 4, minWidth: 200, zIndex: 1000,
                  boxShadow: "0 8px 24px rgba(0,0,0,0.6)",
                }}
              >
                {UNIT_TEMPLATES.map(t => (
                  <div
                    key={t.key}
                    style={{ padding: "6px 12px", cursor: "pointer", borderRadius: 4, color: "#ddd", fontSize: 12 }}
                    onMouseEnter={(e) => e.currentTarget.style.background = "rgba(220,166,74,0.18)"}
                    onMouseLeave={(e) => e.currentTarget.style.background = "transparent"}
                    onClick={() => { addUnitFromTemplate(t.key); setTplPickerOpen(false); }}
                  >{t.label}</div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
      <DataTable
        columns={allKeys}
        rows={filteredTable.rows}
        rowIds={filteredTable.rowIds}
        columnMeta={columnMeta}
        columnLabels={columnLabels}
        onEdit={onEdit}
        editable
        pinFirstColumn
        searchable
        findReplace
        onReplaceAll={onReplaceAll}
        columnsToggleable
        rowFlags={rowFlags}
        onAddRow={addBlankUnit}
        onDuplicateRow={duplicateUnit}
        onInsertRowBelow={insertBlankUnitBelow}
        onDeleteRow={deleteUnit}
        onMoveRows={onMoveRowsUnits}
        addRowLabel="+ New unit"
        searchPersistKey="edu-units"
        rowToJSON={(idx) => project.units[idx] || null}
        onPasteRow={onPasteUnit}
        onSelectionChange={setSelectedRowIdxs}
        rowMenuExtras={[
          { label: "↑ Move row up", onClick: (idx) => moveUnit(idx, "up") },
          { label: "↓ Move row down", onClick: (idx) => moveUnit(idx, "down") },
          { label: "Insert blank above", onClick: (idx) => insertBlankUnitAbove(idx) },
          { label: "Insert section header above…", onClick: (idx) => insertSectionHeader(idx, "above") },
          { label: "Insert section header below…", onClick: (idx) => insertSectionHeader(idx, "below") },
          ...(modDataDir ? [{
            label: "Stub in export_units.txt",
            onClick: (idx) => { const u = project.units[idx]; if (u) stubInExportUnits(u); },
          }] : []),
          ...(onJumpToRecruit ? [{
            label: "Jump to recruit-line entry",
            onClick: (idx) => {
              const u = project.units[idx];
              const key = u && (u["unit id"] || u.dictionary_tag || u.name);
              const rec = key && (recruitsByKey.get(key) || recruitsByKey.get(u.name));
              if (rec && rec.length && rec[0].id) onJumpToRecruit(rec[0].id);
            },
          }] : []),
        ]}
        bulkActions={[
          {
            label: "Set field on selected…",
            setField: { onApply: (rowIds, col, val) => { setBulkColumn(col); setBulkValue(val); applyBulk(rowIds, col, val); } },
          },
          {
            label: "Duplicate selected",
            onClick: (rowIds) => {
              if (!rowIds.length) return;
              const sorted = rowIds.slice().sort((a, b) => b - a);
              let next = project.units.slice();
              for (const idx of sorted) {
                const cur = next[idx];
                if (!cur || cur.kind !== "unit") continue;
                const copy = JSON.parse(JSON.stringify(cur));
                if (copy.name) copy.name = copy.name + " (copy)";
                if (copy["unit id"]) copy["unit id"] = "";
                if (copy["dictionary_tag"]) copy["dictionary_tag"] = "";
                next.splice(idx + 1, 0, copy);
              }
              setProject({ ...project, units: next });
            },
          },
          {
            label: "Copy as TSV",
            title: "Copy the selected units as tab-separated rows (paste into Excel / Google Sheets)",
            onClick: async (rowIds) => {
              const sorted = rowIds.slice().sort((a, b) => a - b);
              const header = allKeys.map(k => columnLabels[k] || k).join("\t");
              const lines = [header];
              for (const i of sorted) {
                const u = project.units[i];
                if (!u || u.kind !== "unit") continue;
                lines.push(allKeys.map(k => {
                  if (k.startsWith(AVAIL_PREFIX)) {
                    const f = k.slice(AVAIL_PREFIX.length);
                    return (u.availability && u.availability[f]) || "";
                  }
                  if (k.startsWith(OWN_PREFIX)) {
                    const j = parseInt(k.slice(OWN_PREFIX.length), 10);
                    return (Array.isArray(u.ownership) && u.ownership[j]) || "";
                  }
                  const v = u[k];
                  return v == null ? "" : String(v).replace(/\t/g, " ").replace(/\r?\n/g, " ");
                }).join("\t"));
              }
              try {
                await navigator.clipboard.writeText(lines.join("\n"));
              } catch (e) { console.warn("[edu] clipboard write failed:", e.message); }
            },
          },
          { label: "Delete selected", destructive: true, onClick: bulkDelete },
        ]}
      />
    </div>
  );
}

// BulkEditScreen — filter EDU rows by any string field, then apply set/add/multiply/append
// to a chosen field across all matched rows. Shows a live preview of the affected rows.
function BulkEditScreen({ project: rawProject, setProject }) {
  const [filterField, setFilterField] = useState("");
  const [filterMatch, setFilterMatch] = useState("");
  const [editField, setEditField] = useState("");
  const [op, setOp] = useState("set");
  const [value, setValue] = useState("");
  // Same Rules-of-Hooks fix as UnitsScreen / ArmourScreen / CoreData:
  // shadow the prop with a safe fallback so the useMemo calls below
  // run on every render, then defer the EmptyScreen render to the
  // bottom after every hook has been called.
  const project = rawProject || { units: [], factions: [], coreData: {}, armour: [], modInfo: {} };
  const units = project.units.filter(u => u.kind === "unit");
  const allKeys = useMemo(() => {
    const s = new Set();
    for (const u of units) for (const k of Object.keys(u)) if (k !== "ownership" && k !== "kind" && k !== "row") s.add(k);
    return Array.from(s).sort();
  }, [units]);

  const matches = useMemo(() => {
    if (!filterField) return units;
    if (!filterMatch) return units;
    const lc = filterMatch.toLowerCase();
    return units.filter(u => String(u[filterField] || "").toLowerCase().includes(lc));
  }, [units, filterField, filterMatch]);

  // Compute the new value for a unit given the current op + value.
  const applyOp = (currentVal) => {
    if (op === "set") return value;
    if (op === "append") return (currentVal == null ? "" : String(currentVal)) + value;
    if (op === "prefix") return value + (currentVal == null ? "" : String(currentVal));
    if (op === "clear") return "";
    if (op === "add") {
      const n = parseFloat(currentVal) || 0;
      return String(n + (parseFloat(value) || 0));
    }
    if (op === "multiply") {
      const n = parseFloat(currentVal) || 0;
      return String(Math.round(n * (parseFloat(value) || 1) * 100) / 100);
    }
    return currentVal;
  };

  const preview = matches.slice(0, 8).map(u => ({
    name: u.Unit || u.unit || u.name,
    before: u[editField],
    after: editField ? applyOp(u[editField]) : "",
  }));

  const apply = () => {
    if (!editField) { alert("Pick a field to modify."); return; }
    if (!window.confirm(`Apply ${op} to ${editField} across ${matches.length} units?`)) return;
    const matchedSet = new Set(matches);
    const nextUnits = project.units.map(u => {
      if (!matchedSet.has(u)) return u;
      const next = { ...u, [editField]: applyOp(u[editField]) };
      return next;
    });
    setProject({ ...project, units: nextUnits });
  };

  if (!rawProject) return <EmptyScreen />;

  return (
    <div className="screen">
      <h2>Bulk Edit Units <span className="dim">({matches.length} match{matches.length === 1 ? "" : "es"} of {units.length})</span></h2>
      <div className="card">
        <div style={{ marginBottom: 8 }}><strong>Filter</strong></div>
        <div style={{ display: "flex", gap: 8, marginBottom: 14, flexWrap: "wrap" }}>
          <select value={filterField} onChange={(e) => setFilterField(e.target.value)} style={selStyle}>
            <option value="">— field —</option>
            {allKeys.map(k => <option key={k} value={k}>{k}</option>)}
          </select>
          <input
            type="text" value={filterMatch} onChange={(e) => setFilterMatch(e.target.value)}
            placeholder="contains text…" style={inpStyle}
          />
        </div>
        <div style={{ marginBottom: 8 }}><strong>Modify</strong></div>
        <div style={{ display: "flex", gap: 8, marginBottom: 14, flexWrap: "wrap" }}>
          <select value={editField} onChange={(e) => setEditField(e.target.value)} style={selStyle}>
            <option value="">— field —</option>
            {allKeys.map(k => <option key={k} value={k}>{k}</option>)}
          </select>
          <select value={op} onChange={(e) => setOp(e.target.value)} style={selStyle}>
            <option value="set">set to</option>
            <option value="append">append</option>
            <option value="prefix">prefix with</option>
            <option value="add">add (numeric)</option>
            <option value="multiply">multiply (numeric)</option>
            <option value="clear">clear</option>
          </select>
          {op !== "clear" && (
            <input
              type="text" value={value} onChange={(e) => setValue(e.target.value)}
              placeholder={op === "multiply" ? "1.25" : op === "add" ? "10" : "value"} style={inpStyle}
            />
          )}
          <button onClick={apply} disabled={!editField || matches.length === 0} style={{ background: "#dca64a", color: "#1a1a1a", border: "none", padding: "6px 14px", borderRadius: 4, fontWeight: 700, cursor: !editField || matches.length === 0 ? "default" : "pointer", opacity: !editField || matches.length === 0 ? 0.4 : 1 }}>
            Apply to {matches.length}
          </button>
        </div>
        {editField && matches.length > 0 && (
          <>
            <div style={{ marginBottom: 6, fontSize: 12, color: "#888" }}>Preview (first {Math.min(8, matches.length)} of {matches.length}):</div>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12, fontFamily: "Consolas, monospace" }}>
              <thead>
                <tr style={{ borderBottom: "1px solid rgba(255,255,255,0.1)", color: "#888" }}>
                  <th style={{ textAlign: "left", padding: "4px 8px" }}>Unit</th>
                  <th style={{ textAlign: "left", padding: "4px 8px" }}>{editField} before</th>
                  <th style={{ textAlign: "left", padding: "4px 8px" }}>{editField} after</th>
                </tr>
              </thead>
              <tbody>
                {preview.map((p, i) => (
                  <tr key={i} style={{ borderBottom: "1px dashed rgba(255,255,255,0.05)" }}>
                    <td style={{ padding: "3px 8px" }}>{p.name}</td>
                    <td style={{ padding: "3px 8px", color: "#e88" }}>{String(p.before == null ? "" : p.before)}</td>
                    <td style={{ padding: "3px 8px", color: "#7c9" }}>{String(p.after == null ? "" : p.after)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {matches.length > 8 && <div style={{ marginTop: 6, color: "#888", fontSize: 11, fontStyle: "italic" }}>…and {matches.length - 8} more</div>}
          </>
        )}
      </div>
    </div>
  );
}
const selStyle = { background: "#252525", border: "1px solid #333", color: "#ddd", padding: "5px 8px", borderRadius: 4, fontSize: 12 };
const inpStyle = { background: "#252525", border: "1px solid #333", color: "#ddd", padding: "5px 8px", borderRadius: 4, fontSize: 12, fontFamily: "Consolas, monospace", minWidth: 160 };

// Body-part slot keys + their shape on disk.
//   Body parts (Head1/Head2/Torso1..3/UpArm/LowArm/Hand/UpLeg/LowLeg/Foot)
//     have { type, material, instances }. We split into TWO columns each:
//     "<slot> Type" + "<slot> Material" so users edit dropdown values in
//     place instead of parsing a "Cuirass · Bronze" join.
//   Shield has { size, material, onBack, instances } — "Shield Size"
//     (e.g. "4. large") and "Shield Material" (e.g. "reinforced").
//
// Synthetic column key format:  arm:<slot>:type | arm:<slot>:material |
//                              arm:Shield:size | arm:Shield:material
const ARM_PREFIX = "arm:";
const ARMOUR_BODY_SLOTS = ["Head1","Head2","Torso1","Torso2","Torso3","UpArm","LowArm","Hand","UpLeg","LowLeg","Foot"];

// Cost preview pane — shows the computed cost / upkeep / armour /
// defence for the currently-selected unit row(s). Computed on demand
// via the same compute() function the Preview EDU screen uses, so the
// numbers are guaranteed to match what'll land in export_descr_unit.txt.
// Heavy: compute walks the whole project, so we throttle to selection
// changes (NOT to every keystroke) and only render when something is
// selected.
function CostPreviewPane({ project, selectedIdxs }) {
  const rows = useMemo(() => {
    if (!selectedIdxs || !selectedIdxs.length) return null;
    try {
      const computed = compute(project).filter((r) => r && r.kind === "data");
      const byRow = new Map();
      for (const r of computed) byRow.set(r.row, r);
      return selectedIdxs
        .map((idx) => {
          const u = project.units[idx];
          if (!u || u.kind !== "unit") return null;
          const c = byRow.get(u.row) || null;
          return { unit: u, computed: c };
        })
        .filter(Boolean);
    } catch (e) { return null; }
  }, [project, selectedIdxs]);
  if (!rows || rows.length === 0) return null;
  const fmt = (v, dflt = "—") => (v == null || v === "" ? dflt : String(v));
  return (
    <div style={{ background: "rgba(220,166,74,0.06)", border: "1px solid rgba(220,166,74,0.25)", borderRadius: 6, padding: "8px 12px", marginBottom: 10, fontSize: 11.5, fontFamily: "Consolas, monospace", display: "flex", flexWrap: "wrap", gap: 18 }}>
      <span style={{ color: "#dca64a", fontWeight: 600 }}>Computed preview · {rows.length} selected</span>
      {rows.slice(0, 6).map((r, i) => (
        <span key={i} title={`Computed from current project state — matches what compute() will write to EDU.`} style={{ color: "#bbb" }}>
          <strong style={{ color: "#fff" }}>{r.unit.name || "(unnamed)"}</strong>
          <span style={{ color: "#888" }}> ·</span>{" "}
          cost <span style={{ color: "#7c9" }}>{fmt(r.computed && r.computed.price)}</span>
          <span style={{ color: "#888" }}> ·</span>{" "}
          upkeep <span style={{ color: "#7c9" }}>{fmt(r.computed && r.computed.upkeep)}</span>
          <span style={{ color: "#888" }}> ·</span>{" "}
          armour <span style={{ color: "#dca64a" }}>{fmt(r.computed && r.computed.armour)}</span>
          /<span style={{ color: "#dca64a" }}>{fmt(r.computed && r.computed.defence)}</span>
          /<span style={{ color: "#dca64a" }}>{fmt(r.computed && r.computed.shield)}</span>
        </span>
      ))}
      {rows.length > 6 && <span style={{ color: "#888" }}>… +{rows.length - 6} more</span>}
    </div>
  );
}

function ArmourScreen({ project: rawProject, setProject, projectBlame }) {
  // Same Rules-of-Hooks fix as UnitsScreen — shadow `project` with a
  // safe fallback so all hooks below run on every render regardless of
  // whether the prop is loaded yet. Real EmptyScreen render at the
  // bottom after the hook block.
  const project = rawProject || { units: [], factions: [], coreData: {}, armour: [], modInfo: {} };
  const rows = project.armour || [];

  // Per-row git blame, keyed by index in project.armour. Same
  // mechanism as UnitsScreen — file path mirrors what projectStore.js
  // writes for armour records.
  const rowFlags = useMemo(() => {
    if (!projectBlame || !projectBlame.size) return null;
    const out = {};
    for (let i = 0; i < rows.length; i++) {
      const fp = unitFilePath(rows[i], "armour");
      const blame = fp ? projectBlame.get(fp.toLowerCase()) : null;
      if (blame) out[i] = { blame: `${blame.author} · ${blame.age}` };
    }
    return out;
  }, [rows, projectBlame]);

  // Column order: Model Set Name (pinned), then for each body slot a
  // # Instances + Type + Material column, then Shield columns. The
  // Instances cell defines how many of the model's variants wear that
  // type/material combo; the EDU armour-value calc averages across
  // variants weighted by these instance counts (see armour.js — the
  // formula is already wired through as cell.instances).
  const cols = useMemo(() => {
    const out = ["Model Set Name"];
    for (const s of ARMOUR_BODY_SLOTS) {
      out.push(`${ARM_PREFIX}${s}:instances`);
      out.push(`${ARM_PREFIX}${s}:type`);
      out.push(`${ARM_PREFIX}${s}:material`);
    }
    out.push(`${ARM_PREFIX}Shield:instances`);
    out.push(`${ARM_PREFIX}Shield:size`);
    out.push(`${ARM_PREFIX}Shield:material`);
    return out;
  }, []);

  const columnLabels = useMemo(() => {
    const out = {};
    for (const s of ARMOUR_BODY_SLOTS) {
      out[`${ARM_PREFIX}${s}:instances`] = `${s} # Inst`;
      out[`${ARM_PREFIX}${s}:type`] = `${s} Type`;
      out[`${ARM_PREFIX}${s}:material`] = `${s} Material`;
    }
    out[`${ARM_PREFIX}Shield:instances`] = "Shield # Inst";
    out[`${ARM_PREFIX}Shield:size`] = "Shield Size";
    out[`${ARM_PREFIX}Shield:material`] = "Shield Material";
    return out;
  }, []);

  // Edit metadata: dropdown options gathered from the actual data so users
  // pick from existing types/materials/sizes (mirrors how UnitsScreen
  // sources options from coreData tables). Instances are plain numbers.
  const columnMeta = useMemo(() => {
    const meta = {};
    const collect = (slot, field) => {
      const seen = new Set();
      for (const r of rows) {
        const v = r[slot];
        if (v && v[field] != null && v[field] !== "") seen.add(String(v[field]));
      }
      return [...seen].sort();
    };
    for (const s of ARMOUR_BODY_SLOTS) {
      meta[`${ARM_PREFIX}${s}:instances`] = { type: "number" };
      const types = collect(s, "type");
      const mats  = collect(s, "material");
      if (types.length) meta[`${ARM_PREFIX}${s}:type`] = { type: "select", options: ["", ...types] };
      if (mats.length)  meta[`${ARM_PREFIX}${s}:material`] = { type: "select", options: ["", ...mats] };
    }
    meta[`${ARM_PREFIX}Shield:instances`] = { type: "number" };
    const sizes = collect("Shield", "size");
    const sMats = collect("Shield", "material");
    if (sizes.length) meta[`${ARM_PREFIX}Shield:size`] = { type: "select", options: ["", ...sizes] };
    if (sMats.length) meta[`${ARM_PREFIX}Shield:material`] = { type: "select", options: ["", ...sMats] };
    return meta;
  }, [rows]);

  // Build table rows with section dividers / per-unit separators (same
  // logic as before — just emitting per-field values into the new
  // wider column layout).
  const { rows: tableRows, rowIds } = useMemo(() => {
    const out = [];
    const ids = [];
    let prevName = null;
    let lastWasDecoration = true;
    for (let idx = 0; idx < rows.length; idx++) {
      const r = rows[idx];
      const name = String(r["Model Set Name"] || "").trim();
      if (!name) continue;
      if (name.startsWith("#")) {
        if (/^#?actual edu starts here\s*$/i.test(name)) { prevName = null; continue; }
        out.push({ section: name.replace(/^#/, "") });
        ids.push(-1);
        prevName = null;
        lastWasDecoration = true;
        continue;
      }
      if (prevName !== null && name !== prevName && !lastWasDecoration) {
        out.push({ separator: true });
        ids.push(-1);
      }
      out.push(cols.map((c) => {
        if (c === "Model Set Name") return r[c];
        if (c.startsWith(ARM_PREFIX)) {
          const rest = c.slice(ARM_PREFIX.length);
          const sep = rest.indexOf(":");
          const slot = rest.slice(0, sep);
          const field = rest.slice(sep + 1);
          const v = r[slot];
          return (v && v[field]) || "";
        }
        return r[c];
      }));
      ids.push(idx);
      prevName = name;
      lastWasDecoration = false;
    }
    return { rows: out, rowIds: ids };
  }, [rows, cols]);

  const onEdit = useCallback((rowIdx, columnKey, newValue) => {
    if (typeof rowIdx !== "number" || rowIdx < 0) return;
    const cur = rows[rowIdx];
    if (!cur) return;
    if (columnKey === "Model Set Name") {
      if (String(cur[columnKey] ?? "") === String(newValue ?? "")) return;
      const nextRow = { ...cur, [columnKey]: newValue };
      const nextRows = rows.slice(); nextRows[rowIdx] = nextRow;
      setProject({ ...project, armour: nextRows });
      return;
    }
    if (columnKey.startsWith(ARM_PREFIX)) {
      const rest = columnKey.slice(ARM_PREFIX.length);
      const sep = rest.indexOf(":");
      const slot = rest.slice(0, sep);
      const field = rest.slice(sep + 1);
      const slotObj = cur[slot] || { instances: 1 };
      if (String(slotObj[field] ?? "") === String(newValue ?? "")) return;
      const nextSlot = { ...slotObj };
      if (newValue === "" || newValue == null) {
        // For instances, leaving blank means "default to 1" (the VBA
        // fallback). Persist as 1 explicitly so the JSON round-trips
        // cleanly instead of storing null and surprising the formula.
        nextSlot[field] = field === "instances" ? 1 : null;
      } else if (field === "instances") {
        const n = Number(newValue);
        nextSlot[field] = Number.isFinite(n) ? n : 1;
      } else {
        nextSlot[field] = newValue;
      }
      const nextRow = { ...cur, [slot]: nextSlot };
      const nextRows = rows.slice(); nextRows[rowIdx] = nextRow;
      setProject({ ...project, armour: nextRows });
    }
  }, [rows, project, setProject]);

  // Row operations.
  const addBlankArmour = useCallback(() => {
    const blank = { row: 0, "Model Set Name": "" };
    setProject({ ...project, armour: [...rows, blank] });
  }, [rows, project, setProject]);
  const duplicateArmour = useCallback((idx) => {
    if (typeof idx !== "number" || idx < 0) return;
    const cur = rows[idx]; if (!cur) return;
    const copy = JSON.parse(JSON.stringify(cur));
    // Don't append "(copy)" — armour rows that share a Model Set Name
    // group together as variants of the same unit. Renaming the dup
    // breaks the grouping and the row appears between separators as if
    // it were its own unit. The user can rename via the cell editor
    // when they actually want to start a new group.
    const next = rows.slice(); next.splice(idx + 1, 0, copy);
    setProject({ ...project, armour: next });
  }, [rows, project, setProject]);
  const insertBlankArmourBelow = useCallback((idx) => {
    if (typeof idx !== "number" || idx < 0) return;
    // Inherit the neighbor's Model Set Name so the new blank row
    // joins the adjacent unit's group instead of looking like its
    // own unit between separators. Empty string is the fall-back if
    // the row above has no name yet.
    const cur = rows[idx];
    const name = cur && cur["Model Set Name"] ? String(cur["Model Set Name"]) : "";
    const blank = { row: 0, "Model Set Name": name };
    const next = rows.slice(); next.splice(idx + 1, 0, blank);
    setProject({ ...project, armour: next });
  }, [rows, project, setProject]);
  const insertBlankArmourAbove = useCallback((idx) => {
    if (typeof idx !== "number" || idx < 0) return;
    const cur = rows[idx];
    const name = cur && cur["Model Set Name"] ? String(cur["Model Set Name"]) : "";
    const blank = { row: 0, "Model Set Name": name };
    const next = rows.slice(); next.splice(idx, 0, blank);
    setProject({ ...project, armour: next });
  }, [rows, project, setProject]);
  const insertArmourSectionHeader = useCallback((idx, position) => {
    const text = (window.prompt("Section header text:", "NEW SECTION") || "").trim();
    if (!text) return;
    // Section rows in the armour table are encoded as a row whose
    // "Model Set Name" starts with "#". Mirrors the xlsm convention.
    const marker = { row: 0, "Model Set Name": "#" + text };
    const next = rows.slice();
    if (typeof idx === "number" && idx >= 0) {
      const at = position === "below" ? idx + 1 : idx;
      next.splice(at, 0, marker);
    } else {
      next.unshift(marker);
    }
    setProject({ ...project, armour: next });
  }, [rows, project, setProject]);
  const onPasteArmour = useCallback((idx, parsed) => {
    if (typeof idx !== "number" || idx < 0) return;
    if (!parsed || typeof parsed !== "object") return;
    const cur = rows[idx];
    if (!cur) return;
    const next = { ...parsed, row: cur.row != null ? cur.row : 0 };
    const nextRows = rows.slice();
    nextRows[idx] = next;
    setProject({ ...project, armour: nextRows });
  }, [rows, project, setProject]);
  const moveArmour = useCallback((idx, dir) => {
    if (typeof idx !== "number" || idx < 0) return;
    const target = dir === "up" ? idx - 1 : idx + 1;
    if (target < 0 || target >= rows.length) return;
    const next = rows.slice();
    [next[idx], next[target]] = [next[target], next[idx]];
    setProject({ ...project, armour: next });
  }, [rows, project, setProject]);
  const onMoveRowsArmour = useCallback((srcIds, targetId, position) => {
    if (!Array.isArray(srcIds) || srcIds.length === 0) return;
    const srcSet = new Set(srcIds);
    if (srcSet.has(targetId)) return;
    const moved = srcIds.slice().sort((a, b) => a - b).map((i) => rows[i]).filter(Boolean);
    const filtered = [];
    let targetPos = -1;
    for (let i = 0; i < rows.length; i++) {
      if (srcSet.has(i)) continue;
      if (i === targetId) targetPos = filtered.length;
      filtered.push(rows[i]);
    }
    if (targetPos < 0) return;
    const insertAt = position === "above" ? targetPos : targetPos + 1;
    filtered.splice(insertAt, 0, ...moved);
    setProject({ ...project, armour: filtered });
  }, [rows, project, setProject]);
  const deleteArmour = useCallback((idx) => {
    if (typeof idx !== "number" || idx < 0) return;
    const next = rows.slice(); next.splice(idx, 1);
    setProject({ ...project, armour: next });
  }, [rows, project, setProject]);

  // Bulk operations — same pattern as Units. Operate on indices into
  // project.armour. "Set field…" prompts for an Armour-shaped column
  // key (top-level string field) and applies it across all selected
  // rows; for body-slot Type/Material edits the user picks one row's
  // dropdown and uses the new "Apply <slot> <field> = <value> to
  // selected" path below.
  const bulkSetArmour = useCallback((rowIdxs, column, value) => {
    if (!rowIdxs || !rowIdxs.length || !column) return;
    const sel = new Set(rowIdxs);
    const next = rows.slice();
    for (let i = 0; i < next.length; i++) {
      if (!sel.has(i)) continue;
      const cur = next[i]; if (!cur) continue;
      // Synthetic arm:<slot>:<field> column key — same shape as the
      // edit path so the prompt accepts the column header user sees.
      if (column.startsWith(ARM_PREFIX)) {
        const rest = column.slice(ARM_PREFIX.length);
        const sep = rest.indexOf(":");
        const slot = rest.slice(0, sep);
        const field = rest.slice(sep + 1);
        const slotObj = cur[slot] || { instances: 1 };
        const nextSlot = { ...slotObj };
        if (value === "" || value == null) nextSlot[field] = null;
        else nextSlot[field] = value;
        next[i] = { ...cur, [slot]: nextSlot };
      } else {
        // Top-level field (e.g. "Model Set Name").
        const updated = { ...cur };
        if (value === "" || value == null) delete updated[column];
        else updated[column] = value;
        next[i] = updated;
      }
    }
    setProject({ ...project, armour: next });
  }, [rows, project, setProject]);
  const bulkDeleteArmour = useCallback((rowIdxs) => {
    if (!rowIdxs || !rowIdxs.length) return;
    if (!window.confirm(`Delete ${rowIdxs.length} selected armour record${rowIdxs.length === 1 ? "" : "s"}?`)) return;
    const sel = new Set(rowIdxs);
    setProject({ ...project, armour: rows.filter((_, i) => !sel.has(i)) });
  }, [rows, project, setProject]);
  const bulkDuplicateArmour = useCallback((rowIdxs) => {
    if (!rowIdxs || !rowIdxs.length) return;
    const sel = rowIdxs.slice().sort((a, b) => b - a);
    let next = rows.slice();
    for (const idx of sel) {
      const cur = next[idx]; if (!cur) continue;
      const copy = JSON.parse(JSON.stringify(cur));
      if (copy["Model Set Name"]) copy["Model Set Name"] = copy["Model Set Name"] + " (copy)";
      next.splice(idx + 1, 0, copy);
    }
    setProject({ ...project, armour: next });
  }, [rows, project, setProject]);

  if (!rawProject) return <EmptyScreen />;

  return (
    <div className="screen">
      <h2>Armour Models <span className="dim">({rows.length})</span></h2>
      <DataTable
        columns={cols}
        rows={tableRows}
        rowIds={rowIds}
        columnMeta={columnMeta}
        columnLabels={columnLabels}
        onEdit={onEdit}
        editable
        pinFirstColumn
        searchable
        columnsToggleable
        onAddRow={addBlankArmour}
        onDuplicateRow={duplicateArmour}
        onInsertRowBelow={insertBlankArmourBelow}
        onDeleteRow={deleteArmour}
        onMoveRows={onMoveRowsArmour}
        addRowLabel="+ New armour set"
        searchPersistKey="edu-armour"
        rowFlags={rowFlags}
        rowToJSON={(idx) => rows[idx] || null}
        onPasteRow={onPasteArmour}
        rowMenuExtras={[
          { label: "↑ Move row up", onClick: (idx) => moveArmour(idx, "up") },
          { label: "↓ Move row down", onClick: (idx) => moveArmour(idx, "down") },
          { label: "Insert blank above", onClick: (idx) => insertBlankArmourAbove(idx) },
          { label: "Insert section header above…", onClick: (idx) => insertArmourSectionHeader(idx, "above") },
          { label: "Insert section header below…", onClick: (idx) => insertArmourSectionHeader(idx, "below") },
        ]}
        bulkActions={[
          { label: "Set field on selected…", setField: { onApply: bulkSetArmour } },
          { label: "Duplicate selected", onClick: bulkDuplicateArmour },
          { label: "Delete selected", destructive: true, onClick: bulkDeleteArmour },
        ]}
      />
    </div>
  );
}

// Numeric merc-unit fields that should round-trip as numbers, not strings.
// (Edits go through plain text inputs; we coerce on commit so saved JSON
// keeps the same shape the xlsm importer originally produced.)
const MERC_NUMERIC_FIELDS = new Set(["exp", "cost", "maxInPool", "initial", "replenishMin", "replenishMax"]);
const MERC_COLS = ["unitId", "exp", "cost", "replenishMin", "replenishMax", "maxInPool", "initial", "refUnitId"];

function MercScreen({ project: rawProject, setProject, modDataDir }) {
  const project = rawProject || { units: [], factions: [], coreData: {}, armour: [], merc: [], modInfo: {} };
  const rows = useMemo(() => project.merc || [], [project.merc]);
  const [filterPool, setFilterPool] = useState("");

  // Dropdown options for unitId / refUnitId — pulled from the EDU project's
  // own units. This is what stops typos: pick from the existing list rather
  // than spell-by-hand.
  const columnMeta = useMemo(() => {
    const meta = {};
    if (Array.isArray(project.units)) {
      const seen = new Set();
      const opts = [];
      for (const u of project.units) {
        if (u && u.kind === "unit" && u["unit id"] && !seen.has(u["unit id"])) {
          seen.add(u["unit id"]);
          opts.push(u["unit id"]);
        }
      }
      if (opts.length) {
        meta.unitId = { type: "select", options: opts };
        meta.refUnitId = { type: "select", options: opts };
      }
    }
    return meta;
  }, [project.units]);

  const columnLabels = useMemo(() => ({
    unitId: "Unit",
    exp: "XP",
    cost: "Cost",
    replenishMin: "Replenish min",
    replenishMax: "Replenish max",
    maxInPool: "Max in pool",
    initial: "Initial",
    refUnitId: "Ref unit",
  }), []);

  // Build table rows with pool-section headers (label combines pool name
  // with its regions list so the user can see at a glance which pool a
  // merc belongs to without scrolling up).
  const { rows: tableRows, rowIds } = useMemo(() => {
    const out = []; const ids = [];
    let activePool = null;
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      if (!r) continue;
      if (r.kind === "blank") continue;
      if (r.kind === "regions") continue;
      if (r.kind === "pool") {
        activePool = r.name || "";
        if (filterPool && activePool !== filterPool) continue;
        const next = rows[i + 1];
        const regions = (next && next.kind === "regions") ? next.list : "";
        const label = regions ? `${r.name || "(unnamed pool)"} — ${regions}` : (r.name || "(unnamed pool)");
        out.push({ section: label });
        ids.push(-1);
        continue;
      }
      if (r.kind === "unit") {
        if (filterPool && activePool !== filterPool) continue;
        out.push(MERC_COLS.map((c) => r[c]));
        ids.push(i);
      }
    }
    return { rows: out, rowIds: ids };
  }, [rows, filterPool]);

  const onEdit = useCallback((rowIdx, columnKey, newValue) => {
    if (typeof rowIdx !== "number" || rowIdx < 0) return;
    const cur = rows[rowIdx];
    if (!cur || cur.kind !== "unit") return;
    if (String(cur[columnKey] ?? "") === String(newValue ?? "")) return;
    const next = { ...cur };
    if (newValue === "" || newValue == null) {
      delete next[columnKey];
    } else if (MERC_NUMERIC_FIELDS.has(columnKey)) {
      const n = Number(newValue);
      next[columnKey] = isNaN(n) ? newValue : n;
    } else {
      next[columnKey] = newValue;
    }
    const nextRows = rows.slice(); nextRows[rowIdx] = next;
    setProject({ ...project, merc: nextRows });
  }, [rows, project, setProject]);

  // Row ops — restricted to merc UNIT rows. Section headers (pool /
  // regions) are not editable through the table; managing pools is a
  // separate panel that doesn't exist yet (deferred — most edit traffic
  // is on unit stats anyway).
  const addBlankMerc = useCallback(() => {
    const blank = { row: 0, kind: "unit", unitId: "" };
    // Append to the end of the LAST pool — find the last pool section
    // and insert just before any trailing blank rows. If no pool
    // exists, just prepend.
    const arr = rows.slice();
    let lastPoolEnd = -1;
    for (let i = arr.length - 1; i >= 0; i--) {
      if (arr[i] && arr[i].kind === "unit") { lastPoolEnd = i + 1; break; }
    }
    if (lastPoolEnd >= 0) arr.splice(lastPoolEnd, 0, blank);
    else arr.unshift(blank);
    setProject({ ...project, merc: arr });
  }, [rows, project, setProject]);
  const duplicateMerc = useCallback((idx) => {
    if (typeof idx !== "number" || idx < 0) return;
    const cur = rows[idx]; if (!cur || cur.kind !== "unit") return;
    const copy = JSON.parse(JSON.stringify(cur));
    const next = rows.slice(); next.splice(idx + 1, 0, copy);
    setProject({ ...project, merc: next });
  }, [rows, project, setProject]);
  const insertBlankMercBelow = useCallback((idx) => {
    if (typeof idx !== "number" || idx < 0) return;
    const blank = { row: 0, kind: "unit", unitId: "" };
    const next = rows.slice(); next.splice(idx + 1, 0, blank);
    setProject({ ...project, merc: next });
  }, [rows, project, setProject]);
  const deleteMerc = useCallback((idx) => {
    if (typeof idx !== "number" || idx < 0) return;
    const next = rows.slice(); next.splice(idx, 1);
    setProject({ ...project, merc: next });
  }, [rows, project, setProject]);

  // Bulk operations. Identical pattern to Units / Armour.
  const bulkSetMerc = useCallback((rowIdxs, column, value) => {
    if (!rowIdxs || !rowIdxs.length || !column) return;
    const sel = new Set(rowIdxs);
    const next = rows.slice();
    for (let i = 0; i < next.length; i++) {
      if (!sel.has(i)) continue;
      const cur = next[i];
      if (!cur || cur.kind !== "unit") continue;
      const updated = { ...cur };
      if (value === "" || value == null) delete updated[column];
      else if (MERC_NUMERIC_FIELDS.has(column)) {
        const n = Number(value);
        updated[column] = isNaN(n) ? value : n;
      } else updated[column] = value;
      next[i] = updated;
    }
    setProject({ ...project, merc: next });
  }, [rows, project, setProject]);
  const bulkDeleteMerc = useCallback((rowIdxs) => {
    if (!rowIdxs || !rowIdxs.length) return;
    if (!window.confirm(`Delete ${rowIdxs.length} selected merc${rowIdxs.length === 1 ? "" : "s"}?`)) return;
    const sel = new Set(rowIdxs);
    setProject({ ...project, merc: rows.filter((_, i) => !sel.has(i)) });
  }, [rows, project, setProject]);
  const bulkDuplicateMerc = useCallback((rowIdxs) => {
    if (!rowIdxs || !rowIdxs.length) return;
    const sel = rowIdxs.slice().sort((a, b) => b - a);
    let next = rows.slice();
    for (const idx of sel) {
      const cur = next[idx]; if (!cur || cur.kind !== "unit") continue;
      const copy = JSON.parse(JSON.stringify(cur));
      next.splice(idx + 1, 0, copy);
    }
    setProject({ ...project, merc: next });
  }, [rows, project, setProject]);

  // Pool management. Mercs are organized into pools (each pool has a
  // name + regions list) with units underneath. We expose rename / edit
  // regions / add new pool / delete pool here, since those are sectioned
  // structures the DataTable doesn't surface.
  const pools = useMemo(() => {
    const out = [];
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      if (r && r.kind === "pool") {
        const next = rows[i + 1];
        const regions = next && next.kind === "regions" ? next.list : "";
        out.push({ idx: i, name: r.name || "", regions, regionsIdx: next && next.kind === "regions" ? i + 1 : -1 });
      }
    }
    return out;
  }, [rows]);

  const renamePool = useCallback((poolIdx, newName) => {
    const next = rows.slice();
    next[poolIdx] = { ...next[poolIdx], name: newName };
    setProject({ ...project, merc: next });
  }, [rows, project, setProject]);

  const setPoolRegions = useCallback((poolIdx, regionsIdx, list) => {
    const next = rows.slice();
    if (regionsIdx >= 0) {
      next[regionsIdx] = { ...next[regionsIdx], list };
    } else {
      // No regions row yet — insert one immediately after the pool row.
      next.splice(poolIdx + 1, 0, { row: 0, kind: "regions", list });
    }
    setProject({ ...project, merc: next });
  }, [rows, project, setProject]);

  const addNewPool = useCallback(() => {
    const name = window.prompt("Pool name (e.g. 'italy', 'gaul'):", "");
    if (!name) return;
    const regions = window.prompt(`Regions for "${name}" (space-separated):`, "");
    if (regions == null) return;
    // Append at the end of the merc array. New pool starts with a blank
    // separator before it for visual hygiene if there's content.
    const next = rows.slice();
    if (next.length) next.push({ row: 0, kind: "blank" });
    next.push({ row: 0, kind: "pool", name });
    next.push({ row: 0, kind: "regions", list: regions });
    setProject({ ...project, merc: next });
  }, [rows, project, setProject]);

  const deletePool = useCallback((poolIdx) => {
    const pool = rows[poolIdx];
    if (!pool || pool.kind !== "pool") return;
    if (!window.confirm(`Delete pool "${pool.name}" and all its units?`)) return;
    // Find the end of this pool (next pool / end of array).
    let end = rows.length;
    for (let i = poolIdx + 1; i < rows.length; i++) {
      if (rows[i] && rows[i].kind === "pool") { end = i; break; }
    }
    // Strip a trailing blank if the slice ended on one (avoid double-blanks).
    if (end < rows.length && rows[end - 1] && rows[end - 1].kind === "blank") end -= 1;
    // Strip a leading blank above the pool (so we don't leave one floating).
    let start = poolIdx;
    if (start > 0 && rows[start - 1] && rows[start - 1].kind === "blank") start -= 1;
    const next = rows.slice(0, start).concat(rows.slice(end));
    setProject({ ...project, merc: next });
  }, [rows, project, setProject]);

  // Cross-check the project's merc rows against the on-disk
  // descr_mercenaries.txt. Surfaces:
  //   - Pools / regions present in one source but not the other
  //   - Per-unit cost / max-pool / replenish drift between project and game file
  // Result shape: { pools:[…], regions:[…], units:[…] } where each
  // entry is { kind:"missing"|"extra"|"diff", message }.
  const [mercDiff, setMercDiff] = useState(null);
  const runMercCrossCheck = useCallback(async () => {
    if (!modDataDir || !window.eduAPI?.readDescrMercenaries) {
      setMercDiff({ error: "modDataDir not set or IPC unavailable" });
      return;
    }
    const r = await window.eduAPI.readDescrMercenaries(modDataDir);
    if (!r || !r.ok) { setMercDiff({ error: r?.reason || "read failed" }); return; }
    // Parse the on-disk file into pool blocks.
    const onDiskPools = new Map();   // poolName -> { regions: string, units: Map<unitId, {cost, maxInPool, replenishMin, replenishMax, exp, initial}> }
    let curPool = null;
    for (const raw of r.text.split(/\r?\n/)) {
      const ln = raw.trim();
      if (!ln || ln.startsWith(";")) continue;
      let m = ln.match(/^pool\s+(.+?)\s*$/i);
      if (m) {
        curPool = m[1].trim();
        if (!onDiskPools.has(curPool)) onDiskPools.set(curPool, { regions: "", units: new Map() });
        continue;
      }
      m = ln.match(/^regions\s+(.+?)\s*$/i);
      if (m && curPool) { onDiskPools.get(curPool).regions = m[1].trim(); continue; }
      m = ln.match(/^unit\s+(.+?),\s*exp\s+(\d+)\s+cost\s+(\d+)\s+replenish\s+([\d.]+)\s*-\s*([\d.]+)\s+max\s+(\d+)\s+initial\s+(\d+)/i);
      if (m && curPool) {
        const id = m[1].trim();
        onDiskPools.get(curPool).units.set(id.toLowerCase(), {
          unit: id, exp: Number(m[2]), cost: Number(m[3]), replenishMin: Number(m[4]), replenishMax: Number(m[5]), maxInPool: Number(m[6]), initial: Number(m[7]),
        });
      }
    }
    // Build the project-side view.
    const projectPools = new Map();
    let pCur = null;
    for (const m of project.merc || []) {
      if (m.kind === "pool") { pCur = m.name; if (!projectPools.has(pCur)) projectPools.set(pCur, { regions: "", units: new Map() }); }
      else if (m.kind === "regions" && pCur) projectPools.get(pCur).regions = String(m.list || "").trim();
      else if (m.kind === "unit" && pCur) projectPools.get(pCur).units.set(String(m.unitId || "").toLowerCase(), m);
    }
    const out = { pools: [], regions: [], units: [], summary: "" };
    for (const name of projectPools.keys()) {
      if (!onDiskPools.has(name)) out.pools.push({ kind: "missing", message: `Pool "${name}" exists in project but NOT in descr_mercenaries.txt` });
    }
    for (const name of onDiskPools.keys()) {
      if (!projectPools.has(name)) out.pools.push({ kind: "extra", message: `Pool "${name}" in descr_mercenaries.txt but NOT in project` });
    }
    for (const [name, p] of projectPools) {
      const d = onDiskPools.get(name);
      if (!d) continue;
      const projRegions = p.regions || "";
      const diskRegions = d.regions || "";
      if (projRegions.split(/\s+/).filter(Boolean).sort().join(" ") !== diskRegions.split(/\s+/).filter(Boolean).sort().join(" ")) {
        out.regions.push({ kind: "diff", message: `Pool "${name}" regions differ\n  project: ${projRegions}\n  on-disk: ${diskRegions}` });
      }
      for (const [uid, pu] of p.units) {
        const du = d.units.get(uid);
        if (!du) { out.units.push({ kind: "missing", message: `[${name}] "${pu.unitId}" — in project, NOT in descr_mercenaries.txt` }); continue; }
        const fields = ["cost", "maxInPool", "replenishMin", "replenishMax", "exp", "initial"];
        const drifts = fields.filter(f => Number(pu[f] ?? 0) !== Number(du[f] ?? 0));
        if (drifts.length) {
          const detail = drifts.map(f => `${f}: project=${pu[f]} disk=${du[f]}`).join(", ");
          out.units.push({ kind: "diff", message: `[${name}] "${pu.unitId}" — ${detail}` });
        }
      }
      for (const [uid, du] of d.units) {
        if (!p.units.has(uid)) out.units.push({ kind: "extra", message: `[${name}] "${du.unit}" — in descr_mercenaries.txt, NOT in project` });
      }
    }
    out.summary = `${out.pools.length} pool · ${out.regions.length} regions · ${out.units.length} unit difference(s)`;
    setMercDiff({ ok: true, ...out, path: r.path });
  }, [modDataDir, project]);

  if (!rawProject) return <EmptyScreen />;

  return (
    <div className="screen">
      <h2>Mercenaries <span className="dim">({rows.filter(r => r && r.kind === "unit").length} units across {pools.length} pools)</span></h2>
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8, flexWrap: "wrap" }}>
        <button className="btn" onClick={runMercCrossCheck} disabled={!modDataDir} title={modDataDir ? "Compare project's pools / regions / unit cost against the on-disk descr_mercenaries.txt" : "Set the mod data folder first"}>
          Cross-check descr_mercenaries.txt
        </button>
        <button
          className="btn"
          disabled={!modDataDir || !window.eduAPI?.writeDescrMercenaries}
          title={modDataDir ? "Write the project's pools/regions/units to descr_mercenaries.txt (backs up the existing file to .bak)" : "Set the mod data folder first"}
          onClick={async () => {
            if (!window.confirm("Overwrite descr_mercenaries.txt with the project's merc data? A .bak backup is created the first time you do this in this session.")) return;
            try {
              const text = formatMerc(project);
              const r = await window.eduAPI.writeDescrMercenaries(modDataDir, text);
              if (r?.ok) (window.toast || alert)(`✓ Wrote ${r.path}`, "ok");
              else (window.toast || alert)("Write failed: " + (r?.reason || "?"), "error");
            } catch (e) { (window.toast || alert)("Write failed: " + e.message, "error"); }
          }}
        >Write to descr_mercenaries.txt…</button>
        {mercDiff && mercDiff.error && <span style={{ color: "#d66c6c", fontSize: 11 }}>{mercDiff.error}</span>}
        {mercDiff && mercDiff.ok && (
          <span style={{ fontSize: 11, color: (mercDiff.pools.length + mercDiff.regions.length + mercDiff.units.length) === 0 ? "#7c9" : "#dca64a" }}>
            {(mercDiff.pools.length + mercDiff.regions.length + mercDiff.units.length) === 0 ? "✓ no differences" : mercDiff.summary}
          </span>
        )}
      </div>
      {mercDiff && mercDiff.ok && (mercDiff.pools.length + mercDiff.regions.length + mercDiff.units.length) > 0 && (
        <div className="card" style={{ marginBottom: 12, maxHeight: 220, overflow: "auto", fontFamily: "Consolas, monospace", fontSize: 11 }}>
          {[...mercDiff.pools, ...mercDiff.regions, ...mercDiff.units].map((d, i) => (
            <div key={i} style={{ padding: "3px 0", color: d.kind === "diff" ? "#dca64a" : d.kind === "missing" ? "#d66c6c" : "#7c9", whiteSpace: "pre-wrap" }}>
              [{d.kind}] {d.message}
            </div>
          ))}
        </div>
      )}
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8, flexWrap: "wrap" }}>
        <span style={{ fontSize: 11, color: "#999" }}>Filter pool:</span>
        <select
          value={filterPool}
          onChange={(e) => setFilterPool(e.target.value)}
          className="input"
          style={{ minWidth: 140 }}
        >
          <option value="">— any pool —</option>
          {pools.map(p => <option key={p.idx} value={p.name}>{p.name || "(unnamed)"}</option>)}
        </select>
        {filterPool && (
          <button className="btn" onClick={() => setFilterPool("")}>clear</button>
        )}
      </div>
      <details className="card" style={{ marginBottom: 12 }}>
        <summary style={{ cursor: "pointer", color: "#dca64a", fontWeight: 600 }}>
          Manage pools ({pools.length})
        </summary>
        <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 8 }}>
          {pools.map((p, i) => (
            <div key={p.idx} style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap", padding: 6, background: "#1c1c1c", border: "1px solid #2a2a2a", borderRadius: 4 }}>
              <span style={{ color: "#888", fontSize: 11, minWidth: 24, textAlign: "right" }}>{i + 1}.</span>
              <input
                className="input"
                value={p.name}
                onChange={(e) => renamePool(p.idx, e.target.value)}
                placeholder="pool name"
                style={{ minWidth: 140 }}
              />
              <input
                className="input"
                value={p.regions}
                onChange={(e) => setPoolRegions(p.idx, p.regionsIdx, e.target.value)}
                placeholder="space-separated regions list"
                style={{ flex: 1, minWidth: 240, fontFamily: "Consolas, monospace", fontSize: 11 }}
              />
              <button className="btn" style={{ borderColor: "#d66c6c", color: "#d66c6c" }} onClick={() => deletePool(p.idx)}>Delete</button>
            </div>
          ))}
          <button className="btn btn-accent" onClick={addNewPool} style={{ alignSelf: "flex-start", marginTop: 6 }}>+ New pool</button>
        </div>
      </details>
      <DataTable
        columns={MERC_COLS}
        rows={tableRows}
        rowIds={rowIds}
        columnMeta={columnMeta}
        columnLabels={columnLabels}
        onEdit={onEdit}
        editable
        pinFirstColumn
        searchable
        columnsToggleable
        onAddRow={addBlankMerc}
        onDuplicateRow={duplicateMerc}
        onInsertRowBelow={insertBlankMercBelow}
        onDeleteRow={deleteMerc}
        addRowLabel="+ New merc unit"
        searchPersistKey="edu-merc"
        rowToJSON={(idx) => rows[idx] || null}
        bulkActions={[
          { label: "Set field on selected…", setField: { onApply: bulkSetMerc } },
          { label: "Duplicate selected", onClick: bulkDuplicateMerc },
          { label: "Delete selected", destructive: true, onClick: bulkDeleteMerc },
        ]}
      />
    </div>
  );
}

function ValidateScreen({ project, onView }) {
  // Auto-run instead of waiting for the user to click a button. Validate /
  // diagnose are fast enough that re-running on every project change is
  // fine, and the inline rowFlags + Sync gate were already running them
  // anyway. Debounce by 400ms so bulk edits don't thrash.
  const [errors, setErrors] = useState([]);
  const [warnings, setWarnings] = useState([]);
  const [showErrors, setShowErrors] = useState(true);
  const [showWarnings, setShowWarnings] = useState(true);
  useEffect(() => {
    if (!project) { setErrors([]); setWarnings([]); return; }
    let cancelled = false;
    const id = setTimeout(() => {
      if (cancelled) return;
      try {
        setErrors(validate(project));
        setWarnings(diagnose(project));
      } catch (e) { console.warn("[validate]", e && e.message); }
    }, 400);
    return () => { cancelled = true; clearTimeout(id); };
  }, [project]);
  if (!project) return <EmptyScreen />;
  const hasErr = errors.length > 0;
  const hasWarn = warnings.length > 0;
  // Click any row in either table to jump to that unit in the Units screen.
  // The DataTable doesn't expose a per-row click, so we wire it through a
  // synthetic onContextMenu-style flow: rowMenuExtras provides "Jump to
  // unit" which fires onView("units"). Useful when a teammate sees a list
  // of 30 errors and wants to fix each in turn.
  const jumpToUnit = (unitName) => { if (onView) onView("units"); };
  // Per-faction roster sanity. For each faction, count the unit
  // categories present in its ownership. Flag rosters that are missing
  // a fundamental class (Infantry / Missile / Cavalry) so the user
  // catches gaps before shipping a balance pass.
  const rosterReport = useMemo(() => {
    const factionKeys = (project.factions || []).map((f) => typeof f === "string" ? f : (f && (f.Faction || f.faction || f.name) || "")).filter(Boolean);
    const buckets = ["Infantry", "Missile Infantry", "Missile Cavalry", "Cavalry", "Other"];
    const bucketOf = (cat, cls) => {
      const c = String(cat || "").toLowerCase();
      const k = String(cls || "").toLowerCase();
      if (c.includes("missile") && c.includes("mounted")) return "Missile Cavalry";
      if (c.includes("missile")) return "Missile Infantry";
      if (c.includes("mounted") || c.includes("chariot") || c.includes("camel") || c.includes("elephant")) return "Cavalry";
      if (c.includes("infantry") || k.includes("infantry") || k.includes("spearman") || k.includes("hoplite") || k.includes("legion")) return "Infantry";
      return "Other";
    };
    const out = factionKeys.map((f) => {
      const counts = Object.fromEntries(buckets.map((b) => [b, 0]));
      let total = 0;
      for (const u of project.units) {
        if (u.kind !== "unit") continue;
        const own = u.availability && u.availability[f];
        if (own !== "Y") continue;
        const b = bucketOf(u["Category"], u["class"]);
        counts[b] = (counts[b] || 0) + 1;
        total++;
      }
      const missing = ["Infantry", "Missile Infantry", "Cavalry"].filter((b) => (counts[b] || 0) === 0);
      return { faction: f, total, counts, missing };
    });
    return out.filter((r) => r.total > 0);
  }, [project]);
  const rosterIssues = rosterReport.filter((r) => r.missing.length > 0);
  return (
    <div className="screen">
      <h2>Validate <span className="dim">(auto · {errors.length} err · {warnings.length} warn · {rosterIssues.length} roster gap{rosterIssues.length === 1 ? "" : "s"})</span></h2>
      <div className="actions" style={{ marginBottom: 12 }}>
        <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, color: "#aaa" }}>
          <input type="checkbox" checked={showErrors} onChange={(e) => setShowErrors(e.target.checked)} />
          show errors
        </label>
        <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, color: "#aaa" }}>
          <input type="checkbox" checked={showWarnings} onChange={(e) => setShowWarnings(e.target.checked)} />
          show warnings
        </label>
        {!hasErr && !hasWarn && <span className="ok">✓ No issues found.</span>}
      </div>
      {rosterReport.length > 0 && (
        <details style={{ marginBottom: 12, background: "rgba(220,166,74,0.04)", border: "1px solid rgba(220,166,74,0.18)", borderRadius: 6, padding: 8 }}>
          <summary style={{ cursor: "pointer", color: "#dca64a", fontWeight: 600, fontSize: 13 }}>
            Roster sanity — per-faction category counts {rosterIssues.length > 0 ? `(${rosterIssues.length} gaps)` : "(all factions covered)"}
          </summary>
          <div style={{ marginTop: 10, display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 8 }}>
            {rosterReport.map((r) => (
              <div key={r.faction} style={{ background: r.missing.length ? "rgba(214,108,108,0.07)" : "rgba(124,201,153,0.04)", border: "1px solid " + (r.missing.length ? "rgba(214,108,108,0.4)" : "rgba(124,201,153,0.25)"), borderRadius: 6, padding: 8, fontSize: 11.5, fontFamily: "Consolas, monospace" }}>
                <div style={{ display: "flex", justifyContent: "space-between", color: "#ddd", fontWeight: 600 }}>
                  <span>{r.faction}</span>
                  <span style={{ color: "#888" }}>{r.total} units</span>
                </div>
                <div style={{ marginTop: 4, color: "#aaa" }}>
                  {Object.entries(r.counts).map(([k, v]) => (
                    <span key={k} style={{ marginRight: 10, color: v === 0 && (k === "Infantry" || k === "Missile Infantry" || k === "Cavalry") ? "#d66c6c" : "#9b9" }}>
                      {k}: {v}
                    </span>
                  ))}
                </div>
                {r.missing.length > 0 && (
                  <div style={{ color: "#d66c6c", marginTop: 4, fontSize: 11 }}>
                    Missing: {r.missing.join(", ")}
                  </div>
                )}
              </div>
            ))}
          </div>
        </details>
      )}
      {showErrors && hasErr && (
        <>
          <h3 style={{ marginTop: 16 }}>Errors</h3>
          <DataTable
            columns={["Unit", "Row", "Category", "Message"]}
            rows={errors.map((e) => [e.unit, e.row ?? "—", e.category || "", e.message])}
            rowIds={errors.map((e) => e.unit)}
            maxHeight="35vh"
            searchable
            rowMenuExtras={[
              { label: "Jump to unit (Units screen)", onClick: (unitName) => jumpToUnit(unitName) },
            ]}
          />
        </>
      )}
      {showWarnings && hasWarn && (
        <>
          <h3 style={{ marginTop: 24 }}>Warnings — data drift</h3>
          <p className="dim" style={{ marginTop: 0, marginBottom: 8 }}>
            These don't block export, but the flagged stats will compute as 0 until you fix the reference.
          </p>
          <DataTable
            columns={["Unit", "Row", "Category", "Message"]}
            rows={warnings.map((w) => [w.unit, w.row ?? "—", w.category || "", w.message])}
            rowIds={warnings.map((w) => w.unit)}
            maxHeight="35vh"
            searchable
            rowMenuExtras={[
              { label: "Jump to unit (Units screen)", onClick: (unitName) => jumpToUnit(unitName) },
            ]}
          />
        </>
      )}
    </div>
  );
}

function PreviewScreen({ project }) {
  // Auto-compute on project change. Manual button was redundant — Sync /
  // Validate already triggered compute under the hood. Debounced 600ms
  // so bulk edits don't thrash; for a real project compute() is in the
  // 100-500ms range.
  const [rows, setRows] = useState(null);
  const [eduText, setEduText] = useState("");
  const [tab, setTab] = useState("data");        // "data" | "text"
  useEffect(() => {
    if (!project) { setRows(null); setEduText(""); return; }
    let cancelled = false;
    const id = setTimeout(() => {
      if (cancelled) return;
      try {
        const r = compute(project);
        setRows(r);
        try { setEduText(formatEdu(r, project)); } catch (e) { setEduText("// formatEdu failed: " + e.message); }
      } catch (e) {
        console.warn("[preview compute]", e && e.message);
        setRows(null); setEduText("// compute failed: " + e.message);
      }
    }, 600);
    return () => { cancelled = true; clearTimeout(id); };
  }, [project]);
  if (!project) return <EmptyScreen />;
  const dataRows = rows?.filter((r) => r.kind === "data") || [];
  // Preview column ordering follows the EDUMatic DATA sheet layout so
  // the preview reads like the spreadsheet the modteam already knows.
  // Anything we compute that isn't in the canonical list falls through
  // to the end so we never silently hide a column.
  const cols = (() => {
    if (!dataRows[0]) return [];
    const present = new Set(Object.keys(dataRows[0]).filter((k) => k !== "kind" && k !== "row" && k !== "name" && k !== "ownership"));
    const ordered = [];
    for (const k of PREVIEW_EDU_ORDER) if (present.has(k)) { ordered.push(k); present.delete(k); }
    for (const k of present) ordered.push(k);
    return ordered;
  })();
  return (
    <div className="screen">
      <h2>Preview EDU <span className="dim">(auto · {dataRows.length} unit rows · {eduText ? Math.round(eduText.length / 1024) + "kb" : ""} text)</span></h2>
      <div className="actions" style={{ marginBottom: 8 }}>
        <button className={"btn" + (tab === "data" ? " btn-accent" : "")} onClick={() => setTab("data")}>Computed DATA</button>
        <button className={"btn" + (tab === "text" ? " btn-accent" : "")} onClick={() => setTab("text")}>Formatted EDU text</button>
        <button className="btn" onClick={async () => {
          try { await navigator.clipboard.writeText(eduText); } catch {}
        }} title="Copy the entire formatted EDU text to clipboard" disabled={!eduText}>Copy text</button>
      </div>
      {tab === "data" && rows && (
        <DataTable
          columns={["Unit", ...cols]}
          rows={dataRows.map((r) => [r.name, ...cols.map((c) => r[c])])}
          maxHeight="70vh"
          searchable
          pinFirstColumn
        />
      )}
      {tab === "text" && (
        <pre style={{ background: "#0e0e0e", border: "1px solid #2a2a2a", borderRadius: 6, padding: 12, maxHeight: "70vh", overflow: "auto", fontFamily: "Consolas, monospace", fontSize: 11, color: "#ddd", whiteSpace: "pre", margin: 0 }}>
          {eduText || "// computing…"}
        </pre>
      )}
    </div>
  );
}

function ExportScreen({ project, onExport, modDataDir }) {
  const [baseName, setBaseName] = useState("export_descr_unit");
  const [running, setRunning] = useState(false);
  const [preview, setPreview] = useState(null);
  const [lastExport, setLastExport] = useState(() => localStorage.getItem("rt:eduLastExport") || null);
  const [syncStatus, setSyncStatus] = useState(null);
  if (!project) return <EmptyScreen />;

  // Reorder text/export_units.txt blocks to match the project's EDU
  // unit sequence. Uses dictionary_tag (with underscores) when present
  // — that's what RTW actually looks up — falling back to unit id /
  // name. Idempotent: rerunning produces no change once the file is
  // already in EDU order.
  const doSyncExportUnitsOrder = async () => {
    if (!modDataDir || !window.eduAPI?.syncExportUnitsOrder) {
      setSyncStatus({ ok: false, msg: "modDataDir not set or IPC unavailable" });
      return;
    }
    const ordered = [];
    const seen = new Set();
    for (const u of project.units || []) {
      if (!u || u.kind !== "unit") continue;
      const k = String(u["dictionary_tag"] || u["unit id"] || u.name || "").trim();
      if (k && !seen.has(k)) { ordered.push(k); seen.add(k); }
    }
    setSyncStatus({ ok: false, msg: "Working…" });
    try {
      const r = await window.eduAPI.syncExportUnitsOrder(modDataDir, ordered);
      if (r?.ok) setSyncStatus({ ok: true, msg: `✓ reordered ${r.ordered} blocks (+${r.trailing} trailing not in EDU)` });
      else setSyncStatus({ ok: false, msg: r?.reason || "sync failed" });
    } catch (e) { setSyncStatus({ ok: false, msg: e.message || "threw" }); }
  };

  const doExport = async () => {
    setRunning(true);
    try {
      const rows = compute(project);
      const text = formatEdu(rows, project);
      const path = await onExport(text, baseName);
      if (path) {
        setLastExport(path);
        try { localStorage.setItem("rt:eduLastExport", path); } catch {}
      }
    } finally { setRunning(false); }
  };

  const doPreview = () => {
    setRunning(true);
    setTimeout(() => {
      try {
        const text = formatEdu(compute(project), project);
        setPreview(text);
      } finally { setRunning(false); }
    }, 10);
  };

  return (
    <div className="screen">
      <h2>Export EDU</h2>
      <div className="card">
        <p className="dim">
          Runs compute → format → writes a timestamped <code>.txt</code> into the folder
          you pick. Output should drop into your mod's <code>data/</code> next to the
          original <code>export_descr_unit.txt</code>.
        </p>
        <div className="field">
          <span>Base name</span>
          <input className="input" value={baseName} onChange={(e) => setBaseName(e.target.value)} />
        </div>
        <div className="actions">
          <button className="btn btn-accent" onClick={doExport} disabled={running}>
            {running ? "Working…" : "Export EDU…"}
          </button>
          <button className="btn" onClick={doPreview} disabled={running}>Preview EDU text</button>
          <button className="btn" onClick={doSyncExportUnitsOrder} disabled={!modDataDir} title={modDataDir ? "Reorder text/export_units.txt blocks to match the EDU project's unit sequence (uses dictionary_tag)." : "Set the mod data folder first"}>
            Sync export_units.txt order
          </button>
        </div>
        {syncStatus && (
          <div style={{ marginTop: 8, fontSize: 11, color: syncStatus.ok ? "#7c9" : "#dca64a" }}>{syncStatus.msg}</div>
        )}
        {lastExport && (
          <div className="field" style={{ marginTop: 12, alignItems: "center" }}>
            <span>Last export</span>
            <strong style={{ fontFamily: "Consolas, monospace", fontSize: 11, wordBreak: "break-all", color: "#aaa" }}>{lastExport}</strong>
            <button
              className="btn"
              style={{ marginLeft: 6 }}
              onClick={() => { if (window.eduAPI?.openPath) window.eduAPI.openPath(lastExport); }}
              title="Open the file in your default editor"
            >Open</button>
          </div>
        )}
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <p className="dim">
          Mercenary pool file (<code>descr_mercenaries.txt</code>) — regenerated from
          the Merc Definitions sheet using current computed unit costs.
        </p>
        <div className="actions">
          <button className="btn btn-accent" onClick={async () => {
            setRunning(true);
            try {
              const text = formatMerc(project);
              await onExport(text, "descr_mercenaries");
            } finally { setRunning(false); }
          }} disabled={running}>
            {running ? "Working…" : "Export mercenaries…"}
          </button>
          <button className="btn" onClick={() => {
            setRunning(true);
            setTimeout(() => {
              try { setPreview(formatMerc(project)); } finally { setRunning(false); }
            }, 10);
          }} disabled={running}>Preview merc text</button>
        </div>
      </div>

      {preview && (
        <div style={{ marginTop: 24 }}>
          <h3>Preview <span className="dim">({preview.split("\n").length} lines)</span></h3>
          <pre style={{
            maxHeight: "60vh", overflow: "auto", fontSize: 11, lineHeight: 1.4,
            fontFamily: "var(--mono)", background: "var(--bg-elev)",
            border: "1px solid var(--border)", borderRadius: 4, padding: 12,
            whiteSpace: "pre", color: "var(--fg)",
          }}>{preview.slice(0, 40000)}{preview.length > 40000 ? "\n…\n[truncated, full content in exported file]" : ""}</pre>
        </div>
      )}
    </div>
  );
}

function EmptyScreen() {
  return (
    <div className="screen">
      <p className="dim">No project loaded — import an .xlsm on the Project screen.</p>
    </div>
  );
}
