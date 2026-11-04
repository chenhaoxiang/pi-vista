import test from "node:test";
import assert from "node:assert/strict";
import { observeCodeOwner, snapshotCodeOwnerContract, parseOriginalGate, recordCodeOwnerObservation } from "./pi-code-owner.mjs";
import { EventStore } from "@pi-vista/core";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { ROOT } from "./release-utils.mjs";
import { spawnSync } from "node:child_process";
const head = "a".repeat(40), merge = "b".repeat(40), now = Date.parse("2026-01-02T00:00:00.000Z");
function fixture() {
  const c = { binding: { workRef: { owner: "example/engineering", kind: "change", key: "existing-work" }, stageId: "source-shared-delivery", runId: "source-run", sessionId: "parent-session", revision: 0, headSha: head },
    repository: "example/engineering", pullRequest: 1, baseRef: "main", headChecks: [{ name: "tests", appId: 10 }, { name: "independent-review", appId: 20, reviewHash: "c".repeat(64) }],
    mergeWorkflows: ["main checks"], gateReportFile: "/fixture/gate.json" };
  const pr = { number: 1, merged: true, merged_at: "2026-01-01T12:00:00.000Z", merge_commit_sha: merge, head: { sha: head }, base: { ref: "main", repo: { full_name: c.repository } } };
  const checks = { total_count: 2, check_runs: c.headChecks.map((x, i) => ({ id: i + 1, name: x.name, app: { id: x.appId }, head_sha: head, status: "completed", conclusion: "success", output: { summary: x.reviewHash ?? "" } })) };
  const workflows = { total_count: 1, workflow_runs: [{ id: 30, name: "main checks", head_sha: merge, event: "push", head_branch: "main", repository: { full_name: c.repository }, status: "completed", conclusion: "success" }] };
  const ancestry = { status: "ahead", base_commit: { sha: merge } };
  const gate = { result_scope: "gate-evaluation", pass: true, verdict: "PASS_ESCALATED", execution_exit_code: 0, execution_merge_sha: merge,
    gate_observation: { gate_started_at: "2026-01-01T11:59:00.000Z", gate_finished_at: "2026-01-01T11:59:10.000Z" },
    evidence_readiness: { binding: { repository: c.repository, pr: 1, head_sha: head, base_ref: "main", merge_sha: merge } },
    execution_observations_schema: "ai-gate-observations/1", execution_observations: ["gate-evaluate", "actual-merge", "post-merge-ci"].map(action => ({ action, result: "ok", reason_code: action === "actual-merge" ? "merge-observed" : action === "gate-evaluate" ? "gate-admitted" : "ci-success", source_sha: head, head_sha: head })) };
  const calls = [], reader = async kind => { calls.push(kind); return { pr, checks, workflows, ancestry }[kind]; };
  const run = (overrides = {}) => observeCodeOwner(c, { readGitHub: reader, readGate: async () => Buffer.from(JSON.stringify(gate)), now: () => now, ...overrides });
  return { c, pr, checks, workflows, ancestry, gate, calls, run };
}

test("source delivery uses exact original requirements, source/head/merge and premerge Gate", async () => {
  const f = fixture(), result = await f.run(); assert.equal(result.decision, "deliverable"); assert.equal(result.authorization, "none");
  assert.equal(result.scope, "source-shared-delivery-only"); assert.equal(result.mergeSha, merge); assert.equal(result.originals.length, 5);
  assert.equal(f.calls.filter(x => x === "pr").length, 2);
});
test("an already-merged Gate re-evaluation is never promoted to historical premerge acceptance", async () => {
  const f = fixture(); f.gate.gate_observation.gate_started_at = "2026-01-01T13:00:00.000Z"; f.gate.gate_observation.gate_finished_at = "2026-01-01T13:00:10.000Z";
  assert.equal((await f.run()).reasonCode, "gate_after_merge_not_premerge");
  f.gate.gate_observation.gate_started_at = "2026-01-01T11:00:00.000Z"; f.gate.gate_observation.gate_finished_at = "2026-01-01T11:00:10.000Z";
  f.gate.execution_observations[1].reason_code = "already-merged";
  assert.equal((await f.run()).reasonCode, "gate_after_merge_not_premerge");
});
test("read-only reconcile alone cannot supply Gate evaluation", async () => {
  const f = fixture(); f.gate.result_scope = "execution-reconciliation"; f.gate.execution_observations[0].result = "unknown";
  assert.equal((await f.run()).reasonCode, "gate_not_accepted");
});
test("missing required check or wrong App does not use an unrelated green check", async () => {
  const f = fixture(); f.checks.check_runs[1].app.id = 999;
  assert.equal((await f.run()).reasonCode, "required_original_missing");
});
test("latest matching pending or failed check wins over an old green at same head", async () => {
  const f = fixture(); f.checks.check_runs.push({ ...f.checks.check_runs[0], id: 99, status: "in_progress", conclusion: null }); f.checks.total_count++;
  assert.equal((await f.run()).reasonCode, "source_check_not_successful");
});
test("unrelated pending jobs do not become a global completion barrier", async () => {
  const f = fixture(); f.checks.check_runs.push({ id: 55, name: "advisory", app: { id: 99 }, head_sha: head, status: "queued" }); f.checks.total_count++;
  assert.equal((await f.run()).decision, "deliverable");
});
test("review hash, source head and PR identity are exact", async () => {
  const f = fixture(); f.checks.check_runs[1].output.summary = "other review"; assert.equal((await f.run()).reasonCode, "review_hash_mismatch");
  f.pr.head.sha = "d".repeat(40); assert.equal((await f.run()).reasonCode, "pr_binding_mismatch");
});
test("source workflow cannot stand in for merge workflow, and pagination is not silently truncated", async () => {
  const f = fixture(); f.workflows.workflow_runs[0].head_sha = head; assert.equal((await f.run()).reasonCode, "required_original_missing");
  f.checks.total_count++; assert.equal((await f.run()).reasonCode, "original_coverage_incomplete");
});
test("merge commit must remain contained in the selected base", async () => {
  const f = fixture(); f.ancestry.status = "diverged"; assert.equal((await f.run()).reasonCode, "merge_not_in_base");
});
test("PR changes during readback invalidate the observation", async () => {
  const f = fixture(); let n = 0;
  const result = await f.run({ readGitHub: async kind => kind === "pr" && ++n > 1 ? { ...f.pr, merged: false } : { pr: f.pr, checks: f.checks, workflows: f.workflows, ancestry: f.ancestry }[kind] });
  assert.equal(result.reasonCode, "pr_changed_during_readback");
});
test("missing files/network failures remain unknown without returning raw private errors", async () => {
  const f = fixture(), result = await f.run({ readGate: async () => { throw Error("PRIVATE_PATH_OR_SECRET"); } });
  assert.equal(result.outcome, "unknown"); assert.ok(!JSON.stringify(result).includes("PRIVATE_PATH_OR_SECRET"));
});
test("closed operator contract refuses getters, proxies, empty requirements and unsafe repo/path", () => {
  const f = fixture(); let calls = 0;
  assert.throws(() => snapshotCodeOwnerContract(new Proxy({}, { ownKeys() { calls++; return []; } })));
  assert.throws(() => snapshotCodeOwnerContract(Object.defineProperty({}, "binding", { get() { calls++; } })));
  for (const change of [{ headChecks: [] }, { mergeWorkflows: [] }, { repository: "x/../y" }, { gateReportFile: "relative" }, { binding: { ...f.c.binding, headSha: undefined } }]) assert.throws(() => snapshotCodeOwnerContract({ ...f.c, ...change }));
  assert.equal(calls, 0);
});
test("optional local observation has exact readback and no private original contents", async () => {
  await mkdir(join(ROOT, "tmp"), { recursive: true }); const root = await mkdtemp(join(ROOT, "tmp/code-owner-events-"));
  try {
    const f = fixture(), view = await f.run(), store = new EventStore(root);
    assert.equal(await recordCodeOwnerObservation(view, store), true);
    const rows = await store.readRun(view.binding.runId); assert.equal(rows.length, 1);
    assert.equal(rows[0].artifact_refs[0].ref, "source-shared-delivery"); assert.equal(rows[0].result, "ok");
    assert.ok(!JSON.stringify(rows).includes("/fixture/"));
  } finally { await rm(root, { recursive: true, force: true }); }
});
test("a fail-open append without readable row is not declared recorded", async () => {
  const f = fixture(), view = await f.run();
  assert.equal(await recordCodeOwnerObservation(view, { async append() {}, async readRun() { return []; } }), false);
  assert.equal(view.decision, "deliverable");
});

test("failure, foreign Gate and missing required effect cases remain unresolved", async () => {
  const cases = [
    [f => { f.checks.check_runs[0].conclusion = "failure"; }, "source_check_not_successful"],
    [f => { f.workflows.workflow_runs[0].conclusion = "failure"; }, "merge_workflow_not_successful"],
    [f => { f.gate.evidence_readiness.binding.repository = "other/repo"; }, "gate_binding_mismatch"],
    [f => { f.gate.execution_observations.pop(); }, "gate_required_result_missing"],
    [f => { f.pr.merged = false; }, "pr_not_merged"],
  ];
  for (const [mutate, code] of cases) { const f = fixture(); mutate(f); const v = await f.run(); assert.equal(v.reasonCode, code); assert.equal(v.outcome, "unknown"); }
});
test("required evidence is re-read once and a new check or workflow attempt invalidates", async () => {
  for (const kind of ["checks", "workflows"]) {
    const f = fixture(); let n = 0;
    const v = await f.run({ readGitHub: async key => {
      const value = { pr: f.pr, checks: f.checks, workflows: f.workflows, ancestry: f.ancestry }[key];
      if (key === kind && ++n === 2) { if (key === "checks") value.check_runs[0].id = 88; else value.workflow_runs[0].run_attempt = 2; }
      return value;
    } });
    assert.equal(v.reasonCode, "required_evidence_changed_during_readback"); assert.equal(n, 2);
  }
});
test("standalone host usage refuses missing contract before any IO", () => {
  const v = spawnSync(process.execPath, [join(ROOT, "scripts/pi-code-owner.mjs")], { encoding: "utf8" });
  assert.equal(v.status, 2); assert.match(v.stderr, /^usage:/); assert.equal(v.stdout, "");
});

test("original Gate parser accepts one explicit JSON object and refuses ambiguous trailing content", () => {
  const value = { pass: true }; assert.deepEqual(parseOriginalGate(JSON.stringify(value)), value);
  assert.deepEqual(parseOriginalGate('owner progress\n{\n  "pass": true\n}\n'), value);
  assert.throws(() => parseOriginalGate('{"pass":true}\n{"pass":true}'));
  assert.throws(() => parseOriginalGate('PRIVATE_ERROR'));
});
