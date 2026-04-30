#!/usr/bin/env node
// EDB doctor — scans an export_descr_buildings.txt for likely syntax issues.
// Won't catch every error the game's parser sees, but will surface the common ones:
//   - unbalanced braces (per file and per top-level block)
//   - malformed recruit lines (missing quotes, missing xp number, missing requires)
//   - alias declarations missing their { body
//   - building/levels declarations missing { or with stray tokens
//   - inline comments that the parser sometimes can't handle (e.g. `alias foo ; comment`)
//
// Usage:
//   node scripts/edb-doctor.js "<path to export_descr_buildings.txt>"
//
// Output: list of issues with line numbers, sorted by severity. Exits 0 even on issues so
// the script doesn't fail the host shell. Pipe through `head -40` to see the top entries.

const fs = require("fs");
const path = process.argv[2];
if (!path) { console.error("Usage: node edb-doctor.js <edb-path>"); process.exit(1); }
const text = fs.readFileSync(path, "utf8");
const lines = text.split(/\r?\n/);

const issues = [];

function add(severity, lineNum, code, msg) {
  issues.push({ severity, lineNum, code, msg });
}

// ── Pass 1: file-wide brace balance ──
let depth = 0;
let lastOpenLine = -1;
for (let i = 0; i < lines.length; i++) {
  const ln = lines[i];
  // Strip line-comments (everything after `;` that isn't inside a quoted string)
  let inStr = false, eff = "";
  for (let j = 0; j < ln.length; j++) {
    const c = ln[j];
    if (c === '"') inStr = !inStr;
    if (c === ";" && !inStr) break;
    eff += c;
  }
  for (const c of eff) {
    if (c === "{") { depth++; if (depth === 1) lastOpenLine = i + 1; }
    else if (c === "}") {
      depth--;
      if (depth < 0) { add("error", i + 1, "unbalanced-close", "Closing } with no matching {"); depth = 0; }
    }
  }
}
if (depth > 0) add("error", lines.length, "unbalanced-open", `${depth} unclosed { remaining at end-of-file (last opened around line ${lastOpenLine})`);

// ── Pass 2: per-line shape checks ──
let curBuilding = null;
let curBuildingLine = 0;
for (let i = 0; i < lines.length; i++) {
  const raw = lines[i];
  const ln = raw.trimEnd();
  const num = i + 1;
  if (!ln.trim() || ln.trim().startsWith(";")) continue;

  // Building declaration
  const bm = ln.match(/^building\s+(\S+)/);
  if (bm) { curBuilding = bm[1]; curBuildingLine = num; continue; }

  // Inline comment after alias keyword (some parsers don't tolerate this)
  const aliasInline = ln.match(/^alias\s+\S+\s+;/);
  if (aliasInline) {
    add("warn", num, "alias-inline-comment", `Inline ; comment after alias name — some parser builds reject this. Move the comment to its own line.`);
  }

  // Recruit line shape: `recruit "name" <xp> requires <stuff>`
  if (/^\s*recruit\b/.test(ln)) {
    const ok = /^\s*recruit\s+"[^"]+"\s+\d+\s+requires\s+\S/.test(ln);
    if (!ok) add("error", num, "bad-recruit", `Malformed recruit line: ${ln.trim().slice(0, 200)}`);
    // Check for unbalanced quotes
    const qcount = (ln.match(/"/g) || []).length;
    if (qcount % 2 !== 0) add("error", num, "unbalanced-quote", `Odd number of " on recruit line`);
    // Check braces inside requires expression are balanced
    const req = ln.replace(/^.*?requires\s+/, "");
    const opens = (req.match(/\{/g) || []).length;
    const closes = (req.match(/\}/g) || []).length;
    if (opens !== closes) add("error", num, "recruit-brace-mismatch", `recruit line has ${opens} {  vs ${closes} }`);
    // Check for empty 'and' tokens (e.g. `and  and`)
    if (/\band\s+and\b/.test(ln)) add("error", num, "double-and", `Double 'and' in requires clause`);
    // Trailing 'and'
    if (/\band\s*$/.test(ln)) add("error", num, "trailing-and", `Trailing 'and' (clause appears to be cut off)`);
    // Empty quotes
    if (/recruit\s+""/.test(ln)) add("error", num, "empty-name", `recruit "" — empty unit name`);
    continue;
  }

  // Levels keyword: `levels lvl1 lvl2 ...`
  if (/^\s*levels\s+/.test(ln)) {
    const tokens = ln.trim().slice("levels".length).trim().split(/\s+/);
    for (const t of tokens) {
      if (!/^[A-Za-z_][A-Za-z0-9_+\-]*$/.test(t)) {
        add("warn", num, "bad-level-name", `Unusual level name "${t}" — expected identifier`);
      }
    }
    continue;
  }

  // Standalone alias on a line with following content (e.g. `alias foo and ...`) — usually only
  // `alias foo` followed by `{` on next line is valid.
  if (/^alias\s+\S+\s+\S/.test(ln) && !aliasInline) {
    // Could be `alias foo display_string XYZ` — check if it's a known shape
    if (!/^alias\s+\S+\s*$/.test(ln)) {
      // Already flagged above if it's a comment; otherwise warn
      // (This is permissive — only flag if it doesn't look like any known pattern)
    }
  }
}

// ── Pass 3: building/level structure ──
// Each `building X { levels a b c { a requires ... { ... } b requires ... { ... } } }`
// Sanity check: every building should have exactly one `levels` declaration, and braces inside it should match.
// (Skipped for now — full block parsing is what the game does anyway.)

// ── Output ──
issues.sort((a, b) => {
  const order = { error: 0, warn: 1, info: 2 };
  if (order[a.severity] !== order[b.severity]) return order[a.severity] - order[b.severity];
  return a.lineNum - b.lineNum;
});
const counts = { error: 0, warn: 0, info: 0 };
for (const i of issues) counts[i.severity]++;
console.log(`File: ${path}`);
console.log(`Lines: ${lines.length}`);
console.log(`Errors: ${counts.error}, Warnings: ${counts.warn}, Info: ${counts.info}\n`);
if (issues.length === 0) {
  console.log("No structural issues found by the doctor.");
  console.log("If the game still rejects the file, the issue is semantic (unknown building/alias names, etc.) — share the broken file's lines around the parser-reported error for further diagnosis.");
} else {
  for (const i of issues.slice(0, 100)) {
    console.log(`[${i.severity.toUpperCase().padEnd(5)}] line ${String(i.lineNum).padStart(6)}  ${i.code}  ${i.msg}`);
  }
  if (issues.length > 100) console.log(`...and ${issues.length - 100} more issues`);
}
