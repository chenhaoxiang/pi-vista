import { deepStrictEqual, rejects, strictEqual, throws } from "node:assert/strict";
import { test } from "node:test";
import { hasKnownCredential, isSafeSegment, type VistaCheckpoint, type VistaEvent } from "@pi-vista/core";
import { createPiRunContext, VistaProtocolError, type PiCheckpointInput, type PiRunContextOptions } from "./index.js";

const signatures = ["ghp_12345678", "github_pat_12345678", `github_pat_${"A".repeat(82)}`, "sk-12345678", "xoxb-12345678", `eyJ${"a".repeat(10)}.${"b".repeat(10)}.${"c".repeat(10)}`];
const variants = signatures.flatMap(value => [value, `run_${value}_s0`, `run-${value}-step`, `prefix${value}suffix`, `PREFIX${value.toUpperCase()}SUFFIX`, `run_${Array.from(value, (character, index) => index % 2 ? character.toUpperCase() : character.toLowerCase()).join("")}`]);
const runId = "run-pi-credential";
function checkpoint(): PiCheckpointInput {
  return { task_goal: "safe summary", current_state: "safe state", source_sha: "a".repeat(40), env_fingerprint: "env-hash", policy_version: "policy-1", resumable: false };
}
function protocolError(error: unknown): boolean {
  return error instanceof VistaProtocolError && !hasKnownCredential(error.message);
}

function observers() {
  const calls = { emit: 0, append: 0, save: 0 };
  const options: PiRunContextOptions = {
    runId, now: 123,
    store: { async append() { calls.append++; } },
    emit: async (partial, options) => { calls.emit++; await options?.store?.append(partial as VistaEvent); return partial as VistaEvent; },
    checkpointStore: { async save() { calls.save++; } },
  };
  return { calls, options };
}

test("Pi explicit identity aliases reject known signatures before every custom observer", t => {
  const { calls, options } = observers();
  for (const key of ["runId", "run_id", "sessionId", "session_id"]) {
    for (const value of variants) {
      const { runId: _run, ...rest } = options;
      throws(() => createPiRunContext({ ...rest, [key]: value }), protocolError);
    }
  }
  deepStrictEqual(calls, { emit: 0, append: 0, save: 0 });
  t.diagnostic("Pi identity aliases=4; known variants=36; rejection cases=144; custom emit/append/save=0");
});

test("Pi tool, artifact and stats retained aliases cannot bypass credential validation via custom emit", async t => {
  const { calls, options } = observers();
  const context = createPiRunContext(options);
  const fields = ["tool", "tool_name", "name", "action", "action_name", "targetClass", "target_class", "reasonCode", "reason_code"];
  let cases = 0;
  for (const value of variants) {
    for (const key of fields) {
      const input = ["tool", "tool_name", "name"].includes(key) ? { [key]: value } : { tool: "read", [key]: value };
      await rejects(context.emitToolCall(input), protocolError);
      await rejects(context.emitToolResult({ ...input, result: "ok" }), protocolError);
      cases += 2;
    }
    for (const alias of ["artifactRefs", "artifact_refs"]) {
      for (const artifact of [
        { type: value, ref: "receipt-safe" }, { type: "receipt", ref: value },
        { type: "receipt", ref: "receipt-safe", sha: value },
        { type: "receipt", ref: "receipt-safe", stats: { [value]: 1 } },
        { type: "receipt", ref: "receipt-safe", stats: { label: value } },
      ]) {
        await rejects(context.emitToolCall({ tool: "read", [alias]: [artifact] }), protocolError);
        await rejects(context.emitToolResult({ tool: "read", result: "ok", [alias]: [artifact] }), protocolError);
        cases += 2;
      }
    }
  }
  deepStrictEqual(calls, { emit: 0, append: 0, save: 0 });
  strictEqual(context.stepId, undefined);
  await context.end();
  t.diagnostic(`Pi tool/artifact/stats rejection cases=${cases}; custom emit/append/save=0`);
});

test("Pi checkpoint source identities, summaries and array aliases reject before custom save", async t => {
  const { calls, options } = observers();
  const context = createPiRunContext(options);
  const stepId = context.nextStep();
  let cases = 0;
  const scalarPairs = [
    ["runId", "run_id"], ["stepId", "step_id"], ["taskGoal", "task_goal"],
    ["currentState", "current_state"], ["sourceSha", "source_sha"],
    ["envFingerprint", "env_fingerprint"], ["policyVersion", "policy_version"],
  ];
  for (const value of variants) {
    for (const pair of scalarPairs) {
      for (const key of pair) {
        const input = { ...checkpoint() } as Record<string, unknown>;
        for (const alias of pair) delete input[alias];
        input[key] = value;
        await rejects(context.checkpoint(input), protocolError);
        cases++;
      }
    }
    for (const key of ["completedSteps", "completed_steps", "pendingSteps", "pending_steps", "checkFnIds", "check_fn_ids", "resumeRequires", "resume_requires"]) {
      const identifier = /[Ss]teps/u.test(key) ? `${runId}_${value}` : value;
      await rejects(context.checkpoint({ ...checkpoint(), [key]: [identifier] }), protocolError);
      cases++;
    }
  }
  strictEqual(context.stepId, stepId);
  await context.end();
  deepStrictEqual(calls, { emit: 0, append: 0, save: 0 });
  t.diagnostic(`Pi checkpoint rejection cases=${cases}; custom emit/append/save=0`);
});

test("Pi current run/session/step identity is checked again before custom callbacks", async () => {
  for (const field of ["runId", "sessionId", "currentStep"]) {
    const { calls, options } = observers();
    const context = createPiRunContext(options);
    context.nextStep();
    const value = variants[3]!;
    Object.defineProperty(context, field, { value: field === "currentStep" ? { runId, stepId: `${runId}_${value}`, seq: 0 } : value });
    await rejects(context.emitToolCall({ tool: "read" }), protocolError);
    await rejects(context.emitToolResult({ tool: "read", result: "ok" }), protocolError);
    await rejects(context.checkpoint(checkpoint()), protocolError);
    deepStrictEqual(calls, { emit: 0, append: 0, save: 0 });
  }
});

test("Pi credential errors do not expose stats names, execute identity getters, coerce objects or use Proxy get", async () => {
  const { calls, options } = observers();
  let getterCalls = 0;
  const accessor = Object.defineProperty({ ...options }, "runId", { get() { getterCalls++; return variants[3]; } });
  throws(() => createPiRunContext(accessor), protocolError);
  const proxy = new Proxy({ ...options }, { get() { getterCalls++; throw new Error("must not read"); } });
  const context = createPiRunContext(proxy);
  const hostileValue = new Proxy({}, { get() { getterCalls++; throw new Error("must not coerce"); } });
  await rejects(context.emitToolCall({ tool: hostileValue } as never), protocolError);
  const stats = Object.defineProperty({}, variants[3]!, { get() { getterCalls++; return 1; }, enumerable: true });
  await rejects(context.emitToolCall({ tool: "read", artifact_refs: [{ type: "receipt", ref: "receipt-safe", stats }] }), protocolError);
  strictEqual(getterCalls, 0);
  deepStrictEqual(calls, { emit: 0, append: 0, save: 0 });
});

test("Pi own credential environments generate/omit safely and preserve explicit/safe precedence and normal steps", async () => {
  const previousRun = Object.getOwnPropertyDescriptor(process.env, "VISTA_RUN_ID");
  const previousSession = Object.getOwnPropertyDescriptor(process.env, "PI_SESSION_ID");
  try {
    const emitted: VistaEvent[] = [];
    const saved: VistaCheckpoint[] = [];
    for (const value of variants) {
      process.env.VISTA_RUN_ID = value;
      process.env.PI_SESSION_ID = value;
      const context = createPiRunContext({ emit: async partial => { emitted.push(partial as VistaEvent); return partial as VistaEvent; }, checkpointStore: { async save(value) { saved.push(value); } } });
      strictEqual(isSafeSegment(context.runId), true);
      strictEqual(hasKnownCredential(context.runId), false);
      strictEqual(context.sessionId, undefined);
      strictEqual(context.runId, process.env.VISTA_RUN_ID);
      await context.emitToolCall({ tool: "read" });
      await context.checkpoint(checkpoint());
    }
    strictEqual(hasKnownCredential(JSON.stringify({ emitted, saved })), false);
    process.env.VISTA_RUN_ID = variants[3]!;
    process.env.PI_SESSION_ID = variants[3]!;
    const explicit = createPiRunContext({ run_id: "run-explicit-pi", session_id: "session-explicit-pi" });
    strictEqual(explicit.runId, "run-explicit-pi");
    strictEqual(explicit.sessionId, "session-explicit-pi");
    strictEqual(process.env.VISTA_RUN_ID === variants[3], true);
    process.env.VISTA_RUN_ID = "run-env-pi-security";
    process.env.PI_SESSION_ID = "session-env-pi-security";
    const safe = createPiRunContext();
    strictEqual(safe.runId, "run-env-pi-security");
    strictEqual(safe.sessionId, "session-env-pi-security");
    strictEqual(safe.nextStep(), "run-env-pi-security_s0");
    strictEqual(safe.nextStep(), "run-env-pi-security_s1");
  } finally {
    if (previousRun === undefined) delete process.env.VISTA_RUN_ID;
    else Object.defineProperty(process.env, "VISTA_RUN_ID", previousRun);
    if (previousSession === undefined) delete process.env.PI_SESSION_ID;
    else Object.defineProperty(process.env, "PI_SESSION_ID", previousSession);
  }
});

test("Pi safe IDs, opaque hashes, stats and custom observer receiver contracts remain compatible", async () => {
  const emitted: VistaEvent[] = [];
  const saved: VistaCheckpoint[] = [];
  const context = createPiRunContext({
    runId, sessionId: "session-task-58", now: 123,
    emit: async partial => { emitted.push(partial as VistaEvent); return partial as VistaEvent; },
    checkpointStore: { async save(value) { saved.push(value); } },
  });
  const artifact = { type: "test_result", ref: "receipt-opaque", sha: "b".repeat(64), stats: { passed: 192, suite: "unit", task: "job-58", status: "[REDACTED]" } };
  await context.emitToolResult({ tool_name: "read", result: "ok", artifactRefs: [artifact], targetClass: "tracked_file", reasonCode: "requested" });
  await context.checkpoint({ ...checkpoint(), checkFnIds: ["foo..bar"], pendingSteps: [`${runId}_foo..bar`], resumeRequires: ["custom.condition-1"] });
  deepStrictEqual(emitted[0]?.artifact_refs, [artifact]);
  strictEqual(emitted[0]?.session_id, "session-task-58");
  strictEqual(emitted[0]?.step_id, `${runId}_s0`);
  strictEqual(saved[0]?.source_sha, "a".repeat(40));
  deepStrictEqual(saved[0]?.check_fn_ids, ["foo..bar"]);
  deepStrictEqual(saved[0]?.pending_steps, [`${runId}_foo..bar`]);
});

test("Pi own environment accessors and proxies are ignored without getters or traps", () => {
  const previous = Object.getOwnPropertyDescriptor(process, "env")!;
  let calls = 0;
  try {
    const environment = {};
    for (const key of ["VISTA_RUN_ID", "PI_SESSION_ID"]) {
      Object.defineProperty(environment, key, { get() { calls++; return variants[3]; }, configurable: true });
    }
    Object.defineProperty(process, "env", { ...previous, value: environment });
    const accessorContext = createPiRunContext({ checkpointStore: { async save() {} } });
    strictEqual(hasKnownCredential(accessorContext.runId), false);
    strictEqual(accessorContext.sessionId, undefined);
    const hostile = new Proxy({}, {
      get() { calls++; throw new Error("must not read"); },
      getOwnPropertyDescriptor() { calls++; throw new Error("must not inspect"); },
      defineProperty() { calls++; throw new Error("must not write"); },
    });
    Object.defineProperty(process, "env", { ...previous, value: hostile });
    const proxyContext = createPiRunContext({ checkpointStore: { async save() {} } });
    strictEqual(hasKnownCredential(proxyContext.runId), false);
    strictEqual(proxyContext.sessionId, undefined);
    strictEqual(calls, 0);
  } finally { Object.defineProperty(process, "env", previous); }
});
