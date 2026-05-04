// outputSheetReader.js — read the Output worksheet from an EDU-matic xlsm
// and emit the EDU text byte-for-byte as the VBA EDUFiller would.
//
// The Output sheet is the authoritative cache of every computed field the
// VBA pipeline produces. Re-deriving those values from UnitDefinitions +
// CoreData + ArmourDefinitions reproduces most of them correctly, but a
// handful of units have post-computation hand edits (ship armour, a few
// unit-specific armour overrides). Reading the cache directly matches
// 100% regardless of those edits — so we use this path when the user
// wants a line-for-line reproduction of what the VBA tool would have
// exported from the same workbook.
//
// Sheet layout (column A = keyword, columns B onwards = values):
//
//   row 14…    ; COMMENTS  <comment for unit>
//              type        <type>
//              dictionary  <dict>
//              category    <cat>
//              …
//              soldier|soldiers  <values>   ← for variation=0, row is
//                                            "soldier | model | men | ex | mass"
//                                            ; then 12 ";;" rows
//                                            ; for variation>0:
//                                            "soldiers | men | ex | mass"
//                                            "{"
//                                            "    default"
//                                            "    {"
//                                            [blank | model1..7]
//                                            "    }"
//                                            "}"
//              officer     <name>          ← five slots, empty = skip
//              ship|engine|animal|mount    ← skip if empty
//              mount_effect                ← skip if empty
//              attributes  <flag> <flag> … ← one flag per column, joined with ", "
//              formation   <vals>
//              stat_*      <vals>
//              recruit_priority_offset
//              ownership   <tags>
//              ethnicity   <tag, region, attrs>  (many rows)
//
// Intersperse lines ";<text>" at any point that the DATA sheet has a
// comment row. These appear as a single column-A cell "; ROMAN UNITS" etc.


const KEY_PAD = 24;

function pad24(s) {
  const k = String(s);
  return k + " ".repeat(Math.max(0, KEY_PAD - k.length));
}

function str(v) {
  if (v === null || v === undefined) return "";
  if (typeof v === "number") {
    // Excel stores integers as floats — round off 1e-10 fuzz. VBA CInt
    // already handled rounding upstream, so expect near-integer for
    // count-style fields. For decimals like 0.97 keep at most 3 places.
    if (Number.isInteger(v)) return String(v);
    return String(+v.toFixed(6)).replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "");
  }
  const s = String(v);
  return s.replace(/\r/g, "");
}

/** Parse one row from project.outputRows into {keyword, values[]}. */
function splitRow(row) {
  // Keyword keeps its leading whitespace — the Output sheet uses "    {",
  // "    default", "    }" for nested bracket lines and those leading
  // spaces are part of the emitted EDU indent. Strip only trailing
  // whitespace on the A cell, and preserve whitespace verbatim in values
  // (VBA-generated "ethnicity" cells include a trailing space after the
  // comma, so stripping it would break byte-exact reproduction).
  const keyword = (row[0] || "").replace(/\s+$/, "");
  const values = row.slice(1);
  while (values.length && values[values.length - 1] === "") values.pop();
  return { keyword, values };
}

/** True if this keyword is a bracket/default line in a variation soldier
 *  block (emitted even with no value). Accepts the leading-indented
 *  forms ("    default", "    {", "    }") as well as the un-indented
 *  outer braces. */
function isStructural(keyword) {
  const k = keyword.trimStart();
  return k === "{" || k === "}" || k === "default";
}

/**
 * Format one row into its EDU text representation, or null to skip the
 * row entirely (no line emitted). The sentinel `"__BLANK__"` means a
 * literal blank line preserved from the source.
 */
const BLANK = "__BLANK__";
function formatRow(row) {
  const { keyword, values } = row;
  const k = keyword.trim();

  // Pure blank row (no keyword, no values) → preserve as blank line. The
  // Output sheet uses these to separate unit blocks and to frame section
  // comments; the real EDU mirrors that spacing verbatim.
  if (!k && values.length === 0) return BLANK;

  // Variation model row: blank keyword, value in col B.
  if (!k && values.length > 0) return " ".repeat(KEY_PAD) + values[0];

  // ";;" rows are VBA placeholders for variation slots in
  // non-variation (single-model) units. Skip with no line.
  if (k === ";;") return null;

  // Section-header comment like "; NON REMASTERED ROMANS".
  if (k.startsWith(";") && !k.startsWith("; COMMENTS")) return k;

  // "; COMMENTS  <text>"
  if (k === "; COMMENTS") return pad24("; COMMENTS") + (values[0] || "");

  // Structural bracket lines — emit the padded keyword even when empty.
  if (isStructural(k)) return pad24(keyword);

  // Ordinary keyword row with no value(s) → skip. This covers the many
  // "reserved" rows (banner faction, mount_effect, stat_pri_ex, era 0,
  // empty ethnicity, etc.) that VBA leaves in the sheet but never
  // writes to the EDU.
  const nonEmpty = values.filter((v) => v !== "");
  if (nonEmpty.length === 0) return null;

  // Standard "keyword   value1, value2, …" — values joined with ", ".
  return pad24(keyword) + nonEmpty.join(", ");
}

/**
 * Emit the EDU text directly from the project's cached Output rows.
 * Produces a byte-exact match to what the VBA tool writes.
 *
 * @param {object} project  parsed project (uses project.outputRows and
 *                           project.modInfo.name + project.header)
 * @returns {string}
 */
function formatEduFromOutput(project) {
  const outputRows = project.outputRows;
  if (!outputRows || !outputRows.length) {
    throw new Error("This workbook has no cached Output sheet — run EDU-matic in Excel to populate it, then retry.");
  }

  const lines = [];
  // Preamble (matches VBA EDUmation2) — identical to buildPreamble() in
  // format.js so either export path produces the same top-of-file block.
  lines.push(";Generated by the EDU-matic, created by Aradan for Norman Invasion");
  lines.push(";Please visit http://www.twcenter.net/forums/showthread.php?t=111344 for Aradan's Complete EDU Guide");
  lines.push(";Free to use as long as this header is kept in place. Thank you.");
  lines.push(`;EDU for ${project.modInfo?.name || ""}...`);
  lines.push("");
  lines.push("");
  for (const h of (project.header || [])) lines.push(h || "");
  lines.push("");
  lines.push("");
  lines.push("");
  lines.push("");
  lines.push("");
  lines.push("; ACTUAL EDU STARTS HERE");
  lines.push("");
  lines.push("");

  // Locate the first "; COMMENTS" row — that's where unit data starts.
  // Rows before it are EDU-matic UI chrome (work directory, filename,
  // etc.) that we skip.
  let firstIdx = 0;
  for (let i = 0; i < outputRows.length; i++) {
    const k = (outputRows[i][0] || "").trim();
    if (k === "; COMMENTS") { firstIdx = i; break; }
  }

  // Iterate rows and emit lines. Two consecutive blank rows collapse to
  // one (the block separator). A lone blank row inside a block also maps
  // to a separator; the EDU pattern is "keyword… \n\n type…".
  // Mirror the Output sheet's blank-line structure verbatim. Empty
  // keyword rows (banner faction, mount_effect, era 0 …) are silently
  // dropped; pure-blank rows are preserved. The Output sheet's spacing
  // already matches what VBA emits to the EDU, so no additional
  // bookkeeping is needed.
  for (let i = firstIdx; i < outputRows.length; i++) {
    const row = splitRow(outputRows[i]);
    const line = formatRow(row);
    if (line === null) continue;
    lines.push(line === BLANK ? "" : line);
  }

  // Ensure trailing newline. VBA writes EDU with CRLF line endings on
  // Windows; mirror that exactly so byte-for-byte comparisons succeed.
  if (lines[lines.length - 1] !== "") lines.push("");
  return lines.join("\r\n");
}

export { formatEduFromOutput };
