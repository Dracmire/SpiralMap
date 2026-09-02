import { useMemo } from "react";
import type { Dataset } from "../types.ts";
import { useBuildState } from "../state/buildState.ts";
import { computeAdvantages } from "../layout/advantages.ts";

export function AdvantagesPanel({ dataset }: { dataset: Dataset }) {
  const build = useBuildState();

  const ownedPerks = useMemo(() => {
    const owned = [...dataset.feats, ...dataset.fusions].filter((f) => build.feat_ids.includes(f.id));
    const perkIds = new Set(owned.flatMap((f) => f.perk_ids));
    return dataset.perks.filter((p) => perkIds.has(p.id));
  }, [dataset, build.feat_ids]);

  const { rows, unclassified } = useMemo(() => computeAdvantages(ownedPerks, dataset), [ownedPerks, dataset]);

  const byCategory = new Map<string, typeof rows>();
  for (const row of rows) {
    const list = byCategory.get(row.category) ?? [];
    list.push(row);
    byCategory.set(row.category, list);
  }

  return (
    <div className="panel advantages-panel">
      <h2>Compound Advantages</h2>
      {rows.length === 0 && unclassified.length === 0 && <p className="hint">No feats in the build yet.</p>}
      {[...byCategory.entries()].map(([category, catRows]) => (
        <div key={category} className="advantage-category">
          <h3>{category}</h3>
          {catRows.map((row) => (
            <div key={row.subject} className="advantage-row">
              <div className="advantage-subject">
                {row.subject} <span className="advantage-total">{row.total >= 0 ? "+" : ""}{row.total}</span>
              </div>
              <ul className="advantage-contributions">
                {row.contributions.map((c) => (
                  <li key={c.perk_id}>
                    {c.perk_name} ({c.bonus_type ?? "—"}): {c.value}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      ))}
      {unclassified.length > 0 && (
        <div className="advantage-category">
          <h3>Unclassified</h3>
          <p className="hint">Blank subject/family — not dropped, just not groupable yet.</p>
          <ul className="advantage-contributions">
            {unclassified.map((p) => (
              <li key={p.id}>{p.name}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
