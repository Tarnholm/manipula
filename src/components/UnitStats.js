import React from "react";
import { decodeStatPri, decodeStatArmour, decodeStatCost } from "../parsers/edu";

// Read-only stats panel for the EDB unit selected in the editor.
// Rendered when a matching EDU entry exists.
export default function UnitStats({ recruitName, modIndex }) {
  const edu = modIndex.eduByType ? modIndex.eduByType.get(recruitName) : null;
  if (!edu) {
    return (
      <div style={panel}>
        <div style={title}>Unit stats</div>
        <div style={{ color: "#777", fontSize: 12 }}>No EDU entry found for "{recruitName}".</div>
      </div>
    );
  }
  const pri = decodeStatPri(edu.statPri);
  const sec = decodeStatPri(edu.statSec);
  const armour = decodeStatArmour(edu.statPriArmour);
  const cost = decodeStatCost(edu.statCost);
  const display = modIndex.unitDisplayName ? modIndex.unitDisplayName(recruitName) : null;

  return (
    <div style={panel}>
      <div style={title}>
        Unit stats — <span style={{ color: "#dca64a" }}>{display || recruitName}</span>
      </div>
      <div style={grid}>
        <Field label="Category" value={edu.category} />
        <Field label="Class" value={edu.class} />
        <Field label="Soldier" value={edu.soldier} />
        <Field label="Size" value={edu.soldierCount} />
        <Field label="Mass" value={edu.mass} />
        <Field label="Recruit priority" value={edu.recruitPriority} />
      </div>

      {(edu.attributes && edu.attributes.length > 0) && (
        <div style={{ marginTop: 8 }}>
          <Tag color="#445">attributes</Tag>
          {edu.attributes.map(a => <Tag key={a}>{a}</Tag>)}
        </div>
      )}

      {pri && (
        <div style={statRow}>
          <Tag color="#664">primary</Tag>
          <Stat label="Atk" v={pri.attack} />
          <Stat label="Chg" v={pri.charge} />
          {pri.range > 0 && <Stat label="Range" v={pri.range} />}
          {pri.ammo > 0 && <Stat label="Ammo" v={pri.ammo} />}
          <Tag color="#444">{pri.type}</Tag>
          <Tag color="#444">{pri.tech}</Tag>
          <Tag color="#535">{pri.damage}</Tag>
        </div>
      )}
      {sec && (sec.attack > 0 || sec.charge > 0) && (
        <div style={statRow}>
          <Tag color="#664">secondary</Tag>
          <Stat label="Atk" v={sec.attack} />
          <Stat label="Chg" v={sec.charge} />
          <Tag color="#444">{sec.type}</Tag>
          <Tag color="#444">{sec.tech}</Tag>
          <Tag color="#535">{sec.damage}</Tag>
        </div>
      )}
      {armour && (
        <div style={statRow}>
          <Tag color="#566">armour</Tag>
          <Stat label="Armour" v={armour.armour} />
          <Stat label="Defense" v={armour.defense} />
          <Stat label="Shield" v={armour.shield} />
        </div>
      )}
      {edu.statMental && (
        <div style={statRow}>
          <Tag color="#566">morale</Tag>
          <span style={{ fontSize: 12, color: "#bbb" }}>{edu.statMental}</span>
        </div>
      )}
      {cost && (
        <div style={statRow}>
          <Tag color="#566">cost</Tag>
          <Stat label="Turns" v={cost.turns} />
          <Stat label="Recruit" v={cost.cost.toLocaleString()} />
          <Stat label="Upkeep" v={cost.upkeep.toLocaleString()} />
        </div>
      )}

      {(edu.ownership && edu.ownership.length) && (
        <div style={{ marginTop: 10, fontSize: 11.5, color: "#888" }}>
          <strong style={{ color: "#aaa" }}>EDU ownership:</strong> {edu.ownership.join(", ")}
        </div>
      )}
    </div>
  );
}

const panel = {
  marginTop: 14,
  padding: "12px 14px",
  background: "rgba(28,30,32,0.6)",
  border: "1px solid rgba(220,166,74,0.18)",
  borderRadius: 10,
};
const title = { fontSize: 11, color: "#999", marginBottom: 8, textTransform: "uppercase", letterSpacing: 0.5 };
const grid = {
  display: "grid",
  gridTemplateColumns: "repeat(3, 1fr)",
  gap: 6,
  fontSize: 12,
};
const statRow = {
  display: "flex",
  alignItems: "center",
  gap: 6,
  marginTop: 6,
  flexWrap: "wrap",
};

const Field = ({ label, value }) =>
  value == null || value === "" ? null : (
    <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
      <span style={{ color: "#777", fontSize: 10.5, textTransform: "uppercase", letterSpacing: 0.4 }}>{label}</span>
      <span style={{ color: "#ddd", fontFamily: "Consolas, monospace" }}>{value}</span>
    </div>
  );
const Stat = ({ label, v }) => (
  <span style={{ display: "inline-flex", alignItems: "baseline", gap: 4, fontSize: 12 }}>
    <span style={{ color: "#888" }}>{label}</span>
    <span style={{ color: "#dca64a", fontFamily: "Consolas, monospace", fontWeight: 600 }}>{v}</span>
  </span>
);
const Tag = ({ children, color = "#333" }) => (
  <span style={{ display: "inline-block", background: color, color: "#eee", padding: "2px 6px", borderRadius: 3, fontSize: 11, fontFamily: "Consolas, monospace", marginRight: 2 }}>{children}</span>
);
