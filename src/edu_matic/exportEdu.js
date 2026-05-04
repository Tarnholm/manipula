// exportEdu.js — thin wrapper around the renderer pipeline that produces
// the full .txt on disk via main-process IPC.
//
// Takes a Project, runs compute() + formatEdu() on it, picks an output
// folder, and writes the timestamped file. Returns the final file path
// (or null on cancel / failure).


import { compute } from "./compute";
import { formatEdu } from "./format";

/**
 * @param {import("./xlsmImporter").Project} project
 * @param {string} outDir                 target folder (already chosen)
 * @param {string} [baseName]             default "export_descr_unit"
 * @returns {Promise<string|null>}
 */
async function exportEdu(project, outDir, baseName = "export_descr_unit") {
  if (typeof window === "undefined" || !window.eduAPI) {
    throw new Error("exportEdu must run in the Electron renderer (requires window.eduAPI).");
  }
  const text = buildEduText(project);
  return await window.eduAPI.exportEdu(text, outDir, baseName);
}

/**
 * Build the EDU text for a project. Always re-computes from raw data
 * (UnitDefinitions + CoreData + ArmourDefinitions) so that any edit to
 * the xlsm is reflected in the output. The workbook's cached Output
 * sheet, if present, is not used here — that's a diagnostic-only path
 * exposed via scripts/diff-output-edu.js.
 *
 * @param {import("./xlsmImporter").Project} project
 * @returns {string}
 */
function buildEduText(project) {
  return formatEdu(compute(project), project);
}

export { exportEdu, buildEduText };
