import { deepStrictEqual, rejects, strictEqual, throws } from "node:assert/strict";
import { test } from "node:test";
import type { VistaEvent } from "@pi-vista/core";
import { VistaProtocolError } from "@pi-vista/core";
import {
  emitWorkspaceGuardObservation,
  toVistaEventInput,
  type WorkspaceGuardObservation,
} from "./index.js";

const SHARED_INPUT_HASH = "a".repeat(64);

function observation(overrides: Record<string, unknown> = {}): WorkspaceGuardObservation {
  return {
    run_id: "run-workspace-guard",
    trace_id: "pair-123",
    repo: "pi-vista",
    branch: "feat/adapter",
    event: "blocked",
    result: "blocked",
    ...overrides,
  } as WorkspaceGuardObservation;
}

function verdictObservation(verdict: WorkspaceGuardObservation["verdict"], overrides: Record<string, unknown> = {}): WorkspaceGuardObservation {
  const value = observation(overrides) as unknown as Record<string, unknown>;
  delete value.result;
  value.verdict = verdict;
  return value as unknown as WorkspaceGuardObservation;
}

test("maps decision.trio pair IDs and shadow observations without a detail field", () => {
  deepStrictEqual(
    toVistaEventInput(observation({
      event: "decision.trio",
      result: "ok",
      rule: "trio-policy",
      layer: "governance",
      policy_version: "guard-v1",
      target_class: "tracked_file",
      shadow: true,
      shared_input_hash: SHARED_INPUT_HASH,
    })),
    {
      component: "guard",
      run_id: "run-workspace-guard",
      trace_id: "pair-123",
      repo: "pi-vista",
      branch: "feat/adapter",
      action: "guard:decision.trio:shadow",
      result: "ok",
      reason_code: "trio-policy",
      layer: "governance",
      policy_version: "guard-v1",
      target_class: "tracked_file",
      artifact_refs: [{
        type: "shadow_input",
        ref: `shadow-input-${SHARED_INPUT_HASH}`,
      }],
    },
  );
});

test("keeps model identifiers generic for intern and startlux events", () => {
  const intern = toVistaEventInput(observation({
    event: "decision.intern-shadow",
    result: "unknown",
    model_id: "intern/any-model-v9",
    shadow: true,
  }));
  const startlux = toVistaEventInput(observation({
    event: "decision.startlux-shadow",
    result: "abstain",
    model_id: "startlux/custom-model",
    shadow: true,
  }));

  strictEqual(intern.action, "guard:decision.intern-shadow:shadow");
  strictEqual(intern.model_id, "intern/any-model-v9");
  strictEqual(startlux.action, "guard:decision.startlux-shadow:shadow");
  strictEqual(startlux.model_id, "startlux/custom-model");
});

test("maps every accepted workspace-guard verdict", () => {
  const expected = {
    allow: "ok",
    deny: "blocked",
    abstain: "abstain",
    timeout: "unknown",
    unavailable: "unknown",
  } as const;

  for (const [verdict, result] of Object.entries(expected)) {
    strictEqual(
      toVistaEventInput(verdictObservation(verdict as WorkspaceGuardObservation["verdict"])).result,
      result,
      verdict,
    );
  }
});

test("maps a valid shared input hash to an opaque safe artifact reference", () => {
  const mapped = toVistaEventInput(observation({ shared_input_hash: SHARED_INPUT_HASH }));
  deepStrictEqual(mapped.artifact_refs, [{
    type: "shadow_input",
    ref: `shadow-input-${SHARED_INPUT_HASH}`,
  }]);
});

test("rejects an unsafe shared input hash", () => {
  for (const shared_input_hash of ["not-a-hash", "a".repeat(63), "a".repeat(65), `${"a".repeat(63)}g`]) {
    throws(
      () => toVistaEventInput(observation({ shared_input_hash })),
      (error: unknown) => error instanceof VistaProtocolError && /shared_input_hash/u.test(error.message),
    );
  }
});

test("rejects raw command, cwd, path, and credential fields before emission", async () => {
  const store = {
    append(): Promise<void> {
      throw new Error("the store must not be called for invalid input");
    },
  };
  for (const field of ["command", "cwd", "path", "credentials", "stderr"]) {
    const invalid = {
      ...observation(),
      [field]: field === "command" ? "git status" : "/private/value",
    } as unknown as WorkspaceGuardObservation;
    throws(
      () => toVistaEventInput(invalid),
      (error: unknown) => error instanceof VistaProtocolError && /forbidden|unsupported field/u.test(error.message),
    );
    await rejects(
      () => emitWorkspaceGuardObservation(invalid, { store }),
      (error: unknown) => error instanceof VistaProtocolError,
    );
  }
});

test("rejects missing or conflicting result and verdict fields", () => {
  const missing = observation() as unknown as Record<string, unknown>;
  delete missing.result;
  throws(
    () => toVistaEventInput(missing as unknown as WorkspaceGuardObservation),
    (error: unknown) => error instanceof VistaProtocolError && /exactly one/u.test(error.message),
  );
  throws(
    () => toVistaEventInput({ ...observation(), verdict: "allow" } as unknown as WorkspaceGuardObservation),
    (error: unknown) => error instanceof VistaProtocolError && /exactly one/u.test(error.message),
  );
  throws(
    () => toVistaEventInput({ ...observation(), result: "allow" } as unknown as WorkspaceGuardObservation),
    (error: unknown) => error instanceof VistaProtocolError && /VistaResult/u.test(error.message),
  );
});

test("emits a mapped event through a mock store", async () => {
  let persisted: VistaEvent | undefined;
  const store = {
    async append(event: VistaEvent): Promise<void> {
      persisted = event;
    },
  };

  const event = await emitWorkspaceGuardObservation(
    verdictObservation("allow", {
      event: "allowed",
      rule: "safe-rule",
      model_id: "intern-v2",
      shadow: true,
      shared_input_hash: SHARED_INPUT_HASH,
    }),
    { store, seq: 0, now: 123 },
  );

  strictEqual(event?.component, "guard");
  strictEqual(event?.action, "guard:allowed:shadow");
  strictEqual(event?.result, "ok");
  strictEqual(event?.run_id, "run-workspace-guard");
  strictEqual(event?.step_id, "run-workspace-guard_s0");
  strictEqual(event?.ts, 123);
  strictEqual(event?.reason_code, "safe-rule");
  strictEqual(persisted?.action, event?.action);
  strictEqual(persisted?.result, event?.result);
  strictEqual(persisted?.artifact_refs?.[0]?.ref, `shadow-input-${SHARED_INPUT_HASH}`);
});
