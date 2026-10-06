import { deepStrictEqual, rejects, strictEqual } from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { CheckpointStore, EventStore, isSafeSegment, type VistaEvent } from "@pi-vista/core";
import { createPiRunContext, VistaProtocolError } from "./index.js";

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
