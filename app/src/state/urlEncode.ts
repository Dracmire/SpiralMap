import type { BuildState } from "../../../schema/spiral.ts";

const HASH_KEY = "build";

/** Encodes build state into the URL hash (`#build=...`) — no browser storage APIs used. */
export function encodeBuildToUrl(state: BuildState) {
  const json = JSON.stringify(state);
  const encoded = btoa(encodeURIComponent(json));
  const url = new URL(window.location.href);
  url.hash = `${HASH_KEY}=${encoded}`;
  window.history.replaceState(null, "", url.toString());
}

/** Structural check — a well-formed-but-incomplete blob (truncated link, hand-edited,
 * or an older link after BuildState's shape changed) must not crash the app on load. */
function isValidBuildState(v: unknown): v is BuildState {
  if (!v || typeof v !== "object") return false;
  const s = v as Record<string, unknown>;
  return (
    typeof s.zone_id === "string" &&
    !!s.skill_levels && typeof s.skill_levels === "object" &&
    !!s.attributes && typeof s.attributes === "object" &&
    Array.isArray(s.trait_ids) &&
    (s.class_id === null || typeof s.class_id === "string") &&
    Array.isArray(s.feat_ids)
  );
}

export function decodeBuildFromUrl(): BuildState | null {
  const hash = window.location.hash.replace(/^#/, "");
  const params = new URLSearchParams(hash);
  const encoded = params.get(HASH_KEY);
  if (!encoded) return null;
  try {
    const json = decodeURIComponent(atob(encoded));
    const parsed: unknown = JSON.parse(json);
    if (!isValidBuildState(parsed)) return null;
    // A link saved before declared_group_ids/criteria_ticked existed — default to
    // none declared/ticked rather than rejecting the whole link.
    return {
      ...parsed,
      declared_group_ids: Array.isArray(parsed.declared_group_ids) ? parsed.declared_group_ids : [],
      criteria_ticked:
        !!parsed.criteria_ticked && typeof parsed.criteria_ticked === "object" && !Array.isArray(parsed.criteria_ticked)
          ? (parsed.criteria_ticked as Record<string, boolean>)
          : {},
    };
  } catch {
    return null;
  }
}
