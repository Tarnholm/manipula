// Parse export_descr_unit.txt → [{ type, dictionary, category, class, soldier, soldierCount, ownership, attributes, formation, statHealth, statPri, statSec, statPriArmour, statSecArmour, statMental, statCharge, statCost, attributes }]
// Captures common stat fields for the read-only stats viewer.
export function parseEDU(text) {
  const lines = text.split(/\r?\n/);
  const out = [];
  let cur = null;
  const tail = (line, key) => line.slice(line.indexOf(key) + key.length).trim();
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith(";")) continue;
    const m = line.match(/^([a-z_]+)\s+(.+?)\s*$/);
    if (!m) {
      if (line.trim() === "" && cur) { out.push(cur); cur = null; }
      continue;
    }
    const key = m[1], val = m[2];
    if (key === "type") {
      if (cur) out.push(cur);
      cur = { type: val.trim(), dictionary: null, category: null, class: null, soldier: null, soldierCount: null, mass: null, ownership: [], attributes: [], formation: null, statHealth: null, statPri: null, statSec: null, statPriAttr: null, statSecAttr: null, statPriArmour: null, statSecArmour: null, statHeat: null, statGround: null, statMental: null, statCharge: null, statFood: null, statCost: null, recruitPriority: null };
    } else if (cur) {
      if (key === "dictionary") cur.dictionary = val.trim();
      else if (key === "category") cur.category = val.trim();
      else if (key === "class") cur.class = val.trim();
      else if (key === "soldier" || key === "soldiers") {
        const parts = val.split(",").map(s => s.trim());
        cur.soldier = parts[0];
        cur.soldierCount = parseInt(parts[1] || "", 10) || null;
        cur.mass = parts[2] || null;
      }
      else if (key === "ownership") cur.ownership = val.split(",").map(s => s.trim()).filter(Boolean);
      else if (key === "attributes") cur.attributes = val.split(",").map(s => s.trim()).filter(Boolean);
      else if (key === "formation") cur.formation = val.trim();
      else if (key === "stat_health") cur.statHealth = val.trim();
      else if (key === "stat_pri") cur.statPri = val.trim();
      else if (key === "stat_sec") cur.statSec = val.trim();
      else if (key === "stat_pri_attr") cur.statPriAttr = val.trim();
      else if (key === "stat_sec_attr") cur.statSecAttr = val.trim();
      else if (key === "stat_pri_armour") cur.statPriArmour = val.trim();
      else if (key === "stat_sec_armour") cur.statSecArmour = val.trim();
      else if (key === "stat_heat") cur.statHeat = val.trim();
      else if (key === "stat_ground") cur.statGround = val.trim();
      else if (key === "stat_mental") cur.statMental = val.trim();
      else if (key === "stat_charge_dist") cur.statCharge = val.trim();
      else if (key === "stat_food") cur.statFood = val.trim();
      else if (key === "stat_cost") cur.statCost = val.trim();
      else if (key === "recruit_priority_offset") cur.recruitPriority = parseInt(val.trim(), 10);
    }
  }
  if (cur) out.push(cur);
  return out;
}

// Decode a stat_pri / stat_sec line: "10, 2, javelin, 60, 7, thrown, archery, piercing, spear, 25, 1"
// → { attack, charge, projectile, range, ammo, type, tech, sound, weapon, delay, multiplier }
export function decodeStatPri(s) {
  if (!s) return null;
  const p = s.split(",").map(t => t.trim());
  return {
    attack: +p[0] || 0,
    charge: +p[1] || 0,
    projectile: p[2],
    range: +p[3] || 0,
    ammo: +p[4] || 0,
    type: p[5],          // melee/thrown/missile
    tech: p[6],          // archery/blade/blunt/spear
    damage: p[7],        // piercing/blunt/slashing
    sound: p[8],
    delay: +p[9] || 0,
    multiplier: +p[10] || 0,
  };
}
// stat_pri_armour: "1, 16, 3, flesh, wood" → { armour, defense, shield, fleshType, woodType }
export function decodeStatArmour(s) {
  if (!s) return null;
  const p = s.split(",").map(t => t.trim());
  return { armour: +p[0] || 0, defense: +p[1] || 0, shield: +p[2] || 0 };
}
// stat_cost: "2, 1038, 380, 0, 53, 394" → { turns, cost, upkeep, weaponUpgrade, armourUpgrade, customBattleCost }
export function decodeStatCost(s) {
  if (!s) return null;
  const p = s.split(",").map(t => t.trim());
  return { turns: +p[0] || 0, cost: +p[1] || 0, upkeep: +p[2] || 0, weaponUpgrade: +p[3] || 0, armourUpgrade: +p[4] || 0, customBattleCost: +p[5] || 0 };
}
