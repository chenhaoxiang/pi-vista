import { deepStrictEqual, doesNotReject, match, strictEqual } from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { VistaCheckpoint, VistaEvent } from "@pi-vista/protocol";
import { emitVistaEvent } from "./emit.js";
import {
  isRedacted,
  redactAll,
  redactCommand,
  redactCredential,
  redactPath,
} from "./redact.js";
import { CheckpointStore, EventStore } from "./store.js";

async function temporaryDirectory(): Promise<string> {
  return mkdtemp(join(tmpdir(), "pi-vista-core-"));
}

function sampleEvent(): VistaEvent {
  return {
    run_id: "run-round-trip",
    step_id: "run-round-trip_s0",
    ts: 1_700_000_000_000,
    component: "test",
    action: "test:round_trip",
    result: "ok",
    reason_code: "completed",
  };
}

function sampleCheckpoint(): VistaCheckpoint {
  return {
    run_id: "run-round-trip",
    step_id: "run-round-trip_s0",
    ts: 1_700_000_000_000,
    task_goal: "verify the event store",
    completed_steps: ["run-round-trip_s0"],
    current_state: "store verified",
    pending_steps: [],
    source_sha: "0123456789abcdef0123456789abcdef01234567",
    env_fingerprint: "env-hash",
    policy_version: "policy-1",
    check_fn_ids: [],
    resumable: true,
  };
}

test("event and checkpoint stores round-trip redacted records", async () => {
  const baseDir = await temporaryDirectory();
  try {
    const eventStore = new EventStore({ baseDir });
    const checkpointStore = new CheckpointStore({ baseDir });

    await eventStore.append(sampleEvent());
    await checkpointStore.save(sampleCheckpoint());

    deepStrictEqual(await eventStore.readRun("run-round-trip"), [sampleEvent()]);
    deepStrictEqual(await eventStore.listRuns(), ["run-round-trip"]);
    deepStrictEqual(await checkpointStore.load("run-round-trip", "run-round-trip_s0"), sampleCheckpoint());
    deepStrictEqual(await checkpointStore.listCheckpoints("run-round-trip"), ["run-round-trip_s0"]);

    const jsonl = await readFile(join(baseDir, "runs", "run-round-trip", "events.jsonl"), "utf8");
    match(jsonl, /"action":"test:round_trip"/u);
  } finally {
    await rm(baseDir, { recursive: true, force: true });
  }
});

test("CheckpointStore.listCheckpoints returns step IDs in lexicographic order, not timestamp order", async () => {
  const baseDir = await temporaryDirectory();
  try {
    const checkpointStore = new CheckpointStore({ baseDir });

    await checkpointStore.save({ ...sampleCheckpoint(), step_id: "step-z", ts: 1_700_000_000_000 });
    await checkpointStore.save({ ...sampleCheckpoint(), step_id: "step-a", ts: 1_700_000_000_001 });

    deepStrictEqual(await checkpointStore.listCheckpoints("run-round-trip"), ["step-a", "step-z"]);
  } finally {
    await rm(baseDir, { recursive: true, force: true });
  }
});

test("CheckpointStore.load returns null for missing or corrupt records", async () => {
  const baseDir = await temporaryDirectory();
  try {
    const checkpointStore = new CheckpointStore({ baseDir });

    strictEqual(await checkpointStore.load("run-round-trip", "missing"), null);
    deepStrictEqual(await checkpointStore.listCheckpoints("run-round-trip"), []);

    await checkpointStore.save(sampleCheckpoint());
    strictEqual(await checkpointStore.load("run-round-trip", "missing"), null);
    const checkpointDir = join(baseDir, "runs", "run-round-trip", "checkpoints");
    await writeFile(join(checkpointDir, "corrupt.json"), "not-json", "utf8");
    await writeFile(join(checkpointDir, "invalid.json"), JSON.stringify({ run_id: "run-round-trip" }), "utf8");

    strictEqual(await checkpointStore.load("run-round-trip", "corrupt"), null);
    strictEqual(await checkpointStore.load("run-round-trip", "invalid"), null);
  } finally {
    await rm(baseDir, { recursive: true, force: true });
  }
});

test("EventStore.append and CheckpointStore.save reject unsafe path segments without filesystem writes", async () => {
  const sandbox = await temporaryDirectory();
  const baseDir = join(sandbox, "vista");
  try {
    await mkdir(baseDir);
    const eventStore = new EventStore({ baseDir });
    const checkpointStore = new CheckpointStore({ baseDir });
    const invalidSegments = [
      ".",
      "..",
      "",
      "../outside",
      "../../outside",
      "nested/run",
      "nested\\run",
      join(sandbox, "outside"),
      "invalid segment",
      "invalid:segment",
      "nul\u0000segment",
    ];

    for (const runId of invalidSegments) {
      await doesNotReject(() => eventStore.append({ ...sampleEvent(), run_id: runId }));
      await doesNotReject(() => checkpointStore.save({ ...sampleCheckpoint(), run_id: runId }));
      deepStrictEqual(await eventStore.readRun(runId), []);
      strictEqual(await checkpointStore.load(runId, sampleCheckpoint().step_id), null);
      deepStrictEqual(await checkpointStore.listCheckpoints(runId), []);
      deepStrictEqual(await readdir(baseDir), [], `unexpected write for runId ${JSON.stringify(runId)}`);
      deepStrictEqual(await readdir(sandbox), ["vista"], `write escaped baseDir for runId ${JSON.stringify(runId)}`);
    }
    for (const stepId of invalidSegments) {
      await doesNotReject(() => checkpointStore.save({ ...sampleCheckpoint(), step_id: stepId }));
      strictEqual(await checkpointStore.load(sampleCheckpoint().run_id, stepId), null);
      deepStrictEqual(await readdir(baseDir), [], `unexpected write for stepId ${JSON.stringify(stepId)}`);
      deepStrictEqual(await readdir(sandbox), ["vista"], `write escaped baseDir for stepId ${JSON.stringify(stepId)}`);
    }
  } finally {
    await rm(sandbox, { recursive: true, force: true });
  }
});

test("redaction removes paths, credentials, and commands", () => {
  strictEqual(redactPath("/Users/alice/project/secret.ts"), "[REDACTED_PATH]");
  strictEqual(redactCredential("super-secret-token"), "[REDACTED_CREDENTIAL]");
  strictEqual(redactCommand("cat /Users/alice/project/secret.ts"), "[REDACTED_COMMAND]");

  const value = redactAll({
    action: "cat /Users/alice/project/secret.ts",
    artifact_refs: [{ ref: "https://alice:password@example.test/result" }],
    nested: { token: "secret-token" },
  });
  const serialized = JSON.stringify(value);
  strictEqual(serialized.includes("/Users/alice"), false);
  strictEqual(serialized.includes("password@example"), false);
  strictEqual(serialized.includes("secret-token"), false);
  strictEqual(isRedacted(value), true);
});

test("emitVistaEvent is fail-open when the store fails", async () => {
  const failingStore = {
    async append(): Promise<void> {
      throw new Error("store unavailable");
    },
  };

  let event: VistaEvent | undefined;
  await doesNotReject(async () => {
    event = await emitVistaEvent(
      {
        component: "test",
        action: "test:fail_open",
        result: "ok",
      },
      { store: failingStore, runId: "run-fail-open", seq: 0, now: () => 123 },
    );
  });

  strictEqual(event?.run_id, "run-fail-open");
  strictEqual(event?.step_id, "run-fail-open_s0");
  strictEqual(event?.ts, 123);
  strictEqual(event?.vista_version, "0.1.0");
});
