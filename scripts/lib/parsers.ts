/**
 * Mini-syntax parsers for the requirement/source/fusion-parent CSV columns
 * documented in docs/authoring-columns.md. Pure functions, no file I/O —
 * callers turn the returned error strings into `sheet!row: message`.
 */

import type { Requirement, RequirementType, Source, SourceType, ParentDisposition } from "../../schema/spiral.ts";

export interface ParseResult<T> {
  value: T[];
  errors: string[];
}

const BOOLEAN_REQUIREMENT_TYPES: ReadonlySet<RequirementType> = new Set(["TRAIT", "PRIOR_NODE", "CLASS"]);

const REQUIREMENT_TYPES: ReadonlySet<RequirementType> = new Set([
  "SKILL_LEVEL",
  "ATTRIBUTE",
  "ATTRIBUTE_CEILING",
  "VERB",
  "TRAIT",
  "PRIOR_NODE",
  "CLASS",
  "CLASS_TIER",
  "INSIGHT",
]);

const SOURCE_TYPES: ReadonlySet<SourceType> = new Set(["TRAINER", "TOME", "GUILD", "CLASS", "TRAIT", "BREAKTHROUGH"]);

const PARENT_DISPOSITIONS: ReadonlySet<ParentDisposition> = new Set([
  "INTEGRATED",
  "PREREQUISITE_ONLY",
  "DEFERRED_SEED",
  "REJECTED",
]);

function splitEntries(field: string): string[] {
  const trimmed = field.trim();
  if (trimmed === "") return [];
  return trimmed.split(";").map((entry) => entry.trim()).filter((entry) => entry !== "");
}

/** Requirements: `;`-separated `TYPE:target:threshold`, threshold omitted for boolean types. */
export function parseRequirements(field: string): ParseResult<Requirement> {
  const value: Requirement[] = [];
  const errors: string[] = [];

  for (const entry of splitEntries(field)) {
    const parts = entry.split(":");
    const rawType = parts[0] ?? "";

    if (!REQUIREMENT_TYPES.has(rawType as RequirementType)) {
      errors.push(`unknown requirement type "${rawType}" in "${entry}"`);
      continue;
    }
    const type = rawType as RequirementType;

    const target = parts[1];
    if (target === undefined || target === "") {
      errors.push(`requirement "${entry}" is missing a target`);
      continue;
    }

    const isBoolean = BOOLEAN_REQUIREMENT_TYPES.has(type);

    if (isBoolean) {
      if (parts.length > 2) {
        errors.push(`requirement "${entry}": ${type} is a boolean type and takes no threshold`);
        continue;
      }
      value.push({ type, target, threshold: null });
      continue;
    }

    if (parts.length < 3 || parts[2] === "") {
      errors.push(`requirement "${entry}": ${type} requires a numeric threshold`);
      continue;
    }
    if (parts.length > 3) {
      errors.push(`requirement "${entry}" has too many fields`);
      continue;
    }
    const threshold = Number(parts[2]);
    if (!Number.isFinite(threshold)) {
      errors.push(`requirement "${entry}": threshold "${parts[2]}" is not a number`);
      continue;
    }
    value.push({ type, target, threshold });
  }

  return { value, errors };
}

/** Sources: `;`-separated `TYPE:target:xp_cost:level_loss`, trailing fields optional. */
export function parseSources(field: string): ParseResult<Source> {
  const value: Source[] = [];
  const errors: string[] = [];

  for (const entry of splitEntries(field)) {
    const parts = entry.split(":");
    const rawType = parts[0] ?? "";

    if (!SOURCE_TYPES.has(rawType as SourceType)) {
      errors.push(`unknown source type "${rawType}" in "${entry}"`);
      continue;
    }
    const type = rawType as SourceType;

    if (parts.length > 4) {
      errors.push(`source "${entry}" has too many fields`);
      continue;
    }

    const rawTarget = parts[1];
    const target = rawTarget === undefined || rawTarget === "" ? null : rawTarget;

    let xp_cost: number | null = null;
    const rawXp = parts[2];
    if (rawXp !== undefined && rawXp !== "") {
      const parsed = Number(rawXp);
      if (!Number.isFinite(parsed)) {
        errors.push(`source "${entry}": xp_cost "${rawXp}" is not a number`);
        continue;
      }
      xp_cost = parsed;
    }

    let level_loss: number | null = null;
    const rawLevelLoss = parts[3];
    if (rawLevelLoss !== undefined && rawLevelLoss !== "") {
      const parsed = Number(rawLevelLoss);
      if (!Number.isFinite(parsed)) {
        errors.push(`source "${entry}": level_loss "${rawLevelLoss}" is not a number`);
        continue;
      }
      level_loss = parsed;
    }

    value.push({ type, target, xp_cost, level_loss });
  }

  return { value, errors };
}

/** Fusion parents: `;`-separated `feat_id:DISPOSITION`. */
export function parseFusionParents(field: string): ParseResult<{ feat_id: string; disposition: ParentDisposition }> {
  const value: { feat_id: string; disposition: ParentDisposition }[] = [];
  const errors: string[] = [];

  for (const entry of splitEntries(field)) {
    const parts = entry.split(":");
    if (parts.length !== 2) {
      errors.push(`fusion parent "${entry}" must be "feat_id:DISPOSITION"`);
      continue;
    }
    const [feat_id, rawDisposition] = parts;
    if (feat_id === "") {
      errors.push(`fusion parent "${entry}" is missing a feat id`);
      continue;
    }
    if (!PARENT_DISPOSITIONS.has(rawDisposition as ParentDisposition)) {
      errors.push(`fusion parent "${entry}": unknown disposition "${rawDisposition}"`);
      continue;
    }
    value.push({ feat_id, disposition: rawDisposition as ParentDisposition });
  }

  return { value, errors };
}
