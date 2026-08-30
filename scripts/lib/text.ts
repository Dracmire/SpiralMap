/** Generic text helpers shared by extraction/reconciliation scripts. */

/** Inverse of anti-grid.ts's slug(): "heavy_weapons_handling" -> "Heavy Weapons Handling". */
export function deslug(id: string): string {
  return id
    .split(/[_\s]+/)
    .filter((w) => w !== "")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/** Levenshtein edit distance. */
export function levenshtein(a: string, b: string): number {
  const al = a.length;
  const bl = b.length;
  if (al === 0) return bl;
  if (bl === 0) return al;

  let prev = new Array(bl + 1);
  let curr = new Array(bl + 1);
  for (let j = 0; j <= bl; j++) prev[j] = j;

  for (let i = 1; i <= al; i++) {
    curr[0] = i;
    for (let j = 1; j <= bl; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[bl];
}

/** 0..1 normalized similarity — 1 means identical, 0 means completely different. Case-insensitive. */
export function similarity(a: string, b: string): number {
  const aa = a.toLowerCase().trim();
  const bb = b.toLowerCase().trim();
  const maxLen = Math.max(aa.length, bb.length);
  if (maxLen === 0) return 1;
  return 1 - levenshtein(aa, bb) / maxLen;
}

/** Best match for `target` among `candidates`, by similarity(). Returns null for an empty candidate list. */
export function bestMatch(target: string, candidates: string[]): { candidate: string; similarity: number } | null {
  let best: { candidate: string; similarity: number } | null = null;
  for (const c of candidates) {
    const s = similarity(target, c);
    if (!best || s > best.similarity) best = { candidate: c, similarity: s };
  }
  return best;
}
