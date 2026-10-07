import { test } from "node:test";
import assert from "node:assert/strict";
import { createLearningLibrary, HINDSIGHT_CUSTOM_PAGES, MAX_CONTEXT_CHARACTERS, type LearningLibrary, type SafeScript, type SafeStep } from "@pi-vista/learning";
import type { VistaScript, VistaStep } from "@pi-vista/protocol";
import { QUERY, learningFixture } from "./learning.fixtures.js";

// The readonly safe subset preserves protocol field spellings without promising executable steps.
const compatibleScript = (value: SafeScript): Readonly<Pick<VistaScript, "task_type" | "description">> => value;
const compatibleStep = (value: SafeStep): Readonly<Pick<VistaStep, "step_id" | "tool" | "action_description" | "expected_result" | "on_failure">> => value;

test("public ESM import and generated API support full synthetic promotion/retrieval/context handoff", async () => {
  const f = await learningFixture(); const library: LearningLibrary = f.library;
  assert.equal(typeof createLearningLibrary, "function"); assert.equal(compatibleScript(f.verified.script).task_type, "metadata-update");
  assert.equal(compatibleStep(f.verified.steps[0]!).step_id, "step-1");
  const plan = library.preparePromotion(f.verified, "fixture-bank"); const trusted = await library.commitPromotion(plan, { preview_digest: plan.preview_digest });
  const context = library.compileContext(library.retrieve([trusted], QUERY), { max_characters: MAX_CONTEXT_CHARACTERS });
  assert.equal(context.provenance[0]!.status, "trusted"); assert.equal(context.item_count, 1); assert.equal(context.authorization, "none");
});
test("compatible customPages snippet is fixed immutable configuration data, not an installer or bank edit", () => {
  assert.deepEqual(Object.keys(HINDSIGHT_CUSTOM_PAGES), ["customPages"]);
  assert.deepEqual(Object.keys(HINDSIGHT_CUSTOM_PAGES.customPages), ["Verified skills", "Failure patterns"]);
  assert.equal(HINDSIGHT_CUSTOM_PAGES.customPages["Verified skills"].tags[0], "knowledge:skill");
  assert.equal(HINDSIGHT_CUSTOM_PAGES.customPages["Failure patterns"].tags[0], "knowledge:failure");
  assert.ok(HINDSIGHT_CUSTOM_PAGES.customPages["Verified skills"].source_query.includes("verified by tests and gate receipts"));
  assert.ok(Object.isFrozen(HINDSIGHT_CUSTOM_PAGES.customPages["Failure patterns"].tags));
  const snippet = JSON.parse(JSON.stringify(HINDSIGHT_CUSTOM_PAGES)); assert.equal(snippet.customPages["Failure patterns"].tags[0], "knowledge:failure");
});
