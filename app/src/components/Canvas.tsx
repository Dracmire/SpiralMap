import { useMemo, useCallback } from "react";
import { ReactFlow, Background, Controls, MiniMap, type Node, type Edge, type NodeMouseHandler } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { Dataset, FeatOrFusion } from "../types.ts";
import type { GraphLayout } from "../layout/layoutGraph.ts";
import { isFusion } from "../types.ts";

interface CanvasProps {
  dataset: Dataset;
  layout: GraphLayout;
  selectedNodeId: string | null;
  onSelectNode: (id: string) => void;
  isOwned: (id: string) => boolean;
  isAvailable: (id: string) => boolean;
}

function nodeStyle(owned: boolean, available: boolean, selected: boolean, isFusionNode: boolean): React.CSSProperties {
  const base: React.CSSProperties = {
    padding: "6px 10px",
    borderRadius: isFusionNode ? 4 : 10,
    fontSize: 11,
    lineHeight: 1.3,
    minWidth: 90,
    maxWidth: 140,
    textAlign: "center",
    cursor: "pointer",
    border: "2px solid",
    background: "#1b1e26",
    color: "#e8e8ec",
  };
  if (owned) {
    base.borderColor = "#4caf50";
    base.background = "#1d3320";
  } else if (available) {
    base.borderColor = "#4a90d9";
  } else {
    base.borderColor = "#55555f";
    base.color = "#9a9aa4";
  }
  if (selected) {
    base.boxShadow = "0 0 0 3px rgba(255,255,255,0.5)";
  }
  return base;
}

export function Canvas({ dataset, layout, selectedNodeId, onSelectNode, isOwned, isAvailable }: CanvasProps) {
  const allFeats: FeatOrFusion[] = useMemo(() => [...dataset.feats, ...dataset.fusions], [dataset]);

  const nodes: Node[] = useMemo(() => {
    const hubNodes: Node[] = layout.hubs.map((h) => ({
      id: `hub:${h.key}`,
      position: { x: h.x, y: h.y },
      data: { label: h.label },
      style: { fontSize: 13, fontWeight: 700, color: "#c9c9d4", background: "transparent", border: "none", pointerEvents: "none" as const },
      draggable: false,
      selectable: false,
    }));
    const featNodes: Node[] = allFeats.map((f) => {
      const pos = layout.positions.get(f.id)!;
      return {
        id: f.id,
        position: { x: pos.x, y: pos.y },
        data: { label: `${f.name}${f.derived_tier ? ` · ${f.derived_tier}` : ""}` },
        style: nodeStyle(isOwned(f.id), isAvailable(f.id), f.id === selectedNodeId, isFusion(f)),
      };
    });
    return [...hubNodes, ...featNodes];
  }, [allFeats, layout, isOwned, isAvailable, selectedNodeId]);

  const edges: Edge[] = useMemo(
    () =>
      layout.edges.map((e) => ({
        id: e.id,
        source: e.source,
        target: e.target,
        style: { stroke: "#4a4a55" },
      })),
    [layout],
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
