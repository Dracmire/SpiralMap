#!/usr/bin/env -S npx tsx
/**
 * CSV -> data/dataset.json converter.
 *
 * Reads content/*.csv, validates against the 10 rules in docs/authoring-columns.md
 * (plus a base layer of required-column checks the rules assume, and one extra
 * decision-14 sanity check — see the plan), computes derived_tier/is_anti_perk,
 * and always writes data/dataset.json (with a non-schema `_valid` flag) even when
 * validation fails, so a partial/failing run stays inspectable.
 *
 * perks.csv/legacy_perks.csv and feats.csv/legacy_feats.csv are each treated as one
 * combined pool — validated and merged together — while errors keep citing the real
 * source sheet. legacy_*.csv rows also carry non-schema passthrough provenance
 * (subject_suggested/family_suggested on perks; skill_group/block on feats) that is
 * kept on the emitted objects but never validated.
 *
 * Usage: tsx scripts/convert.ts [--strict-ladder] [--draft]
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { parseCsv, stringifyCsv, type CsvRow } from "./lib/csv.ts";
import { parseRequirements, parseSources, parseFusionParents } from "./lib/parsers.ts";
import { maxTier, skillLevelToTier } from "./lib/tier.ts";
import { loadReferenceData } from "./adapters/reference.ts";
import type {
  Perk,
  Feat,
  Fusion,
  Requirement,
  Tier,
  EffectFamily,
  SpiralDataset,
  EffectLadderStep,
} from "../schema/spiral.ts";

const CONTENT_DIR = "content";
const DATA_DIR = "data";
const STRICT_LADDER = process.argv.includes("--strict-ladder");
const DRAFT = process.argv.includes("--draft");

// Sheets whose unresolved SKILL_LEVEL/authority_root skill references are expected
// authoring backlog (pending content/skill_reconciliation.csv), not a defect.
const LEGACY_SHEETS = new Set(["legacy_perks.csv", "legacy_feats.csv"]);

const errors: string[] = [];
const warnings: string[] = [];
const notes: string[] = []; // informational (e.g. derived_tier skips) — never affects exit code

function err(sheet: string, row: number | string, message: string) {
  errors.push(`${sheet}!${row}: ${message}`);
}
function warn(sheet: string, row: number | string, message: string) {
  warnings.push(`${sheet}!${row}: ${message}`);
}
type Sink = (sheet: string, row: number | string, message: string) => void;

/** --draft downgrades blank subject/family/boundary (any sheet) and unresolved
 * legacy skill references to warnings. Everything else stays an error. */
function draftSink(category: "subject" | "family" | "boundary" | "skill_ref", sheet: string): Sink {
  if (!DRAFT) return err;
  if (category === "subject" || category === "family" || category === "boundary") return warn;
  if (category === "skill_ref" && LEGACY_SHEETS.has(sheet)) return warn;
  return err;
}

// ─────────────────────────────────────────────────────────────
// Load raw CSVs
// ─────────────────────────────────────────────────────────────

interface SheetData {
  sheet: string;
  header: string[];
  rows: CsvRow[];
  rowNumbers: number[];
}

function readCsvIfExists(sheet: string): SheetData {
  const path = `${CONTENT_DIR}/${sheet}`;
  if (!existsSync(path)) return { sheet, header: [], rows: [], rowNumbers: [] };
  const { header, rows, rowNumbers } = parseCsv(readFileSync(path, "utf8"));
  return { sheet, header, rows, rowNumbers };
}

/** Iterate every row across a set of sheets, sheet/row already attached to each entry. */
function eachRow(sheets: SheetData[], fn: (r: CsvRow, sheet: string, row: number) => void) {
  for (const s of sheets) s.rows.forEach((r, i) => fn(r, s.sheet, s.rowNumbers[i]));
}

const perksMain = readCsvIfExists("perks.csv");
const perksLegacy = readCsvIfExists("legacy_perks.csv");
const perkSheets = [perksMain, perksLegacy];

const featsMain = readCsvIfExists("feats.csv");
const featsLegacy = readCsvIfExists("legacy_feats.csv");
const featSheets = [featsMain, featsLegacy];

const fusionsCsv = readCsvIfExists("fusions.csv");
const subjectsCsv = readCsvIfExists("subjects.csv"); // NOT subjects.proposed.csv — that's never authoritative
const ladderCsv = readCsvIfExists("effect_ladder.csv");
const ladderFileExists = existsSync(`${CONTENT_DIR}/effect_ladder.csv`);

if (perksMain.rows.length === 0 && !existsSync(`${CONTENT_DIR}/perks.csv`)) {
  notes.push(`content/perks.csv not found — run scripts/extract-anti.ts first, or author it by hand.`);
}
if (existsSync(`${CONTENT_DIR}/legacy_quarantine.csv`)) {
  notes.push(`content/legacy_quarantine.csv is present and, per spec, was NOT read — it is a worklist, never an input.`);
}

// derived_tier / is_anti_perk must never be authored columns (task requirement 4 / plan decision 11)
for (const s of [...featSheets, fusionsCsv]) {
  if (s.header.length === 0) continue;
  if (s.header.includes("derived_tier")) {
    err(s.sheet, "header", `column "derived_tier" must not be authored — the converter computes it`);
  }
  if (s.header.includes("is_anti_perk")) {
    err(s.sheet, "header", `column "is_anti_perk" must not be authored — the converter computes it`);
  }
}

// ─────────────────────────────────────────────────────────────
// Base layer: required-column presence
// (boundary is owned by rule 8, subject is owned by rule 2 — not duplicated here)
// ─────────────────────────────────────────────────────────────

function requireField(sink: Sink, sheet: string, row: number, r: CsvRow, field: string) {
  if (!r[field] || r[field].trim() === "") {
    sink(sheet, row, `missing required field "${field}"`);
  }
}

// Only FLAT_BONUS and THRESHOLD grant a stackable numeric value. COVERAGE (set union,
// not a sum), PERMISSION and RELIABILITY (no value at all), and SUBSTITUTION (you either
// substitute or you don't) never need bonus_category/bonus_type.
const NUMERIC_FAMILIES = new Set(["FLAT_BONUS", "THRESHOLD"]);

eachRow(perkSheets, (r, sheet, row) => {
  for (const f of ["id", "name", "tier", "text"]) requireField(err, sheet, row, r, f);
  requireField(draftSink("family", sheet), sheet, row, r, "family");
  if (r.family && NUMERIC_FAMILIES.has(r.family)) {
    requireField(err, sheet, row, r, "bonus_category");
    requireField(err, sheet, row, r, "bonus_type");
  }
});

function requireFeatColumns(sheets: SheetData[]) {
  eachRow(sheets, (r, sheet, row) => {
    for (const f of ["id", "name", "perk_ids", "job", "authority_root_type", "authority_root_id", "rarity", "cp_cost"]) {
      requireField(err, sheet, row, r, f);
    }
  });
}
requireFeatColumns(featSheets);
requireFeatColumns([fusionsCsv]);

fusionsCsv.rows.forEach((r, i) => {
  const row = fusionsCsv.rowNumbers[i];
  requireField(err, "fusions.csv", row, r, "operator");
  requireField(err, "fusions.csv", row, r, "parents");
});

if (existsSync(`${CONTENT_DIR}/subjects.csv`)) {
  subjectsCsv.rows.forEach((r, i) => {
    const row = subjectsCsv.rowNumbers[i];
    for (const f of ["id", "name", "category"]) requireField(err, "subjects.csv", row, r, f);
  });
}

if (ladderFileExists) {
  ladderCsv.rows.forEach((r, i) => {
    const row = ladderCsv.rowNumbers[i];
    for (const f of ["family", "tier"]) requireField(err, "effect_ladder.csv", row, r, f);
  });
}

// ─────────────────────────────────────────────────────────────
// Base layer: closed-set/enum validity (a non-blank value that isn't one of the
// declared options is exactly the kind of authoring mistake this converter exists
// to catch — presence alone, checked above, isn't enough).
// ─────────────────────────────────────────────────────────────

const FAMILIES = new Set(["FLAT_BONUS", "RELIABILITY", "COVERAGE", "THRESHOLD", "PERMISSION", "SUBSTITUTION"]);
const TIERS = new Set(["ENTRY", "INTERMEDIATE", "ADVANCED", "EXPERT", "MASTER"]);
const RARITIES = new Set(["COMMON", "UNCOMMON", "RARE", "SUPERNATURAL"]);
const AUTHORITY_ROOT_TYPES = new Set(["SKILL", "CLASS_FEATURE", "TRAIT", "ATTRIBUTE"]);
const FUSION_OPERATORS = new Set(["COMPRESSION", "NUMERICAL_PROGRESSION", "FEATURE_PROGRESSION", "TRANSFORMATIVE_CONVERSION", "GLUE"]);
const FEAT_JOBS = new Set(["PROGRESS", "GLUE", "SIMPLIFICATION"]);
const BONUS_CATEGORIES = new Set(["ABILITY", "CIRCUMSTANTIAL", "TECHNIQUE", "ENVIRONMENTAL"]);
const BONUS_TYPES = new Set([
  "TRAINING", "TERRAIN", "ARMOR", "DODGE", "MAGIC", "MORALE", "SIZE", "NATURAL", "EQUIPMENT", "REPUTATION",
]);

function checkEnum(sheet: string, row: number, field: string, value: string, allowed: ReadonlySet<string>) {
  if (value && !allowed.has(value)) err(sheet, row, `${field} "${value}" is not one of: ${[...allowed].join(" / ")}`);
}

eachRow(perkSheets, (r, sheet, row) => {
  checkEnum(sheet, row, "family", r.family, FAMILIES);
  checkEnum(sheet, row, "tier", r.tier, TIERS);
  if (r.bonus_category) checkEnum(sheet, row, "bonus_category", r.bonus_category, BONUS_CATEGORIES);
  if (r.bonus_type) checkEnum(sheet, row, "bonus_type", r.bonus_type, BONUS_TYPES);
});

function checkFeatEnums(sheets: SheetData[]) {
  eachRow(sheets, (r, sheet, row) => {
    checkEnum(sheet, row, "rarity", r.rarity, RARITIES);
    checkEnum(sheet, row, "authority_root_type", r.authority_root_type, AUTHORITY_ROOT_TYPES);
    for (const j of (r.job ?? "").split(";").map((s) => s.trim()).filter((s) => s !== "")) {
      checkEnum(sheet, row, "job", j, FEAT_JOBS);
    }
  });
}
checkFeatEnums(featSheets);
checkFeatEnums([fusionsCsv]);

fusionsCsv.rows.forEach((r, i) => {
  checkEnum("fusions.csv", fusionsCsv.rowNumbers[i], "operator", r.operator, FUSION_OPERATORS);
});

// ─────────────────────────────────────────────────────────────
// Base layer: duplicate ids. perks.csv+legacy_perks.csv share one perk-id namespace;
// feats.csv+legacy_feats.csv+fusions.csv share one feat-id namespace (a Fusion IS a
// Feat purchase). A silent duplicate would otherwise collapse to whichever row wins
// the id->record Map below, while the emitted dataset.json array still carries both.
// ─────────────────────────────────────────────────────────────

function checkDuplicateIdsAcross(sheets: SheetData[]) {
  const seen = new Map<string, { sheet: string; row: number }>();
  eachRow(sheets, (r, sheet, row) => {
    if (!r.id) return; // already reported by the required-column check
    const existing = seen.get(r.id);
    if (existing) {
      const suffix = existing.sheet === sheet ? "" : ` (a different sheet)`;
      err(sheet, row, `duplicate id "${r.id}" — first seen at ${existing.sheet}!${existing.row}${suffix}`);
    } else {
      seen.set(r.id, { sheet, row });
    }
  });
}
checkDuplicateIdsAcross(perkSheets);
checkDuplicateIdsAcross([...featSheets, fusionsCsv]);
if (existsSync(`${CONTENT_DIR}/subjects.csv`)) checkDuplicateIdsAcross([subjectsCsv]);

// ─────────────────────────────────────────────────────────────
// Build typed Perk[] (family/tier/subject may be legitimately blank —
// that's the expected extraction-pending state, not a parse failure here;
// the required-column check above already reports it). subject_suggested/
// family_suggested are non-schema passthrough, carried whenever present.
// ─────────────────────────────────────────────────────────────

function parseOptionalNumericField(sheet: string, row: number, field: string, raw: string | undefined): number | null {
  if (raw === undefined || raw.trim() === "") return null;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    err(sheet, row, `${field} "${raw}" is not a number`);
    return null;
  }
  return parsed;
}

type PerkOut = Perk & { subject_suggested?: string; family_suggested?: string };

const perks: PerkOut[] = [];
eachRow(perkSheets, (r, sheet, row) => {
  const perk: PerkOut = {
    id: r.id,
    name: r.name,
    subject: r.subject ?? "",
    family: (r.family ?? "") as EffectFamily,
    tier: (r.tier ?? "") as Tier,
    bonus_category: (r.bonus_category?.trim() || null) as Perk["bonus_category"],
    bonus_type: (r.bonus_type?.trim() || null) as Perk["bonus_type"],
    text: r.text ?? "",
    boundary: r.boundary ?? "",
    counterweight: r.counterweight?.trim() || null,
    enhanced_threshold: parseOptionalNumericField(sheet, row, "enhanced_threshold", r.enhanced_threshold),
    enhanced_text: r.enhanced_text?.trim() || null,
  };
  if (r.subject_suggested?.trim()) perk.subject_suggested = r.subject_suggested.trim();
  if (r.family_suggested?.trim()) perk.family_suggested = r.family_suggested.trim();
  perks.push(perk);
});

const perksById = new Map(perks.map((p) => [p.id, p]));
const perkRowById = new Map<string, { sheet: string; row: number }>();
eachRow(perkSheets, (r, sheet, row) => perkRowById.set(r.id, { sheet, row }));

// ─────────────────────────────────────────────────────────────
// Build typed Feat[]/Fusion[] (parsing requirements/sources/job/parents mini-syntax).
// skill_group/block are non-schema passthrough, carried whenever present.
// ─────────────────────────────────────────────────────────────

function parseJob(raw: string): Feat["job"] {
  return raw
    .split(";")
    .map((j) => j.trim())
    .filter((j) => j !== "") as Feat["job"];
}

type FeatOut = Feat & { skill_group?: string; block?: string };

function buildFeat(sheet: string, r: CsvRow, row: number): FeatOut {
  const { value: requirements, errors: reqErrors } = parseRequirements(r.requirements ?? "");
  reqErrors.forEach((m) => err(sheet, row, m));
  const { value: sources, errors: srcErrors } = parseSources(r.sources ?? "");
  srcErrors.forEach((m) => err(sheet, row, m));

  let cp_cost = 0;
  if (r.cp_cost !== undefined && r.cp_cost.trim() !== "") {
    const parsed = Number(r.cp_cost);
    if (!Number.isFinite(parsed)) {
      err(sheet, row, `cp_cost "${r.cp_cost}" is not a number`);
    } else {
      cp_cost = parsed;
    }
  }

  const feat: FeatOut = {
    id: r.id,
    name: r.name,
    perk_ids: (r.perk_ids ?? "").split(";").map((s) => s.trim()).filter((s) => s !== ""),
    job: parseJob(r.job ?? ""),
    authority_root: {
      type: (r.authority_root_type ?? "") as Feat["authority_root"]["type"],
      id: r.authority_root_id ?? "",
    },
    practice_root_id: r.practice_root_id?.trim() || null,
    fusion_root_id: r.fusion_root_id?.trim() || null,
    sources,
    requirements,
    rarity: r.rarity as Feat["rarity"],
    zone_id: r.zone_id?.trim() || null,
    cp_cost,
    boundary: r.boundary ?? "",
  };
  if (r.skill_group?.trim()) feat.skill_group = r.skill_group.trim();
  if (r.block?.trim()) feat.block = r.block.trim();
  return feat;
}

const feats: FeatOut[] = [];
eachRow(featSheets, (r, sheet, row) => feats.push(buildFeat(sheet, r, row)));

const fusions: (FeatOut & Pick<Fusion, "operator" | "parents" | "target_trait_id" | "cp_refund">)[] = fusionsCsv.rows.map((r, i) => {
  const row = fusionsCsv.rowNumbers[i];
  const base = buildFeat("fusions.csv", r, row);
  const { value: parents, errors: parentErrors } = parseFusionParents(r.parents ?? "");
  parentErrors.forEach((m) => err("fusions.csv", row, m));

  const operator = r.operator as Fusion["operator"];
  const target_trait_id = r.target_trait_id?.trim() || null;

  return {
    ...base,
    operator,
    parents,
    target_trait_id,
    cp_refund: parseOptionalNumericField("fusions.csv", row, "cp_refund", r.cp_refund),
  };
});

// feat id -> sheet/row, for error messages when validating fusions/feats together
const featRowById = new Map<string, { sheet: string; row: number }>();
eachRow(featSheets, (r, sheet, row) => featRowById.set(r.id, { sheet, row }));
fusionsCsv.rows.forEach((r, i) => featRowById.set(r.id, { sheet: "fusions.csv", row: fusionsCsv.rowNumbers[i] }));

const allFeats: (FeatOut | (FeatOut & Pick<Fusion, "operator" | "parents" | "target_trait_id" | "cp_refund">))[] = [...feats, ...fusions];
const featsById = new Map(allFeats.map((f) => [f.id, f]));

// ─────────────────────────────────────────────────────────────
// Reference data (skills/specializations/skill_groups/skill_level_table/attributes)
// ─────────────────────────────────────────────────────────────

const reference = loadReferenceData(CONTENT_DIR);
reference.errors.forEach((m) => errors.push(m)); // already sheet!row-formatted by the adapter
reference.notes.forEach((m) => notes.push(m));
const skillsById = new Map(reference.skills.map((s) => [s.id, s]));

// ─────────────────────────────────────────────────────────────
// subjects.csv (authoritative — NOT subjects.proposed.csv)
// ─────────────────────────────────────────────────────────────

const subjects = subjectsCsv.rows.map((r) => ({
  id: r.id,
  name: r.name,
  category: r.category as SpiralDataset["subjects"][number]["category"],
}));
const subjectsById = new Map(subjects.map((s) => [s.id, s]));

// ─────────────────────────────────────────────────────────────
// Rule 1: every id referenced by another sheet exists.
// Scope: perk_ids, PRIOR_NODE targets, fusion parents' feat_id, SKILL_LEVEL targets,
// authority_root_id (SKILL type), ATTRIBUTE/ATTRIBUTE_CEILING targets against the
// fixed attribute code set. CLASS/CLASS_TIER/INSIGHT/TRAIT targets are checked too,
// but classes[]/traits[] are stubbed empty this phase, so those legitimately fail
// unless the content never uses them. Unresolved SKILL references from legacy_*.csv
// are downgraded to warnings under --draft (pending content/skill_reconciliation.csv).
// ─────────────────────────────────────────────────────────────

const ATTRIBUTE_CODES = new Set(["STR", "AGI", "INT", "PER", "WIL", "CHA"]);
const classesById = new Map<string, unknown>(); // stubbed []
const traitsById = new Map<string, unknown>(); // stubbed []

/**
 * A SKILL_LEVEL target is either a bare skill id ("craft") or, for a parameterized
 * skill's specific instance, "skill_id.instance" ("craft.Woodwork") — a period, not
 * a colon, since colon is the requirement mini-syntax's own field separator. Splits
 * on the FIRST period only; none of the authored instance names contain one.
 */
function checkRequirementTargets(sheet: string, row: number, requirements: Requirement[]) {
  for (const req of requirements) {
    switch (req.type) {
      case "SKILL_LEVEL": {
        const dot = req.target.indexOf(".");
        const skillId = dot === -1 ? req.target : req.target.slice(0, dot);
        const instance = dot === -1 ? null : req.target.slice(dot + 1);
        const skill = skillsById.get(skillId);
        if (!skill) {
          draftSink("skill_ref", sheet)(sheet, row, `requirement SKILL_LEVEL references unknown skill "${skillId}"`);
        } else if (instance !== null && !skill.instances.includes(instance)) {
          draftSink("skill_ref", sheet)(
            sheet,
            row,
            `requirement SKILL_LEVEL references unknown instance "${instance}" of skill "${skillId}" (known instances: ${skill.instances.join(", ") || "none"})`,
          );
        }
        break;
      }
      case "ATTRIBUTE":
      case "ATTRIBUTE_CEILING":
        if (!ATTRIBUTE_CODES.has(req.target)) err(sheet, row, `requirement ${req.type} references unknown attribute "${req.target}"`);
        break;
      case "PRIOR_NODE":
        if (!featsById.has(req.target) && !perksById.has(req.target) && !reference.specializations.some((s) => s.id === req.target)) {
          err(sheet, row, `requirement PRIOR_NODE references unknown node "${req.target}"`);
        }
        break;
      case "TRAIT":
        if (!traitsById.has(req.target)) err(sheet, row, `requirement TRAIT references unknown trait "${req.target}" (traits[] is empty this phase)`);
        break;
      case "CLASS":
      case "CLASS_TIER":
      case "INSIGHT":
        if (!classesById.has(req.target)) err(sheet, row, `requirement ${req.type} references unknown class "${req.target}" (classes[] is empty this phase)`);
        break;
      case "VERB":
        // no dedicated verb-id sheet ingested this phase; not checked.
        break;
    }
  }
}

for (const f of feats) {
  const loc = featRowById.get(f.id)!;
  for (const pid of f.perk_ids) {
    if (!perksById.has(pid)) err(loc.sheet, loc.row, `perk_ids references unknown perk "${pid}"`);
  }
  checkRequirementTargets(loc.sheet, loc.row, f.requirements);
  if (f.authority_root.type === "SKILL" && !skillsById.has(f.authority_root.id)) {
    draftSink("skill_ref", loc.sheet)(loc.sheet, loc.row, `authority_root references unknown skill "${f.authority_root.id}"`);
  }
  if (f.authority_root.type === "ATTRIBUTE" && !ATTRIBUTE_CODES.has(f.authority_root.id)) {
    err(loc.sheet, loc.row, `authority_root references unknown attribute "${f.authority_root.id}"`);
  }
}
for (const f of fusions) {
  const loc = featRowById.get(f.id)!;
  for (const pid of f.perk_ids) {
    if (!perksById.has(pid)) err(loc.sheet, loc.row, `perk_ids references unknown perk "${pid}"`);
  }
  checkRequirementTargets(loc.sheet, loc.row, f.requirements);
}

// ─────────────────────────────────────────────────────────────
// Rule 2: every perks.subject is in subjects.csv. A blank subject downgrades to a
// warning under --draft; a non-blank-but-unresolved subject is a real typo and
// always stays an error.
// ─────────────────────────────────────────────────────────────

eachRow(perkSheets, (r, sheet, row) => {
  const subject = r.subject?.trim();
  if (!subject) {
    draftSink("subject", sheet)(sheet, row, `missing required field "subject"`);
    return;
  }
  if (!subjectsById.has(subject)) {
    err(sheet, row, `subject "${subject}" not found in subjects.csv`);
  }
});

// ─────────────────────────────────────────────────────────────
// Rule 3: every (family, tier) pair used by a perk exists in effect_ladder.csv.
// Bootstrap behavior: authored-column pairs first; if that's empty (family/tier
// blank, as decision 6 leaves them on fresh extraction), fall back to
// (family_suggested, tier-or-tier_suggested) pairs for the generated worklist —
// legacy_perks.csv has a REAL tier (no tier_suggested column at all), so it
// contributes via its real tier once family_suggested is also present.
// ─────────────────────────────────────────────────────────────

const ladderByPair = new Map<string, EffectLadderStep>();
ladderCsv.rows.forEach((r) => {
  ladderByPair.set(`${r.family}|${r.tier}`, {
    family: r.family as EffectFamily,
    tier: r.tier as Tier,
    value_text: r.value_text ?? "",
    numeric_value: r.numeric_value?.trim() ? Number(r.numeric_value) : null,
  });
});

const authoredPairs = new Set<string>();
eachRow(perkSheets, (r, sheet, row) => {
  if (!r.family || !r.tier) return;
  const key = `${r.family}|${r.tier}`;
  authoredPairs.add(key);
  if (!ladderFileExists) {
    return; // handled by the bootstrap block below (warning, not error)
  }
  const step = ladderByPair.get(key);
  if (!step) {
    err(sheet, row, `(family, tier) pair (${r.family}, ${r.tier}) not found in effect_ladder.csv`);
    return;
  }
  const sev = STRICT_LADDER ? err : warn;
  if (!step.value_text) sev(sheet, row, `effect_ladder.csv has no value_text for (${r.family}, ${r.tier})`);
  if (step.numeric_value === null && r.family === "FLAT_BONUS") {
    sev(sheet, row, `effect_ladder.csv has no numeric_value for FLAT_BONUS/${r.tier}`);
  }
});

if (!ladderFileExists) {
  warnings.push(`effect_ladder.csv not found — rule 3 is running in bootstrap mode (see content/effect_ladder.generated.csv)`);
}

const suggestedPairs = new Set<string>();
eachRow(perkSheets, (r) => {
  const fam = r.family_suggested?.trim();
  const tier = r.tier?.trim() || r.tier_suggested?.trim();
  if (fam && tier) suggestedPairs.add(`${fam}|${tier}`);
});

const bootstrapPairs = authoredPairs.size > 0 ? authoredPairs : suggestedPairs;
const bootstrapIsUnconfirmed = authoredPairs.size === 0 && suggestedPairs.size > 0;
if (bootstrapPairs.size > 0 && !ladderFileExists) {
  mkdirSync(CONTENT_DIR, { recursive: true });
  const genRows = [...bootstrapPairs].map((key) => {
    const [family, tier] = key.split("|");
    return { family, tier, value_text: "", numeric_value: "" };
  });
  const header = ["family", "tier", "value_text", "numeric_value"];
  const csvBody = stringifyCsv(header, genRows);
  const marker = bootstrapIsUnconfirmed
    ? "# UNCONFIRMED — derived from family_suggested/tier_suggested, not authored family/tier\n"
    : "";
  writeFileSync(`${CONTENT_DIR}/effect_ladder.generated.csv`, marker + csvBody);
  notes.push(
    `wrote content/effect_ladder.generated.csv with ${genRows.length} (family, tier) pair(s)${bootstrapIsUnconfirmed ? " [UNCONFIRMED — from *_suggested columns]" : ""}`,
  );
} else if (!ladderFileExists) {
  notes.push(
    `effect_ladder.generated.csv NOT written: no (family, tier) pairs available to bootstrap from — neither authored family/tier nor family_suggested/(tier|tier_suggested) are both populated on any perk yet`,
  );
}

// ─────────────────────────────────────────────────────────────
// Rule 4: feats hold 1-3 perks.
// ─────────────────────────────────────────────────────────────

for (const f of allFeats) {
  const loc = featRowById.get(f.id)!;
  if (f.perk_ids.length < 1 || f.perk_ids.length > 3) {
    err(loc.sheet, loc.row, `feat has ${f.perk_ids.length} perk_ids, must be 1-3`);
  }
}

// ─────────────────────────────────────────────────────────────
// Rule 5: no perk is owned by more than one active header.
// ─────────────────────────────────────────────────────────────

const perkOwner = new Map<string, string>(); // perk id -> feat id
for (const f of allFeats) {
  const loc = featRowById.get(f.id)!;
  for (const pid of f.perk_ids) {
    const existing = perkOwner.get(pid);
    if (existing && existing !== f.id) {
      err(loc.sheet, loc.row, `perk "${pid}" is already owned by feat/fusion "${existing}"`);
    } else {
      perkOwner.set(pid, f.id);
    }
  }
}

// ─────────────────────────────────────────────────────────────
// Orphaned-perk check (not one of the 10 numbered rules — a structural sanity
// check surfaced by the skill-reconciliation migration, which can DISCARD a feat
// while leaving its perk rows in place). A perk with no owning feat/fusion is
// dead weight in the dataset: nothing can ever grant it. Warning, not an error —
// an author may legitimately stage a perk before wiring it to a feat.
// ─────────────────────────────────────────────────────────────

for (const p of perks) {
  if (!perkOwner.has(p.id)) {
    const loc = perkRowById.get(p.id);
    warn(loc?.sheet ?? "perks.csv", loc?.row ?? "?", `perk "${p.id}" (${p.name}) is not owned by any feat/fusion — unreachable`);
  }
}

// ─────────────────────────────────────────────────────────────
// Rule 6: no requirement cycles (PRIOR_NODE edges among feats/fusions).
// ─────────────────────────────────────────────────────────────

const priorNodeGraph = new Map<string, string[]>();
for (const f of allFeats) {
  const targets = f.requirements.filter((r) => r.type === "PRIOR_NODE" && featsById.has(r.target)).map((r) => r.target);
  priorNodeGraph.set(f.id, targets);
}

function findCycle(): string[] | null {
  const WHITE = 0, GRAY = 1, BLACK = 2;
  const color = new Map<string, number>();
  for (const id of priorNodeGraph.keys()) color.set(id, WHITE);
  const stack: string[] = [];

  function dfs(id: string): string[] | null {
    color.set(id, GRAY);
    stack.push(id);
    for (const next of priorNodeGraph.get(id) ?? []) {
      if (color.get(next) === GRAY) {
        const cycleStart = stack.indexOf(next);
        return [...stack.slice(cycleStart), next];
      }
      if (color.get(next) === WHITE) {
        const found = dfs(next);
        if (found) return found;
      }
    }
    stack.pop();
    color.set(id, BLACK);
    return null;
  }

  for (const id of priorNodeGraph.keys()) {
    if (color.get(id) === WHITE) {
      const found = dfs(id);
      if (found) return found;
    }
  }
  return null;
}

const cycle = findCycle();
if (cycle) {
  const loc = featRowById.get(cycle[0])!;
  err(loc.sheet, loc.row, `requirement cycle detected: ${cycle.join(" -> ")}`);
}

// ─────────────────────────────────────────────────────────────
// Rule 7 (re-scoped as a contradiction check — see docs/authoring-columns.md).
// ─────────────────────────────────────────────────────────────

for (const f of allFeats) {
  const loc = featRowById.get(f.id)!;
  const byAttribute = new Map<string, { floor?: number; ceiling?: number }>();
  for (const r of f.requirements) {
    if (r.type !== "ATTRIBUTE" && r.type !== "ATTRIBUTE_CEILING") continue;
    const entry = byAttribute.get(r.target) ?? {};
    if (r.type === "ATTRIBUTE") entry.floor = r.threshold ?? undefined;
    else entry.ceiling = r.threshold ?? undefined;
    byAttribute.set(r.target, entry);
  }
  for (const [attr, { floor, ceiling }] of byAttribute) {
    if (floor !== undefined && ceiling !== undefined && floor >= ceiling) {
      err(loc.sheet, loc.row, `contradictory ${attr} requirements: floor ${floor} >= ceiling ${ceiling} (empty range)`);
    }
  }
}

// ─────────────────────────────────────────────────────────────
// Rule 8: every perk and feat has a non-empty boundary. Downgraded to a warning
// under --draft (any sheet) — the task's authoring backlog, not a defect.
// ─────────────────────────────────────────────────────────────

eachRow(perkSheets, (r, sheet, row) => {
  if (!r.boundary || r.boundary.trim() === "") draftSink("boundary", sheet)(sheet, row, `missing required field "boundary"`);
});
for (const f of allFeats) {
  const loc = featRowById.get(f.id)!;
  if (!f.boundary || f.boundary.trim() === "") draftSink("boundary", loc.sheet)(loc.sheet, loc.row, `missing required field "boundary"`);
}

// ─────────────────────────────────────────────────────────────
// Rule 9: fusion parents all exist and carry a disposition (disposition validity
// is already guaranteed by parseFusionParents rejecting unknown tokens).
// ─────────────────────────────────────────────────────────────

for (const f of fusions) {
  const loc = featRowById.get(f.id)!;
  for (const p of f.parents) {
    if (!featsById.has(p.feat_id)) err(loc.sheet, loc.row, `fusion parent "${p.feat_id}" does not exist`);
  }
}

// ─────────────────────────────────────────────────────────────
// Rule 10: TRANSFORMATIVE_CONVERSION requires target_trait_id; no other operator does.
// ─────────────────────────────────────────────────────────────

for (const f of fusions) {
  const loc = featRowById.get(f.id)!;
  if (f.operator === "TRANSFORMATIVE_CONVERSION" && !f.target_trait_id) {
    err(loc.sheet, loc.row, `TRANSFORMATIVE_CONVERSION requires target_trait_id`);
  }
  if (f.operator !== "TRANSFORMATIVE_CONVERSION" && f.target_trait_id) {
    err(loc.sheet, loc.row, `target_trait_id is only valid for TRANSFORMATIVE_CONVERSION (operator is ${f.operator})`);
  }
}

// ─────────────────────────────────────────────────────────────
// derived_tier / is_anti_perk (computed, never authored — decisions 6, 10, 11)
// ─────────────────────────────────────────────────────────────

function computeRootFloor(f: FeatOut): Tier {
  if (f.authority_root.type === "SKILL") {
    // SKILL_LEVEL target is either the bare skill id or "skill_id.instance" — match
    // either form against authority_root.id (which is always the bare skill id).
    const skillLevelReq = f.requirements.find(
      (r) => r.type === "SKILL_LEVEL" && (r.target === f.authority_root.id || r.target.startsWith(`${f.authority_root.id}.`)),
    );
    if (skillLevelReq && skillLevelReq.threshold !== null) {
      return skillLevelToTier(skillLevelReq.threshold);
    }
  }
  return "ENTRY";
}

for (const f of allFeats) {
  const loc = featRowById.get(f.id)!;
  f.is_anti_perk = f.requirements.some((r) => r.type === "ATTRIBUTE_CEILING");

  const ownedPerks = f.perk_ids.map((pid) => perksById.get(pid)).filter((p): p is PerkOut => !!p);
  const missingTier = ownedPerks.find((p) => !p.tier || !(["ENTRY", "INTERMEDIATE", "ADVANCED", "EXPERT", "MASTER"] as string[]).includes(p.tier));
  if (ownedPerks.length === 0 || missingTier) {
    notes.push(
      `derived_tier skipped for ${loc.sheet}!${loc.row} ("${f.id}"): ${
        ownedPerks.length === 0 ? "no resolvable perks" : `perk "${missingTier!.id}" has no tier`
      }`,
    );
    continue;
  }
  const rootFloor = computeRootFloor(f);
  const effectFloor = ownedPerks.reduce((acc, p) => maxTier(acc, p.tier), ownedPerks[0].tier);
  f.derived_tier = maxTier(rootFloor, effectFloor);

  // Decision 14: enhanced_threshold should sit ~20 below the feat's ATTRIBUTE_CEILING.
  // A violation is a strong signal of column misalignment during extraction.
  const ceilingReq = f.requirements.filter((r) => r.type === "ATTRIBUTE_CEILING");
  if (ceilingReq.length === 1 && ceilingReq[0].threshold !== null) {
    for (const p of ownedPerks) {
      if (p.enhanced_threshold !== null && p.enhanced_threshold >= ceilingReq[0].threshold) {
        warn(
          loc.sheet,
          loc.row,
          `perk "${p.id}" enhanced_threshold (${p.enhanced_threshold}) >= feat's ATTRIBUTE_CEILING (${ceilingReq[0].threshold}) — expected strictly below; check for column misalignment during extraction`,
        );
      }
    }
  }
}

// ─────────────────────────────────────────────────────────────
// Assemble SpiralDataset + write data/dataset.json (always — even on failure)
// ─────────────────────────────────────────────────────────────

const dataset: SpiralDataset & { _valid: boolean; _draft?: boolean; _error_count: number; _warning_count: number } = {
  version: "1.0",
  zones: [{ id: "universal", name: "Universal", description: "" }],
  attributes: reference.attributes,
  skills: reference.skills,
  skill_groups: reference.skill_groups,
  specializations: reference.specializations,
  advanced_knowledge: [],
  perks,
  feats,
  fusions,
  traits: [],
  classes: [],
  unlock_lines: [],
  keystones: [],
  effect_ladder: [...ladderByPair.values()],
  skill_level_table: reference.skill_level_table,
  subjects,
  _valid: errors.length === 0,
  _error_count: errors.length,
  _warning_count: warnings.length,
};
if (DRAFT) dataset._draft = true;

mkdirSync(DATA_DIR, { recursive: true });
writeFileSync(`${DATA_DIR}/dataset.json`, JSON.stringify(dataset, null, 2) + "\n");

// ─────────────────────────────────────────────────────────────
// Report, grouped by cause
// ─────────────────────────────────────────────────────────────

console.log(`\ndata/dataset.json written (_valid: ${dataset._valid}${DRAFT ? ", _draft: true" : ""})\n`);
console.log(`perks: ${perks.length} (${perksMain.rows.length} + ${perksLegacy.rows.length} legacy)`);
console.log(`feats: ${feats.length} (${featsMain.rows.length} + ${featsLegacy.rows.length} legacy), fusions: ${fusions.length}\n`);

if (notes.length > 0) {
  console.log(`NOTES (${notes.length}):`);
  notes.forEach((m) => console.log(`  - ${m}`));
  console.log();
}
if (warnings.length > 0) {
  console.log(`WARNINGS (${warnings.length}):`);
  warnings.forEach((m) => console.log(`  - ${m}`));
  console.log();
}
if (errors.length > 0) {
  console.log(`ERRORS (${errors.length}):`);
  errors.forEach((m) => console.log(`  - ${m}`));
  console.log();
}

console.log(`${errors.length} error(s), ${warnings.length} warning(s), ${notes.length} note(s).`);

if (errors.length > 0) process.exitCode = 1;
