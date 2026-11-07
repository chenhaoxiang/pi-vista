import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { snapshotCodeOwnerContract, prepareCodeOwnerReadback } from "./pi-code-owner.mjs";
import { readCodeStage } from "./pi-code-stage-reader.mjs";
const head = "a".repeat(40), merge = "b".repeat(40), time = Date.parse("2026-01-02T00:00:00.000Z");
const hash = body => createHash("sha256").update(body).digest("hex");
function fixture() {
  const body = `Independent review original for head ${head}; no blockers. Body is pinned, never classified by this reader.`;
  const c = { binding: { workRef: { owner: "chenhaoxiang/pi-desk", kind: "task", key: "existing-work" }, stageId: "source-shared-delivery", runId: "source-stage", sessionId: "owner-session", revision: 0, headSha: head }, repository: "chenhaoxiang/pi-desk", pullRequest: 16, baseRef: "main", headChecks: [{ name: "native", appId: 15368 }, { name: "bridge", appId: 15368 }, { name: "GitGuardian Security Checks", appId: 46505 }], mergeWorkflows: ["CI"], repositoryReview: { commentId: 42, author: "maintainer", bodySha256: hash(body) } };
  const pr = { number: 16, state: "closed", draft: false, merged: true, merged_at: "2026-01-01T12:00:00.000Z", merge_commit_sha: merge, head: { sha: head }, base: { ref: "main", repo: { full_name: c.repository } } };
  const checks = { total_count: 3, check_runs: c.headChecks.map((r, i) => ({ id: i + 1, name: r.name, app: { id: r.appId }, head_sha: head, status: "completed", conclusion: "success", output: { summary: "" } })) };
  const workflows = { total_count: 1, workflow_runs: [{ id: 10, name: "CI", head_sha: merge, status: "completed", conclusion: "success", event: "push", head_branch: "main", repository: { full_name: c.repository } }] };
  const review = { id: 42, user: { login: "maintainer" }, issue_url: "https://api.github.com/repos/chenhaoxiang/pi-desk/issues/16", created_at: "2026-01-01T11:00:00Z", updated_at: "2026-01-01T11:00:00Z", body };
  const originals = { pr, checks, workflows, review, ancestry: { status: "ahead", base_commit: { sha: merge } }, repository: { full_name: c.repository, private: false, visibility: "public" } };
  const calls = [], readGitHub = async kind => { calls.push(kind); return structuredClone(originals[kind]); };
  const options = { readGitHub, readGate: async () => { assert.fail("Independent repo must never read or fabricate a Gate"); }, now: () => time };
  return { c, originals, calls, options, run: () => prepareCodeOwnerReadback(c, options), stage: () => readCodeStage(c, options) };
}
test("explicit Desk review policy accepts only pinned originals with exact CI, merge and postmerge evidence", async () => {
  const f = fixture();
  assert.equal(snapshotCodeOwnerContract(f.c).repositoryReview.commentId, 42);
  const r = await f.run();
  assert.equal(r.observation.decision, "deliverable"); assert.ok(r.readback);
  assert.ok(r.observation.originals.includes("review-comment-42")); assert.ok(!r.observation.originals.includes("gate-original"));
  assert.equal(r.observation.authorization, "none"); assert.equal(r.observation.scope, "source-shared-delivery-only");
  assert.equal(f.calls.filter(k => k === "review").length, 2);
});
test("explicit tool-stage path reuses existing progress/result DTOs and never makes a Gate", async () => {
  const f = fixture(), r = await f.stage();
  assert.equal(r.progress.phase, "source-delivery"); assert.equal(r.progress.waitReason, "none"); assert.ok(r.readback);
  assert.equal(f.calls.length, 10); assert.equal(r.progress.authorization, "none");
});
test("the independent path cannot replace a Meta Gate, be mixed with one, or be selected implicitly", async () => {
  const f = fixture();
  for (const change of [{ repository: "chenhaoxiang/pi-vista" }, { repository: "tudingaicn/tudingai-meta" }, { gateReportFile: "/private/gate.json" }, { repositoryReview: undefined }]) {
    assert.throws(() => snapshotCodeOwnerContract({ ...f.c, ...change }));
  }
  for (const repositoryReview of [{ ...f.c.repositoryReview, bodySha256: "x" }, { ...f.c.repositoryReview, commentId: 0 }, { ...f.c.repositoryReview, author: "../bad" }, { ...f.c.repositoryReview, accepted: true }]) {
    assert.throws(() => snapshotCodeOwnerContract({ ...f.c, repositoryReview }));
  }
});
test("review source references are closed own-data and do not invoke getters or proxies", () => {
  const f = fixture(); let reads = 0;
  const accessor = Object.defineProperty({}, "commentId", { enumerable: true, get() { reads++; return 42; } });
  for (const repositoryReview of [accessor, new Proxy(f.c.repositoryReview, { ownKeys() { reads++; return []; } })]) {
    assert.throws(() => snapshotCodeOwnerContract({ ...f.c, repositoryReview }));
  }
  assert.equal(reads, 0);
});
test("non-string review digests are rejected without coercion or source IO", async () => {
  const f = fixture(); let coercions = 0, calls = 0;
  for (const bodySha256 of [[f.c.repositoryReview.bodySha256], { [Symbol.toPrimitive]() { coercions++; return f.c.repositoryReview.bodySha256; } }]) {
    const c = { ...f.c, repositoryReview: { ...f.c.repositoryReview, bodySha256 } };
    assert.throws(() => snapshotCodeOwnerContract(c));
    const result = await prepareCodeOwnerReadback(c, { readGitHub: async () => { calls++; throw Error(); } });
    assert.equal(result.observation.reasonCode, "contract_invalid");
  }
  assert.equal(coercions, 0); assert.equal(calls, 0);
});
test("wrong comment, author, PR, head or pinned body cannot become source acceptance", async () => {
  for (const mutate of [r => { r.id++; }, r => { r.user.login = "other"; }, r => { r.issue_url = "https://api.github.com/repos/chenhaoxiang/pi-desk/issues/17"; }, r => { r.body += "edited"; }, r => { delete r.body; }, r => { r.body = "x".repeat(262145); }]) {
    const f = fixture(); mutate(f.originals.review); const r = await f.run();
    assert.equal(r.observation.outcome, "unknown"); assert.equal(r.readback, undefined);
  }
  const f = fixture(); f.originals.review.body = "Report mentions another head"; f.c.repositoryReview.bodySha256 = hash(f.originals.review.body);
  assert.equal((await f.run()).observation.outcome, "unknown");
});
test("postmerge or invalid/edited review dates cannot fabricate historical premerge review", async () => {
  for (const patch of [{ created_at: "2026-01-01T13:00:00Z", updated_at: "2026-01-01T13:00:00Z" }, { updated_at: "2026-01-01T13:00:00Z" }, { created_at: "bad" }, { updated_at: "2025-01-01T00:00:00Z" }]) {
    const f = fixture(); Object.assign(f.originals.review, patch); assert.equal((await f.run()).observation.outcome, "unknown");
  }
});
test("a changed second review read invalidates rather than mixing evidence generations", async () => {
  const f = fixture(); let reads = 0;
  f.options.readGitHub = async kind => { const value = structuredClone(f.originals[kind]); if (kind === "review" && ++reads === 2) value.body += "later"; return value; };
  const r = await f.run(); assert.equal(r.observation.outcome, "unknown"); assert.equal(reads, 2);
});
test("a second review edit with unchanged text still invalidates this observation bracket", async () => {
  const f = fixture(); let reads = 0;
  f.options.readGitHub = async kind => { const value = structuredClone(f.originals[kind]); if (kind === "review" && ++reads === 2) value.updated_at = "2026-01-01T11:30:00Z"; return value; };
  assert.equal((await f.run()).observation.reasonCode, "review_changed_during_readback");
});
test("failed source reads stay unknown without leaking public report bodies or private paths", async () => {
  const f = fixture();
  f.options.readGitHub = async kind => { if (kind === "review") throw Error("PRIVATE_REVIEW_OR_PATH"); return structuredClone(f.originals[kind]); };
  const r = await f.run(); assert.equal(r.observation.outcome, "unknown"); assert.ok(!JSON.stringify(r).includes("PRIVATE_REVIEW_OR_PATH"));
});
test("CI/current-head/postmerge/ancestry requirements remain necessary on independent repos", async () => {
  for (const mutate of [f => { f.originals.checks.check_runs[0].conclusion = "failure"; }, f => { f.originals.workflows.workflow_runs[0].head_sha = head; }, f => { f.originals.ancestry.status = "diverged"; }, f => { f.originals.pr.head.sha = "d".repeat(40); }]) {
    const f = fixture(); mutate(f); assert.equal((await f.run()).observation.outcome, "unknown");
  }
});
test("missing review on independent source is unavailable, not a fictitious missing Meta Gate", async () => {
  const f = fixture(); delete f.originals.review;
  const r = await f.stage(); assert.equal(r.readback, undefined); assert.equal(r.progress.waitReason, "source_original_unavailable");
  assert.ok(!JSON.stringify(r).includes("/private/"));
});
