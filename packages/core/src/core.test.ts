import { deepStrictEqual, doesNotReject, match, rejects, strictEqual } from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { VistaCheckpoint, VistaEvent } from "@pi-vista/protocol";
import { emitVistaEvent, type VistaEventInput } from "./emit.js";
import {
  isRedacted,
  redactAll,
  redactCommand,
  redactCredential,
  redactPath,
} from "./redact.js";
import { CheckpointStore, EventStore } from "./store.js";
import { generateRunId, generateStepId, isSafeSegment } from "./run-id.js";
import { VistaProtocolError } from "./validation.js";

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
    deepStrictEqual(await checkpointStore.load("run-round-trip", "run-round-trip_s0"), {
      ...sampleCheckpoint(),
      task_goal: "[REDACTED]",
      current_state: "[REDACTED]",
    });
    deepStrictEqual(await checkpointStore.listCheckpoints("run-round-trip"), ["run-round-trip_s0"]);

    const jsonl = await readFile(join(baseDir, "runs", "run-round-trip", "events.jsonl"), "utf8");
    match(jsonl, /"action":"test:round_trip"/u);
    deepStrictEqual(await readdir(join(baseDir, "runs", "run-round-trip", "checkpoints")), ["run-round-trip_s0.json"]);
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

test("EventStore.append and CheckpointStore.save reject unsafe protocol IDs without filesystem writes", async () => {
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
      await rejects(() => eventStore.append({ ...sampleEvent(), run_id: runId }), VistaProtocolError);
      await rejects(() => checkpointStore.save({ ...sampleCheckpoint(), run_id: runId }), VistaProtocolError);
      deepStrictEqual(await eventStore.readRun(runId), []);
      strictEqual(await checkpointStore.load(runId, sampleCheckpoint().step_id), null);
      deepStrictEqual(await checkpointStore.listCheckpoints(runId), []);
      deepStrictEqual(await readdir(baseDir), [], `unexpected write for runId ${JSON.stringify(runId)}`);
      deepStrictEqual(await readdir(sandbox), ["vista"], `write escaped baseDir for runId ${JSON.stringify(runId)}`);
    }
    for (const stepId of invalidSegments) {
      await rejects(() => checkpointStore.save({ ...sampleCheckpoint(), step_id: stepId }), VistaProtocolError);
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

test("redactAll covers model-data key variants, env assignments, URL secrets, and unknown long text", () => {
  const value = redactAll({
    prompt_text: "raw prompt text must not be retained",
    MODEL_PROMPT: "another prompt",
    response_body: "raw model response",
    task_goal: "raw task goal",
    current_state: "raw state",
    stderr_output: "raw stderr",
    aws_assignment: "AWS_SECRET_ACCESS_KEY=aws-secret",
    private_assignment: "PRIVATE_KEY=private-secret",
    token_assignment: "ACCESS_TOKEN=access-secret",
    api_assignment: "API_KEY=api-secret",
    url: "https://alice:password@example.test/result?file=/Users/alice/secret.txt&token=url-secret#file=/Users/alice/fragment.txt",
    unknown_payload: "unclassified sensitive text ".repeat(8),
  });
  const serialized = JSON.stringify(value);
  strictEqual(serialized.includes("raw prompt text"), false);
  strictEqual(serialized.includes("raw model response"), false);
  strictEqual(serialized.includes("aws-secret"), false);
  strictEqual(serialized.includes("private-secret"), false);
  strictEqual(serialized.includes("access-secret"), false);
  strictEqual(serialized.includes("api-secret"), false);
  strictEqual(serialized.includes("password@example"), false);
  strictEqual(serialized.includes("url-secret"), false);
  strictEqual(serialized.includes("/Users/alice"), false);
  strictEqual(serialized.includes("unknown_payload"), true);
  strictEqual((value as { url: string }).url.includes("[REDACTED_PATH]"), true);
});

test("EventStore.readRun and CheckpointStore.load reject invalid or cross-identity records", async () => {
  const baseDir = await temporaryDirectory();
  try {
    const eventStore = new EventStore({ baseDir });
    const checkpointStore = new CheckpointStore({ baseDir });
    const eventDir = join(baseDir, "runs", "run-round-trip");
    const checkpointDir = join(eventDir, "checkpoints");
    await mkdir(checkpointDir, { recursive: true });
    const valid = sampleEvent();
    const wrongRun = { ...valid, run_id: "other-run" };
    const invalidComponent = { ...valid, component: "not-a-component" };
    const invalidResult = { ...valid, result: "not-a-result" };
    const invalidTimestamp = { ...valid, ts: Number.NaN };
    const invalidAction = { ...valid, action: "   " };
    await writeFile(
      join(eventDir, "events.jsonl"),
      [valid, wrongRun, invalidComponent, invalidResult, invalidTimestamp, invalidAction]
        .map((event) => JSON.stringify(event))
        .join("\n") + "\n",
      "utf8",
    );
    deepStrictEqual(await eventStore.readRun("run-round-trip"), [valid]);

    await writeFile(
      join(checkpointDir, "run-round-trip_s0.json"),
      JSON.stringify({ ...sampleCheckpoint(), run_id: "other-run" }),
      "utf8",
    );
    await writeFile(
      join(checkpointDir, "run-round-trip_s1.json"),
      JSON.stringify({ run_id: "run-round-trip", step_id: "run-round-trip_s1" }),
      "utf8",
    );
    strictEqual(await checkpointStore.load("run-round-trip", "run-round-trip_s0"), null);
    strictEqual(await checkpointStore.load("run-round-trip", "run-round-trip_s1"), null);
  } finally {
    await rm(baseDir, { recursive: true, force: true });
  }
});

test("emitVistaEvent rejects invalid protocol unions and does not persist redaction failures", async () => {
  const baseDir = await temporaryDirectory();
  try {
    const invalidInputs = [
      { component: "invalid", action: "test:invalid", result: "ok" },
      { component: "test", action: "test:invalid", result: "invalid" },
      { component: "test", action: "", result: "ok" },
      { component: "test", action: "test:invalid", result: "ok", ts: Number.NaN },
      { component: "test", action: "test:invalid", result: "ok", ts: null },
    ] as unknown as VistaEventInput[];
    for (const input of invalidInputs) {
      await rejects(
        () => emitVistaEvent(input, { baseDir, runId: "run-invalid", seq: 0 }),
        (error: unknown) => error instanceof VistaProtocolError,
      );
    }
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    const unsafeEvent = {
      component: "test",
      action: "test:unsafe",
      result: "ok",
      unsafe_payload: circular,
    } as unknown as VistaEventInput;
    strictEqual(await emitVistaEvent(unsafeEvent, { baseDir, runId: "run-unsafe", seq: 0 }), undefined);
    deepStrictEqual(await new EventStore({ baseDir }).readRun("run-unsafe"), []);
  } finally {
    await rm(baseDir, { recursive: true, force: true });
  }
});

test("emitVistaEvent accepts custom components and persists the validated event", async () => {
  let persisted: VistaEvent | undefined;
  const store = {
    async append(event: VistaEvent): Promise<void> {
      persisted = event;
    },
  };
  const event = await emitVistaEvent(
    { component: "custom:adapter", action: "custom:observe", result: "unknown" },
    { store, runId: "run-custom", seq: 0, now: 123 },
  );
  strictEqual(event?.component, "custom:adapter");
  strictEqual(persisted?.component, "custom:adapter");
});

test("emitVistaEvent times out a hanging Store.append and remains fail-open", async () => {
  const hangingStore = {
    append(): Promise<void> {
      return new Promise(() => undefined);
    },
  };
  const started = Date.now();
  let event: VistaEvent | undefined;
  await doesNotReject(async () => {
    event = await emitVistaEvent(
      { component: "test", action: "test:hanging", result: "ok" },
      { store: hangingStore, runId: "run-hanging", seq: 0, now: 123, persistTimeoutMs: 20 },
    );
  });
  strictEqual(event?.step_id, "run-hanging_s0");
  strictEqual(event?.ts, 123);
  strictEqual(Date.now() - started < 500, true);
});

test("CheckpointStore.save uses an atomic same-directory replacement", async () => {
  const baseDir = await temporaryDirectory();
  try {
    const checkpointStore = new CheckpointStore({ baseDir });
    await checkpointStore.save(sampleCheckpoint());
    const checkpointDir = join(baseDir, "runs", "run-round-trip", "checkpoints");
    const entries = await readdir(checkpointDir);
    deepStrictEqual(entries, ["run-round-trip_s0.json"]);
    const contents = await readFile(join(checkpointDir, "run-round-trip_s0.json"), "utf8");
    deepStrictEqual(JSON.parse(contents).step_id, "run-round-trip_s0");
  } finally {
    await rm(baseDir, { recursive: true, force: true });
  }
});

test("generated IDs use the same safe segment grammar as stores", () => {
  const runId = generateRunId();
  const stepId = generateStepId(runId, 12);
  strictEqual(isSafeSegment(runId), true);
  strictEqual(isSafeSegment(stepId), true);
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
