import { useMemo } from "react";
import type { Dataset } from "../types.ts";
import { useBuildState } from "../state/buildState.ts";
import { computeCost } from "../layout/cost.ts";

export function CostPanel({ dataset }: { dataset: Dataset }) {
  const build = useBuildState();
  const ownedNodes = useMemo(() => [...dataset.feats, ...dataset.fusions].filter((f) => build.feat_ids.includes(f.id)), [dataset, build.feat_ids]);
  const cost = useMemo(() => computeCost(ownedNodes, build, dataset), [ownedNodes, build, dataset]);

  return (
    <div className="panel cost-panel">
      <h2>Cost</h2>
      <div className="cost-row">
        <span>Feats/fusions purchased</span>
        <span>{ownedNodes.length}</span>
      </div>
      <div className="cost-row">
        <span>CP total</span>
        <span>{cost.cp_total}</span>
      </div>
      <div className="cost-row">
        <span>XP owed</span>
        <span>{cost.xp_owed}</span>
      </div>
      <div className="cost-row">
        <span>Skill CP (baseline)</span>
        <span>{cost.skill_cp_baseline}</span>
      </div>
      <div className="cost-row">
        <span>Skill CP (with group discount)</span>
        <span>{cost.skill_cp_discounted}</span>
      </div>
      <div className="cost-row cost-saved">
        <span>Saved by group discount</span>
        <span>{cost.skill_discount_saved}</span>
      </div>

      {cost.skill_lines.length > 0 && (
        <>
          <h3>Skill purchases</h3>
          <div className="skill-cost-lines">
            {cost.skill_lines.map((line) => (
              <div key={line.skillId} className="cost-row skill-cost-line">
                {line.inGroup ? (
                  <span>
                    {line.skillName} ({line.groupName}, in-group): {line.baseline} CP → {line.discounted} CP
                  </span>
                ) : (
                  <span>
                    {line.skillName} (loose): {line.baseline} CP
                  </span>
                )}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
