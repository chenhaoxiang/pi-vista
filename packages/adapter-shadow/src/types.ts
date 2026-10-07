import type { EmitOptions, VistaEvent, VistaEventInput } from "@pi-vista/core";
import type { ArtifactRef } from "@pi-vista/protocol";

export type ShadowModelFamily = "laya" | "kev" | "intern" | "startlux";
export type ShadowVerdict = "allow" | "pass" | "deny" | "veto" | "abstain" | "uncertain" | "unknown";
export type ShadowStatus = "observed" | "timeout" | "unavailable" | "disagreement" | "missing-context" | "invalid-evidence" | "unknown";
export type ShadowContextStatus = "complete" | "missing" | "redacted" | "truncated" | "unknown";

/** Owner-normalized identity only: no authorization scope or wire packet. */
export interface ShadowCorrelation {
  readonly run_id: string;
  readonly step_id?: string;
  readonly source_sha?: string;
  readonly request_id?: string;
  readonly pair_id?: string;
  readonly shared_input_hash?: string;
  readonly fingerprint?: string;
  readonly policy_version?: string;
}

/** A digest projection of owner row evidence, not a council verifier. */
export interface ShadowRowEvidence {
  readonly sample_id: string;
  readonly row_sha256: string;
  readonly input_sha256?: string;
  readonly packet_sha256?: string;
  readonly contract_map_sha256?: string;
  readonly ownerReviewCandidate: boolean;
  readonly ownerAdjudicationRequired: true;
  readonly forcedAbstain: boolean;
}

/** Isolated asset/receipt references never prove real-input isolation or admission. */
export interface ShadowAssetEvidence {
  readonly scope: "synthetic" | "offline" | "unknown";
  readonly verified: false;
  readonly realInputIsolationProven: false;
  readonly asset_ref?: string;
  readonly asset_sha256?: string;
  readonly receipt_ref?: string;
  readonly receipt_sha256?: string;
  readonly isolation_ref?: string;
  readonly isolation_sha256?: string;
  readonly license_mode?: "local-shadow" | "non-commercial-research-shadow" | "unknown";
}

interface ShadowObservationFields {
  readonly schema: "shadow-observation/1";
  readonly shadow: true;
  readonly model_version: string;
  readonly verdict: ShadowVerdict;
  readonly status: ShadowStatus;
  readonly context_status: ShadowContextStatus;
  readonly correlation: ShadowCorrelation;
  /** Optional normalized request/vote bindings must agree with correlation. */
  readonly request?: ShadowCorrelation;
  readonly vote?: ShadowCorrelation;
  readonly vote_ref?: string;
  readonly reason_code?: string;
  readonly confidence?: number;
  readonly asset_evidence?: ShadowAssetEvidence;
  readonly humanExpectationWritten: false;
  readonly trainingEligible: false;
  readonly promotionEligible: false;
}

/**
 * Explicit owner normalization is required. Raw AuthorizationRequest/Vote,
 * guard events, model responses and offline proof/report objects are unsupported.
 * Model identities and verdicts are observations, never safety authority.
 */
export type ShadowObservation = ShadowObservationFields & (
  | { readonly model_family: "laya"; readonly model_id: string; readonly row_evidence?: ShadowRowEvidence }
  | { readonly model_family: "kev"; readonly model_id: string; readonly row_evidence?: never }
  | { readonly model_family: "intern"; readonly model_id: "intern-decision-4b"; readonly row_evidence?: never }
  | { readonly model_family: "startlux"; readonly model_id: "startlux-decision-4b"; readonly row_evidence?: never }
);

type ImmutableArtifactRef = Readonly<Omit<ArtifactRef, "stats">> & {
  readonly stats?: Readonly<Record<string, number | string>> | undefined;
};

/** Detached, recursively frozen projection, including artifact arrays and stats. */
export type ShadowEventInput = Readonly<Omit<VistaEventInput, "artifact_refs">> & {
  readonly artifact_refs?: readonly ImmutableArtifactRef[] | undefined;
};
export type ShadowEvent = Readonly<Omit<VistaEvent, "artifact_refs">> & {
  readonly artifact_refs?: readonly ImmutableArtifactRef[] | undefined;
};

/**
 * Explicit core emission configuration; identity options corroborate the input.
 * store must be a plain own-data { append } callback wrapper, not a class instance.
 * Callbacks and baseDir are trusted configuration, never recorded source data.
 */
export type ShadowEmitOptions = Readonly<EmitOptions>;
