// Inspect a specific sheet's first 5 rows so we can map columns.
// Usage: node scripts/inspect-sheet.js "<xlsm>" "<SheetName>" [maxRows=5]
const fs = require("fs");
const zlib = require("zlib");

const xlsm = process.argv[2];
const sheetName = process.argv[3];
const maxRows = parseInt(process.argv[4] || "5", 10);
if (!xlsm || !sheetName) { console.error("Usage: node inspect-sheet.js <xlsm> <SheetName> [maxRows]"); process.exit(1); }

const buf = fs.readFileSync(xlsm);

function readZip(buf) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  const cdOffset = buf.readUInt32LE(eocd + 16);
  const total = buf.readUInt16LE(eocd + 10);
  const entries = {};
  let p = cdOffset;
  for (let i = 0; i < total; i++) {
    const method = buf.readUInt16LE(p + 10);
    const compSize = buf.readUInt32LE(p + 20);
    const fnLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const cmtLen = buf.readUInt16LE(p + 32);
    const localOff = buf.readUInt32LE(p + 42);
    const name = buf.toString("utf8", p + 46, p + 46 + fnLen);
    entries[name] = { method, compSize, localOff };
    p += 46 + fnLen + extraLen + cmtLen;
  }
  return entries;
}
function extractEntry(entries, buf, name) {
  const e = entries[name];
  if (!e) return null;
  const lh = e.localOff;
  const fnLen = buf.readUInt16LE(lh + 26);
  const extraLen = buf.readUInt16LE(lh + 28);
  const data = buf.slice(lh + 30 + fnLen + extraLen, lh + 30 + fnLen + extraLen + e.compSize);
  if (e.method === 0) return data;
  if (e.method === 8) return zlib.inflateRawSync(data);
  throw new Error("Unsupported method");
}
function* iterTags(xml, tag) {
  const re = new RegExp(`<${tag}((?:\\s+[A-Za-z_:][\\w:.-]*\\s*=\\s*"[^"]*")*)\\s*(/?)>`, "g");
  let m;
  while ((m = re.exec(xml))) {
    const attrs = {};
    const ar = /(\w+)="([^"]*)"/g;
    let am;
    while ((am = ar.exec(m[1] || ""))) attrs[am[1]] = am[2];
    const selfClose = m[2] === "/";
    if (selfClose) yield { attrs, inner: "" };
    else {
      const closeRe = new RegExp(`</${tag}>`, "g");
      closeRe.lastIndex = re.lastIndex;
      const cm = closeRe.exec(xml);
      const innerEnd = cm ? cm.index : xml.length;
      yield { attrs, inner: xml.slice(re.lastIndex, innerEnd) };
      re.lastIndex = cm ? closeRe.lastIndex : xml.length;
    }
  }
}
function decodeXml(s) { return s.replace(/&lt;/g,"<").replace(/&gt;/g,">").replace(/&quot;/g,'"').replace(/&apos;/g,"'").replace(/&amp;/g,"&"); }
function colIndex(ref) {
  const letters = ref.match(/^[A-Z]+/)[0];
  let n = 0;
  for (const c of letters) n = n * 26 + (c.charCodeAt(0) - 64);
  return n - 1;
}

const entries = readZip(buf);
const wbXml = extractEntry(entries, buf, "xl/workbook.xml").toString("utf8");
const relsXml = extractEntry(entries, buf, "xl/_rels/workbook.xml.rels").toString("utf8");
const sstXml = extractEntry(entries, buf, "xl/sharedStrings.xml").toString("utf8");

const strings = [];
for (const { inner } of iterTags(sstXml, "si")) {
  let s = "";
  for (const { inner: t } of iterTags(inner, "t")) s += decodeXml(t);
  strings.push(s);
}

let sheetRid = null;
for (const { attrs } of iterTags(wbXml, "sheet")) {
  if (attrs.name === sheetName) { sheetRid = attrs["r:id"] || attrs["id"]; break; }
}
if (!sheetRid) { console.error("Sheet not found"); process.exit(1); }

let target = null;
for (const { attrs } of iterTags(relsXml, "Relationship")) {
  if (attrs.Id === sheetRid) { target = attrs.Target; break; }
}
const sheetXml = extractEntry(entries, buf, "xl/" + target.replace(/^\//, "")).toString("utf8");

let rowCount = 0;
let totalRows = 0;
for (const { attrs, inner } of iterTags(sheetXml, "row")) {
  totalRows++;
  if (rowCount >= maxRows) continue;
  rowCount++;
  const cells = {};
  for (const { attrs: cAttrs, inner: cInner } of iterTags(inner, "c")) {
    const col = colIndex(cAttrs.r);
    let value = null;
    const vMatch = cInner.match(/<v>([\s\S]*?)<\/v>/);
    if (vMatch) {
      if (cAttrs.t === "s") value = strings[parseInt(vMatch[1], 10)];
      else value = vMatch[1];
    }
    cells[col] = value;
  }
  console.log(`Row ${attrs.r}:`);
  for (const k of Object.keys(cells).sort((a, b) => parseInt(a) - parseInt(b))) {
    console.log(`  ${k}: ${cells[k]}`);
  }
  console.log("---");
}
console.log(`(Total rows in sheet: ${totalRows})`);
