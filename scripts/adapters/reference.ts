/**
 * Column-mapping adapters for the reference CSVs (skills.csv, specializations.csv,
 * skill_groups.csv, group_skill_map.csv, attribute_verbs.csv, skill_level_table.csv)
 * that predate authoring-columns.md's conventions. Kept separate from convert.ts's
 * authoring-rule logic (the 10 validation rules) since these sheets follow their own,
 * older column layout — see docs/authoring-columns.md's "Reference sheets" section.
 *
 * Known, deliberately-not-silently-fixed data issues (reported as errors, not
 * corrected in place — see the plan's decision 3): `CAR` used interchangeably with
 * `CHA` as an attribute code (normalized to CHA for the emitted JSON so `attribute`
 * stays a valid AttributeId, but every occurrence is still reported); a `Wilderness`
 * skill referenced by group_skill_map.csv that doesn't exist in skills.csv.
 */

import { readFileSync } from "node:fs";
import { parseCsv } from "../lib/csv.ts";
import type { AttributeId, Skill, SkillGroup, Specialization, SkillLevelRow } from "../../schema/spiral.ts";

export interface ReferenceData {
  skills: Skill[];
  skill_groups: SkillGroup[];
  specializations: Specialization[];
  skill_level_table: SkillLevelRow[];
  attributes: { id: AttributeId; name: string; verbs: string[] }[];
  errors: string[];
}

const VALID_ATTRIBUTE_IDS: ReadonlySet<string> = new Set(["STR", "AGI", "INT", "PER", "WIL", "CHA"]);

/** skills.csv uses CAR interchangeably with CHA — normalize so `attribute` stays valid, but always report it. */
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

function loadSkills(contentDir: string, errors: string[]): Skill[] {
  const sheet = "skills.csv";
  const { rows, rowNumbers } = parseCsv(readFileSync(`${contentDir}/${sheet}`, "utf8"));
  const seen = new Map<string, number>();
  return rows.map((r, i) => {
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
      kind: (r.type.toUpperCase() as "CORE" | "SUPPORT"),
      is_parameterized: /Knowledge|Perform/i.test(r.name),
      instances: [],
      group_ids: [], // filled in by loadSkillGroups
      description: r.description,
    };
  });
}

function loadSkillGroups(
  contentDir: string,
  skills: Skill[],
  errors: string[],
): SkillGroup[] {
  const groupsSheet = "skill_groups.csv";
  const mapSheet = "group_skill_map.csv";
  const groupsCsv = parseCsv(readFileSync(`${contentDir}/${groupsSheet}`, "utf8"));
  const mapCsv = parseCsv(readFileSync(`${contentDir}/${mapSheet}`, "utf8"));

  const skillByName = new Map(skills.map((s) => [s.name, s]));
  const memberIdsByGroupName = new Map<string, string[]>();

  mapCsv.rows.forEach((r, i) => {
    const row = mapCsv.rowNumbers[i];
    const skill = skillByName.get(r.skill);
    if (!skill) {
      errors.push(`${mapSheet}!${row}: skill "${r.skill}" (group "${r.group}") not found in skills.csv`);
      return;
    }
    skill.group_ids.push(""); // placeholder, replaced with real group id below once known
    const list = memberIdsByGroupName.get(r.group) ?? [];
    list.push(skill.id);
    memberIdsByGroupName.set(r.group, list);
  });

  const groups: SkillGroup[] = groupsCsv.rows.map((r, i) => {
    const row = groupsCsv.rowNumbers[i];
    const memberIds = memberIdsByGroupName.get(r.name) ?? [];
    if (memberIds.length === 0) {
      errors.push(`${groupsSheet}!${row}: group "${r.name}" has no resolved members in group_skill_map.csv`);
    }
    for (const skillId of memberIds) {
      const skill = skills.find((s) => s.id === skillId);
      if (skill && !skill.group_ids.includes(r.group_id)) skill.group_ids.push(r.group_id);
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

  // Clean up the placeholder empty-string entries pushed above.
  for (const skill of skills) skill.group_ids = skill.group_ids.filter((id) => id !== "");

  return groups;
}

function loadSpecializations(contentDir: string, skills: Skill[], errors: string[]): Specialization[] {
  const sheet = "specializations.csv";
  const { rows, rowNumbers } = parseCsv(readFileSync(`${contentDir}/${sheet}`, "utf8"));
  const skillByName = new Map(skills.map((s) => [s.name, s]));
  const seen = new Map<string, number>();

  const out: Specialization[] = [];
  rows.forEach((r, i) => {
    const row = rowNumbers[i];
    if (seen.has(r.spec_id)) {
      errors.push(`${sheet}!${row}: duplicate id "${r.spec_id}" (first seen at row ${seen.get(r.spec_id)})`);
    } else {
      seen.set(r.spec_id, row);
    }

    const parent = skillByName.get(r.parent_skill);
    if (!parent) {
      errors.push(`${sheet}!${row}: parent_skill "${r.parent_skill}" not found in skills.csv`);
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
  const skills = loadSkills(contentDir, errors);
  const skill_groups = loadSkillGroups(contentDir, skills, errors);
  const specializations = loadSpecializations(contentDir, skills, errors);
  const skill_level_table = loadSkillLevelTable(contentDir, errors);
  const attributes = loadAttributes(contentDir);

  return { skills, skill_groups, specializations, skill_level_table, attributes, errors };
}
