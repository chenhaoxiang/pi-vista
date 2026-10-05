import { deepStrictEqual, doesNotReject, match, rejects, strictEqual } from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { VistaCheckpoint, VistaCheckFunction, VistaEvent } from "@pi-vista/protocol";
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
import { BARE_COMMAND_WORDS, isSafeCustomComponent } from "./safe-fields.js";
import { isVistaComponent, isVistaEvent, VistaProtocolError } from "./validation.js";

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

    await checkpointStore.save({ ...sampleCheckpoint(), step_id: "run-round-trip_step-z", ts: 1_700_000_000_000 });
    await checkpointStore.save({ ...sampleCheckpoint(), step_id: "run-round-trip_step-a", ts: 1_700_000_000_001 });

    deepStrictEqual(await checkpointStore.listCheckpoints("run-round-trip"), ["run-round-trip_step-a", "run-round-trip_step-z"]);
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

test("redactAll drops unsafe property names while retaining protocol metadata and safe stats", () => {
  const unsafeProperties: Record<string, unknown> = {
    "/Users/alice/private.txt": "path-key-value",
    "nested/key": "slash-key-value",
    "nested\\\\key": "backslash-key-value",
    "bad\u0000key": "control-key-value",
    CLIENT_SECRET: "credential-key-value",
    "private-key": "private-key-value",
    shell_command: "echo shell-key-value",
    echo: "bare-command-key-value",
    unknown_payload: "unknown value",
  };
  const value = redactAll({
    ...unsafeProperties,
    action: "guard:A:block",
    repo: "vista",
    artifact_refs: [{
      type: "test_result",
      ref: "receipt-1",
      stats: { passed: 1, suite: "unit", token: "stats-secret" },
    }],
    nested: unsafeProperties,
  }) as Record<string, unknown>;

  for (const key of Object.keys(unsafeProperties).filter((key) => key !== "unknown_payload")) {
    strictEqual(Object.hasOwn(value, key), false, `unsafe root key ${JSON.stringify(key)} was retained`);
    strictEqual(JSON.stringify(value).includes(key), false, `unsafe key ${JSON.stringify(key)} was serialized`);
  }
  strictEqual(value.unknown_payload, "[REDACTED]");
  strictEqual(value.action, "guard:A:block");
  deepStrictEqual((value.artifact_refs as Array<{ stats: Record<string, unknown> }>)[0]?.stats, {
    passed: 1,
    suite: "unit",
  });
  strictEqual(JSON.stringify(value).includes("path-key-value"), false);
  strictEqual(JSON.stringify(value).includes("credential-key-value"), false);
});

test("redactAll uses an allowlist and handles encoded URL secrets", () => {
  const value = redactAll({
    prompt_text: "raw prompt text must not be retained",
    MODEL_PROMPT: "another prompt",
    response_body: "raw model response",
    task_goal: "raw task goal",
    current_state: "raw state",
    stderr_output: "raw stderr",
    unknown_short_text: "short model output",
    unknown_command: "echo short secret",
    aws_secret_assignment: "AWS_SECRET_ACCESS_KEY=aws-secret-access-secret",
    aws_id_assignment: "AWS_ACCESS_KEY_ID=aws-access-id-secret",
    client_assignment: "CLIENT_SECRET=client-secret",
    private_assignment: "PRIVATE_KEY=private-secret",
    token_assignment: "ACCESS_TOKEN=access-secret",
    api_assignment: "API_KEY=api-secret",
    url: "https://alice:password@example.test/Users/alice/private.txt?%41WS%5FSECRET%5FACCESS%5FKEY=url-secret&%41WS%5FACCESS%5FKEY%5FID=id-secret&%43LIENT%5FSECRET=client-url-secret&file=%2FUsers%2Falice%2Fsecret.txt#path=%2FUsers%2Falice%2Ffragment.txt&%61ccess_token=fragment-secret",
    unknown_payload: "unclassified sensitive text ".repeat(8),
  });
  const serialized = JSON.stringify(value);
  strictEqual(serialized.includes("raw prompt text"), false);
  strictEqual(serialized.includes("raw model response"), false);
  strictEqual(serialized.includes("short model output"), false);
  strictEqual(serialized.includes("echo short secret"), false);
  strictEqual(serialized.includes("aws-secret-access-secret"), false);
  strictEqual(serialized.includes("aws-access-id-secret"), false);
  strictEqual(serialized.includes("client-secret"), false);
  strictEqual(serialized.includes("private-secret"), false);
  strictEqual(serialized.includes("access-secret"), false);
  strictEqual(serialized.includes("api-secret"), false);
  strictEqual(serialized.includes("password@example"), false);
  strictEqual(serialized.includes("url-secret"), false);
  strictEqual(serialized.includes("client-url-secret"), false);
  strictEqual(serialized.includes("id-secret"), false);
  strictEqual(serialized.includes("fragment-secret"), false);
  strictEqual(serialized.includes("/Users/alice"), false);
  strictEqual(serialized.includes("unknown_payload"), true);
  strictEqual((value as { url: string }).url.includes("[REDACTED_PATH]"), true);
  strictEqual((value as { url: string }).url.includes("[REDACTED_CREDENTIAL]"), true);
});

test("custom components preserve slash, Unicode, dots, and namespaced command words", () => {
  const components = [
    "custom:adapter/v2",
    "custom:适配器.β/检查",
    "custom:组件/v2",
    "custom:adapter/git/v2",
  ];
  for (const component of components) {
    strictEqual(isVistaComponent(component), true);
    const value = redactAll({ component });
    deepStrictEqual(value, { component });
  }

  strictEqual(isVistaComponent("custom:"), false);
  strictEqual(isVistaComponent("custom:adapter/v2\nsecret"), false);
  strictEqual(isVistaComponent("custom:/Users/alice"), false);
  strictEqual(isVistaComponent("custom:CLIENT_SECRET=secret"), false);
  deepStrictEqual(redactAll({ component: "custom:/Users/alice" }), { component: "custom:[REDACTED_PATH]" });

  for (const component of ["custom:foo|bar", "custom:pwd|whoami", "custom:cat /tmp/file"]) {
    strictEqual(isSafeCustomComponent(component), false);
    strictEqual(isVistaComponent(component), false);
    strictEqual(isVistaEvent({ ...sampleEvent(), component }), false);
    const redacted = redactAll({ component }) as { component: string };
    strictEqual(redacted.component, "custom:[REDACTED_COMMAND]");
    strictEqual(redacted.component.includes(component), false);
    strictEqual(isVistaComponent(redacted.component), true);
  }

  for (const command of ["pwd", "whoami", "rm", "cat", "git", "curl", "bash"]) {
    const component = `custom:${command}`;
    strictEqual(isSafeCustomComponent(component), false);
    strictEqual(isVistaComponent(component), false);
    strictEqual(isVistaEvent({ ...sampleEvent(), component }), false);
    deepStrictEqual(redactAll({ component }), { component: "custom:[REDACTED_COMMAND]" });
  }
});

test("redactAll preserves structured metadata and safe IDs but not unknown text", () => {
  const value = redactAll({
    action: "guard:A:block",
    raw_action: "ls",
    reason_code: "sha_mismatch",
    component: "custom:adapter",
    repo: "vista",
    branch: "feature/redaction",
    run_id: "run-structured",
    step_id: "run-structured_s0",
    completed_steps: ["run-structured_s0"],
    check_fn_ids: ["check-safe"],
    unknown: "hello",
  });

  deepStrictEqual(value, {
    action: "guard:A:block",
    raw_action: "[REDACTED]",
    reason_code: "sha_mismatch",
    component: "custom:adapter",
    repo: "vista",
    branch: "feature/redaction",
    run_id: "run-structured",
    step_id: "run-structured_s0",
    completed_steps: ["run-structured_s0"],
    check_fn_ids: ["check-safe"],
    unknown: "[REDACTED]",
  });
});

test("ArtifactRef stats retain short metadata and redact unsafe strings", () => {
  const value = redactAll({
    artifact_refs: [{
      type: "test_result",
      ref: "receipt-1",
      stats: {
        passed: 19,
        total: "19",
        suite: "unit",
        locale: "检查",
        long_label: "x".repeat(65),
        command: "echo secret",
        path: "/Users/alice/private.txt",
        CLIENT_SECRET: "client-secret",
      },
    }],
  }) as {
    artifact_refs: Array<{ stats: Record<string, number | string> }>;
  };

  deepStrictEqual(value.artifact_refs[0]?.stats, {
    passed: 19,
    total: "19",
    suite: "unit",
    locale: "检查",
    long_label: "[REDACTED]",
  });
});

test("emitVistaEvent retains safe ArtifactRef string stats", async () => {
  let persisted: VistaEvent | undefined;
  const store = {
    async append(event: VistaEvent): Promise<void> {
      persisted = event;
    },
  };
  const event = await emitVistaEvent(
    {
      component: "test",
      action: "test:stats",
      result: "ok",
      artifact_refs: [{ type: "test_result", ref: "receipt-1", stats: { suite: "unit", platform: "检查" } }],
    },
    { store, runId: "run-stats", seq: 0, now: 123 },
  );
  deepStrictEqual(event?.artifact_refs?.[0]?.stats, { suite: "unit", platform: "检查" });
  deepStrictEqual(persisted?.artifact_refs?.[0]?.stats, { suite: "unit", platform: "检查" });
});

test("runtime bindings reject cross-run and unsafe checkpoint references", async () => {
  const baseDir = await temporaryDirectory();
  try {
    const eventStore = new EventStore({ baseDir });
    const checkpointStore = new CheckpointStore({ baseDir });
    const invalidEventStepIds = ["step-a", "other-run_s0", "run-round-trip_../step"];
    for (const stepId of invalidEventStepIds) {
      await rejects(
        () => eventStore.append({ ...sampleEvent(), step_id: stepId }),
        VistaProtocolError,
      );
    }

    const invalidCheckpoints: VistaCheckpoint[] = [
      { ...sampleCheckpoint(), step_id: "step-a" },
      { ...sampleCheckpoint(), step_id: "other-run_s0" },
      { ...sampleCheckpoint(), completed_steps: ["other-run_s0"] },
      { ...sampleCheckpoint(), pending_steps: ["run-round-trip_s0", "step-z"] },
      { ...sampleCheckpoint(), pending_steps: ["run-round-trip/s0"] },
      { ...sampleCheckpoint(), check_fn_ids: [""] },
      { ...sampleCheckpoint(), check_fn_ids: ["check/a"] },
      { ...sampleCheckpoint(), resume_requires: [""] },
      { ...sampleCheckpoint(), resume_requires: ["nested/condition"] },
      { ...sampleCheckpoint(), resume_requires: ["../outside"] },
      { ...sampleCheckpoint(), resume_requires: ["nested\\\\condition"] },
    ];
    for (const checkpoint of invalidCheckpoints) {
      await rejects(() => checkpointStore.save(checkpoint), VistaProtocolError);
    }

    const checkpointDir = join(baseDir, "runs", "run-round-trip", "checkpoints");
    await mkdir(checkpointDir, { recursive: true });
    await writeFile(
      join(checkpointDir, "other-run_s0.json"),
      JSON.stringify({ ...sampleCheckpoint(), step_id: "other-run_s0" }),
      "utf8",
    );
    await writeFile(
      join(checkpointDir, "step-a.json"),
      JSON.stringify({ ...sampleCheckpoint(), step_id: "step-a" }),
      "utf8",
    );
    await writeFile(
      join(checkpointDir, "run-round-trip_s9.json"),
      JSON.stringify({ ...sampleCheckpoint(), completed_steps: ["other-run_s0"] }),
      "utf8",
    );
    deepStrictEqual(await checkpointStore.listCheckpoints("run-round-trip"), []);
  } finally {
    await rm(baseDir, { recursive: true, force: true });
  }
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
    const wrongRun = { ...valid, run_id: "other-run", step_id: "other-run_s0" };
    const wrongStepBinding = { ...valid, step_id: "other-run_s0" };
    const invalidStepBinding = { ...valid, step_id: "step-a" };
    const invalidComponent = { ...valid, component: "not-a-component" };
    const invalidPipeComponent = { ...valid, component: "custom:foo|bar" };
    const invalidBareCommandComponents = ["custom:pwd", "custom:whoami", "custom:rm", "custom:cat", "custom:git", "custom:curl", "custom:bash"]
      .map((component) => ({ ...valid, component }));
    const invalidResult = { ...valid, result: "not-a-result" };
    const invalidTimestamp = { ...valid, ts: Number.NaN };
    const invalidAction = { ...valid, action: "   " };
    await writeFile(
      join(eventDir, "events.jsonl"),
      [valid, wrongRun, wrongStepBinding, invalidStepBinding, invalidComponent, invalidPipeComponent, ...invalidBareCommandComponents, invalidResult, invalidTimestamp, invalidAction]
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
    await writeFile(
      join(checkpointDir, "run-round-trip_s2.json"),
      JSON.stringify({ ...sampleCheckpoint(), step_id: "other-run_s0" }),
      "utf8",
    );
    await writeFile(
      join(checkpointDir, "run-round-trip_s3.json"),
      JSON.stringify({ ...sampleCheckpoint(), completed_steps: ["other-run_s0"] }),
      "utf8",
    );
    strictEqual(await checkpointStore.load("run-round-trip", "run-round-trip_s0"), null);
    strictEqual(await checkpointStore.load("run-round-trip", "run-round-trip_s1"), null);
    strictEqual(await checkpointStore.load("run-round-trip", "run-round-trip_s2"), null);
    strictEqual(await checkpointStore.load("run-round-trip", "run-round-trip_s3"), null);
  } finally {
    await rm(baseDir, { recursive: true, force: true });
  }
});

test("emitter and stores do not persist unsafe property names", async () => {
  const unsafeProperties: Record<string, unknown> = {
    "/Users/alice/private.txt": "path-key-value",
    "nested/key": "slash-key-value",
    "nested\\\\key": "backslash-key-value",
    "bad\u0000key": "control-key-value",
    API_TOKEN: "credential-key-value",
    "private-key": "private-key-value",
    shell_command: "echo shell-key-value",
    awk: "bare-command-key-value",
  };
  const eventInput = {
    ...sampleEvent(),
    ...unsafeProperties,
    artifact_refs: [{ type: "test_result", ref: "receipt-1", stats: { passed: 1, token: "stats-secret" } }],
  } as unknown as VistaEvent;
  const checkpointInput = {
    ...sampleCheckpoint(),
    ...unsafeProperties,
  } as unknown as VistaCheckpoint;
  const assertSafeJson = (serialized: string): void => {
    for (const [key, value] of Object.entries(unsafeProperties)) {
      strictEqual(serialized.includes(key), false, `unsafe key ${JSON.stringify(key)} was persisted`);
      strictEqual(serialized.includes(String(value)), false, `unsafe value for ${JSON.stringify(key)} was persisted`);
    }
    strictEqual(serialized.includes("stats-secret"), false);
  };

  let emitted: VistaEvent | undefined;
  const emittedStore = {
    async append(event: VistaEvent): Promise<void> {
      emitted = event;
    },
  };
  await emitVistaEvent(eventInput, { store: emittedStore, runId: sampleEvent().run_id, seq: 0, now: 123 });
  strictEqual(emitted !== undefined, true);
  assertSafeJson(JSON.stringify(emitted));

  const baseDir = await temporaryDirectory();
  try {
    const eventStore = new EventStore({ baseDir });
    const checkpointStore = new CheckpointStore({ baseDir });
    await eventStore.append(eventInput);
    await checkpointStore.save(checkpointInput);

    const eventFile = await readFile(join(baseDir, "runs", sampleEvent().run_id, "events.jsonl"), "utf8");
    const checkpointFile = await readFile(
      join(baseDir, "runs", sampleCheckpoint().run_id, "checkpoints", `${sampleCheckpoint().step_id}.json`),
      "utf8",
    );
    assertSafeJson(eventFile);
    assertSafeJson(checkpointFile);
    assertSafeJson(JSON.stringify((await eventStore.readRun(sampleEvent().run_id))[0]));
    assertSafeJson(JSON.stringify(await checkpointStore.load(sampleCheckpoint().run_id, sampleCheckpoint().step_id)));
  } finally {
    await rm(baseDir, { recursive: true, force: true });
  }
});

test("check-function repair contracts carry only an opaque policy key", () => {
  const check: VistaCheckFunction = {
    check_id: "check-worktree",
    type: "worktree_clean",
    params: {},
    on_fail: "REPAIR",
    repair_action_id: "policy:repair_worktree",
  };
  strictEqual(check.repair_action_id, "policy:repair_worktree");
  strictEqual(Object.hasOwn(check, "repair_action"), false);
  strictEqual(JSON.stringify(check).includes("shell"), false);
});

test("validator rejects unsafe versions and preserves unknown slash versions", async () => {
  const invalidStats = {
    ...sampleEvent(),
    artifact_refs: [{ type: "test_result", ref: "receipt-1", stats: { total: Number.POSITIVE_INFINITY } }],
  };
  strictEqual(isVistaEvent(invalidStats), false);
  strictEqual(isVistaEvent({
    ...sampleEvent(),
    artifact_refs: [{ type: "test_result", ref: "receipt-1", stats: { suite: "unit" } }],
  }), true);
  strictEqual(isVistaEvent({
    ...sampleEvent(),
    artifact_refs: [{ type: "test_result", ref: "receipt-1", stats: { suite: "x".repeat(65) } }],
  }), false);
  strictEqual(isVistaEvent({ ...sampleEvent(), vista_version: "" }), false);
  strictEqual(isVistaEvent({ ...sampleEvent(), vista_version: "future/1" }), true);
  for (const vista_version of [
    "future/1\nsecret",
    "future|1",
    "/tmp/vista",
    "TOKEN=secret",
    "https://example.test/future/1",
    ...BARE_COMMAND_WORDS,
  ]) {
    strictEqual(isVistaEvent({ ...sampleEvent(), vista_version }), false, vista_version);
  }
  deepStrictEqual(redactAll({ vista_version: "future/1" }), { vista_version: "future/1" });
  deepStrictEqual(redactAll({ vista_version: "awk" }), { vista_version: "[REDACTED_COMMAND]" });
  deepStrictEqual(redactAll({ vista_version: "future|1" }), { vista_version: "[REDACTED_COMMAND]" });

  const baseDir = await temporaryDirectory();
  try {
    const store = new EventStore({ baseDir });
    await rejects(() => store.append(invalidStats), VistaProtocolError);
    await store.append({ ...sampleEvent(), vista_version: "future/1" });
    deepStrictEqual((await store.readRun("run-round-trip"))[0]?.vista_version, "future/1");
  } finally {
    await rm(baseDir, { recursive: true, force: true });
  }
});

test("emitVistaEvent rejects invalid protocol unions and does not persist redaction failures", async () => {
  const baseDir = await temporaryDirectory();
  try {
    const invalidInputs = [
      { component: "invalid", action: "test:invalid", result: "ok" },
      { component: "custom:adapter/v2\nsecret", action: "test:invalid", result: "ok" },
      { component: "custom:/tmp/private", action: "test:invalid", result: "ok" },
      { component: "custom:foo|bar", action: "test:invalid", result: "ok" },
      { component: "custom:pwd|whoami", action: "test:invalid", result: "ok" },
      { component: "custom:pwd", action: "test:invalid", result: "ok" },
      { component: "custom:whoami", action: "test:invalid", result: "ok" },
      { component: "custom:rm", action: "test:invalid", result: "ok" },
      { component: "custom:cat", action: "test:invalid", result: "ok" },
      { component: "custom:git", action: "test:invalid", result: "ok" },
      { component: "custom:curl", action: "test:invalid", result: "ok" },
      { component: "custom:bash", action: "test:invalid", result: "ok" },
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

test("EventStore rejects unsafe custom components without persistence", async () => {
  const baseDir = await temporaryDirectory();
  try {
    const store = new EventStore({ baseDir });
    const invalidComponents = [
      "custom:foo|bar",
      "custom:pwd|whoami",
      "custom:pwd",
      "custom:whoami",
      "custom:rm",
      "custom:cat",
      "custom:git",
      "custom:curl",
      "custom:bash",
    ] as const;
    for (const component of invalidComponents) {
      await rejects(
        () => store.append({ ...sampleEvent(), component }),
        (error: unknown) => error instanceof VistaProtocolError,
      );
    }
    deepStrictEqual(await store.readRun("run-round-trip"), []);
    deepStrictEqual(await readdir(baseDir), []);
  } finally {
    await rm(baseDir, { recursive: true, force: true });
  }
});

test("emitVistaEvent accepts slash and Unicode custom components and persists them", async () => {
  const persisted: VistaEvent[] = [];
  const store = {
    async append(event: VistaEvent): Promise<void> {
      persisted.push(event);
    },
  };
  const components = ["custom:adapter/v2", "custom:适配器.β/检查", "custom:组件/v2", "custom:adapter/git/v2"] as const;
  for (const [seq, component] of components.entries()) {
    const event = await emitVistaEvent(
      { component, action: "custom:observe", result: "unknown" },
      { store, runId: "run-custom", seq, now: 123 },
    );
    strictEqual(event?.component, component);
    strictEqual(isVistaEvent(event), true);
  }
  deepStrictEqual(persisted.map((event) => event.component), components);
});

test("a delayed Store.append rejection after timeout is handled without unhandledRejection", async () => {
  let rejectAppend: ((reason?: unknown) => void) | undefined;
  let resolveStarted: (() => void) | undefined;
  const started = new Promise<void>((resolve) => {
    resolveStarted = resolve;
  });
  const store = {
    append(): Promise<void> {
      resolveStarted?.();
      return new Promise<void>((_resolve, reject) => {
        rejectAppend = reject;
      });
    },
  };
  const unhandled: unknown[] = [];
  const onUnhandledRejection = (reason: unknown): void => {
    unhandled.push(reason);
  };
  process.on("unhandledRejection", onUnhandledRejection);
  try {
    await emitVistaEvent(
      { component: "test", action: "test:delayed_rejection", result: "ok" },
      { store, runId: "run-delayed-rejection", seq: 0, now: 123, persistTimeoutMs: 5 },
    );
    await started;
    rejectAppend?.(new Error("late store failure"));
    await new Promise<void>((resolve) => setImmediate(resolve));
    strictEqual(unhandled.length, 0);
  } finally {
    process.off("unhandledRejection", onUnhandledRejection);
  }
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

test("concurrent saves for one step produce a valid last-writer-wins checkpoint", async () => {
  const baseDir = await temporaryDirectory();
  try {
    const checkpointStore = new CheckpointStore({ baseDir });
    const first = { ...sampleCheckpoint(), policy_version: "policy-first" };
    const second = { ...sampleCheckpoint(), policy_version: "policy-second" };
    await Promise.all([checkpointStore.save(first), checkpointStore.save(second)]);

    const loaded = await checkpointStore.load(sampleCheckpoint().run_id, sampleCheckpoint().step_id);
    strictEqual(loaded?.policy_version === "policy-first" || loaded?.policy_version === "policy-second", true);
    strictEqual(loaded?.current_state, "[REDACTED]");
  } finally {
    await rm(baseDir, { recursive: true, force: true });
  }
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
