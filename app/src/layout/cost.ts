import type { Dataset, FeatOrFusion } from "../types.ts";
import type { BuildState } from "../../../schema/spiral.ts";

export interface CostSummary {
  cp_total: number;
  xp_owed: number;
  skill_cp_baseline: number;
  skill_cp_discounted: number;
  skill_discount_saved: number;
}

/**
 * CP total (purchased feats/fusions) + XP owed (their sources) + an estimate of
 * skill-investment CP with the ~25% in-group discount (Savepoint v0.2 §8):
 * a skill bought as part of a declared Skill Group costs less than loose. This
 * applies the discount per-skill (its own group_ids is non-empty), a simplification
 * of "committed to that group as an archetype" — noted as such in the app report.
 */
export function computeCost(ownedNodes: FeatOrFusion[], build: BuildState, dataset: Dataset): CostSummary {
  const cp_total = ownedNodes.reduce((sum, f) => sum + f.cp_cost, 0);
  const xp_owed = ownedNodes.reduce((sum, f) => sum + f.sources.reduce((s, src) => s + (src.xp_cost ?? 0), 0), 0);

  let skill_cp_baseline = 0;
  let skill_cp_discounted = 0;
  for (const [skillId, level] of Object.entries(build.skill_levels)) {
    if (!level || level <= 0) continue;
    const row = dataset.skill_level_table.find((r) => r.level === level);
    if (!row) continue;
    skill_cp_baseline += row.cp_cost_accum;
    const skill = dataset.skills.find((s) => s.id === skillId);
    const inGroup = !!skill && skill.group_ids.length > 0;
    skill_cp_discounted += inGroup ? Math.round(row.cp_cost_accum * 0.75) : row.cp_cost_accum;
  }

  return {
    cp_total,
    xp_owed,
    skill_cp_baseline,
    skill_cp_discounted,
    skill_discount_saved: skill_cp_baseline - skill_cp_discounted,
  };
}
