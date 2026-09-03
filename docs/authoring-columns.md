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
| `exclusions` | no | what this explicitly does NOT grant — write it only when the clause's wording creates a credible nearby misreading (common on GLUE/Fusion perks; rare on a simple bonus). Not a system rule — blank is the normal case, not backlog. |
| `counterweight` | no | authored drawback for unusually strong or trait-like perks; blank when none |
| `enhanced_threshold` | no | for perks that escalate on a secondary threshold (e.g. Anti Perks strengthening further below their ceiling); blank when the perk has no escalation tier |
| `enhanced_text` | no | prose for the escalated effect; blank when `enhanced_threshold` is blank |

**Canonical anatomy: one passive clause + one purpose.** A perk grants only what its clause
(`text`) states — `exclusions` is a disclaimer for a specific wording risk, not a second place
to define scope. If you find yourself listing what the perk *doesn't* do just to be thorough,
that's a sign the clause itself is under-specified, not a missing `exclusions` entry.

`bonus_category` + `bonus_type` drive stacking. Two perks with the same `subject` **and** same
`bonus_type` keep only the highest. Same `subject`, different `bonus_type` — they sum.
Only **FLAT_BONUS** and **THRESHOLD** grant a stackable numeric value — leave both columns
blank for the other four families: COVERAGE (extra info + extra info is a set union, not a
sum), PERMISSION and RELIABILITY (no value to stack), and SUBSTITUTION (you either substitute
or you don't).

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
| `practice_root_id` | no | the entry feat that established this practice (a literal feat/fusion id — an entry feat is commonly its own practice root); blank only for a feat establishing one for the first time |
| `fusion_root_id` | no | set only on descendants of a Fusion |
| `requirements` | no | see requirement mini-syntax below |
| `sources` | no | see source mini-syntax below |
| `rarity` | yes | COMMON / UNCOMMON / RARE / SUPERNATURAL |
| `zone_id` | no | blank = universal |
| `cp_cost` | yes | 1 CP per feat, including fusions — cost is chain length, not tier |
| `exclusions` | no | see perks.csv's `exclusions` — same field, same optionality, same reasoning |

**Ancestry is three distinct relationships — never collapse them into one prerequisite
field.** `authority_root_id` (owns the rules domain), `practice_root_id` (the entry feat that
established this practice), and a `PRIOR_NODE` requirement (immediate chain entry) each answer
a different question, and the converter validates all three resolve independently. A descendant
several links down the chain does not need to restate the branch's base-skill requirement on
every node — the chain of `PRIOR_NODE`s back to the practice root already guarantees it; repeat
only the specific threshold this node adds (typically a specialization's own level, via
`SKILL_LEVEL:<specialization_id>:<n>` — `SKILL_LEVEL` resolves against both `skills_canonical.csv`
and `specializations.csv`).

## `fusions.csv`

Every `feats.csv` column, plus:

| Column | Required | Notes |
|---|---|---|
| `operator` | yes | COMPRESSION / NUMERICAL_PROGRESSION / FEATURE_PROGRESSION / TRANSFORMATIVE_CONVERSION / GLUE |
| `parents` | yes | `feat_id:DISPOSITION;feat_id:DISPOSITION` |
| `target_trait_id` | only for TRANSFORMATIVE_CONVERSION | |
| `cp_refund` | no | only when the conversion explicitly grants one |
| `parent_disposition_reason` | no | the judgment behind each parent's fate, in prose — see below |

Dispositions: `INTEGRATED`, `PREREQUISITE_ONLY`, `DEFERRED_SEED`, `REJECTED`.

Example: `parents = sword_focus:INTEGRATED;sword_guard:INTEGRATED;combat_initiative:DEFERRED_SEED`

**Parent conservation is a judgment call, not determined by `operator`.** There is no rule that
only `TRANSFORMATIVE_CONVERSION` removes a parent's capability. A fusion conserves parent
capability *unless* the parent has become redundant — subsumed by numerical progression, made
obsolete, overlapping with the new result, or transformed. The test: never remove a capability
the player can still meaningfully use on its own. Record that judgment in
`parent_disposition_reason` (free text, e.g. `"CONSERVE — the parent block stays independently
useful; redirection is added, not substituted."` or `"ABSORB — its bonus is subsumed by the new
result."`) — optional, but write it whenever a parent's fate isn't obvious from `disposition`
alone.

---

## Mini-syntax

**Requirements** — `;`-separated, each `TYPE:target:threshold`, threshold omitted for booleans.

```
SKILL_LEVEL:melee_weapons:9
SKILL_LEVEL:craft.Woodwork:3  <- parameterized skill, specific instance (period, not colon — colon is this syntax's own field separator)
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

> `content/effect_ladder.csv` — 14 rows. The original 6 are all ENTRY tier (every legacy feat
> gates at skill 1-7); `numeric_value` is authored for FLAT_BONUS only, the other five
> families' `value_text` is set but `numeric_value` is still an open author decision.
> Savepoint v0.2's open question #1 and Authoring GDD v2 §12's clause-tier-equivalence
> concern are what's being pressure-tested — extend past ENTRY once that holds up.
> 8 more rows (INTERMEDIATE/ADVANCED, covering FLAT_BONUS, THRESHOLD, COVERAGE, RELIABILITY,
> PERMISSION) were added to cover the chain-progression perks' (family, tier) references —
> the file referenced but not supplied when the chain slice first landed.

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

`specializations.csv`'s `parent_skill` column is keyed by display name, not id — future edges
should reference stable ids, never display names. Confirmed renames live as data in
`content/specialization_parent_aliases.csv` (`legacy_parent_name`, `canonical_skill_id`, `note`)
rather than hardcoded in `scripts/adapters/reference.ts`, so adding a newly-confirmed rename is
a CSV edit, not a code change. Two entries so far: `"Heavy Armor" -> full_armor_handling` and
`"Melee Weapons" -> melee_weapons_handling` (renamed from "Heavy Weapons Handling"). An aliased
row is still reported (as a resolved-via-alias note, not a dead end) so the CSV cell gets fixed
eventually. This stays scoped to confirmed renames only; the other unresolved `parent_skill`
names (Projectile Weapons, Faith, Nature Focus, Light Weapons, Light Armor, Knowledge, Magic
Object, Appraisal) are real, unconfirmed gaps and stay reported, not guessed at — resolving all
181 rows is a separate pass.

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
8. ~~Every perk and feat has a non-empty `boundary`.~~ **Removed (Phase 8).** This was never a
   system rule — it came from a v3.1 worksheet relabeling v3's "Exclusions" authoring field,
   mistakenly made required in Phase 1. The renamed field (`exclusions`) is optional on Perk,
   Feat, Fusion, and Keystone alike.
9. Fusion parents all exist and each carries a disposition.
10. `TRANSFORMATIVE_CONVERSION` has a `target_trait_id`; no other operator does.

Plus one check outside the numbered list: **ancestry resolution** (Phase 8) — every feat/fusion's
`practice_root_id`, when present, must resolve to a real feat/fusion id (unresolved refs
downgrade to a warning under `--draft`, same as other pending-content categories).
`authority_root_id` resolution is already covered by rule 1; `PRIOR_NODE` resolution too.

Errors report as `sheet!row: message` so you fix the CSV, not the JSON.
