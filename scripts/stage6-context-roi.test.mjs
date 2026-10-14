import test from "node:test";
import assert from "node:assert/strict";
import { analyzeStage6ContextRoi, validateStage6ContextRoi } from "./stage6-context-roi.mjs";
const arm = (overrides = {}) => ({ runs: 4, successes: 4, trace_accurate: 4, decision_parsed: 4, elapsed_ms: 1000, tokens: 100, reasoning_tokens: null, tool_calls: 4, human_interventions: 0, sdk_cost: null, cost_priced: false, unknown_runs: 0, ...overrides });
const input = (baseline = {}, guided = {}, context = {}) => ({ baseline: arm(baseline), guided: arm(guided), context: { baseline_characters: 0, guided_characters: 1467, compile_ms: 3, profile_drift: "unchanged", evaluation_status: "measured", ...context } });
test("actual single-window result recommends no injection when guidance adds tokens without semantic gain", () => {
  const r = analyzeStage6ContextRoi(input({ tokens: 6415, elapsed_ms: 26814.273751 }, { tokens: 10251, elapsed_ms: 22711.59425 }));
  assert.equal(r.status, "not-beneficial"); assert.equal(r.recommendation, "do-not-inject"); assert.equal(r.reason_code, "negative-context-roi"); assert.equal(r.semantic_gain, 0); assert.equal(r.token_delta, 3836); assert.equal(r.context_delta_chars, 1467); assert.equal(r.cost_status, "unpriced"); assert.equal(r.non_degradation, true); assert.equal(r.authorization, "none"); assert.equal(r.executable, false);
  assert.deepEqual(validateStage6ContextRoi(JSON.parse(JSON.stringify(r))), r);
});
test("semantic gain can yield only a candidate, never permission or default activation", () => {
  const r = analyzeStage6ContextRoi(input({ successes: 2, tokens: 6415 }, { successes: 3, tokens: 7000 }));
  assert.equal(r.status, "candidate"); assert.equal(r.recommendation, "inject-candidate"); assert.equal(r.semantic_gain, 1); assert.equal(r.verification, "metadata-only"); assert.equal(Object.hasOwn(r, "permission"), false);
});
test("unknown, drift and mismatched denominators require more collection", () => {
  for (const context of [{ evaluation_status: "unknown" }, { profile_drift: "unknown" }, { profile_drift: "protected-profile-drift" }, { profile_drift: "volatile-profile-drift-unknown-attribution" }]) assert.equal(analyzeStage6ContextRoi(input({}, {}, context)).recommendation, "collect-more");
  assert.equal(analyzeStage6ContextRoi(input({ runs: 4 }, { runs: 3, successes: 3, trace_accurate: 3, decision_parsed: 3 })).reason_code, "evaluation-unknown");
});
test("unpriced or zero-baseline costs never become free or a fabricated amount", () => {
  const r = analyzeStage6ContextRoi(input({ tokens: 0, cost_priced: false }, { tokens: 0, cost_priced: false }, { guided_characters: 0 }));
  assert.equal(r.cost_status, "unpriced"); assert.equal(r.token_overhead_ratio, null); assert.equal(r.status, "not-beneficial");
  assert.equal(Object.hasOwn(r, "cost"), false); assert.equal(Object.hasOwn(r, "price"), false);
});
test("regression cannot be rescued by token savings or a gain in another quality dimension", () => {
  const a = analyzeStage6ContextRoi(input({ successes: 3, tokens: 100 }, { successes: 2, tokens: 50 }));
  assert.equal(a.recommendation, "do-not-inject"); assert.equal(a.reason_code, "semantic-regression"); assert.equal(a.non_degradation, false);
  const b = analyzeStage6ContextRoi(input({ successes: 2 }, { successes: 3, trace_accurate: 3 }));
  assert.equal(b.recommendation, "do-not-inject"); assert.equal(b.non_degradation, false);
});
test("unobserved compile time stays null and copied results reject unsafe or contradictory fields", () => {
  const r = analyzeStage6ContextRoi(input({}, { tokens: 150 }, { compile_ms: null })); assert.equal(r.compile_ms, null);
  for (const patch of [{ reason_code: "PRIVATE_RAW" }, { token_delta: Infinity }, { baseline_tokens: {} }, { recommendation: "inject-candidate" }, { token_delta: -100 }, { permission: true }, { status: "candidate", recommendation: "inject-candidate", reason_code: "semantic-gain-observed", non_degradation: false }, { non_degradation: false }]) assert.throws(() => validateStage6ContextRoi({ ...r, ...patch }), /stage6-context-roi-refused/);
});
test("tool/reasoning/parsed/human deltas are preserved and token savings alone remain a candidate", () => {
  const r = analyzeStage6ContextRoi(input({ reasoning_tokens: 168, tool_calls: 8 }, { reasoning_tokens: 180, tool_calls: 9 }));
  assert.equal(r.reasoning_tokens_delta, 12); assert.equal(r.tool_calls_delta, 1); assert.equal(r.decision_parsed_delta, 0); assert.equal(r.human_interventions_delta, 0);
  const saving = analyzeStage6ContextRoi(input({ tokens: 100 }, { tokens: 50 })); assert.equal(saving.status, "candidate"); assert.equal(saving.reason_code, "token-saving-observed"); assert.deepEqual(validateStage6ContextRoi(saving), saving);
});
test("closed DTO rejects raw prompts, model output, credentials, proxies, getters and extras", () => {
  let calls = 0; const value = input(); const proxy = new Proxy(value, { ownKeys() { calls++; throw Error(); } }); assert.throws(() => analyzeStage6ContextRoi(proxy), /stage6-context-roi-refused/);
  const getter = Object.defineProperty(value, "baseline", { get() { calls++; throw Error(); } }); assert.throws(() => analyzeStage6ContextRoi(getter), /stage6-context-roi-refused/); assert.equal(calls, 0);
  assert.throws(() => analyzeStage6ContextRoi({ ...input(), prompt: "PRIVATE" }), /stage6-context-roi-refused/);
});
test("import has no model/bank/network work", async () => {
  const source = await (await import("node:fs/promises")).readFile(new URL("./stage6-context-roi.mjs", import.meta.url), "utf8"); assert.doesNotMatch(source, /from ["'](?:node:fs|node:http|node:https|node:child_process)/u); assert.doesNotMatch(source, /import\s*\(/u);
});
