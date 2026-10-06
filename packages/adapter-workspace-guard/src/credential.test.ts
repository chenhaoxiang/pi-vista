import { deepStrictEqual, rejects, strictEqual, throws } from "node:assert/strict";
import { test } from "node:test";
import { hasKnownCredential, isSafeSegment, VistaProtocolError, type VistaEvent } from "@pi-vista/core";
import { emitWorkspaceGuardObservation, toVistaEventInput, type WorkspaceGuardObservation } from "./index.js";

const signatures = ["ghp_12345678", "github_pat_12345678", `github_pat_${"A".repeat(82)}`, "sk-12345678", "xoxb-12345678", `eyJ${"a".repeat(10)}.${"b".repeat(10)}.${"c".repeat(10)}`];
const variants = signatures.flatMap(value => [value, `run_${value}_s0`, `run-${value}-step`, `prefix${value}suffix`, `PREFIX${value.toUpperCase()}SUFFIX`, `run_${Array.from(value, (character, index) => index % 2 ? character.toUpperCase() : character.toLowerCase()).join("")}`]);
function observation(extra: Record<string, unknown> = {}): WorkspaceGuardObservation {
  return { run_id: "run-guard-credential", event: "decision.summary", verdict: "allow", ...extra } as WorkspaceGuardObservation;
}
function protocolError(error: unknown): boolean {
  return error instanceof VistaProtocolError && !hasKnownCredential(error.message);
}

test("guard retained/source observation fields reject known signatures before mapping or append", async t => {
  let appends = 0;
  const store = { async append() { appends++; } };
  const fields = ["run_id", "session_id", "trace_id", "source_sha", "repo", "branch", "event", "rule", "layer", "policy_version", "model_id", "target_class", "reason_code"];
  for (const value of variants) {
    for (const key of fields) {
      const input = observation({ [key]: key === "branch" || key === "model_id" ? `namespace/${value}` : value });
      throws(() => toVistaEventInput(input), protocolError);
      await rejects(emitWorkspaceGuardObservation(input, { store }), protocolError);
    }
    // Priority must not turn even an unused source reason into a leak/bypass.
    throws(() => toVistaEventInput(observation({ rule: "safe-rule", reason_code: value })), protocolError);
  }
  strictEqual(appends, 0);
  t.diagnostic(`guard retained fields=${fields.length}; known variants=36; mapping/emission pairs=${fields.length * variants.length}; appends=0`);
});

test("guard emission options cannot add unchecked identity after observation validation", async t => {
  let appends = 0;
  let clocks = 0;
  const store = { async append() { appends++; } };
  for (const value of variants) {
    for (const key of ["runId", "stepId"]) {
      const options = { store, [key]: key === "stepId" ? `run-guard-credential_${value}` : value, clock: () => { clocks++; return 123; } };
      // Both effective options and an explicit observation overriding runId are validated.
      await rejects(emitWorkspaceGuardObservation(observation(), options), protocolError);
      const noRun = { event: "decision.summary", verdict: "allow" } as const;
      await rejects(emitWorkspaceGuardObservation(noRun, options), protocolError);
    }
  }
  deepStrictEqual([appends, clocks], [0, 0]);
  t.diagnostic("guard option identity cases=144; append/clock=0");
});

test("guard identity options use own data without getters, Proxy traps, coercion or inherited values", async () => {
  let inspections = 0;
  let appends = 0;
  const store = { async append() { appends++; } };
  for (const key of ["runId", "stepId"]) {
    const accessor = Object.defineProperty({ store }, key, { get() { inspections++; return variants[3]; } });
    await rejects(emitWorkspaceGuardObservation(observation(), accessor), protocolError);
    const inherited = Object.create(Object.defineProperty({}, key, { get() { inspections++; return variants[3]; } }));
    inherited.store = store;
    inherited.now = 123;
    const event = await emitWorkspaceGuardObservation(observation(), inherited);
    strictEqual(event?.run_id, "run-guard-credential");
    strictEqual(event?.step_id, "run-guard-credential_s" + (appends - 1).toString(36));
  }
  const proxied = new Proxy({ store }, {
    get() { inspections++; throw new Error("must not read"); },
    ownKeys() { inspections++; throw new Error("must not inspect"); },
    getOwnPropertyDescriptor() { inspections++; throw new Error("must not inspect"); },
  });
  await rejects(emitWorkspaceGuardObservation(observation(), proxied), protocolError);
  const hostileValue = new Proxy({}, { get() { inspections++; throw new Error("must not coerce"); } });
  await rejects(emitWorkspaceGuardObservation(observation(), { store, runId: hostileValue } as never), protocolError);
  strictEqual(inspections, 0);
  strictEqual(appends, 2);
});

test("guard implicit credential environment is replaced safely; explicit and safe environments keep precedence", async () => {
  const previous = Object.getOwnPropertyDescriptor(process.env, "VISTA_RUN_ID");
  try {
    const emitted: VistaEvent[] = [];
    const store = { async append(event: VistaEvent) { emitted.push(event); } };
    for (const value of variants) {
      process.env.VISTA_RUN_ID = value;
      const event = await emitWorkspaceGuardObservation({ event: "decision.summary", verdict: "allow" }, { store, now: 123 });
      strictEqual(isSafeSegment(event?.run_id), true);
      strictEqual(hasKnownCredential(JSON.stringify(event)), false);
      strictEqual(event?.run_id, process.env.VISTA_RUN_ID);
    }
    process.env.VISTA_RUN_ID = variants[3]!;
    const explicit = await emitWorkspaceGuardObservation(observation(), { store, runId: "run-safe-option", now: 123 });
    strictEqual(explicit?.run_id, "run-guard-credential");
    strictEqual(process.env.VISTA_RUN_ID === variants[3], true);
    const option = await emitWorkspaceGuardObservation({ event: "decision.summary", verdict: "allow" }, { store, runId: "run-safe-option", now: 123 });
    strictEqual(option?.run_id, "run-safe-option");
    process.env.VISTA_RUN_ID = "run-env-guard-security";
    const safe = await emitWorkspaceGuardObservation({ event: "decision.summary", verdict: "allow" }, { store, now: 123 });
    strictEqual(safe?.step_id, "run-env-guard-security_s0");
    strictEqual(hasKnownCredential(JSON.stringify(emitted)), false);
  } finally {
    if (previous === undefined) delete process.env.VISTA_RUN_ID;
    else Object.defineProperty(process.env, "VISTA_RUN_ID", previous);
  }
});

test("guard safe provider/branch namespaces, hashes, outcome and rule priority remain compatible", async () => {
  const digest = "a".repeat(64);
  const input = observation({ session_id: "session-task-58", trace_id: "pair-58", source_sha: "b".repeat(40), repo: "pi-vista", branch: "feature/metadata-safety", model_id: "provider/model-v9", rule: "priority-rule", reason_code: "other-reason", shadow: true, shared_input_hash: digest });
  const mapped = toVistaEventInput(input);
  strictEqual(mapped.branch, input.branch);
  strictEqual(mapped.model_id, input.model_id);
  strictEqual(mapped.reason_code, "priority-rule");
  strictEqual(mapped.result, "ok");
  strictEqual(mapped.action, "guard:decision.summary:shadow");
  deepStrictEqual(mapped.artifact_refs, [{ type: "shadow_input", ref: `shadow-input-${digest}` }]);
  let recorded: VistaEvent | undefined;
  const event = await emitWorkspaceGuardObservation(input, { store: { async append(value) { recorded = value; } }, stepId: "run-guard-credential_custom-step", now: 123 });
  strictEqual(event?.step_id, "run-guard-credential_custom-step");
  strictEqual(recorded?.model_id, "provider/model-v9");
});
