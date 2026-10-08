# Mod Info → Globals — what every global actually does

*EDU Builder tab → **Mod Info** → **Globals**. Verified against Manipula 0.40.0.*

Every entry in that table is a defined name imported from the EDU-matic `.xlsm`
(plus a handful Manipula seeds itself, marked **[Manipula]** below). This page
says, for each one, **what reads it** and **what changes in the output when you
change it** — including the ones that currently change nothing at all.

## How to read this

| Mark | Meaning |
|---|---|
| ✔ | A formula reads it. Changing it changes the generated EDU. |
| ⚠ | **Nothing reads it.** Manipula imports it, shows it, saves it — and never looks at it again. Changing it does nothing. |
| ⚠+ | Nothing reads it, **but the validator still demands a numeric value** — leave it filled in or Validate reports an error. |

"Blank → *n*" is the fallback a formula uses when the cell is empty, so you can
see what an unset global silently becomes.

Manipula writes three game files: `export_descr_unit.txt`,
`export_descr_buildings.txt` and `descr_mercenaries.txt`. Anything that would
have to land in `descr_mount.txt`, the skeleton files, `descr_projectile_new.txt`
or `descr_engines.txt` has nowhere to go today — that is why several
speed/pool-style globals below are inert.

---

## 1. Mod identity

| Global | | What it does |
|---|---|---|
| `ModName` | ✔ | Fills **Mod Info → Name**. Cosmetic: shown in the UI and stamped into the saved project. |
| `ModPlatform` | ✔ | Fills **Mod Info → Platform** and is the master switch for engine behaviour. `RTW` / `ALX` vs `M2TW` / `KGDM` changes soldier-count clamps (6–60 vs 4–100), the heat clamp (5 vs 6) and the weapon/armour upgrade bonuses, and gates the M2-only attributes (`start_not_skirmishing`, `fire_by_rank`, `explode`, …). Validate rejects any other value. |
| `ModEra` | ✔ | Fills **Mod Info → Era**. Label only — no formula reads it. |

## 2. The faction list — `Faction1` … `FactionN`, `FactionQuantity`

`Faction1`, `Faction2`, … each hold **one faction tag** (`romans_julii`,
`carthage`, …). They all serve the same purpose, and **their order is the
order**:

* it is the column order of the faction availability flags on the Units screen;
* it is the order the `ownership` line is written in;
* it is the order `ethnicity` blocks are emitted in.

A tag typed here is the tag written into the EDU, verbatim. Renaming one is what
the **Rename faction** box on the Mod Info screen is for — it migrates the tag
through unit ownership, availability and Core Data instead of leaving orphans
behind. Empty slots are skipped and the list is read up to the last non-empty
one, so a new faction is just the next free `FactionN`.

`FactionQuantity` ✔ — the workbook's count of live faction slots, and it matters
**only while importing an `.xlsm`**: it caps how many per-unit faction
availability columns are read, at `FactionQuantity + 1`, mirroring the VBA. Set
it too low and an import silently drops the Y/M flags of every faction past that
slot. Once the project is imported it has no further effect — ownership and
`ethnicity` emission walk the whole `FactionN` list regardless, because the VBA's
cap used to drop those factions from the output too.

`EthnicityExcludeFactions` ✔ **[Manipula]** — comma-separated tags that never get
an `ethnicity` line (culture umbrellas, placeholder / rebel slots). Default:
`greeks, germanics, gauls, scythians, hellenistic_rebels, dummies`.

## 3. Unit size

| Global | | What it does |
|---|---|---|
| `MenPerUnit` | ✔ | Base soldier count, before every unit-size modifier. Validate requires 6–60 (RTW/ALX) or 4–100 (M2TW/KGDM). |
| `GlobalUnitSizeMdf` | ✔ | Blanket multiplier on top of the whole size chain (recruitment × quality × category × specialty × culture × dwelling). Also scales engines-per-unit and mounts-per-unit. Blank → 1. |

Foot counts round to the nearest 5, cavalry and general bodyguards to the
nearest 2, then clamp to the platform min/max. Ships take their crew straight
from the ships table (`Men per ship`) — no modifier chain at all.

`ShipNonScaling` ✔ **[Manipula]** — `1` or `Y` gives every ship entry the
`non_scaling` attribute and writes a crew of **1** into its `soldier` line, while
still pricing and upkeeping it on its real `Men per ship` (6 in stock data).
Blank / `0` = off. Ships only; nothing else in the file moves.

## 4. Base soldier stats

The "generic unarmed soldier" every unit is built up from.

| Global | | What it does |
|---|---|---|
| `UnitAttack` | ✔ | Base attack, before quality/specialty/culture modifiers and the weapon's own attack. Blank → 1. |
| `UnitCharge` | ✔ | Base charge, same chain; also feeds the secondary charge stat. Blank → 1. |
| `UnitDefence` | ✔ | Base defence skill, before quality/specialty modifiers. Blank → 1. |
| `UnitMorale` | ✔ | Base morale, before quality/specialty/culture modifiers, armour morale and start experience. Blank → 1. |
| `UnitDiscipline` | ✔ | Base discipline score; bucketed into `low` / `normal` / `disciplined` / `impetuous` on `stat_mental`. Blank → 1. |
| `UnitTraining` | ✔ | Base training score; bucketed into `untrained` / `trained` / `highly_trained` on `stat_mental`. Blank → 1. |
| `UnitPriHP` | ✔ | First number of `stat_health` (doubled for the Chariot specialty). Blank → 1. |
| `UnitSecHP` | ✔ | Second number of `stat_health` — the mount's hitpoints. Blank → 0. Elephants and chariots are excluded. |
| `Lethality` | ✔ | Base lethality for RTW/ALX **melee** attacks, multiplied by the weapon's and the skeleton's lethality modifiers. Ranged attacks, and everything on M2TW/KGDM, always get 1. Blank → 1. |
| `UnitSurvThreshold` | ⚠+ | Nothing reads it. Validate still requires a number. |

## 5. Mass

Mass is the spine of the system: it drives heat, class (light/heavy), `can_swim`
and `hide_*` eligibility, charge, and the attack/defence skill penalties.

| Global | | What it does |
|---|---|---|
| `ManMass` | ✔ | Mass of a naked soldier. `SoldierMass = ManMass + armour mass`. Also the divisor in the charge formula and the zero point of the mass-based skill penalties. Blank → 0. |
| `BaseHorseMass` | ✔ | `HorseMass = mount mass mdf × BaseHorseMass`; also the divisor in the cavalry heat term. Blank → 0 in the mass formula, 1 in the heat formula. |
| `GlobalMassMdf` | ✔ | Blanket multiplier on the mass written into the `soldier` line. Blank → 1. |
| `ExtraMassPerSkill` | ✔ | How much mass one point of attack/defence skill costs: the penalty is `(SoldierMass − ManMass) / ExtraMassPerSkill`. Larger value = gentler penalty. Blank → 1. |
| `ExtraMassPerHeat` | ✔ | The same idea for `stat_heat`: mass over `ManMass` divided by this, times the armour's heat modifier. Larger value = less overheating. Blank → 1. |
| `DefSkillFraction` | ✔ | Splits that mass penalty between the two stats — defence pays `DefSkillFraction` of it, attack pays `1 − DefSkillFraction`. At 0.75, three quarters lands on defence. Blank → 0. |

## 6. Mass thresholds (class, swimming, hiding, frightening)

| Global | | What it does |
|---|---|---|
| `MediumInfThreshold` | ✔ | Infantry lighter than this can get `can_swim` (when the category allows it). |
| `HeavyInfThreshold` | ✔ | Infantry class flips `light` → `heavy` at the Medium/Heavy midpoint. Also the ceiling for `hide_forest` / `hide_long_grass`, and for the swim allowance a dwelling can grant. |
| `MediumCavThreshold` | ✔ | Cavalry equivalent of the swim check, measured on `2×SoldierMass + HorseMass/2`. |
| `HeavyCavThreshold` | ✔ | Cavalry class flips at the Medium/Heavy midpoint; the same weighted mass gates cavalry hiding and `frighten_foot`. Also the divisor in the elephant/chariot heat term. |

All four fall back to infinity when blank — every unit counts as light and
nothing qualifies as heavy.

## 7. Global stat multipliers

Applied last, to the finished stat. All blank → 1.

| Global | | Lands on |
|---|---|---|
| `GlobalAttackMdf` | ✔ | `stat_pri` / `stat_sec` attack (and ship attack, clamped 1–63). |
| `GlobalChargeMdf` | ✔ | `stat_pri` / `stat_sec` charge bonus. |
| `GlobalDefenceMdf` | ✔ | Defence skill on `stat_pri_armour` / `stat_sec_armour`. |
| `GlobalArmourMdf` | ✔ | Armour value on `stat_pri_armour` (armour model + mount armour). |
| `GlobalShieldMdf` | ✔ | The shield component of the armour model. |
| `GlobalMoraleMdf` | ✔ | Morale on `stat_mental`. |
| `GlobalRangeMdf` | ✔ | Missile range on `stat_pri` / `stat_sec` / engine projectiles. |
| `GlobalAmmoMdf` | ✔ | Ammunition count on the same lines. |
| `GlobalRecrCostMdf` | ✔ | Final multiplier on recruitment price. |
| `GlobalUpkCostMdf` | ✔ | Final multiplier on upkeep. |
| `GlobalSpeedMdf` | ⚠+ | **Nothing reads it.** Speed reaches Manipula only through the skeleton tables' `Speed` column, and only to feed the charge formula; real movement speed lives in `descr_mount.txt` and the skeleton files, which Manipula does not write. Validate still requires a number. |
| `BaseMountSpeedMdf` | ⚠+ | Same story — no formula applies it. Validate still requires a number. |

## 8. Cost model

Manipula ports two cost families and picks between them automatically:

> **The v0.7.0 exponential model is used only when `CombatExp`, `AttackCostCoeff`
> and `DefenceCostCoeff` are all present.** Clear any one of them and every unit
> silently re-prices on the old v2.6 linear model. Treat the three as a set.

| Global | | What it does |
|---|---|---|
| `CostPerMan` | ✔ | The flat per-soldier floor every price starts from. Blank → 0. |
| `CombatExp` | ✔ | The exponential base. Attack cost is `AttackCostCoeff × CombatExp^(attack + charge×factor − AverageAttack)`, defence likewise. At ~1.04 each extra attack point costs ~4% more than the last — raise it and elites get disproportionately expensive. Blank → 1.04. |
| `AttackCostCoeff` | ✔ | Price of an exactly-average-attack unit, before modifiers. Blank → 12. |
| `DefenceCostCoeff` | ✔ | The same for defence. Blank → 10. |
| `AverageAttack` | ✔ | The attack score treated as "average" — the exponent's zero point. Keep it near the roster's real mean or everything drifts cheap/expensive together. Blank → 12.8. |
| `AverageDefenceTotal` | ✔ | The same zero point for armour + defence + shield. Blank → 29.7. |
| `InfChargeCostFactor` | ✔ | How much of an infantry unit's charge bonus is priced as attack. Blank → 0.2. |
| `CavChargeCostFactor` | ✔ | The same for cavalry — 1 means cavalry pay full price for charge. Blank → 1. |
| `MissileMeleeFraction` | ✔ | How much of a missile unit's *melee* ability it pays for. Blank → 0.4. |
| `ArmourCostMdf` | ✔ | Weight of armour points inside the defence-cost term. Blank → 1.7. |
| `ShieldCostMdf` | ✔ | Weight of shield points in the same term. Blank → 1. |
| `FootMoraleFactor` | ✔ | How strongly morale scales an infantry price. 0 = morale is free; 1.2 = high morale is a real surcharge. Blank → 1. |
| `FootMissileMoraleFactor` | ✔ | The same, foot missile. |
| `CavMoraleFactor` | ✔ | The same, cavalry. |
| `CavMissileMoraleFactor` | ✔ | The same, mounted missile. |
| `UnitCostExponential` | ✔ **[Manipula]** | Flattens the top of the curve: `price = base^UnitCostExponential × UnitCostModifier`. Below 1, expensive units get relatively cheaper. Blank → 0.8. |
| `UnitCostModifier` | ✔ **[Manipula]** | The offset that compensates for that flattening. Blank → 1.98. |
| `UpkeepToCostRatio` | ✔ | Upkeep as a fraction of price, before the quality / category / culture upkeep modifiers. Ships ignore it — their upkeep comes straight from the ships table. Blank → 0. |
| `CBCostMultiplier` | ✔ | Custom-battle cost as a fraction of recruitment price; the penalty figure is half that. Blank → 0. |
| `MercCostMultiplier` | ✔ **[Manipula]** | Multiplier on the EDU base cost when writing `descr_mercenaries.txt`. Blank → 1.8. |

### Weapon-attribute price values

Each is the price of one point of that attribute, and each only bites when the
weapon / projectile actually carries the flag. All blank → 0.

| Global | | Attribute |
|---|---|---|
| `APValue` | ✔ | Armour-piercing (primary, secondary, projectile, special mount, engine). Projectiles on foot-missile units count it at ×1.1. |
| `BPValue` | ✔ | Body-piercing. |
| `ThrownValue` | ✔ | Thrown projectiles. |
| `LaunchingValue` | ✔ | Launching (knocks targets back). |
| `AreaAttackValue` | ✔ | Area attack. |
| `LightSpearValue` | ✔ | `spear` / `light_spear`. A negative value makes spears *cheaper*. |
| `SpearBonusValue` | ✔ | The `spear_bonus` value itself. |
| `ShortPikeValue` | ✔ | `short_pike` / `long_pike`. |
| `APFraction` | ⚠+ | Nothing reads it. Validate still requires a number. |
| `ChargeFraction` | ⚠+ | Nothing reads it — the charge share of attack cost is `InfChargeCostFactor` / `CavChargeCostFactor`. Validate still requires a number. |
| `CombatExponent` | ⚠+ | **Not** the cost exponent. The live one is `CombatExp`; this older name is dead. Validate still requires a number. |
| `PrimaryMeleeFraction` | ⚠ | Nothing reads it. |
| `NonSpearInfFraction` | ⚠ | Nothing reads it. |
| `SpearInfFraction` | ⚠ | Nothing reads it. |

## 9. Terrain, heat and morale extras

| Global | | What it does |
|---|---|---|
| `MeleeFraction` | ✔ | When a unit carries a secondary weapon, its terrain bonuses (scrub / sand / forest / snow) blend as `primary × MeleeFraction + secondary × (1 − MeleeFraction)`. Blank → 0.5. Since 0.41.0 it no longer touches `mount_effect`: the vs horse / elephant / chariot / camel values from every weapon add 1:1. |
| `MeleeFractionImpactingTerrainEffect` | ✔ **[Manipula]** | Switch for the terrain blend above. 0 (or N) turns it off: the primary and secondary weapons' scrub / sand / forest / snow values then add 1:1, so a secondary spear's −4 forest counts as −4 instead of −1. Blank / 1 → on, the VBA result. On the RIS roster, 0 changes `stat_ground` on 612 units and nothing else. |
| `ArmourMoraleMdf` | ✔ | Morale added per point of armour — armour makes men brave. Blank → 0. |
| `HorseMassHeatModifier` | ✔ **[Manipula]** | Weight of *horse* mass in the cavalry heat term. Blank → 1 (the old hardcoded VBA value). |
| `RiderMassHeatModifier` | ✔ **[Manipula]** | Weight of *rider* mass in the same term. Blank → 0.7. |
| `MassSandModifier` | ✔ **[Manipula]** | Sand penalty per point of soldier mass: `sand += MassSandConstant − MassSandModifier × SoldierMass`. Blank → 0, i.e. no mass effect, exactly like the VBA. |
| `MassSandConstant` | ✔ **[Manipula]** | The zero point of that line — constant 2.4 with modifier 3.0 flips sand from help to hurt at ~0.8 mass. Blank → 0. |
| `MassSnowModifier` | ✔ **[Manipula]** | The same for snow. Blank → 0. |
| `MassSnowConstant` | ✔ **[Manipula]** | The same for snow. Blank → 0. |
| `ScrubFraction` | ⚠ | Nothing reads it. Scrub bonuses come only from the specialty / formation / dwelling / weapon / mount columns. |
| `SandFraction` | ⚠ | The same — tune sand with the `MassSand*` pair above. |
| `SnowFraction` | ⚠ | The same. |
| `ForestFraction` | ⚠+ | The same. Validate still requires a number. |
| `StatHeatValue` | ⚠ | Nothing reads it. `stat_heat` is armour heat modifier × mass, plus the quality and dwelling heat columns. |

### vs-bonus gates

| Global | | What it does |
|---|---|---|
| `HorseFraction` | ✔ | **An on/off gate, not a scale.** Above 0, `vs horse` bonuses are summed from the core-data columns; at 0 they are never emitted. The number itself is not multiplied in anywhere. |
| `ElephantFraction` | ✔ | The same gate for `vs elephant`. |
| `ChariotFraction` | ✔ | The same gate for `vs chariot`. |
| `CamelFraction` | ✔ | The same gate for `vs camel`. |
| `CavalryFraction` | ⚠+ | Nothing reads it. Validate still requires a number. |

When all four bonuses come out non-zero on one unit, the two smallest are
dropped — RTW only honours a couple.

## 10. Armour soft cap **[Manipula]**

| Global | | What it does |
|---|---|---|
| `ArmorSoftCap` | ✔ | Armour points above this count for less. |
| `ArmorSoftCapMdf` | ✔ | How much less. Cap 15 / mdf 0.5 turns a raw 19 into `15 + 4×0.5 = 17`. Mdf 0 makes it a hard cap; mdf 1 is a no-op. |

**Both** must carry a value or the cap does nothing — blank (the default) leaves
armour untouched. The taper is applied *before* costing, so the unit is priced as
a 17-armour unit too.

## 11. Class and entry switches

| Global | | What it does |
|---|---|---|
| `CavBGSkirmish` | ✔ **[Manipula]** | Non-zero makes general / cavalry-bodyguard units emit `class skirmish` instead of `light` / `missile`. Blank → 0 (the prior behaviour). |
| `aor_default_rec_priority` | ✔ | The `recruit_priority_offset` written on AoR and Merc entries (RIS uses −100 to push them below factional units). Also accepted under the old name `AorRecrPriority`. |

## 12. M2TW-only

| Global | | What it does |
|---|---|---|
| `PoolRefreshRate` | ⚠ | Nothing reads it. Validate demands it when the platform is M2TW/KGDM. It would belong on the M2 `stat_cost` recruitment-pool fields. |
| `PoolMaxCap` | ⚠ | The same. |

## 13. Globals that currently do nothing

Every one of these is imported and saved, and **no formula reads any of them**.
They are almost all "price of one attribute point" knobs from the original
EDU-matic that the v0.7.0 cost model replaced with the `CombatExp` curve. The
EDU-matic Documentation sheet greys them out for the same reason: *"they are
currently not used in any formulas, so changing their values will not have any
effect."*

`CanHordeValue`, `CanSapValue`, `CanSwimValue`, `ChantValue`, `CommandValue`,
`FrightenFootValue`, `FrightenMountValue`, `GeneralUnitValue`, `GunUnitValue`,
`HardyValue`, `HideAllValue`, `HideImpValue`, `HideValue`, `IsPeasantValue`,
`MercUnitValue`, `PowerChargeValue`, `SeaFaringValue`, `StartNoPhalanxValue`,
`StartNoSkirmishValue`, `StatHeatValue`, `VeryHardyValue`, `WarcryValue`,
`PrimaryMeleeFraction`, `NonSpearInfFraction`, `SpearInfFraction`,
`ScrubFraction`, `SandFraction`, `SnowFraction`

The attributes themselves still work — `can_swim`, `hide_forest`, `hardy`,
`sea_faring` and the rest are emitted from the category / specialty / dwelling /
mass rules. They are simply **free**: a unit is not charged for having them.

These also do nothing, but Validate still requires a number in them:
`APFraction`, `BaseMountSpeedMdf`, `CavalryFraction`, `ChargeFraction`,
`CombatExponent`, `ForestFraction`, `GlobalSpeedMdf`, `UnitSurvThreshold`, plus
`PoolRefreshRate` / `PoolMaxCap` on M2TW/KGDM.

---

*Method: every global name was grepped across the whole Manipula source and each
formula that consumes it was read. A ⚠ means "no reference exists in the code",
not "probably unused".*
