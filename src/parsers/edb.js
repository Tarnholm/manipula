// EDB parser — identifies buildings, levels, aliases, and every recruit line.
// Returns:
//   { aliases: [{name, requires}], buildings: [{ name, levels: [{ name, lineRange: [start,end], recruits: [{...}], rawIndex }] }],
//     recruits: [{ unit, xp, building, level, line, raw, requires }] }
//
// "line" = 0-indexed file line number.
//
// Notes about EDB:
//   - Buildings start with `building <name>` at column 0.
//   - Inside, `levels lvl1 lvl2 ...` declares the levels in order.
//   - Each level has its own `<lvl_name> requires ... { ... }` block.
//   - Inside that block is `capability { ... }`, and recruit lines look like:
//       recruit "unit name" <xp> requires <conditions>
//     (whitespace varies — sometimes tabs, sometimes spaces)
//   - There are also alias declarations at top level (`alias <name> { requires ... }`).

const RECRUIT_RE = /^\s*recruit\s+"([^"]+)"\s+(\d+)\s+requires\s+(.+?)\s*$/;
const ALIAS_RE = /^alias\s+([A-Za-z_][A-Za-z0-9_]*)\s*$/;
const BUILDING_RE = /^building\s+([A-Za-z_][A-Za-z0-9_]*)/;
const LEVELS_RE = /^\s*levels\s+(.+?)\s*$/;

export function parseEDB(text) {
  const lines = text.split(/\r?\n/);
  const aliases = [];
  const buildings = [];
  const recruits = [];

  let curBuilding = null;
  let curBuildingLevels = [];
  let curLevelIdx = -1;
  let inAlias = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Aliases
    const am = line.match(ALIAS_RE);
    if (am) {
      inAlias = { name: am[1], startLine: i, requires: null };
      aliases.push(inAlias);
      continue;
    }
    if (inAlias && /^\s*requires\s+/.test(line) && inAlias.requires == null) {
      inAlias.requires = line.replace(/^\s*requires\s+/, "").trim();
    }
    if (inAlias && line.startsWith("}")) {
      inAlias.endLine = i;
      inAlias = null;
    }

    // Buildings
    const bm = line.match(BUILDING_RE);
    if (bm) {
      curBuilding = { name: bm[1], startLine: i, levels: [] };
      buildings.push(curBuilding);
      curBuildingLevels = [];
      curLevelIdx = -1;
      continue;
    }
    if (curBuilding) {
      const lm = line.match(LEVELS_RE);
      if (lm) {
        curBuildingLevels = lm[1].split(/\s+/).filter(Boolean);
        // Build placeholder level objects; their startLines are filled when we see their `<lvl> requires` block.
        for (const lvlName of curBuildingLevels) {
          curBuilding.levels.push({ name: lvlName, building: curBuilding.name, startLine: -1, endLine: -1, recruits: [] });
        }
        continue;
      }

      // Detect a level header: at indent 1 tab inside a building, a token matching one of the declared level names.
      // Lines look like:  `\t\tmic_1 requires factions { all, } ...`
      // The header must be the first non-whitespace token equal to a declared level name.
      const trimmed = line.trimStart();
      const head = trimmed.match(/^([A-Za-z_][A-Za-z0-9_+\-]*)\s+requires\b/);
      if (head && curBuildingLevels.includes(head[1])) {
        const idx = curBuilding.levels.findIndex(l => l.name === head[1] && l.startLine === -1);
        if (idx >= 0) {
          curBuilding.levels[idx].startLine = i;
          curLevelIdx = idx;
        }
      }
    }

    // Recruit lines
    const rm = line.match(RECRUIT_RE);
    if (rm && curBuilding && curLevelIdx >= 0) {
      const rec = {
        unit: rm[1],
        xp: parseInt(rm[2], 10),
        requires: rm[3].trim(),
        line: i,
        raw: line,
        building: curBuilding.name,
        level: curBuilding.levels[curLevelIdx].name,
      };
      recruits.push(rec);
      curBuilding.levels[curLevelIdx].recruits.push(rec);
    }
  }
  finalizeBuildings(buildings);
  return { aliases, buildings, recruits };
}

// Async variant — yields the event loop every CHUNK lines so the renderer thread stays
// responsive while parsing the EDB (often 100k+ lines / 10MB+ of text).
const EDB_CHUNK = 4000;
const edbTick = () => new Promise(r => setTimeout(r, 0));
export async function parseEDBAsync(text) {
  const lines = text.split(/\r?\n/);
  const aliases = [];
  const buildings = [];
  const recruits = [];
  let curBuilding = null, curBuildingLevels = [], curLevelIdx = -1, inAlias = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const am = line.match(ALIAS_RE);
    if (am) { inAlias = { name: am[1], startLine: i, requires: null }; aliases.push(inAlias); continue; }
    if (inAlias && /^\s*requires\s+/.test(line) && inAlias.requires == null) {
      inAlias.requires = line.replace(/^\s*requires\s+/, "").trim();
    }
    if (inAlias && line.startsWith("}")) { inAlias.endLine = i; inAlias = null; }
    const bm = line.match(BUILDING_RE);
    if (bm) {
      curBuilding = { name: bm[1], startLine: i, levels: [] };
      buildings.push(curBuilding);
      curBuildingLevels = []; curLevelIdx = -1;
      continue;
    }
    if (curBuilding) {
      const lm = line.match(LEVELS_RE);
      if (lm) {
        curBuildingLevels = lm[1].split(/\s+/).filter(Boolean);
        for (const lvlName of curBuildingLevels) {
          curBuilding.levels.push({ name: lvlName, building: curBuilding.name, startLine: -1, endLine: -1, recruits: [] });
        }
        continue;
      }
      const trimmed = line.trimStart();
      const head = trimmed.match(/^([A-Za-z_][A-Za-z0-9_+\-]*)\s+requires\b/);
      if (head && curBuildingLevels.includes(head[1])) {
        const idx = curBuilding.levels.findIndex(l => l.name === head[1] && l.startLine === -1);
        if (idx >= 0) { curBuilding.levels[idx].startLine = i; curLevelIdx = idx; }
      }
    }
    const rm = line.match(RECRUIT_RE);
    if (rm && curBuilding && curLevelIdx >= 0) {
      const rec = { unit: rm[1], xp: parseInt(rm[2], 10), requires: rm[3].trim(), line: i, raw: line, building: curBuilding.name, level: curBuilding.levels[curLevelIdx].name };
      recruits.push(rec);
      curBuilding.levels[curLevelIdx].recruits.push(rec);
    }
    if ((i % EDB_CHUNK) === 0 && i > 0) await edbTick();
  }
  finalizeBuildings(buildings);
  return { aliases, buildings, recruits };
}

function finalizeBuildings(buildings) {
  // Set endLine for each level to the start of the next level (or end of building).
  for (const b of buildings) {
    for (let li = 0; li < b.levels.length; li++) {
      const lvl = b.levels[li];
      if (lvl.startLine === -1) continue;
      const next = b.levels.slice(li + 1).find(x => x.startLine !== -1);
      lvl.endLine = next ? next.startLine - 1 : (b.startLine + 100000); // overshoots if last; fine
    }
  }
}

// Group all recruit lines by unit name. Returns: Map<unitName, { totalLines, byBuilding: Map<building, [recruit...]> }>
export function groupByUnit(recruits) {
  const m = new Map();
  for (const r of recruits) {
    if (!m.has(r.unit)) m.set(r.unit, { totalLines: 0, byBuilding: new Map(), entries: [] });
    const g = m.get(r.unit);
    g.totalLines++;
    g.entries.push(r);
    if (!g.byBuilding.has(r.building)) g.byBuilding.set(r.building, []);
    g.byBuilding.get(r.building).push(r);
  }
  return m;
}

// Strip the surrounding boilerplate from a `requires` clause to get the "core" conditions.
// Removes: factions { ... }, is_player / not is_player, mic_tier_N / colony_tier_N / noisland.
// Returns the meaningful "extra requirements" the user cares about (hidden_resource X, major_event "Y", ...).
export function extractCoreRequires(requires) {
  if (!requires) return [];
  // Tokenize on " and " (case-sensitive, lowercased canonical syntax).
  const parts = splitOnAnd(requires);
  const filtered = parts.filter(p => {
    const t = p.trim();
    if (/^factions \{/.test(t)) return false;
    if (/^not factions \{/.test(t)) return false;
    if (/^is_player$/.test(t)) return false;
    if (/^not is_player$/.test(t)) return false;
    if (/^mic_tier_\d$/.test(t)) return false;
    if (/^colony_tier_\d$/.test(t)) return false;
    if (/^gov_tier_\d$/.test(t)) return false;
    if (/^noisland$/.test(t)) return false;
    return true;
  });
  return filtered.map(s => s.trim());
}

// Split a "X and Y and Z" requires clause respecting `factions { a, b, }` braces.
export function splitOnAnd(s) {
  const out = [];
  let cur = "";
  let depth = 0;
  const tokens = s.split(/(\s+and\s+)/);
  for (const tok of tokens) {
    if (/^\s+and\s+$/.test(tok) && depth === 0) {
      out.push(cur);
      cur = "";
    } else {
      cur += tok;
      const opens = (tok.match(/\{/g) || []).length;
      const closes = (tok.match(/\}/g) || []).length;
      depth += opens - closes;
    }
  }
  if (cur) out.push(cur);
  return out;
}

// Extract factions list from a requires clause: returns ["romans_julii", ...] or ["all"].
export function extractFactions(requires) {
  if (!requires) return [];
  const m = requires.match(/factions\s*\{\s*([^}]*)\}/);
  if (!m) return [];
  return m[1].split(",").map(s => s.trim()).filter(Boolean);
}

// Detect tier from a player-side requires (uses mic_tier_N).
export function detectMinTier(requires) {
  const m = requires.match(/mic_tier_(\d)/);
  return m ? parseInt(m[1], 10) : null;
}
