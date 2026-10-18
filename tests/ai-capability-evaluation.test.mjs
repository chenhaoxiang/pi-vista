import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { TASKS, FIXTURES, METRICS, SAFETY, INPUT_SCHEMA, createRecordTemplate, createSyntheticFixtureReport, summarizeObservedRecords, parseArguments, formatReport } from "../scripts/ai-capability-evaluation.mjs";
import { analyzeStage6ContextRoi } from "../scripts/stage6-context-roi.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const cli = fileURLToPath(new URL("../scripts/ai-capability-evaluation.mjs", import.meta.url));
const copy = value => JSON.parse(JSON.stringify(value));
const input = records => ({ schema: INPUT_SCHEMA, mode: "safe-projection", records });
const row = patch => ({ ...createRecordTemplate().records[0], ...patch });
const run = (args = [], stdin) => spawnSync(process.execPath, [cli, ...args], { cwd: root, env: {}, input: stdin, encoding: "utf8", timeout: 5000 });

test("exactly ten normal tasks have concrete self-contained synthetic inputs and verifiable rubrics", () => {
  assert.deepEqual(TASKS.map(task => task.id), Array.from({ length: 10 }, (_, i) => `T${String(i + 1).padStart(2, "0")}`));
  assert.equal(Object.keys(FIXTURES).length, 10);
  for (const task of TASKS) {
    assert.ok(task.prompt.length > 10);
    assert.ok(task.criteria.length >= 3);
    assert.ok(Object.keys(FIXTURES[task.fixture]).length >= 2);
    assert.equal(Object.hasOwn(task, "tool_sequence"), false);
  }
  assert.deepEqual(FIXTURES.diagnosis.expected, ["a", "b"]);
  assert.equal(FIXTURES.patch.examples[0].expected, 0);
});

test("rubrics and fixture data cannot be changed between runs", () => {
  assert.throws(() => { TASKS[0].criteria[0] = "pass everything"; }, TypeError);
  assert.throws(() => { FIXTURES.patch.examples[0].expected = 1; }, TypeError);
});

test("synthetic demo reports fixture presence, never measured AI completion, tokens, time or ROI", () => {
  const report = createSyntheticFixtureReport();
  assert.equal(report.mode, "synthetic-fixture");
  assert.equal(report.measurement_status, "unknown");
  assert.equal(report.matrix_size, 10);
  assert.equal(report.tasks.length, 10);
  assert.ok(report.tasks.every(task => task.fixture_status === "present"));
  assert.deepEqual(report.safety, SAFETY);
  for (const metric of METRICS) assert.equal(report.metrics[metric], null);
  assert.equal(report.completion_rate, null);
  assert.equal(report.roi, null);
  assert.equal(report.capability_claim, "not-assessed");
});

test("unrun template stays unknown rather than ten passes, ten failures or zero cost", () => {
  const template = createRecordTemplate();
  assert.equal(template.records.length, 10);
  const report = summarizeObservedRecords(template), single = report.by_arm.single;
  assert.equal(report.measurement_status, "supplied-not-authenticated");
  assert.deepEqual(single.metrics.completion, { observed: 0, unknown: 10, counts: { pass: 0, partial: 0, fail: 0, unknown: 10 } });
  assert.deepEqual(single.metrics.elapsed_ms, { observed: 0, missing: 10, observed_sum: null, total: null });
  assert.equal(single.metrics.context_tokens.total, null);
  assert.equal(single.metrics.error_recovered.recovered, null);
  assert.equal(single.false_intercept.rate, null);
  assert.equal(report.cost_status, "unpriced");
  assert.equal(report.roi, null);
  assert.equal(Object.hasOwn(single, "completion_rate"), false);
});

test("safe counter projection separates arms and preserves partial-denominator totals", () => {
  const records = [row({ arm: "baseline", completion: "pass", tool_calls: 2, context_tokens: 100, elapsed_ms: 120.5 }),
    row({ task_id: "T02", arm: "baseline", completion: "partial" }),
    row({ arm: "candidate", completion: "fail", tool_calls: 1, context_tokens: 50, elapsed_ms: 110 })];
  const report = summarizeObservedRecords(input(records));
  assert.equal(report.by_arm.baseline.records, 2);
  assert.equal(report.by_arm.candidate.records, 1);
  assert.deepEqual(report.by_arm.baseline.metrics.tool_calls, { observed: 1, missing: 1, observed_sum: 2, total: null });
  assert.deepEqual(report.by_arm.candidate.metrics.tool_calls, { observed: 1, missing: 0, observed_sum: 1, total: 1 });
  assert.equal(report.by_arm.candidate.metrics.completion.counts.fail, 1);
  assert.equal(report.capability_claim, "not-assessed"); // Input is not independently authenticated.
});

test("observed zero is distinguishable from unobserved data", () => {
  const report = summarizeObservedRecords(input([row({ tool_calls: 0, human_interventions: 0 })]));
  assert.equal(report.by_arm.single.metrics.tool_calls.total, 0);
  assert.equal(report.by_arm.single.metrics.human_interventions.observed, 1);
  assert.equal(report.by_arm.single.metrics.output_tokens.total, null);
});

test("error recovery keeps an unmeasured attempt unknown and has no assumed success rate", () => {
  const records = [row({ error_injected: true }), row({ task_id: "T08", error_injected: true, error_recovered: true }), row({ task_id: "T09", error_injected: true, error_recovered: false })];
  assert.deepEqual(summarizeObservedRecords(input(records)).by_arm.single.metrics.error_recovered, { eligible: 3, observed: 2, recovered: 1 });
  assert.throws(() => summarizeObservedRecords(input([row({ error_injected: false, error_recovered: true })])), /ai-capability-evaluation-refused/);
});

test("false intercept requires known safe opportunities, and zero denominator has no rate", () => {
  const a = summarizeObservedRecords(input([row({ false_intercepts: 1, safe_action_opportunities: 4 })])).by_arm.single.false_intercept;
  assert.deepEqual(a, { observed: 1, false_intercepts: 1, opportunities: 4, rate: 0.25 });
  assert.equal(summarizeObservedRecords(input([row({ false_intercepts: 0, safe_action_opportunities: 0 })])).by_arm.single.false_intercept.rate, null);
  for (const patch of [{ false_intercepts: 1 }, { false_intercepts: 2, safe_action_opportunities: 1 }]) assert.throws(() => summarizeObservedRecords(input([row(patch)])), /ai-capability-evaluation-refused/);
});

test("invalid counters, overflow and contradictory enum values cannot become metrics", () => {
  for (const patch of [{ tool_calls: -1 }, { context_tokens: 1.2 }, { elapsed_ms: Infinity }, { output_tokens: undefined }, { completion: "approved" }, { task_id: "T11" }, { arm: "provider/model" }, { run_id: "/private/raw-session" }, { error_injected: "unknown" }]) {
    assert.throws(() => summarizeObservedRecords(input([row(patch)])), /ai-capability-evaluation-refused/);
  }
  assert.throws(() => summarizeObservedRecords(input([row({ tool_calls: Number.MAX_SAFE_INTEGER }), row({ task_id: "T02", tool_calls: 1 })])), /ai-capability-evaluation-refused/);
});

test("closed DTO rejects raw content, duplicate identities and incomplete arrays", () => {
  for (const bad of [{ ...createRecordTemplate(), prompt: "PRIVATE" }, input([row({ command: "PRIVATE" })]), input([row(), row()]), input([]), input(Array(1)), { ...createRecordTemplate(), mode: "synthetic-demo" }]) {
    assert.throws(() => summarizeObservedRecords(bad), /ai-capability-evaluation-refused/);
  }
});

test("projection does not invoke input proxy traps or getters", () => {
  let calls = 0;
  const trap = () => { calls++; throw Error("PRIVATE"); };
  for (const value of [new Proxy(createRecordTemplate(), { ownKeys: trap }),
    Object.defineProperty(createRecordTemplate(), "records", { get: trap }),
    input(new Proxy([row()], { get: trap })),
    input([Object.defineProperty(row(), "completion", { get: trap })])]) {
    assert.throws(() => summarizeObservedRecords(value), /ai-capability-evaluation-refused/);
  }
  assert.equal(calls, 0);
});

test("CLI actually executes demo, full matrix and Markdown modes without provider credentials", () => {
  const demo = run(["--demo"]);
  assert.equal(demo.status, 0, demo.stderr);
  assert.equal(demo.stderr, "");
  assert.deepEqual(JSON.parse(demo.stdout), createSyntheticFixtureReport());
  const matrix = run(["--matrix"]);
  assert.equal(matrix.status, 0, matrix.stderr);
  assert.equal(Object.keys(JSON.parse(matrix.stdout).fixtures).length, 10);
  const markdown = run(["--demo", "--format=markdown"]);
  assert.equal(markdown.status, 0, markdown.stderr);
  assert.match(markdown.stdout, /non-gating/u);
  assert.match(markdown.stdout, /"completion_rate": null/u);
});

test("CLI stdin projection accepts a blank template without inventing a real run", () => {
  const template = run(["--template"]);
  assert.equal(template.status, 0, template.stderr);
  const result = run(["--summarize"], template.stdout);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).by_arm.single.metrics.completion.observed, 0);
  assert.equal(JSON.parse(result.stdout).roi, null);
});

test("CLI refuses unknown/duplicate flags and malformed content without echoing private errors", () => {
  for (const args of [["--input=/PRIVATE"], ["--demo", "--summarize"], ["--format=json", "--format=json"], ["PRIVATE"]]) assert.throws(() => parseArguments(args), /ai-capability-evaluation-refused/);
  for (const stdin of ["{PRIVATE}", JSON.stringify({ ...createRecordTemplate(), prompt: "PRIVATE" }), " ".repeat(256 * 1024 + 1)]) {
    const result = run(["--summarize"], stdin);
    assert.equal(result.status, 1);
    assert.equal(result.stdout, "");
    assert.equal(result.stderr, "ai-capability-evaluation-refused\n");
  }
  assert.throws(() => formatReport({}, "invalid"), /ai-capability-evaluation-refused/);
});

test("existing ROI remains the sole paired cost rule; speed or savings never hide quality loss", () => {
  const arm = overrides => ({ runs: 1, successes: 1, trace_accurate: 1, decision_parsed: 1, elapsed_ms: 100, tokens: 100, reasoning_tokens: null, tool_calls: 1, human_interventions: 0, sdk_cost: null, cost_priced: false, unknown_runs: 0, ...overrides });
  const baseline = arm(), guided = arm({ tokens: 50, elapsed_ms: 50, successes: 0 });
  const report = analyzeStage6ContextRoi({ baseline, guided, context: { baseline_characters: 0, guided_characters: 0, compile_ms: null, profile_drift: "unchanged", evaluation_status: "measured" } });
  assert.equal(report.recommendation, "do-not-inject");
  assert.equal(report.reason_code, "semantic-regression");
  assert.equal(report.cost_status, "unpriced");
  assert.equal(report.authorization, "none");
  assert.equal(report.executable, false);
});

test("manual suite has no required discovery; implementation has no network, SDK, storage or model port", async () => {
  const source = await readFile(cli, "utf8"), pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  assert.doesNotMatch(source, /from ["'](?:node:(?:fs|http|https|net|child_process)|@pi-vista|@earendil)/u);
  assert.doesNotMatch(source, /fetch\s*\(|import\s*\(|modelRegistry|writeFile|readFile/u);
  assert.doesNotMatch(JSON.stringify(pkg.scripts), /ai-capability-evaluation/u);
  assert.ok(pkg.scripts["test:integration"].includes("dist-integration .test.mjs"));
  assert.ok(pkg.scripts["test:release-contract"].includes("scripts .test.mjs"));
  const config = await readFile(new URL("../tsconfig.integration.json", import.meta.url), "utf8");
  assert.match(config, /tests\/\*\*\/\*\.mts/u);
  for (const file of await readdir(new URL("../.github/workflows/", import.meta.url))) {
    assert.doesNotMatch(await readFile(new URL(`../.github/workflows/${file}`, import.meta.url), "utf8"), /ai-capability-evaluation/u);
  }
});
