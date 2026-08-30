/**
 * Pure helpers for flattening the "Anti" sheet's spatial grid — no workbook I/O,
 * so these are testable without exceljs or the real file (scripts/extract-anti.test.ts).
 */

/** exceljs cell values are sometimes plain strings/numbers, sometimes {richText:[...]}. */
export function cellPlainText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "object" && value !== null && "richText" in (value as Record<string, unknown>)) {
    const runs = (value as { richText: { text: string }[] }).richText;
    return runs.map((r) => r.text).join("");
  }
  return String(value);
}

export function slug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

/**
 * Narrow, purpose-built heuristic for THIS sheet's corruption pattern
 * (`* - CAR 120: cu`, `* - Counter: en`, `* - Counter:` with nothing at all) —
 * not a general truncation detector. A tail is "truncated" when it's empty, or
 * is <=4 characters and doesn't end in sentence punctuation.
 */
export function isTruncatedTail(tail: string): boolean {
  const t = tail.trim();
  if (t === "") return true;
  if (t.length <= 4 && !/[.!?]$/.test(t)) return true;
  return false;
}

export interface BulletLine {
  /** null for the Rare tier's "* - BASE: ..." line, which has no numeric threshold. */
  threshold: number | null;
  tail: string;
  truncated: boolean;
}

/** Parses row N+3's bullet line: `* - CAR 120: cu` or `* - BASE: en` (Rare tier). */
export function parseBulletLine(raw: string): BulletLine {
  const text = raw.trim();
  const baseMatch = text.match(/^\*\s*-\s*BASE\s*:\s*(.*)$/i);
  if (baseMatch) {
    return { threshold: null, tail: baseMatch[1], truncated: isTruncatedTail(baseMatch[1]) };
  }
  const numMatch = text.match(/^\*\s*-\s*[A-Z]+\s+(\d+)\s*:\s*(.*)$/i);
  if (numMatch) {
    return { threshold: Number(numMatch[1]), tail: numMatch[2], truncated: isTruncatedTail(numMatch[2]) };
  }
  return { threshold: null, tail: "", truncated: true };
}

export interface CounterLine {
  tail: string;
  truncated: boolean;
}

/** Parses row N+4's Counter line: `* - Counter: en` (Common/Uncommon tiers only). */
export function parseCounterLine(raw: string): CounterLine {
  const text = raw.trim();
  const match = text.match(/^\*\s*-\s*Counter\s*:\s*(.*)$/i);
  if (!match) return { tail: "", truncated: true };
  return { tail: match[1], truncated: isTruncatedTail(match[1]) };
}

/** Splits a `REQ: Parent1 + Parent2` line (Rare tier only). Handles spaced/unspaced `+`. */
export function parseReqLine(raw: string): [string, string] | null {
  const match = raw.trim().match(/^REQ\s*:\s*(.*)$/i);
  if (!match) return null;
  const parts = match[1].split(/\s*\+\s*/).map((s) => s.trim()).filter((s) => s !== "");
  if (parts.length !== 2) return null;
  return [parts[0], parts[1]];
}

/** `??????`/`?????`/`????` placeholder description text found on 5 of 6 Rare tiers. */
export function isPlaceholderText(text: string): boolean {
  return /^\?{3,}$/.test(text.trim());
}
