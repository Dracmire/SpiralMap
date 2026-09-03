/**
 * Column-mapping adapters for the reference CSVs (skills_canonical.csv,
 * specializations.csv, skill_groups.csv, group_skill_map.csv, attribute_verbs.csv,
 * skill_level_table.csv, legacy_skill_mapping.csv) that predate or sit alongside
 * authoring-columns.md's conventions. Kept separate from convert.ts's authoring-rule
 * logic (the 10 validation rules) since these sheets follow their own layout — see
 * docs/authoring-columns.md's "Reference sheets" section.
 *
 * Phase 4: skills_canonical.csv supersedes skills.csv (56 skills, real ids, a
 * `groups` column declared directly on each skill — group_skill_map.csv is now
 * redundant for deriving group_ids and is only cross-checked for staleness, never
 * consumed as data; specializations.csv's parent_skill links are keyed off the old
 * skill names. A broken link is reported, not silently re-pointed, UNLESS it's one of
 * the explicit, confirmed rows in content/specialization_parent_aliases.csv (data, not
 * code, so a future confirmed rename is a CSV edit, not a code change) — even then it
 * still reports, just as a resolved-via-alias note rather than an unresolved dead end).
 *
 * Known, deliberately-not-silently-fixed data issues (reported as errors — CAR/CHA
 * and "#N/A" both still appear in skills_canonical.csv's own attribute columns) or
 * as notes (group_skill_map.csv staleness, which is informational since it's no
 * longer consumed for anything).
 */

import { existsSync, readFileSync } from "node:fs";
import { parseCsv } from "../lib/csv.ts";
import type { AttributeId, Skill, SkillGroup, Specialization, SkillLevelRow } from "../../schema/spiral.ts";

export interface ReferenceData {
  skills: Skill[];
  skill_groups: SkillGroup[];
  specializations: Specialization[];
  skill_level_table: SkillLevelRow[];
  attributes: { id: AttributeId; name: string; verbs: string[] }[];
  errors: string[];
  notes: string[];
}

const VALID_ATTRIBUTE_IDS: ReadonlySet<string> = new Set(["STR", "AGI", "INT", "PER", "WIL", "CHA"]);

/** Some sheets use CAR interchangeably with CHA — normalize so `attribute` stays valid, but always report it. */
function normalizeAttribute(raw: string, sheet: string, row: number, errors: string[]): AttributeId {
  if (raw === "CAR") {
    errors.push(`${sheet}!${row}: attribute "CAR" normalized to "CHA" — source uses CAR/CHA interchangeably, fix in the CSV`);
    return "CHA";
  }
  if (!VALID_ATTRIBUTE_IDS.has(raw)) {
    errors.push(`${sheet}!${row}: unknown attribute code "${raw}"`);
    return raw as AttributeId;
  }
  return raw as AttributeId;
}

function normalizeOptionalAttribute(raw: string, sheet: string, row: number, errors: string[]): AttributeId | null {
  if (!raw || raw.trim() === "") return null;
  return normalizeAttribute(raw.trim(), sheet, row, errors);
}

function parseRequiredNumber(raw: string, field: string, sheet: string, row: number, errors: string[]): number {
  const n = Number(raw);
  if (raw === "" || !Number.isFinite(n)) {
    errors.push(`${sheet}!${row}: ${field} "${raw}" is not a number`);
    return 0;
  }
  return n;
}

function parseOptionalNumber(raw: string): number | null {
  if (raw === undefined || raw.trim() === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

function parseOptionalString(raw: string | undefined): string | null {
  return raw === undefined || raw.trim() === "" ? null : raw;
}

/** legacy_skill_mapping.csv's `instance` column, grouped by canonical_id — the
 * source for Skill.instances[] (decision: bare instance names, e.g. "Woodwork",
 * not "Skill: Instance" compounds — see the schema comment). */
function loadInstancesByCanonicalId(contentDir: string): Map<string, string[]> {
  const path = `${contentDir}/legacy_skill_mapping.csv`;
  const byId = new Map<string, string[]>();
  if (!existsSync(path)) return byId;
  const { rows } = parseCsv(readFileSync(path, "utf8"));
  for (const r of rows) {
    if (r.disposition !== "MAP_INSTANCE" || !r.instance) continue;
    const list = byId.get(r.canonical_id) ?? [];
    if (!list.includes(r.instance)) list.push(r.instance);
    byId.set(r.canonical_id, list);
  }
  return byId;
}

/** skills_canonical.csv has no free-text description column — only `instance_note`,
 * populated for 4 of 56 rows. content/skills_legacy_descriptions.csv carries over
 * the old skills.csv's prose for the 46 skills whose id didn't change under the
 * rename (a real, unambiguous match — never guessed for renamed/new skills). */
function loadLegacyDescriptions(contentDir: string): Map<string, string> {
  const path = `${contentDir}/skills_legacy_descriptions.csv`;
  const byId = new Map<string, string>();
  if (!existsSync(path)) return byId;
  const { rows } = parseCsv(readFileSync(path, "utf8"));
  for (const r of rows) if (r.description) byId.set(r.skill_id, r.description);
  return byId;
}

function loadSkills(contentDir: string, errors: string[]): { skills: Skill[]; canonicalCsv: ReturnType<typeof parseCsv> } {
  const sheet = "skills_canonical.csv";
  const canonicalCsv = parseCsv(readFileSync(`${contentDir}/${sheet}`, "utf8"));
  const { rows, rowNumbers } = canonicalCsv;
  const instancesByCanonicalId = loadInstancesByCanonicalId(contentDir);
  const legacyDescriptions = loadLegacyDescriptions(contentDir);
  const seen = new Map<string, number>();

  const skills = rows.map((r, i) => {
    const row = rowNumbers[i];
    if (seen.has(r.skill_id)) {
      errors.push(`${sheet}!${row}: duplicate id "${r.skill_id}" (first seen at row ${seen.get(r.skill_id)})`);
    } else {
      seen.set(r.skill_id, row);
    }
    return {
      id: r.skill_id,
      name: r.name,
      attribute: normalizeAttribute(r.attribute, sheet, row, errors),
      alt_attribute: normalizeOptionalAttribute(r.alt_attribute, sheet, row, errors),
      macro: parseOptionalString(r.macro),
      kind: (r.kind.toUpperCase() as "CORE" | "SUPPORT"),
      is_parameterized: r.is_parameterized.trim().toUpperCase() === "TRUE",
      instances: instancesByCanonicalId.get(r.skill_id) ?? [],
      group_ids: [], // filled in by loadSkillGroups, from this same row's `groups` column + group_skill_map.csv
      description: parseOptionalString(r.instance_note) ?? legacyDescriptions.get(r.skill_id) ?? "",
    };
  });
  return { skills, canonicalCsv };
}

/** Group membership merges TWO sources: skills_canonical.csv's own `groups` column
 * (semicolon-separated group NAMES — new, but sparse: only 14 of 28 groups have any
 * member declared this way) UNIONED with group_skill_map.csv (skill-name-keyed, older,
 * but still resolves for 97-99/100 rows once matched case-insensitively — dropping it
 * entirely would silently empty 14 groups that still have perfectly valid members).
 * Both name lookups are case-insensitive (e.g. "Minstrel" vs. "MINSTREL", "Rest" vs.
 * "REST") — that's normalizing capitalization, not guessing at a rename. A name that
 * still doesn't resolve either way (a real rename, e.g. "Heavy Armor Handling") is
 * reported and never patched. */
function loadSkillGroups(contentDir: string, skills: Skill[], canonicalCsv: ReturnType<typeof parseCsv>, errors: string[]): SkillGroup[] {
  const canonicalSheet = "skills_canonical.csv";
  const groupsSheet = "skill_groups.csv";
  const mapSheet = "group_skill_map.csv";
  const groupsCsv = parseCsv(readFileSync(`${contentDir}/${groupsSheet}`, "utf8"));

  const groupByLowerName = new Map(groupsCsv.rows.map((r) => [r.name.toLowerCase(), r]));
  const skillById = new Map(skills.map((s) => [s.id, s]));
  const skillByLowerName = new Map(skills.map((s) => [s.name.toLowerCase(), s]));
  const memberIdsByGroupId = new Map<string, string[]>();

  function addMembership(skill: Skill, groupId: string) {
    if (!skill.group_ids.includes(groupId)) skill.group_ids.push(groupId);
    const members = memberIdsByGroupId.get(groupId) ?? [];
    if (!members.includes(skill.id)) members.push(skill.id);
    memberIdsByGroupId.set(groupId, members);
  }

  canonicalCsv.rows.forEach((r, i) => {
    const row = canonicalCsv.rowNumbers[i];
    const skill = skillById.get(r.skill_id);
    if (!skill) return; // duplicate id already reported by loadSkills
    for (const rawName of (r.groups ?? "").split(";")) {
      const name = rawName.trim();
      if (!name) continue;
      const group = groupByLowerName.get(name.toLowerCase());
      if (!group) {
        errors.push(`${canonicalSheet}!${row}: group "${name}" (skill "${r.skill_id}") not found in skill_groups.csv`);
        continue;
      }
      addMembership(skill, group.group_id);
    }
  });

  if (existsSync(`${contentDir}/${mapSheet}`)) {
    const mapCsv = parseCsv(readFileSync(`${contentDir}/${mapSheet}`, "utf8"));
    mapCsv.rows.forEach((r, i) => {
      const row = mapCsv.rowNumbers[i];
      const skill = skillByLowerName.get(r.skill.toLowerCase());
      if (!skill) {
        errors.push(`${mapSheet}!${row}: skill "${r.skill}" (group "${r.group}") not found in skills_canonical.csv — needs re-pointing, not patched automatically`);
        return;
      }
      const group = groupByLowerName.get(r.group.toLowerCase());
      if (!group) {
        errors.push(`${mapSheet}!${row}: group "${r.group}" not found in skill_groups.csv`);
        return;
      }
      addMembership(skill, group.group_id);
    });
  }

  return groupsCsv.rows.map((r, i) => {
    const row = groupsCsv.rowNumbers[i];
    const memberIds = memberIdsByGroupId.get(r.group_id) ?? [];
    if (memberIds.length === 0) {
      errors.push(`${groupsSheet}!${row}: group "${r.name}" has no members in skills_canonical.csv's groups column or group_skill_map.csv`);
    }
    return {
      id: r.group_id,
      name: r.name,
      kind: (r.type.toUpperCase() as "CORE" | "SUPPORT"),
      key_attribute: normalizeAttribute(r.key_attribute, groupsSheet, row, errors),
      member_skill_ids: memberIds,
      discount_pct: 25,
    };
  });
}

/**
 * Import aliases for parent_skill display names confirmed as a stale rename, not a
 * casing issue or a guess — resolved and scoped explicitly, one entry at a time, in
 * content/specialization_parent_aliases.csv (data, not code, so a future confirmed
 * rename doesn't need a code change). NOT a general fuzzy-matcher: any parent_skill
 * name not listed there stays reported, not silently patched, until it's confirmed
 * the same way and added as a row. Keyed lowercase; value is the canonical skill id
 * (not another display name — future edges reference stable ids).
 */
function loadParentSkillAliases(contentDir: string, skills: Skill[], errors: string[]): Map<string, string> {
  const sheet = "specialization_parent_aliases.csv";
  const path = `${contentDir}/${sheet}`;
  const aliases = new Map<string, string>();
  if (!existsSync(path)) return aliases;
  const skillIds = new Set(skills.map((s) => s.id));
  const { rows, rowNumbers } = parseCsv(readFileSync(path, "utf8"));
  rows.forEach((r, i) => {
    const row = rowNumbers[i];
    if (!r.legacy_parent_name || !r.canonical_skill_id) {
      errors.push(`${sheet}!${row}: missing required field ("legacy_parent_name" or "canonical_skill_id")`);
      return;
    }
    if (!skillIds.has(r.canonical_skill_id)) {
      errors.push(`${sheet}!${row}: canonical_skill_id "${r.canonical_skill_id}" not found in skills_canonical.csv`);
      return;
    }
    aliases.set(r.legacy_parent_name.toLowerCase(), r.canonical_skill_id);
  });
  return aliases;
}

function loadSpecializations(contentDir: string, skills: Skill[], errors: string[]): Specialization[] {
  const sheet = "specializations.csv";
  const { rows, rowNumbers } = parseCsv(readFileSync(`${contentDir}/${sheet}`, "utf8"));
  const skillByLowerName = new Map(skills.map((s) => [s.name.toLowerCase(), s]));
  const skillById = new Map(skills.map((s) => [s.id, s]));
  const parentSkillAliases = loadParentSkillAliases(contentDir, skills, errors);
  const seen = new Map<string, number>();

  const out: Specialization[] = [];
  rows.forEach((r, i) => {
    const row = rowNumbers[i];
    if (seen.has(r.spec_id)) {
      errors.push(`${sheet}!${row}: duplicate id "${r.spec_id}" (first seen at row ${seen.get(r.spec_id)})`);
    } else {
      seen.set(r.spec_id, row);
    }

    // Case-insensitive match only (e.g. catches nothing here currently beyond casing) —
    // an abbreviated/renamed name ("Heavy Armor" vs "Full Armor Handling") is a real
    // rename, not a casing issue, and is reported rather than guessed at, UNLESS it's
    // a confirmed alias above.
    let parent = skillByLowerName.get(r.parent_skill.toLowerCase());
    const aliasId = parentSkillAliases.get(r.parent_skill.toLowerCase());
    if (!parent && aliasId) {
      parent = skillById.get(aliasId);
      errors.push(
        `${sheet}!${row}: parent_skill "${r.parent_skill}" resolved via import alias to "${aliasId}" — legacy display name, re-point the CSV to the canonical name when convenient`,
      );
    }
    if (!parent) {
      errors.push(`${sheet}!${row}: parent_skill "${r.parent_skill}" not found in skills_canonical.csv (needs re-pointing — not patched automatically)`);
      return;
    }

    const gateMatch = r.gate.match(/(\d+)/);
    if (!gateMatch) {
      errors.push(`${sheet}!${row}: gate "${r.gate}" has no parseable level`);
      return;
    }

    out.push({
      id: r.spec_id,
      name: r.name,
      parent_skill_id: parent.id,
      attribute: normalizeAttribute(r.attribute, sheet, row, errors),
      kind: (r.type.toUpperCase() as "CORE" | "SUPPORT"),
      gate_level: Number(gateMatch[1]),
      rarity: "COMMON", // not present in the source; mechanical default per plan decision
      description: r.description,
    });
  });

  return out;
}

function loadSkillLevelTable(contentDir: string, errors: string[]): SkillLevelRow[] {
  const sheet = "skill_level_table.csv";
  const { rows, rowNumbers } = parseCsv(readFileSync(`${contentDir}/${sheet}`, "utf8"));
  const validKnowledgeTiers = new Set(["CORE", "ADVANCED", "SUPERIOR", "APEX"]);

  return rows.map((r, i) => {
    const row = rowNumbers[i];
    if (!validKnowledgeTiers.has(r.knowledge_tier)) {
      errors.push(`${sheet}!${row}: unknown knowledge_tier "${r.knowledge_tier}"`);
    }
    return {
      level: parseRequiredNumber(r.level, "level", sheet, row, errors),
      success_tn: parseOptionalNumber(r.success_tn),
      great_tn: parseOptionalNumber(r.great_tn),
      epic_tn: parseOptionalNumber(r.epic_tn),
      heroic_tn: parseOptionalNumber(r.heroic_tn),
      explosion_gate: parseRequiredNumber(r.explosion_gate, "explosion_gate", sheet, row, errors),
      effect_bonus: parseOptionalString(r.effect_bonus),
      dice_pool: parseOptionalNumber(r.dice_pool),
      unlock: parseOptionalString(r.unlock),
      cp_cost: parseRequiredNumber(r.cp_cost, "cp_cost", sheet, row, errors),
      cp_cost_accum: parseRequiredNumber(r.cp_accum, "cp_accum", sheet, row, errors),
      mastery_label: parseOptionalString(r.mastery_label),
      cp_cost_mastery: parseRequiredNumber(r.cp_cost_mastery, "cp_cost_mastery", sheet, row, errors),
      cp_accum_mastery: parseRequiredNumber(r.cp_accum_mastery, "cp_accum_mastery", sheet, row, errors),
      knowledge_tier: r.knowledge_tier as SkillLevelRow["knowledge_tier"],
    };
  });
}

function loadAttributes(contentDir: string): { id: AttributeId; name: string; verbs: string[] }[] {
  const sheet = "attribute_verbs.csv";
  const { rows } = parseCsv(readFileSync(`${contentDir}/${sheet}`, "utf8"));
  const byId = new Map<string, { id: AttributeId; name: string; verbs: string[] }>();
  for (const r of rows) {
    const entry = byId.get(r.attribute_id) ?? { id: r.attribute_id as AttributeId, name: r.attribute, verbs: [] };
    entry.verbs.push(r.verb);
    byId.set(r.attribute_id, entry);
  }
  return [...byId.values()];
}

export function loadReferenceData(contentDir: string): ReferenceData {
  const errors: string[] = [];
  const notes: string[] = [];
  const { skills, canonicalCsv } = loadSkills(contentDir, errors);
  const skill_groups = loadSkillGroups(contentDir, skills, canonicalCsv, errors);
  const specializations = loadSpecializations(contentDir, skills, errors);
  const skill_level_table = loadSkillLevelTable(contentDir, errors);
  const attributes = loadAttributes(contentDir);

  return { skills, skill_groups, specializations, skill_level_table, attributes, errors, notes };
}
