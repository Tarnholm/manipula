import React, { useEffect, useMemo, useState } from "react";
import FactionIcon from "./FactionIcon";
import UnitCard from "./UnitCard";
import { categorizeUnit, ROSTER_ROLES, isNonRecruitable } from "../qualityClasses";

// Grade order used as the secondary sort key inside each category.
const GRADE_ORDER = { Levy: 1, Standard: 2, Professional: 3, Elite: 4, Veteran: 5, Custom: 6 };
// Map role string → bucket number (mirrors generator.js bucketOf, derived from ROSTER_ROLES).
const BUCKET_OF_ROLE = Object.fromEntries(ROSTER_ROLES.map((r, i) => [r, i + 1]));

export default function UnitList({ units, selectedId, selectedIds, onSelect, onAdd, onDelete, onDuplicate, onCreateFromEDU, modIndex, filter, onFilterChange, eduProject }) {
  // Build a Map of unit name → EDU row, so the badge can show a stat-preview tooltip.
  const eduMap = useMemo(() => {
    if (!eduProject || !Array.isArray(eduProject.units)) return null;
    const m = new Map();
    for (const eu of eduProject.units) {
      const n = eu.Unit || eu.unit || eu.Type || eu.type;
      if (n) m.set(String(n), eu);
    }
    return m;
  }, [eduProject]);
  const eduNames = eduMap;
  // Quick textual stat summary for the badge tooltip.
  const summarizeEdu = (eu) => {
    if (!eu) return null;
    const fields = [
      eu.Quality && `quality: ${eu.Quality}`,
      eu.Category && `category: ${eu.Category}`,
      eu.Recruitment && `recruit: ${eu.Recruitment}`,
      eu.Soldiers && `soldiers: ${eu.Soldiers}`,
      eu.Cost && `cost: ${eu.Cost}`,
      eu.Upkeep && `upkeep: ${eu.Upkeep}`,
    ].filter(Boolean);
    return fields.length ? fields.join("  ·  ") : null;
  };
  selectedIds = selectedIds || new Set();
  // Count how many authored entries share each EDU unit id. When >1, the import
  // produced multiple variants (e.g. an AOR/hinterland recruitment path AND a
  // Factional MIC-chain path for the same `roman hastati early`). Both end up
  // with the same "Standard · t1" subtitle, which makes the cards look like
  // duplicates. The badge below disambiguates them.
  const variantCounts = useMemo(() => {
    const m = new Map();
    for (const u of units) {
      const k = String(u.unit || "");
      if (!k) continue;
      m.set(k, (m.get(k) || 0) + 1);
    }
    return m;
  }, [units]);
  const [q, setQ] = useState("");
  const searchRef = React.useRef(null);
  // Compact mode toggle — when on, rows shrink to ~40px (no portrait, just name + tier).
  // Useful for scrolling 4000-unit profiles. Persisted across launches.
  const [compact, setCompact] = useState(() => localStorage.getItem("rt:compactList") === "1");
  useEffect(() => { localStorage.setItem("rt:compactList", compact ? "1" : "0"); }, [compact]);
  // Right-click context menu — { x, y, unit } | null.
  const [ctxMenu, setCtxMenu] = useState(null);
  useEffect(() => {
    if (!ctxMenu) return;
    const onAny = () => setCtxMenu(null);
    setTimeout(() => document.addEventListener("click", onAny, { once: true }), 0);
    return () => document.removeEventListener("click", onAny);
  }, [ctxMenu]);
  // Quick navigation: J / K to move selection, "/" to focus the search, Esc to clear it.
  // Only fires when no other text input has focus, so we don't steal typing.
  useEffect(() => {
    const onKey = (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      // Decide intercept based on the *focused* element, not the keystroke
      // target. e.target is the body when focus has drifted (which can
      // happen after various React re-renders), and the previous logic
      // would then swallow j/k as navigation even though the user was
      // trying to type into the search input — exactly the "search bar
      // not working until I minimize and come back" symptom.
      const ae = document.activeElement;
      const aeTag = (ae && ae.tagName) || "";
      const isText =
        aeTag === "INPUT" || aeTag === "TEXTAREA" || aeTag === "SELECT" ||
        (ae && ae.isContentEditable);
      const k = e.key;
      if (k === "/" && !isText) { e.preventDefault(); searchRef.current && searchRef.current.focus(); return; }
      if (k === "Escape" && isText && ae === searchRef.current) { setQ(""); return; }
      if ((k === "j" || k === "k") && !isText) {
        const list = filteredRef.current;
        if (!list || list.length === 0) return;
        e.preventDefault();
        const cur = list.findIndex(u => u.id === selectedId);
        const nextIdx = k === "j" ? Math.min(list.length - 1, (cur < 0 ? 0 : cur + 1)) : Math.max(0, (cur < 0 ? 0 : cur - 1));
        const next = list[nextIdx];
        if (next) onSelect(next.id, { metaKey: false, ctrlKey: false, shiftKey: false });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line
  }, [selectedId, onSelect]);
  const filteredRef = React.useRef([]);
  const filterMode = (filter && filter.mode) || "none";
  const filterValue = (filter && filter.value) || "";
  const setFilterMode = (m) => onFilterChange && onFilterChange({ mode: m, value: "" });
  const setFilterValue = (v) => onFilterChange && onFilterChange({ mode: filterMode, value: v });

  // Build dropdowns. Factions are ordered as they appear in descr_sm_factions.txt (the parser
  // returns them in file-order), with the authored count attached as a hint. HR/reform dropdowns
  // are ranked by usage count since there's no equivalent canonical order.
  const usageOptions = useMemo(() => {
    const factionCounts = new Map(), hrs = new Map(), reforms = new Map();
    const bump = (m, k) => m.set(k, (m.get(k) || 0) + 1);
    for (const u of units) {
      for (const f of (u.factions || [])) bump(factionCounts, f);
      for (const r of [...(u.commonRequires || []), ...(u.requires || []), ...(u.outsideExtras || [])]) {
        let m;
        if ((m = r.match(/^hidden_resource\s+(\S+)$/))) bump(hrs, m[1]);
        else if ((m = r.match(/^major_event\s+"([^"]+)"$/))) bump(reforms, m[1]);
      }
    }
    // File-order: iterate modIndex.factions (already in descr_sm_factions order from parseFactions).
    const factionsList = (modIndex.factions || []).map(f => ({
      value: f.id,
      count: factionCounts.get(f.id) || 0,
      authored: factionCounts.has(f.id),
    }));
    const sortByCount = (m) => [...m].sort((a, b) => b[1] - a[1]).map(([k, v]) => ({ value: k, count: v }));
    return {
      factions: factionsList,
      hrs: sortByCount(hrs),
      reforms: sortByCount(reforms),
    };
  }, [units, modIndex]);

  const matchesUnitText = (u, ql) => {
    if (!ql) return true;
    const display = modIndex.unitDisplayName ? modIndex.unitDisplayName(u.unit) : null;
    if (u.unit.toLowerCase().includes(ql)) return true;
    if (display && display.toLowerCase().includes(ql)) return true;
    if (u.notes && u.notes.toLowerCase().includes(ql)) return true;
    if ((u.factions || []).some(f => f.toLowerCase().includes(ql))) return true;
    if ((u.excludeFactions || []).some(f => f.toLowerCase().includes(ql))) return true;
    if ((u.requires || []).some(r => r.toLowerCase().includes(ql))) return true;
    return false;
  };

  const filtered = useMemo(() => {
    const ql = q.toLowerCase();
    const list = units.filter(u => {
      if (isNonRecruitable(u)) return false;
      const eduEntry = modIndex.eduByType ? modIndex.eduByType.get(u.unit) : null;
      if (eduEntry && isNonRecruitable(eduEntry)) return false;
      if (ql && !matchesUnitText(u, ql)) return false;
      if (filterMode === "faction" && filterValue) {
        if (!(u.factions || []).includes(filterValue)) return false;
      } else if (filterMode === "hr" && filterValue) {
        if (!(u.requires || []).some(r => r === `hidden_resource ${filterValue}`)) return false;
      } else if (filterMode === "reform" && filterValue) {
        if (!(u.requires || []).some(r => r === `major_event "${filterValue}"`)) return false;
      }
      return true;
    });
    // Sort by (category, grade, name) so the list mirrors the EDB output order:
    //   Infantry → Missiles → Cavalry → Camels → Elephants → General
    //   Levy → Standard → Professional → Elite → Veteran
    list.sort((a, b) => {
      const ba = BUCKET_OF_ROLE[categorizeUnit(a)] || 99;
      const bb = BUCKET_OF_ROLE[categorizeUnit(b)] || 99;
      if (ba !== bb) return ba - bb;
      const ga = GRADE_ORDER[a.grade] || 99;
      const gb = GRADE_ORDER[b.grade] || 99;
      if (ga !== gb) return ga - gb;
      const ta = a.canonicalMicTier ?? a.minTier ?? 99;
      const tb = b.canonicalMicTier ?? b.minTier ?? 99;
      if (ta !== tb) return ta - tb;
      return (a.unit || "").localeCompare(b.unit || "");
    });
    return list;
    // eslint-disable-next-line
  }, [units, q, filterMode, filterValue, modIndex]);

  // Group same-name units into one card. Per the user's "these 3 should
  // all be in 1 card" feedback — five identically-named Lyttian Archers
  // each as their own row was confusing. Now they collapse into a single
  // card, and UnitEditor exposes the individual variants via a tab strip.
  // Group order follows the order each unit *first* appeared in the
  // sorted `filtered` list, so the existing role/grade/tier sort still
  // shapes the sidebar.
  const filteredGroups = useMemo(() => {
    const map = new Map();   // name → { name, variants: [] }
    for (const u of filtered) {
      const key = u.unit || "";
      const g = map.get(key);
      if (g) g.variants.push(u);
      else map.set(key, { name: key, variants: [u] });
    }
    return [...map.values()];
  }, [filtered]);
  // Mirror filtered list to a ref so the keyboard handler can read it without re-binding.
  filteredRef.current = filtered;

  // Ghost units: present in EDU with the filtered faction in ownership, but not yet authored.
  // Only shown when filterMode === "faction" and a faction is picked, since the full EDU is huge.
  // Returns { rows, totalEduForFaction } so the UI can show "0 missing of N" diagnostics.
  const ghostInfo = useMemo(() => {
    if (filterMode !== "faction" || !filterValue) return { rows: [], totalEduForFaction: 0 };
    const authored = new Set(units.map(u => u.unit));
    const edu = modIndex.edu || [];
    const matchingEdu = edu.filter(e => Array.isArray(e.ownership) && e.ownership.includes(filterValue) && !isNonRecruitable(e));
    const ql = q.toLowerCase();
    const rows = matchingEdu
      .filter(e => !authored.has(e.type))
      .filter(e => !ql
        || e.type.toLowerCase().includes(ql)
        || (e.dictionary && e.dictionary.toLowerCase().includes(ql)))
      .map(e => ({
        _ghost: true,
        id: "ghost_" + e.type,
        unit: e.type,
        edu: e,
        suggestedFactions: e.ownership.filter(o => o !== "slave"),
      }));
    return { rows, totalEduForFaction: matchingEdu.length };
    // eslint-disable-next-line
  }, [units, modIndex, filterMode, filterValue, q]);
  const ghostUnits = ghostInfo.rows;

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", borderRight: "1px solid rgba(220,166,74,0.15)", background: "rgba(20,22,23,0.55)", backdropFilter: "blur(8px)", WebkitBackdropFilter: "blur(8px)" }}>
      <div style={{ padding: 10, borderBottom: "1px solid rgba(255,255,255,0.06)", background: "rgba(255,255,255,0.02)" }}>
        {selectedIds.size > 1 && (
          <div style={{ marginBottom: 8, padding: "4px 8px", background: "rgba(220,166,74,0.15)", borderRadius: 4, fontSize: 11, color: "#dca64a", fontWeight: 600 }}>
            {selectedIds.size} units selected — bulk-edit pane is active
          </div>
        )}
        <div style={{ display: "flex", gap: 4, marginBottom: 8 }}>
          <button onClick={onAdd} style={btn("#3a6")}>＋ New unit</button>
          <button
            onClick={() => selectedId && onDuplicate(selectedId)}
            disabled={!selectedId}
            style={btn("#446", !selectedId)}
          >Duplicate</button>
          <button
            onClick={() => selectedId && window.confirm("Delete unit?") && onDelete(selectedId)}
            disabled={!selectedId}
            style={btn("#733", !selectedId)}
          >Delete</button>
          <button
            onClick={() => setCompact(c => !c)}
            title={compact ? "Switch to comfortable list" : "Switch to compact list"}
            style={{ background: compact ? "#dca64a" : "rgba(255,255,255,0.08)", color: compact ? "#1a1a1a" : "#bbb", border: "none", padding: "6px 10px", borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: "pointer" }}
          >≡</button>
        </div>
        <input
          ref={searchRef}
          type="text"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={`Search ${units.length} units · / focus, Esc clear, J/K to navigate`}
          style={{ width: "100%", background: "#252525", border: "1px solid #333", color: "#ddd", padding: "5px 8px", borderRadius: 6, marginBottom: 6 }}
        />
        <div style={{ display: "flex", gap: 4 }}>
          <select
            value={filterMode}
            onChange={(e) => { setFilterMode(e.target.value); }}
            style={{ background: "#252525", border: "1px solid #333", color: "#ddd", padding: "5px 7px", borderRadius: 6, fontSize: 12 }}
          >
            <option value="none">Used in: any</option>
            <option value="faction">faction</option>
            <option value="hr">hidden_resource</option>
            <option value="reform">reform</option>
          </select>
          <select
            value={filterValue}
            onChange={(e) => setFilterValue(e.target.value)}
            disabled={filterMode === "none"}
            style={{ flex: 1, background: "#252525", border: "1px solid #333", color: "#ddd", padding: "5px 7px", borderRadius: 6, fontSize: 12 }}
          >
            <option value="">— pick —</option>
            {filterMode === "faction" && usageOptions.factions.map(o => (
              <option key={o.value} value={o.value}>
                {o.value} {o.authored ? `(${o.count})` : "(no units yet)"}
              </option>
            ))}
            {filterMode === "hr" && usageOptions.hrs.map(o => <option key={o.value} value={o.value}>{o.value} ({o.count})</option>)}
            {filterMode === "reform" && usageOptions.reforms.map(o => <option key={o.value} value={o.value}>{o.value} ({o.count})</option>)}
          </select>
        </div>
      </div>
      <div style={{ flex: 1, overflow: "auto" }}>
        {filtered.length === 0 && ghostUnits.length === 0 && (
          <div style={{ color: "#777", padding: 20, textAlign: "center" }}>
            {units.length === 0 ? "No units yet — click ＋ New unit to add one." : "No matches."}
          </div>
        )}
        {filtered.length > 0 && filterMode === "faction" && filterValue && (
          <div style={{ padding: "6px 12px", fontSize: 10, color: "#888", textTransform: "uppercase", letterSpacing: 0.6, background: "rgba(0,0,0,0.15)" }}>
            Authored — {filtered.length}
          </div>
        )}
        {filteredGroups.map((group) => {
          const variants = group.variants;
          // Pick a "representative" variant for the card preview — the
          // currently-selected one if any variant in the group is
          // selected, otherwise the first. Click on the card selects
          // that representative; the editor on the right exposes the
          // remaining variants via a tab strip.
          const selectedVariant = variants.find(v => v.id === selectedId);
          const u = selectedVariant || variants[0];
          const isPrimary = !!selectedVariant;
          const isMulti = variants.some(v => selectedIds.has(v.id));
          const display = modIndex.unitDisplayName ? modIndex.unitDisplayName(u.unit) : null;
          const totalSame = variants.length;
          // Counts per category for the summary badges below.
          const aorCount = variants.filter(v => v.aor && v.aor.enabled).length;
          const factionalCount = variants.filter(v => !(v.aor && v.aor.enabled)).length;
          const writeCount = variants.filter(v => v.writeBack !== false).length;
          const refCount = variants.length - writeCount;
          const enabledAny = variants.some(v => v.enabled !== false);
          // EDU is keyed by the base unit type. AOR recruit names (like "aor dravidian warriors")
          // don't have their own EDU entry — they alias the base unit ("dravidian warriors") —
          // so try both. Same fallback for "merc " prefixed names.
          const eduByType = modIndex.eduByType;
          const stripPrefix = (s) => s.replace(/^(aor|merc)\s+/i, "");
          const eduEntry = eduByType
            ? (eduByType.get(u.unit) || eduByType.get(stripPrefix(u.unit)) || null)
            : null;
          // For AOR / "factions { all }" units, the authored faction list is just ["all"], which
          // doesn't help the icon resolver locate the TGA. Fall back to the EDU entry's natural
          // ownership (skipping "slave") so AOR portraits resolve to the right faction folder.
          const cardFaction =
            (u.factions || []).find(f => f && f !== "all") ||
            (eduEntry?.ownership || []).find(f => f && f !== "slave") ||
            null;
          return (
            <div
              key={group.name + "|" + u.id}
              onClick={(ev) => onSelect(u.id, ev)}
              onContextMenu={(ev) => { ev.preventDefault(); setCtxMenu({ x: ev.clientX, y: ev.clientY, unit: u }); }}
              style={{
                padding: compact ? "4px 12px" : "8px 12px",
                borderBottom: "1px solid rgba(255,255,255,0.04)",
                cursor: "pointer",
                background: isPrimary ? "rgba(220,166,74,0.18)" : isMulti ? "rgba(220,166,74,0.08)" : "",
                borderLeft: !enabledAny ? "3px solid #555" : isPrimary ? "3px solid #dca64a" : isMulti ? "3px solid rgba(220,166,74,0.5)" : "3px solid transparent",
                transition: "background 0.12s",
                display: "flex",
                gap: 10,
                alignItems: compact ? "center" : "flex-start",
                contentVisibility: "auto",
                containIntrinsicSize: compact ? "36px" : (totalSame > 1 ? `${85 + 22 * totalSame}px` : "85px"),
              }}
            >
              {!compact && (
                <UnitCard
                  faction={cardFaction}
                  unitName={u.unit}
                  dictionary={eduEntry?.dictionary}
                  eduEntry={eduEntry}
                  size={42}
                  alt={display || u.unit}
                />
              )}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600, color: u.enabled === false ? "#888" : "#ddd", display: "flex", alignItems: "center", gap: 4, flexWrap: "wrap" }}>
                  <span>{display || u.unit}</span>
                  {display && <span style={{ color: "#666", fontWeight: 400, fontSize: 11 }}>({u.unit})</span>}
                  {totalSame > 1 && (
                    <span title={`${totalSame} variants of this unit — click a row below to jump to that variant`} style={{ background: "rgba(220,166,74,0.18)", color: "#dca64a", fontSize: 10, fontWeight: 700, padding: "0 5px", borderRadius: 3, fontFamily: "Consolas, monospace" }}>
                      × {totalSame}
                    </span>
                  )}
                  {eduMap && eduMap.has(u.unit) && (() => {
                    const tip = summarizeEdu(eduMap.get(u.unit));
                    return (
                      <span title={tip ? `EDU stats — ${tip}` : "Has matching row in the loaded EDU project"} style={{ background: "rgba(220,166,74,0.15)", color: "#dca64a", border: "1px solid rgba(220,166,74,0.3)", fontSize: 9, fontWeight: 700, padding: "0 4px", borderRadius: 3, fontFamily: "Consolas, monospace" }}>EDU ✓</span>
                    );
                  })()}
                </div>
                {/* One row per variant — its own kind (FACTIONAL / AOR),
                 *  WRITE/REF status, tier, and faction list. The user
                 *  asked to see all variants individually inside the
                 *  same card instead of one collapsed summary. */}
                {!compact && variants.map((v, vIdx) => {
                  const vIsAor = !!(v.aor && v.aor.enabled);
                  const vWrites = v.writeBack !== false;
                  const vSel = v.id === selectedId;
                  const vMulti = selectedIds.has(v.id);
                  const vFactions = (v.factions || []).filter(f => f && f !== "all");
                  const tier = v.canonicalMicTier ?? v.minTier ?? "?";
                  return (
                    <div
                      key={v.id}
                      onClick={(ev) => { ev.stopPropagation(); onSelect(v.id, ev); }}
                      title={vIsAor ? "AOR variant — recruits via hidden_resource regions" : "Factional variant — main MIC-chain recruitment"}
                      style={{
                        marginTop: vIdx === 0 ? 4 : 2,
                        padding: "3px 6px",
                        borderRadius: 4,
                        background: vSel ? "rgba(220,166,74,0.20)" : vMulti ? "rgba(220,166,74,0.08)" : "rgba(255,255,255,0.025)",
                        border: vSel ? "1px solid rgba(220,166,74,0.55)" : "1px solid rgba(255,255,255,0.05)",
                        display: "flex",
                        alignItems: "center",
                        gap: 5,
                        flexWrap: "wrap",
                        fontSize: 11,
                        color: v.enabled === false ? "#777" : "#bbb",
                      }}
                    >
                      <span style={{ width: 6, height: 6, borderRadius: "50%", background: vSel ? "#dca64a" : "#555", flexShrink: 0 }} />
                      <span style={{ color: "#888", fontFamily: "Consolas, monospace", fontSize: 10 }}>
                        {v.grade || "?"} · t{tier}
                      </span>
                      {vIsAor ? (
                        <span style={{ background: "rgba(124,201,153,0.16)", color: "#7c9", border: "1px solid rgba(124,201,153,0.35)", fontSize: 9, fontWeight: 700, padding: "0 5px", borderRadius: 3, fontFamily: "Consolas, monospace", letterSpacing: 0.5 }}>AOR</span>
                      ) : (
                        <span style={{ background: "rgba(220,166,74,0.16)", color: "#dca64a", border: "1px solid rgba(220,166,74,0.35)", fontSize: 9, fontWeight: 700, padding: "0 5px", borderRadius: 3, fontFamily: "Consolas, monospace", letterSpacing: 0.5 }}>FACTIONAL</span>
                      )}
                      {vWrites ? (
                        <span title="Will write back to EDB on next Write-to-EDB" style={{ background: "rgba(124,201,153,0.12)", color: "#7c9", border: "1px solid rgba(124,201,153,0.30)", fontSize: 9, fontWeight: 700, padding: "0 5px", borderRadius: 3, fontFamily: "Consolas, monospace", letterSpacing: 0.5 }}>WRITE</span>
                      ) : (
                        <span title="Reference-only — Write-to-EDB skips this variant" style={{ background: "rgba(120,120,120,0.15)", color: "#888", border: "1px solid #444", fontSize: 9, fontWeight: 700, padding: "0 5px", borderRadius: 3, fontFamily: "Consolas, monospace", letterSpacing: 0.5 }}>REF ONLY</span>
                      )}
                      {vFactions.length > 0 && (
                        <span style={{ color: "#aaa", fontFamily: "Consolas, monospace", fontSize: 10 }}>
                          {vFactions.slice(0, 3).join(", ")}
                          {vFactions.length > 3 && ` +${vFactions.length - 3}`}
                        </span>
                      )}
                      {(v.factions || []).slice(0, 4).map(fid => (
                        fid === "all" ? null : (
                          <FactionIcon
                            key={fid}
                            iconPath={`faction_icons/${fid}.tga`}
                            alt={fid}
                            size={14}
                            modIconsDir={modIndex.factionIconsDir}
                          />
                        )
                      ))}
                    </div>
                  );
                })}
                {compact && (
                  <div style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11, color: "#888", flexWrap: "wrap" }}>
                    <span>
                      {u.grade || "?"} · t{u.canonicalMicTier ?? u.minTier ?? "?"}
                      {u.aor && u.aor.enabled ? " · +AOR" : ""}
                    </span>
                    {factionalCount > 0 && (
                      <span style={{ background: "rgba(220,166,74,0.16)", color: "#dca64a", border: "1px solid rgba(220,166,74,0.35)", fontSize: 9, fontWeight: 700, padding: "0 5px", borderRadius: 3, fontFamily: "Consolas, monospace", letterSpacing: 0.5 }}>
                        FACTIONAL{factionalCount > 1 ? ` ×${factionalCount}` : ""}
                      </span>
                    )}
                    {aorCount > 0 && (
                      <span style={{ background: "rgba(124,201,153,0.16)", color: "#7c9", border: "1px solid rgba(124,201,153,0.35)", fontSize: 9, fontWeight: 700, padding: "0 5px", borderRadius: 3, fontFamily: "Consolas, monospace", letterSpacing: 0.5 }}>
                        AOR{aorCount > 1 ? ` ×${aorCount}` : ""}
                      </span>
                    )}
                    {refCount === 0 ? (
                      <span style={{ background: "rgba(124,201,153,0.16)", color: "#7c9", border: "1px solid rgba(124,201,153,0.35)", fontSize: 9, fontWeight: 700, padding: "0 5px", borderRadius: 3, fontFamily: "Consolas, monospace", letterSpacing: 0.5 }}>WRITE</span>
                    ) : writeCount === 0 ? (
                      <span style={{ background: "rgba(120,120,120,0.15)", color: "#888", border: "1px solid #444", fontSize: 9, fontWeight: 700, padding: "0 5px", borderRadius: 3, fontFamily: "Consolas, monospace", letterSpacing: 0.5 }}>REF ONLY</span>
                    ) : (
                      <span style={{ background: "rgba(220,166,74,0.16)", color: "#dca64a", border: "1px solid rgba(220,166,74,0.35)", fontSize: 9, fontWeight: 700, padding: "0 5px", borderRadius: 3, fontFamily: "Consolas, monospace", letterSpacing: 0.5 }}>{writeCount}/{totalSame} WRITE</span>
                    )}
                  </div>
                )}
              </div>
            </div>
          );
        })}

        {filterMode === "faction" && filterValue && (
          <div style={{ padding: "6px 12px", fontSize: 10, color: "#dca64a", textTransform: "uppercase", letterSpacing: 0.6, background: "rgba(220,166,74,0.06)", borderTop: "1px dashed rgba(220,166,74,0.2)", marginTop: 4 }}>
            Not yet coded into EDB — {ghostUnits.length}
            <span style={{ float: "right", color: "#888", fontWeight: 400, textTransform: "none", letterSpacing: 0 }}>
              {ghostInfo.totalEduForFaction} EDU entries own "{filterValue}"
            </span>
          </div>
        )}
        {filterMode === "faction" && filterValue && ghostUnits.length === 0 && ghostInfo.totalEduForFaction > 0 && (
          <div style={{ padding: 14, color: "#7c9", fontSize: 12, textAlign: "center", fontStyle: "italic" }}>
            All {ghostInfo.totalEduForFaction} EDU entries for "{filterValue}" are already authored.
          </div>
        )}
        {filterMode === "faction" && filterValue && ghostInfo.totalEduForFaction === 0 && (
          <div style={{ padding: 14, color: "#a77", fontSize: 12, textAlign: "center", fontStyle: "italic" }}>
            No EDU entries have "{filterValue}" in ownership.
            {(modIndex.edu || []).length === 0 && <div style={{ marginTop: 4, color: "#888" }}>Tip: click <strong>Reload</strong> in the topbar so the EDU file is parsed.</div>}
          </div>
        )}
        {ghostUnits.map(g => {
          const display = modIndex.unitDisplayName ? modIndex.unitDisplayName(g.unit) : null;
          return (
            <div
              key={g.id}
              onClick={() => onCreateFromEDU && onCreateFromEDU(g.edu)}
              title="Click to create a unit family from this EDU entry"
              style={{
                padding: "8px 12px",
                borderBottom: "1px solid rgba(255,255,255,0.04)",
                cursor: "pointer",
                background: "rgba(220,166,74,0.04)",
                borderLeft: "3px dashed rgba(220,166,74,0.5)",
                opacity: 0.8,
                transition: "opacity 0.15s, background 0.12s",
              }}
              onMouseEnter={(e) => { e.currentTarget.style.opacity = "1"; e.currentTarget.style.background = "rgba(220,166,74,0.12)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.opacity = "0.8"; e.currentTarget.style.background = "rgba(220,166,74,0.04)"; }}
            >
              <div style={{ display: "flex", alignItems: "baseline", gap: 6, fontWeight: 500, color: "#cba", fontStyle: "italic" }}>
                {display || g.unit}
                {display && <span style={{ color: "#666", fontWeight: 400, fontSize: 11, fontStyle: "normal" }}>({g.unit})</span>}
                <span style={{ marginLeft: "auto", fontSize: 9, color: "#dca64a", fontStyle: "normal", fontWeight: 700, letterSpacing: 0.5 }}>+ ADD</span>
              </div>
              <div style={{ fontSize: 11, color: "#777", fontStyle: "italic" }}>
                {g.edu.category || "?"} · {g.edu.class || "?"} · ownership: {g.suggestedFactions.slice(0, 3).join(", ")}{g.suggestedFactions.length > 3 ? `, +${g.suggestedFactions.length - 3}` : ""}
              </div>
            </div>
          );
        })}
      </div>
      {ctxMenu && (
        <div style={{ position: "fixed", left: ctxMenu.x, top: ctxMenu.y, zIndex: 5000, background: "rgba(28,30,32,0.98)", border: "1px solid rgba(220,166,74,0.3)", borderRadius: 6, padding: 4, fontSize: 12, color: "#ddd", boxShadow: "0 8px 24px rgba(0,0,0,0.6)", minWidth: 200 }}>
          <div style={{ padding: "5px 10px", color: "#dca64a", fontWeight: 700, borderBottom: "1px solid rgba(255,255,255,0.06)", marginBottom: 4 }}>{ctxMenu.unit.unit}</div>
          {[
            { label: "Edit (select)", onClick: () => onSelect(ctxMenu.unit.id, {}) },
            { label: "Duplicate…", onClick: () => onDuplicate && onDuplicate(ctxMenu.unit.id) },
            { label: "Toggle reference-only", onClick: () => onSelect(ctxMenu.unit.id, {}) /* user toggles in editor */ },
            { label: "Filter to faction…", onClick: () => {
                const f = (ctxMenu.unit.factions || []).find(x => x !== "all");
                if (f && onFilterChange) onFilterChange({ mode: "faction", value: f });
              }
            },
            { label: "Copy unit name", onClick: () => navigator.clipboard?.writeText(ctxMenu.unit.unit) },
            { label: "Delete…", onClick: () => window.confirm(`Delete "${ctxMenu.unit.unit}"?`) && onDelete(ctxMenu.unit.id), color: "#e88" },
          ].map((it, i) => (
            <div key={i}
              onClick={() => { it.onClick(); setCtxMenu(null); }}
              style={{ padding: "5px 10px", cursor: "pointer", borderRadius: 3, color: it.color || "#ddd" }}
              onMouseEnter={(e) => e.currentTarget.style.background = "rgba(220,166,74,0.10)"}
              onMouseLeave={(e) => e.currentTarget.style.background = "transparent"}>
              {it.label}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function btn(color, disabled) {
  return {
    flex: 1,
    background: disabled ? "rgba(255,255,255,0.06)" : color,
    color: disabled ? "#666" : "#fff",
    border: "none",
    padding: "6px 8px",
    borderRadius: 6,
    fontSize: 12,
    fontWeight: 500,
    cursor: disabled ? "default" : "pointer",
  };
}
