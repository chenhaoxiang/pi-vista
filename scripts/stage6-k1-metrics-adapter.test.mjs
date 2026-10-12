import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { aggregateK1SDKMeasurements, adaptK1SDKMeasurement } from "./stage6-k1-metrics-adapter.mjs";
import { PAIR_HISTORY_DIGEST, PAIR_ROUND_BUDGET, PAIR_SOURCE_SHA, PAIR_TIMEOUT_MS, pairedOrder } from "./paired-evaluation-data.mjs";

const sha = value => createHash("sha256").update(value).digest("hex");
function measurement(case_id, arm, success = true, offset = 0) {
  const guided = arm === "guided";
  return { case_id, arm, source_sha: PAIR_SOURCE_SHA, harness_source_sha: sha("harness"), provider: "codex-local-8319", model: "gpt-6.1-sol", thinking: "max", sdk: "1.0.4",
    runtime_digest: sha("runtime"), system_prompt_digest: sha("system"), tool_definition_digest: sha("tools"), task_prompt_digest: sha(`task:${case_id}`), timeout_ms: PAIR_TIMEOUT_MS, round_budget: PAIR_ROUND_BUDGET,
    run_identity_digest: sha(`${case_id}:${arm}:run`), session_identity_digest: sha(`${case_id}:${arm}:session`), guidance_mode: guided ? "historical-observed" : "none", history_digest: guided ? PAIR_HISTORY_DIGEST : null,
    context_digest: guided ? sha(`context:${case_id}`) : null, history_current_verification: guided ? "not-checked" : "none", guidance_reimported: guided, guidance_currently_verified: guided, authorization: "none", executable: false,
    success, failure_category: success ? "none" : "fixture-mismatch", trace_accuracy: success, decision_parsed: success, disagreement_count: 0, elapsed_ms: 100 + offset, request_attempts: 1, retry_count: 0, cancelled: false,
    tool_calls: 1, human_interventions: 0, output_digest: sha(`${case_id}:${arm}:output`) };
}
function usage({ reasoning, costTotal = 0, cacheWrite1h, extra = {} } = {}) {
  return { input: 10, output: 5, cacheRead: 0, cacheWrite: 0, totalTokens: 15, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: costTotal, total: costTotal },
    ...(cacheWrite1h === undefined ? {} : { cacheWrite1h }), ...(reasoning === undefined ? {} : { reasoning }), ...extra };
}
function records() { return pairedOrder().map(({ case_id, arm }) => ({ measurement: measurement(case_id, arm, true), usage: usage() })); }

test("adapter derives exact paired tokens from public Usage without recalculating total or adding subsets", () => {
  const row = adaptK1SDKMeasurement({ measurement: measurement("healthy-metadata", "baseline"), usage: usage({ reasoning: 0, cacheWrite1h: 0 }) });
  assert.deepEqual(row.tokens, { input: 10, output: 5, cacheRead: 0, cacheWrite: 0, reasoning: 0, total: 15 });
  assert.equal(row.sdk_cost, null); assert.equal(row.cost_priced, false);
});
test("missing or undefined optional reasoning becomes null while required Usage fields never receive defaults", () => {
  assert.equal(adaptK1SDKMeasurement({ measurement: measurement("healthy-metadata", "baseline"), usage: usage() }).tokens.reasoning, null);
  assert.equal(adaptK1SDKMeasurement({ measurement: measurement("healthy-metadata", "baseline"), usage: usage({ extra: { reasoning: undefined } }) }).tokens.reasoning, null);
  for (const key of ["input", "output", "cacheRead", "cacheWrite", "totalTokens", "cost"]) {
    const value = usage(); delete value[key]; assert.throws(() => adaptK1SDKMeasurement({ measurement: measurement("healthy-metadata", "baseline"), usage: value }), /stage6-k1-metrics-refused/);
  }
});
test("subset bounds are checked and never double-counted", () => {
  assert.throws(() => adaptK1SDKMeasurement({ measurement: measurement("healthy-metadata", "baseline"), usage: usage({ reasoning: 6 }) }), /stage6-k1-metrics-refused/);
  assert.throws(() => adaptK1SDKMeasurement({ measurement: measurement("healthy-metadata", "baseline"), usage: usage({ cacheWrite1h: 1 }) }), /stage6-k1-metrics-refused/);
  const row = adaptK1SDKMeasurement({ measurement: measurement("healthy-metadata", "baseline"), usage: { ...usage(), cacheWrite: 5, cacheWrite1h: 2, totalTokens: 20, output: 5 } });
  assert.deepEqual(row.tokens, { input: 10, output: 5, cacheRead: 0, cacheWrite: 5, reasoning: null, total: 20 });
});
test("zero pricing is unpriced; positive SDK estimate is retained without billing claim", () => {
  assert.deepEqual(Object.fromEntries(Object.entries(adaptK1SDKMeasurement({ measurement: measurement("healthy-metadata", "baseline"), usage: usage({ costTotal: 0 }) })).filter(([key]) => ["sdk_cost", "cost_priced"].includes(key))), { sdk_cost: null, cost_priced: false });
  const priced = adaptK1SDKMeasurement({ measurement: measurement("healthy-metadata", "baseline"), usage: usage({ costTotal: 0.0125 }) });
  assert.equal(priced.sdk_cost, 0.0125); assert.equal(priced.cost_priced, true);
});
test("caller cannot provide derived fields, lifecycle-only rows, raw fields or zero-fill Usage", () => {
  for (const key of ["tokens", "sdk_cost", "cost_priced"]) assert.throws(() => adaptK1SDKMeasurement({ measurement: { ...measurement("healthy-metadata", "baseline"), [key]: key === "tokens" ? {} : 0 }, usage: usage() }), /stage6-k1-metrics-refused/);
  assert.throws(() => adaptK1SDKMeasurement({ measurement: { status: "decision-valid", intercepted_fetch: 2 }, usage: usage() }), /stage6-k1-metrics-refused/);
  assert.throws(() => adaptK1SDKMeasurement({ measurement: measurement("healthy-metadata", "baseline"), usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0 } }), /stage6-k1-metrics-refused/);
  assert.throws(() => adaptK1SDKMeasurement({ measurement: measurement("healthy-metadata", "baseline"), usage: usage({ extra: { raw: "PRIVATE" } }) }), /stage6-k1-metrics-refused/);
});
test("malformed, nonnumeric, negative and nonfinite Usage refuses without coercion", () => {
  for (const bad of [{ input: -1 }, { output: 1.5 }, { totalTokens: Number.NaN }, { totalTokens: Number.MAX_SAFE_INTEGER + 1 }, { reasoning: "0" }, { reasoning: null }, { cost: { ...usage().cost, total: Number.POSITIVE_INFINITY } }, { cost: { ...usage().cost, input: -1 } }, { cost: { ...usage().cost, total: "0" } }]) {
    const value = { ...usage(), ...bad };
    assert.throws(() => adaptK1SDKMeasurement({ measurement: measurement("healthy-metadata", "baseline"), usage: value }), /stage6-k1-metrics-refused/);
  }
  let calls = 0; const input = usage(); Object.defineProperty(input, "output", { get() { calls++; throw Error("PRIVATE"); } });
  assert.throws(() => adaptK1SDKMeasurement({ measurement: measurement("healthy-metadata", "baseline"), usage: input }), /stage6-k1-metrics-refused/); assert.equal(calls, 0);
  const proxy = new Proxy(usage(), { ownKeys() { calls++; throw Error("PRIVATE"); } }); assert.throws(() => adaptK1SDKMeasurement({ measurement: measurement("healthy-metadata", "baseline"), usage: proxy }), /stage6-k1-metrics-refused/); assert.equal(calls, 0);
});
test("aggregate adapter composes complete data into the existing paired aggregator", () => {
  const out = aggregateK1SDKMeasurements(records());
  assert.equal(out.pair_count, 4); assert.equal(out.evaluation_status, "measured"); assert.equal(out.guided.sdk_cost, null); assert.equal(out.guided.reasoning_tokens, null); assert.equal(out.authorization, "none"); assert.equal(out.executable, false);
  assert.throws(() => aggregateK1SDKMeasurements(records().slice(0, 7)));
  const duplicate = records(); duplicate[1] = duplicate[0]; assert.throws(() => aggregateK1SDKMeasurements(duplicate), /stage6-k1-metrics-refused/);
});
test("aggregate refuses lifecycle rows, missing usage and attempts to override derived fields", () => {
  const rows = records();
  for (const index of [0, 1]) { rows[index] = { measurement: { status: "decision-valid", intercepted_fetch: 2 }, usage: usage() }; assert.throws(() => aggregateK1SDKMeasurements(rows), /stage6-k1-metrics-refused/); rows[index] = records()[index]; }
  rows[0] = { measurement: { ...rows[0].measurement, tokens: {} }, usage: usage() }; assert.throws(() => aggregateK1SDKMeasurements(rows), /stage6-k1-metrics-refused/);
});
test("original runtime, source, model, history and budget pins remain unchanged", () => {
  const base = measurement("healthy-metadata", "guided");
  for (const extra of [{ sdk: "1.1.0-fork.1" }, { sdk: "1.0.4-fork.1" }, { thinking: "high" }, { provider: "stage6-matrix-fixture" }, { model: "fixture" }, { source_sha: "a".repeat(40) }, { history_digest: sha("other-history") }, { history_current_verification: "verified" }, { guidance_reimported: false }, { guidance_currently_verified: false }, { request_attempts: 3 }, { retry_count: 1 }, { timeout_ms: 120_000 }, { authorization: "approved" }, { executable: true }]) {
    assert.throws(() => adaptK1SDKMeasurement({ measurement: { ...base, ...extra }, usage: usage() }), /stage6-k1-metrics-refused/);
  }
});
test("unknown/provider/cancellation and unparsed failures remain non-success in the original aggregate", () => {
  const data = records(); data[0].measurement = { ...data[0].measurement, success: false, failure_category: "provider-unavailable", decision_parsed: false, trace_accuracy: false, request_attempts: 0 };
  const result = aggregateK1SDKMeasurements(data); assert.equal(result.evaluation_status, "unknown"); assert.equal(result.unknown_runs, 1); assert.equal(result.baseline.failure_categories["provider-unavailable"], 1);
  const unparsed = records().map(record => ({ ...record, measurement: { ...record.measurement, success: false, failure_category: "fixture-mismatch", decision_parsed: false } }));
  assert.equal(aggregateK1SDKMeasurements(unparsed).evaluation_status, "unknown");
});
test("required cost fields, optional subset fields and SDK totalTokens retain exact public data semantics", () => {
  for (const key of ["input", "output", "cacheRead", "cacheWrite", "total"]) {
    const value = usage(); delete value.cost[key]; assert.throws(() => adaptK1SDKMeasurement({ measurement: measurement("healthy-metadata", "baseline"), usage: value }), /stage6-k1-metrics-refused/);
  }
  assert.equal(adaptK1SDKMeasurement({ measurement: measurement("healthy-metadata", "baseline"), usage: { ...usage(), totalTokens: 17, cacheWrite1h: undefined } }).tokens.total, 17);
  assert.throws(() => adaptK1SDKMeasurement({ measurement: measurement("healthy-metadata", "baseline"), usage: { ...usage(), cost: { ...usage().cost, billing: "PRIVATE" } } }), /stage6-k1-metrics-refused/);
});
test("measurement, nested Usage/cost and aggregate array hooks never run", () => {
  let calls = 0; const fail = () => { calls++; throw Error("PRIVATE"); };
  const base = measurement("healthy-metadata", "baseline"), input = { measurement: base, usage: usage() };
  const measurementGetter = { ...base }; Object.defineProperty(measurementGetter, "success", { get: fail });
  const costGetter = { ...usage().cost }; Object.defineProperty(costGetter, "total", { get: fail });
  const optionalGetter = { ...usage() }; Object.defineProperty(optionalGetter, "reasoning", { get: fail });
  for (const value of [new Proxy(input, { get: fail, ownKeys: fail }), { ...input, measurement: measurementGetter }, { ...input, usage: optionalGetter }, { ...input, usage: { ...usage(), cost: costGetter } }, { ...input, measurement: { ...base, [Symbol("private")]: true } }]) assert.throws(() => adaptK1SDKMeasurement(value), /stage6-k1-metrics-refused/);
  const array = records(); Object.defineProperty(array, "0", { get: fail }); assert.throws(() => aggregateK1SDKMeasurements(array), /stage6-k1-metrics-refused/);
  assert.throws(() => aggregateK1SDKMeasurements(new Proxy(records(), { get: fail })), /stage6-k1-metrics-refused/);
  const sparse = records(); delete sparse[0]; assert.throws(() => aggregateK1SDKMeasurements(sparse), /stage6-k1-metrics-refused/); assert.equal(calls, 0);
});
test("pair mismatch, unsafe identity, retries and arithmetic overflow cannot become an aggregate", () => {
  const data = records(); data[1].measurement = { ...data[1].measurement, runtime_digest: sha("different-runtime") }; assert.throws(() => aggregateK1SDKMeasurements(data), /stage6-k1-metrics-refused/);
  assert.throws(() => aggregateK1SDKMeasurements(records().map(record => ({ ...record, usage: usage({ costTotal: Number.MAX_VALUE }) }))), /stage6-k1-metrics-refused/);
});
test("adapter has only paired-data imports and import performs no fetch", async () => {
  const { readFile } = await import("node:fs/promises");
  const source = await readFile(new URL("./stage6-k1-metrics-adapter.mjs", import.meta.url), "utf8");
  const imports = [...source.matchAll(/^import[^\n]+from "([^"\n]+)";/gmu)].map(match => match[1]);
  assert.deepEqual(imports, ["node:util", "./paired-evaluation-data.mjs"]);
  const { execFile } = await import("node:child_process"); const { promisify } = await import("node:util");
  const run = promisify(execFile); const module = new URL("./stage6-k1-metrics-adapter.mjs", import.meta.url).href;
  const result = await run(process.execPath, ["--input-type=module", "-e", `globalThis.fetch=()=>{throw Error('fetch')}; await import(${JSON.stringify(module)}); console.log('imported')`], { shell: false, timeout: 5000 });
  assert.equal(result.stdout.trim(), "imported"); assert.equal(result.stderr, "");
});
