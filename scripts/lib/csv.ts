/**
 * Minimal RFC4180-ish CSV read/write: quoted fields, embedded commas/newlines,
 * escaped quotes (""), and leading `#`-comment lines (skipped, used by the
 * effect_ladder.generated.csv "# UNCONFIRMED" marker).
 */

export interface CsvRow {
  [column: string]: string;
}

export interface ParsedCsv {
  header: string[];
  rows: CsvRow[];
  /** 1-indexed data row number matching each entry in `rows` (header = row 1). */
  rowNumbers: number[];
}

function parseLine(line: string): string[] {
  const fields: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      fields.push(field);
      field = "";
    } else {
      field += ch;
    }
  }
  fields.push(field);
  return fields;
}

/** Splits raw CSV text into logical records, respecting quoted newlines. */
function splitRecords(text: string): string[] {
  const records: string[] = [];
  let record = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') inQuotes = !inQuotes;
    if ((ch === "\n") && !inQuotes) {
      records.push(record);
      record = "";
    } else if (ch !== "\r") {
      record += ch;
    }
  }
  if (record.length > 0) records.push(record);
  return records;
}

export function parseCsv(text: string): ParsedCsv {
  const allRecords = splitRecords(text);
  // Skip leading `#`-comment lines (e.g. the effect_ladder.generated.csv marker).
  const records = allRecords.filter((r) => !r.startsWith("#"));
  if (records.length === 0) return { header: [], rows: [], rowNumbers: [] };

  const header = parseLine(records[0]);
  const rows: CsvRow[] = [];
  const rowNumbers: number[] = [];

  for (let i = 1; i < records.length; i++) {
    const raw = records[i];
    if (raw.trim() === "") continue;
    const fields = parseLine(raw);
    const row: CsvRow = {};
    header.forEach((col, idx) => {
      row[col] = fields[idx] ?? "";
    });
    rows.push(row);
    rowNumbers.push(i + 1); // 1-indexed, header is row 1
  }

  return { header, rows, rowNumbers };
}

function escapeField(value: string): string {
  if (value.includes(",") || value.includes('"') || value.includes("\n")) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

export function stringifyCsv(header: string[], rows: CsvRow[]): string {
  const lines = [header.map(escapeField).join(",")];
  for (const row of rows) {
    lines.push(header.map((col) => escapeField(row[col] ?? "")).join(","));
  }
  return lines.join("\n") + "\n";
}
