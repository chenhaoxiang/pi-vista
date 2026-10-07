import { deepStrictEqual, ok, rejects, strictEqual, throws } from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import process from "node:process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { emitVistaEvent, EventStore, isVistaEvent, type VistaEvent } from "@pi-vista/core";
import { emitShadowObservation, type ShadowEmitOptions } from "@pi-vista/adapter-shadow";
import { binding, fixedError, HASH, mutable, observation, OTHER_HASH, row, asset } from "./fixtures.mjs";

function options(value: unknown): ShadowEmitOptions {
  return value as ShadowEmitOptions;
}

function minimal(run_id: string) {
  const input = mutable(observation({ correlation: { run_id } }));
  delete input.request;
  delete input.vote;
  return input as unknown as Parameters<typeof emitShadowObservation>[0];
}

test("explicit public core emission returns a valid frozen event and only sanitized metadata", async () => {
  const captured: VistaEvent[] = [];
  const result = await emitShadowObservation(observation({ row_evidence: row(), asset_evidence: asset() }), {
    store: { async append(event) { captured.push(event); } }, now: 42, seq: 7,
  });
  ok(result);
  ok(isVistaEvent(result));
  strictEqual(result.ts, 42);
  strictEqual(result.run_id, "shadow-run");
  strictEqual(result.step_id, "shadow-run_0");
  strictEqual(result.result, "unknown");
  strictEqual(result.vista_version, "0.1.0");
  strictEqual(captured.length, 1);
  strictEqual(captured[0], result);
  ok(Object.isFrozen(result));
  ok(Object.isFrozen(result.artifact_refs));
  throws(() => { mutable(result).result = "ok"; }, TypeError);
  for (const ref of result.artifact_refs ?? []) {
    ok(Object.isFrozen(ref));
    if (ref.stats !== undefined) ok(Object.isFrozen(ref.stats));
    strictEqual(Object.hasOwn(ref, "verified"), false);
  }
});

test("core remains the sole default step sequencer, shared with direct public core emissions", async () => {
  const store = { async append() {} };
  const first = await emitShadowObservation(minimal("shadow-sequence-test"), { store, now: 1 });
  const second = await emitVistaEvent({ run_id: "shadow-sequence-test", component: "test", action: "observe", result: "unknown" }, { store, now: 2 });
  const third = await emitShadowObservation(minimal("shadow-sequence-test"), { store, now: 3 });
  strictEqual(first?.step_id, "shadow-sequence-test_s0");
  strictEqual(second?.step_id, "shadow-sequence-test_s1");
  strictEqual(third?.step_id, "shadow-sequence-test_s2");
});

test("explicit run/step options corroborate input; unsafe/conflicting options cannot hide behind an input ID", async () => {
  let writes = 0;
  const store = { async append() { writes++; } };
  for (const runId of ["other-run", "/private/run", "receipt_ghp_" + "A".repeat(36), undefined]) {
    await rejects(emitShadowObservation(observation(), options({ store, runId })), fixedError);
  }
  for (const stepId of ["shadow-run_other", "other-run_0", "/private/step", "shadow-run_ghp_" + "A".repeat(36), undefined]) {
    await rejects(emitShadowObservation(observation(), options({ store, stepId })), fixedError);
  }
  strictEqual(writes, 0);
  const result = await emitShadowObservation(observation(), { store, runId: "shadow-run", stepId: "shadow-run_0", now: 1 });
  strictEqual(result?.step_id, "shadow-run_0");
  const optionStep = await emitShadowObservation(minimal("explicit-step-run"), { store, stepId: "explicit-step-run_a", now: 1 });
  strictEqual(optionStep?.step_id, "explicit-step-run_a");
});

test("request/vote/source/shared-input mismatches reject before all trusted callbacks", async () => {
  let callbacks = 0;
  const config = { store: { async append() { callbacks++; } }, now: () => { callbacks++; return 1; } };
  for (const side of ["request", "vote"]) {
    for (const correlation of [binding({ request_id: "mismatch" }), binding({ source_sha: OTHER_HASH }), binding({ shared_input_hash: OTHER_HASH })]) {
      await rejects(emitShadowObservation(observation({ [side]: correlation }), config), fixedError);
    }
  }
  await rejects(emitShadowObservation(observation({ promotionEligible: true }), config), fixedError);
  strictEqual(callbacks, 0);
});

test("options and store wrapper are closed own-data records, with fixed errors and no getter calls", async () => {
  let callbacks = 0;
  const goodStore = { async append() { callbacks++; } };
  const accessor = { store: goodStore };
  Object.defineProperty(accessor, "runId", { get() { callbacks++; throw new Error("private-option"); } });
  const storeAccessor = {};
  Object.defineProperty(storeAccessor, "append", { get() { callbacks++; throw new Error("private-store"); } });
  for (const value of [null, false, [], new Date(), Object.create({ runId: "shadow-run" }),
    accessor, { store: storeAccessor }, { store: goodStore, unknown: "private-option" }, { store: goodStore, [Symbol("private")]: 1 },
    { store: goodStore, clock: undefined }, { store: { append: undefined } }, { store: { ...goodStore, other: true } },
    { store: new EventStore("/synthetic/no-read") },
  ]) await rejects(emitShadowObservation(observation(), options(value)), fixedError);
  strictEqual(callbacks, 0);
});

test("Proxy options/store/callbacks, including revoked Proxies, reject without traps", async () => {
  let traps = 0;
  const trap = (): never => { traps++; throw new Error("private-proxy-error"); };
  const handler: ProxyHandler<object> = { get: trap, getPrototypeOf: trap, ownKeys: trap, getOwnPropertyDescriptor: trap, has: trap };
  for (const [target, wrap] of [
    [{ now: 1 }, (value: unknown) => value],
    [{ async append() {} }, (value: unknown) => ({ store: value })],
  ] as const) {
    const proxy = new Proxy(target, handler);
    await rejects(emitShadowObservation(observation(), options(wrap(proxy))), fixedError);
    const revoked = Proxy.revocable(target, handler);
    revoked.revoke();
    await rejects(emitShadowObservation(observation(), options(wrap(revoked.proxy))), fixedError);
  }
  const callback = new Proxy(() => 1, { apply: trap });
  for (const value of [{ now: callback }, { clock: callback }, { store: { append: callback } }]) {
    await rejects(emitShadowObservation(observation(), options(value)), fixedError);
  }
  const revokedCallback = Proxy.revocable(() => 1, { apply: trap });
  revokedCallback.revoke();
  await rejects(emitShadowObservation(observation(), options({ now: revokedCallback.proxy })), fixedError);
  strictEqual(traps, 0);
});

test("every emission option rejects undefined/malformed numeric/config/callback values before callbacks", async () => {
  let callbacks = 0;
  const store = { async append() { callbacks++; } };
  for (const key of ["store", "baseDir", "runId", "stepId", "seq", "now", "clock", "persistTimeoutMs"]) {
    await rejects(emitShadowObservation(observation(), options({ store, [key]: undefined })), fixedError);
  }
  for (const seq of [-1, 0.1, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, "0", null]) {
    await rejects(emitShadowObservation(observation(), options({ store, seq })), fixedError);
  }
  for (const persistTimeoutMs of [-1, NaN, Infinity, 2_147_483_648, "1", null]) {
    await rejects(emitShadowObservation(observation(), options({ store, persistTimeoutMs })), fixedError);
  }
  for (const baseDir of ["", "bad\npath", "a".repeat(4097), false, null]) {
    await rejects(emitShadowObservation(observation(), options({ store, baseDir })), fixedError);
  }
  for (const now of [NaN, Infinity, "1", null, {}]) await rejects(emitShadowObservation(observation(), options({ store, now })), fixedError);
  for (const clock of [1, "clock", null, {}]) await rejects(emitShadowObservation(observation(), options({ store, clock })), fixedError);
  strictEqual(callbacks, 0);
});

test("null-prototype/non-enumerable emission options and store own fields are accepted", async () => {
  let writes = 0;
  const store = Object.create(null) as Record<string, unknown>;
  Object.defineProperty(store, "append", { value: async () => { writes++; } });
  const config = Object.create(null) as Record<string, unknown>;
  Object.defineProperty(config, "store", { value: store });
  Object.defineProperty(config, "now", { value: 10 });
  const emitted = await emitShadowObservation(observation(), options(config));
  strictEqual(emitted?.ts, 10);
  strictEqual(writes, 1);
});

test("alias mutation by trusted clock cannot change snapshotted input or store options", async () => {
  const input = observation({ row_evidence: row(), asset_evidence: asset() });
  const store = { async append(event: VistaEvent) { captured = event; } };
  let captured: VistaEvent | undefined;
  const config = { store, now: () => {
    mutable(input).verdict = "deny";
    mutable(input.correlation).run_id = "mutated-run";
    mutable(input.row_evidence).row_sha256 = OTHER_HASH;
    mutable(input.asset_evidence).receipt_ref = "mutated-receipt";
    store.append = async () => { throw new Error("new-alias-append"); };
    return 10;
  } };
  const result = await emitShadowObservation(input, config);
  ok(result);
  strictEqual(result.result, "unknown");
  strictEqual(result.run_id, "shadow-run");
  strictEqual(result.artifact_refs?.find((ref) => ref.type === "shadow_row_evidence")?.stats?.digest_sha256, HASH);
  strictEqual(result.artifact_refs?.find((ref) => ref.type === "shadow_receipt")?.ref, "receipt-1");
  strictEqual(captured, result);
});

test("trusted stores cannot mutate the emitted event, its artifact array or stats", async () => {
  const result = await emitShadowObservation(observation(), { now: 1, store: { async append(event) {
    throws(() => { event.result = "ok"; }, TypeError);
    throws(() => { event.artifact_refs?.push({ type: "gate_receipt", ref: "fake" }); }, TypeError);
    throws(() => { event.artifact_refs![0]!.stats!.safety_role = "allow"; }, TypeError);
  } } });
  strictEqual(result?.result, "unknown");
  strictEqual(result?.artifact_refs?.[0]?.stats?.safety_role, "observation-only");
});

test("core synchronous/async persistence failures and stalled writes remain fail-open with value-free logs", async () => {
  const original = console.error;
  const logs: unknown[][] = [];
  console.error = (...args: unknown[]) => { logs.push(args); };
  try {
    for (const store of [
      { append(): Promise<void> { throw new Error("private-store-message-ghp_" + "A".repeat(36)); } },
      { async append(): Promise<void> { throw new Error("private-store-message"); } },
      { append(): Promise<void> { return new Promise(() => {}); } },
    ]) {
      const started = Date.now();
      const emitted = await emitShadowObservation(observation(), { store, now: 1, persistTimeoutMs: 5 });
      strictEqual(emitted?.result, "unknown");
      ok(Date.now() - started < 1000);
    }
    const construction = await emitShadowObservation(observation(), { now: () => { throw new Error("private-clock-message"); } });
    strictEqual(construction, undefined);
    deepStrictEqual(logs, Array.from({ length: 3 }, () => ["[pi-vista] event emission failed"]));
  } finally { console.error = original; }
});

test("late persistence rejection is handled after timeout without exposing raw failures", async () => {
  const result = await emitShadowObservation(observation(), { now: 1, persistTimeoutMs: 1, store: {
    append() { return new Promise<void>((_resolve, reject) => { setTimeout(() => reject(new Error("private-late-error")), 10); }); },
  } });
  strictEqual(result?.result, "unknown");
  await new Promise((resolve) => setTimeout(resolve, 25));
});

test("required input run identity prevents environment fallback/read or normalization", async () => {
  const previous = Object.getOwnPropertyDescriptor(process, "env");
  ok(previous);
  let reads = 0;
  Object.defineProperty(process, "env", { configurable: true, get() { reads++; throw new Error("private-env-error"); } });
  let result: Awaited<ReturnType<typeof emitShadowObservation>>;
  try { result = await emitShadowObservation(observation(), { now: 1, store: { async append() {} } }); }
  finally { Object.defineProperty(process, "env", previous); }
  strictEqual(reads, 0);
  strictEqual(result?.run_id, "shadow-run");
});

test("explicit core filesystem emission uses only an owned synthetic tmp fixture; raw invalid data is never written", async () => {
  const fixtureRoot = fileURLToPath(new URL("../tmp/", import.meta.url));
  await mkdir(fixtureRoot, { recursive: true });
  const directory = await mkdtemp(join(fixtureRoot, "adapter-shadow-test-"));
  try {
    const store = new EventStore(directory);
    const emitted = await emitShadowObservation(observation({ asset_evidence: asset() }), { baseDir: directory, now: 1 });
    ok(emitted);
    deepStrictEqual(await store.readRun("shadow-run"), [emitted]);
    await rejects(emitShadowObservation(observation({ command: "raw synthetic input" }), { baseDir: directory }), fixedError);
    await rejects(emitShadowObservation(observation({ promotionEligible: true }), { baseDir: directory }), fixedError);
    deepStrictEqual(await store.readRun("shadow-run"), [emitted]);
    const wrapped = await emitShadowObservation(minimal("wrapped-store-run"), { store: { append: (event) => store.append(event) }, now: 2 });
    deepStrictEqual(await store.readRun("wrapped-store-run"), [wrapped]);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
