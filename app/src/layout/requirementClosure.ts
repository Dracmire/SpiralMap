import type { Dataset, FeatOrFusion, Requirement } from "../types.ts";
import type { BuildState } from "../../../schema/spiral.ts";

export interface ClosureItem {
  requirement: Requirement;
  satisfied: boolean;
  label: string;
  /** id of the node (the clicked node, or an ancestor reached via PRIOR_NODE) that introduced this line. */
  fromNodeId: string;
}

function nodeName(dataset: Dataset, id: string): string {
  const feat = dataset.feats.find((f) => f.id === id) ?? dataset.fusions.find((f) => f.id === id);
  if (feat) return feat.name;
  const perk = dataset.perks.find((p) => p.id === id);
  if (perk) return perk.name;
  const spec = dataset.specializations.find((s) => s.id === id);
  if (spec) return spec.name;
  return id;
}

function skillName(dataset: Dataset, id: string): string {
  return dataset.skills.find((s) => s.id === id)?.name ?? id;
}

/** SKILL_LEVEL target is either a bare skill id or "skill_id.instance" — render the
 * instance form as "Skill Name (Instance)". Per-instance skill-level tracking isn't
 * built into BuildState/CharacterPanel yet, so these requirements always show unmet
 * in Build mode for now — that's a known gap, not a display bug. */
function skillLevelLabel(dataset: Dataset, target: string): string {
  const dot = target.indexOf(".");
  if (dot === -1) return skillName(dataset, target);
  return `${skillName(dataset, target.slice(0, dot))} (${target.slice(dot + 1)})`;
}

export function describeRequirement(req: Requirement, dataset: Dataset): string {
  switch (req.type) {
    case "SKILL_LEVEL":
      return `${skillLevelLabel(dataset, req.target)} ≥ ${req.threshold}`;
    case "ATTRIBUTE":
      return `${req.target} ≥ ${req.threshold}`;
    case "ATTRIBUTE_CEILING":
      return `${req.target} ≤ ${req.threshold}`;
    case "VERB":
      return `Verb: ${req.target} (≥ ${req.threshold ?? "?"})`;
    case "TRAIT":
      return `Trait: ${req.target}`;
    case "PRIOR_NODE":
      return `Own: ${nodeName(dataset, req.target)}`;
    case "CLASS":
      return `Class: ${req.target}`;
    case "CLASS_TIER":
      return `Class ${req.target} ≥ tier ${req.threshold}`;
    case "INSIGHT":
      return `Insight (${req.target}) ≥ ${req.threshold}`;
    case "CRITERIA": {
      const cls = dataset.class_ladder.find((c) => c.id === req.target);
      if (!cls?.criteria) return "Criteria not yet authored";
      return cls.criteria_source === "SUGGESTED" ? `[SUGGESTED] ${cls.criteria}` : cls.criteria;
    }
    default:
      return `${req.type}: ${req.target}`;
  }
}

export function evaluateRequirement(req: Requirement, build: BuildState): boolean {
  switch (req.type) {
    case "SKILL_LEVEL":
      return (build.skill_levels[req.target] ?? 0) >= (req.threshold ?? 0);
    case "ATTRIBUTE":
      return (build.attributes[req.target as keyof typeof build.attributes] ?? 0) >= (req.threshold ?? 0);
    case "ATTRIBUTE_CEILING":
      return (build.attributes[req.target as keyof typeof build.attributes] ?? 0) <= (req.threshold ?? Infinity);
    case "TRAIT":
      return build.trait_ids.includes(req.target);
    case "PRIOR_NODE":
      return build.feat_ids.includes(req.target);
    case "CLASS":
      return build.class_id === req.target;
    case "CLASS_TIER":
      // Class tier depth isn't modeled in BuildState (classes[] is empty this phase) —
      // approximate as "class matches", which is honest about what we can check.
      return build.class_id === req.target;
    case "INSIGHT":
      // Insight isn't computed this phase (classes[] is empty) — always unmet, not silently true.
      return false;
    case "CRITERIA":
      return build.criteria_ticked[req.target] ?? false;
    case "VERB":
      // No per-verb character state modeled this phase — always unmet, not silently true.
      return false;
    default:
      return false;
  }
}

/**
 * Full transitive requirement closure for a node: its own requirements, plus —
 * recursively — the requirements of every PRIOR_NODE it depends on. Answers
 * "what do I need to get this," not just "what does this one node ask for."
 * Deduplicated by requirement identity; cycle-guarded (rule 6 should prevent
 * real cycles, but this doesn't trust that blindly).
 */
export function computeRequirementClosure(nodeId: string, dataset: Dataset, build: BuildState): ClosureItem[] {
  const nodesById = new Map<string, FeatOrFusion>();
  for (const f of dataset.feats) nodesById.set(f.id, f);
  for (const f of dataset.fusions) nodesById.set(f.id, f);

  const visited = new Set<string>();
  const seenReqKey = new Set<string>();
  const items: ClosureItem[] = [];

  function walk(id: string) {
    if (visited.has(id)) return;
    visited.add(id);
    const node = nodesById.get(id);
    if (!node) return;
    for (const req of node.requirements) {
      const key = `${req.type}:${req.target}:${req.threshold}`;
      if (!seenReqKey.has(key)) {
        seenReqKey.add(key);
        items.push({ requirement: req, satisfied: evaluateRequirement(req, build), label: describeRequirement(req, dataset), fromNodeId: id });
      }
      if (req.type === "PRIOR_NODE") walk(req.target);
    }
  }
  walk(nodeId);
  return items;
}
