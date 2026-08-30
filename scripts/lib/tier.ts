/**
 * Shared tier-band logic. Tier is always derived, never authored directly —
 * used by both root_floor (from a skill level) and effect_floor (from a
 * feat's perks) when computing Feat.derived_tier = max(root_floor, effect_floor).
 */

import type { Tier } from "../../schema/spiral.ts";

/** ENTRY < INTERMEDIATE < ADVANCED < EXPERT < MASTER */
export const TIER_ORDER: readonly Tier[] = ["ENTRY", "INTERMEDIATE", "ADVANCED", "EXPERT", "MASTER"];

export function tierRank(tier: Tier): number {
  return TIER_ORDER.indexOf(tier);
}

/** max() over one or more tiers, per Tier's ENTRY..MASTER ordering. */
export function maxTier(first: Tier, ...rest: Tier[]): Tier {
  return rest.reduce((acc, t) => (tierRank(t) > tierRank(acc) ? t : acc), first);
}

/** Skill-level bands: 1-10 ENTRY, 11-25 INTERMEDIATE, 26-40 ADVANCED, 41-50 EXPERT, 50+ MASTER. */
export function skillLevelToTier(level: number): Tier {
  if (level <= 10) return "ENTRY";
  if (level <= 25) return "INTERMEDIATE";
  if (level <= 40) return "ADVANCED";
  if (level <= 50) return "EXPERT";
  return "MASTER";
}
