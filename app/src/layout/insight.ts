import type { Dataset } from "../types.ts";
import type { BuildState, CharacterClass, ClassTierRow } from "../../../schema/spiral.ts";

export interface TierReachability {
  star: ClassTierRow["star"];
  insight_generalist: number;
  insight_specialist: number;
  generalist_reachable: boolean;
  generalist_shortfall: number; // 0 when reachable
  specialist_reachable: boolean;
  specialist_shortfall: number;
}

export interface ClassInsight {
  classId: string;
  className: string;
  insight: number;
  tiers: TierReachability[];
}

/**
 * Insight = sum of levels across the class's aligned_skill_ids, plus the
 * insight_bonus from every attribute breakpoint the character has met. Derived
 * from BuildState — never authored, never spent (Savepoint v0.2 class track).
 */
export function computeInsight(cls: CharacterClass, build: BuildState): number {
  let insight = 0;
  for (const skillId of cls.aligned_skill_ids) {
    insight += build.skill_levels[skillId] ?? 0;
  }
  for (const bp of cls.aligned_attribute_breakpoints) {
    const value = build.attributes[bp.attribute] ?? 0;
    if (value >= bp.at) insight += bp.insight_bonus;
  }
  return insight;
}

export function computeClassInsights(dataset: Dataset, build: BuildState): ClassInsight[] {
  return dataset.classes.map((cls) => {
    const insight = computeInsight(cls, build);
    const tiers: TierReachability[] = cls.tiers.map((t) => ({
      star: t.star,
      insight_generalist: t.insight_generalist,
      insight_specialist: t.insight_specialist,
      generalist_reachable: insight >= t.insight_generalist,
      generalist_shortfall: Math.max(0, t.insight_generalist - insight),
      specialist_reachable: insight >= t.insight_specialist,
      specialist_shortfall: Math.max(0, t.insight_specialist - insight),
    }));
    return { classId: cls.id, className: cls.name, insight, tiers };
  });
}
