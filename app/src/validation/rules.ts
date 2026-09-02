import type { Dataset, Perk, Feat } from "../types.ts";

/**
 * Live, per-node validation for author mode — mirrors scripts/convert.ts's rules
 * (base layer + rules 2/4/8 + the relevant slice of rule 1), duplicated here rather
 * than imported because convert.ts is a Node script (uses node:fs) that can't be
 * bundled for the browser. Keep the enum lists in sync with convert.ts/
 * docs/authoring-columns.md if either changes.
 */

export interface FieldIssue {
  field: string;
  message: string;
}

const FAMILIES = new Set(["FLAT_BONUS", "RELIABILITY", "COVERAGE", "THRESHOLD", "PERMISSION", "SUBSTITUTION"]);
const TIERS = new Set(["ENTRY", "INTERMEDIATE", "ADVANCED", "EXPERT", "MASTER"]);
const RARITIES = new Set(["COMMON", "UNCOMMON", "RARE", "SUPERNATURAL"]);
const AUTHORITY_ROOT_TYPES = new Set(["SKILL", "CLASS_FEATURE", "TRAIT", "ATTRIBUTE"]);
const FEAT_JOBS = new Set(["PROGRESS", "GLUE", "SIMPLIFICATION"]);
const BONUS_CATEGORIES = new Set(["ABILITY", "CIRCUMSTANTIAL", "TECHNIQUE", "ENVIRONMENTAL"]);
const BONUS_TYPES = new Set(["TRAINING", "TERRAIN", "ARMOR", "DODGE", "MAGIC", "MORALE", "SIZE", "NATURAL", "EQUIPMENT", "REPUTATION"]);
const NON_NUMERIC_FAMILIES = new Set(["PERMISSION", "RELIABILITY"]);
const ATTRIBUTE_CODES = new Set(["STR", "AGI", "INT", "PER", "WIL", "CHA"]);

export function validatePerk(perk: Perk, dataset: Dataset): FieldIssue[] {
  const issues: FieldIssue[] = [];
  if (!perk.id) issues.push({ field: "id", message: "required" });
  if (!perk.name) issues.push({ field: "name", message: "required" });
  if (!perk.text) issues.push({ field: "text", message: "required" });

  if (!perk.subject) {
    issues.push({ field: "subject", message: "required (rule 2)" });
  } else if (!dataset.subjects.some((s) => s.id === perk.subject)) {
    issues.push({ field: "subject", message: `"${perk.subject}" not found in subjects.csv` });
  }

  if (!perk.family) {
    issues.push({ field: "family", message: "required" });
  } else if (!FAMILIES.has(perk.family)) {
    issues.push({ field: "family", message: `not one of: ${[...FAMILIES].join(" / ")}` });
  }

  if (!perk.tier) {
    issues.push({ field: "tier", message: "required" });
  } else if (!TIERS.has(perk.tier)) {
    issues.push({ field: "tier", message: `not one of: ${[...TIERS].join(" / ")}` });
  }

  if (perk.family && !NON_NUMERIC_FAMILIES.has(perk.family)) {
    if (!perk.bonus_category) issues.push({ field: "bonus_category", message: "required for this family" });
    else if (!BONUS_CATEGORIES.has(perk.bonus_category)) issues.push({ field: "bonus_category", message: "not a valid category" });
    if (!perk.bonus_type) issues.push({ field: "bonus_type", message: "required for this family" });
    else if (!BONUS_TYPES.has(perk.bonus_type)) issues.push({ field: "bonus_type", message: "not a valid bonus_type" });
  }

  if (!perk.boundary) issues.push({ field: "boundary", message: "required (rule 8)" });

  return issues;
}

export function validateFeat(feat: Feat, dataset: Dataset): FieldIssue[] {
  const issues: FieldIssue[] = [];
  if (!feat.id) issues.push({ field: "id", message: "required" });
  if (!feat.name) issues.push({ field: "name", message: "required" });

  if (feat.perk_ids.length < 1 || feat.perk_ids.length > 3) {
    issues.push({ field: "perk_ids", message: `has ${feat.perk_ids.length}, must be 1-3 (rule 4)` });
  }
  for (const pid of feat.perk_ids) {
    if (!dataset.perks.some((p) => p.id === pid)) issues.push({ field: "perk_ids", message: `"${pid}" does not exist` });
  }

  if (feat.job.length === 0) issues.push({ field: "job", message: "required" });
  for (const j of feat.job) if (!FEAT_JOBS.has(j)) issues.push({ field: "job", message: `"${j}" is not a valid job` });

  if (!AUTHORITY_ROOT_TYPES.has(feat.authority_root.type)) {
    issues.push({ field: "authority_root_type", message: "not a valid type" });
  }
  if (feat.authority_root.type === "SKILL" && !dataset.skills.some((s) => s.id === feat.authority_root.id)) {
    issues.push({ field: "authority_root_id", message: `skill "${feat.authority_root.id}" not found` });
  }
  if (feat.authority_root.type === "ATTRIBUTE" && !ATTRIBUTE_CODES.has(feat.authority_root.id)) {
    issues.push({ field: "authority_root_id", message: `"${feat.authority_root.id}" is not a valid attribute` });
  }

  if (!RARITIES.has(feat.rarity)) issues.push({ field: "rarity", message: "not a valid rarity" });
  if (!feat.boundary) issues.push({ field: "boundary", message: "required (rule 8)" });

  return issues;
}
