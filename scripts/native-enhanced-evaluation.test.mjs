import test from "node:test";
import assert from "node:assert/strict";
import {
  ARTIFACT_SCHEMA,
  INPUT_SCHEMA,
  projectNativeEnhancedEvaluation,
  validateNativeEnhancedEvaluationArtifact,
  isNativeEnhancedEvaluationArtifact,
} from "./native-enhanced-evaluation.mjs";

const source = "a".repeat(40);
const head = "b".repeat(40);
const now = "2026-11-05T00:00:00.000Z";

function run(overrides = {}) {
  const result = {
    run_id: "run-synthetic-1",
    run_revision: 1,
    status: "settled",
    execution_outcome: "settled",
    business_outcome: "completed",
    delivery_outcome: "delivered",
    permission_outcome: "admitted",
    effect_ids: ["effect-1"],
    evidence_ids: ["evidence-1"],
    next_action: { action: "none" },
    source_sha: source,
    head_sha: head,
    ...overrides,
  };
  for (const key of ["source_sha", "head_sha"]) if (result[key] === undefined) delete result[key];
  return result;
}

function effect(overrides = {}) {
  return {
    effect_id: "effect-1",
    run_id: "run-synthetic-1",
    effect_key: "effect-key-1",
    kind: "provider_call",
    target_kind: "synthetic-task",
    state: "settled",
    attempt_count: 1,
    reconciliation_required: false,
    duplicate_of: null,
    conflict: false,
    ...overrides,
  };
}

function evidence(overrides = {}) {
  return {
    evidence_id: "evidence-1",
    run_id: "run-synthetic-1",
    kind: "readback",
    state: "validated",
    source_ref: "synthetic-readback",
    source_sha: source,
    claims: ["completed"],
    observed_at: now,
    fresh_until: null,
    counterevidence_refs: [],
    redaction_profile: "pi-governance-public-1",
    ...overrides,
  };
}

function receipt(overrides = {}) {
  return {
    receipt_schema: "pi-governance-receipt/1",
    receipt_id: "receipt-run-1",
    event_kind: "run.settled",
    emitted_at: now,
    source: "pi",
    identity: { run_id: "run-synthetic-1" },
    provenance: { source_sha: source, head_sha: head, protocol_version: "pi-governance-receipt/1" },
    status: { run: "settled", execution_outcome: "settled", business_outcome: "completed", delivery_outcome: "delivered", permission_outcome: "admitted" },
    redaction: { profile: "pi-governance-public-1", raw_content_included: false, credentials_included: false, private_path_included: false },
    ...overrides,
  };
}

function handoff(overrides = {}) {
  return {
    handoff_schema: "pi-governance-handoff/1",
    run_id: "run-synthetic-1",
    run_revision: 1,
    accepted_facts: ["synthetic-result"],
    unresolved_effects: [],
    blockers: [],
    next_action: "none",
    successor_constraints: { must_read_current_head: true, must_not_replay_unknown_effect: true, must_not_change_model_silently: true },
    ...overrides,
  };
}

function positive(overrides = {}) {
  return {
    schema: INPUT_SCHEMA,
    task_id: "T01",
    arm: "native",
    run: run(),
    receipt: receipt(),
    effects: [effect()],
    evidence: [evidence()],
    handoff: handoff(),
    measurements: {
      latency_ms: 12.5,
      human_interventions: 0,
      rework_count: 1,
      context_tokens: 100,
      input_tokens: 80,
      output_tokens: 20,
      total_tokens: 100,
      ...overrides,
    },
  };
}

test("Native and Enhanced produce the same versioned JSON-safe projection shape", () => {
  const native = projectNativeEnhancedEvaluation(positive({ estimated_cost: 0.01 }));
  const enhanced = projectNativeEnhancedEvaluation({ ...positive({ estimated_cost: 0.02 }), arm: "enhanced" });
  assert.equal(native.schema, ARTIFACT_SCHEMA);
  assert.equal(native.arm, "native");
  assert.equal(enhanced.arm, "enhanced");
  assert.deepEqual(Object.keys(native).sort(), [
    "arm", "authorization", "executable", "head", "metrics", "observation", "outcome", "read_only", "reconcile_required", "run_id", "schema", "source", "task_id", "unknown", "verification", "verification_state",
  ].sort());
  assert.equal(native.source.status, "observed");
  assert.equal(native.head.status, "observed");
  assert.deepEqual(native.outcome, { status: "pass", run: "settled", execution: "settled", business: "completed", delivery: "delivered", permission: "admitted", effect: "settled" });
  assert.equal(native.verification, "metadata-only");
  assert.deepEqual(native.verification_state, { status: "validated", evidence_count: 1, validated_count: 1 });
  assert.equal(native.metrics.estimated_cost, 0.01);
  assert.equal(native.metrics.cost_status, "provided-estimate");
  assert.equal(native.unknown, false);
  assert.equal(native.reconcile_required, false);
  assert.equal(native.authorization, "none");
  assert.equal(native.executable, false);
  assert.equal(native.read_only, true);
  assert.deepEqual(JSON.parse(JSON.stringify(native)), native);
  assert.deepEqual(validateNativeEnhancedEvaluationArtifact(native), native);
  const failedInput = { ...positive(), run: run({ status: "failed", execution_outcome: "failed", business_outcome: "failed", next_action: { action: "none" } }) };
  delete failedInput.receipt;
  const failed = projectNativeEnhancedEvaluation(failedInput);
  assert.equal(failed.outcome.status, "fail");
  assert.equal(failed.unknown, false);
});

test("Governance text fields preserve safe natural language while ID references stay closed", () => {
  const artifact = projectNativeEnhancedEvaluation({
    ...positive(),
    evidence: [evidence({ claims: ["validated readback with 中文事实"], counterevidence_refs: ["counter-1"] })],
    handoff: handoff({
      accepted_facts: ["当前结果已验证"],
      unresolved_effects: ["等待业务确认"],
      blockers: ["负责人需要复核"],
    }),
  });
  assert.equal(artifact.reconcile_required, true);
  assert.equal(artifact.outcome.status, "unknown");
});

test("null measurements fall back to receipt resources, matching values agree, and non-null conflicts refuse", () => {
  const fallback = projectNativeEnhancedEvaluation({
    ...positive({ input_tokens: null }),
    receipt: receipt({ resource: { input_tokens: 120 } }),
  });
  assert.equal(fallback.metrics.input_tokens, 120);

  const matching = projectNativeEnhancedEvaluation({
    ...positive({ input_tokens: 120 }),
    receipt: receipt({ resource: { input_tokens: 120 } }),
  });
  assert.equal(matching.metrics.input_tokens, 120);

  assert.throws(() => projectNativeEnhancedEvaluation({
    ...positive({ input_tokens: 121 }),
    receipt: receipt({ resource: { input_tokens: 120 } }),
  }), /native-enhanced-evaluation-refused/);
});

test("missing source/head and measurements remain unknown or null without guessed cost", () => {
  const artifact = projectNativeEnhancedEvaluation({
    schema: INPUT_SCHEMA,
    task_id: "T02",
    arm: "enhanced",
    run: run({ run_id: "run-unknown-1", status: "unknown", execution_outcome: "unknown", business_outcome: "unknown", delivery_outcome: "unknown", permission_outcome: "unknown", effect_ids: [], evidence_ids: [], next_action: { action: "reconcile" }, source_sha: undefined, head_sha: undefined }),
  });
  assert.deepEqual(artifact.source, { status: "unknown", sha: null });
  assert.deepEqual(artifact.head, { status: "unknown", sha: null });
  assert.equal(artifact.unknown, true);
  assert.equal(artifact.reconcile_required, true);
  assert.equal(artifact.outcome.status, "unknown");
  assert.equal(artifact.outcome.effect, null);
  assert.equal(artifact.verification, "metadata-only");
  assert.deepEqual(artifact.verification_state, { status: "unknown", evidence_count: 0, validated_count: 0 });
  assert.deepEqual(artifact.metrics, {
    latency_ms: null, human_interventions: null, rework_count: null, duplicate_effect_count: null,
    context_tokens: null, input_tokens: null, output_tokens: null, total_tokens: null,
    estimated_cost: null, cost_status: "unknown",
  });
});

test("duplicate effects and reconciliation stay observable without becoming success", () => {
  const artifact = projectNativeEnhancedEvaluation({
    ...positive(),
    effects: [effect({ effect_id: "effect-1", duplicate_of: "effect-0", reconciliation_required: true }), effect({ effect_id: "effect-0" })],
    run: run({ effect_ids: ["effect-1", "effect-0"], next_action: { action: "reconcile" } }),
  });
  assert.equal(artifact.metrics.duplicate_effect_count, 1);
  assert.equal(artifact.reconcile_required, true);
  assert.equal(artifact.outcome.status, "unknown");
  assert.equal(artifact.outcome.business, "completed");
  assert.equal(artifact.unknown, true);
});

test("only settled effects pass; in-flight effects reconcile and terminal effect failures fail", () => {
  for (const state of ["planned", "admitted", "dispatched", "in_flight", "observed", "cancel_requested"]) {
    const artifact = projectNativeEnhancedEvaluation({ ...positive(), effects: [effect({ state })] });
    assert.equal(artifact.outcome.effect, "unknown", state);
    assert.equal(artifact.outcome.status, "unknown", state);
    assert.equal(artifact.unknown, true, state);
    assert.equal(artifact.reconcile_required, true, state);
    assert.equal(artifact.authorization, "none", state);
    assert.equal(artifact.executable, false, state);
  }
  for (const state of ["failed", "cancelled"]) {
    const artifact = projectNativeEnhancedEvaluation({ ...positive(), effects: [effect({ state })] });
    assert.equal(artifact.outcome.effect, state, state);
    assert.equal(artifact.outcome.status, "fail", state);
    assert.equal(artifact.unknown, false, state);
    assert.equal(artifact.reconcile_required, false, state);
    assert.equal(artifact.authorization, "none", state);
    assert.equal(artifact.executable, false, state);
    assert.equal(isNativeEnhancedEvaluationArtifact(artifact), true, state);
  }
});

test("illegal statuses, arms, unregistered identities and contradictory unknown flags are rejected", () => {
  assert.throws(() => projectNativeEnhancedEvaluation({ ...positive(), arm: "baseline" }), /native-enhanced-evaluation-refused/);
  assert.throws(() => projectNativeEnhancedEvaluation({ ...positive(), task_id: "T99" }), /native-enhanced-evaluation-refused/);
  assert.throws(() => projectNativeEnhancedEvaluation({ ...positive(), run: run({ status: "approved" }) }), /native-enhanced-evaluation-refused/);
  assert.throws(() => projectNativeEnhancedEvaluation({ ...positive(), effects: [effect({ run_id: "other-run" })] }), /native-enhanced-evaluation-refused/);
  assert.throws(() => projectNativeEnhancedEvaluation({ ...positive(), evidence: [evidence({ source_sha: "c".repeat(40) })] }), /native-enhanced-evaluation-refused/);
  assert.throws(() => projectNativeEnhancedEvaluation({ ...positive(), receipt: receipt({ status: { run: "running", execution_outcome: "running", business_outcome: "progress", delivery_outcome: "preparing", permission_outcome: "admitted" } }) }), /native-enhanced-evaluation-refused/);
  assert.throws(() => validateNativeEnhancedEvaluationArtifact({
    ...projectNativeEnhancedEvaluation(positive()),
    unknown: true,
    reconcile_required: false,
  }), /native-enhanced-evaluation-refused/);
  assert.throws(() => validateNativeEnhancedEvaluationArtifact({
    ...projectNativeEnhancedEvaluation(positive()),
    unknown: false,
    source: { status: "unknown", sha: null },
  }), /native-enhanced-evaluation-refused/);
  const valid = projectNativeEnhancedEvaluation(positive());
  assert.throws(() => validateNativeEnhancedEvaluationArtifact({
    ...valid,
    task_id: "T99",
  }), /native-enhanced-evaluation-refused/);
  assert.throws(() => validateNativeEnhancedEvaluationArtifact({
    ...valid,
    outcome: { ...valid.outcome, status: "fail" },
  }), /native-enhanced-evaluation-refused/);
});

test("raw content, credentials, paths and unknown fields never enter the artifact", () => {
  assert.throws(() => projectNativeEnhancedEvaluation({ ...positive(), prompt: "PRIVATE_MODEL_OUTPUT" }), /native-enhanced-evaluation-refused/);
  assert.throws(() => projectNativeEnhancedEvaluation({ ...positive(), task_id: "ghp_abcdefghijklmnopqrstuvwxyz1234567890" }), /native-enhanced-evaluation-refused/);
  assert.throws(() => projectNativeEnhancedEvaluation({ ...positive(), measurements: { latency_ms: 1, output_tokens: 1, raw_output: "PRIVATE" } }), /native-enhanced-evaluation-refused/);
  assert.throws(() => projectNativeEnhancedEvaluation({ ...positive(), run: run({ source_sha: "/private/repository" }) }), /native-enhanced-evaluation-refused/);
  let touched = 0;
  const hostile = new Proxy(positive(), { ownKeys() { touched += 1; throw Error("private"); } });
  assert.throws(() => projectNativeEnhancedEvaluation(hostile), /native-enhanced-evaluation-refused/);
  assert.equal(touched, 0);
  const getter = { ...positive() };
  Object.defineProperty(getter, "task_id", { get() { touched += 1; throw Error("private"); } });
  assert.throws(() => projectNativeEnhancedEvaluation(getter), /native-enhanced-evaluation-refused/);
  assert.equal(touched, 0);
  assert.equal(isNativeEnhancedEvaluationArtifact({ raw: "PRIVATE" }), false);
});
