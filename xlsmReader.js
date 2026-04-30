// CommonJS xlsm reader used by main.js to import the EDUMatic spreadsheet.
// Pure Node, no native deps — implements just enough ZIP + XLSX parsing for our needs.

const fs = require("fs");
const zlib = require("zlib");

const SHEET_NAME = "Units Data Base";

function readZip(buf) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error("Not a ZIP file");
  const cdOffset = buf.readUInt32LE(eocd + 16);
  const total = buf.readUInt16LE(eocd + 10);
  const entries = {};
  let p = cdOffset;
  for (let i = 0; i < total; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error("Bad central dir entry");
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
  return {
    extract(name) {
      const e = entries[name];
      if (!e) return null;
      const lh = e.localOff;
      if (buf.readUInt32LE(lh) !== 0x04034b50) throw new Error("Bad local header");
      const fnLen = buf.readUInt16LE(lh + 26);
      const extraLen = buf.readUInt16LE(lh + 28);
      const data = buf.slice(lh + 30 + fnLen + extraLen, lh + 30 + fnLen + extraLen + e.compSize);
      if (e.method === 0) return data;
      if (e.method === 8) return zlib.inflateRawSync(data);
      throw new Error("Unsupported compression method " + e.method);
    },
  };
}

function* iterTags(xml, tag) {
  const re = new RegExp(`<${tag}((?:\\s+[A-Za-z_:][\\w:.-]*\\s*=\\s*"[^"]*")*)\\s*(/?)>`, "g");
  let m;
  while ((m = re.exec(xml))) {
    const attrs = parseAttrs(m[1] || "");
    const selfClose = m[2] === "/";
    if (selfClose) {
      yield { attrs, inner: "" };
    } else {
      const closeRe = new RegExp(`</${tag}>`, "g");
      closeRe.lastIndex = re.lastIndex;
      const cm = closeRe.exec(xml);
      const innerEnd = cm ? cm.index : xml.length;
      yield { attrs, inner: xml.slice(re.lastIndex, innerEnd) };
      re.lastIndex = cm ? closeRe.lastIndex : xml.length;
    }
  }
}
function parseAttrs(s) {
  const out = {}, re = /(\w+)="([^"]*)"/g;
  let m;
  while ((m = re.exec(s))) out[m[1]] = m[2];
  return out;
}
function decodeXml(s) {
  return s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
}
function stripTags(s) { return decodeXml(s.replace(/<[^>]+>/g, "")); }
function colIndex(ref) {
  const letters = ref.match(/^[A-Z]+/)[0];
  let n = 0;
  for (const c of letters) n = n * 26 + (c.charCodeAt(0) - 64);
  return n - 1;
}

// Read the Units Data Base sheet and return parsed unit rows in our shape.
function readEdumatic(xlsmPath) {
  const buf = fs.readFileSync(xlsmPath);
  const zip = readZip(buf);

  const wbXml = zip.extract("xl/workbook.xml").toString("utf8");
  const relsXml = zip.extract("xl/_rels/workbook.xml.rels").toString("utf8");
  const sstXml = zip.extract("xl/sharedStrings.xml").toString("utf8");

  const strings = [];
  for (const { inner } of iterTags(sstXml, "si")) {
    let s = "";
    for (const { inner: t } of iterTags(inner, "t")) s += decodeXml(t);
    strings.push(s);
  }

  let sheetRid = null;
  for (const { attrs } of iterTags(wbXml, "sheet")) {
    if (attrs.name === SHEET_NAME) { sheetRid = attrs["r:id"] || attrs["id"]; break; }
  }
  if (!sheetRid) throw new Error(`Sheet "${SHEET_NAME}" not found in workbook`);

  let sheetTarget = null;
  for (const { attrs } of iterTags(relsXml, "Relationship")) {
    if (attrs.Id === sheetRid) { sheetTarget = attrs.Target; break; }
  }
  if (!sheetTarget) throw new Error("Sheet target not found in workbook rels");

  const sheetXml = zip.extract("xl/" + sheetTarget.replace(/^\//, "")).toString("utf8");

  // Extract all rows
  const rows = [];
  for (const { attrs, inner } of iterTags(sheetXml, "row")) {
    const rowNum = parseInt(attrs.r, 10);
    const cells = {};
    for (const { attrs: cAttrs, inner: cInner } of iterTags(inner, "c")) {
      const col = colIndex(cAttrs.r);
      let value = null;
      const vMatch = cInner.match(/<v>([\s\S]*?)<\/v>/);
      if (cAttrs.t === "inlineStr") {
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

  // Header row = the first row whose col 0 starts with "Table must be sort"
  let headerIdx = rows.findIndex(r => r.cells[0] && String(r.cells[0]).startsWith("Table must be sort"));
  if (headerIdx === -1) throw new Error("Could not locate header row");

  // Column indices we care about (verified against the existing dump):
  // 0: composite key "<faction>1<unit name>"
  // 1: Not Faction (exclusion list as comma-separated string)
  // 2: OG Tier (1..4)
  // 3: Type (Factional / AOR / Merc / mixed comma list)
  // 4: Unit name (the EDB recruit string)
  // 6: XP value (0 by default)
  // 7: Class — actually unit role like "1.Infantry" / "2.Missiles" / "3.Cavalry"
  // 9: Factional requires (e.g. "colony_tier_1")
  // 10: Quality Class (e.g. "06. levy spearman")
  // 18: CONDITIONS — building requirement (mic_tier_X)
  // 19: Natives
  // 20: Major event
  // 21: Not major event
  // 22: Resource
  // 23: Hidden resources
  // 24: Not hidden resources

  const out = [];
  for (let i = headerIdx + 1; i < rows.length; i++) {
    const c = rows[i].cells;
    const col0 = String(c[0] || "").trim();
    if (!col0 || !c[4]) continue;
    // Skip sub-header rows where the cell values are literally column labels (e.g. unit="Unit", quality="QUALITY").
    if (String(c[4]).trim() === "Unit" || String(c[10] || "").trim() === "QUALITY") continue;

    // Newer format: col 0 holds the faction list directly (e.g. "germanics", "all", or "saba, nabataea").
    // Older format: col 0 was a composite "<factions><tier><unit_name>" — we still handle that as a fallback.
    let factionsRaw = col0;
    let tierFromKey = null;
    const composite = col0.match(/^([a-z_, ]+?)(\d)([a-z _].*)$/i);
    // Use composite parsing only if col 0 contains digits (older format)
    if (composite && /\d/.test(col0)) {
      factionsRaw = composite[1].trim();
      tierFromKey = parseInt(composite[2], 10);
    }

    let tier = parseInt(c[2], 10) || tierFromKey || 1;
    // Some rows have tier 5 (special/elite category) — clamp to 4 since the recruitment model is mic_tier_1..4.
    // The original Quality Class hint can guide a better grade choice in the editor.
    let tierClampedFrom = null;
    if (tier > 4) { tierClampedFrom = tier; tier = 4; }
    const type = String(c[3] || "").trim();
    const unitName = String(c[4]).trim();
    const xpVal = parseInt(c[6], 10) || 0;
    const role = parseRole(c[7]);
    const factionalRequires = String(c[9] || "").trim();
    const qualityClass = String(c[10] || "").trim();
    const condition = String(c[18] || "").trim();
    const majorEvent = String(c[20] || "").trim();
    const notMajorEvent = String(c[21] || "").trim();
    const resource = String(c[22] || "").trim();
    const hiddenResources = String(c[23] || "").trim();
    const notHiddenResources = String(c[24] || "").trim();
    const notFactionRaw = String(c[1] || "").trim();

    const isAor = /AOR/i.test(type);
    const isFactional = /Factional/i.test(type);

    const factions = factionsRaw
      ? factionsRaw.split(/[,\s]+/).map(s => s.trim()).filter(Boolean)
      : (isAor ? ["all"] : []);

    const excludeFactions = notFactionRaw
      ? notFactionRaw.split(/[,\s]+/).map(s => s.trim()).filter(Boolean)
      : [];

    const commonRequires = [];
    if (hiddenResources) {
      // Could be multiple, comma-separated
      for (const hr of hiddenResources.split(",").map(s => s.trim()).filter(Boolean)) {
        commonRequires.push(`hidden_resource ${hr}`);
      }
    }
    if (notHiddenResources) {
      for (const hr of notHiddenResources.split(",").map(s => s.trim()).filter(Boolean)) {
        commonRequires.push(`not hidden_resource ${hr}`);
      }
    }
    if (resource) {
      for (const r of resource.split(",").map(s => s.trim()).filter(Boolean)) {
        commonRequires.push(`resource ${r}`);
      }
    }
    if (majorEvent) commonRequires.push(`major_event "${majorEvent}"`);
    if (notMajorEvent) commonRequires.push(`not major_event "${notMajorEvent}"`);

    // outsideExtras = the "factional requires" from col 9 (e.g. colony_tier_1).
    // colony_tier_X is a special case — set u.colonyTier and skip the verbatim.
    let colonyTier = 0;
    const outsideExtras = [];
    if (factionalRequires) {
      const parts = factionalRequires.split(/\s+and\s+/).map(s => s.trim()).filter(Boolean);
      for (const p of parts) {
        const cm = p.match(/^colony_tier_(\d)$/);
        if (cm) colonyTier = parseInt(cm[1], 10);
        else outsideExtras.push(p);
      }
    }

    out.push({
      _meta: {
        rowNum: rows[i].rowNum,
        type,
        role,
        tierClampedFrom, // null unless we clamped from 5+
      },
      unit: unitName,
      tier,
      isAor,
      isFactional,
      factions,
      excludeFactions,
      qualityClass,
      colonyTier,
      outsideExtras,
      commonRequires,
      xpVal,
    });
  }

  return out;
}

function parseRole(s) {
  if (!s) return "infantry";
  const lc = String(s).toLowerCase();
  if (/missile/.test(lc)) return "missile";
  if (/cavalry|cav/.test(lc)) return "cavalry";
  if (/infantry/.test(lc)) return "infantry";
  if (/general/.test(lc)) return "general";
  if (/siege/.test(lc)) return "siege";
  if (/ship|nav/.test(lc)) return "naval";
  return "infantry";
}

module.exports = { readEdumatic };
