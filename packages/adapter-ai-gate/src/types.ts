import type { EmitOptions, VistaEventInput } from "@pi-vista/core";
import type { VistaResult } from "@pi-vista/protocol";

/** Status vocabulary accepted from owner-side ai-gate evidence. */
export type AiGateStatus =
  | "pending"
  | "success"
  | "failure"
  | "cancelled"
  | "skipped"
  | "neutral";

interface AiGateEvidenceFields {
  run_id?: string;
  session_id?: string;
  trace_id?: string;
  repo?: string;
  source_sha?: string;
  decision?: string;
  verdict?: string;
  reason_code?: string;
  head_sha?: string;
  review_hash?: string;
  escalation_hash?: string;
  receipt_ref?: string;
  artifact_ref?: string;
  lane?: "P0" | "P1" | "P2" | "P3" | "P4" | "P5";
  tier?: "tier2" | "tier3";
  reviewer_id?: string;
  model_id?: string;
  passed?: boolean;
  required?: boolean;
}

/**
 * Structured, already-sanitized evidence owned by ai-gate.
 *
 * The runtime adapter repeats this closed contract because callers can pass
 * JavaScript values that do not satisfy the TypeScript type. It accepts no
 * command, path, URL, token, cookie, pull-request text, CI log, or review
 * content fields.
 */
export type AiGateEvidence = AiGateEvidenceFields & (
  | { action: string; check_type?: never }
  | { action?: never; check_type: string }
) & (
  | { result: VistaResult; status?: never }
  | { result?: never; status: AiGateStatus }
);

/** A readable alias for integrations that call the evidence an observation. */
export type AiGateObservation = AiGateEvidence;

/** Options forwarded to @pi-vista/core's fail-open emitter. */
export type AiGateEmitOptions = EmitOptions;

/** Event input returned before core adds step identity, timestamp, and version. */
export type AiGateEventInput = VistaEventInput;