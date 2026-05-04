import React, { useMemo } from "react";

// Read-only panel that lists every existing `recruit "<unit>"` line in the EDB for the unit
// being edited. Grouped by building, ordered as they appear in the file. Helps the coder see
// the current state of recruitment before regenerating it.
export default function EDBOccurrences({ recruitName, modIndex }) {
  const occurrences = useMemo(() => {
    if (!recruitName) return [];
    const all = (modIndex && modIndex.recruits) || [];
    // Match exact recruit name. Also try the "aor X" variant if the user is authoring a
    // faction-side and the AOR sibling has its own existing entries.
    return all.filter(r => r.unit === recruitName);
  }, [recruitName, modIndex]);

  // AOR-pair counterpart (e.g. user is editing "roman hastati early" — also surface "aor roman hastati early")
  const aorOccurrences = useMemo(() => {
    if (!recruitName) return [];
    if (recruitName.startsWith("aor ")) return [];
    const all = (modIndex && modIndex.recruits) || [];
    return all.filter(r => r.unit === `aor ${recruitName}`);
  }, [recruitName, modIndex]);

  if (!recruitName) return null;

  const total = occurrences.length + aorOccurrences.length;

  return (
    <div style={panelStyle}>
      <div style={titleStyle}>
        Current in EDB — <span style={{ color: "#dca64a" }}>{recruitName}</span>
        <span style={{ color: "#777", fontSize: 11, fontWeight: 400, marginLeft: 6 }}>
          {total} line{total === 1 ? "" : "s"}
        </span>
      </div>

      {total === 0 && (
        <div style={{ fontSize: 12, color: "#888", fontStyle: "italic" }}>
          No existing recruit lines for "{recruitName}" — it's a brand-new unit (or the EDB hasn't loaded).
        </div>
      )}

      {occurrences.length > 0 && (
        <Group title="Faction sibling" entries={occurrences} />
      )}
      {aorOccurrences.length > 0 && (
        <Group title={`AOR sibling — "aor ${recruitName}"`} entries={aorOccurrences} />
      )}

      <div style={{ fontSize: 11, color: "#777", marginTop: 8, fontStyle: "italic" }}>
        Read-only view of the existing EDB. The tool re-emits these lines from your profile config
        when "Write to EDB" runs — the current state stays here for reference.
      </div>
    </div>
  );
}

function Group({ title, entries }) {
  // Group entries by building (preserves file order within each building)
  const byBuilding = new Map();
  for (const e of entries) {
    if (!byBuilding.has(e.building)) byBuilding.set(e.building, []);
    byBuilding.get(e.building).push(e);
  }
  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{ fontSize: 11, color: "#bbb", marginBottom: 4 }}>{title}</div>
      {[...byBuilding].map(([building, items]) => (
        <details key={building} open style={{ marginBottom: 4 }}>
          <summary style={summaryStyle}>
            <span style={{ color: "#ddd", fontWeight: 600 }}>{building}</span>
            <span style={{ color: "#888", marginLeft: 6 }}>({items.length})</span>
          </summary>
          <div style={{ paddingLeft: 8, fontFamily: "Consolas, monospace", fontSize: 11.5 }}>
            {items.map((e, i) => (
              <div key={i} style={rowStyle} title={e.raw || ""}>
                <span style={{ color: "#666", minWidth: 50, display: "inline-block" }}>L{e.line + 1}</span>
                <span style={{ color: "#7a9", minWidth: 80, display: "inline-block" }}>{e.level}</span>
                {e.xp > 0 && <span style={{ color: "#dca64a", fontWeight: 600, marginRight: 6 }}>xp+{e.xp}</span>}
                <span style={{ color: "#bbb" }}>{e.requires}</span>
              </div>
            ))}
          </div>
        </details>
      ))}
    </div>
  );
}

const panelStyle = {
  marginTop: 14,
  padding: 12,
  background: "rgba(24,26,27,0.55)",
  border: "1px solid rgba(255,255,255,0.06)",
  borderRadius: 12,
  backdropFilter: "blur(6px)",
  WebkitBackdropFilter: "blur(6px)",
};
const titleStyle = {
  fontSize: 11,
  color: "#999",
  marginBottom: 8,
  textTransform: "uppercase",
  letterSpacing: 0.5,
  fontWeight: 700,
};
const summaryStyle = {
  cursor: "pointer",
  padding: "4px 6px",
  background: "rgba(255,255,255,0.03)",
  borderRadius: 4,
  fontSize: 12,
  userSelect: "none",
};
const rowStyle = {
  padding: "2px 0",
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis",
};
