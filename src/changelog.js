// In-app changelog — surfaced as a dismissible "What's new" banner after an
// auto-update (keyed on the running app version vs the last-seen version in
// localStorage). Newest first; keep entries short and user-facing. When you
// ship a notable version, add an entry here for it.
const CHANGELOG = [
  { version: "0.37.0", notes: [
    "Recruitment cost is now tunable from Mod Info → Globals: UnitCostExponential (default 0.8) flattens the cost curve as units get pricier, and UnitCostModifier (default 1.98) offsets that reduction. Defaults reproduce the previous hardcoded values, so nothing changes until you tune them (Case 183).",
    "New CavBGSkirmish global (Mod Info → Globals) controls whether general / cavalry-bodyguard units emit \"class skirmish\". Default 0 keeps the prior behaviour; set non-zero to switch it on.",
    "Units editor: new \"Class Override\" dropdown next to Category (missile / light / heavy / spear) forces the EDU class line regardless of the auto-derived class — handy for steering AI behaviour. Blank = auto. \"spear\" emits the engine's spearmen class.",
    "Core Data → Cultures: new \"Secondary HP\" column adds a flat secondary-HP bonus to every land unit of that culture (e.g. Roman +2 turns a 7 into a 9). Ships are unaffected; blank leaves units unchanged.",
  ] },
  { version: "0.36.116", notes: [
    "AOR lines no longer double-gate when the unit carries an aor_tier_N alias. Those aliases already expand to the full gov/colony-tier cap in the EDB, so the tool now omits its own \"gov_tier_1 and not ... and not colony_tier_N\" suffix (and the gov_tier_1 clause) when one is present: aor_tier_1, aor_tier_2, or aor_tier_3. Lines without one of those aliases still get the cap as before.",
  ] },
  { version: "0.36.115", notes: [
    "Factional requires now has a \"Reforms excluded\" picker — emits \"not major_event\" on the factional player + AI lines, so a unit recruits until the reform fires and then gates out (the inverse of Reforms required).",
    "Fixed: the \"Custom requires / extras\" boxes wouldn't accept spaces — every keystroke was being normalized, stripping the trailing space before you could type the next word. They now hold your draft as-is while typing and only tidy up (trim + drop blank lines) when you click away.",
  ] },
  { version: "0.36.113", notes: [
    "AoR gov-tier cap now also caps colony tier, per canonical MIC tier: tier 1 → \"gov_tier_1 and not colony_tier_2\"; tier 2 → \"gov_tier_1 and not gov_tier_3 and not colony_tier_1\"; tier 3 or 4 → \"gov_tier_1 and not gov_tier_2 and not colony_tier_1\". (Tier 1 gets no gov_tier ceiling, only the colony cap.) Lines that already declare their own \"not gov_tier_N\" / \"not colony_tier_N\" ceiling are left untouched.",
  ] },
  { version: "0.36.112", notes: [
    "AoR gov-tier cap now scales with the unit's canonical MIC tier: tier 1 or 2 emit \"gov_tier_1 and not gov_tier_3\" (recruitable at gov tiers 1-2), tier 3 or 4 emit \"gov_tier_1 and not gov_tier_2\" (recruitable at gov tier 1 only). Previously every gov_tier_1 line capped at not gov_tier_3. Lines that already declare their own \"not gov_tier_N\" ceiling are still left untouched.",
  ] },
  { version: "0.36.111", notes: [
    "Units can now emit tattoo_color / hair_color / hair_style lines in the EDU. Fill the Tattoo Colour / Hair Colour / Hair Style boxes in the unit editor and they're written verbatim after the unit's ethnicity lines (vanilla ordering, e.g. barb naked fanatics). Useful for forcing a hair type on units with hair bands. Blank for the vast majority of units, which are unaffected.",
  ] },
  { version: "0.36.110", notes: [
    "AOR / regional recruit lines gated at gov_tier_1 now also emit \"not gov_tier_3\", so they stop being recruitable at the highest government tiers. Lines that already declare their own \"not gov_tier_N\" ceiling are left untouched.",
    "Fixed: typing into a \"Custom extras\" box hijacked each keystroke into the alias picker above it. Bare tokens are now only treated as aliases when they match a real alias name, so custom extras text stays put.",
  ] },
  { version: "0.36.109", notes: [
    "Fixed: EDB recruitment wasn't being read at all since 0.36.98 (a parser crash left every unit showing as \"not coded into EDB\" and the Current EDB panel empty). Recruitment editing works again.",
    "Import from EDB now refuses to run when zero recruit lines were parsed, so a failed EDB load can no longer wipe your project. If yours was wiped: the profiles _backups folder holds your last 8 units.json snapshots; the EDB itself was never touched.",
  ] },
  { version: "0.36.108", notes: [
    "VS-cavalry bonuses (vs horse / elephant / chariot / camel) are now clamped to ±50 instead of ±31, allowing stronger anti-cavalry stats in the EDU output.",
  ] },
  { version: "0.36.107", notes: [
    "Section header rows (the glowy yellow #FACTION dividers in Units / Armour tables) can now be selected with Ctrl/Shift+click and deleted via right-click → Delete, just like normal rows. Useful for cleaning up stale faction/culture markers without manually navigating around them.",
  ] },
  { version: "0.36.106", notes: [
    "Discipline calc was reading 'Training mdf' instead of 'Discipline mdf' from the unit's quality class — a copy-paste from the training formula directly below. Per RIS dev clarification: SoldierDiscipline = UnitDiscipline + QualClassDisciplineMdf + CultCategoryInf/CavDisciplineMdf. Some units may shift between low/normal/disciplined as a result.",
  ] },
  { version: "0.36.105", notes: [
    "Core Data tables (Recruitment Classes, Quality Classes, Cultures, etc.) now keep the first column pinned while you scroll right — no more losing the row anchor on wide tables. Errors / Warnings tables pin Unit too.",
    "New \"Hide empty cols\" toolbar button on tables where you can pick columns — one click drops every column where all rows are blank; click again to bring them back.",
    "Hardened cell-edit focus: the bug where you had to alt-tab out and back to type into a cell should be gone (or at least much rarer). Added OS-level window.focus(), extended retries to 160ms, and re-grabs the input when window focus returns.",
  ] },
  { version: "0.36.104", notes: [
    "Faction availability dropdown in the EDU Builder now offers M (mercenary) alongside Y — was Y-only before.",
  ] },
  { version: "0.36.103", notes: [
    "Watching for updates (double-click the version label) now truly auto-installs the update the moment it finishes downloading — no \"Restart and install\" click. If you have unsaved EDU edits it saves your project first so nothing is lost.",
  ] },
  { version: "0.36.97", notes: [
    "Roster Cost tab v2: per-faction average cost + best/worst value-for-money outliers.",
    "Units table now shows read-only computed columns: cost, upkeep, recruit priority, armour.",
    "New \"Sync rec priority from Quality\" button, plus a warning when a unit's rec priority diverges from its class.",
    "Added a test harness for the core ownership/parser logic.",
    "This \"What's new\" banner.",
  ] },
  { version: "0.36.96", notes: [
    "Roster Cost tab now actually appears in the EDU Builder.",
    "Factional recruit priority derives from the Quality class (all units of a class share it).",
  ] },
  { version: "0.36.95", notes: [
    "Double-click the version label to watch for updates every 5s until one appears (then it auto-installs).",
  ] },
  { version: "0.36.93", notes: [
    "Roster Cost tab: average/median unit cost + totals for six paste-in 20-unit armies.",
    "Startup pull reminder when the shared repo has commits you haven't pulled.",
  ] },
  { version: "0.36.91", notes: [
    "Detects missing models in the legacy bare-model coding pattern.",
  ] },
  { version: "0.36.90", notes: [
    "City-viewer civilian (peasant) models are no longer mis-flagged as orphan DMB types.",
  ] },
];

export default CHANGELOG;
export function changelogFor(version) {
  return CHANGELOG.find((e) => e.version === version) || null;
}
