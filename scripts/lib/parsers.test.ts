import { test } from "node:test";
import assert from "node:assert/strict";
import { parseRequirements, parseSources, parseFusionParents } from "./parsers.ts";

test("parseRequirements: empty field -> empty array, no errors", () => {
  const { value, errors } = parseRequirements("");
  assert.deepEqual(value, []);
  assert.deepEqual(errors, []);
});

test("parseRequirements: whitespace-only field -> empty array, no errors", () => {
  const { value, errors } = parseRequirements("   ");
  assert.deepEqual(value, []);
  assert.deepEqual(errors, []);
});

test("parseRequirements: numeric types require a threshold", () => {
  const { value, errors } = parseRequirements("SKILL_LEVEL:melee_weapons:9");
  assert.equal(errors.length, 0);
  assert.deepEqual(value, [{ type: "SKILL_LEVEL", target: "melee_weapons", threshold: 9 }]);
});

test("parseRequirements: covers all nine requirement types", () => {
  const field = [
    "SKILL_LEVEL:melee_weapons:9",
    "ATTRIBUTE:STR:300",
    "ATTRIBUTE_CEILING:CHA:120",
    "VERB:str_limb_strength:50",
    "TRAIT:elemental_affinity",
    "PRIOR_NODE:sword_focus",
    "CLASS:warrior",
    "CLASS_TIER:warrior:2",
    "INSIGHT:warrior:200",
  ].join(";");
  const { value, errors } = parseRequirements(field);
  assert.deepEqual(errors, []);
  assert.equal(value.length, 9);
  assert.deepEqual(value[0], { type: "SKILL_LEVEL", target: "melee_weapons", threshold: 9 });
  assert.deepEqual(value[4], { type: "TRAIT", target: "elemental_affinity", threshold: null });
  assert.deepEqual(value[6], { type: "CLASS", target: "warrior", threshold: null });
  assert.deepEqual(value[8], { type: "INSIGHT", target: "warrior", threshold: 200 });
});

test("parseRequirements: boolean type omits threshold", () => {
  const { value, errors } = parseRequirements("TRAIT:elemental_affinity");
  assert.equal(errors.length, 0);
  assert.deepEqual(value, [{ type: "TRAIT", target: "elemental_affinity", threshold: null }]);
});

test("parseRequirements: boolean type rejects a threshold", () => {
  const { value, errors } = parseRequirements("TRAIT:elemental_affinity:5");
  assert.equal(value.length, 0);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /boolean type and takes no threshold/);
});

test("parseRequirements: numeric type missing threshold is an error", () => {
  const { value, errors } = parseRequirements("ATTRIBUTE:STR");
  assert.equal(value.length, 0);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /requires a numeric threshold/);
});

test("parseRequirements: non-numeric threshold is an error", () => {
  const { value, errors } = parseRequirements("ATTRIBUTE:STR:abc");
  assert.equal(value.length, 0);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /is not a number/);
});

test("parseRequirements: unknown type is an error", () => {
  const { value, errors } = parseRequirements("NOT_A_TYPE:foo:1");
  assert.equal(value.length, 0);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /unknown requirement type/);
});

test("parseRequirements: missing target is an error", () => {
  const { value, errors } = parseRequirements("TRAIT:");
  assert.equal(value.length, 0);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /missing a target/);
});

test("parseRequirements: multiple entries, one bad, keeps collecting", () => {
  const { value, errors } = parseRequirements("TRAIT:elemental_affinity;NOT_A_TYPE:foo;ATTRIBUTE:STR:300");
  assert.equal(value.length, 2);
  assert.equal(errors.length, 1);
});

test("parseSources: empty field -> empty array, no errors", () => {
  const { value, errors } = parseSources("");
  assert.deepEqual(value, []);
  assert.deepEqual(errors, []);
});

test("parseSources: covers all six source types with trailing fields optional", () => {
  const field = ["TRAINER::150", "TOME::200:1", "GUILD:thieves_guild:75", "CLASS:mage_elementalist", "TRAIT:elemental_affinity", "BREAKTHROUGH::0"].join(
    ";",
  );
  const { value, errors } = parseSources(field);
  assert.deepEqual(errors, []);
  assert.equal(value.length, 6);
  assert.deepEqual(value[0], { type: "TRAINER", target: null, xp_cost: 150, level_loss: null });
  assert.deepEqual(value[1], { type: "TOME", target: null, xp_cost: 200, level_loss: 1 });
  assert.deepEqual(value[3], { type: "CLASS", target: "mage_elementalist", xp_cost: null, level_loss: null });
  assert.deepEqual(value[4], { type: "TRAIT", target: "elemental_affinity", xp_cost: null, level_loss: null });
});

test("parseSources: non-numeric xp_cost is an error", () => {
  const { value, errors } = parseSources("TRAINER::abc");
  assert.equal(value.length, 0);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /xp_cost .* is not a number/);
});

test("parseSources: too many fields is an error", () => {
  const { value, errors } = parseSources("TRAINER:x:1:2:3");
  assert.equal(value.length, 0);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /too many fields/);
});

test("parseSources: unknown type is an error", () => {
  const { value, errors } = parseSources("MAIL_ORDER::10");
  assert.equal(value.length, 0);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /unknown source type/);
});

test("parseFusionParents: empty field -> empty array, no errors", () => {
  const { value, errors } = parseFusionParents("");
  assert.deepEqual(value, []);
  assert.deepEqual(errors, []);
});

test("parseFusionParents: all four dispositions", () => {
  const field = "a:INTEGRATED;b:PREREQUISITE_ONLY;c:DEFERRED_SEED;d:REJECTED";
  const { value, errors } = parseFusionParents(field);
  assert.deepEqual(errors, []);
  assert.deepEqual(value, [
    { feat_id: "a", disposition: "INTEGRATED" },
    { feat_id: "b", disposition: "PREREQUISITE_ONLY" },
    { feat_id: "c", disposition: "DEFERRED_SEED" },
    { feat_id: "d", disposition: "REJECTED" },
  ]);
});

test("parseFusionParents: unknown disposition is an error", () => {
  const { value, errors } = parseFusionParents("sword_focus:MAYBE");
  assert.equal(value.length, 0);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /unknown disposition/);
});

test("parseFusionParents: malformed entry (missing disposition) is an error", () => {
  const { value, errors } = parseFusionParents("sword_focus");
  assert.equal(value.length, 0);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /must be "feat_id:DISPOSITION"/);
});

test("parseFusionParents: worked example from authoring-columns.md", () => {
  const field = "sword_focus:INTEGRATED;sword_guard:INTEGRATED;combat_initiative:DEFERRED_SEED";
  const { value, errors } = parseFusionParents(field);
  assert.deepEqual(errors, []);
  assert.equal(value.length, 3);
});
