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
  | "INSIGHT";           // added: Class star-rank track gates on Insight, not CP

export interface Requirement {
  type: RequirementType;
  /** id of the target node/attribute/trait. For INSIGHT, the class_id. */
  target: string;
  /** Numeric floor, or ceiling when type is ATTRIBUTE_CEILING. Null for boolean types. */
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
  kind: "CORE" | "SUPPORT";
  /** Knowledge-based skills instantiate: Knowledge: Arcana, Perform: Flute */
  is_parameterized: boolean;
  instances: string[];
  group_ids: string[];   // drives the ~25% in-group CP discount
  description: string;
}

export interface Specialization {
  id: string;
  name: string;
  parent_skill_id: string;
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
  /** REQUIRED. What this explicitly does NOT grant. Renders on the node card. */
  boundary: string;
  /**
   * Counterweight — an authored drawback balancing an unusually strong perk, or one
   * behaving closer to a Trait than a Perk. Distinct from `boundary` (scope limit,
   * always present) and from ATTRIBUTE_CEILING suspension (a requirement, not a cost).
   * Null when the perk needs no counterweight.
   */
  counterweight: string | null;
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

  boundary: string;
}

export type FusionOperator =
  | "COMPRESSION"
  | "NUMERICAL_PROGRESSION"
  | "FEATURE_PROGRESSION"
  | "TRANSFORMATIVE_CONVERSION"  // terminal — retires into a Trait
  | "GLUE";

export type ParentDisposition =
  | "INTEGRATED"        // migrates in; emptied header retires
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
// ─────────────────────────────────────────────────────────────

export interface ClassTierRow {
  star: 0 | 1 | 2 | 3 | 4;
  insight_generalist: number;
  insight_specialist: number;
  level_min: number;
  /** Generalist unlocks a POOL (Line), or a Keystone. */
  generalist_grant: { kind: "LINE" | "KEYSTONE"; id: string } | null;
  /** Specialist unlocks a named sub-class outright. */
  specialist_subclass_ids: string[];
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
  boundary: string;
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
  dice_pool: number | null;    // milestone grants only
  cp_cost: number;
  cp_cost_accum: number;
  mastery_label: string | null; // Domini / Adept / Expert / Mastery
  cp_discount: number | null;   // mastery cashback
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
