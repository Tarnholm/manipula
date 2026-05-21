// merc.js — mercenary pipeline (parallel to main compute/format).
//
// Produces the text content of descr_mercenaries.txt from the project's
// merc rows (pool / regions / unit entries). Each unit's cost defaults
// to the override in the merc row; if that's blank, falls back to the
// computed EDU cost × a global multiplier.


import { compute } from "./compute";

function num(v, dflt) {
  if (v === null || v === undefined || v === "") return dflt;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : dflt;
}

/** Build a cost lookup by unit id from computed DATA rows. */
function buildCostIndex(dataRows) {
  const m = new Map();
  for (const r of dataRows) {
    if (r.kind !== "data") continue;
    const id = r["type"];
    if (id) m.set(String(id).toLowerCase(), r["price"] || 0);
  }
  return m;
}

/** Resolve the merc cost multiplier — global override falls back to 1.8. */
function resolveMercMultiplier(project) {
  const g = project && project.globals ? project.globals : {};
  return num(g.MercCostMultiplier, 1.8);
}

/**
 * Compute the merc pool data — resolves each unit row's cost from
 * either its override or the computed EDU price × multiplier.
 *
 * @param {import("./xlsmImporter").Project} project
 * @param {number} [multiplier] defaults to project.globals.MercCostMultiplier (or 1.8)
 * @returns {Array<{kind:"pool"|"regions"|"unit"|"blank", text:string}>}
 */
function computeMerc(project, multiplier) {
  const mult = multiplier != null ? multiplier : resolveMercMultiplier(project);
  const dataRows = compute(project);
  const costIdx  = buildCostIndex(dataRows);
  const out = [];
  for (const m of project.merc || []) {
    if (m.kind === "pool") {
      out.push({ kind: "pool", text: `pool ${m.name}` });
    } else if (m.kind === "regions") {
      out.push({ kind: "regions", text: `regions ${m.list}` });
    } else if (m.kind === "unit") {
      const refKey = String(m.refUnitId || m.unitId || "").toLowerCase();
      const derived = costIdx.get(refKey);
      const cost = m.cost != null && m.cost !== "" ? num(m.cost, 0) : Math.round((derived ?? 0) * mult);
      const exp = num(m.exp, 0);
      const rmin = num(m.replenishMin, 0);
      const rmax = num(m.replenishMax, 0);
      const maxP = num(m.maxInPool, 1);
      const init = num(m.initial, 0);
      out.push({
        kind: "unit",
        text: `unit ${m.unitId}, exp ${exp} cost ${cost} replenish ${rmin} - ${rmax} max ${maxP} initial ${init}`,
      });
    } else if (m.kind === "blank") {
      out.push({ kind: "blank", text: "" });
    }
  }
  return out;
}

/**
 * Full descr_mercenaries.txt text.
 * @param {import("./xlsmImporter").Project} project
 * @returns {string}
 */
function formatMerc(project) {
  const rows = computeMerc(project);
  return rows.map((r) => r.text).join("\n") + "\n";
}

/**
 * Parse a descr_mercenaries.txt file into the project's merc row shape
 * — { kind: "pool"|"regions"|"unit"|"blank", … }. Dropped on purpose:
 *
 *   - cost (we recompute at format time from EDU price × multiplier so
 *     edits to a unit's EDU stats flow through to its merc cost without
 *     a manual re-keystroke)
 *   - line comments (`; …`) — we preserve no provenance here; users
 *     manage pools via the in-app pool list rather than file headers
 *
 * Blank lines collapse to a single { kind: "blank" } separator so the
 * round-tripped output keeps pool blocks visually grouped without
 * accumulating empty space on every re-import.
 *
 * @param {string} text full file contents
 * @returns {Array<object>} merc rows in project shape
 */
function parseDescrMercenaries(text) {
  const out = [];
  const lines = String(text || "").split(/\r?\n/);
  let lastBlank = false;
  for (const raw of lines) {
    const t = raw.trim();
    if (!t) {
      if (!lastBlank && out.length) { out.push({ kind: "blank" }); lastBlank = true; }
      continue;
    }
    if (t.startsWith(";")) continue;
    lastBlank = false;
    let m = t.match(/^pool\s+(.+)$/i);
    if (m) { out.push({ kind: "pool", name: m[1].trim() }); continue; }
    m = t.match(/^regions\s+(.+)$/i);
    if (m) { out.push({ kind: "regions", list: m[1].trim() }); continue; }
    m = t.match(/^unit\s+(.+?),\s*exp\s+(\d+)\s+cost\s+(\d+)\s+replenish\s+([\d.]+)\s*-\s*([\d.]+)\s+max\s+(\d+)\s+initial\s+(\d+)/i);
    if (m) {
      const id = m[1].trim();
      out.push({
        kind: "unit",
        unitId: id,
        exp: Number(m[2]),
        // cost left blank — recomputed from EDU price × multiplier at format time
        replenishMin: Number(m[4]),
        replenishMax: Number(m[5]),
        maxInPool: Number(m[6]),
        initial: Number(m[7]),
        refUnitId: id,
      });
    }
  }
  // Drop a trailing blank — purely cosmetic and we add a newline at the
  // end of formatMerc anyway.
  while (out.length && out[out.length - 1].kind === "blank") out.pop();
  return out;
}

/**
 * Refresh-only: pull the latest `regions` line for each existing pool
 * from a descr_mercenaries.txt file, leaving every other row untouched
 * (no roster changes, no replenish/max/initial drift). Pools that don't
 * exist in the file keep their current regions; pools that exist in the
 * file but not in the project are skipped (use parseDescrMercenaries +
 * full replace for that).
 *
 * @param {Array<object>} currentMerc the project's existing merc rows
 * @param {string} fileText           contents of descr_mercenaries.txt
 * @returns {{ merc: Array<object>, updated: number, missing: string[] }}
 */
function refreshRegionsFromFile(currentMerc, fileText) {
  const fileRegions = new Map();   // poolName → regions list (string)
  let curPool = null;
  for (const raw of String(fileText || "").split(/\r?\n/)) {
    const t = raw.trim();
    if (!t || t.startsWith(";")) continue;
    let m = t.match(/^pool\s+(.+)$/i);
    if (m) { curPool = m[1].trim(); continue; }
    m = t.match(/^regions\s+(.+)$/i);
    if (m && curPool && !fileRegions.has(curPool)) fileRegions.set(curPool, m[1].trim());
  }
  let updated = 0;
  const missing = [];
  const out = [];
  for (let i = 0; i < currentMerc.length; i++) {
    const row = currentMerc[i];
    if (row && row.kind === "pool") {
      const incoming = fileRegions.get(row.name);
      out.push(row);
      // Find the regions row that follows (if any). Preserve its position;
      // either swap its list or insert one if missing.
      const next = currentMerc[i + 1];
      if (incoming != null) {
        if (next && next.kind === "regions") {
          if ((next.list || "").trim() !== incoming) {
            out.push({ ...next, list: incoming });
            updated++;
          } else {
            out.push(next);
          }
          i++;   // we just consumed `next`
        } else {
          out.push({ kind: "regions", list: incoming });
          updated++;
        }
      } else {
        missing.push(row.name);
        if (next && next.kind === "regions") { out.push(next); i++; }
      }
      continue;
    }
    out.push(row);
  }
  return { merc: out, updated, missing };
}

export { computeMerc, formatMerc, parseDescrMercenaries, refreshRegionsFromFile, resolveMercMultiplier };
