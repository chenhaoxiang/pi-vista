import type { VistaCheckpoint, VistaComponent, VistaEvent, VistaResult } from "@pi-vista/protocol";
import { isSafeSegment } from "./path-safe.js";

const COMPONENTS = new Set<VistaComponent>(["pi", "guard", "gate", "laya", "kev", "test", "browser", "ci"]);
const RESULTS = new Set<VistaResult>(["ok", "blocked", "failed", "unknown", "abstain"]);

/** Distinguishes caller/protocol mistakes from fail-open store failures. */
export class VistaProtocolError extends Error {
  readonly code = "VISTA_PROTOCOL_ERROR" as const;

  constructor(message = "invalid pi-vista protocol value") {
    super(message);
    this.name = "VistaProtocolError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  if (!Array.isArray(value)) {
    return false;
  }
  for (let index = 0; index < value.length; index += 1) {
    if (typeof value[index] !== "string") {
      return false;
    }
  }
  return true;
}

export function isVistaComponent(value: unknown): value is VistaComponent {
  return (
    typeof value === "string" &&
    (COMPONENTS.has(value as VistaComponent) || /^custom:[^\s]+$/u.test(value))
  );
}

export function isVistaResult(value: unknown): value is VistaResult {
  return typeof value === "string" && RESULTS.has(value as VistaResult);
}

/** Return false for malformed values without throwing on untrusted storage data. */
export function isVistaEvent(value: unknown): value is VistaEvent {
  if (!isRecord(value)) {
    return false;
  }
  if (!isSafeSegment(value.run_id) || !isSafeSegment(value.step_id)) {
    return false;
  }
  if (typeof value.ts !== "number" || !Number.isFinite(value.ts)) {
    return false;
  }
  if (!isVistaComponent(value.component) || !isVistaResult(value.result)) {
    return false;
  }
  if (typeof value.action !== "string" || value.action.trim().length === 0) {
    return false;
  }

  const optionalStringKeys = [
    "session_id",
    "trace_id",
    "repo",
    "source_sha",
    "worktree_id",
    "branch",
    "target_class",
    "policy_version",
    "layer",
    "reason_code",
    "env_fingerprint",
    "model_id",
    "vista_version",
  ] as const;
  for (const key of optionalStringKeys) {
    if (value[key] !== undefined && typeof value[key] !== "string") {
      return false;
    }
  }
  if (value.artifact_refs !== undefined) {
    if (!Array.isArray(value.artifact_refs)) {
      return false;
    }
    for (const artifact of value.artifact_refs) {
      if (!isRecord(artifact) || typeof artifact.type !== "string" || typeof artifact.ref !== "string") {
        return false;
      }
      if (artifact.sha !== undefined && typeof artifact.sha !== "string") {
        return false;
      }
      if (artifact.verified !== undefined && typeof artifact.verified !== "boolean") {
        return false;
      }
      if (artifact.stats !== undefined) {
        if (!isRecord(artifact.stats)) {
          return false;
        }
        for (const stat of Object.values(artifact.stats)) {
          if (typeof stat !== "number" && typeof stat !== "string") {
            return false;
          }
        }
      }
    }
  }
  return true;
}

/** Return false for malformed values without throwing on untrusted storage data. */
export function isVistaCheckpoint(value: unknown): value is VistaCheckpoint {
  if (!isRecord(value)) {
    return false;
  }
  return (
    isSafeSegment(value.run_id) &&
    isSafeSegment(value.step_id) &&
    typeof value.ts === "number" &&
    Number.isFinite(value.ts) &&
    typeof value.task_goal === "string" &&
    isStringArray(value.completed_steps) &&
    typeof value.current_state === "string" &&
    isStringArray(value.pending_steps) &&
    typeof value.source_sha === "string" &&
    typeof value.env_fingerprint === "string" &&
    typeof value.policy_version === "string" &&
    isStringArray(value.check_fn_ids) &&
    typeof value.resumable === "boolean" &&
    (value.resume_requires === undefined || isStringArray(value.resume_requires))
  );
}

export function assertVistaEvent(value: unknown): asserts value is VistaEvent {
  if (!isVistaEvent(value)) {
    throw new VistaProtocolError("invalid VistaEvent protocol value");
  }
}

export function assertVistaCheckpoint(value: unknown): asserts value is VistaCheckpoint {
  if (!isVistaCheckpoint(value)) {
    throw new VistaProtocolError("invalid VistaCheckpoint protocol value");
  }
}
