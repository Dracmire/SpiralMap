import type { Dataset, FeatOrFusion } from "../types.ts";
import { hashUnit } from "./hash.ts";

export interface LaidOutNode {
  id: string;
  x: number;
  y: number;
}
export interface LaidOutEdge {
  id: string;
  source: string;
  target: string;
}
export interface HubMarker {
  key: string;
  label: string;
  x: number;
  y: number;
}
export interface GraphLayout {
  positions: Map<string, LaidOutNode>;
  edges: LaidOutEdge[];
  hubs: HubMarker[];
}

const HUB_RADIUS = 900;
const CLUSTER_RADIUS = 260;
const LEVEL_RADIUS: Record<number, number> = { 1: 70, 3: 130, 5: 190, 7: 250 };
const RARITY_RADIUS: Record<string, number> = { COMMON: 70, UNCOMMON: 130, RARE: 190, SUPERNATURAL: 250 };
const CLUSTER_ANGLE_JITTER = 0.9; // radians of spread for clusters within one hub's slot
const NODE_ANGLE_JITTER = 0.5; // radians of spread for nodes within one cluster ring

function hubKeyFor(feat: FeatOrFusion, dataset: Dataset): { key: string; label: string } {
  if (feat.skill_group) return { key: `legacy:${feat.skill_group}`, label: feat.skill_group };
  if (feat.authority_root.type === "SKILL") {
    const skill = dataset.skills.find((s) => s.id === feat.authority_root.id);
    const groupId = skill?.group_ids[0];
    const group = groupId ? dataset.skill_groups.find((g) => g.id === groupId) : undefined;
    if (group) return { key: `group:${group.id}`, label: group.name };
    return { key: "ungrouped-skills", label: "Ungrouped Skills" };
  }
  if (feat.authority_root.type === "ATTRIBUTE") {
    return { key: `attr:${feat.authority_root.id}`, label: `Attribute: ${feat.authority_root.id}` };
  }
  return { key: "other", label: "Other" };
}

function clusterKeyFor(feat: FeatOrFusion): string {
  if (feat.authority_root.type === "SKILL") return feat.authority_root.id;
  return feat.practice_root_id ?? feat.id;
}

function radiusFor(feat: FeatOrFusion): number {
  const levelReq = feat.requirements.find((r) => r.type === "SKILL_LEVEL" && r.target === feat.authority_root.id);
  if (levelReq && levelReq.threshold !== null) {
    return LEVEL_RADIUS[levelReq.threshold] ?? 70 + Math.min(levelReq.threshold, 10) * 20;
  }
  return RARITY_RADIUS[feat.rarity] ?? 130;
}

/**
 * Hub-and-cluster canvas: skill group at centre of its hub, its skills as
 * clusters radiating out, feats positioned by SKILL_LEVEL threshold (1/3/5/7 ->
 * increasing radius; Anti-style ATTRIBUTE_CEILING feats fall back to a
 * rarity-based radius since they have no SKILL_LEVEL). Fully deterministic —
 * seeded off node/cluster/hub id via hashUnit(), so it's stable across reloads.
 */
export function computeLayout(dataset: Dataset): GraphLayout {
  const allFeats: FeatOrFusion[] = [...dataset.feats, ...dataset.fusions];

  const hubOf = new Map<string, { key: string; label: string }>();
  for (const f of allFeats) hubOf.set(f.id, hubKeyFor(f, dataset));

  const hubKeys = [...new Set([...hubOf.values()].map((h) => h.key))].sort();
  const hubLabelByKey = new Map<string, string>();
  for (const h of hubOf.values()) hubLabelByKey.set(h.key, h.label);

  const hubAngle = new Map<string, number>();
  hubKeys.forEach((key, i) => hubAngle.set(key, (i / hubKeys.length) * Math.PI * 2));

  const hubs: HubMarker[] = hubKeys.map((key) => {
    const angle = hubAngle.get(key)!;
    return { key, label: hubLabelByKey.get(key)!, x: HUB_RADIUS * Math.cos(angle), y: HUB_RADIUS * Math.sin(angle) };
  });
  const hubPos = new Map(hubs.map((h) => [h.key, h]));

  // clusters, grouped by hub
  const clustersByHub = new Map<string, Set<string>>();
  for (const f of allFeats) {
    const hub = hubOf.get(f.id)!.key;
    const set = clustersByHub.get(hub) ?? new Set<string>();
    set.add(clusterKeyFor(f));
    clustersByHub.set(hub, set);
  }

  const clusterCenter = new Map<string, { x: number; y: number }>(); // key: `${hub}::${cluster}`
  for (const [hub, clusterSet] of clustersByHub) {
    const clusters = [...clusterSet].sort();
    const baseAngle = hubAngle.get(hub)!;
    const hp = hubPos.get(hub)!;
    clusters.forEach((cluster, i) => {
      const spread = clusters.length > 1 ? CLUSTER_ANGLE_JITTER : 0;
      const offset = clusters.length > 1 ? (i / (clusters.length - 1) - 0.5) * spread : 0;
      const angle = baseAngle + offset;
      clusterCenter.set(`${hub}::${cluster}`, {
        x: hp.x + CLUSTER_RADIUS * Math.cos(angle),
        y: hp.y + CLUSTER_RADIUS * Math.sin(angle),
      });
    });
  }

  const positions = new Map<string, LaidOutNode>();
  for (const f of allFeats) {
    const hub = hubOf.get(f.id)!.key;
    const cluster = clusterKeyFor(f);
    const center = clusterCenter.get(`${hub}::${cluster}`)!;
    const radius = radiusFor(f);
    const clusterBaseAngle = hubAngle.get(hub)!;
    const jitter = (hashUnit(f.id) - 0.5) * NODE_ANGLE_JITTER;
    const angle = clusterBaseAngle + jitter;
    positions.set(f.id, { id: f.id, x: center.x + radius * Math.cos(angle), y: center.y + radius * Math.sin(angle) });
  }

  const edges: LaidOutEdge[] = [];
  for (const f of allFeats) {
    for (const req of f.requirements) {
      if (req.type === "PRIOR_NODE" && positions.has(req.target)) {
        edges.push({ id: `${req.target}->${f.id}`, source: req.target, target: f.id });
      }
    }
  }

  return { positions, edges, hubs };
}
