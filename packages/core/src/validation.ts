import type { VistaCheckpoint, VistaComponent, VistaEvent, VistaResult } from "@pi-vista/protocol";
import { hasKnownCredential } from "./credential.js";
import { isSafeSegment } from "./path-safe.js";
import {
  isSafeCustomComponent,
  isSafeStatsKey,
  isSafeVistaVersion,
  isValidStatsString,
  MAX_STATS_ENTRIES,
} from "./safe-fields.js";

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

/** @internal Share run binding with store path enumeration. */
export function isVistaStepIdForRun(runId: unknown, stepId: unknown): stepId is string {
  return (
    isSafeSegment(runId) &&
    isSafeSegment(stepId) &&
    !hasKnownCredential(runId) &&
    !hasKnownCredential(stepId) &&
    stepId.startsWith(`${runId}_`) &&
    stepId.length > runId.length + 1
  );
}

function isIdentifierArray(value: unknown, isIdentifier: (item: unknown) => boolean): value is string[] {
  if (!Array.isArray(value)) {
    return false;
  }
  // Unlike Array.every, index traversal also rejects sparse array holes.
  for (let index = 0; index < value.length; index += 1) {
    if (!isIdentifier(value[index])) {
      return false;
    }
  }
  return true;
}

function isSafeResumeRequirement(value: unknown): value is string {
  // Requirements are symbolic IDs, not paths. Reject dot-dot fragments in
  // addition to the shared path-segment grammar to make traversal intent
  // unambiguous even when a caller supplies a custom requirement name.
  return isSafeSegment(value) && !value.includes("..");
}

export function isVistaComponent(value: unknown): value is VistaComponent {
  return (
    typeof value === "string" &&
    (COMPONENTS.has(value as VistaComponent) || isSafeCustomComponent(value))
  );
}

export function isVistaResult(value: unknown): value is VistaResult {
  return typeof value === "string" && RESULTS.has(value as VistaResult);
}

/** Validate shape/safety, not version compatibility, without throwing on stored data. */
export function isVistaEvent(value: unknown): value is VistaEvent {
  if (!isRecord(value)) {
    return false;
  }
  if (!isVistaStepIdForRun(value.run_id, value.step_id)) {
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
  ] as const;
  for (const key of optionalStringKeys) {
    if (value[key] !== undefined && typeof value[key] !== "string") {
      return false;
    }
  }
  if (value.vista_version !== undefined && !isSafeVistaVersion(value.vista_version)) {
    return false;
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
        const stats = Object.entries(artifact.stats);
        if (stats.length > MAX_STATS_ENTRIES) {
          return false;
        }
        for (const [key, stat] of stats) {
          if (!isSafeStatsKey(key)) {
            return false;
          }
          if (typeof stat === "number") {
            if (!Number.isFinite(stat)) {
              return false;
            }
          } else if (!isValidStatsString(stat)) {
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
    isVistaStepIdForRun(value.run_id, value.step_id) &&
    typeof value.ts === "number" &&
    Number.isFinite(value.ts) &&
    typeof value.task_goal === "string" &&
    isIdentifierArray(value.completed_steps, (stepId) => isVistaStepIdForRun(value.run_id, stepId)) &&
    typeof value.current_state === "string" &&
    isIdentifierArray(value.pending_steps, (stepId) => isVistaStepIdForRun(value.run_id, stepId)) &&
    typeof value.source_sha === "string" &&
    typeof value.env_fingerprint === "string" &&
    typeof value.policy_version === "string" &&
    isIdentifierArray(value.check_fn_ids, isSafeSegment) &&
    typeof value.resumable === "boolean" &&
    (value.resume_requires === undefined || isIdentifierArray(value.resume_requires, isSafeResumeRequirement))
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
