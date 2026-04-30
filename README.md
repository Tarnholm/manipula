# Recruitment Tool

Electron + React app for editing recruitment in `export_descr_buildings.txt` for the RIS mod.
Define a unit *once* — set its lowest building tier and requirements — and the tool generates the
12+ matching recruit lines across the player's government chains and the AI's MIC tiers, with an
optional bonus-XP rule for higher tiers.

## First run

```sh
npm install
npm run build
npm run electron
```

In the toolbar:

1. **Mod data folder…** — point at `C:\RIS\RIS\data` (default already set).
2. **Reload** — parses every input file (factions, resources, hidden_resources, regions, EDB,
   reforms, strings).
3. **Import from EDB** — seeds your unit list from the existing recruit lines so you can review
   and refine. (Alternative: `npm run import-xlsm` to dump BD's xlsm grid to `data/units.from-xlsm.json`
   for reference.)
4. Edit a unit on the right (factions, hidden_resources, resources, aliases, building presence,
   reforms, custom requires, optional XP).
5. **Write to EDB** — replaces all owned recruit lines in `export_descr_buildings.txt` and saves
   a timestamped `.bak` next to it.

## Dev mode

```sh
# terminal 1 — CRA dev server
npm start

# terminal 2 — Electron pointing at the dev server
npm run electron-dev
```

## What gets written

For each enabled unit with `minTier=N` (default chain MIC):

- **Player section** — 4 lines, one in each of `governmentA`/`B`/`C`/`D`, using the alias
  `mic_tier_N`.
- **AI section** — `(4 - N + 1)` lines in `military_industrial_complex` levels `mic_N..mic_4`,
  each with `not is_player` and `noisland`.

Lines are wrapped with `;;; RT_PLAYER_BEGIN: <unit>` / `;;; RT_AI_BEGIN: <unit>` banners so the
tool can find and replace them on the next write — operations are idempotent.

## Files this tool reads

- `export_descr_buildings.txt` (parsed for buildings, levels, aliases, recruits)
- `export_descr_unit.txt` (unit metadata)
- `descr_sm_factions.txt` (faction list + culture)
- `descr_sm_resources.txt` (resources and hidden_resources)
- `world/maps/base/descr_regions.txt` (regions → hidden_resource cross-reference)
- `text/export_units.txt`, `text/export_buildings.txt`, `text/expanded_bi.txt` (UTF-16LE display
  strings, optional)
- `descr_sm_major_events.txt` + `major_event_scripts/*.txt` (reform list)

## Limitations / TODO

- Only the MIC chain is implemented. Adding `barracks`, `port_buildings`, etc. is a matter of
  extending `CHAIN_*` tables in `src/generator.js`.
- Garrison and capital_treasury duplications (which Biggus' xlsm also generates) are not yet
  emitted — v1 covers the MIC + government A/B/C/D pattern only.
- The xlsm importer is a reference dump (rows → JSON). Use **Import from EDB** for a working
  starting point.
