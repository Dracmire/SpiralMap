import type { Dataset } from "../types.ts";
import { useBuildState, useBuildDispatch } from "../state/buildState.ts";

export function ClassDetailCard({ dataset, classId }: { dataset: Dataset; classId: string | null }) {
  const build = useBuildState();
  const dispatch = useBuildDispatch();

  if (!classId) {
    return (
      <div className="panel detail-card">
        <p className="hint">Click a class on the canvas to see its detail card.</p>
      </div>
    );
  }

  const cls = dataset.class_ladder.find((c) => c.id === classId);
  if (!cls) {
    return (
      <div className="panel detail-card">
        <p className="hint">Unknown class: {classId}</p>
      </div>
    );
  }

  const ticked = build.criteria_ticked[cls.id] ?? false;

  return (
    <div className="panel detail-card">
      <div className="detail-header">
        <h2>{cls.name}</h2>
        <span className="badge">{cls.star === 0 ? "root" : "★".repeat(cls.star)}</span>
        {cls.is_monster_class && <span className="badge badge-anti">Monster</span>}
      </div>
      <p className="rarity">
        {cls.tree_id} · slot {cls.branch_slot}
        {cls.variant > 1 ? ` · variant ${cls.variant}` : ""}
        {cls.attribute_tag ? ` · ${cls.attribute_tag}` : ""}
      </p>

      <p className="feat-boundary">
        <strong>Description:</strong> {cls.description || <em>not yet authored</em>}
      </p>
      <p className="feat-boundary">
        <strong>Grants:</strong> {cls.grants || <em>not yet authored</em>}
      </p>
      {cls.data_issue && (
        <p className="feat-boundary data-issue">
          <strong>Data issue:</strong> {cls.data_issue}
        </p>
      )}

      {cls.star === 0 ? (
        <p className="hint">Tree root — no acquisition gates, free entry point.</p>
      ) : (
        <>
          <h3>Acquisition gates</h3>
          <ul className="closure-list">
            <li className="req-unmet">
              <span className="req-dot">○</span> LEVEL: levels gained since taking this class ≥{" "}
              {cls.level_cap_gain ?? <em>not authored</em>} <em className="hint-inline">(not tracked in Build mode yet — no class-acquisition state modeled this phase)</em>
            </li>
            <li className={ticked ? "req-met" : "req-unmet"}>
              <label className="req-criteria">
                <input
                  type="checkbox"
                  checked={ticked}
                  onChange={() => dispatch({ type: "TOGGLE_CRITERIA", criteriaId: cls.id })}
                />{" "}
                CRITERIA:{" "}
                {cls.criteria ? (
                  <>
                    {cls.criteria_source === "SUGGESTED" && (
                      <span className="badge badge-suggested" title="Drafted as scaffolding, not written by the project owner">
                        SUGGESTED
                      </span>
                    )}{" "}
                    {cls.criteria}
                  </>
                ) : (
                  "criteria not yet authored"
                )}
              </label>
            </li>
            <li className="req-unmet">
              <span className="req-dot">○</span> PRICE: 1 level of XP, plus {cls.fate_cost ?? <em>not authored</em>} FATE{" "}
              <em className="hint-inline">(large XP sum is the narrative alternative to spending FATE)</em>
            </li>
          </ul>

          <h3>Cost</h3>
          <div className="cost-row">
            <span>FATE</span>
            <span>{cls.fate_cost ?? "—"}</span>
          </div>
          <div className="cost-row">
            <span>XP</span>
            <span>1 full level</span>
          </div>
          <div className="cost-row">
            <span>Level cap gain</span>
            <span>{cls.level_cap_gain ?? "—"}</span>
          </div>
        </>
      )}
    </div>
  );
}
