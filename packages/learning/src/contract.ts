import type { EvidenceBinding, EvidenceVerifier, ReceiptSummary, VerifiedEvidence } from "@pi-vista/evidence";
import type { ExperienceStatus, VistaScript, VistaStep } from "@pi-vista/protocol";
import type { ArchivePlan, ArchiveProducerConfig, ArchiveUpload, HistoricalExperience, HistoricalImportContext, HistoricalOriginReference } from "./portable-contract.js";

export const MAX_LABEL_LENGTH = 128;
export const MAX_METADATA_CHARACTERS = 256;
export const MAX_STEPS = 16;
export const MAX_LIST_ITEMS = 16;
export const MAX_EXPERIENCES = 64;
export const MAX_SELECTION_ITEMS = 16;
export const MAX_EVALUATION_CASES = 16;
export const MAX_CONTEXT_CHARACTERS = 16_384;
export const DEFAULT_CONTEXT_CHARACTERS = 8_192;
export const MAX_DOCUMENT_CHARACTERS = 65_536;
export const DEFAULT_TIMEOUT_MS = 1_000;
export const MAX_TIMEOUT_MS = 10_000;

export type LearningErrorCode =
  | "invalid-input" | "invalid-config" | "invalid-handle" | "duplicate-experience"
  | "invalid-transition" | "unverified-evidence" | "invalid-plan" | "invalid-confirmation"
  | "promotion-used" | "promotion-invalidated" | "sink-unavailable" | "sink-failed"
  | "sink-timeout" | "sink-mismatch" | "stale-selection"
  | "archive-unavailable" | "archive-used" | "archive-invalidated" | "unverified-archive"
  | "archive-withdrawn" | "recall-unavailable" | "stale-history";
export class LearningError extends Error {
  constructor(readonly code: LearningErrorCode) {
    super(code); this.name = "LearningError"; this.stack = `${this.name}: ${code}`;
  }
}

/** The extra terminal state is local to this package; the protocol is unchanged. */
export type LearningStatus = ExperienceStatus | "superseded";
export type SafeScript = Readonly<Omit<VistaScript, "preconditions" | "steps" | "postconditions" | "known_failures" | "applicable_to"> & {
  preconditions: readonly string[]; steps: readonly string[]; postconditions: readonly string[];
  known_failures: readonly Readonly<{ symptom: string; mitigation: string }>[]; applicable_to: readonly string[];
}>;
export type SafeStep = Readonly<Omit<VistaStep, "check_fn_ids" | "depends_on"> & {
  check_fn_ids: readonly string[]; depends_on: readonly string[];
}>;
export type ObservedReason = "guard_block" | "test_failed" | "gate_blocked" | "sha_mismatch" |
  "env_mismatch" | "policy_mismatch" | "path_conflict" | "transport_timeout" | "unknown";
export type RootCauseCode = "safety_block" | "test_regression" | "gate_rejection" | "source_drift" |
  "environment_drift" | "policy_drift" | "workspace_conflict" | "transport_wait" | "unclassified";
export interface FailureObservation {
  readonly failure_id: string; readonly run_id: string; readonly step_id: string; readonly ts: number;
  readonly stage: "precondition" | "execution" | "validation" | "promotion";
  readonly reason_code: ObservedReason;
  readonly hypotheses?: readonly RootCauseCode[];
  readonly fix_applied?: string;
  readonly fix_outcome?: "resolved" | "partial" | "failed";
}
export interface FailureAnalysis extends Omit<FailureObservation, "hypotheses"> {
  readonly authorization: "none"; readonly verification: "observed-only";
  readonly failure_type: "safety" | "validation" | "binding" | "workspace" | "transport" | "unknown";
  readonly root_cause: RootCauseCode; readonly root_cause_basis: "hypothesis";
  readonly hypotheses: readonly RootCauseCode[];
}
/** Caller observations cannot contain status, verification, document IDs or trust flags. */
export interface ExperienceObservation extends EvidenceBinding {
  readonly experience_id: string; readonly task_type: string; readonly ts: number;
  readonly script: SafeScript; readonly steps: readonly SafeStep[];
  readonly model_id?: string;
  readonly failure_analysis?: FailureObservation;
}
export interface ExperienceHandle extends Omit<ExperienceObservation, "failure_analysis"> {
  readonly authorization: "none"; readonly status: LearningStatus;
  readonly failure_analysis?: FailureAnalysis;
  readonly verification?: Readonly<{ verification: "authority-bound"; authorization: "none"; receipts: readonly ReceiptSummary[] }>;
  readonly hindsight_doc_id?: string;
  readonly superseded_by?: string;
  /** Preserved historical guidance only; never an input to current verification. */
  readonly historical_origin?: HistoricalOriginReference;
}
export interface SafeDocument {
  readonly title: string; readonly content: string;
  readonly tags: readonly ("knowledge:skill" | "knowledge:failure")[];
  /** SHA-256 of the exact UTF-8 content, not an acknowledgement flag. */
  readonly content_digest: string;
}
export interface PromotionPlan {
  readonly authorization: "none"; readonly mode: "dry-run";
  readonly experience_id: string; readonly bank: string; readonly document: SafeDocument;
  readonly preview_digest: string; readonly idempotency_key: string;
}
export interface PromotionConfirmation { readonly preview_digest: string; }
export interface IngestRequest extends SafeDocument {
  /** Safe host bank alias. Mapping to an actual bank is the injected host's responsibility. */
  readonly bank: string; readonly idempotency_key: string;
}
export interface SinkReceipt {
  readonly document_id: string; readonly bank: string; readonly content_digest: string; readonly idempotency_key: string;
}
export interface SinkReadback extends SinkReceipt {
  readonly title: string; readonly content: string; readonly tags: readonly string[];
}
/** Both callbacks must return native promises. They are trusted host code, not sandboxed. */
export interface LearningSink {
  readonly ingest: (request: IngestRequest, signal: AbortSignal) => Promise<unknown>;
  readonly readback: (receipt: SinkReceipt, signal: AbortSignal) => Promise<unknown>;
}
export interface LearningConfig { readonly verifier: EvidenceVerifier; readonly sink?: LearningSink; readonly timeout_ms?: number; readonly archive?: ArchiveProducerConfig; }
export interface Correction {
  readonly failure_id: string; readonly prior_claim: string; readonly correction_code: string;
}
export type RetrievalBinding = Omit<EvidenceBinding, "run_id">;
export interface RetrievalQuery extends RetrievalBinding { readonly task_type: string; readonly limit?: number; }
export interface RejectionCounts {
  readonly unverified: number; readonly stale: number; readonly lifecycle: number;
  readonly mismatch: number; readonly task: number; readonly limit: number;
}
export interface RetrievalResult {
  readonly authorization: "none"; readonly mode: "offline-selection";
  readonly handles: readonly ExperienceHandle[]; readonly rejected: RejectionCounts;
}
export interface ContextOptions { readonly max_characters?: number; readonly max_items?: number; }
export interface ContextProvenance extends EvidenceBinding {
  readonly experience_id: string; readonly status: "verified" | "trusted"; readonly receipt_digests: readonly string[];
}
export interface CompiledContext {
  readonly authorization: "none"; readonly mode: "script-step-context"; readonly budget_unit: "characters";
  readonly content: string; readonly character_count: number; readonly max_characters: number;
  readonly item_count: number; readonly selected_ids: readonly string[]; readonly omitted_ids: readonly string[];
  readonly provenance: readonly ContextProvenance[];
}
export interface ReplayPlan extends EvidenceBinding {
  readonly authorization: "none"; readonly mode: "recorded-only"; readonly executable: false;
  readonly experience_id: string; readonly ts: number; readonly script: SafeScript; readonly timeline: readonly SafeStep[];
}
export interface RecordedComparison {
  readonly authorization: "none"; readonly mode: "recorded-comparison"; readonly executable: false;
  readonly run_id: string; readonly script_equal: boolean; readonly steps_equal: boolean;
  readonly failure_reason_equal: boolean; readonly left_step_ids: readonly string[]; readonly right_step_ids: readonly string[];
}
export interface EvaluationCase {
  readonly case_id: string; readonly query: RetrievalQuery; readonly expected_ids: readonly string[];
  readonly context?: ContextOptions;
}
export interface EvaluationRow {
  readonly case_id: string; readonly successful_selection: boolean; readonly selected_ids: readonly string[];
  readonly expected_count: number; readonly matched_count: number; readonly coverage: number;
  readonly context_items: number; readonly context_steps: number; readonly context_characters: number;
  readonly rejected: RejectionCounts;
}
export interface RetrievalEvaluation {
  readonly authorization: "none"; readonly evaluation: "offline-fixtures"; readonly capability_claim: "none";
  readonly cases: readonly EvaluationRow[]; readonly successful_selections: number;
  readonly expected_count: number; readonly matched_count: number; readonly coverage: number;
  readonly context_characters: number;
}
export interface ModelStatistic { readonly model_id: string; readonly observations: number; }
export interface ModelStatistics { readonly authorization: "none"; readonly use: "observational-only"; readonly models: readonly ModelStatistic[]; }
export interface LearningLibrary {
  observe(input: ExperienceObservation): ExperienceHandle;
  nominate(observed: ExperienceHandle): ExperienceHandle;
  verifyCandidate(candidate: ExperienceHandle, proof: VerifiedEvidence): ExperienceHandle;
  reject(handle: ExperienceHandle): ExperienceHandle;
  deprecate(handle: ExperienceHandle): ExperienceHandle;
  supersede(handle: ExperienceHandle, replacement: ExperienceHandle): ExperienceHandle;
  preparePromotion(verified: ExperienceHandle, bank: string): PromotionPlan;
  prepareCorrection(verified: ExperienceHandle, bank: string, correction: Correction): PromotionPlan;
  commitPromotion(plan: PromotionPlan, confirmation: PromotionConfirmation): Promise<ExperienceHandle>;
  /** Re-read current evidence and sign safe historical claims; no memory write. */
  prepareArchive(handle: ExperienceHandle, bank: string): Promise<ArchivePlan>;
  /** Exact confirmation plus current evidence refresh and existing sink/readback, without raising live trust. */
  commitArchive(plan: ArchivePlan, confirmation: PromotionConfirmation): Promise<ArchiveUpload>;
  /** New observed-only record with explicit current bindings; no live proof is imported. */
  importHistorical(history: HistoricalExperience, context: HistoricalImportContext): ExperienceHandle;
  planReplay(handle: ExperienceHandle, expected: EvidenceBinding): ReplayPlan;
  compareRecorded(left: ExperienceHandle, right: ExperienceHandle, expected: EvidenceBinding): RecordedComparison;
  retrieve(handles: readonly unknown[], query: RetrievalQuery): RetrievalResult;
  compileContext(selection: RetrievalResult, options?: ContextOptions): CompiledContext;
  evaluateRetrieval(handles: readonly unknown[], cases: readonly EvaluationCase[]): RetrievalEvaluation;
  modelStatistics(handles: readonly ExperienceHandle[]): ModelStatistics;
}
