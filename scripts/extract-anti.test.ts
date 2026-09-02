import { test } from "node:test";
import assert from "node:assert/strict";
import {
  slug,
  isTruncatedTail,
  parseBulletLine,
  parseCounterLine,
  parseReqLine,
  isPlaceholderText,
  cellPlainText,
} from "./lib/anti-grid.ts";

test("cellPlainText: plain string/number pass through", () => {
  assert.equal(cellPlainText("Scarecrow"), "Scarecrow");
  assert.equal(cellPlainText(140), "140");
  assert.equal(cellPlainText(null), "");
  assert.equal(cellPlainText(undefined), "");
});

test("cellPlainText: richText runs are concatenated", () => {
  const value = { richText: [{ text: "* - " }, { text: "Counter" }, { text: ": en" }] };
  assert.equal(cellPlainText(value), "* - Counter: en");
});

test("slug: lowercases and underscores", () => {
  assert.equal(slug("Harmless Fatale"), "harmless_fatale");
  assert.equal(slug("Freakshow"), "freakshow");
  assert.equal(slug("  Threatening   Presence!! "), "threatening_presence");
});

test("isTruncatedTail: empty is truncated", () => {
  assert.equal(isTruncatedTail(""), true);
  assert.equal(isTruncatedTail("   "), true);
});

test("isTruncatedTail: short fragment without sentence punctuation is truncated", () => {
  assert.equal(isTruncatedTail("cu"), true);
  assert.equal(isTruncatedTail("en"), true);
  assert.equal(isTruncatedTail("c"), true);
  assert.equal(isTruncatedTail("Las"), true);
});

test("isTruncatedTail: real prose is not truncated", () => {
  assert.equal(isTruncatedTail("resistance is halved against evil-aligned targets."), false);
  assert.equal(isTruncatedTail("ok!"), false);
});

test("isTruncatedTail: short fragment ending in sentence punctuation is not flagged", () => {
  assert.equal(isTruncatedTail("no."), false);
});

test("parseBulletLine: numeric CAR line", () => {
  const result = parseBulletLine("* - CAR 120: cu");
  assert.equal(result.threshold, 120);
  assert.equal(result.tail, "cu");
  assert.equal(result.truncated, true);
});

test("parseBulletLine: BASE line (Rare tier) has no numeric threshold", () => {
  const result = parseBulletLine("* - BASE: en");
  assert.equal(result.threshold, null);
  assert.equal(result.tail, "en");
  assert.equal(result.truncated, true);
});

test("parseBulletLine: full untruncated tail is not flagged", () => {
  const result = parseBulletLine("* - INT 115: bonus against evil creatures.");
  assert.equal(result.threshold, 115);
  assert.equal(result.truncated, false);
});

test("parseBulletLine: unparseable line", () => {
  const result = parseBulletLine("nonsense");
  assert.equal(result.threshold, null);
  assert.equal(result.truncated, true);
});

test("parseCounterLine: truncated Counter line", () => {
  const result = parseCounterLine("* - Counter: en");
  assert.equal(result.tail, "en");
  assert.equal(result.truncated, true);
});

test("parseCounterLine: bare Counter line with nothing after", () => {
  const result = parseCounterLine("* - Counter:");
  assert.equal(result.tail, "");
  assert.equal(result.truncated, true);
});

test("parseCounterLine: full text is not flagged", () => {
  const result = parseCounterLine("* - Counter: rolls requiring trust are penalised.");
  assert.equal(result.truncated, false);
});

test("parseReqLine: spaced plus", () => {
  assert.deepEqual(parseReqLine("REQ: Intimidating Presence + Stereotyping"), ["Intimidating Presence", "Stereotyping"]);
});

test("parseReqLine: unspaced plus and trailing whitespace", () => {
  assert.deepEqual(parseReqLine("REQ: Stone Mask +Clown Ears"), ["Stone Mask", "Clown Ears"]);
  assert.deepEqual(parseReqLine("REQ: The Bore + Scarecrow "), ["The Bore", "Scarecrow"]);
});

test("parseReqLine: not a REQ line returns null", () => {
  assert.equal(parseReqLine("* - Counter: en"), null);
});

test("parseReqLine: malformed (not exactly two parents) returns null", () => {
  assert.equal(parseReqLine("REQ: OnlyOneParent"), null);
  assert.equal(parseReqLine("REQ: A + B + C"), null);
});

test("isPlaceholderText: question-mark placeholders", () => {
  assert.equal(isPlaceholderText("??????"), true);
  assert.equal(isPlaceholderText("?????"), true);
  assert.equal(isPlaceholderText("????"), true);
  assert.equal(isPlaceholderText("real description text"), false);
});
