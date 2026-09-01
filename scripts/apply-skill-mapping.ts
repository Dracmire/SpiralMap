#!/usr/bin/env -S npx tsx
/**
 * One-time migration: apply content/legacy_skill_mapping.csv's dispositions to
 * content/legacy_feats.csv. Re-running is idempotent as long as legacy_feats.csv
 * still carries a recognizable trace of each row's origin (either the original
 * legacy skill id, or an already-substituted canonical id/compound instance target
 * that resolves cleanly against this mapping) — both shapes are handled, since the
 * corrected source file this was re-run against (2026-09-01) arrived with most
 * MAP/MAP_INSTANCE rows already pre-substituted by the author's own tooling, using
 * a different (slugged, lowercase) instance-name spelling than this mapping's own
 * `instance` column. That mismatch is corrected mechanically here (normalized-name
 * matching, not a guess) rather than by trusting either source blindly.
 *
 * legacy_skill_mapping.csv columns (v2): canonical_id/canonical_name are populated
 * only for MAP/MAP_INSTANCE rows; future_parent_id/future_parent_name only for
 * BRANCH_LATER rows. A row can't be misread as "convert now" vs "defer" anymore —
 * the v1 mapping overloaded a single canonical_id column for both meanings, which
 * caused BRANCH_LATER rows to get silently materialized in one of the source
 * regenerations upstream. Fixed at the source; this script no longer needs a
 * "which meaning does canonical_id have here" check, since only one is ever set.
 *
 * Per disposition:
 *  - MAP: authority_root_id and every SKILL_LEVEL requirement referencing this
 *    skill become canonical_id.
 *  - MAP_INSTANCE: same, plus the SKILL_LEVEL target is instance-qualified as
 *    "canonical_id.instance" — a period, not a colon: the requirement mini-syntax's
 *    own field separator IS a colon, so "craft:Woodwork:3" would parse as 4 fields
 *    and get rejected as "too many fields". (authority_root_id stays the bare
 *    canonical_id — the skill itself is the authority; the instance is part of the
 *    gating requirement, not the authority.) The instance is also recorded in a new
 *    skill_instance passthrough column, using this mapping's own authoritative
 *    spelling (e.g. "Woodwork", "Drawing/Painting") — never a slug some other tool
 *    invented.
 *  - BRANCH_LATER: moved to content/legacy_deferred.csv (future_parent_id + note
 *    kept as context for that later work) — never converted, never deleted. A row
 *    already carrying its skill's canonical id in this position (i.e. some upstream
 *    step un-deferred it) is treated as a bug and reverted: BRANCH_LATER rows are
 *    matched by the legacy_skill_id itself, and a row whose authority_root_id is
 *    already a canonical id has no legacy_skill_id left to match on, so it can't be
 *    accidentally re-deferred — but nothing in this script converts one, either.
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

/** MAP_INSTANCE rows' authoritative instance names, grouped by canonical_id — the
 * source of truth for resolving an already-substituted row's (possibly mis-slugged)
 * instance name back to the real spelling. */
const authoritativeInstancesByCanonicalId = new Map<string, string[]>();
for (const r of mapping.rows) {
  if (r.disposition !== "MAP_INSTANCE" || !r.instance) continue;
  const list = authoritativeInstancesByCanonicalId.get(r.canonical_id) ?? [];
  if (!list.includes(r.instance)) list.push(r.instance);
  authoritativeInstancesByCanonicalId.set(r.canonical_id, list);
}

/** Case/punctuation-insensitive match — "craft.woodwork" and "Woodwork" are the same
 * fact spelled two ways; "drawingpainting" and "Drawing/Painting" likewise. This is
 * normalizing formatting, not guessing at a rename (the project's standing rule). */
function normalizeInstanceKey(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function splitCompound(target: string): { skillPart: string; instanceSlug: string | null } {
  const dot = target.indexOf(".");
  return dot === -1 ? { skillPart: target, instanceSlug: null } : { skillPart: target.slice(0, dot), instanceSlug: target.slice(dot + 1) };
}

const keptRows: CsvRow[] = [];
const deferredRows: CsvRow[] = [];
const discarded: string[] = [];
const mapApplied: string[] = [];
const instanceNormalized: string[] = [];
const issues: string[] = [];

/**
 * Resolves one SKILL_LEVEL target (bare or "skill.instance") to its final form.
 * Returns null when the target can't be resolved and should be left as authored
 * (with an issue logged) — never silently dropped or invented.
 */
function resolveTarget(target: string, rowId: string): string | null {
  const { skillPart, instanceSlug } = splitCompound(target);
  const map = mappingById.get(skillPart);

  if (map) {
    if (map.disposition === "MAP") return map.canonical_id;
    if (map.disposition === "MAP_INSTANCE") return `${map.canonical_id}.${map.instance}`;
    // BRANCH_LATER / DISCARD referenced from a requirement (not this row's own
    // authority) — no single-row action is correct here; a human has to decide
    // whether that clause still makes sense once its skill actually lands.
    issues.push(`${rowId}: requirement targets "${skillPart}" which is ${map.disposition} — left unresolved, needs a human decision`);
    return target;
  }

  if (instanceSlug === null) return target; // already a bare canonical (or unrelated) id — nothing to do

  const candidates = authoritativeInstancesByCanonicalId.get(skillPart) ?? [];
  const match = candidates.find((inst) => normalizeInstanceKey(inst) === normalizeInstanceKey(instanceSlug));
  if (!match) {
    issues.push(`${rowId}: could not resolve instance "${instanceSlug}" for skill "${skillPart}" against known instances [${candidates.join(", ")}] — left as authored`);
    return target;
  }
  if (match !== instanceSlug) instanceNormalized.push(`${rowId}: "${target}" -> "${skillPart}.${match}"`);
  return `${skillPart}.${match}`;
}

function rewriteRequirements(requirementsField: string, rowId: string): string | null {
  const { value: reqs, errors } = parseRequirements(requirementsField ?? "");
  if (errors.length > 0) {
    issues.push(`${rowId}: could not parse requirements "${requirementsField}" (${errors.join("; ")}) — left unchanged`);
    return null;
  }
  const rewritten = reqs.map((req) => {
    if (req.type !== "SKILL_LEVEL") return `${req.type}:${req.target}${req.threshold !== null ? `:${req.threshold}` : ""}`;
    const resolved = resolveTarget(req.target, rowId) ?? req.target;
    return `SKILL_LEVEL:${resolved}:${req.threshold}`;
  });
  return rewritten.join(";");
}

for (const r of feats.rows) {
  if (r.authority_root_type !== "SKILL") {
    keptRows.push(r); // ATTRIBUTE-rooted VERB feats — not in the mapping, untouched
    continue;
  }

  const { skillPart, instanceSlug } = splitCompound(r.authority_root_id);
  const map = mappingById.get(skillPart);

  if (map) {
    switch (map.disposition) {
      case "DISCARD":
        discarded.push(`${r.id} (${r.name}) — legacy skill "${skillPart}"${map.note ? `, reason: ${map.note}` : ""}`);
        break;
      case "BRANCH_LATER":
        deferredRows.push({ ...r, future_parent_id: map.future_parent_id, note: map.note ?? "" });
        break;
      case "MAP":
      case "MAP_INSTANCE": {
        const canonicalId = map.canonical_id;
        const instance = map.disposition === "MAP_INSTANCE" ? map.instance : "";
        const newRequirements = rewriteRequirements(r.requirements, r.id);
        if (newRequirements === null) {
          keptRows.push(r);
          break;
        }
        keptRows.push({ ...r, authority_root_id: canonicalId, requirements: newRequirements, skill_instance: instance });
        mapApplied.push(`${r.id}: ${skillPart} -> ${canonicalId}${instance ? `.${instance}` : ""}`);
        break;
      }
      default:
        issues.push(`${r.id}: unknown disposition "${map.disposition}" in legacy_skill_mapping.csv — left unchanged`);
        keptRows.push(r);
    }
    continue;
  }

  // Not a legacy id: already at (or past) its final canonical form. Still worth a
  // pass — the instance segment may be mis-slugged, and authority_root_id must stay
  // bare (the instance belongs on the gating requirement, not the authority).
  const newRequirements = rewriteRequirements(r.requirements, r.id);
  if (newRequirements === null) {
    keptRows.push(r);
    continue;
  }
  if (instanceSlug === null) {
    keptRows.push({ ...r, requirements: newRequirements, skill_instance: r.skill_instance ?? "" });
  } else {
    const candidates = authoritativeInstancesByCanonicalId.get(skillPart) ?? [];
    const match = candidates.find((inst) => normalizeInstanceKey(inst) === normalizeInstanceKey(instanceSlug));
    if (!match) {
      issues.push(`${r.id}: could not resolve instance "${instanceSlug}" for skill "${skillPart}" against known instances [${candidates.join(", ")}] — authority_root_id left as authored`);
      keptRows.push({ ...r, requirements: newRequirements });
    } else {
      if (match !== instanceSlug) instanceNormalized.push(`${r.id} (authority): "${r.authority_root_id}" -> "${skillPart}.${match}"`);
      keptRows.push({ ...r, authority_root_id: skillPart, requirements: newRequirements, skill_instance: match });
    }
  }
}

const header = feats.header.includes("skill_instance") ? feats.header : [...feats.header, "skill_instance"];
writeFileSync(`${CONTENT_DIR}/legacy_feats.csv`, stringifyCsv(header, keptRows));

if (deferredRows.length > 0) {
  const deferredHeader = [...feats.header, "future_parent_id", "note"];
  writeFileSync(`${CONTENT_DIR}/legacy_deferred.csv`, stringifyCsv(deferredHeader, deferredRows));
}

console.log(`\nlegacy_feats.csv: ${feats.rows.length} rows in -> ${keptRows.length} rows out.`);
console.log(`  MAP/MAP_INSTANCE applied (legacy id -> canonical): ${mapApplied.length}`);
mapApplied.forEach((m) => console.log(`    - ${m}`));
console.log(`  Instance names normalized (already-canonical rows): ${instanceNormalized.length}`);
instanceNormalized.forEach((m) => console.log(`    - ${m}`));
console.log(`  Deferred to content/legacy_deferred.csv (BRANCH_LATER): ${deferredRows.length}`);
console.log(`  Discarded: ${discarded.length}`);
discarded.forEach((d) => console.log(`    - ${d}`));
if (issues.length > 0) {
  console.log(`  Issues (${issues.length}):`);
  issues.forEach((i) => console.log(`    - ${i}`));
}
