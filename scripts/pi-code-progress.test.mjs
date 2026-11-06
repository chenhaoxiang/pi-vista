import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { createCodeProgressWindow, codeProgressRow, snapshotCodeProgress, CODE_PROGRESS_TRIPLES } from "./pi-code-progress.mjs";
import { createPiWorkObserver, OWNER_RESULT_EVENT, WORK_OBSERVATION_QUERY_EVENT, WORK_OBSERVATION_REPLY_PREFIX, WORK_OBSERVATION_CHANGED_EVENT } from "./pi-work-observer.mjs";

const now = Date.now(), since = "2026-01-01T00:00:00.000Z";
const contract = { binding: { workRef: { owner: "example/engineering", kind: "task", key: "existing-work" }, stageId: "source-shared-delivery", runId: "run-1", sessionId: "original-owner", revision: 0, headSha: "a".repeat(40) }, repository: "example/engineering", pullRequest: 1 };
function fixture(readStage, extra = {}) {
  const handlers = new Map(), tools = new Map(), events = new EventEmitter(), writes = []; let reads = 0;
  const observer = createPiWorkObserver({ freshSessionsSince: since, now: () => now, store: { append: row => writes.push(row) }, diagnose() {},
    codeOwner: { readContract: async () => { reads++; return Buffer.from(JSON.stringify(contract)); }, readStage }, ...extra });
  const pi = { on(name, fn) { handlers.set(name, fn); }, registerCommand() {}, registerTool(tool) { tools.set(tool.name, tool); }, getCommands: () => [],
    events: { emit: (name, value) => events.emit(name, value), on(name, fn) { events.on(name, fn); return () => events.off(name, fn); } } };
  observer.extension(pi);
  const ctx = id => ({ sessionManager: { getSessionId: () => id, getHeader: () => ({ id, timestamp: since }), getBranch() { assert.fail("history access"); } } });
  handlers.get("session_start")({}, ctx("host"));
  const call = (signal, args = { contractFile: "/private/selected-contract.json" }) => tools.get("vista_code_observe").execute("explicit-call", args, signal, undefined, ctx("host"));
  const query = () => { let result; const listener = value => { result = value.snapshot; }; events.on(WORK_OBSERVATION_REPLY_PREFIX + "q", listener);
    events.emit(WORK_OBSERVATION_QUERY_EVENT, { version: 1, requestId: "q", hostSessionId: "host" }); events.off(WORK_OBSERVATION_REPLY_PREFIX + "q", listener); return result; };
  return { observer, handlers, tools, events, writes, call, query, ctx, reads: () => reads };
}
function readback() {
  const observedAt = new Date(now).toISOString(), freshUntil = new Date(now + 30_000).toISOString();
  return { binding: contract.binding, sourceKind: "code", sourceRef: "github-pr-1", disposition: "accepted", observedAt, freshUntil,
    requiredEvidence: [{ evidenceId: "original", kind: "readback", sourceRef: "gate-original", claims: ["source-stage-original"] }],
    evidence: [{ binding: contract.binding, record: { evidence_id: "original", run_id: contract.binding.runId, source_sha: contract.binding.headSha,
      kind: "readback", state: "validated", source_ref: "gate-original", claims: ["source-stage-original"], observed_at: observedAt, fresh_until: freshUntil, counterevidence_refs: [], redaction_profile: "metadata-only" } }], requiredEffects: [] };
}
const legacy = ({ codeProgress: _progress, ...snapshot }) => snapshot;

test("closed triples and bounded metadata reject getters, paths, missing heads and accepted claims", () => {
  for (const [, reason] of CODE_PROGRESS_TRIPLES) assert.equal(codeProgressRow(contract, reason, now).waitReason, reason);
  const row = codeProgressRow(contract, "required_checks_pending", now);
  for (const patch of [{ accepted: true }, { repository: "../secret" }, { binding: { ...contract.binding, headSha: undefined } }, { nextAction: "inspect_result" }, { authorization: "allowed" }]) assert.throws(() => snapshotCodeProgress({ ...row, ...patch }));
  let invoked = 0;
  assert.throws(() => snapshotCodeProgress(Object.defineProperty({}, "binding", { get() { invoked++; } })));
  assert.throws(() => snapshotCodeProgress(new Proxy({}, { ownKeys() { invoked++; return []; } })));
  assert.equal(invoked, 0);
});

test("progress memory budget evicts whole rows and never refreshes old observation time", () => {
  const lane = createCodeProgressWindow();
  for (let i = 0; i < 40; i++) lane.append(codeProgressRow({ ...contract, binding: { ...contract.binding, runId: `run-${i}` } }, "required_checks_pending", now + i));
  const value = lane.snapshot(); assert.equal(value.seq, 40); assert.ok(value.observations.length <= 16);
  assert.equal(value.observations.length + value.omitted, 40); assert.ok(Buffer.byteLength(JSON.stringify(value)) <= 5400);
  assert.equal(value.observations.at(-1).observedAt, now + 39); assert.throws(() => value.observations.push({}));
  lane.unavailable(); assert.equal(lane.snapshot().seq, 41); assert.equal(lane.snapshot().coverage, "unavailable");
  assert.equal(lane.snapshot().observations.at(-1).observedAt, now + 39); assert.ok(Buffer.byteLength(JSON.stringify(lane.snapshot())) <= 5400);
});

test("progress changes leave all legacy v1 fields intact; one existing query performs zero reads", async () => {
  let sourceReads = 0;
  const f = fixture(async () => { sourceReads++; return { progress: codeProgressRow(contract, "required_checks_pending", now) }; });
  const before = legacy(f.query()), writes = f.writes.length, changes = [];
  f.events.on(WORK_OBSERVATION_CHANGED_EVENT, value => changes.push(value));
  const result = await f.call(); assert.equal(result.details.published, true); assert.equal(result.details.result, undefined);
  const current = f.query(); assert.deepEqual(legacy(current), before); assert.equal(current.codeProgress.seq, 1);
  assert.equal(current.codeProgress.observations[0].observedAt, now);
  for (let i = 0; i < 3; i++) assert.deepEqual(f.query(), current);
  assert.equal(sourceReads, 1); assert.equal(f.reads(), 1); assert.equal(f.writes.length, writes); assert.equal(changes.length, 1);
  assert.ok(!JSON.stringify(result).includes("/private/")); assert.equal(f.tools.get("vista_code_observe").exposure, "codemode");
});

test("slow source preparation completes before the 250ms consumer; only genuine readback produces terminal result", async () => {
  const f = fixture(async () => { await new Promise(resolve => setTimeout(resolve, 300)); return { progress: codeProgressRow(contract, "none", now), readback: readback() }; });
  const result = await f.call(); assert.equal(result.details.result.decision, "deliverable", JSON.stringify(result.details));
  assert.equal(f.query().observations[0].kind, "result"); assert.equal(f.query().codeProgress.observations[0].phase, "source-delivery");
  const broken = readback(); broken.evidence = [];
  const g = fixture(async () => ({ progress: codeProgressRow(contract, "none", now), readback: broken }));
  const rejected = await g.call(); assert.equal(rejected.details.result.decision, "reconcile_required");
  assert.equal(rejected.details.progress.phase, "unknown", "an unconsumed readback cannot leave successful source progress");
});

test("failed contract/public read is only lane-unavailable and preserves legacy results", async () => {
  let fail = false;
  const f = fixture(async () => fail ? { progress: null } : { progress: codeProgressRow(contract, "required_checks_pending", now) });
  f.events.emit(OWNER_RESULT_EVENT, { hostSessionId: "host", reference: { binding: contract.binding, resultRef: "source-result" }, readOwner: readback });
  await f.observer.drain(); await f.call(); const before = legacy(f.query()); fail = true;
  const result = await f.call(); assert.equal(result.details.available, false); assert.deepEqual(legacy(f.query()), before);
  assert.equal(f.query().codeProgress.coverage, "unavailable"); assert.equal(f.query().codeProgress.seq, 2);
  assert.equal(f.query().codeProgress.observations[0].observedAt, now);
});

test("tree/session resets fence slow reads; shutdown empties only its own scope", async () => {
  let finish;
  const f = fixture(() => new Promise(resolve => { finish = resolve; }));
  const call = f.call(); await new Promise(resolve => setImmediate(resolve));
  const before = f.query().observerEpoch; f.handlers.get("session_tree")();
  finish({ progress: codeProgressRow(contract, "required_checks_pending", now) });
  assert.equal((await call).details.published, false); assert.notEqual(f.query().observerEpoch, before);
  assert.equal(f.query().codeProgress.seq, 0); assert.equal(f.query().codeProgress.observations.length, 0);
  f.handlers.get("session_shutdown")(); assert.equal(f.observer.observationSnapshot().codeProgress.coverage, "unavailable");
  assert.equal(f.observer.observationSnapshot().codeProgress.observations.length, 0);
});

test("one explicit read at a time, abort is bounded and late completion never publishes", async () => {
  let finish;
  const f = fixture(() => new Promise(resolve => { finish = resolve; })), controller = new AbortController();
  const first = f.call(controller.signal); await new Promise(resolve => setImmediate(resolve));
  assert.equal((await f.call()).details.reasonCode, "code_observation_busy"); controller.abort();
  assert.equal((await first).details.available, false); const after = f.query();
  finish({ progress: codeProgressRow(contract, "required_checks_pending", now) }); await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(f.query(), after); assert.equal(f.reads(), 1);
});

test("model phase/accepted parameters and private path errors are not observation authority", async () => {
  const f = fixture(async () => assert.fail("unexpected read"));
  let invoked = 0;
  const bad = Object.defineProperty({}, "contractFile", { enumerable: true, get() { invoked++; throw Error(); } });
  assert.equal((await f.call(undefined, bad)).details.reasonCode, "contract_invalid");
  assert.equal((await f.call(undefined, { contractFile: "/private/contract", accepted: true })).details.reasonCode, "contract_invalid");
  assert.equal(invoked, 0); assert.equal(f.reads(), 0);
});
