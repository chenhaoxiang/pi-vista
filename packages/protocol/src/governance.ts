/**
 * Cross-component Pi governance protocol.
 *
 * These types describe state and evidence identity only. They do not grant
 * execution permission, business authority, or provider trust.
 */

export const PI_GOVERNANCE_RECEIPT_SCHEMA = "pi-governance-receipt/1" as const;
export const PI_GOVERNANCE_HANDOFF_SCHEMA = "pi-governance-handoff/1" as const;

export type GovernanceRunStatus =
  | "planned"
  | "admitted"
  | "running"
  | "waiting"
  | "recovering"
  | "settled"
  | "failed"
  | "cancelled"
  | "unknown"
  | "closed";

export type GovernanceEffectStatus =
  | "planned"
  | "admitted"
  | "dispatched"
  | "in_flight"
  | "observed"
  | "settled"
  | "failed"
  | "unknown"
  | "cancel_requested"
  | "cancelled"
  | "reconciling";

export type GovernanceEvidenceStatus =
  | "missing"
  | "received"
  | "bound"
  | "validated"
  | "stale"
  | "conflicting"
  | "rejected";

export type GovernanceBusinessOutcome =
  | "not_known"
  | "progress"
  | "completed"
  | "failed"
  | "blocked"
  | "cancelled"
  | "unknown";

export type GovernanceExecutionOutcome = "not_started" | "running" | "settled" | "failed" | "unknown";
export type GovernanceDeliveryOutcome = "not_requested" | "preparing" | "available" | "delivered" | "failed" | "unknown";
export type GovernancePermissionOutcome = "not_checked" | "admitted" | "blocked" | "expired" | "revoked" | "unknown";

export type GovernanceEventKind =
  | "run.created"
  | "run.admitted"
  | "run.started"
  | "run.waiting"
  | "run.recovering"
  | "run.settled"
  | "run.closed"
  | "run.failed"
  | "run.cancelled"
  | "run.unknown"
  | "effect.planned"
  | "effect.admitted"
  | "effect.dispatched"
  | "effect.started"
  | "effect.observed"
  | "effect.settled"
  | "effect.failed"
  | "effect.unknown"
  | "effect.cancel_requested"
  | "effect.cancelled"
  | "effect.reconciling"
  | "effect.reconciled"
  | "evidence.received"
  | "evidence.bound"
  | "evidence.validated"
  | "evidence.stale"
  | "evidence.conflict"
  | "evidence.rejected"
  | "message.delivery"
  | "message.received"
  | "message.wake_requested"
  | "message.started"
  | "message.outcome_known"
  | "business.completed"
  | "business.unknown";

export type GovernanceSource =
  | "pi"
  | "subagents"
  | "intercom"
  | "schedule"
  | "vista"
  | "ai-gate"
  | "workspace-guard"
  | "provider"
  | "business";

export type GovernanceActionKind =
  | "tool"
  | "message"
  | "wake"
  | "schedule"
  | "merge"
  | "task"
  | "provider_call"
  | "artifact_write";

export type GovernanceEvidenceKind =
  | "provider_receipt"
  | "readback"
  | "test"
  | "ci"
  | "merge"
  | "artifact"
  | "reconcile";

export interface GovernanceIdentity {
  readonly goal_id?: string | undefined;
  readonly run_id: string;
  readonly turn_id?: string | undefined;
  readonly effect_id?: string | undefined;
  readonly attempt_id?: string | undefined;
  readonly session_id?: string | undefined;
  readonly message_id?: string | undefined;
}

export interface GovernanceProvenance {
  readonly source_sha?: string | undefined;
  readonly head_sha?: string | undefined;
  readonly runtime_id?: string | undefined;
  readonly extension_set_digest?: string | undefined;
  readonly broker_epoch?: string | undefined;
  readonly model_provider?: string | undefined;
  readonly model_id?: string | undefined;
  readonly policy_version?: string | undefined;
  readonly protocol_version: string;
}

export interface GovernanceAction {
  readonly kind: GovernanceActionKind;
  readonly target_kind: string;
  readonly target_ref?: string | undefined;
  readonly effect_key?: string | undefined;
  readonly input_digest?: string | undefined;
  readonly write_scope_digest?: string | undefined;
}

export interface GovernanceStatus {
  readonly run: GovernanceRunStatus;
  readonly effect?: GovernanceEffectStatus | undefined;
  readonly execution_outcome: GovernanceExecutionOutcome;
  readonly business_outcome: GovernanceBusinessOutcome;
  readonly delivery_outcome: GovernanceDeliveryOutcome;
  readonly permission_outcome: GovernancePermissionOutcome;
  readonly reason_code?: string | undefined;
  readonly unknown_reason?: string | undefined;
}

export interface GovernanceEvidenceRef {
  readonly evidence_id: string;
  readonly kind: GovernanceEvidenceKind;
  readonly ref: string;
  readonly content_digest?: string | undefined;
  readonly state: GovernanceEvidenceStatus;
  readonly validator?: string | undefined;
  readonly validator_revision?: string | undefined;
  readonly observed_at: string;
  readonly fresh_until?: string | null | undefined;
}

export interface GovernanceResource {
  readonly quota_class?: string | undefined;
  readonly estimated_cost?: number | null | undefined;
  readonly actual_cost?: number | null | undefined;
  readonly input_tokens?: number | null | undefined;
  readonly output_tokens?: number | null | undefined;
}

export type GovernanceNextAction = "reconcile" | "continue" | "wait" | "close" | "handoff" | "none";

export interface GovernanceNext {
  readonly action: GovernanceNextAction;
  readonly waiting_reason?: string | null | undefined;
  readonly scheduler_hint?: string | null | undefined;
  readonly stop_condition?: string | null | undefined;
}

export interface GovernanceRedaction {
  readonly profile: string;
  readonly raw_content_included: false;
  readonly credentials_included: false;
  readonly private_path_included: false;
}

export interface GovernanceReceipt {
  readonly receipt_schema: typeof PI_GOVERNANCE_RECEIPT_SCHEMA;
  readonly receipt_id: string;
  readonly event_kind: GovernanceEventKind;
  readonly emitted_at: string;
  readonly source: GovernanceSource;
  readonly sequence?: number | undefined;
  readonly parent_receipt_id?: string | undefined;
  readonly identity: GovernanceIdentity;
  readonly provenance: GovernanceProvenance;
  readonly action?: GovernanceAction | undefined;
  readonly status: GovernanceStatus;
  readonly evidence?: readonly GovernanceEvidenceRef[] | undefined;
  readonly resource?: GovernanceResource | undefined;
  readonly next?: GovernanceNext | undefined;
  readonly redaction: GovernanceRedaction;
}

export interface GovernanceRunRecord {
  readonly run_id: string;
  readonly goal_id?: string | undefined;
  readonly run_revision: number;
  readonly status: GovernanceRunStatus;
  readonly execution_outcome: GovernanceExecutionOutcome;
  readonly business_outcome: GovernanceBusinessOutcome;
  readonly delivery_outcome: GovernanceDeliveryOutcome;
  readonly permission_outcome: GovernancePermissionOutcome;
  readonly owner?: string | undefined;
  readonly policy_version?: string | undefined;
  readonly session_id?: string | undefined;
  readonly session_epoch?: string | undefined;
  readonly runtime_id?: string | undefined;
  readonly effect_ids: readonly string[];
  readonly evidence_ids: readonly string[];
  readonly next_action: GovernanceNext;
  readonly source_sha?: string | undefined;
  readonly head_sha?: string | undefined;
  readonly config_digest?: string | undefined;
}

export interface GovernanceEffectRecord {
  readonly effect_id: string;
  readonly run_id: string;
  readonly effect_key: string;
  readonly kind: GovernanceActionKind;
  readonly target_kind: string;
  readonly target_ref?: string | undefined;
  readonly scope_digest?: string | undefined;
  readonly state: GovernanceEffectStatus;
  readonly attempt_count: number;
  readonly dispatch_receipt_id?: string | undefined;
  readonly last_observed_receipt_id?: string | undefined;
  readonly unknown_reason?: string | undefined;
  readonly reconciliation_required: boolean;
  readonly last_reconciled_at?: string | null | undefined;
  readonly duplicate_of?: string | null | undefined;
  readonly conflict: boolean;
}

export interface GovernanceEvidenceRecord {
  readonly evidence_id: string;
  readonly run_id: string;
  readonly effect_id?: string | undefined;
  readonly kind: GovernanceEvidenceKind;
  readonly state: GovernanceEvidenceStatus;
  readonly authority?: string | undefined;
  readonly source_ref: string;
  readonly source_sha?: string | undefined;
  readonly content_digest?: string | undefined;
  readonly claims: readonly string[];
  readonly validator?: string | undefined;
  readonly validator_revision?: string | undefined;
  readonly observed_at: string;
  readonly fresh_until?: string | null | undefined;
  readonly counterevidence_refs: readonly string[];
  readonly redaction_profile: string;
}

export interface GovernanceHandoff {
  readonly handoff_schema: typeof PI_GOVERNANCE_HANDOFF_SCHEMA;
  readonly goal_id?: string | undefined;
  readonly run_id: string;
  readonly run_revision: number;
  readonly source_session_id?: string | undefined;
  readonly source_runtime?: string | undefined;
  readonly accepted_facts: readonly string[];
  readonly unresolved_effects: readonly string[];
  readonly blockers: readonly string[];
  readonly next_action: GovernanceNextAction;
  readonly write_scope_digest?: string | undefined;
  readonly stop_condition?: string | undefined;
  readonly successor_constraints: {
    readonly must_read_current_head: true;
    readonly must_not_replay_unknown_effect: true;
    readonly must_not_change_model_silently: true;
  };
}

export const GOVERNANCE_RUN_STATUSES: readonly GovernanceRunStatus[] = [
  "planned", "admitted", "running", "waiting", "recovering", "settled", "failed", "cancelled", "unknown", "closed",
] as const;

export const GOVERNANCE_EFFECT_STATUSES: readonly GovernanceEffectStatus[] = [
  "planned", "admitted", "dispatched", "in_flight", "observed", "settled", "failed", "unknown", "cancel_requested", "cancelled", "reconciling",
] as const;

export const GOVERNANCE_EVIDENCE_STATUSES: readonly GovernanceEvidenceStatus[] = [
  "missing", "received", "bound", "validated", "stale", "conflicting", "rejected",
] as const;

const RUN_TRANSITIONS: Readonly<Record<GovernanceRunStatus, readonly GovernanceRunStatus[]>> = {
  planned: ["admitted"],
  admitted: ["running", "cancelled", "failed"],
  running: ["waiting", "recovering", "settled", "failed", "cancelled", "unknown"],
  waiting: ["running", "cancelled", "closed"],
  recovering: ["running", "settled", "failed", "unknown", "closed"],
  settled: ["closed"],
  failed: ["closed"],
  cancelled: ["closed"],
  unknown: ["recovering", "closed"],
  closed: [],
};

const EFFECT_TRANSITIONS: Readonly<Record<GovernanceEffectStatus, readonly GovernanceEffectStatus[]>> = {
  planned: ["admitted"],
  admitted: ["dispatched", "cancelled"],
  dispatched: ["in_flight", "observed", "unknown", "cancel_requested"],
  in_flight: ["observed", "unknown", "cancel_requested"],
  observed: ["settled", "failed", "unknown"],
  settled: [],
  failed: [],
  unknown: ["reconciling"],
  cancel_requested: ["cancelled", "unknown"],
  cancelled: [],
  reconciling: ["settled", "failed", "cancelled", "unknown"],
};

const EVIDENCE_TRANSITIONS: Readonly<Record<GovernanceEvidenceStatus, readonly GovernanceEvidenceStatus[]>> = {
  missing: ["received"],
  received: ["bound", "rejected"],
  bound: ["validated", "stale", "conflicting", "rejected"],
  validated: ["stale", "conflicting"],
  stale: ["received", "rejected"],
  conflicting: ["received", "rejected"],
  rejected: ["received"],
};

export function canTransitionRun(from: GovernanceRunStatus, to: GovernanceRunStatus): boolean {
  return from === to || RUN_TRANSITIONS[from].includes(to);
}

export function canTransitionEffect(from: GovernanceEffectStatus, to: GovernanceEffectStatus): boolean {
  return from === to || EFFECT_TRANSITIONS[from].includes(to);
}

export function canTransitionEvidence(from: GovernanceEvidenceStatus, to: GovernanceEvidenceStatus): boolean {
  return from === to || EVIDENCE_TRANSITIONS[from].includes(to);
}
