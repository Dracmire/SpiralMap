# Authoring class content

Four CSVs. Each ships with one worked Warrior row and one blank row — delete the blank
when you start, it's only there to show the shape.

Same rules as everywhere else: `id` is lowercase snake_case, `_ids` columns are
`;`-separated, blank cell means null.

---

## `classes.csv` — the class itself

| Column | Notes |
|---|---|
| `class_id`, `name` | |
| `tier_kind` | CORE / MID / ADVANCED — where the class sits in the progression |
| `parent_class_id` | blank for Core classes; set for mid-classes built on a base |
| `aligned_skill_ids` | drives Insight. Every level in these skills adds to it |
| `attribute_breakpoints` | `ATTR:value:insight_bonus`, `;`-separated. Warrior: `STR:250:10;STR:350:20` |
| `max_level` | usually 50 |
| `zone_id` | blank = universal |

**Insight** = sum of levels across `aligned_skill_ids` + breakpoint bonuses. It accrues
automatically from ordinary play and is never spent — it only gates what the class opens.

## `class_tiers.csv` — the star track

One row per (class, star, path). Star 0 is entry and has no fork; stars 1–4 each fork into
a Generalist and a Specialist path.

| Column | Notes |
|---|---|
| `star` | 0–4 |
| `path` | ENTRY / GENERALIST / SPECIALIST |
| `insight_required` | the gate. Specialist is typically a hair above Generalist |
| `level_min` | character level floor |
| `grant_kind` | LINE / KEYSTONE / SUBCLASS |
| `grant_id` | points at `unlock_lines.csv` or `keystones.csv` |
| `subclass_name` | only for SUBCLASS grants |

Multiple SPECIALIST rows at the same star = alternatives the player picks between
(Swordsman / Barbarian / Soldier at Warrior 1-star).

## `unlock_lines.csv` — Generalist pools

A Line is a **pool of eligible feats**, not a single grant. Taking the Line makes its
members purchasable; it doesn't give them to you.

| Column | Notes |
|---|---|
| `line_id`, `name`, `class_id`, `star` | |
| `member_feat_ids` | feat ids from `feats.csv` / `legacy_feats.csv` |

## `keystones.csv` — class capstones

The class-track equivalent of a Fusion, reached by Insight rather than by a CP chain. May
require nodes from more than one skill cluster at once.

| Column | Notes |
|---|---|
| `keystone_id`, `name`, `class_id`, `star` | |
| `requirements` | same mini-syntax as feats. `INSIGHT:warrior:201` is the class gate |
| `perk_ids` | what it actually grants |
| `boundary` | **required** — the nearest thing it does not grant |

---

## Worked example: adding Barbarian (1-star)

Barbarian is a Specialist subclass, so it needs a row in `class_tiers.csv` and — if it has
its own progression — its own row in `classes.csv` with `parent_class_id = warrior`.

**1. Declare the fork** in `class_tiers.csv`:

```
warrior,1,SPECIALIST,101,10,SUBCLASS,,Barbarian,Rage-driven melee specialist
```

**2. If Barbarian progresses on its own track**, add it to `classes.csv`:

```
barbarian,Barbarian,MID,warrior,melee_weapons_handling;athletism;intimidation,STR:300:15,50,,
```

Its `aligned_skill_ids` may differ from Warrior's — that's the point of specialising. The
overlap (Melee Weapons) is what makes mastering the parent class empower the child.

**3. Give it content** — either a Line, a Keystone, or both:

```
# unlock_lines.csv
line_barbarian_1,Barbarian Line 1,barbarian,1,rage_strike;thick_hide,Feats a Barbarian may draw from

# keystones.csv
key_unbroken_rage,Unbroken Rage,barbarian,2,INSIGHT:barbarian:200;SKILL_LEVEL:melee_weapons_handling:10,perk_unbroken_rage,1,Does not grant a new attack action; only sustains an existing one,Capstone
```

**4. Author the perks** those ids point at, in `perks.csv` as normal.

---

## What the converter checks

1. Every `aligned_skill_ids` entry exists in `skills_canonical.csv`.
2. `attribute_breakpoints` parses as `ATTR:value:bonus`.
3. `grant_id` resolves to a real Line or Keystone when `grant_kind` is LINE or KEYSTONE.
4. `member_feat_ids` all exist.
5. Keystone `requirements` parse, and any `INSIGHT:` target names a real class.
6. Every Keystone has a non-empty `boundary`.
7. No two rows share (class_id, star, path) unless path is SPECIALIST.

---

## Two things not yet decided

**Do Line members cost CP?** A Line unlocks a pool; presumably its members are still
bought at one CP each, like any Feat. If a Line instead grants its contents free, the
cost model needs a flag — say so and it gets added.

**Do Keystones cost CP?** Currently modelled at 1 CP like a Feat, but they're gated by
Insight rather than by a purchase chain, so they might be free on reaching the star.
`cp_cost` is there either way; set it to 0 if they should be free.
