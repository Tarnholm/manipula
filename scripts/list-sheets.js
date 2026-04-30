const fs = require("fs");
const zlib = require("zlib");

const xlsm = process.argv[2] || "C:\\Users\\vtarn\\Downloads\\EDU-matic_RIS_0.7.0 239 factions.xlsm";
const buf = fs.readFileSync(xlsm);

// minimal ZIP read
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

const entries = readZip(buf);
const wbXml = extractEntry(entries, buf, "xl/workbook.xml").toString("utf8");

console.log("Sheets in workbook:");
const sheetRegex = /<sheet\s+([^/>]*)\/?>/g;
let m;
while ((m = sheetRegex.exec(wbXml))) {
  const attrs = {};
  const ar = /(\w+)="([^"]*)"/g;
  let am;
  while ((am = ar.exec(m[1]))) attrs[am[1]] = am[2];
  console.log(`  - "${attrs.name}"  sheetId=${attrs.sheetId}  state=${attrs.state || "visible"}`);
}
