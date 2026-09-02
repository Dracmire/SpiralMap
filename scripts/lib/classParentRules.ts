/**
 * Pure parent-rule resolution for class_ladder.csv, split out of
 * scripts/adapters/class_ladder.ts so it has no file-I/O imports (no node:fs) and can
 * be bundled by Vite — the app imports resolveParentIds from here for its class-tree
 * canvas, and scripts/adapters/class_ladder.ts re-exports it so the CLI validator and
 * the app share exactly one implementation of the rule.
 */
import type { LadderClass } from "../../schema/spiral.ts";

/**
 * Resolved parent set for one class: who can reach it. Empty for star 0 (tree
 * roots have no parent) and for a genuinely broken row (blank/unresolvable
 * parent_class_id, or a wildcard rule with no candidates in its tree — both real
 * possibilities in the authored data, not just theoretical).
 */
export function resolveParentIds(cls: LadderClass, allClasses: LadderClass[]): string[] {
  if (cls.star === 0) return [];
  if (cls.parent_rule === "ROOT" || cls.parent_rule === "SLOT_PAIR") {
    return cls.parent_class_id ? [cls.parent_class_id] : [];
  }
  if (cls.parent_rule === "ANY_LOWER_STAR_IN_TREE") {
    return allClasses.filter((c) => c.tree_id === cls.tree_id && c.star === 1).map((c) => c.id);
  }
  if (cls.parent_rule === "ANY_2STAR_IN_TREE") {
    return allClasses.filter((c) => c.tree_id === cls.tree_id && c.star === 2).map((c) => c.id);
  }
  return [];
}
