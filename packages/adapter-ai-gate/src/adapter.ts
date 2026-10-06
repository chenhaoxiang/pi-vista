import process from "node:process";
import { isDeepStrictEqual, types as utilTypes } from "node:util";
import {
  emitVistaEvent,
  generateRunId,
  isSafeSegment,
  redactAll,
  VistaProtocolError,
  type VistaEvent,
  type VistaEventInput,
  type VistaResult,
} from "@pi-vista/core";
import { isVistaStepIdForRun } from "@pi-vista/core/validation";
import type { ArtifactRef } from "@pi-vista/protocol";
import type { AiGateEmitOptions, AiGateEvidence, AiGateStatus } from "./types.js";

const EVIDENCE_FIELDS = new Set([
  "run_id", "session_id", "trace_id", "repo", "source_sha",
  "action", "check_type", "result", "status", "decision", "verdict", "reason_code",
  "head_sha", "review_hash", "escalation_hash", "receipt_ref", "artifact_ref",
  "lane", "tier", "reviewer_id", "model_id", "passed", "required",
]);
const EMIT_OPTION_FIELDS = new Set([
  "store", "baseDir", "runId", "stepId", "seq", "now", "clock", "persistTimeoutMs",
]);
const RESULTS = new Set<VistaResult>(["ok", "blocked", "failed", "unknown", "abstain"]);
const STATUS_RESULTS: Readonly<Record<AiGateStatus, VistaResult>> = {
  pending: "unknown",
  success: "ok",
  failure: "failed",
  cancelled: "failed",
  skipped: "unknown",
  neutral: "unknown",
};

const ACTION_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const CODE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/u;
const MODEL_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:@+-]*(?:\/[A-Za-z0-9][A-Za-z0-9._:@+-]*)*$/u;
const SHA_PATTERN = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/iu;
const OPAQUE_REF_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,255}$/u;
const CREDENTIAL_LABEL_PATTERN = /(?:^|[./_:@+-])(?:secret|token|bearer|password|passwd|api[_-]?key|access[_-]?key|auth|credential|cookie|private[_-]?key|ssh[_-]?key)(?:$|[./_:@+-])/iu;
// Retained strings are stricter than core's generic redaction: a credential
// can be hidden behind an otherwise safe-looking prefix, including in IDs and
// action/model metadata. These signatures deliberately match when embedded.
const EMBEDDED_TOKEN_PATTERN = /(?:github_pat_[A-Za-z0-9_]{8,}|gh[pousr]_[A-Za-z0-9_]{8,}|sk-[A-Za-z0-9_-]{8,}|xox[baprs]-[A-Za-z0-9-]{8,}|eyJ[A-Za-z0-9_-]{10,})/iu;

type EvidenceSnapshot = ReadonlyMap<string, unknown>;
type EmitOptionsSnapshot = ReadonlyMap<string, unknown>;
type OwnerOutcome =
  | { result: VistaResult; metadataKey: "owner_result"; metadataValue: VistaResult }
  | { result: VistaResult; metadataKey: "owner_status"; metadataValue: AiGateStatus };

let generatedImplicitRunId: string | undefined;

function invalid(message: string): never {
  throw new VistaProtocolError(`ai-gate evidence ${message}`);
}

/** Reject executable boundaries before taking one detached own-data snapshot. */
function snapshotEvidence(evidence: unknown): EvidenceSnapshot {
  if (evidence === null || typeof evidence !== "object" || utilTypes.isProxy(evidence) || Array.isArray(evidence)) {
    invalid("must be a plain data object, not a Proxy");
  }
  const prototype: unknown = Object.getPrototypeOf(evidence);
  if (prototype !== Object.prototype && prototype !== null) {
    invalid("must not have a custom prototype");
  }

  const descriptors = Object.getOwnPropertyDescriptors(evidence);
  const snapshot = new Map<string, unknown>();
  for (const key of Reflect.ownKeys(descriptors)) {
    if (typeof key !== "string" || !EVIDENCE_FIELDS.has(key)) {
      // Unknown names can themselves contain credentials or raw content.
      invalid("contains an unsupported field; only sanitized evidence fields are allowed");
    }
    const descriptor = descriptors[key];
    if (descriptor === undefined || !Object.hasOwn(descriptor, "value")) {
      invalid("fields must be data fields, not accessors");
    }
    snapshot.set(key, descriptor.value);
  }
  return snapshot;
}

function snapshotEmitOptions(options: unknown): EmitOptionsSnapshot {
  if (options === undefined) return new Map();
  if (options === null || typeof options !== "object" || utilTypes.isProxy(options) || Array.isArray(options)) {
    invalid("options must be a plain data object, not a Proxy");
  }
  const prototype: unknown = Object.getPrototypeOf(options);
  if (prototype !== Object.prototype && prototype !== null) {
    invalid("options must not have a custom prototype");
  }
  for (const key of EMIT_OPTION_FIELDS) {
    if (!Object.hasOwn(options, key) && key in options) {
      invalid("options must not inherit fields");
    }
  }

  const descriptors = Object.getOwnPropertyDescriptors(options);
  const snapshot = new Map<string, unknown>();
  for (const key of Reflect.ownKeys(descriptors)) {
    if (typeof key !== "string" || !EMIT_OPTION_FIELDS.has(key)) {
      invalid("options contains an unsupported field");
    }
    const descriptor = descriptors[key];
    if (descriptor === undefined || !Object.hasOwn(descriptor, "value")) {
      invalid("options fields must be data fields, not accessors");
    }
    snapshot.set(key, descriptor.value);
  }
  return snapshot;
}

function checkedOptionIdentity(snapshot: EmitOptionsSnapshot, key: "runId" | "stepId"): string | undefined {
  if (!snapshot.has(key)) return undefined;
  return checkedIdentifier(snapshot.get(key), key === "runId" ? "run_id" : "step_id", `options.${key}`);
}

function safeEnvironmentRunId(): string | undefined {
  try {
    const environmentDescriptor = Object.getOwnPropertyDescriptor(process, "env");
    if (environmentDescriptor === undefined || !Object.hasOwn(environmentDescriptor, "value")) return undefined;
    const environment: unknown = environmentDescriptor.value;
    if (environment === null || typeof environment !== "object" || utilTypes.isProxy(environment)) return undefined;
    const descriptor = Object.getOwnPropertyDescriptor(environment, "VISTA_RUN_ID");
    if (descriptor === undefined || !Object.hasOwn(descriptor, "value")) return undefined;
    const value = descriptor.value;
    if (typeof value !== "string" || value.length > 128 || !isSafeSegment(value) || !isSafeText(value, "run_id")) {
      return undefined;
    }
    return value;
  } catch {
    // An unsafe environment descriptor is never handed to core. The caller
    // uses the process-local generated fallback below instead.
    return undefined;
  }
}

function implicitRunId(): string {
  const environmentRunId = safeEnvironmentRunId();
  if (environmentRunId !== undefined) return environmentRunId;
  if (generatedImplicitRunId === undefined) generatedImplicitRunId = generateRunId();
  return generatedImplicitRunId;
}

function requireString(snapshot: EvidenceSnapshot, key: string): string {
  const value = snapshot.get(key);
  if (typeof value !== "string") {
    invalid(`${key} must be a string`);
  }
  return value;
}

function optionalString(snapshot: EvidenceSnapshot, key: string): string | undefined {
  return snapshot.has(key) ? requireString(snapshot, key) : undefined;
}

function optionalBoolean(snapshot: EvidenceSnapshot, key: string): boolean | undefined {
  if (!snapshot.has(key)) return undefined;
  const value = snapshot.get(key);
  if (typeof value !== "boolean") invalid(`${key} must be a boolean`);
  return value;
}

function isSafeText(value: string, coreKey: string): boolean {
  // Use core's public redaction contract, not copied private safety helpers.
  return !CREDENTIAL_LABEL_PATTERN.test(value) && !EMBEDDED_TOKEN_PATTERN.test(value)
    && redactAll({ [coreKey]: value })[coreKey] === value;
}

function assertSafeText(value: string, coreKey: string, inputKey: string): void {
  if (!isSafeText(value, coreKey)) invalid(`${inputKey} must contain only sanitized metadata`);
}

function checkedIdentifier(value: unknown, coreKey: string, inputKey: string): string {
  if (typeof value !== "string") invalid(`${inputKey} must be a string`);
  if (value.length > 128 || !isSafeSegment(value)) invalid(`${inputKey} must be a short path-safe identifier`);
  assertSafeText(value, coreKey, inputKey);
  return value;
}

function optionalIdentifier(snapshot: EvidenceSnapshot, key: string): string | undefined {
  return snapshot.has(key) ? checkedIdentifier(snapshot.get(key), key, key) : undefined;
}

function optionalCode(snapshot: EvidenceSnapshot, key: string): string | undefined {
  const value = optionalString(snapshot, key);
  if (value !== undefined) {
    if (!CODE_PATTERN.test(value)) invalid(`${key} must be a short registry-safe code`);
    assertSafeText(value, "reason_code", key);
  }
  return value;
}

function optionalSha(snapshot: EvidenceSnapshot, key: string): string | undefined {
  const value = optionalString(snapshot, key);
  if (value !== undefined && !SHA_PATTERN.test(value)) {
    invalid(`${key} must be exactly 40 or 64 hexadecimal characters`);
  }
  return value;
}

function optionalRef(snapshot: EvidenceSnapshot, key: string): string | undefined {
  const value = optionalString(snapshot, key);
  if (value !== undefined) {
    if (!OPAQUE_REF_PATTERN.test(value)) invalid(`${key} must be a safe opaque reference`);
    assertSafeText(value, "ref", key);
    // A bare command is not an opaque evidence reference, even without args.
    assertSafeText(value, "action", key);
  }
  return value;
}

function actionFor(snapshot: EvidenceSnapshot): string {
  if (snapshot.has("action") === snapshot.has("check_type")) {
    invalid("must provide exactly one of action or check_type");
  }
  const key = snapshot.has("action") ? "action" : "check_type";
  const value = requireString(snapshot, key);
  if (!ACTION_PATTERN.test(value)) invalid(`${key} must be a short registry-safe identifier`);
  assertSafeText(value, "action", key);
  return `gate:${value}`;
}

function outcomeFor(snapshot: EvidenceSnapshot): OwnerOutcome {
  if (snapshot.has("result") === snapshot.has("status")) {
    invalid("must provide exactly one of result or status");
  }
  if (snapshot.has("result")) {
    const value = requireString(snapshot, "result");
    if (!RESULTS.has(value as VistaResult)) invalid("result must be a VistaResult");
    const result = value as VistaResult;
    return { result, metadataKey: "owner_result", metadataValue: result };
  }
  const value = requireString(snapshot, "status");
  if (!Object.hasOwn(STATUS_RESULTS, value)) {
    invalid("status must be pending, success, failure, cancelled, skipped, or neutral");
  }
  const status = value as AiGateStatus;
  return { result: STATUS_RESULTS[status], metadataKey: "owner_status", metadataValue: status };
}

function metadataRef(stats: Record<string, number | string>): ArtifactRef | undefined {
  if (Object.keys(stats).length === 0) return undefined;
  // Stats are an existing bounded core contract. Do not widen it or retain
  // values that core would omit/redact (for example long reviewer IDs).
  const artifact: ArtifactRef = { type: "gate_metadata", ref: "gate-metadata", stats };
  const retained = redactAll({ artifact_refs: [artifact] }).artifact_refs[0]?.stats;
  const safeStats: Record<string, number | string> = {};
  for (const [key, value] of Object.entries(stats)) {
    if (retained?.[key] === value) safeStats[key] = value;
  }
  return Object.keys(safeStats).length > 0 ? { ...artifact, stats: safeStats } : undefined;
}

function prepareEmission(
  event: VistaEventInput,
  options: unknown,
): { event: VistaEventInput; options: AiGateEmitOptions } {
  const snapshot = snapshotEmitOptions(options);
  const optionRunId = checkedOptionIdentity(snapshot, "runId");
  const optionStepId = checkedOptionIdentity(snapshot, "stepId");
  const evidenceRunId = Object.hasOwn(event, "run_id")
    ? checkedIdentifier(event.run_id, "run_id", "run_id")
    : undefined;
  const effectiveRunId = checkedIdentifier(evidenceRunId ?? optionRunId ?? implicitRunId(), "run_id", "effective run_id");

  if (optionStepId !== undefined && !isVistaStepIdForRun(effectiveRunId, optionStepId)) {
    invalid("options.stepId must belong to the effective run_id");
  }

  const forwarded = Object.create(null) as Record<string, unknown>;
  for (const [key, value] of snapshot) forwarded[key] = value;
  // Make the effective identity explicit so core never consults an unvalidated
  // option or environment source. Core remains the sole default-step sequencer.
  forwarded.runId = effectiveRunId;
  if (optionStepId !== undefined) forwarded.stepId = optionStepId;
  const preparedEvent: VistaEventInput = Object.assign(Object.create(null) as VistaEventInput, event, { run_id: effectiveRunId });
  if (optionStepId !== undefined) preparedEvent.step_id = optionStepId;
  return { event: preparedEvent, options: forwarded as AiGateEmitOptions };
}

/** Map one owner-side, already-sanitized evidence record without gate operations. */
export function toVistaEventInput(evidence: AiGateEvidence): VistaEventInput {
  const snapshot = snapshotEvidence(evidence);
  const action = actionFor(snapshot);
  const ownerOutcome = outcomeFor(snapshot);
  const observedResult = ownerOutcome.result;
  const runId = optionalIdentifier(snapshot, "run_id");
  const sessionId = optionalIdentifier(snapshot, "session_id");
  const traceId = optionalIdentifier(snapshot, "trace_id");
  const repo = optionalCode(snapshot, "repo");
  const sourceSha = optionalSha(snapshot, "source_sha");
  const headSha = optionalSha(snapshot, "head_sha");
  if (headSha !== undefined && sourceSha === undefined) {
    invalid("head_sha requires source_sha for an explicit comparison");
  }
  const shaMismatch = headSha !== undefined && sourceSha !== undefined && headSha.toLowerCase() !== sourceSha.toLowerCase();

  const decision = optionalCode(snapshot, "decision");
  const verdict = optionalCode(snapshot, "verdict");
  const reasonCode = optionalCode(snapshot, "reason_code");
  const reviewHash = optionalRef(snapshot, "review_hash");
  const escalationHash = optionalRef(snapshot, "escalation_hash");
  const receiptRef = optionalRef(snapshot, "receipt_ref");
  const artifactRef = optionalRef(snapshot, "artifact_ref");
  const lane = optionalString(snapshot, "lane");
  if (lane !== undefined && !/^P[0-5]$/u.test(lane)) invalid("lane must be P0 through P5");
  const tier = optionalString(snapshot, "tier");
  if (tier !== undefined && tier !== "tier2" && tier !== "tier3") invalid("tier must be tier2 or tier3");
  const reviewerId = optionalString(snapshot, "reviewer_id");
  if (reviewerId !== undefined) {
    if (reviewerId.length > 128 || !MODEL_PATTERN.test(reviewerId)) invalid("reviewer_id must be a short registry-safe identifier");
    assertSafeText(reviewerId, "model_id", "reviewer_id");
  }
  const modelId = optionalString(snapshot, "model_id");
  if (modelId !== undefined) {
    if (modelId.length > 128 || !MODEL_PATTERN.test(modelId)) invalid("model_id must be a short registry-safe identifier");
    assertSafeText(modelId, "model_id", "model_id");
  }
  const passed = optionalBoolean(snapshot, "passed");
  const required = optionalBoolean(snapshot, "required");

  const event: VistaEventInput = {
    component: "gate",
    action,
    result: shaMismatch && observedResult !== "failed" ? "unknown" : observedResult,
  };
  if (runId !== undefined) event.run_id = runId;
  if (sessionId !== undefined) event.session_id = sessionId;
  if (traceId !== undefined) event.trace_id = traceId;
  if (repo !== undefined) event.repo = repo;
  // Never select either side of a conflict as a consistent event binding.
  if (sourceSha !== undefined && !shaMismatch) event.source_sha = sourceSha;
  if (modelId !== undefined) event.model_id = modelId;
  const reason = reasonCode ?? (shaMismatch ? "sha_mismatch" : undefined);
  if (reason !== undefined) event.reason_code = reason;

  const artifactRefs: ArtifactRef[] = [];
  if (reviewHash !== undefined) artifactRefs.push({ type: "review_evidence", ref: reviewHash });
  if (escalationHash !== undefined) artifactRefs.push({ type: "gate_escalation", ref: escalationHash });
  if (receiptRef !== undefined) artifactRefs.push({ type: "gate_receipt", ref: receiptRef });
  if (artifactRef !== undefined) artifactRefs.push({ type: "gate_artifact", ref: artifactRef });

  const metadata: Record<string, number | string> = {};
  if (lane !== undefined) metadata.lane = lane;
  if (tier !== undefined) metadata.tier = tier;
  if (reviewerId !== undefined) metadata.reviewer_id = reviewerId;
  if (decision !== undefined) metadata.decision = decision;
  if (verdict !== undefined) metadata.verdict = verdict;
  // Protocol stats have no boolean arm; retain owner flags as 0/1, never as
  // success or authorization. No ref.verified field is inferred from them.
  if (passed !== undefined) metadata.passed = passed ? 1 : 0;
  if (required !== undefined) metadata.required = required ? 1 : 0;
  if (headSha !== undefined && sourceSha !== undefined) {
    metadata.head_sha = headSha;
    metadata.source_sha = sourceSha;
    metadata.sha_relation = shaMismatch ? "mismatch" : "match";
  }
  // A conflict changes the event outcome, not what the owner observed. Retain
  // only the already-validated enum and its alias as evidence, never a PASS or
  // authorization signal, and never choose either SHA as the event binding.
  if (shaMismatch) metadata[ownerOutcome.metadataKey] = ownerOutcome.metadataValue;
  const metadataArtifact = metadataRef(metadata);
  if (metadataArtifact !== undefined) artifactRefs.push(metadataArtifact);
  if (artifactRefs.length > 0) event.artifact_refs = artifactRefs;

  // The detached event must be retained unchanged by core, including refs and
  // stats. Redaction is defense in depth, not a repair for unsafe input.
  if (!isDeepStrictEqual(redactAll(event), event)) invalid("must contain only sanitized metadata");
  return event;
}

/** Emit evidence through core; validation rejects, while store failures are fail-open. */
export async function emitAiGateEvidence(
  evidence: AiGateEvidence,
  options?: AiGateEmitOptions,
): Promise<VistaEvent | undefined> {
  const prepared = prepareEmission(toVistaEventInput(evidence), options);
  return emitVistaEvent(prepared.event, prepared.options);
}

/** Equivalent observer entry point for integrations that use observation terminology. */
export const emitAiGateObservation = emitAiGateEvidence;
