import test from "node:test";
import assert from "node:assert/strict";
import { readCodeStage } from "./pi-code-stage-reader.mjs";
import { consumePiOwnerResult } from "@pi-vista/adapter-pi";

const head = "a".repeat(40), merge = "b".repeat(40), hash = "c".repeat(64), time = Date.parse("2026-01-02T00:00:00.000Z");
export function fixture() {
  const contract = { binding: { workRef: { owner: "example/engineering", kind: "change", key: "existing-work" }, stageId: "source-shared-delivery", runId: "source-run", sessionId: "parent", revision: 0, headSha: head },
    repository: "example/engineering", pullRequest: 7, baseRef: "main", headChecks: [{ name: "tests", appId: 10 }, { name: "review", appId: 20, reviewHash: hash }], mergeWorkflows: ["main checks"], gateReportFile: "/fixture/private-gate" };
  const originals = {
    repository: { full_name: contract.repository, private: false, visibility: "public" },
    pr: { number: 7, state: "closed", draft: false, merged: true, merged_at: "2026-01-01T12:00:00.000Z", merge_commit_sha: merge, head: { sha: head }, base: { ref: "main", repo: { full_name: contract.repository } } },
    checks: { total_count: 2, check_runs: contract.headChecks.map((r, i) => ({ id: i + 1, name: r.name, app: { id: r.appId }, head_sha: head, status: "completed", conclusion: "success", output: { summary: r.reviewHash ?? "" } })) },
    workflows: { total_count: 1, workflow_runs: [{ id: 30, name: "main checks", head_sha: merge, event: "push", head_branch: "main", repository: { full_name: contract.repository }, status: "completed", conclusion: "success" }] },
    ancestry: { status: "ahead", base_commit: { sha: merge } },
  };
  const gate = { result_scope: "gate-evaluation", pass: true, verdict: "PASS_ESCALATED", execution_exit_code: 0, execution_merge_sha: merge,
    gate_observation: { gate_started_at: "2026-01-01T11:59:00.000Z", gate_finished_at: "2026-01-01T11:59:10.000Z" },
    evidence_readiness: { binding: { repository: contract.repository, pr: 7, head_sha: head, base_ref: "main", merge_sha: merge } },
    execution_observations_schema: "ai-gate-observations/1", execution_observations: ["gate-evaluate", "actual-merge", "post-merge-ci"].map(action => ({ action, result: "ok", reason_code: action === "actual-merge" ? "merge-observed" : "ok", source_sha: head, head_sha: head })) };
  const calls = []; let gateReads = 0;
  const io = { readGitHub: async kind => { calls.push(kind); return originals[kind]; }, readGate: async () => { gateReads++; return Buffer.from(JSON.stringify(gate)); }, now: () => time };
  return { contract, originals, gate, calls, io, gateReads: () => gateReads, run: overrides => readCodeStage(contract, { ...io, ...overrides }) };
}

test("bounded source bracket retains genuine Gate readback and never puts acceptance in progress", async () => {
  const f = fixture(), result = await f.run();
  assert.equal(result.progress.phase, "source-delivery"); assert.equal(result.progress.waitReason, "none");
  assert.equal(Object.hasOwn(result.progress, "accepted"), false); assert.equal(Object.hasOwn(result.progress, "outcome"), false);
  assert.equal(f.calls.length, 8); assert.equal(f.gateReads(), 1);
  assert.equal(consumePiOwnerResult(f.contract.binding, result.readback, time).decision, "deliverable");
  assert.equal(result.readback.requiredEffects[0].effectRef, `merge-${merge}`);
  assert.ok(!JSON.stringify(result).includes(f.contract.gateReportFile));
});

test("unmerged progress does not read Gate or imply a merge permit", async () => {
  const f = fixture(); Object.assign(f.originals.pr, { state: "open", merged: false, merged_at: null, merge_commit_sha: null });
  const result = await f.run(); assert.equal(result.progress.waitReason, "owner_delivery_pending");
  assert.equal(result.readback, undefined); assert.equal(f.calls.length, 5); assert.equal(f.gateReads(), 0);
  f.originals.pr.draft = true; assert.equal((await f.run()).progress.waitReason, "pr_not_ready");
});

for (const kind of ["checks", "workflows"]) for (const condition of ["pending", "failed", "missing"]) {
  test(`declared ${kind} ${condition} remains progress, not accepted`, async () => {
    const f = fixture(), list = kind === "checks" ? f.originals.checks.check_runs : f.originals.workflows.workflow_runs;
    if (condition === "pending") Object.assign(list[0], { status: "in_progress", conclusion: null });
    if (condition === "failed") list[0].conclusion = "failure";
    if (condition === "missing") { list.shift(); f.originals[kind].total_count--; }
    const result = await f.run();
    assert.equal(result.progress.waitReason, `${kind === "checks" ? "required_checks" : "postmerge_workflows"}_${condition}`);
    assert.equal(result.readback, undefined); assert.equal(f.gateReads(), 0); assert.equal(f.calls.length, 8);
  });
}

test("public/source binding and coverage failures never invent a green stage", async () => {
  for (const mutate of [f => f.originals.pr.head.sha = "d".repeat(40), f => f.originals.pr.base.repo.full_name = "other/repo", f => f.originals.ancestry.status = "diverged"]) {
    const f = fixture(); mutate(f); const result = await f.run(); assert.equal(result.progress.waitReason, "source_binding_mismatch"); assert.equal(result.readback, undefined);
  }
  for (const mutate of [f => f.originals.repository.private = true, f => delete f.originals.repository.visibility]) {
    const f = fixture(); mutate(f); const result = await f.run(); assert.equal(result.progress, null); assert.ok(!JSON.stringify(result).includes(f.contract.repository)); assert.equal(f.calls.length, 1);
  }
  const f = fixture(); f.originals.checks.total_count++; assert.equal((await f.run()).progress.waitReason, "source_original_unavailable");
});

test("new matching attempts invalidate the bracket; advisory work does not", async () => {
  const f = fixture(); let count = 0;
  const result = await f.run({ readGitHub: async kind => {
    if (kind === "checks" && ++count === 2) f.originals.checks.check_runs[0].id = 88;
    return f.originals[kind];
  } });
  assert.equal(result.progress.waitReason, "source_original_unavailable"); assert.equal(result.readback, undefined);
  const g = fixture(); g.originals.checks.check_runs.push({ id: 55, name: "advisory", app: { id: 99 }, head_sha: head, status: "queued" }); g.originals.checks.total_count++;
  assert.equal((await g.run()).progress.waitReason, "none");
});

test("review hash and historical original Gate remain mandatory", async () => {
  const f = fixture(); f.originals.checks.check_runs[1].output.summary = "wrong";
  assert.equal((await f.run()).progress.waitReason, "required_checks_missing"); assert.equal(f.gateReads(), 0);
  for (const mutate of [g => g.gate.pass = false, g => g.gate.result_scope = "execution-reconciliation", g => g.gate.gate_observation.gate_finished_at = "2026-01-01T13:00:00.000Z", g => g.gate.execution_observations.pop()]) {
    const g = fixture(); mutate(g); const result = await g.run(); assert.equal(result.progress.waitReason, "owner_gate_unavailable"); assert.equal(result.readback, undefined);
  }
  const result = await fixture().run({ readGate: async () => { throw Error("PRIVATE_GATE_CONTENT"); } });
  assert.equal(result.progress.waitReason, "owner_gate_unavailable"); assert.ok(!JSON.stringify(result).includes("PRIVATE_GATE"));
});

test("invalid contract/aborted call and network errors cannot leak originals or execute payloads", async () => {
  let calls = 0;
  const hostile = Object.defineProperty({}, "binding", { get() { calls++; throw Error(); } });
  assert.equal((await readCodeStage(hostile)).progress, null); assert.equal(calls, 0);
  const f = fixture(); const controller = new AbortController(); controller.abort();
  assert.equal((await f.run({ signal: controller.signal })).progress, null); assert.equal(f.calls.length, 0);
  const result = await f.run({ readGitHub: async () => { throw Error("PRIVATE_TOKEN_AND_PATH"); } });
  assert.deepEqual(result, { progress: null, reasonCode: "source_original_unavailable" });
});
