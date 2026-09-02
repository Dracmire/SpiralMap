import { useCallback, useEffect, useMemo, useState } from "react";
import { dataset } from "./data/dataset.ts";
import { computeLayout } from "./layout/layoutGraph.ts";
import { computeClassLayout } from "./layout/classLayout.ts";
import { evaluateRequirement } from "./layout/requirementClosure.ts";
import { Canvas } from "./components/Canvas.tsx";
import { ClassCanvas } from "./components/ClassCanvas.tsx";
import { ClassDetailCard } from "./components/ClassDetailCard.tsx";
import { CharacterPanel } from "./components/CharacterPanel.tsx";
import { DetailCard } from "./components/DetailCard.tsx";
import { AdvantagesPanel } from "./components/AdvantagesPanel.tsx";
import { CostPanel } from "./components/CostPanel.tsx";
import { SaveLoad } from "./components/SaveLoad.tsx";
import { AuthorPanel } from "./components/AuthorPanel.tsx";
import { BuildStateContext, BuildDispatchContext, emptyBuildState, useBuildReducer } from "./state/buildState.ts";
import { decodeBuildFromUrl, encodeBuildToUrl } from "./state/urlEncode.ts";
import "@xyflow/react/dist/style.css";
import "./App.css";

type Mode = "build" | "classes" | "author";

export default function App() {
  const [mode, setMode] = useState<Mode>("build");
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedClassId, setSelectedClassId] = useState<string | null>(null);
  const [showMonsterClasses, setShowMonsterClasses] = useState(false);
  const [build, dispatch] = useBuildReducer(decodeBuildFromUrl() ?? emptyBuildState());

  useEffect(() => {
    encodeBuildToUrl(build);
  }, [build]);

  const layout = useMemo(() => computeLayout(dataset), []);
  const classLayout = useMemo(() => computeClassLayout(dataset), []);

  const nodesById = useMemo(() => {
    const map = new Map<string, (typeof dataset.feats)[number]>();
    for (const f of dataset.feats) map.set(f.id, f);
    for (const f of dataset.fusions) map.set(f.id, f);
    return map;
  }, []);
  const ownedSet = useMemo(() => new Set(build.feat_ids), [build.feat_ids]);

  const isOwned = useCallback((id: string) => ownedSet.has(id), [ownedSet]);
  const isAvailable = useCallback(
    (id: string) => {
      if (ownedSet.has(id)) return false;
      const node = nodesById.get(id);
      if (!node) return false;
      return node.requirements.every((r) => evaluateRequirement(r, build));
    },
    [ownedSet, nodesById, build],
  );

  return (
    <BuildStateContext.Provider value={build}>
      <BuildDispatchContext.Provider value={dispatch}>
        <div className="app-shell">
          <header className="app-header">
            <h1>Spiral Passive Builder</h1>
            <span className={`status-badge ${dataset._valid ? "status-ok" : "status-bad"}`}>
              {dataset._valid ? "valid" : "invalid"}
              {dataset._draft ? " (draft)" : ""} — {dataset._error_count} error{dataset._error_count === 1 ? "" : "s"},{" "}
              {dataset._warning_count} warning{dataset._warning_count === 1 ? "" : "s"}
            </span>
            <div className="mode-toggle">
              <button className={mode === "build" ? "active" : ""} onClick={() => setMode("build")}>
                Build
              </button>
              <button className={mode === "classes" ? "active" : ""} onClick={() => setMode("classes")}>
                Classes
              </button>
              <button className={mode === "author" ? "active" : ""} onClick={() => setMode("author")}>
                Author
              </button>
            </div>
          </header>

          {mode === "build" ? (
            <div className="app-body">
              <CharacterPanel dataset={dataset} />
              <div className="canvas-area">
                <Canvas
                  dataset={dataset}
                  layout={layout}
                  selectedNodeId={selectedNodeId}
                  onSelectNode={setSelectedNodeId}
                  isOwned={isOwned}
                  isAvailable={isAvailable}
                />
              </div>
              <div className="right-column">
                <DetailCard dataset={dataset} nodeId={selectedNodeId} />
                <AdvantagesPanel dataset={dataset} />
                <CostPanel dataset={dataset} />
                <SaveLoad />
              </div>
            </div>
          ) : mode === "classes" ? (
            <div className="app-body author-body">
              <div className="canvas-area" style={{ display: "flex", flexDirection: "column" }}>
                <div className="canvas-toolbar">
                  <label>
                    <input
                      type="checkbox"
                      checked={showMonsterClasses}
                      onChange={(e) => setShowMonsterClasses(e.target.checked)}
                    />{" "}
                    Show monster classes (is_monster_class)
                  </label>
                </div>
                <div style={{ flex: 1, minHeight: 0 }}>
                  <ClassCanvas
                    dataset={dataset}
                    layout={classLayout}
                    selectedNodeId={selectedClassId}
                    onSelectNode={setSelectedClassId}
                    showMonsterClasses={showMonsterClasses}
                  />
                </div>
              </div>
              <div className="right-column">
                <ClassDetailCard dataset={dataset} classId={selectedClassId} />
              </div>
            </div>
          ) : (
            <AuthorPanel dataset={dataset} selectedNodeId={selectedNodeId} onSelectNode={setSelectedNodeId} layout={layout} />
          )}
        </div>
      </BuildDispatchContext.Provider>
    </BuildStateContext.Provider>
  );
}
