import { useRef } from "react";
import { useBuildState, useBuildDispatch } from "../state/buildState.ts";
import { exportBuildToMarkdown, importBuildFromMarkdown, downloadTextFile } from "../state/mdExport.ts";
import { encodeBuildToUrl } from "../state/urlEncode.ts";

export function SaveLoad() {
  const build = useBuildState();
  const dispatch = useBuildDispatch();
  const fileInput = useRef<HTMLInputElement>(null);

  function handleExport() {
    downloadTextFile("spiral-build.md", exportBuildToMarkdown(build));
  }

  function handleImportClick() {
    fileInput.current?.click();
  }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    const state = importBuildFromMarkdown(text);
    dispatch({ type: "REPLACE_STATE", state });
    e.target.value = "";
  }

  function handleCopyLink() {
    encodeBuildToUrl(build);
    navigator.clipboard?.writeText(window.location.href).catch(() => {});
  }

  return (
    <div className="panel save-load">
      <h2>Save / Load</h2>
      <button className="btn" onClick={handleExport}>
        Export .md
      </button>
      <button className="btn" onClick={handleImportClick}>
        Import .md
      </button>
      <input ref={fileInput} type="file" accept=".md" style={{ display: "none" }} onChange={handleFileChange} />
      <button className="btn" onClick={handleCopyLink}>
        Copy shareable link
      </button>
      <p className="hint">The build also lives in the URL — reload or share the link to restore it.</p>
    </div>
  );
}
