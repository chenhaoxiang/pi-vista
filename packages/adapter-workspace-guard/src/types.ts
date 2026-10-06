import type { EmitOptions, VistaEventInput } from "@pi-vista/core";
import type { VistaResult } from "@pi-vista/protocol";

/** Verdict vocabulary accepted from workspace-guard observations. */
export type WorkspaceGuardVerdict =
  | "allow"
  | "deny"
  | "abstain"
  | "timeout"
  | "unavailable";

/** Fields shared by both forms of a sanitized observation. */
interface WorkspaceGuardObservationFields {
  run_id?: string;
  session_id?: string;
  trace_id?: string;
  source_sha?: string;
  repo?: string;
  branch?: string;
  event: string;
  rule?: string;
  layer?: string;
  policy_version?: string;
  model_id?: string;
  target_class?: string;
  reason_code?: string;
  shadow?: boolean;
  shared_input_hash?: string;
}

/**
 * A sanitized, structured workspace-guard observation.
 *
 * This contract deliberately carries no command, path, credential, approval,
 * model input, or model output fields. Exactly one of `result` or `verdict` is
 * represented at the type boundary; runtime validation also rejects unknown
 * properties so an upstream integration cannot accidentally widen the record.
 */
export type WorkspaceGuardObservation = WorkspaceGuardObservationFields & (
  | { result: VistaResult; verdict?: never }
  | { result?: never; verdict: WorkspaceGuardVerdict }
);

/** Options forwarded to @pi-vista/core's fail-open emitter. */
export type WorkspaceGuardEmitOptions = EmitOptions;

/** The public mapping returned before core adds event identity/timestamp fields. */
export type WorkspaceGuardEventInput = VistaEventInput;
