# Authoring column spec

You author in **CSV/Excel**. The converter reads these sheets, validates, and emits `dataset.json`.
One sheet per file, one row per record, header row required, column names exactly as below.

Rules that apply everywhere:

- `id` is lowercase snake_case, unique within its sheet, and is what every other sheet points at.
- Any column ending `_ids` holds a `;`-separated list. Empty = empty list.
- Blank cell = null. Do not write "N/A" or "-".
- **Never author a number on a perk.** Write `family` + `tier`; the ladder supplies the number.
- **Never author `derived_tier` on a feat.** The converter computes it.

---

## `perks.csv`

| Column | Required | Notes |
|---|---|---|
| `id` | yes | |
| `name` | yes | |
| `subject` | yes | must exist in `subjects.csv` |
| `family` | yes | FLAT_BONUS / RELIABILITY / COVERAGE / THRESHOLD / PERMISSION / SUBSTITUTION |
| `tier` | yes | ENTRY / INTERMEDIATE / ADVANCED / EXPERT / MASTER |
| `bonus_category` | if numeric | ABILITY / CIRCUMSTANTIAL / TECHNIQUE / ENVIRONMENTAL |
| `bonus_type` | if numeric | TRAINING / TERRAIN / ARMOR / DODGE / MAGIC / MORALE / SIZE / NATURAL / EQUIPMENT / REPUTATION |
| `text` | yes | player-facing clause |
| `boundary` | yes | **required** — the nearest thing this does NOT grant |
| `counterweight` | no | authored drawback for unusually strong or trait-like perks; blank when none |
| `enhanced_threshold` | no | for perks that escalate on a secondary threshold (e.g. Anti Perks strengthening further below their ceiling); blank when the perk has no escalation tier |
| `enhanced_text` | no | prose for the escalated effect; blank when `enhanced_threshold` is blank |

`bonus_category` + `bonus_type` drive stacking. Two perks with the same `subject` **and** same
`bonus_type` keep only the highest. Same `subject`, different `bonus_type` — they sum.
Leave both blank for non-numeric families (PERMISSION, RELIABILITY) that grant no stackable value.

### Extraction-only conventions (not authored columns, not read by `convert.ts`'s schema checks)

A extraction pass that can't responsibly commit to a design call (which effect family, which tier,
which subject a perk belongs to) leaves the real column blank and instead writes a `*_suggested`
column alongside it — `family_suggested`, `tier_suggested`, `subject_suggested` — as a starting
point for the author to confirm or correct. These are conveniences for the human doing the CSV
fixup pass, not part of the authored schema; `convert.ts` never reads them for validation, and a
blank `family`/`tier`/`subject` still fails the normal required-column check until the real value
is filled in. Likewise, an extraction pass may propose new subjects into `content/subjects.proposed.csv`
without ever writing to `content/subjects.csv` itself — promoting a proposed subject into the real,
validated `subjects.csv` is an authoring decision, not something extraction does automatically.

## `feats.csv`

| Column | Required | Notes |
|---|---|---|
| `id`, `name` | yes | |
| `perk_ids` | yes | 1–3, `;`-separated |
| `job` | yes | PROGRESS / GLUE / SIMPLIFICATION, `;`-separated if several |
| `authority_root_type` | yes | SKILL / CLASS_FEATURE / TRAIT / ATTRIBUTE |
| `authority_root_id` | yes | |
| `practice_root_id` | no | the family boundary; blank only for entry feats that establish one |
| `fusion_root_id` | no | set only on descendants of a Fusion |
| `requirements` | no | see requirement mini-syntax below |
| `sources` | no | see source mini-syntax below |
| `rarity` | yes | COMMON / UNCOMMON / RARE / SUPERNATURAL |
| `zone_id` | no | blank = universal |
| `cp_cost` | yes | usually the standard header price |
| `boundary` | yes | |

## `fusions.csv`

Every `feats.csv` column, plus:

| Column | Required | Notes |
|---|---|---|
| `operator` | yes | COMPRESSION / NUMERICAL_PROGRESSION / FEATURE_PROGRESSION / TRANSFORMATIVE_CONVERSION / GLUE |
| `parents` | yes | `feat_id:DISPOSITION;feat_id:DISPOSITION` |
| `target_trait_id` | only for TRANSFORMATIVE_CONVERSION | |
| `cp_refund` | no | only when the conversion explicitly grants one |

Dispositions: `INTEGRATED`, `PREREQUISITE_ONLY`, `DEFERRED_SEED`, `REJECTED`.

Example: `parents = sword_focus:INTEGRATED;sword_guard:INTEGRATED;combat_initiative:DEFERRED_SEED`

---

## Mini-syntax

**Requirements** — `;`-separated, each `TYPE:target:threshold`, threshold omitted for booleans.

```
SKILL_LEVEL:melee_weapons:9
ATTRIBUTE:STR:300
ATTRIBUTE_CEILING:CHA:120      <- Anti Perks only
TRAIT:elemental_affinity
PRIOR_NODE:sword_focus
CLASS_TIER:warrior:2
INSIGHT:warrior:200
```

**Sources** — `;`-separated, each `TYPE:target:xp_cost:level_loss`. Trailing fields optional.

```
TRAINER::150
TOME::200:1
CLASS:mage_elementalist
TRAIT:elemental_affinity       <- hard gate, no xp substitutes
```

---

## `effect_ladder.csv`

The support table. One row per `(family, tier)`. **Changing a row re-prices every perk that
references it** — this is the coherence lever.

| Column | Notes |
|---|---|
| `family` | |
| `tier` | |
| `value_text` | rendered into the perk card, e.g. `+1`, `automatic`, `all qualifying targets` |
| `numeric_value` | blank for non-numeric families |

> ⚠ This table does not exist yet. It is open question #1 in Savepoint v0.2, and the
> Authoring GDD v2 §12 flags clause-tier equivalence as unproven. Author it thin first
> (FLAT_BONUS only), let the vertical slice pressure-test it, then extend.

## `subjects.csv`

Controlled vocabulary. Every `perks.subject` must resolve here or the build fails validation.

| Column | Notes |
|---|---|
| `id`, `name` | |
| `category` | default bonus category for this subject |

---

## Reference sheets (already extracted, mostly stable)

`skills.csv`, `specializations.csv`, `skill_groups.csv`, `group_skill_map.csv`,
`attribute_verbs.csv`, `macro_attributes.csv` — see the earlier extraction pass.

Two known fixes still pending: normalize `CAR` → `CHA` (16 rows), and add `Wilderness`
(WIL, Support) which appears in the group map but not the skill list.

## `skill_level_table.csv`

Transcribed from SpiralDemo Hoja 1. Confirmed authored data, levels 1–50.
Columns: `level`, `success_tn`, `great_tn`, `epic_tn`, `heroic_tn`, `explosion_gate`,
`effect_bonus`, `dice_pool`, `mastery_label`, `unlock`, `cp_cost`, `cp_accum`,
`cp_cost_mastery`, `cp_accum_mastery`, `knowledge_tier`. (Corrected against the real file —
there is no separate `cp_discount` column; the mastery discount is the delta between
`cp_cost`/`cp_accum` and their `_mastery` counterparts.)

Leave a TN blank once its band has retired. Retirement happens at the Knowledge-tier
boundary (11, 26, 41), not a fixed number of levels after hitting the floor of 5.

---

## What the converter checks

1. Every id referenced by another sheet exists.
2. Every `perks.subject` is in `subjects.csv`.
3. Every `(family, tier)` pair used by a perk exists in `effect_ladder.csv`.
4. Feats hold 1–3 perks.
5. No perk is owned by more than one active header.
6. No requirement cycles.
7. `ATTRIBUTE_CEILING` appears only on Anti Perks. (`is_anti_perk` is *derived from* whether a feat
   carries an `ATTRIBUTE_CEILING` requirement, which makes the rule's literal wording tautological —
   implemented instead as a contradiction check: the same attribute may not carry both a plain
   `ATTRIBUTE` floor and an `ATTRIBUTE_CEILING` on one feat where `floor >= ceiling`, an impossible
   range. A floor strictly below the ceiling is a valid band and is not flagged.)
8. Every perk and feat has a non-empty `boundary`.
9. Fusion parents all exist and each carries a disposition.
10. `TRANSFORMATIVE_CONVERSION` has a `target_trait_id`; no other operator does.

Errors report as `sheet!row: message` so you fix the CSV, not the JSON.
