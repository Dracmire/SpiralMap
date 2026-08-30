#!/usr/bin/env -S npx tsx
/**
 * Produces content/skill_reconciliation.csv — a worklist, not a fix. The legacy
 * skill ids referenced by content/legacy_feats.csv don't match content/skills.csv's
 * real skill ids (real drift, e.g. "Heavy Weapons Handling" vs "Melee Weapons"), so
 * this reports a string-similarity HINT for each one and leaves `resolved_id` blank.
 * Nothing here is auto-applied — the human decides whether a legacy skill is the
 * same as a reference skill, a specialization of it, or genuinely something new.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { parseCsv, stringifyCsv } from "./lib/csv.ts";
import { parseRequirements } from "./lib/parsers.ts";
import { deslug, bestMatch } from "./lib/text.ts";

const CONTENT_DIR = "content";

const legacyFeats = parseCsv(readFileSync(`${CONTENT_DIR}/legacy_feats.csv`, "utf8"));
const skills = parseCsv(readFileSync(`${CONTENT_DIR}/skills.csv`, "utf8"));
const referenceNames = skills.rows.map((r) => r.name);

const occurrences = new Map<string, number>();

for (const r of legacyFeats.rows) {
  const idsThisRow = new Set<string>();

  if (r.authority_root_type === "SKILL" && r.authority_root_id) {
    idsThisRow.add(r.authority_root_id);
  }
  const { value: requirements } = parseRequirements(r.requirements ?? "");
  for (const req of requirements) {
    if (req.type === "SKILL_LEVEL") idsThisRow.add(req.target);
  }

  for (const id of idsThisRow) {
    occurrences.set(id, (occurrences.get(id) ?? 0) + 1);
  }
}

const rows = [...occurrences.entries()]
  .map(([legacy_skill_id, occ]) => {
    const legacy_skill_name = deslug(legacy_skill_id);
    const match = bestMatch(legacy_skill_name, referenceNames);
    return {
      legacy_skill_id,
      legacy_skill_name,
      occurrences: String(occ),
      closest_reference_match: match?.candidate ?? "",
      similarity: match ? match.similarity.toFixed(3) : "",
      resolved_id: "",
    };
  })
  .sort((a, b) => Number(b.occurrences) - Number(a.occurrences) || a.legacy_skill_id.localeCompare(b.legacy_skill_id));

const header = ["legacy_skill_id", "legacy_skill_name", "occurrences", "closest_reference_match", "similarity", "resolved_id"];
writeFileSync(`${CONTENT_DIR}/skill_reconciliation.csv`, stringifyCsv(header, rows));

console.log(`content/skill_reconciliation.csv written: ${rows.length} distinct legacy skill ids (against ${referenceNames.length} reference skills).`);
const exactOrNear = rows.filter((r) => Number(r.similarity) >= 0.9).length;
const noGoodMatch = rows.filter((r) => Number(r.similarity) < 0.5).length;
console.log(`  ${exactOrNear} with similarity >= 0.9 (likely the same skill, still needs human confirmation).`);
console.log(`  ${noGoodMatch} with similarity < 0.5 (probably a genuinely new/renamed skill, not in skills.csv at all).`);
console.log(`  resolved_id is blank on every row — nothing is auto-applied.`);
