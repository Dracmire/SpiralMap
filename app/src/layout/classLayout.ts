import type { Dataset } from "../types.ts";
import type { LadderClass } from "../../../schema/spiral.ts";
import { resolveParentIds } from "../../../scripts/lib/classParentRules.ts";
import type { GraphLayout, LaidOutNode, LaidOutEdge, HubMarker } from "./layoutGraph.ts";

const HUB_RADIUS = 900;
const CLUSTER_RADIUS = 260;
const STAR_RADIUS: Record<number, number> = { 0: 0, 1: 130, 2: 230, 3: 330 };
const CLUSTER_ANGLE_JITTER = 0.9;
const MIN_NODE_SEPARATION = 120;
const MAX_FAN_ARC = 2.4;
const RELAX_ITERATIONS = 80;

function clusterKeyFor(cls: LadderClass): string {
  return cls.star === 0 ? "root" : cls.branch_slot;
}

/** Same pairwise-repulsion pass as layoutGraph.ts's relaxCollisions, duplicated here
 * because it keys purely off Map<string, LaidOutNode> and the class tree's bucket
 * dimensions (tree/slot/star) don't line up with layoutGraph's (skill/rarity). */
function relaxCollisions(positions: Map<string, LaidOutNode>): void {
  const nodes = [...positions.values()];
  for (let iter = 0; iter < RELAX_ITERATIONS; iter++) {
    let moved = false;
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i];
        const b = nodes[j];
        let dx = b.x - a.x;
        let dy = b.y - a.y;
        let dist = Math.hypot(dx, dy);
        if (dist < MIN_NODE_SEPARATION) {
          if (dist === 0) {
            dx = 1;
            dy = 0;
            dist = 1;
          }
          const push = (MIN_NODE_SEPARATION - dist) / 2;
          const ux = dx / dist;
          const uy = dy / dist;
          a.x -= ux * push;
          a.y -= uy * push;
          b.x += ux * push;
          b.y += uy * push;
          moved = true;
        }
      }
    }
    if (!moved) break;
  }
}

/**
 * Hub-and-cluster canvas for the class ladder, mirroring layoutGraph.ts's treatment
 * but keyed on the class tree's own dimensions: tree_id is the hub, branch_slot (or
 * "root" for the star-0 entry) is the cluster, star rank sets the radius. Edges come
 * from resolveParentIds (scripts/adapters/class_ladder.ts) — the same parent-rule
 * resolution the CLI validator uses, reused here rather than reimplemented so slot-G
 * wildcards (ANY_LOWER_STAR_IN_TREE) and ANY_2STAR_IN_TREE both render as one class
 * fanning multiple parent edges, exactly as resolved server-side.
 */
export function computeClassLayout(dataset: Dataset): GraphLayout {
  const classes: LadderClass[] = dataset.class_ladder;

  const treeIds = [...new Set(classes.map((c) => c.tree_id))].sort();
  const hubAngle = new Map<string, number>();
  treeIds.forEach((id, i) => hubAngle.set(id, (i / treeIds.length) * Math.PI * 2));

  const hubs: HubMarker[] = treeIds.map((id) => {
    const angle = hubAngle.get(id)!;
    return { key: id, label: id, x: HUB_RADIUS * Math.cos(angle), y: HUB_RADIUS * Math.sin(angle) };
  });
  const hubPos = new Map(hubs.map((h) => [h.key, h]));

  const clustersByHub = new Map<string, Set<string>>();
  for (const c of classes) {
    const set = clustersByHub.get(c.tree_id) ?? new Set<string>();
    set.add(clusterKeyFor(c));
    clustersByHub.set(c.tree_id, set);
  }

  const clusterCenter = new Map<string, { x: number; y: number }>();
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

  const bucketOf = new Map<string, string>();
  const bucketMembers = new Map<string, string[]>();
  for (const c of classes) {
    const cluster = clusterKeyFor(c);
    const bucketKey = `${c.tree_id}::${cluster}::${c.star}`;
    bucketOf.set(c.id, bucketKey);
    const members = bucketMembers.get(bucketKey) ?? [];
    members.push(c.id);
    bucketMembers.set(bucketKey, members);
  }
  for (const members of bucketMembers.values()) members.sort();

  const positions = new Map<string, LaidOutNode>();
  for (const c of classes) {
    const cluster = clusterKeyFor(c);
    const center = clusterCenter.get(`${c.tree_id}::${cluster}`)!;
    const radius = STAR_RADIUS[c.star] ?? 330;
    const clusterBaseAngle = hubAngle.get(c.tree_id)!;

    const members = bucketMembers.get(bucketOf.get(c.id)!)!;
    const n = members.length;
    const indexInBucket = members.indexOf(c.id);
    let angle = clusterBaseAngle;
    if (n > 1) {
      const step = Math.min(MAX_FAN_ARC / (n - 1), MIN_NODE_SEPARATION / Math.max(radius, 1));
      angle += (indexInBucket - (n - 1) / 2) * step;
    }
    positions.set(c.id, { id: c.id, x: center.x + radius * Math.cos(angle), y: center.y + radius * Math.sin(angle) });
  }

  relaxCollisions(positions);

  const edges: LaidOutEdge[] = [];
  for (const c of classes) {
    for (const parentId of resolveParentIds(c, classes)) {
      if (positions.has(parentId)) {
        edges.push({ id: `${parentId}->${c.id}`, source: parentId, target: c.id });
      }
    }
  }

  return { positions, edges, hubs };
}
