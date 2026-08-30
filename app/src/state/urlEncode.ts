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

export function decodeBuildFromUrl(): BuildState | null {
  const hash = window.location.hash.replace(/^#/, "");
  const params = new URLSearchParams(hash);
  const encoded = params.get(HASH_KEY);
  if (!encoded) return null;
  try {
    const json = decodeURIComponent(atob(encoded));
    return JSON.parse(json) as BuildState;
  } catch {
    return null;
  }
}
