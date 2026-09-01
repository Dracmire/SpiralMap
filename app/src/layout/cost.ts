import type { Dataset, FeatOrFusion } from "../types.ts";
import type { BuildState } from "../../../schema/spiral.ts";

export interface SkillCostLine {
  skillId: string;
  skillName: string;
  /** The declared group this skill's discount is credited to; null when the purchase is loose. */
  groupName: string | null;
  inGroup: boolean;
  baseline: number;
  discounted: number;
}

export interface CostSummary {
  cp_total: number;
  xp_owed: number;
  skill_cp_baseline: number;
  skill_cp_discounted: number;
  skill_discount_saved: number;
  skill_lines: SkillCostLine[];
}

/**
 * CP total (purchased feats/fusions) + XP owed (their sources) + skill-investment CP
 * with the in-group discount (Savepoint v0.2 §8). The discount is not a per-skill
 * property: it applies only while the character has DECLARED the skill's group
 * (build.declared_group_ids) — a skill outside every declared group is a loose
 * purchase at full price. With no group declared, no discount applies at all.
 */
export function computeCost(ownedNodes: FeatOrFusion[], build: BuildState, dataset: Dataset): CostSummary {
  const cp_total = ownedNodes.reduce((sum, f) => sum + f.cp_cost, 0);
  const xp_owed = ownedNodes.reduce((sum, f) => sum + f.sources.reduce((s, src) => s + (src.xp_cost ?? 0), 0), 0);

  const groupsById = new Map(dataset.skill_groups.map((g) => [g.id, g]));
  const declared = new Set(build.declared_group_ids);

  let skill_cp_baseline = 0;
  let skill_cp_discounted = 0;
  const skill_lines: SkillCostLine[] = [];

  for (const [skillId, level] of Object.entries(build.skill_levels)) {
    if (!level || level <= 0) continue;
    const row = dataset.skill_level_table.find((r) => r.level === level);
    if (!row) continue;
    const skill = dataset.skills.find((s) => s.id === skillId);

    const declaredGroupId = skill?.group_ids.find((gid) => declared.has(gid)) ?? null;
    const declaredGroup = declaredGroupId ? groupsById.get(declaredGroupId) : undefined;
    const inGroup = !!declaredGroup;
    const discounted = inGroup ? Math.round(row.cp_cost_accum * (1 - declaredGroup.discount_pct / 100)) : row.cp_cost_accum;

    skill_cp_baseline += row.cp_cost_accum;
    skill_cp_discounted += discounted;
    skill_lines.push({
      skillId,
      skillName: skill?.name ?? skillId,
      groupName: declaredGroup?.name ?? null,
      inGroup,
      baseline: row.cp_cost_accum,
      discounted,
    });
  }

  skill_lines.sort((a, b) => a.skillName.localeCompare(b.skillName));

  return {
    cp_total,
    xp_owed,
    skill_cp_baseline,
    skill_cp_discounted,
    skill_discount_saved: skill_cp_baseline - skill_cp_discounted,
    skill_lines,
  };
}
