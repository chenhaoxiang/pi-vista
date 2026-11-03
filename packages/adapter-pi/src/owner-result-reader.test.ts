import { deepStrictEqual, strictEqual } from "node:assert/strict";
import { setImmediate as nextTurn } from "node:timers/promises";
import { test } from "node:test";
import {
  readPiOwnerResult,
  type PiOwnerReadback,
  type PiOwnerResultReaderOptions,
  type PiOwnerResultReadRequest,
  type PiWorkBinding,
} from "./index.js";

const now = Date.parse("2026-11-04T00:00:30.000Z");
const binding: PiWorkBinding = {
  workRef: { owner: "example/reports", kind: "document", key: "report-alias" },
  stageId: "report", runId: "run-1", sessionId: "session-1", revision: 1,
};
const reference = { binding, resultRef: "receipt-result-1" };
function report(): PiOwnerReadback {
  return {
    binding, sourceKind: "report", sourceRef: "original-report-1", disposition: "accepted",
    observedAt: "2026-11-04T00:00:20.000Z", freshUntil: "2026-11-04T00:01:00.000Z",
    requiredEvidence: [], evidence: [], requiredEffects: [],
  };
}

function options(readOwner: PiOwnerResultReaderOptions["readOwner"]): PiOwnerResultReaderOptions {
  return { readOwner, now, timeoutMs: 50 };
}

test("explicit owner reader resolves only the selected existing result with frozen non-authorizing metadata", async () => {
  let calls = 0;
  let request: PiOwnerResultReadRequest | undefined;
  const result = await readPiOwnerResult(reference, options((value) => {
    calls += 1;
    request = value;
    return report();
  }));
  strictEqual(calls, 1);
  deepStrictEqual(request, { ...reference, authorization: "none", readOnly: true });
  strictEqual(Object.isFrozen(request), true);
  strictEqual(Object.isFrozen(request?.binding.workRef), true);
  strictEqual(result.resultRef, reference.resultRef);
  strictEqual(result.decision, "deliverable");
  strictEqual(result.authorization, "none");
  strictEqual(result.readOnly, true);
});

test("async original-owner readback is supported, while copied worker flags alone are not acceptance", async () => {
  strictEqual((await readPiOwnerResult(reference, options(async () => report()))).outcome, "accepted");
  const result = await readPiOwnerResult(reference, options(() => ({ validated: true, pass: true, raw: "private-worker-body" })));
  strictEqual(result.reasonCode, "owner_readback_invalid");
  strictEqual(result.outcome, "unknown");
  strictEqual(JSON.stringify(result).includes("private-worker-body"), false);
});

test("superseded results keep their original reference and attempt without changing the successor", async () => {
  const successor = { ...binding, runId: "successor-run", sessionId: "successor-session", revision: 2 };
  const snapshot = { ...report(), binding: successor };
  const before = JSON.stringify(snapshot);
  const result = await readPiOwnerResult(reference, options(() => snapshot));
  strictEqual(result.reasonCode, "binding_mismatch");
  strictEqual(result.resultRef, reference.resultRef);
  deepStrictEqual(result.binding, binding);
  strictEqual(JSON.stringify(snapshot), before);
});

test("invalid reference/binding or missing reader stays unknown without invoking any host callback", async () => {
  let calls = 0;
  const configured = options(() => { calls += 1; return report(); });
  for (const invalid of [
    { ...reference, binding: { ...binding, revision: -1 } },
    { ...reference, resultRef: "/private/result-body" }, { ...reference, raw: "private-worker-body" }, null,
  ]) {
    const result = await readPiOwnerResult(invalid, configured);
    strictEqual(result.outcome, "unknown");
    strictEqual(result.authorization, "none");
    strictEqual(JSON.stringify(result).includes("/private/result-body"), false);
  }
  const missing = await readPiOwnerResult(reference, {} as PiOwnerResultReaderOptions);
  strictEqual(missing.reasonCode, "reader_options_invalid");
  for (const timeoutMs of [-1, NaN, Infinity, 30_001, 1.5, null]) {
    strictEqual((await readPiOwnerResult(reference, { ...configured, timeoutMs } as PiOwnerResultReaderOptions)).reasonCode, "reader_options_invalid");
  }
  strictEqual(calls, 0);
});

test("host reader exceptions and rejections are value-independent fail-open observations", async () => {
  let nativeRuns = 0;
  const nativeExecution = Promise.resolve().then(() => { nativeRuns += 1; return "native-completed"; });
  const failureText = "/private/task-output command && secret-body";
  for (const readOwner of [
    () => { throw new Error(failureText); },
    () => Promise.reject(new Error(failureText)),
  ]) {
    const result = await readPiOwnerResult(reference, options(readOwner));
    strictEqual(result.reasonCode, "owner_reader_failed");
    strictEqual(result.outcome, "unknown");
    strictEqual(result.resultRef, reference.resultRef);
    strictEqual(JSON.stringify(result).includes(failureText), false);
  }
  strictEqual(await nativeExecution, "native-completed");
  strictEqual(nativeRuns, 1);
});

test("reader timeout never cancels native execution and its late rejection is handled", async () => {
  const unhandled: unknown[] = [];
  const onUnhandled = (reason: unknown): void => { unhandled.push(reason); };
  process.on("unhandledRejection", onUnhandled);
  let rejectRead: ((reason: Error) => void) | undefined;
  let completeNative: ((value: string) => void) | undefined;
  const nativeExecution = new Promise<string>((resolve) => { completeNative = resolve; });
  try {
    const started = Date.now();
    const result = await readPiOwnerResult(reference, { ...options(() => new Promise((_resolve, reject) => { rejectRead = reject; })), timeoutMs: 5 });
    strictEqual(result.reasonCode, "owner_reader_timeout");
    strictEqual(result.outcome, "unknown");
    strictEqual(Date.now() - started < 1000, true);
    const before = JSON.stringify(result);
    rejectRead!(new Error("private-late-reader-rejection"));
    completeNative!("native-completed-after-timeout");
    strictEqual(await nativeExecution, "native-completed-after-timeout");
    await nextTurn();
    deepStrictEqual(unhandled, []);
    strictEqual(JSON.stringify(result), before);
    strictEqual(JSON.stringify(result).includes("private-late-reader-rejection"), false);
  } finally {
    process.off("unhandledRejection", onUnhandled);
  }
});

test("late successful observer data does not rewrite an already returned unknown or replay work", async () => {
  let resolveRead: ((value: unknown) => void) | undefined;
  let reads = 0;
  const result = await readPiOwnerResult(reference, { ...options(() => {
    reads += 1;
    return new Promise((resolve) => { resolveRead = resolve; });
  }), timeoutMs: 5 });
  strictEqual(result.reasonCode, "owner_reader_timeout");
  resolveRead!(report());
  await nextTurn();
  strictEqual(result.reasonCode, "owner_reader_timeout");
  strictEqual(reads, 1);
});

test("reader reference/options/result accessors and proxies never execute, including synchronous then getters", async () => {
  let reads = 0;
  const getter = { get readOwner() { reads += 1; return () => report(); } };
  const hostileReference = { ...reference, get binding() { reads += 1; return binding; } };
  const proxy = new Proxy({ ...reference }, { getPrototypeOf() { reads += 1; return Object.prototype; } });
  const hostileReadback = { ...report(), get then() { reads += 1; return () => undefined; } };
  const hostileEvidence = { ...report(), get evidence() { reads += 1; return []; } };
  for (const input of [hostileReference, proxy]) strictEqual((await readPiOwnerResult(input, options(() => report()))).outcome, "unknown");
  strictEqual((await readPiOwnerResult(reference, getter as PiOwnerResultReaderOptions)).reasonCode, "reader_options_invalid");
  for (const input of [hostileReadback, hostileEvidence, new Proxy(report(), { ownKeys() { reads += 1; return []; } })]) {
    strictEqual((await readPiOwnerResult(reference, options(() => input))).outcome, "unknown");
  }
  strictEqual(reads, 0);
});

test("reader snapshots the selected binding before invoking the host and evaluates freshness after reading", async () => {
  const mutable = { binding: { ...binding, workRef: { ...binding.workRef } }, resultRef: "receipt-result-1" };
  const result = await readPiOwnerResult(mutable, options(() => {
    mutable.binding.runId = "mutated-run";
    mutable.binding.workRef.key = "mutated-key";
    return report();
  }));
  deepStrictEqual(result.binding, binding);
  const expired = await readPiOwnerResult(reference, { readOwner: async () => ({
    ...report(), observedAt: new Date(Date.now() - 2000).toISOString(), freshUntil: new Date(Date.now() - 1000).toISOString(),
  }) });
  strictEqual(expired.reasonCode, "owner_readback_not_current");
});
