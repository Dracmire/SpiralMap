import { test } from "node:test";
import assert from "node:assert/strict";
import { deslug, levenshtein, similarity, bestMatch } from "./text.ts";

test("deslug: underscores become spaces, each word title-cased", () => {
  assert.equal(deslug("heavy_weapons_handling"), "Heavy Weapons Handling");
  assert.equal(deslug("sense_motive"), "Sense Motive");
  assert.equal(deslug("shield"), "Shield");
});

test("levenshtein: identical strings", () => {
  assert.equal(levenshtein("abc", "abc"), 0);
});

test("levenshtein: one substitution", () => {
  assert.equal(levenshtein("abc", "abd"), 1);
});

test("levenshtein: empty string against non-empty", () => {
  assert.equal(levenshtein("", "abc"), 3);
  assert.equal(levenshtein("abc", ""), 3);
});

test("similarity: identical strings (case-insensitive) is 1", () => {
  assert.equal(similarity("Shield", "shield"), 1);
});

test("similarity: completely different strings is low", () => {
  assert.ok(similarity("Shield", "Astrology") < 0.3);
});

test("similarity: partial overlap is between 0 and 1", () => {
  const s = similarity("Heavy Weapons Handling", "Melee Weapons");
  assert.ok(s > 0 && s < 1);
});

test("bestMatch: picks the closest candidate", () => {
  const result = bestMatch("Shield", ["Astrology", "Shield", "Sleight of Hand"]);
  assert.equal(result?.candidate, "Shield");
  assert.equal(result?.similarity, 1);
});

test("bestMatch: empty candidate list returns null", () => {
  assert.equal(bestMatch("Shield", []), null);
});
