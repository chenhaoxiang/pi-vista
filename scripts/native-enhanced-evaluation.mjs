import { types } from "node:util";
import { TASKS } from "./ai-capability-evaluation.mjs";
import {
  hasKnownCredential,
  isGovernanceEffectRecord,
  isGovernanceEvidenceRecord,
  isGovernanceHandoff,
  isGovernanceReceipt,
  isGovernanceRunRecord,
} from "@pi-vista/core";

export const INPUT_SCHEMA = "pi-native-enhanced-evaluation-input/1";
export const ARTIFACT_SCHEMA = "pi-native-enhanced-evaluation/1";
export const ARMS = Object.freeze(["native", "enhanced"]);
const TASK_IDS = new Set(TASKS.map(task => task.id));
export const SAFETY = Object.freeze({
  observation: "recorded-only",
  verification: "metadata-only",
  authorization: "none",
  executable: false,
  read_only: true,
});

const REFUSAL = "native-enhanced-evaluation-refused";
const SHA = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u;
const LABEL = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const RUN_KEYS = ["run_id", "goal_id", "run_revision", "status", "execution_outcome", "business_outcome", "delivery_outcome", "permission_outcome", "owner", "policy_version", "session_id", "session_epoch", "runtime_id", "effect_ids", "evidence_ids", "next_action", "source_sha", "head_sha", "config_digest"];
const RUN_REQUIRED = ["run_id", "run_revision", "status", "execution_outcome", "business_outcome", "delivery_outcome", "permission_outcome", "effect_ids", "evidence_ids", "next_action"];
const EFFECT_KEYS = ["effect_id", "run_id", "effect_key", "kind", "target_kind", "target_ref", "scope_digest", "state", "attempt_count", "dispatch_receipt_id", "last_observed_receipt_id", "unknown_reason", "reconciliation_required", "last_reconciled_at", "duplicate_of", "conflict"];
const EFFECT_REQUIRED = ["effect_id", "run_id", "effect_key", "kind", "target_kind", "state", "attempt_count", "reconciliation_required", "conflict"];
const EVIDENCE_KEYS = ["evidence_id", "run_id", "effect_id", "kind", "state", "authority", "source_ref", "source_sha", "content_digest", "claims", "validator", "validator_revision", "observed_at", "fresh_until", "counterevidence_refs", "redaction_profile"];
const EVIDENCE_REQUIRED = ["evidence_id", "run_id", "kind", "state", "source_ref", "claims", "observed_at", "counterevidence_refs", "redaction_profile"];
const HANDOFF_KEYS = ["handoff_schema", "goal_id", "run_id", "run_revision", "source_session_id", "source_runtime", "accepted_facts", "unresolved_effects", "blockers", "next_action", "write_scope_digest", "stop_condition", "successor_constraints"];
const HANDOFF_REQUIRED = ["handoff_schema", "run_id", "run_revision", "accepted_facts", "unresolved_effects", "blockers", "next_action", "successor_constraints"];
const RECEIPT_KEYS = ["receipt_schema", "receipt_id", "event_kind", "emitted_at", "source", "sequence", "parent_receipt_id", "identity", "provenance", "action", "status", "evidence", "resource", "next", "redaction"];
const RECEIPT_REQUIRED = ["receipt_schema", "receipt_id", "event_kind", "emitted_at", "source", "identity", "provenance", "status", "redaction"];
const IDENTITY_KEYS = ["goal_id", "run_id", "turn_id", "effect_id", "attempt_id", "session_id", "message_id"];
const PROVENANCE_KEYS = ["source_sha", "head_sha", "runtime_id", "extension_set_digest", "broker_epoch", "model_provider", "model_id", "policy_version", "protocol_version"];
const STATUS_KEYS = ["run", "effect", "execution_outcome", "business_outcome", "delivery_outcome", "permission_outcome", "reason_code", "unknown_reason"];
const STATUS_REQUIRED = ["run", "execution_outcome", "business_outcome", "delivery_outcome", "permission_outcome"];
const ACTION_KEYS = ["kind", "target_kind", "target_ref", "effect_key", "input_digest", "write_scope_digest"];
const ACTION_REQUIRED = ["kind", "target_kind"];
const NEXT_KEYS = ["action", "waiting_reason", "scheduler_hint", "stop_condition"];
const NEXT_REQUIRED = ["action"];
const RESOURCE_KEYS = ["quota_class", "estimated_cost", "actual_cost", "input_tokens", "output_tokens"];
const REDACTION_KEYS = ["profile", "raw_content_included", "credentials_included", "private_path_included"];
const MEASUREMENT_KEYS = ["latency_ms", "human_interventions", "rework_count", "context_tokens", "input_tokens", "output_tokens", "total_tokens", "estimated_cost"];
const ARTIFACT_KEYS = ["schema", "task_id", "run_id", "arm", "source", "head", "outcome", "verification", "verification_state", "metrics", "unknown", "reconcile_required", "observation", "authorization", "executable", "read_only"];
const BINDING_KEYS = ["status", "sha"];
const OUTCOME_KEYS = ["status", "run", "execution", "business", "delivery", "permission"];
const VERIFICATION_KEYS = ["status", "evidence_count", "validated_count"];
const METRIC_OUTPUT_KEYS = ["latency_ms", "human_interventions", "rework_count", "duplicate_effect_count", "context_tokens", "input_tokens", "output_tokens", "total_tokens", "estimated_cost", "cost_status"];
const OUTCOME_STATUSES = new Set(["pass", "fail", "unknown"]);
const RUN_STATUSES = new Set(["planned", "admitted", "running", "waiting", "recovering", "settled", "failed", "cancelled", "unknown", "closed"]);
const EXECUTION_OUTCOMES = new Set(["not_started", "running", "settled", "failed", "unknown"]);
const BUSINESS_OUTCOMES = new Set(["not_known", "progress", "completed", "failed", "blocked", "cancelled", "unknown"]);
const DELIVERY_OUTCOMES = new Set(["not_requested", "preparing", "available", "delivered", "failed", "unknown"]);
const PERMISSION_OUTCOMES = new Set(["not_checked", "admitted", "blocked", "expired", "revoked", "unknown"]);
const EVIDENCE_STATES = new Set(["missing", "received", "bound", "validated", "stale", "conflicting", "rejected", "unknown"]);
const VERIFICATION_PRECEDENCE = ["conflicting", "rejected", "stale", "missing", "bound", "received", "validated"];

const refuse = () => { throw Error(REFUSAL); };

function own(value, allowed, required = [], plainObject = false) {
  if (types.isProxy(value) || value === null || typeof value !== "object" || Array.isArray(value) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(value))) refuse();
  const keys = Reflect.ownKeys(value);
  if (keys.length > allowed.length || keys.some(key => typeof key !== "string" || !allowed.includes(key))) refuse();
  const result = plainObject ? {} : Object.create(null);
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !Object.hasOwn(descriptor, "value") || descriptor.value === undefined) refuse();
    result[key] = descriptor.value;
  }
  for (const key of required) if (!Object.hasOwn(result, key)) refuse();
  return result;
}

function list(value, min, max, map = item => item) {
  if (types.isProxy(value) || !Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype ||
      value.length < min || value.length > max || Reflect.ownKeys(value).length !== value.length + 1) refuse();
  const result = [];
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor || !Object.hasOwn(descriptor, "value")) refuse();
    result.push(map(descriptor.value));
  }
  return result;
}

function label(value) {
  if (typeof value !== "string" || !LABEL.test(value) || hasKnownCredential(value)) refuse();
  return value;
}

function sourceSha(value) {
  if (typeof value !== "string" || !SHA.test(value)) refuse();
  return value;
}

function count(value) {
  if (!Number.isSafeInteger(value) || value < 0) refuse();
  return value;
}

function number(value) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) refuse();
  return value;
}

function snapshotStringList(value, max = 128) {
  return list(value, 0, max, item => label(item));
}

function snapshotUniqueStringList(value, max = 128) {
  const result = snapshotStringList(value, max);
  if (new Set(result).size !== result.length) refuse();
  return result;
}

function snapshotRun(value) {
  const run = own(value, RUN_KEYS, RUN_REQUIRED);
  run.effect_ids = snapshotUniqueStringList(run.effect_ids);
  run.evidence_ids = snapshotUniqueStringList(run.evidence_ids);
  run.next_action = snapshotNext(run.next_action);
  if (run.source_sha !== undefined) run.source_sha = sourceSha(run.source_sha);
  if (run.head_sha !== undefined) run.head_sha = sourceSha(run.head_sha);
  if (!isGovernanceRunRecord(run)) refuse();
  return run;
}

function snapshotEffect(value) {
  const effect = own(value, EFFECT_KEYS, EFFECT_REQUIRED);
  if (effect.duplicate_of !== undefined && effect.duplicate_of !== null) effect.duplicate_of = label(effect.duplicate_of);
  if (!isGovernanceEffectRecord(effect)) refuse();
  return effect;
}

function snapshotEvidence(value) {
  const evidence = own(value, EVIDENCE_KEYS, EVIDENCE_REQUIRED);
  evidence.claims = snapshotStringList(evidence.claims);
  evidence.counterevidence_refs = snapshotStringList(evidence.counterevidence_refs);
  if (evidence.source_sha !== undefined) evidence.source_sha = sourceSha(evidence.source_sha);
  if (!isGovernanceEvidenceRecord(evidence)) refuse();
  return evidence;
}

function snapshotIdentity(value) {
  return own(value, IDENTITY_KEYS, ["run_id"]);
}

function snapshotProvenance(value) {
  const provenance = own(value, PROVENANCE_KEYS, ["protocol_version"]);
  if (provenance.source_sha !== undefined) provenance.source_sha = sourceSha(provenance.source_sha);
  if (provenance.head_sha !== undefined) provenance.head_sha = sourceSha(provenance.head_sha);
  return provenance;
}

function snapshotAction(value) {
  return own(value, ACTION_KEYS, ACTION_REQUIRED);
}

function snapshotStatus(value) {
  return own(value, STATUS_KEYS, STATUS_REQUIRED);
}

function snapshotNext(value) {
  return own(value, NEXT_KEYS, NEXT_REQUIRED);
}

function snapshotReceipt(value) {
  const receipt = own(value, RECEIPT_KEYS, RECEIPT_REQUIRED);
  receipt.identity = snapshotIdentity(receipt.identity);
  receipt.provenance = snapshotProvenance(receipt.provenance);
  receipt.status = snapshotStatus(receipt.status);
  receipt.redaction = own(receipt.redaction, REDACTION_KEYS, REDACTION_KEYS);
  if (receipt.action !== undefined) receipt.action = snapshotAction(receipt.action);
  if (receipt.next !== undefined) receipt.next = snapshotNext(receipt.next);
  if (receipt.evidence !== undefined) receipt.evidence = list(receipt.evidence, 0, 32, snapshotEvidenceRef);
  if (receipt.resource !== undefined) receipt.resource = own(receipt.resource, RESOURCE_KEYS);
  if (!isGovernanceReceipt(receipt)) refuse();
  return receipt;
}

function snapshotEvidenceRef(value) {
  return own(value, ["evidence_id", "kind", "ref", "content_digest", "state", "validator", "validator_revision", "observed_at", "fresh_until"], ["evidence_id", "kind", "ref", "state", "observed_at"]);
}

function snapshotHandoff(value) {
  const handoff = own(value, HANDOFF_KEYS, HANDOFF_REQUIRED, true);
  handoff.accepted_facts = snapshotStringList(handoff.accepted_facts);
  handoff.unresolved_effects = snapshotStringList(handoff.unresolved_effects);
  handoff.blockers = snapshotStringList(handoff.blockers);
  handoff.successor_constraints = own(handoff.successor_constraints, ["must_read_current_head", "must_not_replay_unknown_effect", "must_not_change_model_silently"], ["must_read_current_head", "must_not_replay_unknown_effect", "must_not_change_model_silently"], true);
  if (!isGovernanceHandoff(handoff)) refuse();
  return handoff;
}

function snapshotMeasurements(value) {
  const measurements = own(value, MEASUREMENT_KEYS);
  for (const key of ["latency_ms", "estimated_cost"]) if (measurements[key] !== undefined && measurements[key] !== null) measurements[key] = number(measurements[key]);
  for (const key of ["human_interventions", "rework_count", "context_tokens", "input_tokens", "output_tokens", "total_tokens"]) {
    if (measurements[key] !== undefined && measurements[key] !== null) measurements[key] = count(measurements[key]);
  }
  return measurements;
}

function snapshotInput(value) {
  const input = own(value, ["schema", "task_id", "arm", "run", "receipt", "effects", "evidence", "handoff", "measurements"], ["schema", "task_id", "arm", "run"]);
  if (input.schema !== INPUT_SCHEMA || !ARMS.includes(input.arm)) refuse();
  label(input.task_id);
  if (!TASK_IDS.has(input.task_id)) refuse();
  input.run = snapshotRun(input.run);
  if (input.receipt !== undefined) input.receipt = snapshotReceipt(input.receipt);
  if (input.effects !== undefined) input.effects = list(input.effects, 0, 64, snapshotEffect);
  if (input.evidence !== undefined) input.evidence = list(input.evidence, 0, 64, snapshotEvidence);
  if (input.handoff !== undefined) input.handoff = snapshotHandoff(input.handoff);
  if (input.measurements !== undefined) input.measurements = snapshotMeasurements(input.measurements);
  return input;
}

function resolveBinding(values) {
  const present = values.filter(value => value !== undefined);
  for (const value of present) sourceSha(value);
  const unique = [...new Set(present)];
  if (unique.length > 1) refuse();
  const sha = unique[0] ?? null;
  return Object.freeze({ status: sha === null ? "unknown" : "observed", sha });
}

function outputMeasurements(measurements, resource, duplicateEffectCount) {
  const explicit = measurements ?? Object.create(null);
  const read = (key, resourceKey = key) => {
    const measured = explicit[key];
    const resourceValue = resource?.[resourceKey];
    if (measured !== undefined && resourceValue !== undefined && measured !== resourceValue) refuse();
    return measured ?? resourceValue ?? null;
  };
  const estimatedCost = read("estimated_cost");
  return Object.freeze({
    latency_ms: read("latency_ms"),
    human_interventions: read("human_interventions"),
    rework_count: read("rework_count"),
    duplicate_effect_count: duplicateEffectCount,
    context_tokens: read("context_tokens"),
    input_tokens: read("input_tokens", "input_tokens"),
    output_tokens: read("output_tokens", "output_tokens"),
    total_tokens: read("total_tokens"),
    estimated_cost: estimatedCost,
    cost_status: estimatedCost === null ? "unknown" : "provided-estimate",
  });
}

function verificationState(evidence) {
  if (evidence === undefined || evidence.length === 0) return Object.freeze({ status: "unknown", evidence_count: 0, validated_count: 0 });
  const states = new Set(evidence.map(item => item.state));
  const status = VERIFICATION_PRECEDENCE.find(item => states.has(item)) ?? "unknown";
  return Object.freeze({ status, evidence_count: evidence.length, validated_count: evidence.filter(item => item.state === "validated").length });
}

function assertBindings(input) {
  const run = input.run;
  if (input.receipt !== undefined) {
    if (input.receipt.identity.run_id !== run.run_id || input.receipt.status.run !== run.status ||
        input.receipt.status.execution_outcome !== run.execution_outcome || input.receipt.status.business_outcome !== run.business_outcome ||
        input.receipt.status.delivery_outcome !== run.delivery_outcome || input.receipt.status.permission_outcome !== run.permission_outcome) refuse();
  }
  const effects = input.effects;
  if (effects !== undefined) {
    const effectIds = new Set();
    for (const effect of effects) {
      if (effect.run_id !== run.run_id || effectIds.has(effect.effect_id) || !run.effect_ids.includes(effect.effect_id) || effect.duplicate_of === effect.effect_id) refuse();
      effectIds.add(effect.effect_id);
    }
    for (const effect of effects) if (effect.duplicate_of !== undefined && effect.duplicate_of !== null && !effectIds.has(effect.duplicate_of)) refuse();
  }
  const evidence = input.evidence;
  if (evidence !== undefined) {
    const evidenceIds = new Set();
    for (const item of evidence) {
      if (item.run_id !== run.run_id || evidenceIds.has(item.evidence_id) || !run.evidence_ids.includes(item.evidence_id)) refuse();
      evidenceIds.add(item.evidence_id);
    }
  }
  if (input.receipt?.identity.effect_id !== undefined && !run.effect_ids.includes(input.receipt.identity.effect_id)) refuse();
  if (input.handoff !== undefined) {
    if (input.handoff.run_id !== run.run_id) refuse();
    if (input.handoff.unresolved_effects.some(effectId => !run.effect_ids.includes(effectId))) refuse();
  }
}

function project(value) {
  const input = snapshotInput(value);
  assertBindings(input);
  const { run, receipt, effects, evidence, handoff, measurements } = input;
  const source = resolveBinding([run.source_sha, receipt?.provenance.source_sha, ...(evidence ?? []).map(item => item.source_sha)]);
  const head = resolveBinding([run.head_sha, receipt?.provenance.head_sha]);
  const verification = verificationState(evidence);
  const duplicateEffectCount = effects === undefined ? null : effects.filter(effect => effect.duplicate_of !== undefined && effect.duplicate_of !== null).length;
  const outcome = { run: run.status, execution: run.execution_outcome, business: run.business_outcome, delivery: run.delivery_outcome, permission: run.permission_outcome };
  const effectUnknown = effects === undefined
    ? run.effect_ids.length > 0
    : effects.length < run.effect_ids.length || effects.some(effect => effect.state === "unknown");
  const evidenceIncomplete = evidence === undefined ? run.evidence_ids.length > 0 : evidence.length < run.evidence_ids.length;
  const unresolvedStatus = !["settled", "closed", "failed", "cancelled"].includes(run.status) ||
    !["settled", "failed"].includes(run.execution_outcome) ||
    !["completed", "failed", "blocked", "cancelled"].includes(run.business_outcome) ||
    !["delivered", "failed"].includes(run.delivery_outcome) ||
    !["admitted", "blocked", "expired", "revoked"].includes(run.permission_outcome);
  const reconcileRequired = unresolvedStatus || run.status === "unknown" ||
    run.next_action.action === "reconcile" || handoff?.next_action === "reconcile" || (handoff?.unresolved_effects.length ?? 0) > 0 ||
    effectUnknown || evidenceIncomplete || effects?.some(effect => effect.reconciliation_required || effect.state === "unknown" || effect.state === "reconciling" || effect.conflict) === true ||
    verification.status !== "validated";
  const incomplete = source.status === "unknown" || head.status === "unknown" || verification.status !== "validated" || effectUnknown || evidenceIncomplete || unresolvedStatus;
  const failure = run.status === "failed" || run.status === "cancelled" || run.execution_outcome === "failed" || run.business_outcome === "failed" ||
    run.business_outcome === "blocked" || run.business_outcome === "cancelled" || run.delivery_outcome === "failed" ||
    ["blocked", "expired", "revoked"].includes(run.permission_outcome);
  const outcomeStatus = incomplete || reconcileRequired ? "unknown" : failure ? "fail" : "pass";
  const unknown = outcomeStatus === "unknown";
  const artifact = {
    schema: ARTIFACT_SCHEMA,
    task_id: input.task_id,
    run_id: run.run_id,
    arm: input.arm,
    source,
    head,
    outcome: { status: outcomeStatus, ...outcome },
    verification: SAFETY.verification,
    verification_state: verification,
    metrics: outputMeasurements(measurements, receipt?.resource, duplicateEffectCount),
    unknown,
    reconcile_required: reconcileRequired,
    observation: SAFETY.observation,
    authorization: SAFETY.authorization,
    executable: SAFETY.executable,
    read_only: SAFETY.read_only,
  };

  return validateNativeEnhancedEvaluationArtifact(artifact);
}

function snapshotArtifact(value) {
  const artifact = own(value, ARTIFACT_KEYS, ARTIFACT_KEYS);
  artifact.source = own(artifact.source, BINDING_KEYS, BINDING_KEYS);
  artifact.head = own(artifact.head, BINDING_KEYS, BINDING_KEYS);
  artifact.outcome = own(artifact.outcome, OUTCOME_KEYS, OUTCOME_KEYS);
  artifact.verification_state = own(artifact.verification_state, VERIFICATION_KEYS, VERIFICATION_KEYS);
  artifact.metrics = own(artifact.metrics, METRIC_OUTPUT_KEYS, METRIC_OUTPUT_KEYS);
  return artifact;
}

function validateBinding(value) {
  if (![("observed"), "unknown"].includes(value.status)) refuse();
  if (value.status === "unknown") { if (value.sha !== null) refuse(); }
  else sourceSha(value.sha);
  return Object.freeze({ status: value.status, sha: value.sha });
}

function validateOutcome(value) {
  if (!OUTCOME_STATUSES.has(value.status) || !RUN_STATUSES.has(value.run) || !EXECUTION_OUTCOMES.has(value.execution) || !BUSINESS_OUTCOMES.has(value.business) ||
      !DELIVERY_OUTCOMES.has(value.delivery) || !PERMISSION_OUTCOMES.has(value.permission)) refuse();
  return Object.freeze({ ...value });
}

function validateVerification(value) {
  if (!EVIDENCE_STATES.has(value.status)) refuse();
  count(value.evidence_count); count(value.validated_count);
  if (value.validated_count > value.evidence_count || value.status === "validated" && value.validated_count !== value.evidence_count) refuse();
  return Object.freeze({ ...value });
}

function validateMetrics(value) {
  for (const key of ["latency_ms", "estimated_cost"]) if (value[key] !== null) number(value[key]);
  for (const key of ["human_interventions", "rework_count", "context_tokens", "input_tokens", "output_tokens", "total_tokens", "duplicate_effect_count"]) if (value[key] !== null) count(value[key]);
  if (!["unknown", "provided-estimate"].includes(value.cost_status) || (value.cost_status === "unknown" ? value.estimated_cost !== null : value.estimated_cost === null)) refuse();
  return Object.freeze({ ...value });
}

/** Validate a detached versioned artifact without reading providers or starting execution. */
export function validateNativeEnhancedEvaluationArtifact(value) {
  try {
    const artifact = snapshotArtifact(value);
    if (artifact.schema !== ARTIFACT_SCHEMA || !ARMS.includes(artifact.arm)) refuse();
    label(artifact.task_id); label(artifact.run_id);
    const source = validateBinding(artifact.source), head = validateBinding(artifact.head);
    const outcome = validateOutcome(artifact.outcome), verificationStateValue = validateVerification(artifact.verification_state), metrics = validateMetrics(artifact.metrics);
    if (typeof artifact.unknown !== "boolean" || typeof artifact.reconcile_required !== "boolean" ||
        artifact.observation !== SAFETY.observation || artifact.verification !== SAFETY.verification ||
        artifact.authorization !== SAFETY.authorization || artifact.executable !== SAFETY.executable || artifact.read_only !== SAFETY.read_only) refuse();
    const incomplete = source.status === "unknown" || head.status === "unknown" || verificationStateValue.status !== "validated" ||
      Object.values(outcome).some(item => item === "unknown" || item === "not_known" || item === "not_started" || item === "not_checked");
    const failure = outcome.run === "failed" || outcome.run === "cancelled" || outcome.execution === "failed" || outcome.business === "failed" ||
      outcome.business === "blocked" || outcome.business === "cancelled" || outcome.delivery === "failed" ||
      ["blocked", "expired", "revoked"].includes(outcome.permission);
    const expectedStatus = incomplete || artifact.reconcile_required ? "unknown" : failure ? "fail" : "pass";
    if (outcome.status !== expectedStatus || artifact.unknown !== (expectedStatus === "unknown") ||
        artifact.reconcile_required !== (expectedStatus === "unknown")) refuse();
    return Object.freeze({ ...artifact, source, head, outcome, verification_state: verificationStateValue, metrics });
  } catch { throw Error(REFUSAL); }
}

/** Return false for any malformed or non-contract artifact without exposing details. */
export function isNativeEnhancedEvaluationArtifact(value) {
  try { validateNativeEnhancedEvaluationArtifact(value); return true; } catch { return false; }
}

/** Project existing governance records and supplied safe metrics into a read-only artifact. */
export function projectNativeEnhancedEvaluation(value) {
  try { return project(value); } catch { throw Error(REFUSAL); }
}
