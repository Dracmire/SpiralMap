import type { BuildState } from "../../../schema/spiral.ts";
import { emptyBuildState } from "./buildState.ts";

/** Human-readable, re-importable — a simple controlled markdown format, not general Markdown parsing. */
export function exportBuildToMarkdown(state: BuildState): string {
  const lines: string[] = [];
  lines.push("# Spiral Build");
  lines.push("");
  lines.push(`- zone_id: ${state.zone_id}`);
  lines.push(`- class_id: ${state.class_id ?? ""}`);
  lines.push(`- traits: ${state.trait_ids.join(", ")}`);
  lines.push("");
  lines.push("## Skill Levels");
  for (const [id, level] of Object.entries(state.skill_levels)) {
    if (level > 0) lines.push(`- ${id}: ${level}`);
  }
  lines.push("");
  lines.push("## Attributes");
  for (const [id, value] of Object.entries(state.attributes)) {
    lines.push(`- ${id}: ${value}`);
  }
  lines.push("");
  lines.push("## Feats");
  for (const id of state.feat_ids) {
    lines.push(`- ${id}`);
  }
  lines.push("");
  return lines.join("\n");
}

export function importBuildFromMarkdown(text: string): BuildState {
  const state = emptyBuildState();
  let section: "skills" | "attributes" | "feats" | null = null;

  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    if (line === "## Skill Levels") {
      section = "skills";
      continue;
    }
    if (line === "## Attributes") {
      section = "attributes";
      continue;
    }
    if (line === "## Feats") {
      section = "feats";
      continue;
    }
    if (line.startsWith("## ")) {
      section = null;
      continue;
    }

    const kv = line.match(/^- ([a-zA-Z0-9_]+):\s*(.*)$/);
    if (line.startsWith("- zone_id:")) {
      state.zone_id = line.slice("- zone_id:".length).trim() || "universal";
    } else if (line.startsWith("- class_id:")) {
      const v = line.slice("- class_id:".length).trim();
      state.class_id = v || null;
    } else if (line.startsWith("- traits:")) {
      const v = line.slice("- traits:".length).trim();
      state.trait_ids = v ? v.split(",").map((s) => s.trim()).filter(Boolean) : [];
    } else if (section === "skills" && kv) {
      state.skill_levels[kv[1]] = Number(kv[2]) || 0;
    } else if (section === "attributes" && kv) {
      (state.attributes as Record<string, number>)[kv[1]] = Number(kv[2]) || 0;
    } else if (section === "feats" && line.startsWith("- ")) {
      state.feat_ids.push(line.slice(2).trim());
    }
  }

  return state;
}

export function downloadTextFile(filename: string, content: string, mime = "text/markdown") {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
