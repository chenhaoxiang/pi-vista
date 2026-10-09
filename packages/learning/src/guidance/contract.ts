import type { ExperienceObservation, RetrievalQuery } from "../contract.js";

export interface GuidanceDocument {
  readonly title: string; readonly content: string; readonly tags: readonly ["pi-vista:guidance-v1"];
  readonly content_digest: string;
}
export interface HistoricalGuidance {
  readonly schema: 1; readonly purpose: "historical-guidance";
  readonly current_verification: "not-checked"; readonly authorization: "none";
  readonly executable: false; readonly experience: ExperienceObservation;
}
export interface GuidanceReference {
  readonly bank: string; readonly document_id: string;
  readonly current_verification: "not-checked"; readonly authorization: "none"; readonly executable: false;
}
export interface GuidanceReceipt extends GuidanceReference {
  readonly content_digest: string; readonly idempotency_key: string;
}
export interface GuidanceReadback extends GuidanceReceipt {
  readonly document: GuidanceDocument; readonly guidance: HistoricalGuidance;
}
export interface GuidanceReconciliation {
  readonly state: "matched" | "not-confirmed"; readonly current_verification: "not-checked";
  readonly authorization: "none"; readonly executable: false;
}
export interface HindsightGuidanceConfig {
  readonly mode: "local-guidance"; readonly endpoint: string;
  readonly banks: Readonly<Record<string, string>>;
  /** Existing private local POSIX root; no discovery or automatic creation. */
  readonly journal_directory: string;
  readonly bearer_token?: string; readonly allow_loopback_http?: boolean;
  readonly timeout_ms?: number; readonly max_response_bytes?: number;
}
export interface HindsightGuidanceStore {
  /** Guidance persistence only: this is intentionally not an original LearningSink. */
  retain(bank: string, document: GuidanceDocument, signal: AbortSignal): Promise<GuidanceReceipt>;
  read(reference: GuidanceReference | GuidanceReceipt, signal: AbortSignal): Promise<GuidanceReadback>;
  query(bank: string, query: RetrievalQuery, signal: AbortSignal): Promise<readonly GuidanceReference[]>;
  reconcile(bank: string, document: GuidanceDocument, signal: AbortSignal): Promise<GuidanceReconciliation>;
}
