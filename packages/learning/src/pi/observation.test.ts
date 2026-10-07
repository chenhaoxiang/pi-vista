import { test } from "node:test";
import assert from "node:assert/strict";
import { createPiObservation } from "@pi-vista/learning/pi";
import { deferred } from "../learning.fixtures.js";
import { harness, start, idle, startCall, endCall, delay, TASK } from "./observation.fixtures.js";

const execution = (h: ReturnType<typeof harness>, action: string) => h.events.filter(e => e.action === action);
test("self-contained public Pi consumer exercise uses original signed history and private current verification", async () => {
  const { runPiConsumerFixture } = await import("./consumer.fixtures.js"); await runPiConsumerFixture();
});
test("only seven notification hooks and four explicit non-model commands are registered", async () => {
  const h = harness(); assert.deepEqual([...h.hooks.keys()].sort(), ["agent_end", "agent_settled", "agent_start", "session_shutdown", "session_start", "tool_execution_end", "tool_execution_start"].sort());
  assert.deepEqual([...h.commands.keys()].sort(), ["vista-adopt", "vista-preview", "vista-status", "vista-verify"]);
  assert.throws(() => h.extension(h.api), /refused/u); assert.equal(h.taskCalls(), 0); assert.equal(h.controller.status().current, "MISSING");
});
test("parallel nested and out-of-order execution ends keep original unique steps", async () => {
  const h = harness(); await start(h);
  for (const id of ["native-A", "native-B", "native-A/1"]) h.fire("tool_execution_start", startCall(id));
  for (const id of ["native-B", "native-A/1", "native-A"]) h.fire("tool_execution_end", endCall(id)); await idle(h.controller);
  const starts = execution(h, "pi:tool-execution-start"); const ends = execution(h, "pi:tool-execution-end");
  assert.equal(starts.length, 3); assert.equal(new Set(starts.map(e => e.step_id)).size, 3);
  assert.deepEqual(ends.map(e => e.step_id), [starts[1]!.step_id, starts[2]!.step_id, starts[0]!.step_id]);
  assert.ok(ends.every(e => e.result === "ok")); assert.doesNotMatch(JSON.stringify(h.events), /native-|raw-argument|raw-result/u);
});
for (const error of [true, false, undefined, "successful"]) test(`execution isError ${String(error)} is observational only`, async () => {
  const h = harness(); await start(h); h.fire("tool_execution_start", startCall("one", "unknown-tool")); h.fire("tool_execution_end", { toolCallId: "one", ...(error === undefined ? {} : { isError: error }) }); await idle(h.controller);
  const e = execution(h, "pi:tool-execution-end")[0]!; assert.equal(e.result, error === true ? "failed" : error === false ? "ok" : "unknown");
  assert.equal(e.target_class, "unclassified"); assert.equal(h.controller.status().current, "MISSING"); assert.equal(h.controller.status().executable, false);
});
test("duplicate/reused/unmatched call identities never bind successful coverage", async () => {
  const h = harness(); await start(h);
  h.fire("tool_execution_start", startCall("duplicate")); h.fire("tool_execution_start", startCall("duplicate")); h.fire("tool_execution_end", endCall("duplicate"));
  h.fire("tool_execution_end", endCall("unmatched")); h.fire("tool_execution_start", startCall("normal")); h.fire("tool_execution_end", endCall("normal"));
  h.fire("tool_execution_end", endCall("normal")); h.fire("tool_execution_start", startCall("normal")); h.fire("tool_execution_end", endCall("normal")); await idle(h.controller);
  assert.equal(execution(h, "pi:tool-execution-end").length, 1); assert.equal(h.controller.status().dropped, 6);
});
test("correlation quota bounds all distinct identities in an epoch without eviction/rebinding", async () => {
  const h = harness({ max_correlations: 2 }); await start(h);
  for (const id of ["one", "two", "three"]) { h.fire("tool_execution_start", startCall(id)); h.fire("tool_execution_end", endCall(id)); } await idle(h.controller);
  assert.equal(h.controller.status().correlations, 2); assert.equal(h.controller.status().dropped, 2); assert.equal(execution(h, "pi:tool-execution-end").length, 2);
});
test("agent_end and automatic retry retain epoch until agent_settled; no final PASS", async () => {
  const h = harness(); await start(h); const run = h.controller.status().binding!.run_id;
  h.fire("tool_execution_start", startCall("one")); h.fire("agent_end", { get messages() { return assert.fail("messages must not be read"); } }); h.fire("agent_start");
  h.fire("tool_execution_end", endCall("one")); await idle(h.controller); assert.equal(h.controller.status().binding!.run_id, run); assert.equal(h.controller.status().phase, "active");
  h.fire("agent_settled"); h.fire("agent_settled"); await idle(h.controller); assert.equal(h.controller.status().phase, "settled");
  assert.equal(execution(h, "pi:agent-settled").length, 1); assert.equal(h.controller.status().correlations, 0);
  assert.ok(h.checkpoints.every(c => !c.resumable && c.completed_steps.length === 0 && c.check_fn_ids.length === 0));
  h.fire("agent_start"); await idle(h.controller); assert.notEqual(h.controller.status().binding!.run_id, run);
});
for (const reason of ["startup", "reload", "new", "fork", "resume"]) test(`session_start ${reason} invalidates correlations and bindings without inspecting history`, async () => {
  const h = harness(); await start(h); const run = h.controller.status().binding!.run_id; h.fire("tool_execution_start", startCall("one"));
  h.fire("session_start", { reason, get previousSessionFile() { return assert.fail("raw session file"); } }); h.fire("agent_start"); await idle(h.controller);
  assert.notEqual(h.controller.status().binding!.run_id, run); h.fire("tool_execution_end", endCall("one")); assert.equal(h.controller.status().dropped, 1);
});
test("shutdown is idempotent and late resolver cannot revive previous epoch", async () => {
  const d = deferred<unknown>(); const h = harness({ resolve_task: () => d.promise }); h.fire("agent_start"); await delay(1);
  h.fire("session_shutdown"); h.controller.shutdown(); h.fire("agent_start"); h.fire("tool_execution_start", startCall("obsolete")); d.resolve(TASK); await idle(h.controller);
  assert.equal(h.controller.status().phase, "shutdown"); assert.equal(h.controller.status().binding, undefined); assert.equal(h.events.length, 0);
  h.fire("session_start"); h.fire("agent_start"); await idle(h.controller); assert.equal(h.controller.status().phase, "active");
});
for (const port of ["events", "checkpoints"] as const) for (const fault of ["throw", "reject", "hang", "late-reject", "thenable"] as const) test(`${port} ${fault} preserves synchronous notifications and consumes late failure`, async () => {
  const d = deferred<unknown>(); const callback = () => {
    if (fault === "throw") throw Error("private-backend-canary"); if (fault === "reject") return Promise.reject(Error("private-backend-canary"));
    if (fault === "thenable") return { get then() { return assert.fail("thenable getter"); } } as unknown as Promise<unknown>; return d.promise;
  };
  const h = harness({ timeout_ms: 15, ...(port === "events" ? { events: { append: callback } } : { checkpoints: { save: callback } }) });
  await start(h); h.fire("tool_execution_start", startCall("one")); h.fire("tool_execution_end", endCall("one")); await idle(h.controller);
  if (fault === "late-reject") { d.reject(Error("private-backend-canary")); await delay(2); }
  assert.equal(h.controller.status().phase, "active"); assert.equal(h.controller.status().current, "MISSING"); assert.ok(h.controller.status().dropped > 0);
  assert.doesNotMatch(JSON.stringify(h.controller.status()), /backend-canary/u);
});
test("bounded pending work drops backlog; timed-out native callbacks retain physical quota", async () => {
  const d = deferred<unknown>(); let calls = 0; const h = harness({ timeout_ms: 10, max_pending_work: 2, events: { append: () => { calls++; return d.promise; } } });
  await start(h);
  for (let i = 0; i < 12; i++) h.fire("tool_execution_start", startCall(`call-${i}`)); await idle(h.controller);
  assert.ok(h.controller.status().dropped >= 11); assert.equal(h.controller.status().pending_callbacks, 2); assert.equal(calls, 2);
  h.fire("tool_execution_end", endCall("call-0")); await idle(h.controller); assert.equal(calls, 2);
  d.reject(Error("private-late-canary")); await delay(2); assert.equal(h.controller.status().pending_callbacks, 0);
});
for (const input of [null, {}, { ...TASK, raw: "private" }, { ...TASK, task_goal: "/private/path" }, { ...TASK, repo: "wrapped-ghp_" + "a".repeat(36) }]) test(`invalid task snapshot ${JSON.stringify(input)} remains MISSING and fail-open`, async () => {
  const h = harness({ resolve_task: async () => input }); await start(h); assert.equal(h.controller.status().phase, "MISSING"); assert.equal(h.events.length, 0); assert.equal(h.checkpoints.length, 0);
});
for (const failure of ["throw", "reject", "hang", "thenable"] as const) test(`task resolver ${failure} cannot block or populate binding`, async () => {
  const h = harness({ timeout_ms: 10, resolve_task: () => {
    if (failure === "throw") throw Error("private-task-canary");
    if (failure === "reject") return Promise.reject(Error("private-task-canary"));
    if (failure === "thenable") return { get then() { return assert.fail("then getter"); } } as unknown as Promise<unknown>;
    return new Promise(() => undefined);
  } });
  await start(h); assert.equal(h.controller.status().binding, undefined); assert.equal(h.controller.status().phase, "MISSING");
  assert.equal(h.events.length, 0); assert.doesNotMatch(JSON.stringify(h.controller.status()), /task-canary/u);
});
test("absent stores do not call any emitter default or retain raw event descriptors", async () => {
  const addon = createPiObservation({ now: () => 20_000, resolve_task: async () => TASK, tools: [] });
  const h = harness(); const host = h.api; const handlers = h.hooks; handlers.clear(); h.commands.clear(); addon.extension(host);
  handlers.get("agent_start")!({}, h.ctx); await idle(addon.controller); assert.equal(addon.controller.status().dropped, 0);
});
