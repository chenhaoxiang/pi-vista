import { deepStrictEqual, rejects, strictEqual, throws } from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  CheckpointStore, createEmitter, currentRunId, emitVistaEvent, EventStore,
  generateStepId, getOrCreateRunId, hasKnownCredential, isSafeSegment,
  isVistaComponent, isVistaEvent, redactAll, VistaProtocolError,
  type VistaCheckpoint, type VistaEvent,
} from "./index.js";

const signatures = [
  ...["p", "o", "u", "s", "r"].map((kind) => `gh${kind}_12345678`),
  "github_pat_12345678", `github_pat_${"A".repeat(82)}`, "sk-12345678",
  ...["b", "a", "p", "r", "s"].map((kind) => `xox${kind}-12345678`),
  `eyJ${"a".repeat(10)}.${"b".repeat(10)}.${"c".repeat(10)}`,
];
const variants = signatures.flatMap((value) => [
  value, `run_${value}_s0`, `run-${value}-step`, `prefix${value}suffix`,
  `PREFIX${value.toUpperCase()}SUFFIX`,
  `run_${Array.from(value, (character, index) => index % 2 ? character.toUpperCase() : character.toLowerCase()).join("")}`,
]);

function event(): VistaEvent {
  return { run_id: "run-safe", step_id: "run-safe_s0", ts: 123, component: "test", action: "test:metadata", result: "ok" };
}
function checkpoint(): VistaCheckpoint {
  return {
    run_id: "run-safe", step_id: "run-safe_s0", ts: 123, task_goal: "safe summary",
    current_state: "safe state", completed_steps: [], pending_steps: [], source_sha: "a".repeat(40),
    env_fingerprint: "env-hash", policy_version: "policy-1", check_fn_ids: [], resumable: false,
  };
}
async function sandbox(): Promise<string> {
  const root = fileURLToPath(new URL("../../../tmp/", import.meta.url));
  await mkdir(root, { recursive: true });
  return mkdtemp(join(root, "core-credential-"));
}
function protocolError(error: unknown): boolean {
  return error instanceof VistaProtocolError && !hasKnownCredential(error.message);
}

test("hasKnownCredential detects 84 embedded/case variants repeatedly without matcher state", t => {
  strictEqual(variants.length, 84);
  for (let repeat = 0; repeat < 100; repeat++) {
    for (const value of variants) strictEqual(hasKnownCredential(value), true);
    strictEqual(hasKnownCredential("run-safe"), false);
  }
  t.diagnostic("known signatures=14; variants=84; repeated positive matches=8400; no global/sticky matcher");
});

test("hasKnownCredential never coerces values or invokes object/getter/proxy traps", () => {
  let calls = 0;
  const hostile = new Proxy({}, {
    get() { calls++; throw new Error("must not inspect"); },
    ownKeys() { calls++; throw new Error("must not inspect"); },
    getOwnPropertyDescriptor() { calls++; throw new Error("must not inspect"); },
    getPrototypeOf() { calls++; throw new Error("must not inspect"); },
  });
  const coercible = { [Symbol.toPrimitive]() { calls++; return signatures[0]; } };
  const accessor = Object.defineProperty({}, "value", { get() { calls++; return signatures[0]; } });
  const revoked = Proxy.revocable({}, {});
  revoked.revoke();
  for (const value of [undefined, null, 123, true, 1n, Symbol("synthetic"), {}, [], coercible, accessor, hostile, revoked.proxy, new String(signatures[0])]) {
    strictEqual(hasKnownCredential(value), false);
  }
  strictEqual(calls, 0);
});

test("credential detection is independent of lexical segments and preserves safe labels/namespaces/hashes", () => {
  const safe = ["run-job-58", "session_task_1", "foo..bar", "policy-v1", "receipt-opaque", "a".repeat(40), "b".repeat(64), "provider/model-v9", "feature/metadata-safety", "custom:adapter/git/v2", "custom:适配器.β/检查", "future/1"];
  for (const value of safe) strictEqual(hasKnownCredential(value), false);
  strictEqual(isSafeSegment(variants[1]), true);
  strictEqual(hasKnownCredential("ghp_short"), false);
  strictEqual(hasKnownCredential("github_pat_short"), false);
  const input = {
    ...event(), component: "custom:adapter/git/v2", branch: "feature/metadata-safety",
    model_id: "provider/model-v9", vista_version: "future/1", source_sha: "a".repeat(40),
    artifact_refs: [{ type: "test_result", ref: "receipt-opaque", sha: "b".repeat(64), stats: { total: 192, suite: "unit", locale: "检查" } }],
  };
  deepStrictEqual(redactAll(input), input);
});

test("redactAll removes known signatures from every retained field, key, stat, ref and URL origin", () => {
  const retained = ["run_id", "step_id", "session_id", "trace_id", "check_id", "failure_id", "experience_id", "hindsight_doc_id", "superseded_by", "source_sha", "verified_sha", "worktree_id", "env_fingerprint", "repair_action_id", "sha", "action", "repo", "branch", "target_class", "policy_version", "layer", "reason_code", "model_id", "tool", "type", "status", "stage", "failure_type", "fix_outcome", "check_type", "task_type"];
  for (const value of variants) {
    const fields = Object.fromEntries(retained.map(key => [key, value]));
    const input = {
      ...fields, [value]: "unknown", nested: { [value]: "unknown" },
      completed_steps: [value], pending_steps: [value], check_fn_ids: [value], resume_requires: [value], depends_on: [value],
      component: `custom:adapter/${value}`, vista_version: `future/${value}`,
      url: `https://${value}.example.test/result`,
      artifact_refs: [
        { type: value, ref: value, sha: value, stats: { [value]: 1, label: value } },
        { type: "receipt", ref: `https://${value}.example.test/result?label=${value}#${value}` },
      ],
    };
    const redacted = redactAll(input);
    strictEqual(hasKnownCredential(JSON.stringify(redacted)), false);
    strictEqual(Object.hasOwn(redacted, value), false);
    strictEqual(isVistaComponent(input.component), false);
    strictEqual(isVistaEvent({ ...event(), vista_version: input.vista_version }), false);
  }
});

test("core source identities, emitter defaults/options and checkpoint arrays reject before any append/save bytes", async () => {
  const base = await sandbox();
  try {
    const actual = new EventStore(base);
    const checkpoints = new CheckpointStore(base);
    let appends = 0;
    const store = { async append(value: VistaEvent) { appends++; await actual.append(value); } };
    for (const value of variants) {
      await rejects(actual.append({ ...event(), run_id: value, step_id: `${value}_s0` }), protocolError);
      await rejects(actual.append({ ...event(), step_id: `run-safe_${value}` }), protocolError);
      await rejects(checkpoints.save({ ...checkpoint(), run_id: value, step_id: `${value}_s0` }), protocolError);
      await rejects(checkpoints.save({ ...checkpoint(), step_id: `run-safe_${value}` }), protocolError);
      for (const key of ["completed_steps", "pending_steps", "check_fn_ids", "resume_requires"]) {
        await rejects(checkpoints.save({ ...checkpoint(), [key]: [key.endsWith("steps") ? `run-safe_${value}` : value] }), protocolError);
      }
      await rejects(emitVistaEvent({ component: "test", action: "test:metadata", result: "ok" }, { store, runId: "run-safe", stepId: `run-safe_${value}` }), protocolError);
      await rejects(emitVistaEvent({ component: "test", action: "test:metadata", result: "ok" }, { store, runId: value }), protocolError);
      await rejects(createEmitter({ ...event(), run_id: value, step_id: `${value}_s0` }, { store })({}), protocolError);
      throws(() => generateStepId(value, 0), error => error instanceof TypeError && !hasKnownCredential(error.message));
    }
    strictEqual(appends, 0);
    deepStrictEqual(await readdir(base), []);
  } finally { await rm(base, { recursive: true, force: true }); }
});

test("core optional metadata is redacted on emit/append/checkpoint rather than retained", async () => {
  const base = await sandbox();
  try {
    const store = new EventStore(base);
    const checkpoints = new CheckpointStore(base);
    const value = variants[3]!;
    const optional = { session_id: value, trace_id: value, action: value, repo: value, branch: `feature/${value}`, model_id: `provider/${value}`, source_sha: value, artifact_refs: [{ type: value, ref: value, sha: value, stats: { [value]: 1, label: value } }] };
    await emitVistaEvent({ ...event(), ...optional }, { store });
    await store.append({ ...event(), ...optional });
    await checkpoints.save({ ...checkpoint(), source_sha: value, env_fingerprint: value, policy_version: value, task_goal: value, current_state: value });
    strictEqual(hasKnownCredential(await readFile(join(base, "runs/run-safe/events.jsonl"), "utf8")), false);
    strictEqual(hasKnownCredential(await readFile(join(base, "runs/run-safe/checkpoints/run-safe_s0.json"), "utf8")), false);
  } finally { await rm(base, { recursive: true, force: true }); }
});

test("read-side redaction and listRuns hide legacy known-signature identities without modifying history", async () => {
  const base = await sandbox();
  try {
    const store = new EventStore(base);
    const checkpoints = new CheckpointStore(base);
    const value = variants[3]!;
    await mkdir(join(base, "runs/run-safe/checkpoints"), { recursive: true });
    const legacyEvents = [event(), { ...event(), action: value, session_id: value, [value]: "unknown", artifact_refs: [{ type: "receipt", ref: `https://${value}.example.test/result`, stats: { label: value, [value]: 1 } }] }, { ...event(), step_id: `run-safe_${value}` }];
    const eventBytes = legacyEvents.map(item => JSON.stringify(item)).join("\n") + "\n";
    const checkpointBytes = JSON.stringify({ ...checkpoint(), source_sha: value, [value]: "unknown" });
    await writeFile(join(base, "runs/run-safe/events.jsonl"), eventBytes);
    await writeFile(join(base, "runs/run-safe/checkpoints/run-safe_s0.json"), checkpointBytes);
    for (const [index, signature] of variants.entries()) {
      // Distinct numeric namespaces avoid case-folding collisions on macOS.
      const runId = `legacy-${index}-${signature}`;
      await mkdir(join(base, "runs", runId, "checkpoints"), { recursive: true });
      await writeFile(join(base, "runs", runId, "events.jsonl"), JSON.stringify({ ...event(), run_id: runId, step_id: `${runId}_s0` }));
      await writeFile(join(base, "runs", runId, "checkpoints", `${runId}_s0.json`), JSON.stringify({ ...checkpoint(), run_id: runId, step_id: `${runId}_s0` }));
      deepStrictEqual(await store.readRun(runId), []);
      strictEqual(await checkpoints.load(runId, `${runId}_s0`), null);
      deepStrictEqual(await checkpoints.listCheckpoints(runId), []);
    }
    deepStrictEqual(await store.listRuns(), ["run-safe"]);
    const read = await store.readRun("run-safe");
    strictEqual(read.length, 2);
    strictEqual(hasKnownCredential(JSON.stringify(read)), false);
    strictEqual(hasKnownCredential(JSON.stringify(await checkpoints.load("run-safe", "run-safe_s0"))), false);
    deepStrictEqual(await checkpoints.listCheckpoints("run-safe"), ["run-safe_s0"]);
    strictEqual(await readFile(join(base, "runs/run-safe/events.jsonl"), "utf8"), eventBytes);
    strictEqual(await readFile(join(base, "runs/run-safe/checkpoints/run-safe_s0.json"), "utf8"), checkpointBytes);
    strictEqual((await readdir(join(base, "runs"))).length, variants.length + 1);
  } finally { await rm(base, { recursive: true, force: true }); }
});

test("unsafe own run environment generates a safe fallback; explicit safe IDs preserve precedence/sequence", async () => {
  const previous = Object.getOwnPropertyDescriptor(process.env, "VISTA_RUN_ID");
  try {
    for (const value of variants) {
      process.env.VISTA_RUN_ID = value;
      strictEqual(currentRunId(), undefined);
      const generated = getOrCreateRunId();
      strictEqual(isSafeSegment(generated), true);
      strictEqual(hasKnownCredential(generated), false);
      strictEqual(currentRunId(), generated);
    }
    process.env.VISTA_RUN_ID = variants[3]!;
    const recorded: VistaEvent[] = [];
    const store = { async append(value: VistaEvent) { recorded.push(value); } };
    const explicit = await emitVistaEvent({ component: "test", action: "test:precedence", result: "ok" }, { store, runId: "run-explicit-security", now: 123 });
    strictEqual(explicit?.step_id, "run-explicit-security_s0");
    strictEqual(process.env.VISTA_RUN_ID === variants[3], true);
    const fallback = await emitVistaEvent({ component: "test", action: "test:fallback", result: "ok" }, { store, now: 123 });
    strictEqual(hasKnownCredential(JSON.stringify(fallback)), false);
    strictEqual(recorded.length, 2);
    process.env.VISTA_RUN_ID = "run-safe-env-security";
    const first = await emitVistaEvent({ component: "test", action: "test:sequence", result: "ok" }, { store });
    const second = await emitVistaEvent({ component: "test", action: "test:sequence", result: "ok" }, { store });
    strictEqual(first?.step_id, "run-safe-env-security_s0");
    strictEqual(second?.step_id, "run-safe-env-security_s1");
  } finally {
    if (previous === undefined) delete process.env.VISTA_RUN_ID;
    else Object.defineProperty(process.env, "VISTA_RUN_ID", previous);
  }
});

test("core own environment accessors and proxies never supply IDs or execute traps", () => {
  const previous = Object.getOwnPropertyDescriptor(process, "env")!;
  let calls = 0;
  try {
    const accessor = Object.defineProperty({}, "VISTA_RUN_ID", { get() { calls++; return variants[3]; }, configurable: true });
    Object.defineProperty(process, "env", { ...previous, value: accessor });
    strictEqual(currentRunId(), undefined);
    strictEqual(hasKnownCredential(getOrCreateRunId()), false);
    const hostile = new Proxy({}, {
      get() { calls++; throw new Error("must not read"); },
      getOwnPropertyDescriptor() { calls++; throw new Error("must not inspect"); },
      defineProperty() { calls++; throw new Error("must not write"); },
    });
    Object.defineProperty(process, "env", { ...previous, value: hostile });
    strictEqual(currentRunId(), undefined);
    strictEqual(hasKnownCredential(getOrCreateRunId()), false);
    strictEqual(calls, 0);
  } finally { Object.defineProperty(process, "env", previous); }
});
