import { test } from "node:test";
import assert from "node:assert/strict";
import type { PortableRecallConfig } from "../portable-contract.js";
import { archiveFixture } from "../portable.fixtures.js";
import { harness, start, idle, startCall, endCall, TASK } from "./observation.fixtures.js";

async function historyFixture() {
  const f = await archiveFixture(); let time = 20_000;
  const history: PortableRecallConfig = { origins: [f.origin.pin], now: () => time, max_age_ms: 60_000,
    port: { query: async () => ({ documents: [{ document_id: "synthetic-history", bank: TASK.bank }] }),
      read: async reference => ({ ...reference, document: f.plan.document }) } };
  return { history, setNow: (value: number) => { time = value; }, counts: f.transport.counts };
}
for (const detection of ["status", "preview", "adopt"] as const) test(`expired history detected by ${detection} cannot resurrect through a fresh preview clock`, async () => {
  const f = await historyFixture(); const h = harness({ history: f.history }); await start(h);
  const preview = await h.controller.preview(); const run = preview.run_id;
  f.setNow(80_001);
  if (detection === "status") assert.equal(h.controller.status().history, "MISSING");
  else if (detection === "preview") await assert.rejects(h.controller.preview(), /refused/u);
  else await assert.rejects(h.controller.adopt(preview, preview.preview_digest), /refused/u);
  f.setNow(20_000);
  await assert.rejects(h.controller.preview(), /refused/u);
  await assert.rejects(h.controller.adopt(preview, preview.preview_digest), /refused/u);
  const status = h.controller.status(); assert.equal(status.binding!.run_id, run);
  assert.equal(status.history, "MISSING"); assert.equal(status.selection, "none"); assert.equal(status.current, "MISSING");
  assert.equal(status.authorization, "none"); assert.equal(status.executable, false);
  assert.deepEqual(f.counts(), { ingests: 0, readbacks: 0 });
});
for (const transition of ["reset", "session", "shutdown-restart", "settled-next-run", "task-drift"] as const) test(`controller history high-water survives ${transition} epoch replacement`, async () => {
  const f = await historyFixture(); const h = harness({ history: f.history }); await start(h);
  const preview = await h.controller.preview(); f.setNow(80_001);
  assert.equal(h.controller.status().history, "MISSING"); f.setNow(20_000);
  if (transition === "reset") { h.controller.reset(); h.fire("agent_start"); }
  if (transition === "session") { h.fire("session_start"); h.fire("agent_start"); }
  if (transition === "shutdown-restart") { h.controller.shutdown(); h.fire("session_start"); h.fire("agent_start"); }
  if (transition === "settled-next-run") { h.fire("agent_settled"); await idle(h.controller); h.fire("agent_start"); }
  if (transition === "task-drift") {
    h.setTask({ ...TASK, task_goal: "new bounded goal" }); await assert.rejects(h.controller.preview(), /refused/u);
  }
  await idle(h.controller);
  assert.notEqual(h.controller.status().binding!.run_id, preview.run_id);
  await assert.rejects(h.controller.preview(), /refused/u);
  await assert.rejects(h.controller.adopt(preview, preview.preview_digest), /refused/u);
  assert.equal(h.controller.status().history, "MISSING"); assert.equal(h.controller.status().selection, "none");
});
test("a detected backward history clock cannot be bypassed by replacing a still-young preview", async () => {
  const f = await historyFixture(); const h = harness({ history: f.history }); await start(h);
  const preview = await h.controller.preview(); f.setNow(10_000);
  assert.equal(h.controller.status().history, "MISSING");
  await assert.rejects(h.controller.preview(), /refused/u);
  await assert.rejects(h.controller.adopt(preview, preview.preview_digest), /refused/u);
  assert.equal(h.controller.status().current, "MISSING");
});
for (const loss of ["unmatched-end", "missing-name", "accessor-name"] as const) test(`${loss} identity is remembered without rebinding or reading a getter`, async () => {
  const h = harness(); await start(h); let getterCalls = 0;
  if (loss === "unmatched-end") h.fire("tool_execution_end", endCall("lost-native-id"));
  else if (loss === "missing-name") h.fire("tool_execution_start", { toolCallId: "lost-native-id" });
  else h.fire("tool_execution_start", { toolCallId: "lost-native-id", get toolName() { getterCalls++; throw Error("must-not-read"); } });
  assert.equal(h.controller.status().correlations, 1);
  h.fire("tool_execution_start", startCall("lost-native-id"));
  h.fire("tool_execution_end", endCall("lost-native-id")); await idle(h.controller);
  assert.equal(h.events.filter(e => e.action === "pi:tool-execution-start" || e.action === "pi:tool-execution-end").length, 0);
  assert.equal(h.controller.status().dropped, 3); assert.equal(getterCalls, 0);
  assert.doesNotMatch(JSON.stringify(h.events) + JSON.stringify(h.checkpoints), /lost-native-id|must-not-read/u);
});
test("lost identities obey the same fixed per-epoch quota and never evict or admit a later call", async () => {
  const h = harness({ max_correlations: 2 }); await start(h);
  for (const id of ["lost-one", "lost-two", "over-limit"]) h.fire("tool_execution_end", endCall(id));
  assert.equal(h.controller.status().correlations, 2);
  for (const id of ["lost-one", "lost-two", "over-limit", "fresh-over-limit"]) {
    h.fire("tool_execution_start", startCall(id)); h.fire("tool_execution_end", endCall(id));
  }
  await idle(h.controller); assert.equal(h.controller.status().correlations, 2);
  assert.equal(h.events.filter(e => e.action.startsWith("pi:tool-execution-")).length, 0);
});
test("a new run may use a previously lost native identity without cross-run step carryover", async () => {
  const h = harness(); await start(h); const oldRun = h.controller.status().binding!.run_id;
  h.fire("tool_execution_end", endCall("lost-prior-run")); assert.equal(h.controller.status().correlations, 1);
  h.fire("session_start"); h.fire("agent_start"); await idle(h.controller);
  const run = h.controller.status().binding!.run_id; assert.notEqual(run, oldRun);
  h.fire("tool_execution_start", startCall("lost-prior-run")); h.fire("tool_execution_end", endCall("lost-prior-run")); await idle(h.controller);
  const result = h.events.find(e => e.action === "pi:tool-execution-end")!;
  assert.equal(result.result, "ok"); assert.equal(result.run_id, run); assert.ok(result.step_id!.startsWith(run));
});
