import { useState } from "react";
import type { Dataset, Perk, Feat, FeatOrFusion } from "../types.ts";
import { isFusion } from "../types.ts";
import type { Source } from "../../../schema/spiral.ts";
import type { GraphLayout } from "../layout/layoutGraph.ts";
import { Canvas } from "./Canvas.tsx";
import { validatePerk, validateFeat, type FieldIssue } from "../validation/rules.ts";
import { stringifyCsv } from "../../../scripts/lib/csv.ts";
import { downloadTextFile } from "../state/mdExport.ts";

function serializeSources(sources: Source[]): string {
  return sources.map((s) => `${s.type}:${s.target ?? ""}:${s.xp_cost ?? ""}:${s.level_loss ?? ""}`).join(";");
}

interface AuthorPanelProps {
  dataset: Dataset;
  selectedNodeId: string | null;
  onSelectNode: (id: string) => void;
  layout: GraphLayout;
}

function IssueList({ issues }: { issues: FieldIssue[] }) {
  if (issues.length === 0) return <p className="ok-hint">No issues.</p>;
  return (
    <ul className="issue-list">
      {issues.map((i, idx) => (
        <li key={idx}>
          <strong>{i.field}</strong>: {i.message}
        </li>
      ))}
    </ul>
  );
}

export function AuthorPanel({ dataset, selectedNodeId, onSelectNode, layout }: AuthorPanelProps) {
  const [perkEdits, setPerkEdits] = useState<Record<string, Perk>>({});
  const [featEdits, setFeatEdits] = useState<Record<string, FeatOrFusion>>({});

  const feat: FeatOrFusion | undefined = selectedNodeId
    ? featEdits[selectedNodeId] ?? dataset.feats.find((f) => f.id === selectedNodeId) ?? dataset.fusions.find((f) => f.id === selectedNodeId)
    : undefined;
  const perk: Perk | undefined = feat?.perk_ids[0] ? perkEdits[feat.perk_ids[0]] ?? dataset.perks.find((p) => p.id === feat.perk_ids[0]) : undefined;

  function updatePerk(id: string, patch: Partial<Perk>) {
    const base = perkEdits[id] ?? dataset.perks.find((p) => p.id === id);
    if (!base) return;
    setPerkEdits((prev) => ({ ...prev, [id]: { ...base, ...patch } }));
  }
  function updateFeat(id: string, patch: Partial<FeatOrFusion>) {
    const base = featEdits[id] ?? dataset.feats.find((f) => f.id === id) ?? dataset.fusions.find((f) => f.id === id);
    if (!base) return;
    setFeatEdits((prev) => ({ ...prev, [id]: { ...base, ...patch } }));
  }

  function exportChangedRows() {
    const perkHeader = [
      "id", "name", "subject", "subject_suggested", "family", "family_suggested", "tier", "tier_suggested",
      "bonus_category", "bonus_type", "text", "exclusions", "counterweight", "enhanced_threshold", "enhanced_text",
    ];
    const perkRows = Object.values(perkEdits).map((p) => ({
      id: p.id, name: p.name, subject: p.subject, subject_suggested: p.subject_suggested ?? "",
      family: p.family, family_suggested: p.family_suggested ?? "", tier: p.tier, tier_suggested: "",
      bonus_category: p.bonus_category ?? "", bonus_type: p.bonus_type ?? "", text: p.text, exclusions: p.exclusions ?? "",
      counterweight: p.counterweight ?? "", enhanced_threshold: p.enhanced_threshold?.toString() ?? "", enhanced_text: p.enhanced_text ?? "",
    }));
    if (perkRows.length > 0) {
      downloadTextFile("perks.changed.csv", stringifyCsv(perkHeader, perkRows), "text/csv");
    }

    const featHeader = [
      "id", "name", "perk_ids", "job", "authority_root_type", "authority_root_id", "practice_root_id",
      "fusion_root_id", "requirements", "sources", "rarity", "zone_id", "cp_cost", "exclusions",
    ];
    const featRow = (f: FeatOrFusion) => ({
      id: f.id, name: f.name, perk_ids: f.perk_ids.join(";"), job: f.job.join(";"),
      authority_root_type: f.authority_root.type, authority_root_id: f.authority_root.id,
      practice_root_id: f.practice_root_id ?? "", fusion_root_id: f.fusion_root_id ?? "",
      requirements: f.requirements.map((r) => `${r.type}:${r.target}${r.threshold !== null ? `:${r.threshold}` : ""}`).join(";"),
      sources: serializeSources(f.sources), rarity: f.rarity, zone_id: f.zone_id ?? "", cp_cost: String(f.cp_cost), exclusions: f.exclusions ?? "",
    });

    const allEdits = Object.values(featEdits);
    const plainFeatRows = allEdits.filter((f) => !isFusion(f)).map(featRow);
    if (plainFeatRows.length > 0) {
      downloadTextFile("feats.changed.csv", stringifyCsv(featHeader, plainFeatRows), "text/csv");
    }

    const fusionHeader = [...featHeader, "operator", "parents", "target_trait_id", "cp_refund", "parent_disposition_reason"];
    const fusionRows = allEdits.filter(isFusion).map((f) => ({
      ...featRow(f),
      operator: f.operator,
      parents: f.parents.map((p) => `${p.feat_id}:${p.disposition}`).join(";"),
      target_trait_id: f.target_trait_id ?? "",
      cp_refund: f.cp_refund?.toString() ?? "",
      parent_disposition_reason: f.parent_disposition_reason ?? "",
    }));
    if (fusionRows.length > 0) {
      downloadTextFile("fusions.changed.csv", stringifyCsv(fusionHeader, fusionRows), "text/csv");
    }

    if (perkRows.length === 0 && plainFeatRows.length === 0 && fusionRows.length === 0) {
      alert("No edits to export yet.");
    }
  }

  const isOwned = () => false;
  const isAvailable = () => false;

  return (
    <div className="app-body author-body">
      <div className="canvas-area">
        <Canvas dataset={dataset} layout={layout} selectedNodeId={selectedNodeId} onSelectNode={onSelectNode} isOwned={isOwned} isAvailable={isAvailable} />
      </div>
      <div className="panel author-form">
        <h2>Author</h2>
        <button className="btn" onClick={exportChangedRows}>
          Export changed rows
        </button>
        <p className="hint">{Object.keys(perkEdits).length} perk row(s), {Object.keys(featEdits).length} feat row(s) changed.</p>

        {!feat && <p className="hint">Select a node on the canvas.</p>}

        {feat && (
          <>
            <h3>
              {isFusion(feat) ? `Fusion (${feat.operator})` : "Feat"}: {feat.name}
            </h3>
            <label>
              Exclusions (optional)
              <textarea value={feat.exclusions ?? ""} onChange={(e) => updateFeat(feat.id, { exclusions: e.target.value || null })} rows={2} />
            </label>
            <label>
              Rarity
              <select value={feat.rarity} onChange={(e) => updateFeat(feat.id, { rarity: e.target.value as Feat["rarity"] })}>
                {["COMMON", "UNCOMMON", "RARE", "SUPERNATURAL"].map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            </label>
            <IssueList issues={validateFeat(feat, dataset)} />
          </>
        )}

        {perk && (
          <>
            <h3>Perk: {perk.name}</h3>
            {perk.subject_suggested && !perk.subject && (
              <button className="btn btn-suggestion" onClick={() => updatePerk(perk.id, { subject: perk.subject_suggested! })}>
                Accept suggested subject: {perk.subject_suggested}
              </button>
            )}
            {perk.family_suggested && !perk.family && (
              <button className="btn btn-suggestion" onClick={() => updatePerk(perk.id, { family: perk.family_suggested as Perk["family"] })}>
                Accept suggested family: {perk.family_suggested}
              </button>
            )}
            <label>
              Subject
              <input value={perk.subject} onChange={(e) => updatePerk(perk.id, { subject: e.target.value })} />
            </label>
            <label>
              Family
              <select value={perk.family} onChange={(e) => updatePerk(perk.id, { family: e.target.value as Perk["family"] })}>
                <option value="">(blank)</option>
                {["FLAT_BONUS", "RELIABILITY", "COVERAGE", "THRESHOLD", "PERMISSION", "SUBSTITUTION"].map((f) => (
                  <option key={f} value={f}>
                    {f}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Tier
              <select value={perk.tier} onChange={(e) => updatePerk(perk.id, { tier: e.target.value as Perk["tier"] })}>
                <option value="">(blank)</option>
                {["ENTRY", "INTERMEDIATE", "ADVANCED", "EXPERT", "MASTER"].map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Exclusions (optional)
              <textarea value={perk.exclusions ?? ""} onChange={(e) => updatePerk(perk.id, { exclusions: e.target.value || null })} rows={2} />
            </label>
            <label>
              Text
              <textarea value={perk.text} onChange={(e) => updatePerk(perk.id, { text: e.target.value })} rows={3} />
            </label>
            <IssueList issues={validatePerk(perk, dataset)} />
          </>
        )}
      </div>
    </div>
  );
}
