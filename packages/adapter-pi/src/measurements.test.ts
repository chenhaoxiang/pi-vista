import test from "node:test";
import { deepStrictEqual, strictEqual, ok } from "node:assert";
import { createPiRunContext, type PiMeasurementStage, type PiMeasurementsInput, type VistaEvent } from "./index.js";

const stages: PiMeasurementStage[] = ["initialization", "request-first-token", "generation", "tool", "build-test", "review-ci", "subagent"];

test("stage measurements reuse the context identity and safe existing artifact stats", async () => {
  const events: VistaEvent[] = [];
  const context = createPiRunContext({ runId: "native-run", sessionId: "parent-session", now: 1000,
    store: { async append(event) { events.push(event); } } });
  for (const stage of stages) {
    const event = await context.emitMeasurements({ runId: "native-run", childIndex: 0, stage,
      durationMs: 12.5, toolCount: 2, inputCount: 10, outputCount: 4, cacheReadCount: 1, cacheWriteCount: 0, sdkCost: 0, exitCode: 0 });
    strictEqual(event?.run_id, "native-run"); strictEqual(event?.session_id, "parent-session");
    strictEqual(event?.action, `pi:measurements:${stage}`); strictEqual(event?.result, "unknown");
    deepStrictEqual(event?.artifact_refs?.[0]?.stats, { stage, usage_unit: "sdk-token", observation: "host-projected",
      child_index: 0, duration_ms: 12.5, tool_count: 2, usage_in_count: 10, usage_out_count: 4,
      cache_read_count: 1, cache_write_count: 0, sdk_cost: 0, exit_code: 0, cost_status: "unpriced" });
    strictEqual(event?.artifact_refs?.[0]?.verified, undefined);
  }
  strictEqual(events.length, stages.length);
  strictEqual(events.some(event => JSON.stringify(event).includes("prompt")), false);
});

test("absent measurements are unknown and a failed process is not task verification", async () => {
  const context = createPiRunContext({ runId: "native-run", store: { async append() {} } });
  const missing = await context.emitMeasurements({ stage: "initialization" });
  const stats = missing?.artifact_refs?.[0]?.stats; ok(stats);
  for (const key of ["duration_ms", "tool_count", "usage_in_count", "sdk_cost", "cost_status", "exit_code"]) strictEqual(stats[key], "unknown");
  const measured = await context.emitMeasurements({ stage: "subagent", sdkCost: 0.25, exitCode: 1, toolCount: 0 });
  strictEqual(measured?.result, "unknown"); strictEqual(measured?.artifact_refs?.[0]?.stats?.cost_status, "sdk-reported");
  strictEqual(measured?.artifact_refs?.[0]?.stats?.exit_code, 1);
});

test("whole native metadata, raw content, unsafe values, and wrong run bindings are dropped fail-open", async () => {
  let emitted = 0; let getters = 0; let traps = 0;
  const context = createPiRunContext({ runId: "native-run", emit: async () => { emitted++; return undefined; } });
  const inputs = [
    { stage: "tool", prompt: "PRIVATE_SENTINEL" }, { stage: "tool", runId: "mission-or-other-run" },
    { stage: "tool", runId: "parent-session" }, { stage: "tool", durationMs: Number.NaN },
    { stage: "tool", durationMs: Infinity }, { stage: "tool", toolCount: -1 }, { stage: "tool", toolCount: 0.5 },
    { stage: "tool", childIndex: -1 }, { stage: "tool", inputCount: Number.MAX_SAFE_INTEGER + 1 },
    { stage: "tool", sdkCost: -1 }, { stage: "tool", exitCode: 1.5 }, { stage: "raw-stage-command" },
    Object.defineProperty({ stage: "tool" }, "durationMs", { get() { getters++; throw Error("PRIVATE_SENTINEL"); } }),
    Object.create({ stage: "tool" }), new Proxy({ stage: "tool" }, { ownKeys() { traps++; throw Error("PRIVATE_SENTINEL"); } }),
  ];
  for (const input of inputs) strictEqual(await context.emitMeasurements(input as PiMeasurementsInput), undefined);
  strictEqual(emitted, 0); strictEqual(getters, 0); strictEqual(traps, 0);
});

test("measurement observer rejection or timeout never changes primary execution", async () => {
  for (const emit of [async () => { throw Error("PRIVATE_SENTINEL"); }, () => new Promise<undefined>(() => {})]) {
    const context = createPiRunContext({ runId: "native-run", persistTimeoutMs: 5, emit });
    strictEqual(await context.emitMeasurements({ stage: "review-ci", durationMs: 7 }), undefined);
  }
});
