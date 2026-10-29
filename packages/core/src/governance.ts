import type {
  GovernanceAction,
  GovernanceActionKind,
  GovernanceBusinessOutcome,
  GovernanceDeliveryOutcome,
  GovernanceEffectStatus,
  GovernanceEvidenceKind,
  GovernanceEvidenceRef,
  GovernanceEvidenceStatus,
  GovernanceEventKind,
  GovernanceExecutionOutcome,
  GovernanceEvidenceRecord,
  GovernanceEffectRecord,
  GovernanceNext,
  GovernancePermissionOutcome,
  GovernanceReceipt,
  GovernanceRunRecord,
  GovernanceRunStatus,
  GovernanceSource,
} from "@pi-vista/protocol";
import {
  canTransitionEffect,
  canTransitionEvidence,
  canTransitionRun,
  GOVERNANCE_EFFECT_STATUSES,
  GOVERNANCE_EVIDENCE_STATUSES,
  GOVERNANCE_RUN_STATUSES,
  PI_GOVERNANCE_RECEIPT_SCHEMA,
} from "@pi-vista/protocol";
import { hasKnownCredential } from "./credential.js";
import { isSafeSegment } from "./path-safe.js";
import { VistaProtocolError } from "./validation.js";

const SOURCES = new Set<GovernanceSource>([
  "pi", "subagents", "intercom", "schedule", "vista", "ai-gate", "workspace-guard", "provider", "business",
]);
const EVENT_KINDS = new Set<GovernanceEventKind>([
  "run.created", "run.admitted", "run.started", "run.waiting", "run.recovering", "run.settled", "run.closed", "run.failed", "run.cancelled", "run.unknown",
  "effect.planned", "effect.admitted", "effect.dispatched", "effect.started", "effect.observed", "effect.settled", "effect.failed", "effect.unknown", "effect.cancel_requested", "effect.cancelled", "effect.reconciling", "effect.reconciled",
  "evidence.received", "evidence.bound", "evidence.validated", "evidence.stale", "evidence.conflict", "evidence.rejected",
  "message.delivery", "message.received", "message.wake_requested", "message.started", "message.outcome_known", "business.completed", "business.unknown",
]);
const ACTION_KINDS = new Set<GovernanceActionKind>(["tool", "message", "wake", "schedule", "merge", "task", "provider_call", "artifact_write"]);
const EVIDENCE_KINDS = new Set<GovernanceEvidenceKind>(["provider_receipt", "readback", "test", "ci", "merge", "artifact", "reconcile"]);
const EXECUTION_OUTCOMES = new Set<GovernanceExecutionOutcome>(["not_started", "running", "settled", "failed", "unknown"]);
const BUSINESS_OUTCOMES = new Set<GovernanceBusinessOutcome>(["not_known", "progress", "completed", "failed", "blocked", "cancelled", "unknown"]);
const DELIVERY_OUTCOMES = new Set<GovernanceDeliveryOutcome>(["not_requested", "preparing", "available", "delivered", "failed", "unknown"]);
const PERMISSION_OUTCOMES = new Set<GovernancePermissionOutcome>(["not_checked", "admitted", "blocked", "expired", "revoked", "unknown"]);
const EFFECT_EVENTS = new Set<GovernanceEventKind>([
  "effect.planned", "effect.admitted", "effect.dispatched", "effect.started", "effect.observed", "effect.settled", "effect.failed", "effect.unknown", "effect.cancel_requested", "effect.cancelled", "effect.reconciling", "effect.reconciled",
]);
const RUN_ONLY_EVENTS = new Set<GovernanceEventKind>([
  "run.created", "run.admitted", "run.started", "run.waiting", "run.recovering", "run.settled", "run.closed", "run.failed", "run.cancelled", "run.unknown",
]);
const NEXT_ACTIONS = new Set<GovernanceNext["action"]>(["reconcile", "continue", "wait", "close", "handoff", "none"]);
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f\u0080-\u009f]/u;
const RAW_PATH_PATTERN = /(?:^|[\\/])(?:Users|home|private|var|tmp|etc|opt|workspace|src)(?:[\\/]|$)|^[A-Za-z]:[\\/]/u;
const SHELL_PATTERN = /(?:&&|\|\||[;`$<>]|\r?\n)/u;
const CREDENTIAL_URL_PATTERN = /:\/\/[^/\s:]+:[^@/\s]+@/u;
const RAW_METADATA_PATTERN = /(?:^|[^a-z0-9])(?:args?|argv|command|completion|content|cwd|directory|file(?:name|path)?|input|model|output|path|prompt|raw|request|response|secret|shell|stderr|stdin|stdout|token|credential|password)(?:$|[^a-z0-9])/iu;

function isSafeMetadataText(value: unknown, maxLength = 256, rejectRawMetadata = true): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= maxLength &&
    !hasKnownCredential(value) &&
    !CONTROL_CHARACTER_PATTERN.test(value) &&
    !RAW_PATH_PATTERN.test(value) &&
    !SHELL_PATTERN.test(value) &&
    !CREDENTIAL_URL_PATTERN.test(value) &&
    (!rejectRawMetadata || !RAW_METADATA_PATTERN.test(value))
  );
}

function isSafeId(value: unknown): value is string {
  return typeof value === "string" && isSafeSegment(value) && !hasKnownCredential(value);
}

function isFiniteNonNegative(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function isTimestamp(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function isSafeStringArray(value: unknown, maxLength = 64): value is readonly string[] {
  return Array.isArray(value) && value.length <= maxLength && value.every((item) => isSafeMetadataText(item));
}

function isValidEvidenceRef(value: unknown): value is GovernanceEvidenceRef {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const item = value as Record<string, unknown>;
  return (
    isSafeId(item.evidence_id) &&
    typeof item.kind === "string" && EVIDENCE_KINDS.has(item.kind as GovernanceEvidenceKind) &&
    isSafeMetadataText(item.ref) &&
    (item.content_digest === undefined || isSafeMetadataText(item.content_digest, 128)) &&
    typeof item.state === "string" && GOVERNANCE_EVIDENCE_STATUSES.includes(item.state as GovernanceEvidenceStatus) &&
    (item.validator === undefined || isSafeMetadataText(item.validator)) &&
    (item.validator_revision === undefined || isSafeMetadataText(item.validator_revision)) &&
    isTimestamp(item.observed_at) &&
    (item.fresh_until === undefined || item.fresh_until === null || isTimestamp(item.fresh_until))
  );
}

function isValidAction(value: unknown): value is GovernanceAction {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const action = value as Record<string, unknown>;
  return (
    typeof action.kind === "string" && ACTION_KINDS.has(action.kind as GovernanceActionKind) &&
    isSafeMetadataText(action.target_kind) &&
    (action.target_ref === undefined || isSafeMetadataText(action.target_ref)) &&
    (action.effect_key === undefined || isSafeId(action.effect_key)) &&
    (action.input_digest === undefined || isSafeMetadataText(action.input_digest, 128)) &&
    (action.write_scope_digest === undefined || isSafeMetadataText(action.write_scope_digest, 128))
  );
}

function isValidStatus(value: unknown): boolean {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const status = value as Record<string, unknown>;
  return (
    typeof status.run === "string" && GOVERNANCE_RUN_STATUSES.includes(status.run as GovernanceRunStatus) &&
    (status.effect === undefined || (typeof status.effect === "string" && GOVERNANCE_EFFECT_STATUSES.includes(status.effect as GovernanceEffectStatus))) &&
    typeof status.execution_outcome === "string" && EXECUTION_OUTCOMES.has(status.execution_outcome as GovernanceExecutionOutcome) &&
    typeof status.business_outcome === "string" && BUSINESS_OUTCOMES.has(status.business_outcome as GovernanceBusinessOutcome) &&
    typeof status.delivery_outcome === "string" && DELIVERY_OUTCOMES.has(status.delivery_outcome as GovernanceDeliveryOutcome) &&
    typeof status.permission_outcome === "string" && PERMISSION_OUTCOMES.has(status.permission_outcome as GovernancePermissionOutcome) &&
    (status.reason_code === undefined || isSafeId(status.reason_code)) &&
    (status.unknown_reason === undefined || isSafeId(status.unknown_reason))
  );
}

function isValidProvenance(value: unknown): boolean {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const provenance = value as Record<string, unknown>;
  const optional = ["source_sha", "head_sha", "runtime_id", "extension_set_digest", "broker_epoch", "model_provider", "model_id", "policy_version"];
  return optional.every((key) => provenance[key] === undefined || isSafeMetadataText(provenance[key], 256, false)) &&
    isSafeMetadataText(provenance.protocol_version, 256, false);
}

function isValidNext(value: unknown): value is GovernanceNext {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const next = value as Record<string, unknown>;
  return (
    typeof next.action === "string" && NEXT_ACTIONS.has(next.action as GovernanceNext["action"]) &&
    (next.waiting_reason === undefined || next.waiting_reason === null || isSafeMetadataText(next.waiting_reason)) &&
    (next.scheduler_hint === undefined || next.scheduler_hint === null || isSafeMetadataText(next.scheduler_hint)) &&
    (next.stop_condition === undefined || next.stop_condition === null || isSafeMetadataText(next.stop_condition))
  );
}

function isSafeIdArray(value: unknown, maxLength = 128): value is readonly string[] {
  return Array.isArray(value) && value.length <= maxLength && value.every((item) => isSafeId(item));
}

function isValidRedaction(value: unknown): boolean {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const redaction = value as Record<string, unknown>;
  return (
    isSafeMetadataText(redaction.profile) &&
    redaction.raw_content_included === false &&
    redaction.credentials_included === false &&
    redaction.private_path_included === false
  );
}

export function isGovernanceEventKind(value: unknown): value is GovernanceEventKind {
  return typeof value === "string" && EVENT_KINDS.has(value as GovernanceEventKind);
}

export function isGovernanceReceipt(value: unknown): value is GovernanceReceipt {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const receipt = value as Record<string, unknown>;
  if (
    receipt.receipt_schema !== PI_GOVERNANCE_RECEIPT_SCHEMA ||
    !isSafeId(receipt.receipt_id) ||
    !isGovernanceEventKind(receipt.event_kind) ||
    !isTimestamp(receipt.emitted_at) ||
    typeof receipt.source !== "string" ||
    !SOURCES.has(receipt.source as GovernanceSource) ||
    (receipt.sequence !== undefined && (!Number.isInteger(receipt.sequence) || (receipt.sequence as number) < 0)) ||
    (receipt.parent_receipt_id !== undefined && !isSafeId(receipt.parent_receipt_id))
  ) {
    return false;
  }

  const identity = receipt.identity;
  if (identity === null || typeof identity !== "object" || Array.isArray(identity)) {
    return false;
  }
  const identityRecord = identity as Record<string, unknown>;
  const identityKeys = ["goal_id", "run_id", "turn_id", "effect_id", "attempt_id", "session_id", "message_id"];
  if (!identityKeys.every((key) => identityRecord[key] === undefined || isSafeId(identityRecord[key])) || !isSafeId(identityRecord.run_id)) {
    return false;
  }
  if (EFFECT_EVENTS.has(receipt.event_kind) && (!isSafeId(identityRecord.effect_id) || !isValidAction(receipt.action))) {
    return false;
  }
  if (!RUN_ONLY_EVENTS.has(receipt.event_kind) && receipt.action !== undefined && !isValidAction(receipt.action)) {
    return false;
  }
  if (!isValidProvenance(receipt.provenance) || !isValidStatus(receipt.status) || !isValidRedaction(receipt.redaction)) {
    return false;
  }
  if (receipt.evidence !== undefined && (!Array.isArray(receipt.evidence) || receipt.evidence.length > 32 || !receipt.evidence.every(isValidEvidenceRef))) {
    return false;
  }
  if (receipt.resource !== undefined) {
    if (receipt.resource === null || typeof receipt.resource !== "object" || Array.isArray(receipt.resource)) {
      return false;
    }
    const resource = receipt.resource as Record<string, unknown>;
    if (resource.quota_class !== undefined && !isSafeId(resource.quota_class)) return false;
    for (const key of ["estimated_cost", "actual_cost", "input_tokens", "output_tokens"]) {
      if (resource[key] !== undefined && resource[key] !== null && !isFiniteNonNegative(resource[key])) return false;
    }
  }
  if (receipt.next !== undefined && !isValidNext(receipt.next)) {
    return false;
  }
  return true;
}

export function isGovernanceRunRecord(value: unknown): value is GovernanceRunRecord {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const run = value as Record<string, unknown>;
  return (
    isSafeId(run.run_id) &&
    (run.goal_id === undefined || isSafeId(run.goal_id)) &&
    Number.isInteger(run.run_revision) && (run.run_revision as number) >= 0 &&
    typeof run.status === "string" && GOVERNANCE_RUN_STATUSES.includes(run.status as GovernanceRunStatus) &&
    typeof run.execution_outcome === "string" && EXECUTION_OUTCOMES.has(run.execution_outcome as GovernanceExecutionOutcome) &&
    typeof run.business_outcome === "string" && BUSINESS_OUTCOMES.has(run.business_outcome as GovernanceBusinessOutcome) &&
    typeof run.delivery_outcome === "string" && DELIVERY_OUTCOMES.has(run.delivery_outcome as GovernanceDeliveryOutcome) &&
    typeof run.permission_outcome === "string" && PERMISSION_OUTCOMES.has(run.permission_outcome as GovernancePermissionOutcome) &&
    (run.owner === undefined || isSafeMetadataText(run.owner)) &&
    (run.policy_version === undefined || isSafeMetadataText(run.policy_version)) &&
    (run.session_id === undefined || isSafeId(run.session_id)) &&
    (run.session_epoch === undefined || isSafeMetadataText(run.session_epoch)) &&
    (run.runtime_id === undefined || isSafeMetadataText(run.runtime_id)) &&
    isSafeIdArray(run.effect_ids) &&
    isSafeIdArray(run.evidence_ids) &&
    isValidNext(run.next_action) &&
    (run.source_sha === undefined || isSafeMetadataText(run.source_sha, 128)) &&
    (run.head_sha === undefined || isSafeMetadataText(run.head_sha, 128)) &&
    (run.config_digest === undefined || isSafeMetadataText(run.config_digest, 128))
  );
}

export function isGovernanceEffectRecord(value: unknown): value is GovernanceEffectRecord {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const effect = value as Record<string, unknown>;
  return (
    isSafeId(effect.effect_id) &&
    isSafeId(effect.run_id) &&
    isSafeId(effect.effect_key) &&
    typeof effect.kind === "string" && ACTION_KINDS.has(effect.kind as GovernanceActionKind) &&
    isSafeMetadataText(effect.target_kind) &&
    (effect.target_ref === undefined || isSafeMetadataText(effect.target_ref)) &&
    (effect.scope_digest === undefined || isSafeMetadataText(effect.scope_digest, 128)) &&
    typeof effect.state === "string" && GOVERNANCE_EFFECT_STATUSES.includes(effect.state as GovernanceEffectStatus) &&
    Number.isInteger(effect.attempt_count) && (effect.attempt_count as number) >= 0 &&
    (effect.dispatch_receipt_id === undefined || isSafeId(effect.dispatch_receipt_id)) &&
    (effect.last_observed_receipt_id === undefined || isSafeId(effect.last_observed_receipt_id)) &&
    (effect.unknown_reason === undefined || isSafeId(effect.unknown_reason)) &&
    typeof effect.reconciliation_required === "boolean" &&
    (effect.last_reconciled_at === undefined || effect.last_reconciled_at === null || isTimestamp(effect.last_reconciled_at)) &&
    (effect.duplicate_of === undefined || effect.duplicate_of === null || isSafeId(effect.duplicate_of)) &&
    typeof effect.conflict === "boolean"
  );
}

export function isGovernanceEvidenceRecord(value: unknown): value is GovernanceEvidenceRecord {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const evidence = value as Record<string, unknown>;
  return (
    isSafeId(evidence.evidence_id) &&
    isSafeId(evidence.run_id) &&
    (evidence.effect_id === undefined || isSafeId(evidence.effect_id)) &&
    typeof evidence.kind === "string" && EVIDENCE_KINDS.has(evidence.kind as GovernanceEvidenceKind) &&
    typeof evidence.state === "string" && GOVERNANCE_EVIDENCE_STATUSES.includes(evidence.state as GovernanceEvidenceStatus) &&
    (evidence.authority === undefined || isSafeMetadataText(evidence.authority)) &&
    isSafeMetadataText(evidence.source_ref) &&
    (evidence.source_sha === undefined || isSafeMetadataText(evidence.source_sha, 128)) &&
    (evidence.content_digest === undefined || isSafeMetadataText(evidence.content_digest, 128)) &&
    isSafeStringArray(evidence.claims) &&
    (evidence.validator === undefined || isSafeMetadataText(evidence.validator)) &&
    (evidence.validator_revision === undefined || isSafeMetadataText(evidence.validator_revision)) &&
    isTimestamp(evidence.observed_at) &&
    (evidence.fresh_until === undefined || evidence.fresh_until === null || isTimestamp(evidence.fresh_until)) &&
    isSafeIdArray(evidence.counterevidence_refs) &&
    isSafeMetadataText(evidence.redaction_profile)
  );
}

export function assertGovernanceReceipt(value: unknown): asserts value is GovernanceReceipt {
  if (!isGovernanceReceipt(value)) {
    throw new VistaProtocolError("invalid Pi governance receipt");
  }
}

export { canTransitionEffect, canTransitionEvidence, canTransitionRun };
