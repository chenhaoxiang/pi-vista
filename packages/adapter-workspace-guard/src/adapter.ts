import {
  emitVistaEvent,
  isSafeSegment,
  redactAll,
  VistaProtocolError,
  type VistaEvent,
  type VistaEventInput,
  type VistaResult,
} from "@pi-vista/core";
import type {
  WorkspaceGuardEmitOptions,
  WorkspaceGuardObservation,
  WorkspaceGuardVerdict,
} from "./types.js";

const OBSERVATION_FIELDS = new Set([
  "run_id",
  "session_id",
  "trace_id",
  "source_sha",
  "repo",
  "branch",
  "event",
  "rule",
  "layer",
  "policy_version",
  "result",
  "verdict",
  "model_id",
  "target_class",
  "reason_code",
  "shadow",
  "shared_input_hash",
]);
const RESULTS = new Set<VistaResult>(["ok", "blocked", "failed", "unknown", "abstain"]);
const VERDICTS = new Set<WorkspaceGuardVerdict>([
  "allow",
  "deny",
  "abstain",
  "timeout",
  "unavailable",
]);
const VERDICT_RESULTS: Record<WorkspaceGuardVerdict, VistaResult> = {
  allow: "ok",
  deny: "blocked",
  abstain: "abstain",
  timeout: "unknown",
  unavailable: "unknown",
};
const EVENT_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._+@_-]*(?::[A-Za-z0-9][A-Za-z0-9._+@_-]*)*$/u;
const SAFE_LABEL_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:@+-]*$/u;
const SAFE_SLASH_LABEL_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:@+-]*(?:\/[A-Za-z0-9][A-Za-z0-9._:@+-]*)*$/u;
const SHARED_INPUT_HASH_PATTERN = /^[0-9a-f]{64}$/iu;
const RAW_FIELD_PATTERNS: Array<[RegExp, string]> = [
  [/command|cmd|shell|script|exec/iu, "raw command"],
  [/cwd|path|file|directory|worktree|location/iu, "raw path/cwd"],
  [/credential|secret|token|password|passwd|api[_-]?key|access[_-]?key|auth/iu, "credential"],
  [/stderr|stdout/iu, "raw process output"],
];

function invalid(message: string): never {
  throw new VistaProtocolError(`workspace-guard observation ${message}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasOwn(record: Record<string, unknown>, key: string): boolean {
  return Object.hasOwn(record, key);
}

function requireString(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (typeof value !== "string") {
    invalid(`${key} must be a string`);
  }
  return value;
}

function requireOptionalString(record: Record<string, unknown>, key: string): string | undefined {
  if (!hasOwn(record, key)) {
    return undefined;
  }
  return requireString(record, key);
}

function requireSafeSegment(record: Record<string, unknown>, key: string): string | undefined {
  const value = requireOptionalString(record, key);
  if (value !== undefined && !isSafeSegment(value)) {
    invalid(`${key} must be a path-safe identifier`);
  }
  return value;
}

function requireSafeLabel(record: Record<string, unknown>, key: string): string | undefined {
  const value = requireOptionalString(record, key);
  if (value !== undefined && !SAFE_LABEL_PATTERN.test(value)) {
    invalid(`${key} must be a safe metadata identifier`);
  }
  if (value !== undefined) {
    const coreKey = key === "rule" ? "reason_code" : key;
    const redacted = redactAll({ [coreKey]: value });
    if (redacted[coreKey] !== value) {
      invalid(`${key} must contain only sanitized metadata`);
    }
  }
  return value;
}

function requireSafeSlashLabel(record: Record<string, unknown>, key: string): string | undefined {
  const value = requireOptionalString(record, key);
  if (
    value !== undefined &&
    (!SAFE_SLASH_LABEL_PATTERN.test(value) || value.split("/").some((segment) => segment === "." || segment === ".."))
  ) {
    invalid(`${key} must be a safe metadata identifier`);
  }
  return value;
}

function requireBoolean(record: Record<string, unknown>, key: string): boolean | undefined {
  if (!hasOwn(record, key)) {
    return undefined;
  }
  const value = record[key];
  if (typeof value !== "boolean") {
    invalid(`${key} must be a boolean`);
  }
  return value;
}

function requireResult(record: Record<string, unknown>): VistaResult {
  const value = record.result;
  if (typeof value !== "string" || !RESULTS.has(value as VistaResult)) {
    invalid("result must be a VistaResult");
  }
  return value as VistaResult;
}

function requireVerdict(record: Record<string, unknown>): VistaResult {
  const value = record.verdict;
  if (typeof value !== "string" || !VERDICTS.has(value as WorkspaceGuardVerdict)) {
    invalid("verdict must be allow, deny, abstain, timeout, or unavailable");
  }
  return VERDICT_RESULTS[value as WorkspaceGuardVerdict];
}

function requireSharedInputHash(record: Record<string, unknown>): string | undefined {
  const value = requireOptionalString(record, "shared_input_hash");
  if (value !== undefined && !SHARED_INPUT_HASH_PATTERN.test(value)) {
    invalid("shared_input_hash must be exactly 64 hexadecimal characters");
  }
  return value;
}

function validateFields(record: Record<string, unknown>): void {
  let keys: (string | symbol)[];
  try {
    keys = Reflect.ownKeys(record);
  } catch {
    invalid("must have readable field names");
  }
  for (const key of keys) {
    if (typeof key !== "string" || !OBSERVATION_FIELDS.has(key)) {
      // Unknown property names may themselves contain raw data. Include only a
      // fixed category in the error, never an untrusted field name.
      const category = typeof key === "string"
        ? RAW_FIELD_PATTERNS.find(([pattern]) => pattern.test(key))?.[1]
        : undefined;
      invalid(category === undefined
        ? "contains an unsupported field; only sanitized observation fields are allowed"
        : `contains a forbidden ${category} field`);
    }
    let descriptor: PropertyDescriptor | undefined;
    try {
      descriptor = Object.getOwnPropertyDescriptor(record, key);
    } catch {
      invalid("contains an unreadable field");
    }
    if (descriptor === undefined || !Object.hasOwn(descriptor, "value")) {
      invalid("fields must be data fields, not accessors");
    }
  }
}

function validateRetainedFields(input: VistaEventInput): void {
  // The core redactor is the authority for retained text. Reject rather than
  // silently converting an unsafe observation into a redacted-looking event.
  const redacted = redactAll(input);
  for (const key of Object.keys(input) as (keyof VistaEventInput)[]) {
    if (typeof input[key] === "string" && redacted[key] !== input[key]) {
      invalid(`${key} must contain only sanitized metadata`);
    }
  }
}

function resultFor(record: Record<string, unknown>): VistaResult {
  const hasResult = hasOwn(record, "result");
  const hasVerdict = hasOwn(record, "verdict");
  if (hasResult === hasVerdict) {
    invalid("must provide exactly one of result or verdict");
  }
  return hasResult ? requireResult(record) : requireVerdict(record);
}

/**
 * Convert one already-sanitized workspace-guard observation to a core event.
 * This function performs no shell, path, approval, or model processing.
 */
export function toVistaEventInput(observation: WorkspaceGuardObservation): VistaEventInput {
  if (!isRecord(observation)) {
    invalid("must be an object");
  }
  validateFields(observation);

  const event = requireString(observation, "event");
  if (!EVENT_PATTERN.test(event)) {
    invalid("event must be a non-empty registry-safe identifier");
  }

  const runId = requireSafeSegment(observation, "run_id");
  const sessionId = requireSafeSegment(observation, "session_id");
  const traceId = requireSafeSegment(observation, "trace_id");
  const sourceSha = requireSafeSegment(observation, "source_sha");
  const repo = requireSafeLabel(observation, "repo");
  const branch = requireSafeSlashLabel(observation, "branch");
  const rule = requireSafeLabel(observation, "rule");
  const layer = requireSafeLabel(observation, "layer");
  const policyVersion = requireSafeLabel(observation, "policy_version");
  const modelId = requireSafeSlashLabel(observation, "model_id");
  const targetClass = requireSafeLabel(observation, "target_class");
  const reasonCode = requireSafeLabel(observation, "reason_code");
  const shadow = requireBoolean(observation, "shadow");
  const sharedInputHash = requireSharedInputHash(observation);
  const result = resultFor(observation);

  const input: VistaEventInput = {
    component: "guard",
    action: shadow === true ? `guard:${event}:shadow` : `guard:${event}`,
    result,
  };
  if (runId !== undefined) input.run_id = runId;
  if (sessionId !== undefined) input.session_id = sessionId;
  if (traceId !== undefined) input.trace_id = traceId;
  if (sourceSha !== undefined) input.source_sha = sourceSha;
  if (repo !== undefined) input.repo = repo;
  if (branch !== undefined) input.branch = branch;
  if (rule !== undefined) {
    input.reason_code = rule;
  } else if (reasonCode !== undefined) {
    input.reason_code = reasonCode;
  }
  if (layer !== undefined) input.layer = layer;
  if (policyVersion !== undefined) input.policy_version = policyVersion;
  if (modelId !== undefined) input.model_id = modelId;
  if (targetClass !== undefined) input.target_class = targetClass;
  if (sharedInputHash !== undefined) {
    input.artifact_refs = [{
      type: "shadow_input",
      ref: `shadow-input-${sharedInputHash}`,
    }];
  }
  validateRetainedFields(input);
  return input;
}

/** Emit one sanitized workspace-guard observation through @pi-vista/core. */
export async function emitWorkspaceGuardObservation(
  observation: WorkspaceGuardObservation,
  options?: WorkspaceGuardEmitOptions,
): Promise<VistaEvent | undefined> {
  return emitVistaEvent(toVistaEventInput(observation), options);
}
