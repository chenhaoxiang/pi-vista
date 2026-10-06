import { deepStrictEqual, notStrictEqual, rejects, strictEqual } from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { CheckpointStore, EventStore, isSafeSegment, isVistaCheckpoint, type VistaCheckpoint, type VistaEvent } from "@pi-vista/core";
import {
  createPiRunContext,
  VistaProtocolError,
  withRunContext,
  type PiCheckpointInput,
} from "./index.js";

async function temporaryDirectory(): Promise<string> {
  return mkdtemp(join(tmpdir(), "pi-vista-adapter-pi-"));
}

function withEnvironment<T>(values: Record<string, string | undefined>, callback: () => T): T {
  const previous = Object.fromEntries(Object.keys(values).map((key) => [
    key,
    Object.getOwnPropertyDescriptor(process.env, key)?.value as string | undefined,
  ]));
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    return callback();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

async function withObjectPrototypeProperties<T>(
  properties: PropertyDescriptorMap,
  callback: () => T | Promise<T>,
): Promise<T> {
  const previous = Object.keys(properties).map((key) => [
    key,
    Object.getOwnPropertyDescriptor(Object.prototype, key),
  ] as const);
  try {
    for (const [key, descriptor] of Object.entries(properties)) {
      Object.defineProperty(Object.prototype, key, { ...descriptor, configurable: true });
    }
    return await callback();
  } finally {
    for (const [key, descriptor] of previous) {
      if (descriptor === undefined) Reflect.deleteProperty(Object.prototype, key);
      else Object.defineProperty(Object.prototype, key, descriptor);
    }
  }
}

function checkpointInput(): PiCheckpointInput {
  return {
    task_goal: "safe summary",
    current_state: "safe state",
    source_sha: "sha",
    env_fingerprint: "env",
    policy_version: "policy-1",
    resumable: false,
  };
}

test("run and session IDs use explicit values, safe environments, and safe fallback", () => {
  withEnvironment({ VISTA_RUN_ID: "env-run", PI_SESSION_ID: "env-session" }, () => {
    const explicit = createPiRunContext({ runId: "explicit-run", sessionId: "explicit-session" });
    strictEqual(explicit.runId, "explicit-run");
    strictEqual(explicit.sessionId, "explicit-session");
    strictEqual(process.env.VISTA_RUN_ID, "env-run");

    const fromEnvironment = createPiRunContext();
    strictEqual(fromEnvironment.runId, "env-run");
    strictEqual(fromEnvironment.sessionId, "env-session");
  });

  withEnvironment({ VISTA_RUN_ID: "../do-not-copy", PI_SESSION_ID: "../bad-session" }, () => {
    const context = createPiRunContext();
    strictEqual(isSafeSegment(context.runId), true);
    strictEqual(context.runId, process.env.VISTA_RUN_ID);
    strictEqual(context.runId.includes("../"), false);
    strictEqual(context.sessionId, undefined);
  });
});

test("environment identity ignores inherited data and getters", async () => {
  let getterCalls = 0;
  await withObjectPrototypeProperties({
    VISTA_RUN_ID: { value: "polluted-run", writable: true },
    PI_SESSION_ID: { value: "polluted-session", writable: true },
  }, async () => {
    withEnvironment({ VISTA_RUN_ID: undefined, PI_SESSION_ID: undefined }, () => {
      const context = createPiRunContext();
      notStrictEqual(context.runId, "polluted-run");
      strictEqual(context.sessionId, undefined);
    });
  });
  await withObjectPrototypeProperties({
    VISTA_RUN_ID: {
      get(): never {
        getterCalls += 1;
        throw new Error("run ID getter must not run");
      },
    },
    PI_SESSION_ID: {
      get(): never {
        getterCalls += 1;
        throw new Error("session ID getter must not run");
      },
    },
  }, async () => {
    withEnvironment({ VISTA_RUN_ID: undefined, PI_SESSION_ID: undefined }, () => {
      const context = createPiRunContext();
      strictEqual(isSafeSegment(context.runId), true);
      strictEqual(context.sessionId, undefined);
    });
  });
  strictEqual(getterCalls, 0);
});

test("withRunContext accepts only branded contexts despite prototype pollution", async () => {
  const fake = {};
  await withObjectPrototypeProperties({
    getRunId: { value: () => "polluted-run", writable: true },
    nextStep: { value: () => "polluted-step", writable: true },
    emitToolCall: { value: () => Promise.resolve(undefined), writable: true },
  }, async () => {
    const context = await withRunContext(fake, (value) => value);
    notStrictEqual(context, fake);
    strictEqual(context.getRunId(), context.runId);
    await rejects(
      async () => {
        const accessor = {};
        Object.defineProperty(accessor, "getRunId", {
          get(): never {
            throw new Error("context accessor must not run");
          },
          enumerable: true,
        });
        withRunContext(accessor, () => undefined);
      },
      VistaProtocolError,
    );
    await rejects(
      async () => {
        const proxied = new Proxy(createPiRunContext({ runId: "run-proxy-context" }), {
          get(): never {
            throw new Error("context proxy getter must not run");
          },
        });
        withRunContext(proxied, () => undefined);
      },
      VistaProtocolError,
    );
  });
});

test("session ID validation rejects unsafe explicit values without propagation", async () => {
  await rejects(
    async () => { createPiRunContext({ session_id: "../../private" }); },
    (error: unknown) => error instanceof VistaProtocolError,
  );
  await rejects(
    async () => { createPiRunContext({ run_id: "bad/run" }); },
    (error: unknown) => error instanceof VistaProtocolError,
  );
});

test("steps are monotonically sequenced and checkpoints bind run and step", async () => {
  const saved: unknown[] = [];
  const context = createPiRunContext({
    runId: "run-checkpoint",
    now: 123,
    checkpointStore: {
      async save(checkpoint): Promise<void> {
        saved.push(checkpoint);
      },
    },
  });
  const first = context.nextStep();
  const second = context.nextStep();
  strictEqual(first, "run-checkpoint_s0");
  strictEqual(second, "run-checkpoint_s1");
  strictEqual(context.stepId, second);

  await context.checkpoint({
    task_goal: "inspect repository",
    completed_steps: [first],
    current_state: "inspection complete",
    pending_steps: [],
    source_sha: "0123456789abcdef",
    env_fingerprint: "env-hash",
    policy_version: "policy-1",
    check_fn_ids: [],
    resumable: true,
  });
  deepStrictEqual(saved, [{
    run_id: "run-checkpoint",
    step_id: second,
    ts: 123,
    task_goal: "inspect repository",
    completed_steps: [first],
    current_state: "inspection complete",
    pending_steps: [],
    source_sha: "0123456789abcdef",
    env_fingerprint: "env-hash",
    policy_version: "policy-1",
    check_fn_ids: [],
    resumable: true,
  }]);

  await rejects(
    () => context.checkpoint({
      step_id: first,
      task_goal: "inspect repository",
      current_state: "inspection complete",
      source_sha: "sha",
      env_fingerprint: "env",
      policy_version: "policy-1",
      resumable: true,
    }),
    (error: unknown) => error instanceof VistaProtocolError,
  );
});

test("checkpoint identifier arrays reject core-invalid values before custom persistence", async () => {
  const runId = "run-checkpoint-contract";
  const saved: VistaCheckpoint[] = [];
  const context = createPiRunContext({
    runId,
    now: 123,
    checkpointStore: {
      async save(checkpoint): Promise<void> {
        saved.push(checkpoint);
      },
    },
  });
  const stepId = context.nextStep();
  const baseCheckpoint = {
    ...checkpointInput(),
    run_id: runId,
    step_id: stepId,
    ts: 123,
    completed_steps: [],
    pending_steps: [],
    check_fn_ids: [],
  };
  strictEqual(isVistaCheckpoint(baseCheckpoint), true);
  const fields = [
    {
      keys: ["completedSteps", "completed_steps"],
      protocolKey: "completed_steps",
      validId: stepId,
      invalidIds: [`${runId}_`, "other-run_s0", "", `${runId}_nested/step`, `${runId}_nested\\step`],
    },
    {
      keys: ["pendingSteps", "pending_steps"],
      protocolKey: "pending_steps",
      validId: stepId,
      invalidIds: [`${runId}_`, "other-run_s0", "", `${runId}_nested/step`, `${runId}_nested\\step`],
    },
    {
      keys: ["checkFnIds", "check_fn_ids"],
      protocolKey: "check_fn_ids",
      validId: "check-1",
      invalidIds: ["", ".", "..", "check/a", "check\\a"],
    },
    {
      keys: ["resumeRequires", "resume_requires"],
      protocolKey: "resume_requires",
      validId: "source_sha_matches",
      invalidIds: ["foo..bar", "", ".", "..", "nested/condition", "nested\\condition"],
    },
  ];
  for (const { keys, protocolKey, validId, invalidIds } of fields) {
    for (const key of keys) {
      for (const invalidId of invalidIds) {
        const identifiers = [validId, invalidId];
        const label = `${key}: ${JSON.stringify(invalidId)}`;
        strictEqual(isVistaCheckpoint({ ...baseCheckpoint, [protocolKey]: identifiers }), false, label);
        await rejects(
          () => context.checkpoint({ ...checkpointInput(), [key]: identifiers }),
          VistaProtocolError,
          label,
        );
        strictEqual(saved.length, 0, label);
      }
    }
  }
  await context.flush();
  await context.end();
  deepStrictEqual(saved, []);
});

test("checkpoint identifier arrays accept core-valid values with either alias spelling", async () => {
  const runId = "run-valid-checkpoint";
  const completedSteps = [`${runId}_step-a`, `${runId}_foo..bar`];
  const pendingSteps = [`${runId}_s2`, `${runId}__`];
  const checkFnIds = ["check-1", "foo..bar"];
  const resumeRequires = ["source_sha_matches", "worktree_clean", "custom.condition-1"];
  const saved: VistaCheckpoint[] = [];
  const context = createPiRunContext({
    runId,
    now: 123,
    checkpointStore: {
      async save(checkpoint): Promise<void> {
        strictEqual(isVistaCheckpoint(checkpoint), true);
        saved.push(checkpoint);
      },
    },
  });
  const stepId = context.nextStep();
  for (const identifiers of [
    {
      completed_steps: completedSteps,
      pending_steps: pendingSteps,
      check_fn_ids: checkFnIds,
      resume_requires: resumeRequires,
    },
    { completedSteps, pendingSteps, checkFnIds, resumeRequires },
  ]) {
    await context.checkpoint({ ...checkpointInput(), ...identifiers });
  }
  const expected = {
    ...checkpointInput(),
    run_id: runId,
    step_id: stepId,
    ts: 123,
    completed_steps: completedSteps,
    pending_steps: pendingSteps,
    check_fn_ids: checkFnIds,
    resume_requires: resumeRequires,
  };
  deepStrictEqual(saved, [expected, expected]);
});

test("checkpoint resume requirements may be omitted or an empty array", async () => {
  const saved: VistaCheckpoint[] = [];
  const context = createPiRunContext({
    runId: "run-optional-resume-requirements",
    checkpointStore: {
      async save(checkpoint): Promise<void> {
        strictEqual(isVistaCheckpoint(checkpoint), true);
        saved.push(checkpoint);
      },
    },
  });
  await context.checkpoint(checkpointInput());
  await context.checkpoint({ ...checkpointInput(), resume_requires: [] });
  await context.checkpoint({ ...checkpointInput(), resumeRequires: [] });
  strictEqual(saved.length, 3);
  strictEqual(Object.hasOwn(saved[0] as VistaCheckpoint, "resume_requires"), false);
  deepStrictEqual(saved[1]?.resume_requires, []);
  deepStrictEqual(saved[2]?.resume_requires, []);
});

test("checkpoint validation ignores inherited resume requirement getters", async () => {
  let getterCalls = 0;
  let saveCalls = 0;
  let saved: VistaCheckpoint | undefined;
  await withObjectPrototypeProperties({
    resume_requires: {
      get(): never {
        getterCalls += 1;
        throw new Error("inherited resume requirement getter must not run");
      },
    },
  }, async () => {
    const context = createPiRunContext({
      runId: "run-resume-requirement-prototype",
      checkpointStore: {
        async save(checkpoint): Promise<void> {
          saveCalls += 1;
          const ownDataSnapshot = Object.assign(Object.create(null), checkpoint, { resume_requires: undefined }) as VistaCheckpoint;
          strictEqual(isVistaCheckpoint(ownDataSnapshot), true);
          strictEqual(Object.hasOwn(checkpoint, "resume_requires"), false);
          saved = checkpoint;
        },
      },
    });
    await context.checkpoint(checkpointInput());
  });
  strictEqual(getterCalls, 0);
  strictEqual(saveCalls, 1);
  strictEqual(saved !== undefined, true);
});

test("tool call and result inputs map only safe VistaEvent fields", async () => {
  const emitted: VistaEvent[] = [];
  const context = createPiRunContext({
    runId: "run-tools",
    sessionId: "session-tools",
    emit: async (partial) => {
      const event = partial as VistaEvent;
      emitted.push(event);
      return event;
    },
  });
  const step = context.nextStep();
  await context.emitToolCall({ tool: "read", target_class: "tracked_file", reason_code: "requested" });
  await context.emitToolResult({
    tool: "read",
    result: "blocked",
    target_class: "tracked_file",
    artifact_refs: [{ type: "test_result", ref: "receipt-1", verified: false }],
  });

  deepStrictEqual(emitted, [
    {
      run_id: "run-tools",
      step_id: step,
      component: "pi",
      action: "pi:tool_call:read",
      result: "unknown",
      session_id: "session-tools",
      target_class: "tracked_file",
      reason_code: "requested",
    },
    {
      run_id: "run-tools",
      step_id: step,
      component: "pi",
      action: "pi:tool_result:read",
      result: "blocked",
      session_id: "session-tools",
      target_class: "tracked_file",
      artifact_refs: [{ type: "test_result", ref: "receipt-1", verified: false }],
    },
  ]);
});

test("raw tool payloads and inferred result prose are rejected before emission", async () => {
  const context = createPiRunContext({ runId: "run-reject" });
  const unsafeKeys = ["raw_args", "stdout", "cwd", "path", "prompt", "model_input"];
  for (const key of unsafeKeys) {
    const input = { tool: "read", [key]: "raw value" } as never;
    await rejects(
      () => context.emitToolCall(input),
      (error: unknown) => error instanceof VistaProtocolError,
      key,
    );
  }
  await rejects(
    () => context.emitToolResult({ tool: "read", result: "completed" as never }),
    (error: unknown) => error instanceof VistaProtocolError,
  );
  await rejects(
    () => context.emitToolResult({ tool: "read", result: "ok", artifact_refs: [{ type: "diff", ref: "/tmp/raw.diff" }] }),
    (error: unknown) => error instanceof VistaProtocolError,
  );
});

test("hostile prototypes, accessors, and proxies are rejected", async () => {
  const context = createPiRunContext({ runId: "run-hostile" });
  const nullPrototype = Object.create(null) as { tool: string };
  nullPrototype.tool = "read";
  await rejects(() => context.emitToolCall(nullPrototype), VistaProtocolError);

  const accessor = {} as { tool: string };
  Object.defineProperty(accessor, "tool", { get: () => "read", enumerable: true });
  await rejects(() => context.emitToolCall(accessor), VistaProtocolError);

  const hostile = new Proxy({ tool: "read" }, {
    ownKeys(): string[] {
      throw new Error("hostile proxy");
    },
  });
  await rejects(() => context.emitToolCall(hostile), VistaProtocolError);

  const hostileOptions = new Proxy({ runId: "run-hostile" }, {
    getOwnPropertyDescriptor(): PropertyDescriptor {
      throw new Error("hostile options proxy");
    },
  });
  await rejects(async () => { createPiRunContext(hostileOptions); }, VistaProtocolError);
});

test("normalization ignores polluted Object.prototype data across all input records", async () => {
  const pollution = {
    tool: "inherited-tool",
    result: "ok",
    runId: "inherited-run",
    sessionId: "inherited-session",
    persistTimeoutMs: -1,
    action: "inherited-action",
    reasonCode: "inherited-reason",
    type: "inherited-type",
    ref: "inherited-ref",
    sha: "inherited-sha",
    verified: true,
    stats: { inheritedCount: 99 },
    inheritedCount: 99,
    taskGoal: "inherited goal",
    pendingSteps: ["other-run_s0"],
  };
  const properties = Object.fromEntries(Object.entries(pollution).map(([key, value]) => [
    key,
    { value, writable: true },
  ]));
  const previous = Object.keys(properties).map((key) => Object.getOwnPropertyDescriptor(Object.prototype, key));
  const emitted: VistaEvent[] = [];
  const saved: unknown[] = [];
  await withObjectPrototypeProperties(properties, async () => {
    withEnvironment({ VISTA_RUN_ID: "run-own-data-env", PI_SESSION_ID: undefined }, () => {
      for (const context of [createPiRunContext(), createPiRunContext({})]) {
        strictEqual(context.runId, "run-own-data-env");
        strictEqual(context.sessionId, undefined);
      }
    });
    const context = withEnvironment({ PI_SESSION_ID: undefined }, () => createPiRunContext({
      runId: "run-own-data",
      now: 123,
      emit: async (event) => {
        emitted.push(event as VistaEvent);
        return event as VistaEvent;
      },
      checkpointStore: {
        async save(checkpoint): Promise<void> {
          saved.push(checkpoint);
        },
      },
    }));
    await rejects(() => context.emitToolCall({}), VistaProtocolError);
    await rejects(() => context.emitToolResult({ tool: "read" } as never), VistaProtocolError);
    for (const artifact of [{ ref: "receipt-1" }, { type: "diff" }]) {
      await rejects(
        () => context.emitToolCall({ tool: "read", artifact_refs: [artifact] } as never),
        VistaProtocolError,
      );
    }
    const { task_goal: _taskGoal, ...missingGoal } = checkpointInput();
    await rejects(() => context.checkpoint(missingGoal), VistaProtocolError);

    await context.emitToolResult({
      tool: "read",
      result: "blocked",
      artifact_refs: [
        { type: "diff", ref: "receipt-1" },
        { type: "test_result", ref: "receipt-2", stats: { count: 1 } },
      ],
    });
    await context.checkpoint(checkpointInput());
  });
  deepStrictEqual(emitted, [{
    run_id: "run-own-data",
    step_id: "run-own-data_s0",
    component: "pi",
    action: "pi:tool_result:read",
    result: "blocked",
    artifact_refs: [
      { type: "diff", ref: "receipt-1" },
      { type: "test_result", ref: "receipt-2", stats: { count: 1 } },
    ],
  }]);
  deepStrictEqual(saved, [{
    run_id: "run-own-data",
    step_id: "run-own-data_s0",
    ts: 123,
    task_goal: "safe summary",
    completed_steps: [],
    current_state: "safe state",
    pending_steps: [],
    source_sha: "sha",
    env_fingerprint: "env",
    policy_version: "policy-1",
    check_fn_ids: [],
    resumable: false,
  }]);
  deepStrictEqual(
    Object.keys(properties).map((key) => Object.getOwnPropertyDescriptor(Object.prototype, key)),
    previous,
  );
});

test("normalization neither invokes nor accepts inherited getters", async () => {
  let getterCalls = 0;
  const keys = [
    "tool", "tool_name", "name", "result", "runId", "run_id", "sessionId",
    "persistTimeoutMs", "action", "reasonCode", "artifactRefs", "type", "ref",
    "sha", "verified", "stats", "taskGoal", "task_goal", "pendingSteps",
  ];
  const properties = Object.fromEntries(keys.map((key) => [key, {
    get(): never {
      getterCalls += 1;
      throw new Error("inherited getter must not run");
    },
  }]));
  const previous = keys.map((key) => Object.getOwnPropertyDescriptor(Object.prototype, key));
  await withObjectPrototypeProperties(properties, async () => {
    withEnvironment({ VISTA_RUN_ID: "run-own-getter-env", PI_SESSION_ID: undefined }, () => {
      strictEqual(createPiRunContext().runId, "run-own-getter-env");
      strictEqual(createPiRunContext({}).sessionId, undefined);
    });
    const context = createPiRunContext({
      runId: "run-own-getter",
      now: 123,
      emit: async (event) => event as VistaEvent,
      checkpointStore: { async save(): Promise<void> {} },
    });
    await rejects(() => context.emitToolCall({}), VistaProtocolError);
    await rejects(() => context.emitToolResult({ tool: "read" } as never), VistaProtocolError);
    await rejects(
      () => context.emitToolCall({ tool: "read", artifact_refs: [{}] } as never),
      VistaProtocolError,
    );
    const { task_goal: _taskGoal, ...missingGoal } = checkpointInput();
    await rejects(() => context.checkpoint(missingGoal), VistaProtocolError);
    const event = await context.emitToolResult({
      tool: "read",
      result: "ok",
      artifact_refs: [{ type: "diff", ref: "receipt-1" }],
    });
    strictEqual(event?.action, "pi:tool_result:read");
    await context.checkpoint(checkpointInput());
  });
  strictEqual(getterCalls, 0);
  deepStrictEqual(keys.map((key) => Object.getOwnPropertyDescriptor(Object.prototype, key)), previous);
});

test("mock emitter/store round-trip remains fail-open", async () => {
  const emitted: VistaEvent[] = [];
  const context = createPiRunContext({
    runId: "run-fail-open",
    emit: async (event) => {
      emitted.push(event as VistaEvent);
      return event as VistaEvent;
    },
    checkpointStore: {
      async save(): Promise<void> {
        throw new Error("store unavailable");
      },
    },
  });
  const step = context.nextStep();
  const event = await context.emitToolResult({ tool: "read", result: "ok" });
  strictEqual(event?.step_id, step);
  strictEqual(emitted.length, 1);
  await context.checkpoint({
    task_goal: "safe summary",
    current_state: "safe state",
    source_sha: "sha",
    env_fingerprint: "env",
    policy_version: "policy-1",
    resumable: false,
  });
  await context.flush();
  await context.end();

  const rejectingEmitter = createPiRunContext({
    runId: "run-emitter-fail-open",
    emit: async () => {
      throw new Error("emitter unavailable");
    },
  });
  strictEqual(await rejectingEmitter.emitToolCall({ tool: "read" }), undefined);
});

test("custom emit and checkpointStore.save bound hanging promises, including the 250 ms default", { timeout: 2000 }, async () => {
  for (const persistTimeoutMs of [0, 10, undefined]) {
    let emitterCalls = 0;
    let checkpointCalls = 0;
    const context = createPiRunContext({
      runId: "run-hanging-observers",
      persistTimeoutMs,
      emit: () => {
        emitterCalls += 1;
        return new Promise(() => undefined);
      },
      checkpointStore: {
        save: () => {
          checkpointCalls += 1;
          return new Promise(() => undefined);
        },
      },
    });
    const started = Date.now();
    const call = context.emitToolCall({ tool: "read" });
    const result = context.emitToolResult({ tool: "read", result: "ok" });
    const checkpoint = context.checkpoint(checkpointInput());
    await Promise.all([context.flush(), context.end()]);
    deepStrictEqual(await Promise.all([call, result, checkpoint]), [undefined, undefined, undefined]);
    const elapsed = Date.now() - started;
    strictEqual(elapsed < 1000, true);
    if (persistTimeoutMs === undefined) strictEqual(elapsed >= 200, true);
    strictEqual(emitterCalls, 2);
    strictEqual(checkpointCalls, 1);
    await context.flush();
    await context.end();
  }
});

test("late custom observer rejections after timeout do not emit unhandledRejection", { timeout: 1000 }, async () => {
  let rejectEmission: ((reason?: unknown) => void) | undefined;
  let rejectCheckpoint: ((reason?: unknown) => void) | undefined;
  const context = createPiRunContext({
    runId: "run-late-observers",
    persistTimeoutMs: 5,
    emit: () => new Promise((_resolve, reject) => {
      rejectEmission = reject;
    }),
    checkpointStore: {
      save: () => new Promise<void>((_resolve, reject) => {
        rejectCheckpoint = reject;
      }),
    },
  });
  const unhandled: unknown[] = [];
  const onUnhandledRejection = (reason: unknown): void => {
    unhandled.push(reason);
  };
  process.on("unhandledRejection", onUnhandledRejection);
  try {
    const emission = context.emitToolCall({ tool: "read" });
    const checkpoint = context.checkpoint(checkpointInput());
    strictEqual(await emission, undefined);
    await checkpoint;
    strictEqual(typeof rejectEmission, "function");
    strictEqual(typeof rejectCheckpoint, "function");
    rejectEmission?.(new VistaProtocolError("late emitter failure"));
    rejectCheckpoint?.(new Error("late checkpoint failure"));
    await new Promise<void>((resolve) => setImmediate(resolve));
    await context.flush();
    await context.end();
    deepStrictEqual(unhandled, []);
  } finally {
    process.off("unhandledRejection", onUnhandledRejection);
  }
});

test("custom emitter protocol errors remain visible before timeout", async () => {
  const context = createPiRunContext({
    runId: "run-custom-protocol-error",
    emit: async () => { throw new VistaProtocolError("invalid event"); },
  });
  await rejects(() => context.emitToolCall({ tool: "read" }), VistaProtocolError);
  await context.flush();
  await context.end();
});

test("custom checkpoint protocol errors remain visible before timeout", async () => {
  const context = createPiRunContext({
    runId: "run-custom-checkpoint-protocol-error",
    checkpointStore: {
      save: async () => { throw new VistaProtocolError("invalid checkpoint"); },
    },
  });
  await rejects(() => context.checkpoint(checkpointInput()), VistaProtocolError);
});

test("default core emitter retains its event result when append times out", { timeout: 1000 }, async () => {
  const context = createPiRunContext({
    runId: "run-core-timeout",
    now: 123,
    persistTimeoutMs: 0,
    store: { append: () => new Promise(() => undefined) },
  });
  const event = await context.emitToolResult({ tool: "read", result: "ok" });
  strictEqual(event?.run_id, "run-core-timeout");
  strictEqual(event?.step_id, "run-core-timeout_s0");
  strictEqual(event?.ts, 123);
  strictEqual(event?.result, "ok");
  await context.end();
});

test("custom observer methods use safe descriptors and preserve class receivers", async () => {
  class RecordingEventStore {
    readonly owner = this;
    calls = 0;

    append(_event: VistaEvent): Promise<void> {
      strictEqual(this, this.owner);
      this.calls += 1;
      return Promise.resolve();
    }
  }
  class RecordingCheckpointStore {
    readonly owner = this;
    calls = 0;

    save(_checkpoint: unknown): Promise<void> {
      strictEqual(this, this.owner);
      this.calls += 1;
      return Promise.resolve();
    }
  }
  const store = new RecordingEventStore();
  const checkpointStore = new RecordingCheckpointStore();
  const context = createPiRunContext({
    runId: "run-observer-contract",
    store,
    checkpointStore,
    emit: async (event, options) => {
      await options?.store?.append(event as VistaEvent);
      return event as VistaEvent;
    },
  });
  await context.emitToolResult({ tool: "read", result: "ok" });
  await context.checkpoint(checkpointInput());
  strictEqual(store.calls, 1);
  strictEqual(checkpointStore.calls, 1);
});

test("null-prototype observer receivers with own methods remain valid", async () => {
  let appendCalls = 0;
  let saveCalls = 0;
  const store = Object.create(null) as Pick<EventStore, "append">;
  store.append = () => {
    appendCalls += 1;
    return Promise.resolve();
  };
  const checkpointStore = Object.create(null) as Pick<CheckpointStore, "save">;
  checkpointStore.save = () => {
    saveCalls += 1;
    return Promise.resolve();
  };
  const context = createPiRunContext({
    runId: "run-null-observer",
    store,
    checkpointStore,
    emit: async (event, options) => {
      await options?.store?.append(event as VistaEvent);
      return event as VistaEvent;
    },
  });
  await context.emitToolResult({ tool: "read", result: "ok" });
  await context.checkpoint(checkpointInput());
  strictEqual(appendCalls, 1);
  strictEqual(saveCalls, 1);
});

test("own observer methods cannot bypass hostile prototype inspection", async () => {
  let appendCalls = 0;
  let saveCalls = 0;
  const hostilePrototype = new Proxy(Object.create(null), {
    ownKeys(): never {
      throw new Error("hostile observer prototype");
    },
  });
  const hostileStore = Object.create(hostilePrototype) as Pick<EventStore, "append">;
  hostileStore.append = () => {
    appendCalls += 1;
    return Promise.resolve();
  };
  const hostileCheckpointStore = Object.create(hostilePrototype) as Pick<CheckpointStore, "save">;
  hostileCheckpointStore.save = () => {
    saveCalls += 1;
    return Promise.resolve();
  };
  await rejects(
    async () => { createPiRunContext({ runId: "run-hostile-own-store", store: hostileStore }); },
    (error: unknown) => error instanceof VistaProtocolError
      && error.message === "event store could not be safely inspected",
  );
  await rejects(
    async () => {
      createPiRunContext({ runId: "run-hostile-own-checkpoint", checkpointStore: hostileCheckpointStore });
    },
    (error: unknown) => error instanceof VistaProtocolError
      && error.message === "checkpointStore could not be safely inspected",
  );
  strictEqual(appendCalls, 0);
  strictEqual(saveCalls, 0);
});

test("Object.prototype is never accepted as an observer receiver", async () => {
  let appendCalls = 0;
  let saveCalls = 0;
  await withObjectPrototypeProperties({
    append: {
      value: () => {
        appendCalls += 1;
        return Promise.resolve();
      },
    },
    save: {
      value: () => {
        saveCalls += 1;
        return Promise.resolve();
      },
    },
  }, async () => {
    await rejects(
      async () => {
        createPiRunContext({
          runId: "run-object-prototype-store",
          store: Object.prototype as unknown as Pick<EventStore, "append">,
        });
      },
      VistaProtocolError,
    );
    await rejects(
      async () => {
        createPiRunContext({
          runId: "run-object-prototype-checkpoint",
          checkpointStore: Object.prototype as unknown as Pick<CheckpointStore, "save">,
        });
      },
      VistaProtocolError,
    );
  });
  strictEqual(appendCalls, 0);
  strictEqual(saveCalls, 0);
});

test("invalid observer wiring rejects before calling stores or getters", async () => {
  let appendCalls = 0;
  let saveCalls = 0;
  let getterCalls = 0;
  const inheritedStore = Object.create({
    append(): Promise<void> {
      appendCalls += 1;
      return Promise.resolve();
    },
  }) as Pick<EventStore, "append">;
  const inheritedCheckpoint = Object.create({
    save(): Promise<void> {
      saveCalls += 1;
      return Promise.resolve();
    },
  }) as Pick<CheckpointStore, "save">;
  const accessorStore = {} as Pick<EventStore, "append">;
  Object.defineProperty(accessorStore, "append", {
    get(): never {
      getterCalls += 1;
      throw new Error("append getter must not run");
    },
  });
  const accessorCheckpoint = {} as Pick<CheckpointStore, "save">;
  Object.defineProperty(accessorCheckpoint, "save", {
    get(): never {
      getterCalls += 1;
      throw new Error("save getter must not run");
    },
  });
  const hostileStore = new Proxy({ append(): Promise<void> { return Promise.resolve(); } }, {
    ownKeys(): never {
      throw new Error("store proxy trap");
    },
  });
  const hostileCheckpoint = new Proxy({ save(): Promise<void> { return Promise.resolve(); } }, {
    getOwnPropertyDescriptor(): never {
      throw new Error("checkpoint proxy trap");
    },
  });
  const hostilePrototypeStore = new Proxy({ append(): Promise<void> { return Promise.resolve(); } }, {
    getPrototypeOf(): never {
      throw new Error("store prototype trap");
    },
  });
  const hostileMethodStore = {
    append: new Proxy(async () => undefined, {
      ownKeys(): never {
        throw new Error("method proxy trap");
      },
    }),
  } as Pick<EventStore, "append">;
  await rejects(async () => { createPiRunContext({ runId: "run-invalid-store", store: inheritedStore }); }, VistaProtocolError);
  await rejects(async () => {
    createPiRunContext({ runId: "run-invalid-checkpoint", checkpointStore: inheritedCheckpoint });
  }, VistaProtocolError);
  await rejects(async () => { createPiRunContext({ runId: "run-accessor-store", store: accessorStore }); }, VistaProtocolError);
  await rejects(async () => {
    createPiRunContext({ runId: "run-accessor-checkpoint", checkpointStore: accessorCheckpoint });
  }, VistaProtocolError);
  await rejects(async () => { createPiRunContext({ runId: "run-hostile-store", store: hostileStore }); }, VistaProtocolError);
  await rejects(async () => {
    createPiRunContext({ runId: "run-hostile-checkpoint", checkpointStore: hostileCheckpoint });
  }, VistaProtocolError);
  await rejects(async () => {
    createPiRunContext({ runId: "run-hostile-prototype-store", store: hostilePrototypeStore });
  }, VistaProtocolError);
  await rejects(async () => {
    createPiRunContext({ runId: "run-hostile-method-store", store: hostileMethodStore });
  }, VistaProtocolError);
  const accessorEmitOptions = {};
  Object.defineProperty(accessorEmitOptions, "emit", {
    get(): never {
      getterCalls += 1;
      throw new Error("emit getter must not run");
    },
  });
  await rejects(async () => { createPiRunContext(accessorEmitOptions); }, VistaProtocolError);
  const hostileEmit = new Proxy(async () => undefined, {
    ownKeys(): never {
      throw new Error("emit proxy trap");
    },
  });
  await rejects(async () => {
    createPiRunContext({ runId: "run-hostile-emit", emit: hostileEmit });
  }, VistaProtocolError);
  strictEqual(appendCalls, 0);
  strictEqual(saveCalls, 0);
  strictEqual(getterCalls, 0);
});

test("inherited observer options cannot override defaults", async () => {
  let inheritedEmitCalls = 0;
  await withObjectPrototypeProperties({
    emit: {
      value: () => {
        inheritedEmitCalls += 1;
      },
      writable: true,
    },
  }, async () => {
    const context = createPiRunContext({
      runId: "run-inherited-observer",
      store: { append: () => Promise.resolve() },
    });
    const event = await context.emitToolResult({ tool: "read", result: "ok" });
    strictEqual(event?.run_id, "run-inherited-observer");
  });
  strictEqual(inheritedEmitCalls, 0);
});

test("real core stores can be used without a Pi-private dependency", async () => {
  const baseDir = await temporaryDirectory();
  try {
    const context = createPiRunContext({
      runId: "run-real-store",
      now: 456,
      store: new EventStore({ baseDir }),
      checkpointStore: new CheckpointStore({ baseDir }),
    });
    const step = context.nextStep();
    await context.emitToolResult({ tool: "read", result: "ok" });
    await context.checkpoint({
      step_id: step,
      task_goal: "store round trip",
      current_state: "stored",
      source_sha: "sha",
      env_fingerprint: "env",
      policy_version: "policy-1",
      resumable: true,
    });
    await context.flush();
  } finally {
    await rm(baseDir, { recursive: true, force: true });
  }
});
