import type { EvidenceBinding } from "@pi-vista/evidence";
import type { LocalEvidenceVerifier, LocalObservationSummary } from "@pi-vista/evidence/host";
import type { ContextOptions, ExperienceObservation, PromotionConfirmation, RejectionCounts, RetrievalQuery } from "../contract.js";
import type { GuidanceDocument, GuidanceReadback, GuidanceReceipt, GuidanceReconciliation, GuidanceReference, HindsightGuidanceStore } from "../guidance/contract.js";

export type LocalLearningStatus = "observed" | "candidate" | "verified" | "persisted" | "rejected" | "deprecated" | "superseded";
export interface LocalExperienceHandle extends ExperienceObservation {
  readonly status: LocalLearningStatus; readonly authorization: "none"; readonly executable: false;
  /** Display only. Current truth requires the private proof held by this factory. */
  readonly verification?: Readonly<{ verification: "local-host-process"; scope: string; portable: false;
    observations: readonly LocalObservationSummary[] }>;
  readonly persistence?: GuidanceReceipt;
  readonly historical_origin?: GuidanceReference;
  readonly superseded_by?: string;
}
export interface LocalGuidancePlan {
  readonly mode: "dry-run"; readonly authorization: "none"; readonly executable: false;
  readonly experience_id: string; readonly scope: string; readonly bank: string;
  readonly document: GuidanceDocument; readonly preview_digest: string; readonly idempotency_key: string;
}
export interface LocalLearningConfig {
  readonly mode: "local-learning"; readonly scope: string; readonly verifier: LocalEvidenceVerifier;
  /** Explicit trusted host callbacks; no default client/bank/file discovery. */
  readonly store?: HindsightGuidanceStore; readonly timeout_ms?: number;
}
export interface LocalRetrievalResult {
  readonly mode: "local-selection"; readonly authorization: "none"; readonly executable: false;
  readonly handles: readonly LocalExperienceHandle[]; readonly rejected: RejectionCounts;
}
export interface LocalContextProvenance extends EvidenceBinding {
  readonly experience_id: string; readonly status: "verified" | "persisted"; readonly scope: string;
  readonly observation_digests: readonly string[];
}
export interface LocalCompiledContext {
  readonly mode: "local-script-step-context"; readonly authorization: "none"; readonly executable: false;
  readonly budget_unit: "characters"; readonly content: string; readonly character_count: number;
  readonly max_characters: number; readonly item_count: number; readonly selected_ids: readonly string[];
  readonly omitted_ids: readonly string[]; readonly provenance: readonly LocalContextProvenance[];
}
export interface LocalImportContext extends EvidenceBinding { readonly experience_id: string; readonly ts: number; }
export interface LocalLearningLibrary {
  observe(input: ExperienceObservation): LocalExperienceHandle;
  nominate(handle: LocalExperienceHandle): LocalExperienceHandle;
  /** Collect via the injected verifier first; copied/serialized proof is never accepted. */
  verifyCandidate(handle: LocalExperienceHandle, proof: unknown): LocalExperienceHandle;
  reject(handle: LocalExperienceHandle): LocalExperienceHandle;
  deprecate(handle: LocalExperienceHandle): LocalExperienceHandle;
  supersede(handle: LocalExperienceHandle, replacement: LocalExperienceHandle): LocalExperienceHandle;
  prepareGuidance(handle: LocalExperienceHandle, bank: string): LocalGuidancePlan;
  commitGuidance(plan: LocalGuidancePlan, confirmation: PromotionConfirmation): Promise<LocalExperienceHandle>;
  /** Original intent/original bytes only; never retries retain or restores current proof. */
  reconcileGuidance(bank: string, document: GuidanceDocument): Promise<GuidanceReconciliation>;
  readGuidance(reference: GuidanceReference | GuidanceReceipt): Promise<GuidanceReadback>;
  recallGuidance(bank: string, query: RetrievalQuery): Promise<readonly GuidanceReadback[]>;
  importGuidance(history: GuidanceReadback, context: LocalImportContext): LocalExperienceHandle;
  retrieve(handles: readonly unknown[], query: RetrievalQuery): LocalRetrievalResult;
  compileContext(selection: LocalRetrievalResult, options?: ContextOptions): LocalCompiledContext;
  /** Retires this library only, not a possibly shared injected verifier. */
  shutdown(): void;
}
