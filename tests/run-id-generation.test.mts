import { rejects, strictEqual, throws } from "node:assert/strict";
import { test } from "node:test";
import { createPiRunContext } from "@pi-vista/adapter-pi";
import { emitWorkspaceGuardObservation } from "@pi-vista/adapter-workspace-guard";
import {
  currentRunId, emitVistaEvent, hasKnownCredential, isVistaCheckpoint, isVistaEvent,
  VistaProtocolError, type VistaCheckpoint, type VistaEvent,
} from "@pi-vista/core";

const SUFFIXES = ["ghp", "gho", "ghu", "ghs", "ghr"] as const;
const PERIOD = 36 ** 3;
const TIMESTAMP_BASE = 1_700_000_000_000 - 1_700_000_000_000 % PERIOD;
const RUN_ID_PATTERN = /^vr_[0-9a-f]{14}_[0-9a-f]{8}$/u;
const KNOWN_SIGNATURES = [
  ...SUFFIXES.map(suffix => `${suffix}_12345678`), "github_pat_12345678", "sk-12345678", "xoxb-12345678",
  `eyJ${"a".repeat(10)}.${"b".repeat(10)}.${"c".repeat(10)}`,
].flatMap(value => [value, `PREFIX${value.toUpperCase()}SUFFIX`]);
function protocolError(error: unknown): boolean {
  return error instanceof VistaProtocolError && !hasKnownCredential(error.message);
}

for (const suffix of SUFFIXES) {
  test(`implicit core/Pi/guard generation succeeds at the fixed natural ${suffix} clock without weakening credential rejection`, async t => {
    const nowDescriptor = Object.getOwnPropertyDescriptor(Date, "now")!;
    const environment = ["VISTA_RUN_ID", "PI_SESSION_ID"].map(key => [key, Object.getOwnPropertyDescriptor(process.env, key)] as const);
    const timestamp = TIMESTAMP_BASE + Number.parseInt(suffix, 36);
    strictEqual(timestamp.toString(36).slice(-3), suffix);
    let clockCalls = 0;
    let appends = 0;
    let saves = 0;
    const store = { async append(event: VistaEvent) { appends++; strictEqual(isVistaEvent(event), true); strictEqual(hasKnownCredential(JSON.stringify(event)), false); } };
    const checkpointStore = { async save(checkpoint: VistaCheckpoint) { saves++; strictEqual(isVistaCheckpoint(checkpoint), true); strictEqual(hasKnownCredential(JSON.stringify(checkpoint)), false); } };
    try {
      Object.defineProperty(Date, "now", { ...nowDescriptor, value: () => { clockCalls++; return timestamp; } });
      for (const mode of ["absent", "unsafe"] as const) {
        for (const component of ["core", "pi", "guard"] as const) {
          if (mode === "absent") { delete process.env.VISTA_RUN_ID; delete process.env.PI_SESSION_ID; }
          else { process.env.VISTA_RUN_ID = "run_ghp_12345678_s0"; process.env.PI_SESSION_ID = "session_github_pat_12345678"; }
          const beforeCalls = clockCalls;
          let event: VistaEvent | undefined;
          if (component === "core") {
            event = await emitVistaEvent({ component: "pi", action: "pi:recorded", result: "unknown" }, { store, now: 123 });
          } else if (component === "pi") {
            const context = createPiRunContext({ store, checkpointStore, now: 123 });
            strictEqual(context.sessionId, undefined);
            const first = await context.emitToolCall({ tool: "read" });
            strictEqual(first?.step_id, `${context.runId}_s0`);
            strictEqual(context.nextStep(), `${context.runId}_s1`);
            event = await context.emitToolResult({ tool: "read", result: "ok" });
            await context.checkpoint({ task_goal: "synthetic summary", current_state: "synthetic state", completed_steps: [first!.step_id], pending_steps: [], source_sha: "a".repeat(40), env_fingerprint: "env-safe", policy_version: "policy-1", resumable: false });
            await context.end();
            strictEqual(event?.step_id, `${context.runId}_s1`);
          } else {
            event = await emitWorkspaceGuardObservation({ event: "decision.summary", verdict: "allow" }, { store, now: 123 });
          }
          strictEqual(isVistaEvent(event), true);
          strictEqual(RUN_ID_PATTERN.test(event!.run_id), true);
          strictEqual(currentRunId() === event!.run_id, true);
          strictEqual(process.env.VISTA_RUN_ID === event!.run_id, true);
          strictEqual(clockCalls - beforeCalls, 1, "fixed bad clock must complete with one generation, no retry");
        }
      }
      strictEqual(appends, 8);
      strictEqual(saves, 2);
      strictEqual(clockCalls, 6);

      // Explicit identities retain precedence even over a credential-bearing environment.
      process.env.VISTA_RUN_ID = "run_ghp_12345678_s0";
      process.env.PI_SESSION_ID = "session_github_pat_12345678";
      const explicitCore = await emitVistaEvent({ run_id: "run-explicit-core", component: "pi", action: "pi:recorded", result: "unknown" }, { store, runId: "run-option-core", now: 123 });
      strictEqual(explicitCore?.run_id, "run-explicit-core");
      const explicitPi = createPiRunContext({ run_id: "run-explicit-pi", session_id: "session-explicit-pi", store, checkpointStore, now: 123 });
      const explicitPiEvent = await explicitPi.emitToolCall({ tool: "read" });
      strictEqual(explicitPiEvent?.run_id, "run-explicit-pi");
      strictEqual(explicitPiEvent?.session_id, "session-explicit-pi");
      const explicitGuard = await emitWorkspaceGuardObservation({ run_id: "run-explicit-guard", event: "decision.summary", verdict: "allow" }, { store, runId: "run-option-guard", now: 123 });
      strictEqual(explicitGuard?.run_id, "run-explicit-guard");
      strictEqual(process.env.VISTA_RUN_ID === "run_ghp_12345678_s0", true);
      strictEqual(clockCalls, 6, "explicit safe identities do not generate or rewrite an environment ID");
      strictEqual(appends, 11);

      process.env.VISTA_RUN_ID = "vr_loyw3v28_1234abcd";
      process.env.PI_SESSION_ID = "session-safe-env";
      const safeEnvironment = createPiRunContext({ store, checkpointStore, now: 123 });
      strictEqual(safeEnvironment.runId, "vr_loyw3v28_1234abcd");
      strictEqual(safeEnvironment.sessionId, "session-safe-env");
      strictEqual(clockCalls, 6, "safe historical/environment IDs are still reused");

      for (const value of KNOWN_SIGNATURES) {
        strictEqual(hasKnownCredential(value), true);
        await rejects(emitVistaEvent({ component: "pi", action: "pi:recorded", result: "unknown" }, { store, runId: value, now: 123 }), protocolError);
        throws(() => createPiRunContext({ runId: value, store, checkpointStore, now: 123 }), protocolError);
        await rejects(emitWorkspaceGuardObservation({ run_id: value, event: "decision.summary", verdict: "allow" }, { store, now: 123 }), protocolError);
        await rejects(emitWorkspaceGuardObservation({ event: "decision.summary", verdict: "allow" }, { store, runId: value, now: 123 }), protocolError);
      }
      strictEqual(appends, 11, "known credential rejection must not call an observer");
      strictEqual(saves, 2);
      strictEqual(clockCalls, 6, "known explicit signatures must reject without generation");
      t.diagnostic(JSON.stringify({ suffix, natural_bad_clock_reproduced: true, implicit_fallback_cases: 6, implicit_append_calls: 8, checkpoint_calls: 2, explicit_safe_cases: 3, credential_rejection_cases: KNOWN_SIGNATURES.length * 4, rejected_observer_calls: 0, clock_reads: clockCalls, no_filesystem_or_network: true }));
    } finally {
      Object.defineProperty(Date, "now", nowDescriptor);
      for (const [key, descriptor] of environment) {
        if (descriptor === undefined) delete process.env[key];
        else Object.defineProperty(process.env, key, descriptor);
      }
    }
  });
}
