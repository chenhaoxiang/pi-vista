import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { isVistaEvent } from "@pi-vista/core";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { ROOT } from "./release-utils.mjs";
import { createPiWorkObserver, OWNER_RESULT_EVENT, HANDOFF_EVENT, WORK_OBSERVATION_QUERY_EVENT, WORK_OBSERVATION_REPLY_PREFIX, WORK_OBSERVATION_CHANGED_EVENT } from "./pi-work-observer.mjs";

const since = "2026-01-01T00:00:00.000Z", now = Date.now();
function fixture(extra = {}) {
  const handlers = new Map(), commands = new Map(), events = new EventEmitter(), rows = [], diagnostics = [];
  const pi = { on(name, fn) { handlers.set(name, fn); return () => handlers.delete(name); },
    events: { emit(name, payload) { events.emit(name, payload); }, on(name, fn) { events.on(name, fn); return () => events.off(name, fn); } },
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

test("SDK child refuses sibling and traversal fixture paths before SDK or writes", () => {
  for (const fixture of [join(ROOT, "tmp/release-contract-sibling"), `${ROOT}/tmp/release-contract/../outside`]) {
    const result = spawnSync(process.execPath, [join(ROOT, "scripts/pi-work-observer-sdk.mjs"), "--sdk=/fixture/sdk", "--entry=/fixture/entry.ts", `--fixture=${fixture}`, "--scenario=normal"], { encoding: "utf8" });
    assert.equal(result.status, 1); assert.match(result.stderr, /AssertionError/);
    assert.ok(!result.stderr.includes("ERR_MODULE_NOT_FOUND"));
  }
});

test("observation snapshot is memory-only, epoch/seq bounded and query does not re-read owner", async () => {
  let clock = now;
  const f = fixture({ now: () => clock }); f.handlers.get("session_start")({}, f.ctx());
  let reply, changes = [];
  f.events.on(WORK_OBSERVATION_CHANGED_EVENT, value => changes.push(value));
  f.events.emit(WORK_OBSERVATION_QUERY_EVENT, { version: 1, requestId: "q1", hostSessionId: "session-new" });
  f.events.on(WORK_OBSERVATION_REPLY_PREFIX + "q2", value => { reply = value; });
  f.events.emit(WORK_OBSERVATION_QUERY_EVENT, { version: 1, requestId: "q2", hostSessionId: "session-new" });
  assert.equal(reply.snapshot.coverage, "not-observed"); assert.equal(reply.snapshot.seq, 0); assert.equal(reply.snapshot.observations.length, 0);
  assert.equal(changes.length, 0); // no query side effect
  let reads = 0, view;
  send(f, () => { reads++; return accepted(); }, value => { view = value; }); await f.observer.drain();
  assert.equal(reads, 1); assert.equal(changes.at(-1).snapshot.coverage, "observed");
  const before = changes.at(-1).snapshot;
  f.events.on(WORK_OBSERVATION_REPLY_PREFIX + "q3", value => { reply = value; });
  const writes = f.rows.length; clock += 1000;
  f.events.emit(WORK_OBSERVATION_QUERY_EVENT, { version: 1, requestId: "q3", hostSessionId: "session-new" });
  assert.deepEqual(reply.snapshot, before); assert.equal(reply.snapshot.observations[0].observation, view);
  assert.equal(view.binding.sessionId, "child-session"); assert.equal(reply.snapshot.hostSessionId, "session-new");
  assert.equal(f.rows.length, writes); assert.equal(changes.at(-1).snapshot.seq, before.seq); assert.equal(reads, 1); assert.equal(view.decision, "deliverable");
  assert.equal(reply.snapshot.observations[0].observedAt, now); assert.equal(Object.hasOwn(reply.snapshot.observations[0].observation, "freshUntil"), false);
  assert.throws(() => reply.snapshot.observations.push({}), TypeError);
  assert.throws(() => { reply.snapshot.observations[0].observation.binding.workRef.key = "changed"; }, TypeError);
  for (let i = 0; i < 20; i++) { const ref = reference("child-session", `run-${i}`); send(f, () => accepted(ref), () => {}, ref); } await f.observer.drain();
  const snapshot = f.observer.observationSnapshot();
  assert.equal(snapshot.observations.length, 16); assert.equal(snapshot.omitted, 5);
  assert.equal(snapshot.seq, 21); assert.deepEqual(snapshot.observations.map(row => row.seq), Array.from({ length: 16 }, (_, i) => i + 6));
  assert.ok(snapshot.observations.every(row => row.observation.outcome === "accepted"));
});

test("publication reset fences late observations without cancelling the native owner reader", async () => {
  const f = fixture(); f.handlers.get("session_start")({}, f.ctx()); let finish, callbacks = 0;
  send(f, () => new Promise(resolve => { finish = resolve; }), () => callbacks++); await Promise.resolve();
  const old = f.observer.observationSnapshot().observerEpoch;
  f.handlers.get("session_tree")(); const next = f.observer.observationSnapshot(); assert.notEqual(next.observerEpoch, old);
  finish(accepted()); await f.observer.drain();
  assert.equal(callbacks, 1); // native owner callback is not a display subscription
  assert.equal(f.observer.observationSnapshot().observations.length, 0);
  assert.equal(f.observer.observationSnapshot().coverage, "not-observed");
});

test("snapshot shutdown clears results and stale instances stop replying", async () => {
  const f = fixture(); const changes = []; f.events.on(WORK_OBSERVATION_CHANGED_EVENT, value => changes.push(value));
  f.handlers.get("session_start")({}, f.ctx()); send(f, () => accepted()); await f.observer.drain();
  const old = f.observer.observationSnapshot(); f.handlers.get("session_shutdown")();
  assert.equal(changes.at(-1).snapshot.coverage, "unavailable"); assert.equal(changes.at(-1).snapshot.observations.length, 0);
  let replies = 0; f.events.on(WORK_OBSERVATION_REPLY_PREFIX + "closed", () => replies++);
  f.events.emit(WORK_OBSERVATION_QUERY_EVENT, { version: 1, requestId: "closed", hostSessionId: "session-new" }); assert.equal(replies, 0);
  f.handlers.get("session_start")({}, f.ctx()); assert.notEqual(f.observer.observationSnapshot().observerEpoch, old.observerEpoch);
  assert.equal(f.observer.observationSnapshot().seq, 0);
});

test("reentrant display lifecycle cannot invoke a retired owner callback or close the new session", async () => {
  const f = fixture(); f.handlers.get("session_start")({}, f.ctx()); let callbacks = 0;
  const onResult = value => {
    if (value.snapshot.coverage === "observed") f.handlers.get("session_start")({}, f.ctx("successor"));
  };
  f.events.on(WORK_OBSERVATION_CHANGED_EVENT, onResult);
  send(f, () => accepted(), () => callbacks++); await f.observer.drain();
  assert.equal(callbacks, 0); assert.equal(f.observer.observationSnapshot().hostSessionId, "successor");
  f.events.off(WORK_OBSERVATION_CHANGED_EVENT, onResult);
  f.events.on(WORK_OBSERVATION_CHANGED_EVENT, value => {
    if (value.snapshot.coverage === "unavailable") f.handlers.get("session_start")({}, f.ctx("reopened"));
  });
  f.handlers.get("session_shutdown")(); let reply;
  f.events.on(WORK_OBSERVATION_REPLY_PREFIX + "reopened", value => { reply = value; });
  f.events.emit(WORK_OBSERVATION_QUERY_EVENT, { version: 1, requestId: "reopened", hostSessionId: "reopened" });
  assert.equal(reply.snapshot.hostSessionId, "reopened"); assert.equal(reply.snapshot.coverage, "not-observed");
});

test("invalid queries and display-listener faults cannot execute payloads or affect original acceptance", async () => {
  const f = fixture(); f.handlers.get("session_start")({}, f.ctx()); let getters = 0, replies = 0;
  f.events.on(WORK_OBSERVATION_REPLY_PREFIX + "bad", () => replies++);
  const query = { version: 1, requestId: "bad", hostSessionId: "session-new" };
  for (const value of [new Proxy(query, { get() { getters++; throw Error(); } }), Object.defineProperty({}, "version", { get() { getters++; return 1; } }), { ...query, extra: true }, { ...query, version: 2 }, { ...query, requestId: "x:y" }]) f.events.emit(WORK_OBSERVATION_QUERY_EVENT, value);
  assert.equal(getters, 0); assert.equal(replies, 0);
  f.events.on(WORK_OBSERVATION_CHANGED_EVENT, () => { throw Error("PRIVATE_DISPLAY_ERROR"); });
  let view; send(f, () => accepted(), value => { view = value; }); await f.observer.drain();
  assert.equal(view.decision, "deliverable"); assert.equal(f.observer.observationSnapshot().observations.length, 1);
  assert.ok(f.diagnostics.length <= 1); assert.ok(!JSON.stringify(f.rows).includes("PRIVATE_DISPLAY_ERROR"));
});

test("handoff snapshot reuses the full existing DTO without claiming current verification", async () => {
  const f = fixture(); f.handlers.get("session_start")({}, f.ctx());
  f.events.emit(HANDOFF_EVENT, { hostSessionId: "session-new", reference: {} }); await f.observer.drain();
  const entry = f.observer.observationSnapshot().observations[0]; assert.equal(entry.kind, "handoff");
  assert.equal(entry.observation.currentVerification, "not_checked"); assert.equal(entry.observation.executable, false);
  assert.equal(entry.observation.authorization, "none");
});

test("raw paths and known credentials are not echoed as routing identities", () => {
  for (const host of ["/private/session.jsonl", `ghp_${"A".repeat(36)}`]) {
    const f = fixture(); let broadcasts = 0;
    f.events.on(WORK_OBSERVATION_CHANGED_EVENT, () => broadcasts++);
    f.handlers.get("session_start")({}, f.ctx(host));
    assert.equal(f.observer.status().loaded, false); assert.equal(f.observer.observationSnapshot().hostSessionId, null);
    assert.equal(broadcasts, 0);
  }
  const f = fixture(); f.handlers.get("session_start")({}, f.ctx());
  const requestId = `ghp_${"B".repeat(36)}`; let replies = 0;
  f.events.on(WORK_OBSERVATION_REPLY_PREFIX + requestId, () => replies++);
  f.events.emit(WORK_OBSERVATION_QUERY_EVENT, { version: 1, requestId, hostSessionId: "session-new" });
  assert.equal(replies, 0);
});

test("old cohort is not-applicable and foreign observation query stays silent", () => {
  const f = fixture(); f.handlers.get("session_start")({}, f.ctx("old", "2025-12-31T00:00:00.000Z")); let replies = 0;
  f.events.on(WORK_OBSERVATION_REPLY_PREFIX + "q", () => replies++); f.events.emit(WORK_OBSERVATION_QUERY_EVENT, { version: 1, requestId: "q", hostSessionId: "old" });
  assert.equal(f.observer.observationSnapshot().coverage, "not-applicable"); assert.equal(replies, 1);
  f.events.emit(WORK_OBSERVATION_QUERY_EVENT, { version: 1, requestId: "q", hostSessionId: "foreign" }); assert.equal(replies, 1);
});

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
  assert.equal(f.observer.status().unavailable, 0);
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
  const snapshot = f.observer.observationSnapshot(); assert.equal(snapshot.observations[0].observation, view);
  assert.deepEqual(snapshot.observations[0].observation.acceptedFactRefs, ["report-original"]);
  assert.equal(snapshot.observations[0].observation.previous.sessionId, "child-session");
  assert.equal(snapshot.observations[0].observation.successor.sessionId, "new-child");
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
  assert.equal(f.observer.status().todoRecordsMeaning, "observed-not-persisted");
  assert.equal(f.observer.status().persistence, "best-effort");
  const broken = fixture(); broken.pi.events.on = () => { throw Error(); };
  broken.observer.extension(broken.pi); assert.equal(broken.observer.status().loaded, false);
});

test("shutdown invalidates consumers; status command is user-only and read-only", async () => {
  const f = fixture(); f.handlers.get("session_start")({}, f.ctx()); let status;
  await f.commands.get("vista-work-status").handler("", { ui: { notify: value => { status = JSON.parse(value); } } });
  assert.equal(status.authorization, "none"); assert.equal(status.todoCompletionIsDelivery, false);
  f.handlers.get("session_shutdown")(); assert.equal(f.observer.status().loaded, false);
});
