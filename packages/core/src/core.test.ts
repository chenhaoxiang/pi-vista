import { deepStrictEqual, doesNotThrow, match, strictEqual } from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
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

function temporaryDirectory(): string {
  return mkdtempSync(join(tmpdir(), "pi-vista-core-"));
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

test("event and checkpoint stores round-trip redacted records", () => {
  const baseDir = temporaryDirectory();
  try {
    const eventStore = new EventStore({ baseDir });
    const checkpointStore = new CheckpointStore({ baseDir });

    eventStore.append(sampleEvent());
    checkpointStore.save(sampleCheckpoint());

    deepStrictEqual(eventStore.readRun("run-round-trip"), [sampleEvent()]);
    deepStrictEqual(eventStore.listRuns(), ["run-round-trip"]);
    deepStrictEqual(checkpointStore.load("run-round-trip", "run-round-trip_s0"), sampleCheckpoint());
    deepStrictEqual(checkpointStore.listCheckpoints("run-round-trip"), [sampleCheckpoint()]);

    const jsonl = readFileSync(join(baseDir, "runs", "run-round-trip", "events.jsonl"), "utf8");
    match(jsonl, /"action":"test:round_trip"/u);
  } finally {
    rmSync(baseDir, { recursive: true, force: true });
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

test("emitVistaEvent is fail-open when the store fails", () => {
  const failingStore = {
    append(): void {
      throw new Error("store unavailable");
    },
  };

  let event: VistaEvent | undefined;
  doesNotThrow(() => {
    event = emitVistaEvent(
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
