/**
 * Loads content/class_ladder.csv — 8 class trees, star 0-3, 7 lettered branch slots
 * (A-G), two variants per slot at star 1-2. Supersedes Phase 6's classes.csv/
 * class_tiers.csv/unlock_lines.csv/keystones.csv (a Generalist/Specialist fork that
 * didn't match the real data) — this is a different, independent shape.
 *
 * `parent_class_id` is a literal id only for ROOT and SLOT_PAIR rows (both already
 * carry the real parent id from extraction — no slot-arithmetic needed). For
 * ANY_LOWER_STAR_IN_TREE and ANY_2STAR_IN_TREE rows it's "*", and parent_rule
 * decides the resolved parent set instead — resolveParentIds does that, reused by
 * the app for both display and validation so the rule lives in exactly one place.
 * resolveParentIds itself lives in scripts/lib/classParentRules.ts (re-exported below)
 * rather than here, because this file also does file I/O (node:fs) — Vite refuses to
 * bundle that for the browser, and the app needs the pure resolver for its canvas.
 */
import { existsSync, readFileSync } from "node:fs";
import { parseCsv, type CsvRow } from "../lib/csv.ts";
import type { AttributeId, LadderClass, ParentRule } from "../../schema/spiral.ts";
import { resolveParentIds } from "../lib/classParentRules.ts";

export { resolveParentIds };

export interface ClassLadderResult {
  classes: LadderClass[];
  errors: string[];
}

const VALID_ATTRIBUTE_IDS: ReadonlySet<string> = new Set(["STR", "AGI", "INT", "PER", "WIL", "CHA"]);
const VALID_PARENT_RULES: ReadonlySet<string> = new Set(["ROOT", "SLOT_PAIR", "ANY_LOWER_STAR_IN_TREE", "ANY_2STAR_IN_TREE"]);
const VALID_CRITERIA_SOURCES: ReadonlySet<string> = new Set(["NOT_APPLICABLE", "PENDING", "SUGGESTED", "AUTHORED"]);

function normalizeAttributeTag(raw: string, sheet: string, row: number, errors: string[]): AttributeId | "VAR" | null {
  const v = raw.trim();
  if (v === "") return null;
  if (v === "VAR") return "VAR";
  if (v === "CAR") {
    errors.push(`${sheet}!${row}: attribute_tag "CAR" normalized to "CHA" — source uses CAR/CHA interchangeably, fix in the CSV`);
    return "CHA";
  }
  if (!VALID_ATTRIBUTE_IDS.has(v)) {
    errors.push(`${sheet}!${row}: unknown attribute_tag "${v}"`);
    return null;
  }
  return v as AttributeId;
}

function parseOptionalInt(raw: string): number | null {
  const v = raw.trim();
  if (v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function parseOptionalString(raw: string | undefined): string | null {
  return raw === undefined || raw.trim() === "" ? null : raw;
}

export function loadClassLadder(contentDir: string): ClassLadderResult {
  const sheet = "class_ladder.csv";
  const errors: string[] = [];
  const path = `${contentDir}/${sheet}`;
  if (!existsSync(path)) return { classes: [], errors: [] };

  const { rows, rowNumbers } = parseCsv(readFileSync(path, "utf8"));

  const seen = new Map<string, number>();
  const classes: LadderClass[] = rows.map((r: CsvRow, i) => {
    const row = rowNumbers[i];

    if (seen.has(r.class_id)) {
      errors.push(`${sheet}!${row}: duplicate class_id "${r.class_id}" (first seen at row ${seen.get(r.class_id)}) — the later row shadows the earlier one in any id-keyed lookup`);
    } else {
      seen.set(r.class_id, row);
    }

    const star = Number(r.star);
    if (![0, 1, 2, 3].includes(star)) {
      errors.push(`${sheet}!${row}: unexpected star "${r.star}" (expected 0-3)`);
    }

    const rawParentRule = r.parent_rule?.trim() ?? "";
    let parent_rule: ParentRule | null = null;
    if (star === 0) {
      if (rawParentRule) errors.push(`${sheet}!${row}: star-0 row has a parent_rule ("${rawParentRule}") — tree roots should have none`);
    } else if (!VALID_PARENT_RULES.has(rawParentRule)) {
      errors.push(`${sheet}!${row}: unknown parent_rule "${rawParentRule}"`);
    } else {
      parent_rule = rawParentRule as ParentRule;
    }

    const rawParentId = r.parent_class_id?.trim() ?? "";
    const parent_class_id = rawParentId === "" || rawParentId === "*" ? null : rawParentId;
    if ((parent_rule === "ROOT" || parent_rule === "SLOT_PAIR") && parent_class_id === null) {
      errors.push(`${sheet}!${row}: ${parent_rule} rule requires a literal parent_class_id, but it's blank`);
    }

    const rawCriteriaSource = r.criteria_source?.trim() ?? "";
    if (rawCriteriaSource && !VALID_CRITERIA_SOURCES.has(rawCriteriaSource)) {
      errors.push(`${sheet}!${row}: unknown criteria_source "${rawCriteriaSource}"`);
    }
    // "PENDING" is a literal placeholder authors typed into the criteria cell itself,
    // not real content — treat it the same as blank rather than displaying it as if
    // it were an authored quest.
    const rawCriteria = r.criteria?.trim() ?? "";
    const criteria = rawCriteria === "" || rawCriteria === "PENDING" ? null : rawCriteria;

    return {
      id: r.class_id,
      name: r.name,
      star: star as LadderClass["star"],
      tree_id: r.tree_id,
      branch_slot: r.branch_slot,
      variant: Number(r.variant) || 1,
      parent_class_id,
      parent_rule,
      attribute_tag: normalizeAttributeTag(r.attribute_tag ?? "", sheet, row, errors),
      level_cap_gain: parseOptionalInt(r.level_cap_gain ?? ""),
      fate_cost: parseOptionalInt(r.fate_cost ?? ""),
      level_cost: parseOptionalInt(r.level_cost ?? ""),
      criteria,
      criteria_source: (rawCriteriaSource || null) as LadderClass["criteria_source"],
      grants: parseOptionalString(r.grants),
      description: parseOptionalString(r.description),
      is_monster_class: r.is_monster_class?.trim().toUpperCase() === "Y",
      // Free-text author provenance note — passed through verbatim, never validated.
      data_issue: parseOptionalString(r.data_issue),
    };
  });

  // Parent resolution: every star>0 class must resolve to at least one real parent.
  const byId = new Map(classes.map((c) => [c.id, c]));
  classes.forEach((cls, i) => {
    const row = rowNumbers[i];
    if (cls.star === 0) return;
    const parents = resolveParentIds(cls, classes);
    if (parents.length === 0) {
      errors.push(`${sheet}!${row}: class "${cls.id}" (${cls.parent_rule ?? "no rule"}) resolves to no parent — check parent_class_id/parent_rule`);
      return;
    }
    for (const pid of parents) {
      if (!byId.has(pid)) {
        errors.push(`${sheet}!${row}: class "${cls.id}" resolved parent "${pid}" does not exist`);
      }
    }
  });

  return { classes, errors };
}
