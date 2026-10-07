import type { ReceiptSummary } from "@pi-vista/evidence";
import type { ContextOptions, ExperienceHandle, RetrievalQuery, SafeDocument, SinkReceipt } from "./contract.js";

export const MAX_ARCHIVE_AGE_MS = 31_536_000_000;
export const MAX_LIFECYCLE_AGE_MS = 86_400_000;

/** Separate archive-origin role. These pins never configure live evidence authority. */
export interface ArchiveOriginPin {
  readonly role: "archive-origin";
  readonly issuer: string; readonly key_id: string; readonly repo: string; readonly bank: string;
  readonly public_key: string;
  /** Explicit historical key interval; archives issued outside it reject. */
  readonly not_before: number; readonly not_after: number;
  /** Revocation rejects all history under this pin; an ended interval can still authenticate history. */
  readonly trust: "pinned-history" | "revoked";
}
export interface ArchiveOrigin {
  readonly role: "archive-origin";
  readonly issuer: string; readonly key_id: string; readonly repo: string; readonly bank: string;
}
export interface ArchiveSignRequest extends ArchiveOrigin {
  readonly message: string; readonly content_digest: string;
}
export interface ArchiveProducerConfig {
  readonly origin: ArchiveOriginPin;
  readonly now: () => number;
  /** Trusted host native-promise signer; the returned closed object is { signature: base64 }. */
  readonly sign: (request: ArchiveSignRequest, signal: AbortSignal) => Promise<unknown>;
}
export type SafeExperienceSnapshot = Omit<ExperienceHandle,
  "status" | "authorization" | "verification" | "hindsight_doc_id" | "superseded_by" | "historical_origin">;
/** Signed historical claim, never a current evidence proof or a serialized live handle. */
export interface ArchivePayload {
  readonly schema: 1; readonly purpose: "portable-experience-history";
  readonly authorization: "none"; readonly executable: false;
  readonly origin: ArchiveOrigin; readonly archived_at: number;
  readonly source_status_at_archive: "verified" | "trusted";
  readonly experience: SafeExperienceSnapshot; readonly evidence: readonly ReceiptSummary[];
}
export interface ArchivePlan {
  readonly authorization: "none"; readonly executable: false; readonly mode: "dry-run";
  readonly experience_id: string; readonly bank: string; readonly origin: ArchiveOrigin;
  readonly archive_digest: string; readonly document: SafeDocument;
  readonly preview_digest: string; readonly idempotency_key: string;
}
export interface ArchiveUpload extends SinkReceipt {
  readonly authorization: "none"; readonly executable: false;
  readonly persistence: "host-readback-matched"; readonly archive_digest: string;
}
export interface ArchiveScope { readonly repo: string; readonly bank: string; }
export interface ArchiveReference extends ArchiveOrigin { readonly archive_digest: string; }
export interface HistoricalOriginReference extends ArchiveReference {
  readonly archived_at: number; readonly experience_id: string;
  readonly run_id: string; readonly source_sha: string; readonly policy_version: string; readonly env_fingerprint: string;
}
export type ArchiveLifecycleState = "active" | "deprecated" | "revoked" | "rejected" | "superseded";
/** Trusted host policy observation, not a flag read from the memory document. */
export interface ArchiveLifecycleReceipt extends ArchiveReference {
  readonly state: ArchiveLifecycleState; readonly checked_at: number; readonly expires_at: number;
}
export type HistoricalLifecycle = Readonly<{ state: "not-checked" }> |
  Readonly<{ state: "eligible-at-policy-check"; checked_at: number; expires_at: number }>;
export interface HistoricalExperience {
  readonly verification: "historical-authenticated"; readonly signature_checked: true;
  readonly current_verification: "not-checked"; readonly authorization: "none"; readonly executable: false;
  readonly archive_digest: string; readonly origin: ArchiveOrigin; readonly archived_at: number;
  readonly source_status_at_archive: "verified" | "trusted";
  readonly lifecycle: HistoricalLifecycle;
  readonly experience: SafeExperienceSnapshot; readonly evidence: readonly ReceiptSummary[];
}
export interface HindsightDocumentRef { readonly document_id: string; readonly bank: string; }
export interface HistoricalQuery extends RetrievalQuery { readonly bank: string; }
export interface HindsightReadResult extends HindsightDocumentRef { readonly document: SafeDocument; }
/** Adapter seam only: no HTTP/MCP/env/bank lookup or generated knowledge-page import. */
export interface HindsightRecallPort {
  readonly query: (query: HistoricalQuery, signal: AbortSignal) => Promise<unknown>;
  readonly read: (reference: HindsightDocumentRef, signal: AbortSignal) => Promise<unknown>;
}
export interface PortableRecallConfig {
  readonly origins: readonly ArchiveOriginPin[];
  readonly now: () => number;
  /** Required explicit historical age policy, independent of original receipt expiry. */
  readonly max_age_ms: number;
  readonly port?: HindsightRecallPort;
  readonly lifecycle?: (reference: ArchiveReference, signal: AbortSignal) => Promise<unknown>;
  readonly max_lifecycle_age_ms?: number;
  readonly timeout_ms?: number;
}
export interface HistoricalSelection {
  readonly verification: "historical-authenticated"; readonly current_verification: "not-checked";
  readonly authorization: "none"; readonly executable: false;
  readonly mode: "historical-selection"; readonly histories: readonly HistoricalExperience[];
  readonly rejected: Readonly<{ bank: number; mismatch: number; task: number; duplicate: number; limit: number }>;
}
export interface HistoricalContext {
  readonly verification: "historical-authenticated"; readonly current_verification: "not-checked";
  readonly authorization: "none"; readonly executable: false;
  readonly mode: "historical-script-step-context"; readonly budget_unit: "characters";
  readonly content: string; readonly character_count: number; readonly max_characters: number; readonly item_count: number;
  readonly selected_digests: readonly string[]; readonly omitted_digests: readonly string[];
  readonly provenance: readonly HistoricalOriginReference[];
}
export interface HistoricalImportContext {
  readonly experience_id: string; readonly run_id: string; readonly repo: string; readonly source_sha: string;
  readonly policy_version: string; readonly env_fingerprint: string; readonly ts: number;
}
export interface PortableRecall {
  authenticate(document: SafeDocument, expected: ArchiveScope): Promise<HistoricalExperience>;
  select(histories: readonly HistoricalExperience[], query: HistoricalQuery): HistoricalSelection;
  recall(query: HistoricalQuery): Promise<HistoricalSelection>;
  compileContext(selection: HistoricalSelection, options?: ContextOptions): HistoricalContext;
}
