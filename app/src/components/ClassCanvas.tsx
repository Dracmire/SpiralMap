import { useMemo, useCallback } from "react";
import { ReactFlow, Background, Controls, MiniMap, type Node, type Edge, type NodeMouseHandler } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { Dataset } from "../types.ts";
import type { LadderClass } from "../../../schema/spiral.ts";
import type { GraphLayout } from "../layout/layoutGraph.ts";

interface ClassCanvasProps {
  dataset: Dataset;
  layout: GraphLayout;
  selectedNodeId: string | null;
  onSelectNode: (id: string) => void;
  showMonsterClasses: boolean;
}

const STAR_COLOR: Record<number, string> = {
  0: "#55555f",
  1: "#4a90d9",
  2: "#9a6fd9",
  3: "#d9a84a",
};

function nodeStyle(star: number, selected: boolean): React.CSSProperties {
  const base: React.CSSProperties = {
    padding: "6px 10px",
    borderRadius: 10,
    fontSize: 11,
    lineHeight: 1.3,
    minWidth: 90,
    maxWidth: 140,
    textAlign: "center",
    cursor: "pointer",
    border: "2px solid",
    background: "#1b1e26",
    color: "#e8e8ec",
    borderColor: STAR_COLOR[star] ?? "#55555f",
  };
  if (selected) base.boxShadow = "0 0 0 3px rgba(255,255,255,0.5)";
  return base;
}

export function ClassCanvas({ dataset, layout, selectedNodeId, onSelectNode, showMonsterClasses }: ClassCanvasProps) {
  const classes: LadderClass[] = useMemo(
    () => dataset.class_ladder.filter((c) => showMonsterClasses || !c.is_monster_class),
    [dataset, showMonsterClasses],
  );
  const visibleIds = useMemo(() => new Set(classes.map((c) => c.id)), [classes]);

  const nodes: Node[] = useMemo(() => {
    const hubNodes: Node[] = layout.hubs.map((h) => ({
      id: `hub:${h.key}`,
      position: { x: h.x, y: h.y },
      data: { label: h.label },
      style: { fontSize: 13, fontWeight: 700, color: "#c9c9d4", background: "transparent", border: "none", pointerEvents: "none" as const },
      draggable: false,
      selectable: false,
    }));
    const classNodes: Node[] = classes.map((c) => {
      const pos = layout.positions.get(c.id)!;
      return {
        id: c.id,
        position: { x: pos.x, y: pos.y },
        data: { label: `${c.name} · ${"★".repeat(c.star) || "root"}` },
        style: nodeStyle(c.star, c.id === selectedNodeId),
      };
    });
    return [...hubNodes, ...classNodes];
  }, [classes, layout, selectedNodeId]);

  const edges: Edge[] = useMemo(
    () =>
      layout.edges.filter((e) => visibleIds.has(e.source) && visibleIds.has(e.target)).map((e) => ({
        id: e.id,
        source: e.source,
        target: e.target,
        style: { stroke: "#4a4a55" },
      })),
    [layout, visibleIds],
  );

  const handleNodeClick: NodeMouseHandler = useCallback(
    (_evt, node) => {
      if (node.id.startsWith("hub:")) return;
      onSelectNode(node.id);
    },
    [onSelectNode],
  );

  return (
    <div style={{ width: "100%", height: "100%", background: "#0e0f13" }}>
      <ReactFlow nodes={nodes} edges={edges} onNodeClick={handleNodeClick} fitView minZoom={0.05} maxZoom={2}>
        <Background color="#2a2b33" gap={40} />
        <Controls />
        <MiniMap pannable zoomable style={{ background: "#1b1e26" }} nodeColor="#4a4a55" />
      </ReactFlow>
    </div>
  );
}
