#!/usr/bin/env -S npx tsx
/**
 * Flattens the "Anti" tab's spatial grid (source/Protofeats Renew 1.1.xlsx) into
 * content/perks.csv, content/feats.csv, content/fusions.csv, content/subjects.proposed.csv.
 *
 * Scope: the six named CHA themes only (Appearance, Empathy, Communication, Silence,
 * Prejudice, Magnetism), visible detail cards only (the hidden index at cols D-N is
 * excluded per an explicit design decision — see the plan and the report this prints).
 *
 * Never invents design content: family/tier/subject are left blank with *_suggested
 * columns alongside them; perk boundary is left blank (not present in the source at
 * all); truncated/placeholder source text is extracted literally or left blank and
 * reported, never guessed at.
 */

import ExcelJS from "exceljs";
import { mkdirSync, writeFileSync } from "node:fs";
import { stringifyCsv, type CsvRow } from "./lib/csv.ts";
import { cellPlainText, slug, parseBulletLine, parseCounterLine, parseReqLine, isPlaceholderText } from "./lib/anti-grid.ts";

const SOURCE_FILE = "source/Protofeats Renew 1.1.xlsx";
const SHEET_NAME = "Anti";
const CONTENT_DIR = "content";

interface ThemeDef {
  name: string; // canonical spelling per the task brief (the grid has typos: "Appearence", "Emphaty")
  startRow: number;
  labelCell: string;
}

const THEMES: ThemeDef[] = [
  { name: "Appearance", startRow: 3, labelCell: "O4" },
  { name: "Empathy", startRow: 9, labelCell: "O10" },
  { name: "Communication", startRow: 15, labelCell: "O16" },
  { name: "Silence", startRow: 21, labelCell: "O22" },
  { name: "Prejudice", startRow: 27, labelCell: "O28" },
  { name: "Magnetism", startRow: 33, labelCell: "O35" },
];
const KNOWN_LABEL_ROWS = new Set(THEMES.map((t) => Number(t.labelCell.match(/\d+/)![0])));

type Rarity = "COMMON" | "UNCOMMON" | "RARE";
const TIER_COLUMNS: { ceilCol: string; nameCol: string; rarity: Rarity }[] = [
  { ceilCol: "P", nameCol: "Q", rarity: "COMMON" },
  { ceilCol: "U", nameCol: "V", rarity: "COMMON" },
  { ceilCol: "Z", nameCol: "AA", rarity: "UNCOMMON" },
  { ceilCol: "AE", nameCol: "AF", rarity: "RARE" },
];

// ─────────────────────────────────────────────────────────────
// Report accumulators
// ─────────────────────────────────────────────────────────────

const truncations: string[] = [];
const placeholders: string[] = [];
const familyUnresolved: string[] = [];
const hiddenIndexConflicts: string[] = [];
const attributeNormalizations: string[] = [];
const otherBlocksFound: string[] = [];
const danglingFusionParents: string[] = [];

function suggestFamily(desc: string): string {
  if (/\bas if\b|\bworks as\b|\btreated as\b|\breads? as\b/i.test(desc)) return "SUBSTITUTION";
  if (/\bresistance\b|\bbonus\b|\+\d/.test(desc)) return "FLAT_BONUS";
  return "";
}

function normalizeAttr(raw: string, cell: string): string {
  if (raw === "CAR") {
    attributeNormalizations.push(`${cell}: attribute "CAR" normalized to "CHA"`);
    return "CHA";
  }
  return raw;
}

async function main() {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(SOURCE_FILE);
  const ws = workbook.getWorksheet(SHEET_NAME);
  if (!ws) throw new Error(`sheet "${SHEET_NAME}" not found in ${SOURCE_FILE}`);

  const text = (row: number, col: string) => cellPlainText(ws.getCell(`${col}${row}`).value).trim();
  const num = (row: number, col: string) => {
    const v = ws.getCell(`${col}${row}`).value;
    return typeof v === "number" ? v : null;
  };

  // Hidden index (cols D-N, excluded from extraction) — scanned only to report
  // overlaps against the visible cards, per the explicit decision to exclude it
  // but not silently.
  const hiddenIndex: { name: string; ceiling: number; cell: string }[] = [];
  for (let r = 1; r <= 127; r++) {
    for (const [ceilCol, nameCol] of [["F", "G"], ["I", "J"], ["L", "M"]] as const) {
      const name = text(r, nameCol);
      const ceiling = num(r, ceilCol);
      if (name && ceiling !== null) hiddenIndex.push({ name, ceiling, cell: `${nameCol}${r}` });
    }
  }

  // "Other theme-like blocks not attempted" — any non-empty col-O label outside the six known ones.
  for (let r = 1; r <= 127; r++) {
    if (KNOWN_LABEL_ROWS.has(r)) continue;
    const label = text(r, "O");
    if (label) otherBlocksFound.push(`O${r}: "${label}"`);
  }

  const perksRows: CsvRow[] = [];
  const featsRows: CsvRow[] = [];
  const fusionsRows: CsvRow[] = [];
  const subjectsProposedRows: CsvRow[] = [];

  // Pass 1: extract the three non-fusion tiers for every theme, building a global
  // name -> feat id map (fusion REQ parents can reference a perk from a DIFFERENT
  // theme, e.g. Appearance's REQ references "Stereotyping", which lives in Prejudice).
  const featIdByNameLower = new Map<string, string>();

  interface ThemeWork {
    theme: ThemeDef;
    attr: string;
    subjectId: string;
    tierNames: (string | null)[]; // index 0-3, name at each tier (for hidden-index cross-check)
  }
  const work: ThemeWork[] = [];

  for (const theme of THEMES) {
    const themeSlug = slug(theme.name);
    const N = theme.startRow;
    const tierNames: (string | null)[] = [null, null, null, null];
    // Silent peek (no report push — the tier loop below re-reads and reports this
    // same cell) so subject_suggested is stable and matches subjects.proposed.csv's
    // id even before the tier loop finishes.
    let attr = text(N + 1, TIER_COLUMNS[0].ceilCol) === "CAR" ? "CHA" : text(N + 1, TIER_COLUMNS[0].ceilCol);
    const subjectId = `${slug(attr || "cha")}_${themeSlug}`;

    for (let t = 0; t < 3; t++) {
      const { ceilCol, nameCol, rarity } = TIER_COLUMNS[t];
      const ceiling = num(N, ceilCol);
      const name = text(N, nameCol);
      if (!name || ceiling === null) continue;
      tierNames[t] = name;

      // Re-normalize per tier (not just the theme-level peek above) so every "CAR"
      // occurrence gets its own report line, not just the first one seen per theme.
      attr = normalizeAttr(text(N + 1, ceilCol), `${ceilCol}${N + 1}`) || attr;
      const desc = text(N + 1, nameCol);
      if (isPlaceholderText(desc)) placeholders.push(`${theme.name}/${name} (${nameCol}${N + 1}): placeholder description "${desc}"`);

      const bullet = parseBulletLine(text(N + 3, nameCol));
      if (bullet.truncated) {
        truncations.push(`${theme.name}/${name} (${nameCol}${N + 3}): enhanced_text truncated: "${text(N + 3, nameCol)}"`);
      }
      const counter = parseCounterLine(text(N + 4, nameCol));
      if (counter.truncated) {
        truncations.push(`${theme.name}/${name} (${nameCol}${N + 4}): counterweight truncated: "${text(N + 4, nameCol)}"`);
      }

      const perkId = `perk_${slug(name)}`;
      const featId = `feat_${slug(name)}`;
      featIdByNameLower.set(name.toLowerCase(), featId);

      const familySuggested = suggestFamily(desc);
      if (!familySuggested) familyUnresolved.push(`${theme.name}/${name}: no family heuristic matched: "${desc.slice(0, 150)}"`);

      perksRows.push({
        id: perkId,
        name,
        subject: "",
        subject_suggested: subjectId,
        family: "",
        family_suggested: familySuggested,
        tier: "",
        tier_suggested: "",
        bonus_category: "",
        bonus_type: "",
        text: desc,
        boundary: "",
        counterweight: counter.truncated ? "" : counter.tail,
        enhanced_threshold: bullet.threshold === null ? "" : String(bullet.threshold),
        enhanced_text: bullet.truncated ? "" : bullet.tail,
      });

      featsRows.push({
        id: featId,
        name,
        perk_ids: perkId,
        job: "PROGRESS",
        authority_root_type: "ATTRIBUTE",
        authority_root_id: attr,
        practice_root_id: `practice_anti_${themeSlug}`,
        fusion_root_id: "",
        requirements: `ATTRIBUTE_CEILING:${attr}:${ceiling}`,
        sources: "",
        rarity,
        zone_id: "",
        cp_cost: "1",
        boundary: `Suspends if ${attr} rises above ${ceiling}.`,
      });
    }

    subjectsProposedRows.push({ id: subjectId, name: `${theme.name} (${attr})`, category: "" });
    work.push({ theme, attr, subjectId, tierNames });
  }

  // Pass 2: the Rare tier (Fusion) for every theme, resolving REQ parents against
  // the now-complete cross-theme name -> feat id map. Never fuzzy-matched: an
  // unresolved name is slugified literally and left for convert.ts's rule 9 to
  // report as a dangling reference.
  for (const { theme, attr, subjectId, tierNames } of work) {
    const themeSlug = slug(theme.name);
    const N = theme.startRow;
    const { ceilCol, nameCol, rarity } = TIER_COLUMNS[3];

    const ceiling = num(N, ceilCol);
    const name = text(N, nameCol);
    if (!name || ceiling === null) continue;
    tierNames[3] = name;

    const rawAttr = text(N + 1, ceilCol);
    const fusionAttr = normalizeAttr(rawAttr, `${ceilCol}${N + 1}`) || attr;
    const desc = text(N + 1, nameCol);
    if (isPlaceholderText(desc)) placeholders.push(`${theme.name}/${name} (${nameCol}${N + 1}): placeholder description "${desc}"`);

    // Row N+3's bullet is "* - BASE: ..." for the Rare tier — enhanced fields stay
    // null unconditionally (this tier IS the escalated form), but its truncation is
    // still worth reporting alongside the others.
    const baseLine = text(N + 3, nameCol);
    const baseBullet = parseBulletLine(baseLine);
    if (baseBullet.truncated) truncations.push(`${theme.name}/${name} (${nameCol}${N + 3}): Rare-tier BASE line truncated: "${baseLine}"`);

    const reqLine = text(N + 4, nameCol);
    const parents = parseReqLine(reqLine);

    const perkId = `perk_${slug(name)}`;
    const fusionId = `fusion_${slug(name)}`;

    const familySuggested = suggestFamily(desc);
    if (!familySuggested && !isPlaceholderText(desc)) {
      familyUnresolved.push(`${theme.name}/${name}: no family heuristic matched: "${desc.slice(0, 150)}"`);
    }

    perksRows.push({
      id: perkId,
      name,
      subject: "",
      subject_suggested: subjectId,
      family: "",
      family_suggested: familySuggested,
      tier: "",
      tier_suggested: "",
      bonus_category: "",
      bonus_type: "",
      text: desc,
      boundary: "",
      counterweight: "",
      enhanced_threshold: "",
      enhanced_text: "",
    });

    let requirements = `ATTRIBUTE_CEILING:${fusionAttr}:${ceiling}`;
    let parentsField = "";
    if (parents) {
      const [rawA, rawB] = parents;
      const resolve = (rawName: string) => {
        const found = featIdByNameLower.get(rawName.toLowerCase());
        if (found) return found;
        const fallback = `feat_${slug(rawName)}`;
        danglingFusionParents.push(`${theme.name}/${name}: parent "${rawName}" -> "${fallback}" not found among extracted feats (dangling — will fail rule 9)`);
        return fallback;
      };
      const parentA = resolve(rawA);
      const parentB = resolve(rawB);
      requirements += `;PRIOR_NODE:${parentA};PRIOR_NODE:${parentB}`;
      parentsField = `${parentA}:INTEGRATED;${parentB}:INTEGRATED`;
    } else {
      danglingFusionParents.push(`${theme.name}/${name}: REQ line unparseable: "${reqLine}"`);
    }

    fusionsRows.push({
      id: fusionId,
      name,
      perk_ids: perkId,
      job: "PROGRESS;SIMPLIFICATION",
      authority_root_type: "ATTRIBUTE",
      authority_root_id: fusionAttr,
      practice_root_id: `practice_anti_${themeSlug}`,
      fusion_root_id: `fusion_root_${slug(name)}`,
      requirements,
      sources: "",
      rarity,
      zone_id: "",
      cp_cost: "1",
      boundary: `Suspends if ${fusionAttr} rises above ${ceiling}.`,
      operator: "COMPRESSION",
      parents: parentsField,
      target_trait_id: "",
      cp_refund: "",
    });
  }

  // Hidden-index cross-check (informational only — the index itself is never extracted).
  for (const { theme, tierNames } of work) {
    for (const name of tierNames) {
      if (!name) continue;
      const matches = hiddenIndex.filter((h) => h.name.toLowerCase() === name.toLowerCase());
      for (const m of matches) {
        hiddenIndexConflicts.push(`${theme.name}/${name}: hidden index has "${m.name}" at ceiling ${m.ceiling} (${m.cell}) vs. visible card`);
      }
    }
  }

  // ─────────────────────────────────────────────────────────────
  // Write CSVs
  // ─────────────────────────────────────────────────────────────

  mkdirSync(CONTENT_DIR, { recursive: true });

  const perksHeader = [
    "id", "name", "subject", "subject_suggested", "family", "family_suggested",
    "tier", "tier_suggested", "bonus_category", "bonus_type", "text", "boundary",
    "counterweight", "enhanced_threshold", "enhanced_text",
  ];
  writeFileSync(`${CONTENT_DIR}/perks.csv`, stringifyCsv(perksHeader, perksRows));

  const featsHeader = [
    "id", "name", "perk_ids", "job", "authority_root_type", "authority_root_id",
    "practice_root_id", "fusion_root_id", "requirements", "sources", "rarity",
    "zone_id", "cp_cost", "boundary",
  ];
  writeFileSync(`${CONTENT_DIR}/feats.csv`, stringifyCsv(featsHeader, featsRows));

  const fusionsHeader = [...featsHeader, "operator", "parents", "target_trait_id", "cp_refund"];
  writeFileSync(`${CONTENT_DIR}/fusions.csv`, stringifyCsv(fusionsHeader, fusionsRows));

  writeFileSync(`${CONTENT_DIR}/subjects.proposed.csv`, stringifyCsv(["id", "name", "category"], subjectsProposedRows));

  // ─────────────────────────────────────────────────────────────
  // Extraction report
  // ─────────────────────────────────────────────────────────────

  console.log(`\nExtracted ${THEMES.length} themes: ${THEMES.map((t) => t.name).join(", ")}`);
  console.log(`  perks: ${perksRows.length}, feats: ${featsRows.length}, fusions: ${fusionsRows.length}, proposed subjects: ${subjectsProposedRows.length}\n`);

  const section = (title: string, lines: string[]) => {
    console.log(`${title} (${lines.length}):`);
    lines.forEach((l) => console.log(`  - ${l}`));
    console.log();
  };

  section("Attribute normalizations (CAR -> CHA)", attributeNormalizations);
  section("Truncated source text (Counter/enhanced-text/BASE lines) — left blank, needs re-authoring", truncations);
  section("Placeholder descriptions (??????) — extracted literally, needs re-authoring", placeholders);
  section("Perks with no family heuristic match — left blank, needs a human call (do not invent a 7th family)", familyUnresolved);
  section("Dangling/unresolved fusion parents — will fail convert.ts rule 9, fix in fusions.csv or the source", danglingFusionParents);
  section("Hidden-index/visible-card name overlaps — NOT a clean stale/live split, needs a human call", hiddenIndexConflicts);
  section(
    "Other theme-like blocks found but NOT attempted this pass (different attributes/layout)",
    otherBlocksFound,
  );

  console.log(`content/perks.csv, content/feats.csv, content/fusions.csv, content/subjects.proposed.csv written.`);
  console.log(`Next: run "tsx scripts/convert.ts" to validate and produce data/dataset.json.`);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
