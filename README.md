# SpiralMap
a TTRPG builder for characters using the spiral system for lunar valley setting

## Repo layout

- `schema/spiral.ts` — the authoritative dataset schema (`SpiralDataset`).
- `docs/` — design docs and `authoring-columns.md` (the CSV format + the 10 validation rules).
- `content/` — authored CSVs (perks/feats/fusions/subjects/effect_ladder), legacy content
  (`legacy_perks.csv`, `legacy_feats.csv`), reconciliation worklists, and reference sheets
  (skills/specializations/skill_groups/etc.).
- `source/` — read-only original spreadsheets.
- `scripts/` — the CSV→JSON pipeline (Node/TypeScript, run via `tsx`).
- `data/dataset.json` — the build artifact `scripts/convert.ts` produces.
- `app/` — the Vite + React + TypeScript + React Flow character builder.

## Pipeline

```
npm install                      # once, at repo root
npx tsx scripts/extract-anti.ts  # one-time bootstrap: Anti sheet -> content/*.csv
npx tsx scripts/reconcile-skills.ts  # writes content/skill_reconciliation.csv (a worklist, not a fix)
npx tsx scripts/convert.ts [--draft] [--strict-ladder]   # content/*.csv -> data/dataset.json
npx tsx --test scripts/lib/*.test.ts scripts/*.test.ts   # unit tests for the mini-syntax parsers etc.
```

`--draft` downgrades blank `subject`/`family`/`boundary` and unresolved legacy skill
references to warnings (the app needs a loadable dataset; those are authoring backlog,
not defects). `data/dataset.json` is always written, even on validation failure —
check the printed report, or the JSON's own `_valid`/`_draft`/`_error_count`/
`_warning_count` fields.

## App

```
cd app
npm install
npm run dev       # http://localhost:5173
npm run build     # type-checks (tsc -b) then production build to app/dist
```

The app statically imports `../data/dataset.json` at build time — regenerate it with
`convert.ts` first if you've changed `content/`. It renders an invalid/draft dataset
without complaint (a status badge in the header shows the error/warning counts);
**Build mode** (character state, canvas, requirement-closure detail card, compound
advantages, cost, save/load) and **Author mode** (edit any node, accept
`subject_suggested`/`family_suggested`, live validation, export changed CSV rows) are
both available from the toggle in the header.
