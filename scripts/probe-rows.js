// Probe a few raw rows from the new BD's New Base file to understand the layout differences.
const fs = require("fs");
const zlib = require("zlib");

const xlsm = process.argv[2];
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
}
function* iterTags(xml, tag) {
  const re = new RegExp(`<${tag}((?:\\s+[A-Za-z_:][\\w:.-]*\\s*=\\s*"[^"]*")*)\\s*(/?)>`, "g");
  let m;
  while ((m = re.exec(xml))) {
    const attrs = {};
    const ar = /(\w+)="([^"]*)"/g;
    let am;
    while ((am = ar.exec(m[1] || ""))) attrs[am[1]] = am[2];
    if (m[2] === "/") yield { attrs, inner: "" };
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

const buf = fs.readFileSync(xlsm);
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
  if (attrs.name === "Units Data Base") { sheetRid = attrs["r:id"] || attrs["id"]; break; }
}
let target = null;
for (const { attrs } of iterTags(relsXml, "Relationship")) {
  if (attrs.Id === sheetRid) { target = attrs.Target; break; }
}
const sheetXml = extractEntry(entries, buf, "xl/" + target.replace(/^\//, "")).toString("utf8");

// Probe rows: print the composite key for first 50 Factional rows, plus any "tier 5" rows
const probe = { factional: [], tier5: [] };
let rowIdx = 0;
for (const { attrs, inner } of iterTags(sheetXml, "row")) {
  rowIdx++;
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
  const type = String(cells[3] || "");
  if (type === "Factional" && probe.factional.length < 5) {
    probe.factional.push({ row: attrs.r, col0: cells[0], col2: cells[2], col3: cells[3], col4: cells[4], col1: cells[1] });
  }
  if (String(cells[2]) === "5" && probe.tier5.length < 3) {
    probe.tier5.push({ row: attrs.r, col0: cells[0], col2: cells[2], col3: cells[3], col4: cells[4] });
  }
}

console.log("First 5 Factional rows:");
for (const p of probe.factional) console.log(JSON.stringify(p, null, 2));
console.log("\nFirst 3 'tier 5' rows:");
for (const p of probe.tier5) console.log(JSON.stringify(p, null, 2));
