import type { Dataset, FeatOrFusion } from "../types.ts";
import { isFusion } from "../types.ts";
import { computeRequirementClosure } from "../layout/requirementClosure.ts";
import { useBuildState, useBuildDispatch } from "../state/buildState.ts";

export function DetailCard({ dataset, nodeId }: { dataset: Dataset; nodeId: string | null }) {
  const build = useBuildState();
  const dispatch = useBuildDispatch();

  if (!nodeId) {
    return (
      <div className="panel detail-card">
        <p className="hint">Click a node on the canvas to see its detail card.</p>
      </div>
    );
  }

  const node: FeatOrFusion | undefined = dataset.feats.find((f) => f.id === nodeId) ?? dataset.fusions.find((f) => f.id === nodeId);
  if (!node) {
    return (
      <div className="panel detail-card">
        <p className="hint">Unknown node: {nodeId}</p>
      </div>
    );
  }

  const ownedPerks = node.perk_ids.map((pid) => dataset.perks.find((p) => p.id === pid)).filter((p) => !!p);
  const closure = computeRequirementClosure(nodeId, dataset, build);
  const owned = build.feat_ids.includes(nodeId);
  const allSatisfied = closure.every((c) => c.satisfied);

  return (
    <div className="panel detail-card">
      <div className="detail-header">
        <h2>{node.name}</h2>
        {node.derived_tier && <span className="badge">{node.derived_tier}</span>}
        {node.is_anti_perk && <span className="badge badge-anti">Anti</span>}
        {isFusion(node) && <span className="badge badge-fusion">{node.operator}</span>}
      </div>
      <p className="rarity">{node.rarity} · {node.cp_cost} CP</p>

      {ownedPerks.map((perk) => (
        <div key={perk!.id} className="perk-block">
          <p className="clause">{perk!.text || <em>(no text)</em>}</p>
          <p className="boundary">
            <strong>Boundary:</strong> {perk!.boundary || <em>not yet authored</em>}
          </p>
          {perk!.counterweight && (
            <p className="counterweight">
              <strong>Counterweight:</strong> {perk!.counterweight}
            </p>
          )}
        </div>
      ))}

      <p className="feat-boundary">
        <strong>Feat boundary:</strong> {node.boundary || <em>not yet authored</em>}
      </p>

      <h3>Requirement closure {allSatisfied ? "✓ all met" : ""}</h3>
      {closure.length === 0 && <p className="hint">No requirements.</p>}
      <ul className="closure-list">
        {closure.map((item, i) =>
          item.requirement.type === "CRITERIA" ? (
            <li key={i} className={item.satisfied ? "req-met" : "req-unmet"}>
              <label className="req-criteria">
                <input
                  type="checkbox"
                  checked={item.satisfied}
                  onChange={() => dispatch({ type: "TOGGLE_CRITERIA", criteriaId: item.requirement.target })}
                />{" "}
                {item.label}
              </label>
            </li>
          ) : (
            <li key={i} className={item.satisfied ? "req-met" : "req-unmet"}>
              <span className="req-dot">{item.satisfied ? "●" : "○"}</span> {item.label}
            </li>
          ),
        )}
      </ul>

      <button
        className={owned ? "btn btn-remove" : "btn btn-add"}
        onClick={() => dispatch({ type: "TOGGLE_FEAT", featId: nodeId })}
      >
        {owned ? "Remove from build" : "Add to build"}
      </button>
    </div>
  );
}
