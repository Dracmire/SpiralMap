/**
 * Loads content/classes.csv, class_tiers.csv, unlock_lines.csv, keystones.csv per
 * docs/authoring-classes.md. Each ships with one worked row and one blank
 * authoring-scaffold row (all cells empty) — the blank row is dropped on load, never
 * reported as an error (it's a shape hint for the author, not content).
 *
 * class_tiers.csv is authored "long" (one row per (class_id, star, path)), but
 * CharacterClass.tiers is "wide" (one ClassTierRow per star, generalist+specialist
 * folded together) — this file does that grouping.
 */
import { existsSync, readFileSync } from "node:fs";
import { parseCsv, type CsvRow } from "../lib/csv.ts";
import { parseAttributeBreakpoints, parseRequirements } from "../lib/parsers.ts";
import type { CharacterClass, ClassTierRow, Keystone, Requirement, Skill, UnlockLine } from "../../schema/spiral.ts";

export type CharacterClassOut = CharacterClass & { tier_kind?: string; zone_id?: string | null; description?: string };
export type UnlockLineOut = UnlockLine & { star?: number; description?: string };
export type KeystoneOut = Keystone & { star?: number; cp_cost?: number; description?: string };

export interface ClassContent {
  classes: CharacterClassOut[];
  unlock_lines: UnlockLineOut[];
  keystones: KeystoneOut[];
  errors: string[];
}

function isBlankScaffoldRow(r: CsvRow): boolean {
  return Object.values(r).every((v) => v === undefined || v.trim() === "");
}

function readRows(contentDir: string, sheet: string): { rows: CsvRow[]; rowNumbers: number[] } {
  const path = `${contentDir}/${sheet}`;
  if (!existsSync(path)) return { rows: [], rowNumbers: [] };
  const { rows, rowNumbers } = parseCsv(readFileSync(path, "utf8"));
  const kept: CsvRow[] = [];
  const keptRowNumbers: number[] = [];
  rows.forEach((r, i) => {
    if (isBlankScaffoldRow(r)) return; // authoring-scaffold row — not content, not an error
    kept.push(r);
    keptRowNumbers.push(rowNumbers[i]);
  });
  return { rows: kept, rowNumbers: keptRowNumbers };
}

function splitIds(field: string | undefined): string[] {
  return (field ?? "")
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s !== "");
}

export function loadClassContent(contentDir: string, skillsById: Map<string, Skill>, featsById: Map<string, unknown>): ClassContent {
  const errors: string[] = [];

  // ── classes.csv ──────────────────────────────────────────────
  const classesSheet = "classes.csv";
  const { rows: classRows, rowNumbers: classRowNumbers } = readRows(contentDir, classesSheet);
  const classesById = new Map<string, CharacterClassOut>();
  classRows.forEach((r, i) => {
    const row = classRowNumbers[i];
    const alignedSkillIds = splitIds(r.aligned_skill_ids);
    for (const skillId of alignedSkillIds) {
      // Rule 1: every aligned_skill_ids entry resolves in skills_canonical.csv.
      if (!skillsById.has(skillId)) {
        errors.push(`${classesSheet}!${row}: aligned_skill_ids references unknown skill "${skillId}"`);
      }
    }
    // Rule 2: attribute_breakpoints parses.
    const { value: breakpoints, errors: bpErrors } = parseAttributeBreakpoints(r.attribute_breakpoints ?? "");
    bpErrors.forEach((m) => errors.push(`${classesSheet}!${row}: ${m}`));

    const maxLevel = Number(r.max_level);
    classesById.set(r.class_id, {
      id: r.class_id,
      name: r.name,
      aligned_skill_ids: alignedSkillIds,
      aligned_attribute_breakpoints: breakpoints.map((b) => ({ attribute: b.attribute, at: b.at, insight_bonus: b.insight_bonus })),
      tiers: [], // filled in after class_tiers.csv is grouped, below
      max_level: Number.isFinite(maxLevel) ? maxLevel : 0,
      parent_class_id: r.parent_class_id?.trim() || null,
      tier_kind: r.tier_kind?.trim() || undefined,
      zone_id: r.zone_id?.trim() || null,
      description: r.description ?? "",
    });
  });

  // ── unlock_lines.csv ─────────────────────────────────────────
  const linesSheet = "unlock_lines.csv";
  const { rows: lineRows, rowNumbers: lineRowNumbers } = readRows(contentDir, linesSheet);
  const unlockLinesById = new Map<string, UnlockLineOut>();
  lineRows.forEach((r, i) => {
    const row = lineRowNumbers[i];
    const memberFeatIds = splitIds(r.member_feat_ids);
    for (const featId of memberFeatIds) {
      // Rule 4: member_feat_ids all resolve.
      if (!featsById.has(featId)) {
        errors.push(`${linesSheet}!${row}: member_feat_ids references unknown feat "${featId}"`);
      }
    }
    const star = Number(r.star);
    unlockLinesById.set(r.line_id, {
      id: r.line_id,
      name: r.name,
      class_id: r.class_id,
      member_feat_ids: memberFeatIds,
      star: Number.isFinite(star) ? star : undefined,
      description: r.description ?? "",
    });
  });

  // ── keystones.csv ────────────────────────────────────────────
  const keystonesSheet = "keystones.csv";
  const { rows: keystoneRows, rowNumbers: keystoneRowNumbers } = readRows(contentDir, keystonesSheet);
  const keystonesById = new Map<string, KeystoneOut>();
  keystoneRows.forEach((r, i) => {
    const row = keystoneRowNumbers[i];
    // Rule 5: Keystone requirements parse; any INSIGHT: target names a real class.
    const { value: requirements, errors: reqErrors } = parseRequirements(r.requirements ?? "");
    reqErrors.forEach((m) => errors.push(`${keystonesSheet}!${row}: ${m}`));
    for (const req of requirements as Requirement[]) {
      if (req.type === "INSIGHT" && !classesById.has(req.target)) {
        errors.push(`${keystonesSheet}!${row}: requirement INSIGHT references unknown class "${req.target}"`);
      }
    }
    // Rule 6: every Keystone has a non-empty boundary.
    if (!r.boundary || r.boundary.trim() === "") {
      errors.push(`${keystonesSheet}!${row}: missing required field "boundary"`);
    }
    const star = Number(r.star);
    const cpCost = Number(r.cp_cost);
    keystonesById.set(r.keystone_id, {
      id: r.keystone_id,
      name: r.name,
      class_id: r.class_id,
      requirements,
      perk_ids: splitIds(r.perk_ids),
      boundary: r.boundary ?? "",
      star: Number.isFinite(star) ? star : undefined,
      cp_cost: Number.isFinite(cpCost) ? cpCost : undefined,
      description: r.description ?? "",
    });
  });

  // ── class_tiers.csv ──────────────────────────────────────────
  // Long-format rows (one per class_id/star/path) grouped into one wide ClassTierRow
  // per (class_id, star): ENTRY has no fork (star 0 only); GENERALIST is at most one
  // row; SPECIALIST may be several — the alternatives a player picks between.
  const tiersSheet = "class_tiers.csv";
  const { rows: tierRows, rowNumbers: tierRowNumbers } = readRows(contentDir, tiersSheet);

  interface Bucket {
    entry: { r: CsvRow; row: number } | null;
    generalist: { r: CsvRow; row: number } | null;
    specialists: { r: CsvRow; row: number }[];
  }
  const byClassStar = new Map<string, Bucket>(); // key: `${class_id}|${star}`

  function checkGrant(sheet: string, row: number, grantKind: string, grantId: string): { kind: "LINE" | "KEYSTONE"; id: string } | null {
    if (grantKind !== "LINE" && grantKind !== "KEYSTONE") return null;
    // Rule 3: grant_id resolves to a real Line or Keystone when grant_kind is LINE or KEYSTONE.
    const resolved = grantKind === "LINE" ? unlockLinesById.has(grantId) : keystonesById.has(grantId);
    if (!resolved) {
      errors.push(`${sheet}!${row}: grant_id "${grantId}" (${grantKind}) not found in ${grantKind === "LINE" ? "unlock_lines.csv" : "keystones.csv"}`);
    }
    return { kind: grantKind, id: grantId };
  }

  tierRows.forEach((r, i) => {
    const row = tierRowNumbers[i];
    const key = `${r.class_id}|${r.star}`;
    const bucket = byClassStar.get(key) ?? { entry: null, generalist: null, specialists: [] };
    const path = r.path?.trim();
    if (path === "ENTRY") {
      // Rule 7: no duplicate (class_id, star, path) — ENTRY/GENERALIST get at most one row.
      if (bucket.entry) errors.push(`${tiersSheet}!${row}: duplicate (class_id, star, path) — class "${r.class_id}" already has an ENTRY row at star ${r.star}`);
      bucket.entry = { r, row };
    } else if (path === "GENERALIST") {
      if (bucket.generalist) errors.push(`${tiersSheet}!${row}: duplicate (class_id, star, path) — class "${r.class_id}" already has a GENERALIST row at star ${r.star}`);
      bucket.generalist = { r, row };
    } else if (path === "SPECIALIST") {
      bucket.specialists.push({ r, row }); // multiple rows at one star are the alternatives — not a duplicate
    } else {
      errors.push(`${tiersSheet}!${row}: unknown path "${r.path}" (expected ENTRY, GENERALIST, or SPECIALIST)`);
    }
    byClassStar.set(key, bucket);
  });

  for (const [key, bucket] of byClassStar) {
    const [classId, starRaw] = key.split("|");
    const star = Number(starRaw);
    if (!Number.isFinite(star) || star < 0 || star > 4) continue; // malformed star already reported below via NaN checks elsewhere if relevant

    const insightOf = (entry: { r: CsvRow; row: number } | null): number => {
      if (!entry) return 0;
      const n = Number(entry.r.insight_required);
      return Number.isFinite(n) ? n : 0;
    };

    let insight_generalist: number;
    let insight_specialist: number;
    let generalist_grant: ClassTierRow["generalist_grant"] = null;
    const specialist_grants: ClassTierRow["specialist_grants"] = [];

    if (bucket.entry && !bucket.generalist && bucket.specialists.length === 0) {
      // Star 0: entry, no fork yet — both readings share the entry's own value.
      insight_generalist = insightOf(bucket.entry);
      insight_specialist = insightOf(bucket.entry);
      const gk = bucket.entry.r.grant_kind?.trim() ?? "";
      if (gk) generalist_grant = checkGrant(tiersSheet, bucket.entry.row, gk, bucket.entry.r.grant_id?.trim() ?? "");
    } else {
      insight_generalist = insightOf(bucket.generalist);
      insight_specialist = bucket.specialists.length > 0 ? insightOf(bucket.specialists[0]) : 0;
      if (bucket.generalist) {
        const gk = bucket.generalist.r.grant_kind?.trim() ?? "";
        if (gk) generalist_grant = checkGrant(tiersSheet, bucket.generalist.row, gk, bucket.generalist.r.grant_id?.trim() ?? "");
      }
      for (const s of bucket.specialists) {
        const gk = s.r.grant_kind?.trim() ?? "";
        const grant = gk ? checkGrant(tiersSheet, s.row, gk, s.r.grant_id?.trim() ?? "") : null;
        specialist_grants.push({ subclass_name: s.r.subclass_name?.trim() || null, grant });
      }
    }

    const tierRow: ClassTierRow = {
      star: star as ClassTierRow["star"],
      insight_generalist,
      insight_specialist,
      level_min: (() => {
        const n = Number((bucket.generalist ?? bucket.entry ?? bucket.specialists[0])?.r.level_min);
        return Number.isFinite(n) ? n : 0;
      })(),
      generalist_grant,
      specialist_grants,
    };

    const cls = classesById.get(classId);
    if (cls) {
      cls.tiers.push(tierRow);
    } else {
      const anyRow = bucket.entry ?? bucket.generalist ?? bucket.specialists[0];
      errors.push(`${tiersSheet}!${anyRow!.row}: class_id "${classId}" not found in classes.csv`);
    }
  }

  for (const cls of classesById.values()) {
    cls.tiers.sort((a, b) => a.star - b.star);
  }

  return {
    classes: [...classesById.values()],
    unlock_lines: [...unlockLinesById.values()],
    keystones: [...keystonesById.values()],
    errors,
  };
}
