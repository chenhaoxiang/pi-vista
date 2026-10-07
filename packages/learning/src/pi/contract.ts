import type { VistaCheckpoint, VistaEvent } from "@pi-vista/core";
import type { EvidenceBinding, EvidenceSubjects, EvidenceVerifier } from "@pi-vista/evidence";
import type { HistoricalContext, PortableRecallConfig } from "../portable-contract.js";

/** Host metadata only; this is not a discovery or factual source attestation. */
export interface PiTask {
  readonly repo: string; readonly source_sha: string; readonly policy_version: string; readonly env_fingerprint: string;
  readonly task_type: string; readonly task_goal: string; readonly bank: string; readonly session_alias?: string;
}
export interface PiToolClassification { readonly native_name: string; readonly classification: string; }
export interface PiObservationConfig {
  readonly resolve_task: () => Promise<unknown>;
  readonly now: () => number;
  readonly tools: readonly PiToolClassification[];
  /** Explicit closed native-promise ports. Wrap class stores rather than exposing their private config. */
  readonly events?: { readonly append: (event: VistaEvent) => Promise<unknown> };
  readonly checkpoints?: { readonly save: (checkpoint: VistaCheckpoint) => Promise<unknown> };
  readonly history?: PortableRecallConfig;
  readonly preview_on_start?: boolean;
  readonly verifier?: EvidenceVerifier;
  readonly subjects?: EvidenceSubjects;
  readonly timeout_ms?: number;
  /** Bounds scheduled work and separately outstanding native host callbacks, including timed-out callbacks. */
  readonly max_pending_work?: number;
  /** Total distinct call identities per epoch, not just simultaneous executions; no eviction/rebinding. */
  readonly max_correlations?: number;
  readonly max_items?: number;
  readonly max_characters?: number;
}
export type PiNotification = "session_start" | "session_shutdown" | "agent_start" | "agent_end" | "agent_settled" | "tool_execution_start" | "tool_execution_end";
/** Structural public host subset: no SDK runtime import or bundled SDK is needed. */
export interface PiUIContext {
  readonly hasUI: boolean;
  readonly ui: { notify(message: string, type?: "info" | "warning" | "error"): void };
}
export interface PiExtensionAPI {
  on(event: PiNotification, handler: (event: unknown, context: PiUIContext) => undefined): () => void;
  registerCommand(name: string, options: { description: string; handler: (args: string, context: PiUIContext) => Promise<void> }): void;
}
export interface PiPreview {
  readonly verification: "historical-authenticated"; readonly current_verification: "not-checked";
  readonly authorization: "none"; readonly executable: false;
  readonly run_id: string; readonly preview_digest: string; readonly context: HistoricalContext;
}
export interface PiObservationStatus {
  readonly authorization: "none"; readonly executable: false; readonly observation: "observed";
  readonly phase: "MISSING" | "active" | "settled" | "shutdown";
  readonly binding?: EvidenceBinding; readonly task?: PiTask;
  readonly history: "MISSING" | "historical-authenticated";
  readonly current: "MISSING" | "current-verified";
  readonly selection: "none" | "local-guidance-acknowledgement";
  readonly preview_digest?: string;
  readonly dropped: number; readonly correlations: number; readonly pending_work: number; readonly pending_callbacks: number;
}
export interface PiObservationController {
  status(): PiObservationStatus;
  preview(): Promise<PiPreview>;
  /** Only this exact controller's current view plus its exact digest is accepted. No injection or write. */
  adopt(preview: PiPreview, digest: string): Promise<PiObservationStatus>;
  verifyCurrent(): Promise<PiObservationStatus>;
  reset(): void;
  shutdown(): void;
}
export interface PiObservationAddon {
  readonly extension: (pi: PiExtensionAPI) => void;
  readonly controller: PiObservationController;
}
export class PiObservationError extends Error {
  readonly code: "invalid-config" | "refused";
  constructor(code: "invalid-config" | "refused") { super(code); this.name = "PiObservationError"; this.code = code; }
}
