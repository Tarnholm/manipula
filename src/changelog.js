// In-app changelog — surfaced as a dismissible "What's new" banner after an
// auto-update (keyed on the running app version vs the last-seen version in
// localStorage). Newest first; keep entries short and user-facing. When you
// ship a notable version, add an entry here for it.
const CHANGELOG = [
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
