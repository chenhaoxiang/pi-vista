import { deepStrictEqual, rejects, strictEqual } from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { CheckpointStore, EventStore, isSafeSegment, type VistaEvent } from "@pi-vista/core";
import { createPiRunContext, VistaProtocolError, type PiCheckpointInput } from "./index.js";

async function temporaryDirectory(): Promise<string> {
  return mkdtemp(join(tmpdir(), "pi-vista-adapter-pi-"));
}

function withEnvironment<T>(values: Record<string, string | undefined>, callback: () => T): T {
  const previous = Object.fromEntries(Object.keys(values).map((key) => [key, process.env[key]]));
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
