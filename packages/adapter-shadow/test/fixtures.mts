import { strictEqual } from "node:assert/strict";
import { VistaProtocolError } from "@pi-vista/core";
import type { ShadowCorrelation, ShadowObservation, ShadowRowEvidence, ShadowAssetEvidence } from "@pi-vista/adapter-shadow";

export const SOURCE = "0123456789abcdef0123456789abcdef01234567";
export const HASH = "a".repeat(64);
export const OTHER_HASH = "b".repeat(64);
export const FAMILIES = [
  ["laya", "laya-421m", "laya"],
  ["kev", "kev-4b", "kev"],
  ["intern", "intern-decision-4b", "custom:shadow/intern"],
  ["startlux", "startlux-decision-4b", "custom:shadow/startlux"],
] as const;

export function binding(overrides: Record<string, unknown> = {}): ShadowCorrelation {
  return {
    run_id: "shadow-run", step_id: "shadow-run_0", source_sha: SOURCE,
    request_id: "request-1", pair_id: "pair-1", shared_input_hash: HASH,
    fingerprint: OTHER_HASH, policy_version: "synthetic-policy-v1", ...overrides,
  } as unknown as ShadowCorrelation;
}

export function observation(overrides: Record<string, unknown> = {}): ShadowObservation {
  return {
    schema: "shadow-observation/1", shadow: true, model_family: "laya", model_id: "laya-421m",
    model_version: "synthetic-v1", verdict: "allow", status: "observed", context_status: "complete",
    correlation: binding(), request: binding(), vote: binding(), vote_ref: "vote-1",
    humanExpectationWritten: false, trainingEligible: false, promotionEligible: false, ...overrides,
  } as unknown as ShadowObservation;
}

export function row(overrides: Record<string, unknown> = {}): ShadowRowEvidence {
  return {
    sample_id: "sample-1", row_sha256: HASH, input_sha256: HASH,
    packet_sha256: OTHER_HASH, contract_map_sha256: "c".repeat(64),
    ownerReviewCandidate: true, ownerAdjudicationRequired: true, forcedAbstain: false, ...overrides,
  } as unknown as ShadowRowEvidence;
}

export function asset(overrides: Record<string, unknown> = {}): ShadowAssetEvidence {
  return {
    scope: "synthetic", verified: false, realInputIsolationProven: false,
    asset_ref: "asset-1", asset_sha256: HASH, receipt_ref: "receipt-1", receipt_sha256: OTHER_HASH,
    isolation_ref: "isolation-1", isolation_sha256: "c".repeat(64),
    license_mode: "non-commercial-research-shadow", ...overrides,
  } as unknown as ShadowAssetEvidence;
}

export function fixedError(error: unknown): boolean {
  if (!(error instanceof VistaProtocolError)) return false;
  strictEqual(error.code, "VISTA_PROTOCOL_ERROR");
  strictEqual(error.message, "invalid normalized shadow observation or emission options");
  strictEqual(error.cause, undefined);
  return true;
}

export function mutable(value: unknown): Record<string, unknown> {
  return value as Record<string, unknown>;
}
