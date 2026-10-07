import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createLearningLibrary, LearningError, MAX_CONTEXT_CHARACTERS, type ContextOptions, type RetrievalQuery,
} from "@pi-vista/learning";
import { EXPECTED, QUERY, SUBJECTS, learningFixture, ownerFixture, sampleObservation, verifiedExperience } from "./learning.fixtures.js";
const fails = (code: string) => (error: unknown) => error instanceof LearningError && error.code === code;

test("selection accepts only valid minted verified/trusted handles and deterministic ranking ignores model identity", async () => {
  const f = await learningFixture(); const a = await verifiedExperience(f.library, f.owner, "experience-a"); const z = await verifiedExperience(f.library, f.owner, "experience-z");
  const zPlan = f.library.preparePromotion(z, "fixture-bank"); const trusted = await f.library.commitPromotion(zPlan, { preview_digest: zPlan.preview_digest });
  const result = f.library.retrieve([a, f.verified, trusted, a], { ...QUERY, limit: 2 });
  assert.equal(result.authorization, "none"); assert.equal(result.mode, "offline-selection");
  assert.deepEqual(result.handles.map(handle => handle.experience_id), ["experience-z", "experience-1"]); assert.equal(result.rejected.limit, 1);
  const reversed = f.library.retrieve([trusted, f.verified, a], { ...QUERY, limit: 2 });
  assert.deepEqual(reversed.handles, result.handles); assert.equal(f.owner.calls.gate, 4);
});
test("exact task matches outrank applicable task patterns, then trust and lexical ID break ties", async () => {
  const f = await learningFixture(); const related = await verifiedExperience(f.library, f.owner, "related-pattern");
  const relatedPlan = f.library.preparePromotion(related, "fixture-bank"); const trustedRelated = await f.library.commitPromotion(relatedPlan, { preview_digest: relatedPlan.preview_digest });
  const exactInput = sampleObservation("exact-pattern"); (exactInput as any).task_type = "metadata-repair"; (exactInput.script as any).task_type = "metadata-repair";
  const candidate = f.library.nominate(f.library.observe(exactInput)); const exact = f.library.verifyCandidate(candidate, await f.owner.verifier.verify(EXPECTED, SUBJECTS));
  assert.deepEqual(f.library.retrieve([trustedRelated, exact], { ...QUERY, task_type: "metadata-repair" }).handles.map(handle => handle.experience_id), ["exact-pattern", "related-pattern"]);
});
test("observations, candidates, status-labelled docs, copied proofs/handles, raw values and hostile proxies never select", async () => {
  const f = await learningFixture(); const observed = f.library.observe(sampleObservation("observed")); const candidate = f.library.nominate(f.library.observe(sampleObservation("candidate")));
  let traps = 0; const proxy = new Proxy({}, { get: () => { traps++; throw Error(); }, ownKeys: () => { traps++; throw Error(); } });
  const result = f.library.retrieve([observed, candidate, { ...f.verified }, JSON.parse(JSON.stringify(f.verified)), { status: "trusted", content: "raw document" }, "raw model prose", null, proxy, f.verified], QUERY);
  assert.deepEqual(result.handles.map(handle => handle.experience_id), ["experience-1"]); assert.equal(result.rejected.unverified, 8); assert.equal(traps, 0);
});
test("expired evidence and invalidated lifecycle versions are excluded without refetching or using recorded flags", async () => {
  const f = await learningFixture(); const before = { ...f.owner.calls }; f.owner.setNow(15_000);
  const stale = f.library.retrieve([f.verified], QUERY); assert.equal(stale.handles.length, 0); assert.equal(stale.rejected.stale, 1); assert.deepEqual(f.owner.calls, before);
  const g = await learningFixture(); const plan = g.library.preparePromotion(g.verified, "fixture-bank"); const trusted = await g.library.commitPromotion(plan, { preview_digest: plan.preview_digest });
  const result = g.library.retrieve([g.verified, trusted], QUERY); assert.equal(result.rejected.stale, 1); assert.equal(result.handles[0], trusted);
});
for (const field of ["repo", "source_sha", "policy_version", "env_fingerprint"] as const) {
  test(`retrieval excludes cross-${field} proof even when it is factory-minted`, async () => {
    const f = await learningFixture(); const query = { ...QUERY, [field]: field === "source_sha" ? "d".repeat(40) : "other-binding" };
    const result = f.library.retrieve([f.verified], query); assert.equal(result.handles.length, 0); assert.equal(result.rejected.mismatch, 1);
  });
}
test("fresh cross-run reuse is allowed only with matching repo/source/policy/environment provenance", async () => {
  const f = await learningFixture(); const nextBinding = { ...EXPECTED, run_id: "run-2" };
  for (const kind of ["gate", "test", "guard"] as const) { f.owner.payloads[kind].run_id = "run-2"; f.owner.seal(kind); }
  const candidate = f.library.nominate(f.library.observe(sampleObservation("second-run", nextBinding)));
  const next = f.library.verifyCandidate(candidate, await f.owner.verifier.verify(nextBinding, SUBJECTS));
  const context = f.library.compileContext(f.library.retrieve([next, f.verified], QUERY));
  assert.deepEqual(context.provenance.map(source => source.run_id), ["run-1", "run-2"]); assert.equal(context.authorization, "none");
});
test("rejected/deprecated/superseded records and unrelated task types are excluded", async () => {
  const f = await learningFixture(); const a = await verifiedExperience(f.library, f.owner, "pattern-a"); const b = await verifiedExperience(f.library, f.owner, "pattern-b");
  const rejected = f.library.reject(f.verified); const superseded = f.library.supersede(a, b);
  const plan = f.library.preparePromotion(b, "fixture-bank"); const deprecated = f.library.deprecate(await f.library.commitPromotion(plan, { preview_digest: plan.preview_digest }));
  const result = f.library.retrieve([rejected, superseded, deprecated], QUERY); assert.equal(result.handles.length, 0); assert.equal(result.rejected.lifecycle, 3);
  const c = await verifiedExperience(f.library, f.owner, "pattern-c");
  assert.equal(f.library.retrieve([c], { ...QUERY, task_type: "unrelated-task" }).rejected.task, 1);
});
test("model-agnostic context contains bounded script/step metadata and exact receipt/binding provenance", async () => {
  const f = await learningFixture(); const selection = f.library.retrieve([f.verified], QUERY); const context = f.library.compileContext(selection);
  assert.equal(context.authorization, "none"); assert.equal(context.budget_unit, "characters"); assert.equal(context.character_count, context.content.length);
  assert.ok(context.content.startsWith("authorization=none\n")); assert.ok(context.content.includes("characters-not-tokens"));
  assert.equal(context.item_count, 1); assert.equal(context.provenance[0]!.run_id, EXPECTED.run_id); assert.equal(context.provenance[0]!.source_sha, EXPECTED.source_sha);
  assert.equal(context.provenance[0]!.receipt_digests.length, 3); assert.ok(context.content.includes("inspect bounded metadata"));
  assert.ok(!context.content.includes("model-fixture")); assert.ok(!context.content.includes("signature")); assert.ok(!context.content.includes("repair_action_id"));
  assert.ok(context.character_count <= context.max_characters);
});
test("character and item budgets omit whole entries without truncating safety labels or provenance", async () => {
  const f = await learningFixture(); const b = await verifiedExperience(f.library, f.owner, "experience-b"); const selection = f.library.retrieve([f.verified, b], QUERY);
  const tiny = f.library.compileContext(selection, { max_characters: 128 }); assert.equal(tiny.item_count, 0); assert.equal(tiny.omitted_ids.length, 2); assert.ok(tiny.character_count <= 128);
  const one = f.library.compileContext(selection, { max_items: 1, max_characters: MAX_CONTEXT_CHARACTERS }); assert.equal(one.item_count, 1); assert.equal(one.omitted_ids.length, 1);
  const exact = f.library.compileContext(selection, { max_characters: one.character_count }); assert.equal(exact.character_count, one.character_count); assert.equal(exact.item_count, 1);
  assert.deepEqual(exact.provenance, one.provenance);
});
test("copied/foreign/expired/lifecycle-invalidated selections cannot be compiled", async () => {
  const f = await learningFixture(); const selection = f.library.retrieve([f.verified], QUERY);
  assert.throws(() => f.library.compileContext({ ...selection }), fails("stale-selection"));
  const other = createLearningLibrary({ verifier: f.owner.verifier }); assert.throws(() => other.compileContext(selection), fails("stale-selection"));
  f.owner.setNow(15_000); assert.throws(() => f.library.compileContext(selection), fails("stale-selection"));
  const g = await learningFixture(); const selected = g.library.retrieve([g.verified], QUERY); g.library.reject(g.verified);
  assert.throws(() => g.library.compileContext(selected), fails("stale-selection"));
});
test("query/context bounds and unknown authority-like fields reject, never expanding raw context", async () => {
  const f = await learningFixture(); const selection = f.library.retrieve([f.verified], QUERY);
  for (const query of [{ ...QUERY, limit: 0 }, { ...QUERY, limit: 17 }, { ...QUERY, limit: undefined }, { ...QUERY, task_type: "/private/fixture" }, { ...QUERY, verified: true }]) {
    assert.throws(() => f.library.retrieve([f.verified], query as RetrievalQuery), fails("invalid-input"));
  }
  for (const options of [{ max_characters: 127 }, { max_characters: MAX_CONTEXT_CHARACTERS + 1 }, { max_items: 0 }, { max_items: 17 }, { max_characters: Infinity }, { max_characters: undefined }, { token_limit: 100 }]) {
    assert.throws(() => f.library.compileContext(selection, options as ContextOptions), fails("invalid-input"));
  }
});
test("offline synthetic evaluation reports successful selection, stale/unverified rejection, coverage and actual context size", async () => {
  const f = await learningFixture(); const unverified = f.library.observe(sampleObservation("unverified"));
  const old = await verifiedExperience(f.library, f.owner, "old-verified"); const rejected = f.library.reject(old);
  const pool = [f.verified, unverified, old, rejected, { ...f.verified }]; const before = { ...f.owner.calls }; const calls = f.transport.counts();
  const result = f.library.evaluateRetrieval(pool, [
    { case_id: "select-known-fixture", query: QUERY, expected_ids: ["experience-1"] },
    { case_id: "reject-mismatch", query: { ...QUERY, policy_version: "other-policy" }, expected_ids: [] },
    { case_id: "bounded-context", query: QUERY, expected_ids: ["experience-1"], context: { max_characters: 128 } },
    { case_id: "missing-coverage", query: QUERY, expected_ids: ["experience-1", "unverified"] },
  ]);
  assert.equal(result.authorization, "none"); assert.equal(result.evaluation, "offline-fixtures"); assert.equal(result.capability_claim, "none");
  assert.equal(result.successful_selections, 3); assert.equal(result.expected_count, 4); assert.equal(result.matched_count, 3); assert.equal(result.coverage, 0.75);
  assert.equal(result.cases[0]!.rejected.unverified, 2); assert.equal(result.cases[0]!.rejected.stale, 1); assert.equal(result.cases[0]!.rejected.lifecycle, 1);
  assert.equal(result.cases[0]!.context_items, 1); assert.equal(result.cases[0]!.context_steps, 2); assert.equal(result.cases[2]!.context_items, 0);
  assert.equal(result.context_characters, result.cases.reduce((sum, row) => sum + row.context_characters, 0));
  assert.deepEqual(f.owner.calls, before); assert.deepEqual(f.transport.counts(), calls);
});
test("expired known fixture cannot produce successful expected-selection evidence", async () => {
  const f = await learningFixture(); f.owner.setNow(15_000);
  const result = f.library.evaluateRetrieval([f.verified], [{ case_id: "expired-fixture", query: QUERY, expected_ids: ["experience-1"] }]);
  assert.equal(result.successful_selections, 0); assert.equal(result.coverage, 0); assert.equal(result.cases[0]!.rejected.stale, 1);
});
test("evaluation fixtures are bounded closed snapshots, reject duplicates/undefined, and do not trust expected IDs", async () => {
  const f = await learningFixture(); const testCase = { case_id: "fixture-case", query: QUERY, expected_ids: ["experience-1"] };
  for (const cases of [[], [testCase, testCase], Array(17).fill(testCase), [{ ...testCase, expected_ids: ["experience-1", "experience-1"] }], [{ ...testCase, context: undefined }], [{ ...testCase, trusted: true }]]) {
    assert.throws(() => f.library.evaluateRetrieval([f.verified], cases as any), fails("invalid-input"));
  }
  const result = f.library.evaluateRetrieval([{ status: "verified", experience_id: "experience-1" }], [testCase]);
  assert.equal(result.successful_selections, 0); assert.equal(result.coverage, 0); assert.equal(result.cases[0]!.rejected.unverified, 1);
});
