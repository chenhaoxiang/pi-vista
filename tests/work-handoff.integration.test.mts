import { deepStrictEqual, strictEqual } from "node:assert/strict";
import { test } from "node:test";
import {
  createPiRunContext, observePiWorkHandoff, readPiOwnerResult,
  type PiOwnerReadback, type PiOwnerResultReadRequest, type PiResultConsumption, type PiWorkBinding,
} from "@pi-vista/adapter-pi";
import type { GovernanceHandoff, GovernanceReceipt } from "@pi-vista/protocol";

const now = Date.parse("2026-11-04T00:00:30.000Z");
const observedAt = "2026-11-04T00:00:20.000Z";
const freshUntil = "2026-11-04T00:01:00.000Z";
const original: PiWorkBinding = {
  workRef: { owner: "example/maintenance", kind: "change", key: "already-owned-work" },
  stageId: "source", runId: "previous-run", sessionId: "previous-session", revision: 3, headSha: "a".repeat(40),
};
const successor: PiWorkBinding = {
  ...original, runId: "successor-run", sessionId: "successor-session", revision: 0, headSha: "b".repeat(40),
};
const handoff: GovernanceHandoff = {
  handoff_schema: "pi-governance-handoff/1", run_id: original.runId, run_revision: original.revision,
  source_session_id: original.sessionId, accepted_facts: ["existing-artifact", "existing-commit"],
  unresolved_effects: ["original-native-operation"], blockers: ["open-question-1"], next_action: "reconcile",
  successor_constraints: { must_read_current_head: true, must_not_replay_unknown_effect: true, must_not_change_model_silently: true },
};

function receipt(binding: PiWorkBinding, id: string): GovernanceReceipt {
  return {
    receipt_schema: "pi-governance-receipt/1", receipt_id: id, event_kind: "run.settled", emitted_at: observedAt,
    source: "subagents", identity: { run_id: binding.runId, session_id: binding.sessionId },
    provenance: { protocol_version: "pi-governance-receipt/1", head_sha: binding.headSha },
    status: { run: "settled", execution_outcome: "settled", business_outcome: "unknown", delivery_outcome: "available", permission_outcome: "not_checked" },
    redaction: { profile: "pi-governance-public/1", raw_content_included: false, credentials_included: false, private_path_included: false },
  };
}

function ownerReadback(current: PiWorkBinding): PiOwnerReadback {
  return {
    binding: current, sourceKind: "code", sourceRef: "current-source-stage", disposition: "accepted", observedAt, freshUntil,
    requiredEvidence: [{ evidenceId: "current-checks", kind: "test", sourceRef: "current-checks-original", claims: ["stage-checks"] }],
    evidence: [{ binding: current, record: {
      evidence_id: "current-checks", run_id: current.runId, kind: "test", state: "validated",
      source_ref: "current-checks-original", source_sha: current.headSha, claims: ["stage-checks"],
      observed_at: observedAt, fresh_until: freshUntil, counterevidence_refs: [], redaction_profile: "pi-governance-public/1",
    } }], requiredEffects: [],
  };
}

test("public contexts preserve existing handoff, then fence late results against actual current owner binding", async () => {
  const originals = new Map<string, { binding: PiWorkBinding; artifactRef: string }>();
  const deliveries: PiResultConsumption[] = [];
  let current = original;
  let emissions = 0;
  const readOwner = (request: PiOwnerResultReadRequest): PiOwnerReadback => {
    strictEqual(originals.get(request.resultRef)?.binding.runId, request.binding.runId);
    return ownerReadback(current);
  };
  const sink = (binding: PiWorkBinding) => async (value: GovernanceReceipt): Promise<void> => {
    originals.set(value.receipt_id, { binding, artifactRef: `${value.receipt_id}-artifact` });
    deliveries.push(await readPiOwnerResult({ binding, resultRef: value.receipt_id }, { readOwner, now }));
  };
  const previousContext = createPiRunContext({ runId: original.runId, sessionId: original.sessionId,
    emit: async () => { emissions += 1; return undefined; }, emitGovernanceReceipt: sink(original) });
  await previousContext.emitGovernanceReceipt(receipt(original, "old-result"));
  strictEqual(deliveries[0]?.decision, "deliverable");
  await previousContext.end(); // A flush/checkpoint is not a claim that the external worker/effect was killed.
  const before = JSON.stringify(handoff);
  const observed = observePiWorkHandoff({ previous: original, successor, handoff });
  strictEqual(observed.decision, "handoff_observed");
  deepStrictEqual(observed.acceptedFactRefs, ["existing-artifact", "existing-commit"]);
  deepStrictEqual(observed.unresolvedEffectRefs, ["original-native-operation"]);
  deepStrictEqual(observed.blockerRefs, ["open-question-1"]);
  strictEqual(observed.currentVerification, "not_checked");
  strictEqual(observed.executable, false);

  current = successor;
  const successorContext = createPiRunContext({ runId: successor.runId, sessionId: successor.sessionId,
    emit: async () => { emissions += 1; return undefined; }, emitGovernanceReceipt: sink(successor) });
  await successorContext.emitGovernanceReceipt(receipt(successor, "new-result"));
  strictEqual(deliveries[1]?.decision, "deliverable");
  const currentBeforeLate = JSON.stringify(current);
  await previousContext.emitGovernanceReceipt(receipt(original, "late-original-result"));
  strictEqual(deliveries[2]?.reasonCode, "binding_mismatch");
  strictEqual(deliveries[2]?.resultRef, "late-original-result");
  deepStrictEqual(deliveries[2]?.binding, original);
  strictEqual(originals.get("late-original-result")?.artifactRef, "late-original-result-artifact");
  strictEqual(JSON.stringify(current), currentBeforeLate);
  strictEqual(JSON.stringify(handoff), before);
  strictEqual((await successorContext.emitToolResult({ tool: "native-maintenance", result: "ok" })), undefined);
  await successorContext.end();
  strictEqual(emissions, 1, "handoff/receipt observation never creates execution or tool events");
});

test("an unresolved native effect stays with its original run and prevents success only when this stage requires it", async () => {
  const nativeOperation = Object.freeze({ sourceRunId: original.runId, reference: "original-native-operation", outcome: "unknown" });
  const before = JSON.stringify(nativeOperation);
  const reference = { binding: successor, resultRef: "new-result" };
  const completedIndependentStage = await readPiOwnerResult(reference, { readOwner: () => ownerReadback(successor), now });
  strictEqual(completedIndependentStage.decision, "deliverable");
  const required = await readPiOwnerResult(reference, { readOwner: () => ({
    ...ownerReadback(successor), requiredEffects: [{
      binding: successor, effectRef: nativeOperation.reference, outcome: "unknown", disposition: "unknown",
    }],
  }), now });
  strictEqual(required.reasonCode, "required_effect_unknown");
  strictEqual(required.outcome, "unknown");
  strictEqual(JSON.stringify(nativeOperation), before);
  strictEqual(nativeOperation.sourceRunId, original.runId);
});
