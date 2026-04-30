#!/usr/bin/env node
// One-shot: read BD's New Base.xlsm → emit data/units.from-xlsm.json with whatever rows we can recover.
//
// We parse only the "Units Data Base" sheet. The xlsx ZIP layout we extract:
//   xl/sharedStrings.xml            string pool
//   xl/workbook.xml                 sheet name → rId map
//   xl/_rels/workbook.xml.rels      rId → target file
//   xl/worksheets/sheetN.xml        cells (with shared-string indices)
//
// Approach: stream-parse the worksheet XML row by row. We don't need full fidelity — we just want the
// column headers and each row's values, then write them to JSON for the user to refine in the app.
//
// Run: node scripts/import-from-xlsm.js "C:\path\to\BD's New Base.xlsm"

const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const DEFAULT_XLSM = "C:\\RIS\\_tools\\Biggus-tools\\BD's New Base.xlsm";
const SHEET_NAME = "Units Data Base";

function fail(msg) { console.error("ERROR:", msg); process.exit(1); }

// ── tiny zip reader ──
// We implement just enough of ZIP to extract DEFLATE entries by name.
function readZip(buf) {
  // Find end of central directory
  const eocdOffset = (function () {
    for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
      if (buf.readUInt32LE(i) === 0x06054b50) return i;
    }
    return -1;
  })();
  if (eocdOffset < 0) fail("Not a ZIP file");
  const cdSize = buf.readUInt32LE(eocdOffset + 12);
  const cdOffset = buf.readUInt32LE(eocdOffset + 16);
  const totalEntries = buf.readUInt16LE(eocdOffset + 10);
  const entries = {};
  let p = cdOffset;
  for (let i = 0; i < totalEntries; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) fail("Bad central dir entry");
    const method = buf.readUInt16LE(p + 10);
    const compSize = buf.readUInt32LE(p + 20);
    const uncompSize = buf.readUInt32LE(p + 24);
    const fnLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const cmtLen = buf.readUInt16LE(p + 32);
    const localOff = buf.readUInt32LE(p + 42);
    const name = buf.toString("utf8", p + 46, p + 46 + fnLen);
    entries[name] = { method, compSize, uncompSize, localOff };
    p += 46 + fnLen + extraLen + cmtLen;
  }
  return {
    list: () => Object.keys(entries),
    extract: (name) => {
      const e = entries[name];
      if (!e) return null;
      const lh = e.localOff;
      if (buf.readUInt32LE(lh) !== 0x04034b50) fail("Bad local header for " + name);
      const fnLen = buf.readUInt16LE(lh + 26);
      const extraLen = buf.readUInt16LE(lh + 28);
      const data = buf.slice(lh + 30 + fnLen + extraLen, lh + 30 + fnLen + extraLen + e.compSize);
      if (e.method === 0) return data;
      if (e.method === 8) return zlib.inflateRawSync(data);
      fail("Unsupported compression method " + e.method);
    },
  };
}

// ── tiny XML helpers ──
function* iterTags(xml, tag) {
  // yields { attrs, inner } for every <tag ...>...</tag> or self-closing <tag .../>.
  // Attribute values may legally contain "/" (URLs in xmlns/Type), so we cannot use [^/>]
  // to bound the attr region — instead, match a quoted-string-aware run of attrs and decide
  // self-closing by whether the run ends with `/`.
  const re = new RegExp(`<${tag}((?:\\s+[A-Za-z_:][\\w:.-]*\\s*=\\s*"[^"]*")*)\\s*(/?)>`, "g");
  let m;
  while ((m = re.exec(xml))) {
    const attrs = parseAttrs(m[1] || "");
    const selfClose = m[2] === "/";
    if (selfClose) {
      yield { attrs, inner: "" };
    } else {
      // find matching close tag from current position
      const closeRe = new RegExp(`</${tag}>`, "g");
      closeRe.lastIndex = re.lastIndex;
      const cm = closeRe.exec(xml);
      const innerEnd = cm ? cm.index : xml.length;
      const inner = xml.slice(re.lastIndex, innerEnd);
      yield { attrs, inner };
      re.lastIndex = cm ? closeRe.lastIndex : xml.length;
    }
  }
}
function parseAttrs(s) {
  const out = {};
  const re = /(\w+)="([^"]*)"/g;
  let m;
  while ((m = re.exec(s))) out[m[1]] = m[2];
  return out;
}
function decodeXml(s) {
  return s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
}
function stripTags(s) {
  return decodeXml(s.replace(/<[^>]+>/g, ""));
}

// ── column letters → index ──
function colIndex(ref) {
  const letters = ref.match(/^[A-Z]+/)[0];
  let n = 0;
  for (const c of letters) n = n * 26 + (c.charCodeAt(0) - 64);
  return n - 1;
}

// ── main ──
const xlsmPath = process.argv[2] || DEFAULT_XLSM;
if (!fs.existsSync(xlsmPath)) fail("Not found: " + xlsmPath);
console.log("Reading", xlsmPath);
const buf = fs.readFileSync(xlsmPath);
const zip = readZip(buf);

const wbXml = zip.extract("xl/workbook.xml").toString("utf8");
const relsXml = zip.extract("xl/_rels/workbook.xml.rels").toString("utf8");
const sstXml = zip.extract("xl/sharedStrings.xml").toString("utf8");

// Build sharedStrings list
const strings = [];
for (const { inner } of iterTags(sstXml, "si")) {
  // Could contain <t>...</t> or <r><t>..</t></r> runs — concatenate all <t>s.
  let s = "";
  for (const { inner: t } of iterTags(inner, "t")) s += decodeXml(t);
  strings.push(s);
}
console.log(`Shared strings: ${strings.length}`);

// Find sheetId / r:id for "Units Data Base"
let sheetRid = null;
for (const { attrs } of iterTags(wbXml, "sheet")) {
  if (attrs.name === SHEET_NAME) { sheetRid = attrs["r:id"] || attrs["id"]; break; }
}
if (!sheetRid) fail(`Sheet "${SHEET_NAME}" not found.`);
console.log(`Sheet "${SHEET_NAME}" rId=${sheetRid}`);

let sheetTarget = null;
for (const { attrs } of iterTags(relsXml, "Relationship")) {
  if (attrs.Id === sheetRid) { sheetTarget = attrs.Target; break; }
}
if (!sheetTarget) fail("Sheet target not found in rels.");
const sheetPath = "xl/" + sheetTarget.replace(/^\//, "");
console.log("Sheet path:", sheetPath);

const sheetXml = zip.extract(sheetPath).toString("utf8");

// Stream rows. xlsx rows look like:
//   <row r="N" ...><c r="A1" s="..." t="s"><v>123</v></c>...</row>
// t="s" means shared string (v is index). t="str" or t="inlineStr" means inline string.
// No t means number.
const rows = [];
for (const { attrs, inner } of iterTags(sheetXml, "row")) {
  const rowNum = parseInt(attrs.r, 10);
  const cells = {};
  for (const { attrs: cAttrs, inner: cInner } of iterTags(inner, "c")) {
    const col = colIndex(cAttrs.r);
    let value = null;
    const vMatch = cInner.match(/<v>([\s\S]*?)<\/v>/);
    const isInline = cAttrs.t === "inlineStr";
    if (isInline) {
      const isMatch = cInner.match(/<is>([\s\S]*?)<\/is>/);
      if (isMatch) value = stripTags(isMatch[1]);
    } else if (vMatch) {
      const raw = vMatch[1];
      if (cAttrs.t === "s") value = strings[parseInt(raw, 10)];
      else value = raw;
    }
    cells[col] = value;
  }
  rows.push({ rowNum, cells });
}
console.log("Rows parsed:", rows.length);

// Heuristic: header row is the first row with >=4 non-null cells. The rest are data.
let headerIdx = -1;
for (let i = 0; i < rows.length; i++) {
  const filled = Object.values(rows[i].cells).filter(v => v != null && String(v).trim() !== "").length;
  if (filled >= 4) { headerIdx = i; break; }
}
if (headerIdx === -1) fail("Could not find a header row.");
const headers = rows[headerIdx].cells;
const headerCols = Object.keys(headers).map(n => parseInt(n, 10)).sort((a, b) => a - b);
console.log("Headers (row", rows[headerIdx].rowNum, "):");
for (const c of headerCols) console.log(" ", c, "→", headers[c]);

// Emit data rows as { columnHeader: value }.
const data = [];
for (let i = headerIdx + 1; i < rows.length; i++) {
  const r = rows[i];
  const obj = {};
  let any = false;
  for (const c of headerCols) {
    const v = r.cells[c];
    if (v != null && String(v).trim() !== "") any = true;
    obj[headers[c] || `col_${c}`] = v == null ? null : String(v);
  }
  if (any) data.push(obj);
}
console.log("Data rows:", data.length);

const outDir = path.join(__dirname, "..", "data");
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
const outPath = path.join(outDir, "units.from-xlsm.json");
fs.writeFileSync(outPath, JSON.stringify({ source: xlsmPath, sheet: SHEET_NAME, rows: data }, null, 2), "utf8");
console.log("Wrote", outPath);
console.log("Done. Use the app's 'Import from EDB' button as a more reliable starting point — this xlsm dump is provided as a reference snapshot of Biggus' grid.");
