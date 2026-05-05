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

// Embedded mode: when running inside the recruitment-tool, the parent owns the project
// state, the import action, and which sub-view is shown. We become a thin renderer.
//   - externalProject: parent-owned project (when set, overrides internal state)
//   - onProjectChange: called after a successful import so the parent can lift the state
//   - controlledView / onControlledView: parent drives the sub-view tab strip
//   - hideSidebar: hide EDU-matic's own brand + nav (parent has its own)
//   - jumpToUnit: when the parent jumps from the recruitment editor, scroll the Units screen
//                 to that unit on mount
export default function App({ externalProject = null, onProjectChange, controlledView, onControlledView, hideSidebar = false, jumpToUnit = null, modDataDir = null } = {}) {
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
        {view === "modinfo"  && <ModInfoScreen  project={project} setProject={setProject} />}
        {view === "coredata" && <CoreDataScreen project={project} setProject={setProject} />}
        {view === "units"    && <UnitsScreen    project={project} setProject={setProject} modDataDir={modDataDir} />}
        {view === "bulk"     && <BulkEditScreen project={project} setProject={setProject} />}
        {view === "armour"   && <ArmourScreen   project={project} setProject={setProject} />}
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
        <strong style={{ color: "#dca64a" }}>Credits — EDU pipeline:</strong> The compute / format / validate pipeline used here ports the VBA macros from the <strong>EDU-matic</strong> spreadsheet. <strong>Aradan</strong> built the original spreadsheet that this whole lineage descends from. <strong>Tone</strong> did the bulk of the adaptation work on top of Aradan's original — most of the VBA coding, the 512-column DATA layout, the VLOOKUP-driven core-data tables, and the balance-formula semantics that this JavaScript port mirrors are Tone's work. <strong>BiggusDickus (BD)</strong> contributed smaller more recent updates ("BD's New Base"). Manipula bundles their work into the same window as recruitment authoring; the EDU-matic logic and the underlying balance design are theirs.
      </div>
    </div>
  );
}

function ModInfoScreen({ project, setProject }) {
  if (!project) return <EmptyScreen />;
  const mi = project.modInfo;
  const g = project.globals;
  // Webhook URL — POSTed to as a Discord-style {content: "..."} payload on
  // every successful Commit + Push. Edited inline; saved with the project.
  const setWebhook = (url) => {
    setProject({ ...project, modInfo: { ...mi, webhookUrl: url || "" } });
  };
  return (
    <div className="screen">
      <h2>Mod Info</h2>
      <div className="card">
        <div className="field"><span>Name</span><strong>{mi.name}</strong></div>
        <div className="field"><span>Platform</span><strong>{mi.platform}</strong></div>
        <div className="field"><span>Era</span><strong>{mi.era || "—"}</strong></div>
        <div className="field" style={{ alignItems: "center" }}>
          <span>Webhook URL</span>
          <input
            className="input"
            placeholder="https://discord.com/api/webhooks/…"
            value={mi.webhookUrl || ""}
            onChange={(e) => setWebhook(e.target.value)}
            style={{ flex: 1, minWidth: 280 }}
            title="Posted to as {content: 'Manipula push — <message>'} on every successful push. Discord webhooks work directly; for Slack/Teams adapt the payload server-side."
          />
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

  if (!project) return <EmptyScreen />;
  if (!active) return <div className="screen"><h2>Core Data</h2><p>No tables.</p></div>;
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
      </div>
      <DataTable
        columns={columns}
        rows={rows.map((r) => columns.map((c) => r[c]))}
        rowIds={rows.map((_, i) => i)}
        onEdit={onEdit}
        editable={unlocked}
        maxHeight="65vh"
        searchable
        onAddRow={unlocked ? addBlank : null}
        onDuplicateRow={unlocked ? duplicateRow : null}
        onDeleteRow={unlocked ? deleteRow : null}
        addRowLabel="+ New row"
      />
    </div>
  );
}

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
const UNITS_HEAD = [
  "name", "Entries", "Recruitment", "Quality", "Category", "Specialty",
  "Formation", "Dwelling", "Culture", "Weapon", "Wpn Quality",
  "Projectile", "Melee Skeleton", "Sec Weapon", "S Wpn Quality",
  "S Melee Skeleton", "Armour Upgr0", "Armour Upgr1", "Armour Upgr2",
  "Armour Upgr3", "Mount", "Special", "Mount Skeleton", "Engine",
  "Engine Pri Proj", "Engine Sec Proj", "Ship", "unit id", "dictionary_tag",
  "voice_type", "voice_indexes", "faction banner", "holy banner",
  "unit variation", "model id", "officer 1", "officer 2", "officer 3",
  "officer 4", "officer 5", "ship id", "engine id", "animal id", "mount id",
  "general unit", "merc unit", "horde unit", "unique unit",
  "impetuous unit", "no CBs", "pri missile type", "engine missile type",
  "sec eng missile type", "arm upg mdl 1", "arm upg mdl 2", "arm upg mdl 3",
  "rec priority",
];
const UNITS_TAIL = [
  "ethnicity region", "ethnicity attributes", "tattoo colour", "hair colour",
  "hair style", "info pic dir", "card pic dir", "comments", "Tier", "Turns",
];

function UnitsScreen({ project, setProject, modDataDir }) {
  if (!project) return <EmptyScreen />;
  const units = project.units.filter((u) => u.kind === "unit");
  // Filter chips: faction (from availability) and category. Empty string
  // means "no filter on this axis." Stored as state local to the screen.
  const [filterFaction, setFilterFaction] = useState("");
  const [filterCategory, setFilterCategory] = useState("");
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
  //   - avail:<faction> columns are numbered "faction 1 .. N" by canonical
  //     position, plus "slave" for the last availability key. Numbered
  //     labels avoid the visual noise of long faction-key names in a table
  //     that's already 50+ columns wide.
  //   - own:<i> columns labeled "ownership_1 .. ownership_4".
  const columnLabels = useMemo(() => {
    const out = { name: "Unit Name" };
    factionKeys.forEach((f, i) => { out[AVAIL_PREFIX + f] = `faction ${i + 1}`; });
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
    const key = unit && (unit["unit id"] || unit["dictionary_tag"] || unit.name);
    if (!key) return;
    const display = unit && (unit.name || key);
    try {
      const r = await window.eduAPI.appendExportUnitsStub(modDataDir, String(key), String(display));
      if (!r || !r.ok) console.warn("[edu] export_units stub failed:", r && r.reason);
    } catch (e) { console.warn("[edu] export_units stub threw:", e.message); }
  }, [modDataDir]);

  const addBlankUnit = useCallback(() => {
    const blank = { kind: "unit", row: 0, name: "" };
    setProject({ ...project, units: [...project.units, blank] });
  }, [project, setProject]);
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
      const next = { ...cur, availability: nextAvail };
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

  // Per-row validation flags. validate(project) returns an array of
  // ErrorEntry { unit, row, message }; diagnose(project) returns warnings
  // with the same shape. We bucket both by unit name so the per-row flag
  // computation below is O(1) per row instead of scanning the array.
  const validationByName = useMemo(() => {
    const out = new Map();
    try {
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
    } catch (err) { console.warn("[edu] validate failed:", err && err.message); }
    return out;
  }, [project]);

  // rowFlags keyed by rowId (= original index in project.units, per
  // UnitsScreen's rowIds construction).
  const rowFlags = useMemo(() => {
    const out = {};
    for (let idx = 0; idx < project.units.length; idx++) {
      const u = project.units[idx];
      if (!u || u.kind !== "unit") continue;
      const f = validationByName.get(u.name);
      if (f) out[idx] = f;
    }
    return out;
  }, [project.units, validationByName]);

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

  return (
    <div className="screen">
      <h2>Units <span className="dim">({units.length})</span></h2>
      <p className="dim" style={{ marginTop: -6, marginBottom: 8, fontSize: 12 }}>
        Click any cell to edit. Lookup fields (Category, Quality, Weapon, …) open as dropdowns. Ctrl/Shift-click rows to multi-select. Right-click for row ops.
      </p>
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
        addRowLabel="+ New unit"
        rowMenuExtras={modDataDir ? [{
          label: "Stub in export_units.txt",
          onClick: (idx) => { const u = project.units[idx]; if (u) stubInExportUnits(u); },
        }] : null}
        bulkActions={[
          {
            label: "Set field on selected…",
            onClick: (rowIds) => {
              const col = window.prompt("Field name to set on the selected units:", bulkColumn || "Category");
              if (!col) return;
              const val = window.prompt(`New value for "${col}" (blank to clear):`, "");
              if (val === null) return;
              setBulkColumn(col);
              setBulkValue(val);
              applyBulk(rowIds, col, val);
            },
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
          { label: "Delete selected", destructive: true, onClick: bulkDelete },
        ]}
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

function ArmourScreen({ project, setProject }) {
  if (!project) return <EmptyScreen />;
  const rows = project.armour || [];

  // Column order: Model Set Name (pinned), then for each body slot a Type
  // and Material column, then Shield Size + Shield Material at the end.
  const cols = useMemo(() => {
    const out = ["Model Set Name"];
    for (const s of ARMOUR_BODY_SLOTS) {
      out.push(`${ARM_PREFIX}${s}:type`);
      out.push(`${ARM_PREFIX}${s}:material`);
    }
    out.push(`${ARM_PREFIX}Shield:size`);
    out.push(`${ARM_PREFIX}Shield:material`);
    return out;
  }, []);

  const columnLabels = useMemo(() => {
    const out = {};
    for (const s of ARMOUR_BODY_SLOTS) {
      out[`${ARM_PREFIX}${s}:type`] = `${s} Type`;
      out[`${ARM_PREFIX}${s}:material`] = `${s} Material`;
    }
    out[`${ARM_PREFIX}Shield:size`] = "Shield Size";
    out[`${ARM_PREFIX}Shield:material`] = "Shield Material";
    return out;
  }, []);

  // Edit metadata: dropdown options gathered from the actual data so users
  // pick from existing types/materials/sizes (mirrors how UnitsScreen
  // sources options from coreData tables).
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
      const types = collect(s, "type");
      const mats  = collect(s, "material");
      if (types.length) meta[`${ARM_PREFIX}${s}:type`] = { type: "select", options: ["", ...types] };
      if (mats.length)  meta[`${ARM_PREFIX}${s}:material`] = { type: "select", options: ["", ...mats] };
    }
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
      if (newValue === "" || newValue == null) nextSlot[field] = null;
      else nextSlot[field] = newValue;
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
    if (copy["Model Set Name"]) copy["Model Set Name"] = copy["Model Set Name"] + " (copy)";
    const next = rows.slice(); next.splice(idx + 1, 0, copy);
    setProject({ ...project, armour: next });
  }, [rows, project, setProject]);
  const insertBlankArmourBelow = useCallback((idx) => {
    if (typeof idx !== "number" || idx < 0) return;
    const blank = { row: 0, "Model Set Name": "" };
    const next = rows.slice(); next.splice(idx + 1, 0, blank);
    setProject({ ...project, armour: next });
  }, [rows, project, setProject]);
  const deleteArmour = useCallback((idx) => {
    if (typeof idx !== "number" || idx < 0) return;
    const next = rows.slice(); next.splice(idx, 1);
    setProject({ ...project, armour: next });
  }, [rows, project, setProject]);

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
        addRowLabel="+ New armour set"
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
