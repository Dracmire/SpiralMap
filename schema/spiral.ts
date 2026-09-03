/**
 * SPIRAL PASSIVE BUILDER — DATASET SCHEMA
 * Version 1.0 (Phase 1)
 *
 * Source of truth for the shape of all authored content.
 * Authored as CSV (see docs/authoring-columns.md), converted to JSON, validated against this.
 *
 * Design constraints this encodes (from Savepoint v0.2):
 *  - Perks NEVER touch dice, explosion gate, or success-band TNs. Those are Skill/Action only.
 *  - Perks store {subject, family, tier} — never a raw number. Numbers come from ladders.
 *  - Tier is DERIVED: max(root_floor, effect_floor). Never authored directly on a Feat.
 *  - Feat/Header is the CP purchase unit (1 point = 1 node, PoE-style). Perks are not bought.
 *  - Every requirement is a typed edge. The type set is closed.
 */

// ─────────────────────────────────────────────────────────────
// PRIMITIVES
// ─────────────────────────────────────────────────────────────

export type AttributeId = "STR" | "AGI" | "INT" | "PER" | "WIL" | "CHA";

/** Five brackets, mapped to skill-level bands 1-10 / 11-25 / 26-40 / 41-50 / 50+ */
export type Tier = "ENTRY" | "INTERMEDIATE" | "ADVANCED" | "EXPERT" | "MASTER";

/** Confirmed present in real content (Anti tab uses C / UC / R). */
export type Rarity = "COMMON" | "UNCOMMON" | "RARE" | "SUPERNATURAL";

/** Skill level caps. Crossing one retires a success band + lowers explosion gate. */
export type KnowledgeTier = "CORE" | "ADVANCED" | "SUPERIOR" | "APEX";

/** Top-level bonus partition. Independent pools — all four may apply to one roll. */
export type BonusCategory = "ABILITY" | "CIRCUMSTANTIAL" | "TECHNIQUE" | "ENVIRONMENTAL";

/**
 * Sub-type within a category. Same subject + same bonus_type => keep highest.
 * Same subject + different bonus_type => sum.
 * OPEN: this vocabulary must be closed before bulk authoring. Seeded from observed content.
 */
export type BonusType =
  | "TRAINING" | "TERRAIN" | "ARMOR" | "DODGE" | "MAGIC"
  | "MORALE" | "SIZE" | "NATURAL" | "EQUIPMENT" | "REPUTATION";

// ─────────────────────────────────────────────────────────────
// EFFECT FAMILIES  (the Perk vocabulary)
// ─────────────────────────────────────────────────────────────

/**
 * WARNING — weakest load-bearing element in the design.
 * The Authoring GDD v2 §12 lists clause-tier equivalence as UNPROVEN.
 * SUBSTITUTION was added after reading the Anti tab: several real perks read
 * "your CHA works as if much higher toward group X", which is not a flat bonus
 * (no fixed magnitude) nor coverage (no scope expansion). Flagged for review.
 */
export type EffectFamily =
  | "FLAT_BONUS"    // numeric addition to an existing value
  | "RELIABILITY"   // rolled -> conditional -> automatic
  | "COVERAGE"      // one subject -> one target -> all qualifying targets
  | "THRESHOLD"     // changes a trigger/breakpoint on an existing mechanic
  | "PERMISSION"    // grants a mode of use not previously available
  | "SUBSTITUTION"; // a stat/roll is treated as a different value in a bounded context

/** A rung on one family's ladder. Numbers live HERE, never on a Perk. */
export interface EffectLadderStep {
  family: EffectFamily;
  tier: Tier;
  /** Rendered into perk display text. e.g. "+1", "automatic", "all qualifying targets" */
  value_text: string;
  /** Optional machine value for the compound-advantages panel. Null for non-numeric families. */
  numeric_value: number | null;
}

// ─────────────────────────────────────────────────────────────
// REQUIREMENTS  (the single edge type)
// ─────────────────────────────────────────────────────────────

export type RequirementType =
  | "SKILL_LEVEL"
  | "ATTRIBUTE"
  | "ATTRIBUTE_CEILING"  // Anti Perks only — the sole <= comparator
  | "VERB"
  | "TRAIT"
  | "PRIOR_NODE"
  | "CLASS"
  | "CLASS_TIER"
  | "INSIGHT"            // added: Class star-rank track gates on Insight, not CP
  | "CRITERIA";          // added: a checkable quest counter (Phase 7 class ladder), boolean,
                          // ticked manually in play — not evaluated from any other BuildState field

export interface Requirement {
  type: RequirementType;
  /** id of the target node/attribute/trait. For INSIGHT, the class_id. For CRITERIA, a
   * stable criteria id (the class_ladder.csv row's class_id — one criteria clause per row). */
  target: string;
  /** Numeric floor, or ceiling when type is ATTRIBUTE_CEILING. Null for boolean types
   * (including CRITERIA — it's ticked complete or not, no threshold). */
  threshold: number | null;
}

// ─────────────────────────────────────────────────────────────
// SOURCE  (how a node enters the player's available pool)
// ─────────────────────────────────────────────────────────────

/**
 * Source != Requirement. Source is world-facing availability, priced in XP.
 * Requirement is sheet-facing qualification, priced in CP.
 * TRAIT sources are hard gates: no XP substitutes for owning the Trait.
 */
export type SourceType = "TRAINER" | "TOME" | "GUILD" | "CLASS" | "TRAIT" | "BREAKTHROUGH";

export interface Source {
  type: SourceType;
  /** trait_id / class_id / free text for trainer & guild */
  target: string | null;
  /** XP cost of this access route. Null when the route is a hard gate (TRAIT). */
  xp_cost: number | null;
  /** Some retraining routes cost skill levels. */
  level_loss: number | null;
}

// ─────────────────────────────────────────────────────────────
// NODES
// ─────────────────────────────────────────────────────────────

export interface Skill {
  id: string;
  name: string;
  attribute: AttributeId;
  /** A secondary attribute the skill can draw on (e.g. Light Armor: STR primary, AGI alt). Null when there isn't one. */
  alt_attribute: AttributeId | null;
  /** Free-text macro-attribute/rank shorthand as authored (e.g. "MIND2", "AGI - BODY - SPRT") — not a parsed enum. */
  macro: string | null;
  kind: "CORE" | "SUPPORT";
  /** Knowledge-based skills instantiate: Knowledge: Arcana, Perform: Flute */
  is_parameterized: boolean;
  /** Bare instance names as authored (e.g. "Woodwork", "Drawing/Painting") — not "Skill: Instance" compounds. */
  instances: string[];
  group_ids: string[];   // drives the ~25% in-group CP discount
  description: string;
}

export interface Specialization {
  id: string;
  name: string;
  parent_skill_id: string;
  attribute: AttributeId;
  kind: "CORE" | "SUPPORT";
  /** universal, not zone-local — opens at parent skill 10 */
  gate_level: number;
  rarity: Rarity;
  description: string;
}

/** Above skill 10. Zone-local. Gated by Source, not merely by level. */
export interface AdvancedKnowledgeNode {
  id: string;
  name: string;
  parent_skill_id: string;
  zone_id: string;
  knowledge_tier: KnowledgeTier;
  gate_level: number;
  /** Multiple routes may unlock DIFFERENT downstream branches from the same milestone. */
  sources: Source[];
  rarity: Rarity;
  /** terminal cells read "Open Class: X" */
  opens_class_id: string | null;
  description: string;
}

/** One atomic passive clause. NEVER purchased alone — always owned by a Feat header. */
export interface Perk {
  id: string;
  name: string;
  /** what the effect points at — must be in the controlled subject list */
  subject: string;
  family: EffectFamily;
  tier: Tier;
  bonus_category: BonusCategory | null;
  bonus_type: BonusType | null;
  /** Prose shown to the player. Derived value_text from the ladder is injected. */
  text: string;
  /**
   * OPTIONAL. What this explicitly does NOT grant — written only when the clause's
   * wording creates a credible nearby misreading (common on GLUE/Fusion perks that
   * touch several capabilities at once; rare on a simple flat bonus). Not a system
   * rule: `boundary` was a Phase-1 mistake that made this required for every perk
   * (a v3.1 worksheet had relabeled v3's "Exclusions" authoring field, and that got
   * misread as mandatory). Canonical anatomy is one passive clause + one purpose;
   * a perk grants only what its clause states, exclusion text or not.
   */
  exclusions: string | null;
  /**
   * Counterweight — an authored drawback balancing an unusually strong perk, or one
   * behaving closer to a Trait than a Perk. Distinct from `exclusions` (an optional
   * scope-limit disclaimer) and from ATTRIBUTE_CEILING suspension (a requirement, not
   * a cost). Null when the perk needs no counterweight.
   */
  counterweight: string | null;
  /**
   * Anti Perks escalate as the gating attribute falls further below its ceiling.
   * enhanced_threshold is that escalation point (distinct from the feat-level
   * ATTRIBUTE_CEILING requirement); enhanced_text is the prose for the escalated
   * effect. Both null when the perk has no escalation tier (including non-Anti perks).
   */
  enhanced_threshold: number | null;
  enhanced_text: string | null;
}

export type FeatJob = "PROGRESS" | "GLUE" | "SIMPLIFICATION";

export interface Feat {
  id: string;
  name: string;
  /** 1-3. The CP purchase covers the whole header regardless of count. */
  perk_ids: string[];
  job: FeatJob[];

  // The Root triad — three distinct fields, never collapsed to one.
  authority_root: { type: "SKILL" | "CLASS_FEATURE" | "TRAIT" | "ATTRIBUTE"; id: string };
  practice_root_id: string | null;
  fusion_root_id: string | null;

  sources: Source[];
  requirements: Requirement[];
  rarity: Rarity;
  zone_id: string | null;   // null = universal
  cp_cost: number;

  /** DERIVED at build time as max(root_floor, effect_floor). Never authored. */
  derived_tier?: Tier;

  /** DERIVED at build time: true iff `requirements` contains an ATTRIBUTE_CEILING. Never authored. */
  is_anti_perk?: boolean;

  /** OPTIONAL — see Perk.exclusions; same rename, same reasoning, same Phase-1 mistake. */
  exclusions: string | null;
}

export type FusionOperator =
  | "COMPRESSION"
  | "NUMERICAL_PROGRESSION"
  | "FEATURE_PROGRESSION"
  | "TRANSFORMATIVE_CONVERSION"  // terminal — retires into a Trait
  | "GLUE";

export type ParentDisposition =
  | "INTEGRATED"        // migrates into the new header's capability set
  | "PREREQUISITE_ONLY" // qualifies, contributes nothing, stays active
  | "DEFERRED_SEED"     // reserved for a later upgrade, stays active
  | "REJECTED";         // should not appear in the requirement list

/** A Fusion IS a Feat purchase, plus a transaction record. */
export interface Fusion extends Feat {
  operator: FusionOperator;
  parents: { feat_id: string; disposition: ParentDisposition }[];
  /** Only for TRANSFORMATIVE_CONVERSION. Terminal: CP kept as provenance only. */
  target_trait_id: string | null;
  cp_refund: number | null;
  /**
   * OPTIONAL. The judgment call behind each parent's fate, in prose (e.g. "CONSERVE —
   * the parent block stays independently useful" / "ABSORB — its bonus is subsumed by
   * the new result"). Parent conservation is NOT determined by `operator` — there is no
   * rule that only TRANSFORMATIVE_CONVERSION removes a parent's capability. A fusion
   * conserves parent capability unless the parent has become redundant: subsumed by
   * numerical progression, made obsolete, overlapping with the new result, or
   * transformed. The test is always "does the player still have a meaningful reason to
   * use the parent on its own" — never inferred from `operator` or `disposition` alone.
   */
  parent_disposition_reason: string | null;
}

export interface Trait {
  id: string;
  name: string;
  /** Traits can act as a Source, raising which branches are reachable. */
  grants_source_for: string[];
  description: string;
  flaws: string;
}

// ─────────────────────────────────────────────────────────────
// CLASS  (output AND input — parallel Insight track)
//
// Phase 7: no content currently authors CharacterClass/ClassTierRow/UnlockLine/
// Keystone (content/classes.csv & friends were a Generalist/Specialist template
// that turned out not to match the real class structure, and were deleted).
// These types stay — Insight (below, see aligned_skill_ids/aligned_attribute_
// breakpoints) is a real, separate mechanic from the class ladder's criteria
// track and is explicitly not superseded — but classes[]/unlock_lines[]/
// keystones[] are empty until real content targets this shape again. The
// actual class progression now lives in LadderClass / SpiralDataset.class_ladder.
// ─────────────────────────────────────────────────────────────

export interface ClassTierRow {
  star: 0 | 1 | 2 | 3 | 4;
  insight_generalist: number;
  insight_specialist: number;
  level_min: number;
  /** Generalist unlocks a POOL (Line), or a Keystone. */
  generalist_grant: { kind: "LINE" | "KEYSTONE"; id: string } | null;
  /**
   * One entry per Specialist alternative at this star (e.g. Swordsman / Barbarian /
   * Soldier at Warrior 1-star — content/class_tiers.csv authors these as separate
   * SPECIALIST rows sharing one star). A named subclass's own progression lives in a
   * separate CharacterClass row (via parent_class_id); `grant` is set instead when the
   * alternative opens a Line or Keystone directly, with no subclass fork.
   */
  specialist_grants: { subclass_name: string | null; grant: { kind: "LINE" | "KEYSTONE"; id: string } | null }[];
}

export interface CharacterClass {
  id: string;
  name: string;
  /** Insight = sum of levels in these skills + attribute breakpoint bonuses */
  aligned_skill_ids: string[];
  aligned_attribute_breakpoints: { attribute: AttributeId; at: number; insight_bonus: number }[];
  tiers: ClassTierRow[];
  max_level: number;
  parent_class_id: string | null;
}

/** A pool of eligible content unlocked by a Generalist star rank. */
export interface UnlockLine {
  id: string;
  name: string;
  class_id: string;
  member_feat_ids: string[];
}

/** Class-track capstone. May require nodes from more than one skill cluster. */
export interface Keystone {
  id: string;
  name: string;
  class_id: string;
  requirements: Requirement[];
  perk_ids: string[];
  /** OPTIONAL — see Perk.exclusions; same rename, same reasoning. */
  exclusions: string | null;
}

export type ParentRule = "ROOT" | "SLOT_PAIR" | "ANY_LOWER_STAR_IN_TREE" | "ANY_2STAR_IN_TREE";

/**
 * One rank in one of the eight class trees (content/class_ladder.csv). Star 0 is a
 * tree's entry class (no parent, no gates); stars 1-3 sit in one of up to seven
 * lettered branch slots, two variants per slot. `parent_class_id` is a literal id
 * only for ROOT and SLOT_PAIR rows; ANY_LOWER_STAR_IN_TREE / ANY_2STAR_IN_TREE rows
 * carry "*" instead and resolve dynamically — see resolveParentIds in
 * scripts/adapters/class_ladder.ts, reused by the app for display.
 *
 * This gates on CRITERIA (a completed quest) + LEVEL (levels gained since taking the
 * class) + PRICE (1 level of XP, plus fate_cost FATE) — Insight (CharacterClass,
 * above) gates a different, unrelated track.
 */
export interface LadderClass {
  id: string;
  name: string;
  star: 0 | 1 | 2 | 3;
  tree_id: string;
  branch_slot: string;
  variant: number;
  /** Literal for ROOT/SLOT_PAIR; null for star 0 (no parent) and for wildcard rows
   * (parent_rule decides the resolved set instead). */
  parent_class_id: string | null;
  /** Null only for star 0 — the tree root has no parent and no rule. */
  parent_rule: ParentRule | null;
  attribute_tag: AttributeId | "VAR" | null;
  /** Added to the character's level cap on taking this class. Null for star 0. */
  level_cap_gain: number | null;
  /** FATE spent to take this class via a trainer (the cheap route). Null for star 0. */
  fate_cost: number | null;
  /** Levels of XP spent to take this class — authored as a constant 1 ("1 full level"). Null for star 0. */
  level_cost: number | null;
  /** The quest to complete. Null when criteria_source is NOT_APPLICABLE (star 0) or
   * PENDING (author hasn't written it yet) — render "criteria not yet authored", never
   * invent one. */
  criteria: string | null;
  criteria_source: "NOT_APPLICABLE" | "PENDING" | "SUGGESTED" | "AUTHORED" | null;
  grants: string | null;
  description: string | null;
  is_monster_class: boolean;
  /** Free-text provenance note from the author (e.g. a source-transcription error).
   * Passed through as-is — never validated, never invented. */
  data_issue: string | null;
}

// ─────────────────────────────────────────────────────────────
// SUPPORT TABLES
// ─────────────────────────────────────────────────────────────

/** From SpiralDemo Hoja 1 — confirmed authored data, levels 1-50. */
export interface SkillLevelRow {
  level: number;
  success_tn: number | null;   // null once the band has retired
  great_tn: number | null;
  epic_tn: number | null;
  heroic_tn: number | null;
  explosion_gate: number;      // 10 -> 9 -> 8
  /** e.g. "+6" .. "+105" — accelerates per knowledge tier. Null where unset. */
  effect_bonus: string | null;
  dice_pool: number | null;    // milestone grants only
  /** e.g. "Specialization (I)", "Focus(Sp I)". Null where unset. */
  unlock: string | null;
  cp_cost: number;
  cp_cost_accum: number;
  mastery_label: string | null; // Domini / Adept / Expert / Mastery
  /** Discounted cost track. The discount itself is cp_cost - cp_cost_mastery, not a stored field. */
  cp_cost_mastery: number;
  cp_accum_mastery: number;
  knowledge_tier: KnowledgeTier;
}

export interface SkillGroup {
  id: string;
  name: string;
  kind: "CORE" | "SUPPORT";
  key_attribute: AttributeId;
  member_skill_ids: string[];
  /** in-group purchases are cheaper; out-of-group pay full */
  discount_pct: number;
}

export interface Zone {
  id: string;
  name: string;
  description: string;
}

// ─────────────────────────────────────────────────────────────
// DATASET ROOT
// ─────────────────────────────────────────────────────────────

export interface SpiralDataset {
  version: string;
  zones: Zone[];
  attributes: { id: AttributeId; name: string; verbs: string[] }[];
  skills: Skill[];
  skill_groups: SkillGroup[];
  specializations: Specialization[];
  advanced_knowledge: AdvancedKnowledgeNode[];
  perks: Perk[];
  feats: Feat[];
  fusions: Fusion[];
  traits: Trait[];
  classes: CharacterClass[];
  unlock_lines: UnlockLine[];
  keystones: Keystone[];
  class_ladder: LadderClass[];
  effect_ladder: EffectLadderStep[];
  skill_level_table: SkillLevelRow[];
  /** controlled vocabulary — every Perk.subject must appear here */
  subjects: { id: string; name: string; category: BonusCategory }[];
}

// ─────────────────────────────────────────────────────────────
// BUILD STATE  (what a player assembles; what save/load round-trips)
// ─────────────────────────────────────────────────────────────

export interface BuildState {
  zone_id: string;
  skill_levels: Record<string, number>;
  attributes: Record<AttributeId, number>;
  trait_ids: string[];
  class_id: string | null;
  /** purchased Feat headers, in purchase order */
  feat_ids: string[];
  /** SkillGroup ids the character has committed to — the in-group CP discount
   * (Savepoint v0.2 §8) only applies to a skill purchase while its group is declared
   * here; skills outside every declared group are loose purchases at full price. */
  declared_group_ids: string[];
  /** CRITERIA requirement ticks — keyed by the requirement's `target` (a class_ladder.csv
   * class_id). Tracked in play, ticked manually; true once the player marks it complete. */
  criteria_ticked: Record<string, boolean>;
}

/** One row of the compound-advantages panel after stacking resolution. */
export interface ResolvedAdvantage {
  subject: string;
  category: BonusCategory;
  contributions: { perk_id: string; bonus_type: BonusType | null; value: number }[];
  total: number;
  /** Anti Perks suspended by attribute ceiling render greyed, not dropped. */
  suspended: boolean;
}
