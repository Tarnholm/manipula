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

// Embedded mode: when running inside the recruitment-tool, the parent owns the project
// state, the import action, and which sub-view is shown. We become a thin renderer.
//   - externalProject: parent-owned project (when set, overrides internal state)
//   - onProjectChange: called after a successful import so the parent can lift the state
//   - controlledView / onControlledView: parent drives the sub-view tab strip
//   - hideSidebar: hide EDU-matic's own brand + nav (parent has its own)
//   - jumpToUnit: when the parent jumps from the recruitment editor, scroll the Units screen
//                 to that unit on mount
export default function App({ externalProject = null, onProjectChange, controlledView, onControlledView, hideSidebar = false, jumpToUnit = null } = {}) {
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
        {view === "project"  && <ProjectScreen  project={project} onImport={importXlsm} />}
        {view === "modinfo"  && <ModInfoScreen  project={project} />}
        {view === "coredata" && <CoreDataScreen project={project} />}
        {view === "units"    && <UnitsScreen    project={project} />}
        {view === "bulk"     && <BulkEditScreen project={project} setProject={setProject} />}
        {view === "armour"   && <ArmourScreen   project={project} />}
        {view === "merc"     && <MercScreen     project={project} />}
        {view === "validate" && <ValidateScreen project={project} />}
        {view === "preview"  && <PreviewScreen  project={project} />}
        {view === "export"   && <ExportScreen   project={project} onExport={exportEdu} />}
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

function ProjectScreen({ project, onImport }) {
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
        <strong style={{ color: "#dca64a" }}>Credits — EDU pipeline:</strong> The compute / format / validate pipeline used here ports the VBA macros from <strong>BD's New Base</strong> EDUMatic spreadsheet. <strong>BiggusDickus (BD)</strong> built the original spreadsheet — the balance system, formula semantics, the 512-column DATA layout and the VLOOKUP-driven core-data tables are all his work. <strong>Aradan</strong> developed and maintains the EDU-matic toolset that this JavaScript port is based on. Manipula bundles their work into the same window as recruitment authoring; the EDU-matic logic and the underlying balance design are theirs.
      </div>
    </div>
  );
}

function ModInfoScreen({ project }) {
  if (!project) return <EmptyScreen />;
  const mi = project.modInfo;
  const g = project.globals;
  return (
    <div className="screen">
      <h2>Mod Info</h2>
      <div className="card">
        <div className="field"><span>Name</span><strong>{mi.name}</strong></div>
        <div className="field"><span>Platform</span><strong>{mi.platform}</strong></div>
        <div className="field"><span>Era</span><strong>{mi.era || "—"}</strong></div>
      </div>
      <h3 style={{ marginTop: 24 }}>Globals ({Object.keys(g).length})</h3>
      <DataTable
        columns={["Name", "Value"]}
        rows={Object.entries(g).sort(([a],[b]) => a.localeCompare(b)).map(([k, v]) => [k, v])}
        maxHeight="60vh"
        searchable
      />
    </div>
  );
}

function CoreDataScreen({ project }) {
  const tables = project?.coreData || {};
  const names = Object.keys(tables);
  const [active, setActive] = useState(names[0] || null);
  if (!project) return <EmptyScreen />;
  if (!active) return <div className="screen"><h2>Core Data</h2><p>No tables.</p></div>;
  const rows = tables[active] || [];
  const columns = rows[0] ? Object.keys(rows[0]) : [];
  return (
    <div className="screen">
      <h2>Core Data</h2>
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
      </div>
      <DataTable
        columns={columns}
        rows={rows.map((r) => columns.map((c) => r[c]))}
        maxHeight="65vh"
        searchable
      />
    </div>
  );
}

function UnitsScreen({ project }) {
  if (!project) return <EmptyScreen />;
  const units = project.units.filter((u) => u.kind === "unit");
  // Collect all columns that appear in any unit (minus ownership — shown separately).
  const allKeys = useMemo(() => {
    const s = new Set();
    for (const u of units) for (const k of Object.keys(u)) if (k !== "ownership" && k !== "kind" && k !== "row") s.add(k);
    // Put a few important keys first.
    const priority = ["name", "Category", "Recruitment", "Quality", "Specialty", "Culture", "Weapon", "unit id", "dictionary_tag"];
    const ordered = priority.filter((k) => s.has(k));
    for (const k of s) if (!ordered.includes(k)) ordered.push(k);
    return ordered;
  }, [units]);
  return (
    <div className="screen">
      <h2>Units <span className="dim">({units.length})</span></h2>
      <DataTable
        columns={allKeys}
        rows={units.map((u) => allKeys.map((k) => u[k]))}
        maxHeight="75vh"
        searchable
      />
    </div>
  );
}

// BulkEditScreen — filter EDU rows by any string field, then apply set/add/multiply/append
// to a chosen field across all matched rows. Shows a live preview of the affected rows.
function BulkEditScreen({ project, setProject }) {
  const [filterField, setFilterField] = useState("");
  const [filterMatch, setFilterMatch] = useState("");
  const [editField, setEditField] = useState("");
  const [op, setOp] = useState("set");
  const [value, setValue] = useState("");
  if (!project) return <EmptyScreen />;
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

function ArmourScreen({ project }) {
  if (!project) return <EmptyScreen />;
  const rows = project.armour;
  const slotKeys = ["Head1","Head2","Torso1","Torso2","Torso3","UpArm","LowArm","Hand","UpLeg","LowLeg","Foot","Shield"];
  const cols = ["Model Set Name", ...slotKeys];
  return (
    <div className="screen">
      <h2>Armour Models <span className="dim">({rows.length})</span></h2>
      <DataTable
        columns={cols}
        rows={rows.map((r) => cols.map((c) => {
          if (c === "Model Set Name") return r[c];
          const v = r[c];
          if (!v) return "";
          const parts = [];
          if (v.type)     parts.push(v.type);
          if (v.material) parts.push(v.material);
          if (v.size)     parts.push(v.size);
          if (v.onBack)   parts.push(`(onBack: ${v.onBack})`);
          return parts.join(" · ");
        }))}
        maxHeight="75vh"
        searchable
      />
    </div>
  );
}

function MercScreen({ project }) {
  if (!project) return <EmptyScreen />;
  const rows = project.merc;
  const cols = rows[0] ? Object.keys(rows[0]).filter((k) => k !== "row") : [];
  return (
    <div className="screen">
      <h2>Mercenaries <span className="dim">({rows.length})</span></h2>
      <DataTable
        columns={cols}
        rows={rows.map((r) => cols.map((c) => r[c]))}
        maxHeight="75vh"
        searchable
      />
    </div>
  );
}

function ValidateScreen({ project }) {
  const [errors, setErrors] = useState(null);
  const [warnings, setWarnings] = useState(null);
  const [running, setRunning] = useState(false);
  if (!project) return <EmptyScreen />;
  const run = () => {
    setRunning(true);
    setTimeout(() => {
      try {
        setErrors(validate(project));
        setWarnings(diagnose(project));
      } finally { setRunning(false); }
    }, 10);
  };
  const hasErr = errors && errors.length > 0;
  const hasWarn = warnings && warnings.length > 0;
  return (
    <div className="screen">
      <h2>Validate</h2>
      <div className="actions">
        <button className="btn btn-accent" onClick={run} disabled={running}>
          {running ? "Running…" : "Run validate"}
        </button>
        {errors && (
          <span className={`dim ${hasErr ? "err" : "ok"}`}>
            {hasErr
              ? `${errors.length} error${errors.length === 1 ? "" : "s"}`
              : "✓ No errors"}
            {warnings && warnings.length > 0 &&
              ` · ${warnings.length} warning${warnings.length === 1 ? "" : "s"}`}
          </span>
        )}
      </div>
      {hasErr && (
        <>
          <h3 style={{ marginTop: 24 }}>Errors</h3>
          <DataTable
            columns={["Unit", "Row", "Category", "Message"]}
            rows={errors.map((e) => [e.unit, e.row ?? "—", e.category || "", e.message])}
            maxHeight="35vh"
            searchable
          />
        </>
      )}
      {hasWarn && (
        <>
          <h3 style={{ marginTop: 24 }}>Warnings — data drift</h3>
          <p className="dim" style={{ marginTop: 0, marginBottom: 8 }}>
            These don't block export, but the flagged stats will compute as 0 until you fix the reference.
          </p>
          <DataTable
            columns={["Unit", "Row", "Category", "Message"]}
            rows={warnings.map((w) => [w.unit, w.row ?? "—", w.category || "", w.message])}
            maxHeight="35vh"
            searchable
          />
        </>
      )}
    </div>
  );
}

function PreviewScreen({ project }) {
  const [rows, setRows] = useState(null);
  const [running, setRunning] = useState(false);
  if (!project) return <EmptyScreen />;
  const run = () => {
    setRunning(true);
    setTimeout(() => {
      try { setRows(compute(project)); } finally { setRunning(false); }
    }, 10);
  };
  const dataRows = rows?.filter((r) => r.kind === "data") || [];
  const cols = dataRows[0]
    ? Object.keys(dataRows[0]).filter((k) => k !== "kind" && k !== "row" && k !== "name" && k !== "ownership")
    : [];
  return (
    <div className="screen">
      <h2>Preview Computed DATA</h2>
      <div className="actions">
        <button className="btn btn-accent" onClick={run} disabled={running}>
          {running ? "Computing…" : "Compute"}
        </button>
        {rows && <span className="dim">{dataRows.length} unit rows · {cols.length} computed cols</span>}
      </div>
      {rows && (
        <DataTable
          columns={["Unit", ...cols]}
          rows={dataRows.map((r) => [r.name, ...cols.map((c) => r[c])])}
          maxHeight="70vh"
          searchable
        />
      )}
      {rows && (
        <p className="dim" style={{ marginTop: 16 }}>
          The format.js stage (DATA → EDU text blocks) hasn't been ported yet — the Export screen will be wired up in the next pass.
        </p>
      )}
    </div>
  );
}

function ExportScreen({ project, onExport }) {
  const [baseName, setBaseName] = useState("export_descr_unit");
  const [running, setRunning] = useState(false);
  const [preview, setPreview] = useState(null);
  if (!project) return <EmptyScreen />;

  const doExport = async () => {
    setRunning(true);
    try {
      const rows = compute(project);
      const text = formatEdu(rows, project);
      await onExport(text, baseName);
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
        </div>
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
