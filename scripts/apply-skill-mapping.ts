#!/usr/bin/env -S npx tsx
/**
 * One-time migration: apply content/legacy_skill_mapping.csv's dispositions to
 * content/legacy_feats.csv. Run once — re-running is not idempotent (mapped rows'
 * authority_root_id/requirements now point at canonical ids, which generally
 * aren't themselves keys in legacy_skill_mapping.csv, so a second run would just
 * report them as unmapped rather than re-transforming them).
 *
 * Per disposition:
 *  - MAP: authority_root_id and the SKILL_LEVEL requirement target become canonical_id.
 *  - MAP_INSTANCE: same, plus the SKILL_LEVEL target is instance-qualified as
 *    "canonical_id.instance" — a period, not a colon: the requirement mini-syntax's
 *    own field separator IS a colon, so "craft:Woodwork:3" would parse as 4 fields
 *    and get rejected as "too many fields". None of the authored instance names
 *    contain a period. (authority_root_id stays the bare canonical_id — the skill
 *    itself is the authority; the instance is part of the gating requirement, not
 *    the authority.) The instance is also recorded in a new skill_instance
 *    passthrough column.
 *  - BRANCH_LATER: moved to content/legacy_deferred.csv (canonical_id + note kept
 *    as their future parent/context) — never deleted, never converted.
 *  - DISCARD: dropped, logged.
 *
 * ATTRIBUTE-rooted (VERB) feats aren't in the mapping at all — left untouched.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { parseCsv, stringifyCsv, type CsvRow } from "./lib/csv.ts";
import { parseRequirements } from "./lib/parsers.ts";

const CONTENT_DIR = "content";

const feats = parseCsv(readFileSync(`${CONTENT_DIR}/legacy_feats.csv`, "utf8"));
const mapping = parseCsv(readFileSync(`${CONTENT_DIR}/legacy_skill_mapping.csv`, "utf8"));
const mappingById = new Map(mapping.rows.map((r) => [r.legacy_skill_id, r]));

const keptRows: CsvRow[] = [];
const deferredRows: CsvRow[] = [];
const discarded: string[] = [];
const mapInstanceApplied: string[] = [];
const issues: string[] = [];

/**
 * Rewrites every SKILL_LEVEL requirement on the row, not just the one matching
 * the row's own authority skill (legacyId/primaryNewTarget) — a row can carry a
 * SECONDARY SKILL_LEVEL requirement against a *different* legacy skill (e.g. an
 * "and also requires Craft 3" clause on a feat authority-rooted elsewhere). Each
 * SKILL_LEVEL target is looked up independently in mappingById and rewritten per
 * its own disposition; MAP/MAP_INSTANCE rewrite the target, DISCARD/BRANCH_LATER
 * targets are left as-is (flagged) since there's no single-row action to take on
 * a secondary reference into a discarded/deferred skill — that's a genuine gap
 * for a human to resolve, not something this migration can silently patch.
 */
function rewriteRequirementTarget(requirementsField: string, rowId: string, legacyId: string, newTarget: string): string | null {
  const { value: reqs, errors } = parseRequirements(requirementsField ?? "");
  if (errors.length > 0) {
    issues.push(`${rowId}: could not parse requirements "${requirementsField}" (${errors.join("; ")}) — left unchanged`);
    return null;
  }
  const rewritten = reqs.map((req) => {
    if (req.type !== "SKILL_LEVEL") {
      return `${req.type}:${req.target}${req.threshold !== null ? `:${req.threshold}` : ""}`;
    }
    if (req.target === legacyId) {
      return `SKILL_LEVEL:${newTarget}:${req.threshold}`;
    }
    // A secondary SKILL_LEVEL requirement targeting some other legacy skill id.
    const secondaryMap = mappingById.get(req.target);
    if (!secondaryMap) {
      // Not a legacy skill id at all (already canonical, or unrelated) — leave as-is.
      return `SKILL_LEVEL:${req.target}:${req.threshold}`;
    }
    if (secondaryMap.disposition === "MAP" || secondaryMap.disposition === "MAP_INSTANCE") {
      const secondaryInstance = secondaryMap.disposition === "MAP_INSTANCE" ? secondaryMap.instance : "";
      const secondaryTarget = secondaryInstance ? `${secondaryMap.canonical_id}.${secondaryInstance}` : secondaryMap.canonical_id;
      issues.push(`${rowId}: secondary SKILL_LEVEL requirement "${req.target}" -> "${secondaryTarget}" (via ${secondaryMap.disposition})`);
      return `SKILL_LEVEL:${secondaryTarget}:${req.threshold}`;
    }
    issues.push(`${rowId}: secondary SKILL_LEVEL requirement targets "${req.target}" which is ${secondaryMap.disposition} — left unresolved, needs a human decision`);
    return `SKILL_LEVEL:${req.target}:${req.threshold}`;
  });
  return rewritten.join(";");
}

for (const r of feats.rows) {
  if (r.authority_root_type !== "SKILL") {
    keptRows.push(r); // ATTRIBUTE-rooted VERB feats — not in the mapping, untouched
    continue;
  }

  const legacyId = r.authority_root_id;
  const map = mappingById.get(legacyId);
  if (!map) {
    issues.push(`${r.id}: skill "${legacyId}" not found in legacy_skill_mapping.csv — left unchanged`);
    keptRows.push(r);
    continue;
  }

  switch (map.disposition) {
    case "DISCARD":
      discarded.push(`${r.id} (${r.name}) — legacy skill "${legacyId}"${map.note ? `, reason: ${map.note}` : ""}`);
      break;

    case "BRANCH_LATER":
      deferredRows.push({ ...r, canonical_id: map.canonical_id, note: map.note ?? "" });
      break;

    case "MAP":
    case "MAP_INSTANCE": {
      const canonicalId = map.canonical_id;
      const instance = map.disposition === "MAP_INSTANCE" ? map.instance : "";
      const skillLevelTarget = instance ? `${canonicalId}.${instance}` : canonicalId;

      const newRequirements = rewriteRequirementTarget(r.requirements, r.id, legacyId, skillLevelTarget);
      if (newRequirements === null) {
        keptRows.push(r);
        break;
      }

      keptRows.push({
        ...r,
        authority_root_id: canonicalId,
        requirements: newRequirements,
        skill_instance: instance,
      });
      if (map.disposition === "MAP_INSTANCE") mapInstanceApplied.push(`${r.id} -> ${skillLevelTarget}`);
      break;
    }

    default:
      issues.push(`${r.id}: unknown disposition "${map.disposition}" in legacy_skill_mapping.csv — left unchanged`);
      keptRows.push(r);
  }
}

const header = feats.header.includes("skill_instance") ? feats.header : [...feats.header, "skill_instance"];
writeFileSync(`${CONTENT_DIR}/legacy_feats.csv`, stringifyCsv(header, keptRows));

if (deferredRows.length > 0) {
  const deferredHeader = [...feats.header, "canonical_id", "note"];
  writeFileSync(`${CONTENT_DIR}/legacy_deferred.csv`, stringifyCsv(deferredHeader, deferredRows));
}

console.log(`\nlegacy_feats.csv: ${feats.rows.length} rows in -> ${keptRows.length} rows out.`);
console.log(`  MAP_INSTANCE applied: ${mapInstanceApplied.length}`);
mapInstanceApplied.forEach((m) => console.log(`    - ${m}`));
console.log(`  Deferred to content/legacy_deferred.csv (BRANCH_LATER): ${deferredRows.length}`);
console.log(`  Discarded: ${discarded.length}`);
discarded.forEach((d) => console.log(`    - ${d}`));
if (issues.length > 0) {
  console.log(`  Issues (${issues.length}):`);
  issues.forEach((i) => console.log(`    - ${i}`));
}
