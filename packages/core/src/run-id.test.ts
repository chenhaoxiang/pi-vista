import { deepStrictEqual, strictEqual } from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  CheckpointStore, currentRunId, EventStore, generateRunId, generateStepId,
  getOrCreateRunId, hasKnownCredential, isSafeSegment, isVistaCheckpoint, isVistaEvent,
  type VistaCheckpoint, type VistaEvent,
} from "./index.js";

const SUFFIXES = ["ghp", "gho", "ghu", "ghs", "ghr"] as const;
const PERIOD = 36 ** 3;
const TIMESTAMP_BASE = 1_700_000_000_000 - 1_700_000_000_000 % PERIOD;
const RUN_ID_PATTERN = /^vr_[0-9a-f]{14}_[0-9a-f]{8}$/u;

async function withClockAndEnvironment(
  timestamp: number,
  operation: (clockCalls: () => number) => void | Promise<void>,
): Promise<void> {
  const nowDescriptor = Object.getOwnPropertyDescriptor(Date, "now")!;
  const environment = ["VISTA_RUN_ID", "PI_SESSION_ID"].map(key => [key, Object.getOwnPropertyDescriptor(process.env, key)] as const);
  let calls = 0;
  try {
    Object.defineProperty(Date, "now", { ...nowDescriptor, value: () => { calls++; return timestamp; } });
    delete process.env.VISTA_RUN_ID;
    delete process.env.PI_SESSION_ID;
    await operation(() => calls);
  } finally {
    Object.defineProperty(Date, "now", nowDescriptor);
    for (const [key, descriptor] of environment) {
      if (descriptor === undefined) delete process.env[key];
      else Object.defineProperty(process.env, key, descriptor);
    }
  }
}

for (const suffix of SUFFIXES) {
  test(`generateRunId stays safe at the natural base36 ${suffix} clock boundary without retry`, async t => {
    const timestamp = TIMESTAMP_BASE + Number.parseInt(suffix, 36);
    strictEqual(timestamp.toString(36).slice(-3), suffix);
    await withClockAndEnvironment(timestamp, clockCalls => {
      const generated = Array.from({ length: 32 }, () => generateRunId());
      for (const runId of generated) {
        strictEqual(hasKnownCredential(runId), false);
        strictEqual(RUN_ID_PATTERN.test(runId), true);
        strictEqual(isSafeSegment(runId), true);
        strictEqual(isVistaEvent({ run_id: runId, step_id: generateStepId(runId, 0), ts: 123, component: "test", action: "test:generation", result: "ok" }), true);
      }
      strictEqual(new Set(generated).size > 1, true, "fixed clock must retain a random suffix");
      strictEqual(clockCalls(), 32, "one clock read per generation, no retry loop");
      for (const previous of [undefined, "run_ghp_12345678_s0"]) {
        if (previous === undefined) delete process.env.VISTA_RUN_ID;
        else process.env.VISTA_RUN_ID = previous;
        strictEqual(currentRunId(), undefined);
        const runId = getOrCreateRunId();
        strictEqual(RUN_ID_PATTERN.test(runId), true);
        strictEqual(hasKnownCredential(runId), false);
        strictEqual(currentRunId() === runId, true);
        strictEqual(process.env.VISTA_RUN_ID === runId, true);
        strictEqual(getOrCreateRunId() === runId, true);
      }
      strictEqual(clockCalls(), 34, "only absent/unsafe environments generate, safe IDs are reused");
    });
    t.diagnostic(JSON.stringify({ suffix, natural_bad_clock_reproduced: true, fixed_clock_generations: 32, safe_fallback_modes: 2, retry: false }));
  });
}

test("generateRunId preserves opaque shape and lexical timestamp order across hexadecimal width boundaries", async () => {
  const timestamps = [0, 1, 15, 16, 255, 256, 4095, 4096, 0xfffffff, 0x10000000, 0xffffffff, 0x100000000, 1_700_000_000_000, 8_640_000_000_000_000, Number.MAX_SAFE_INTEGER];
  const generated: string[] = [];
  for (const timestamp of timestamps) {
    await withClockAndEnvironment(timestamp, () => {
      const runId = generateRunId();
      strictEqual(RUN_ID_PATTERN.test(runId), true);
      strictEqual(/^vr_[a-z0-9]+_[0-9a-f]{8}$/u.test(runId), true);
      strictEqual(hasKnownCredential(runId), false);
      const previous = generated.at(-1);
      if (previous !== undefined) strictEqual(previous < runId, true);
      generated.push(runId);
      strictEqual(generateStepId(runId, 36), `${runId}_s10`);
    });
  }
  strictEqual(generated.length, timestamps.length);
});

test("safe legacy base36 run IDs remain opaque reusable/readable identities without file migration", async () => {
  const root = fileURLToPath(new URL("../../../tmp/", import.meta.url));
  await mkdir(root, { recursive: true });
  const base = await mkdtemp(join(root, "run-id-generation-legacy-"));
  try {
    await withClockAndEnvironment(TIMESTAMP_BASE + Number.parseInt("ghp", 36), async clockCalls => {
      const runId = "vr_loyw3v28_1234abcd";
      process.env.VISTA_RUN_ID = runId;
      strictEqual(hasKnownCredential(runId), false);
      strictEqual(currentRunId(), runId);
      strictEqual(getOrCreateRunId(), runId);
      strictEqual(clockCalls(), 0);
      const stepId = generateStepId(runId, 0);
      const event: VistaEvent = { run_id: runId, step_id: stepId, ts: 123, component: "test", action: "test:legacy", result: "ok" };
      const checkpoint: VistaCheckpoint = { run_id: runId, step_id: stepId, ts: 123, task_goal: "synthetic summary", current_state: "synthetic state", completed_steps: [stepId], pending_steps: [], source_sha: "a".repeat(40), env_fingerprint: "env-safe", policy_version: "policy-1", check_fn_ids: [], resumable: false };
      const store = new EventStore(base);
      const checkpoints = new CheckpointStore(base);
      await store.append(event);
      await checkpoints.save(checkpoint);
      const eventPath = join(base, "runs", runId, "events.jsonl");
      const checkpointPath = join(base, "runs", runId, "checkpoints", `${stepId}.json`);
      const before = [await readFile(eventPath, "utf8"), await readFile(checkpointPath, "utf8")];
      deepStrictEqual(await store.listRuns(), [runId]);
      deepStrictEqual(await store.readRun(runId), [event]);
      const loaded = await checkpoints.load(runId, stepId);
      strictEqual(isVistaCheckpoint(loaded), true);
      strictEqual(loaded?.run_id, runId);
      deepStrictEqual(await checkpoints.listCheckpoints(runId), [stepId]);
      deepStrictEqual([await readFile(eventPath, "utf8"), await readFile(checkpointPath, "utf8")], before);
    });
  } finally { await rm(base, { recursive: true, force: true }); }
});
