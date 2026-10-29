import { deepStrictEqual, rejects, strictEqual } from "node:assert/strict";
import { test } from "node:test";
import {
  assertGovernanceReceipt,
  canTransitionEffect,
  canTransitionEvidence,
  canTransitionRun,
  isGovernanceEffectRecord,
  isGovernanceEvidenceRecord,
  isGovernanceReceipt,
  isGovernanceRunRecord,
  VistaProtocolError,
} from "./index.js";
import type { GovernanceReceipt } from "@pi-vista/protocol";

function sampleReceipt(): GovernanceReceipt {
  return {
    receipt_schema: "pi-governance-receipt/1",
    receipt_id: "receipt_effect_1",
    event_kind: "effect.observed",
    emitted_at: "2026-10-29T00:00:00.000Z",
    source: "pi",
    sequence: 1,
    identity: {
      goal_id: "goal_1",
      run_id: "run_1",
      turn_id: "turn_1",
      effect_id: "effect_1",
      attempt_id: "attempt_1",
      session_id: "session_1",
      message_id: "message_1",
    },
    provenance: {
      source_sha: "a".repeat(40),
      head_sha: "b".repeat(40),
      runtime_id: "pi@1.4.0-fork.2",
      extension_set_digest: "c".repeat(64),
      broker_epoch: "epoch_1",
      model_provider: "provider/model-v1",
      model_id: "model-v1",
      policy_version: "policy-1",
      protocol_version: "pi-governance-receipt/1",
    },
    action: {
      kind: "provider_call",
      target_kind: "v2_task",
      target_ref: "safe://task/1",
      effect_key: "effect-key-1",
      input_digest: "d".repeat(64),
      write_scope_digest: "e".repeat(64),
    },
    status: {
      run: "running",
      effect: "observed",
      execution_outcome: "settled",
      business_outcome: "unknown",
      delivery_outcome: "not_requested",
      permission_outcome: "admitted",
      reason_code: "provider_returned",
    },
    evidence: [
      {
        evidence_id: "evidence_1",
        kind: "provider_receipt",
        ref: "safe://provider/receipt/1",
        content_digest: "f".repeat(64),
        state: "bound",
        validator: "provider-readback-1",
        validator_revision: "rev-1",
        observed_at: "2026-10-29T00:00:00.000Z",
        fresh_until: null,
      },
    ],
    resource: {
      quota_class: "bounded",
      estimated_cost: 1,
      actual_cost: 1,
      input_tokens: 10,
      output_tokens: 20,
    },
    next: {
      action: "reconcile",
      waiting_reason: "business_result_unknown",
      scheduler_hint: null,
      stop_condition: "readback_required",
    },
    redaction: {
      profile: "pi-governance-public/1",
      raw_content_included: false,
      credentials_included: false,
      private_path_included: false,
    },
  };
}

test("governance receipt accepts a bounded effect observation", () => {
  const receipt = sampleReceipt();
  strictEqual(isGovernanceReceipt(receipt), true);
  assertGovernanceReceipt(receipt);
  deepStrictEqual(receipt.status.business_outcome, "unknown");
});

test("governance receipt rejects an effect event without effect identity and action", () => {
  const receipt = sampleReceipt();
  const invalid = {
    ...receipt,
    identity: { ...receipt.identity, effect_id: undefined },
    action: undefined,
  } as unknown;
  strictEqual(isGovernanceReceipt(invalid), false);
  rejects(async () => assertGovernanceReceipt(invalid), VistaProtocolError);
});

test("governance receipt rejects raw path-like metadata and unsafe redaction flags", () => {
  const pathReceipt = {
    ...sampleReceipt(),
    action: { ...sampleReceipt().action, target_ref: "/Users/alice/project/output" },
  };
  strictEqual(isGovernanceReceipt(pathReceipt), false);

  const unsafeRedaction = {
    ...sampleReceipt(),
    redaction: { ...sampleReceipt().redaction, raw_content_included: true },
  } as unknown;
  strictEqual(isGovernanceReceipt(unsafeRedaction), false);
});

test("governance state transitions keep unknown effects on reconciliation", () => {
  strictEqual(canTransitionRun("planned", "admitted"), true);
  strictEqual(canTransitionRun("planned", "running"), false);
  strictEqual(canTransitionEffect("unknown", "reconciling"), true);
  strictEqual(canTransitionEffect("unknown", "settled"), false);
  strictEqual(canTransitionEvidence("bound", "validated"), true);
  strictEqual(canTransitionEvidence("validated", "rejected"), false);
});

test("governance record validators keep Run, Effect and Evidence identities bound", () => {
  const run = {
    run_id: "run_1",
    goal_id: "goal_1",
    run_revision: 1,
    status: "running",
    execution_outcome: "running",
    business_outcome: "not_known",
    delivery_outcome: "not_requested",
    permission_outcome: "admitted",
    effect_ids: ["effect_1"],
    evidence_ids: ["evidence_1"],
    next_action: { action: "continue", waiting_reason: null, scheduler_hint: null, stop_condition: "bounded_turn" },
  } as const;
  const effect = {
    effect_id: "effect_1",
    run_id: "run_1",
    effect_key: "effect-key-1",
    kind: "provider_call",
    target_kind: "v2_task",
    state: "unknown",
    attempt_count: 1,
    reconciliation_required: true,
    last_reconciled_at: null,
    duplicate_of: null,
    conflict: false,
  } as const;
  const evidence = {
    evidence_id: "evidence_1",
    run_id: "run_1",
    effect_id: "effect_1",
    kind: "readback",
    state: "validated",
    source_ref: "safe://provider/readback/1",
    claims: ["provider_task_terminal"],
    observed_at: "2026-10-29T00:00:00.000Z",
    fresh_until: null,
    counterevidence_refs: [],
    redaction_profile: "pi-governance-public/1",
  } as const;
  strictEqual(isGovernanceRunRecord(run), true);
  strictEqual(isGovernanceEffectRecord(effect), true);
  strictEqual(isGovernanceEvidenceRecord(evidence), true);
  strictEqual(isGovernanceEffectRecord({ ...effect, state: "settled", reconciliation_required: true, unknown_reason: "timeout_after_dispatch" }), true);
  strictEqual(isGovernanceEvidenceRecord({ ...evidence, source_ref: "/private/raw" }), false);
});
