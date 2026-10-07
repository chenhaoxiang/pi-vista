import { MAX_LIST_ITEMS, type FailureAnalysis, type FailureObservation, type ObservedReason, type RootCauseCode } from "./contract.js";
import { choice, frozen, integer, invalid, label, list, own } from "./data.js";

const ROOT_CODES: readonly RootCauseCode[] = ["safety_block", "test_regression", "gate_rejection", "source_drift", "environment_drift", "policy_drift", "workspace_conflict", "transport_wait", "unclassified"];
const CLASSIFICATION: Record<ObservedReason, readonly [FailureAnalysis["failure_type"], RootCauseCode]> = {
  guard_block: ["safety", "safety_block"], test_failed: ["validation", "test_regression"], gate_blocked: ["validation", "gate_rejection"],
  sha_mismatch: ["binding", "source_drift"], env_mismatch: ["binding", "environment_drift"], policy_mismatch: ["binding", "policy_drift"],
  path_conflict: ["workspace", "workspace_conflict"], transport_timeout: ["transport", "transport_wait"], unknown: ["unknown", "unclassified"],
};

/** Deterministic classification of observed reason codes, not proof of a cause or repair permission. */
export function classifyFailure(input: FailureObservation): FailureAnalysis {
  const v = own(input, ["failure_id", "run_id", "step_id", "ts", "stage", "reason_code", "hypotheses", "fix_applied", "fix_outcome"],
    ["failure_id", "run_id", "step_id", "ts", "stage", "reason_code"]);
  const reason = choice(v.reason_code, Object.keys(CLASSIFICATION) as ObservedReason[]);
  const [failureType, rootCause] = CLASSIFICATION[reason];
  const hypotheses = v.hypotheses === undefined ? [] : list(v.hypotheses, MAX_LIST_ITEMS).map(value => choice(value, ROOT_CODES));
  if (new Set(hypotheses).size !== hypotheses.length) invalid();
  if (Object.hasOwn(v, "fix_applied") !== Object.hasOwn(v, "fix_outcome")) invalid();
  return frozen({
    authorization: "none", verification: "observed-only", failure_id: label(v.failure_id), run_id: label(v.run_id),
    step_id: label(v.step_id), ts: integer(v.ts), stage: choice(v.stage, ["precondition", "execution", "validation", "promotion"]),
    reason_code: reason, failure_type: failureType, root_cause: rootCause, root_cause_basis: "hypothesis",
    hypotheses: frozen([...new Set([rootCause, ...hypotheses])]),
    ...(v.fix_applied === undefined ? {} : { fix_applied: label(v.fix_applied), fix_outcome: choice(v.fix_outcome, ["resolved", "partial", "failed"]) }),
  });
}
