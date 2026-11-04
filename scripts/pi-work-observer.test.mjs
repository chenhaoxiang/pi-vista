import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { isVistaEvent } from "@pi-vista/core";
import { createPiWorkObserver, OWNER_RESULT_EVENT, HANDOFF_EVENT } from "./pi-work-observer.mjs";

const since = "2026-01-01T00:00:00.000Z", now = Date.now();
function fixture(extra = {}) {
  const handlers = new Map(), commands = new Map(), events = new EventEmitter(), rows = [], diagnostics = [];
  const pi = { on(name, fn) { handlers.set(name, fn); return () => handlers.delete(name); },
    events: { on(name, fn) { events.on(name, fn); return () => events.off(name, fn); } },
    registerCommand(name, command) { commands.set(name, command); }, getCommands: () => [] };
  const observer = createPiWorkObserver({ freshSessionsSince: since, now: () => now, store: { append(event) { rows.push(event); } }, diagnose: () => diagnostics.push("unavailable"), ...extra });
  observer.extension(pi);
  const ctx = (id = "session-new", timestamp = since) => ({ sessionManager: { getSessionId: () => id, getHeader: () => ({ id, timestamp }), getBranch() { assert.fail("history scan"); } } });
  return { pi, observer, handlers, commands, events, rows, diagnostics, ctx };
}
function reference(session = "child-session", run = "child-run") {
  return { binding: { workRef: { owner: "example/fixture", kind: "task", key: "existing-task" }, stageId: "report", runId: run, sessionId: session, revision: 0 }, resultRef: "existing-result" };
}
function accepted(ref = reference()) {
  return { binding: ref.binding, sourceKind: "report", sourceRef: "native-report", disposition: "accepted",
    observedAt: new Date(now).toISOString(), freshUntil: new Date(now + 60_000).toISOString(), requiredEvidence: [], evidence: [], requiredEffects: [] };
}
function send(f, readOwner, onObservation = () => {}, ref = reference()) {
  f.events.emit(OWNER_RESULT_EVENT, { hostSessionId: "session-new", reference: ref, readOwner, onObservation });
}
function todo(f, statuses, action = "update", call = "call-1") {
  return f.handlers.get("tool_execution_end")({ toolName: "todo", toolCallId: call,
    result: { details: { action, tasks: statuses.map(([id, status]) => ({ id, status, subject: "PRIVATE_TASK_BODY", metadata: { secret: "PRIVATE_METADATA" } })) } } });
}

test("new cohort loads forward-only; old resumed session stays untouched, no branch read", () => {
  const f = fixture();
  assert.equal(f.handlers.get("session_start")({ reason: "resume" }, f.ctx("old", "2025-12-31T00:00:00.000Z")), undefined);
  assert.equal(f.observer.status().loaded, false); assert.equal(f.rows.length, 0);
  f.handlers.get("session_start")({ reason: "new" }, f.ctx());
  assert.equal(f.observer.status().loaded, true); assert.equal(f.rows.length, 1);
  assert.equal(f.rows[0].action, "pi:work:loaded"); assert.ok(f.rows.every(isVistaEvent));
  assert.equal(f.commands.size, 1); assert.ok(f.commands.has("vista-work-status"));
});

test("SDK unbound command introspection is optional, not a registration failure", () => {
  const f = fixture(); f.pi.getCommands = () => { throw Error("runtime not bound"); }; f.observer.extension(f.pi);
  f.handlers.get("session_start")({}, f.ctx()); assert.equal(f.observer.status().loaded, true);
});

test("missing or mismatched native identity never fabricates a session", () => {
  const f = fixture(); f.handlers.get("session_start")({}, { sessionManager: { getSessionId: () => "x", getHeader: () => ({ id: "y", timestamp: since }) } });
  assert.equal(f.observer.status().loaded, false); assert.deepEqual(f.rows, []);
  for (const value of [undefined, "bad", "2026-01-01"]) assert.throws(() => createPiWorkObserver({ freshSessionsSince: value }), /cohort/);
});

test("native Todo changed states correlate without content capture or delivery upgrade", () => {
  const f = fixture(); f.handlers.get("session_start")({}, f.ctx());
  assert.equal(todo(f, [[1, "pending"]]), undefined);
  todo(f, [[1, "pending"]], "list");
  todo(f, [[1, "in_progress"]]); todo(f, [[1, "completed"]]);
  assert.equal(f.observer.status().todoRecords, 3); assert.equal(f.observer.status().deliverable, 0);
  const records = f.rows.filter(x => x.action === "pi:work:todo-record");
  assert.equal(records.length, 3); assert.ok(records.every(x => x.result === "unknown"));
  assert.equal(new Set(records.map(x => x.trace_id)).size, 1);
  assert.match(records.at(-1).reason_code, /completed_unverified/);
  const raw = JSON.stringify(f.rows); for (const value of ["PRIVATE_TASK_BODY", "PRIVATE_METADATA", "session-new"]) assert.ok(!raw.includes(value));
});

test("Todo clear does not conflate a recycled id; malformed snapshots do not update state", () => {
  const f = fixture(); f.handlers.get("session_start")({}, f.ctx());
  todo(f, [[1, "pending"]]); todo(f, [], "clear", "clear-1"); todo(f, [[1, "pending"]]);
  assert.notEqual(f.rows[1].trace_id, f.rows[2].trace_id);
  todo(f, [[1, "pending"], [1, "completed"]]);
  todo(f, [[1, "invalid"]]);
  assert.equal(f.observer.status().todoRecords, 2);
});

test("owner report reads run through the maintained consumer; not model self-report", async () => {
  const f = fixture(); f.handlers.get("session_start")({}, f.ctx()); let calls = 0, view;
  send(f, request => { calls++; assert.deepEqual(request, { ...reference(), authorization: "none", readOnly: true }); return accepted(); }, x => { view = x; });
  await f.observer.drain(); assert.equal(calls, 1); assert.equal(view.decision, "deliverable");
  assert.equal(view.authorization, "none"); assert.equal(view.readOnly, true);
  assert.equal(f.observer.status().deliverable, 1); assert.equal(f.rows.at(-1).reason_code, "owner_acceptance_confirmed");
});

test("foreign and expired owner results remain unknown", async () => {
  const f = fixture(); f.handlers.get("session_start")({}, f.ctx()); const seen = [];
  send(f, () => accepted(reference("other-session")), x => seen.push(x));
  send(f, () => ({ ...accepted(), freshUntil: new Date(now).toISOString() }), x => seen.push(x));
  await f.observer.drain(); assert.deepEqual(seen.map(x => x.outcome), ["unknown", "unknown"]);
  assert.equal(f.observer.status().deliverable, 0); assert.equal(f.observer.status().unresolved, 2);
});

test("event host mismatch, proxy and getter payloads do not execute readers", async () => {
  const f = fixture(); f.handlers.get("session_start")({}, f.ctx()); let calls = 0;
  f.events.emit(OWNER_RESULT_EVENT, { hostSessionId: "another-session", readOwner() { calls++; } });
  f.events.emit(OWNER_RESULT_EVENT, new Proxy({}, { get() { calls++; throw Error(); } }));
  f.events.emit(OWNER_RESULT_EVENT, Object.defineProperty({}, "hostSessionId", { get() { calls++; throw Error(); } }));
  await f.observer.drain(); assert.equal(calls, 0); assert.equal(f.diagnostics.length, 1);
});

test("observer failure and late rejection never cancel native work or become success", async () => {
  const f = fixture(); f.handlers.get("session_start")({}, f.ctx()); let reject, view;
  send(f, () => new Promise((_, r) => { reject = r; }), x => { view = x; });
  await f.observer.drain(); assert.equal(view.reasonCode, "owner_reader_timeout");
  reject(Error("PRIVATE_READER_ERROR")); await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.observer.status().deliverable, 0); assert.equal(f.observer.status().inFlight, 0);
});

test("late observation retains old identity but cannot callback or settle successor", async () => {
  const f = fixture(); f.handlers.get("session_start")({}, f.ctx()); let resolve, callbacks = 0;
  send(f, () => new Promise(r => { resolve = r; }), () => callbacks++);
  const oldRun = f.rows[0].run_id;
  await Promise.resolve();
  f.handlers.get("session_start")({}, f.ctx("successor")); resolve(accepted());
  await f.observer.drain(); assert.equal(callbacks, 0); assert.equal(f.observer.status().deliverable, 0);
  const late = f.rows.find(x => x.action === "pi:work:owner-result"); assert.equal(late.run_id, oldRun);
});

test("native tree change does not conflate reused Todo records", () => {
  const f = fixture(); f.handlers.get("session_start")({}, f.ctx()); todo(f, [[1, "pending"]]);
  f.handlers.get("session_tree")(); todo(f, [[1, "pending"]]);
  assert.notEqual(f.rows[1].trace_id, f.rows[2].trace_id);
});

test("read and storage saturation stay bounded and do not become execution gates", async () => {
  let settle; const f = fixture(); f.handlers.get("session_start")({}, f.ctx());
  const pending = new Promise(resolve => { settle = resolve; });
  for (let i = 0; i < 40; i++) send(f, () => pending);
  await Promise.resolve(); assert.equal(f.observer.status().inFlight, 32);
  settle(accepted()); await f.observer.drain(); assert.equal(f.observer.status().ownerReads, 32);
  const blockedStore = fixture({ store: { append: () => new Promise(() => {}) } });
  blockedStore.handlers.get("session_start")({}, blockedStore.ctx());
  for (let i = 0; i < 100; i++) todo(blockedStore, [[1, i % 2 ? "pending" : "completed"]]);
  assert.ok(blockedStore.observer.status().unavailable > 0); assert.equal(blockedStore.diagnostics.length, 1);
});

test("valid handoff preserves references and still does not verify current source", async () => {
  const f = fixture(); f.handlers.get("session_start")({}, f.ctx()); let view;
  const previous = reference().binding, successor = { ...previous, runId: "new-run", sessionId: "new-child" };
  const handoff = { handoff_schema: "pi-governance-handoff/1", goal_id: "existing-task", run_id: previous.runId, run_revision: 0,
    source_session_id: previous.sessionId, accepted_facts: ["report-original"], unresolved_effects: ["effect-pending"], blockers: [], next_action: "reconcile",
    successor_constraints: { must_read_current_head: true, must_not_replay_unknown_effect: true, must_not_change_model_silently: true } };
  f.events.emit(HANDOFF_EVENT, { hostSessionId: "session-new", reference: { previous, successor, handoff }, onObservation: value => { view = value; } });
  await f.observer.drain(); assert.equal(view.decision, "handoff_observed"); assert.deepEqual(view.unresolvedEffectRefs, ["effect-pending"]);
  assert.equal(view.currentVerification, "not_checked"); assert.equal(view.executable, false);
});

test("native handoff port preserves unknown current verification", async () => {
  const f = fixture(); f.handlers.get("session_start")({}, f.ctx()); let view;
  f.events.emit(HANDOFF_EVENT, { hostSessionId: "session-new", reference: {}, onObservation: x => { view = x; } });
  await f.observer.drain(); assert.equal(view.reasonCode, "handoff_invalid");
  assert.equal(view.currentVerification, "not_checked"); assert.equal(view.executable, false);
});

test("storage faults and registration failure remain bounded diagnostics only", async () => {
  const f = fixture({ store: { append() { throw Error("PRIVATE_PATH"); } } });
  f.handlers.get("session_start")({}, f.ctx()); todo(f, [[1, "completed"]]);
  assert.equal(f.diagnostics.length, 1); assert.ok(f.observer.status().unavailable >= 2);
  const broken = fixture(); broken.pi.events.on = () => { throw Error(); };
  broken.observer.extension(broken.pi); assert.equal(broken.observer.status().loaded, false);
});

test("shutdown invalidates consumers; status command is user-only and read-only", async () => {
  const f = fixture(); f.handlers.get("session_start")({}, f.ctx()); let status;
  await f.commands.get("vista-work-status").handler("", { ui: { notify: value => { status = JSON.parse(value); } } });
  assert.equal(status.authorization, "none"); assert.equal(status.todoCompletionIsDelivery, false);
  f.handlers.get("session_shutdown")(); assert.equal(f.observer.status().loaded, false);
});
