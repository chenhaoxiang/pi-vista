import { isGovernanceEvidenceRecord, VistaProtocolError } from "@pi-vista/core";
import type { GovernanceEvidenceKind, GovernanceEvidenceRecord } from "@pi-vista/protocol";
import {
  samePiWorkBinding,
  snapshotPiWorkBinding,
  type PiWorkBinding,
  readWorkArray,
  readWorkMetadata,
  workIdentifier,
} from "./work-ref.js";

export type PiOwnerSourceKind = "code" | "artifact" | "business" | "report";
export type PiOwnerDisposition = "accepted" | "rejected" | "unknown";
export type PiRequiredEffectOutcome = "pending" | "settled" | "failed" | "cancelled" | "unknown";
export type PiDeliveryDecision = "deliverable" | "reportable_terminal" | "reconcile_required";
export type PiResultReasonCode =
  | "binding_invalid" | "binding_mismatch" | "result_reference_invalid"
  | "owner_readback_invalid" | "owner_readback_not_current" | "observation_time_invalid"
  | "owner_outcome_unknown" | "owner_rejected" | "source_head_missing"
  | "required_evidence_not_validated" | "required_evidence_conflict"
  | "required_effect_binding_mismatch" | "required_effect_pending" | "required_effect_unknown"
  | "required_effect_not_successful" | "owner_acceptance_confirmed"
  | "reader_options_invalid" | "owner_reader_failed" | "owner_reader_timeout";

/** The original stage's declared check, not a policy inferred from one green test. */
export interface PiRequiredEvidence {
  readonly evidenceId: string;
  readonly kind: GovernanceEvidenceKind;
  readonly sourceRef: string;
  readonly claims: readonly string[];
}

/** The host binds an original evidence record to the work and attempt it actually checked. */
export interface PiOwnerEvidence {
  readonly binding: PiWorkBinding;
  readonly record: GovernanceEvidenceRecord;
}

/** A native required effect; settled execution alone is not stage acceptance. */
export interface PiRequiredEffect {
  readonly binding: PiWorkBinding;
  readonly effectRef: string;
  readonly outcome: PiRequiredEffectOutcome;
  readonly disposition: PiOwnerDisposition;
}

/**
 * One current, trusted-host owner readback. Required sets come from the original
 * stage's acceptance, not worker claims. The host resolves originals privately;
 * these metadata and their validated flags are not signatures or opaque proof.
 */
export interface PiOwnerReadback {
  readonly binding: PiWorkBinding;
  readonly sourceKind: PiOwnerSourceKind;
  readonly sourceRef: string;
  readonly disposition: PiOwnerDisposition;
  readonly observedAt: string;
  readonly freshUntil: string;
  readonly requiredEvidence: readonly PiRequiredEvidence[];
  readonly evidence: readonly PiOwnerEvidence[];
  readonly requiredEffects: readonly PiRequiredEffect[];
}

/** Owner-reported observation only, never an execution, delivery acknowledgement or Gate handle. */
export interface PiResultConsumption {
  /** Null means no valid work identity was supplied; no placeholder work is invented. */
  readonly binding: PiWorkBinding | null;
  /** Retained by the explicit reader even when a valid result is superseded or unresolved. */
  readonly resultRef?: string;
  readonly decision: PiDeliveryDecision;
  readonly outcome: "accepted" | "failed" | "unknown";
  readonly reasonCode: PiResultReasonCode;
  readonly authorization: "none";
  readonly readOnly: true;
}

const OWNER_READBACK_KEYS = [
  "binding", "sourceKind", "sourceRef", "disposition", "observedAt", "freshUntil",
  "requiredEvidence", "evidence", "requiredEffects",
] as const;
const EVIDENCE_KEYS = [
  "evidence_id", "run_id", "effect_id", "kind", "state", "authority", "source_ref", "source_sha",
  "content_digest", "claims", "validator", "validator_revision", "observed_at", "fresh_until",
  "counterevidence_refs", "redaction_profile",
] as const;
const SOURCE_EVIDENCE_KINDS: Readonly<Record<PiOwnerSourceKind, readonly GovernanceEvidenceKind[]>> = {
  code: ["test", "ci", "merge", "readback"],
  artifact: ["artifact", "readback"],
  business: ["provider_receipt", "readback", "reconcile"],
  report: ["artifact", "readback"],
};
const DISPOSITIONS = new Set<PiOwnerDisposition>(["accepted", "rejected", "unknown"]);
const EFFECT_OUTCOMES = new Set<PiRequiredEffectOutcome>(["pending", "settled", "failed", "cancelled", "unknown"]);

function disposition(value: unknown): PiOwnerDisposition {
  if (typeof value !== "string" || !DISPOSITIONS.has(value as PiOwnerDisposition)) {
    throw new VistaProtocolError("owner disposition is invalid");
  }
  return value as PiOwnerDisposition;
}

function timestamp(value: unknown): string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value)
    || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) {
    throw new VistaProtocolError("owner observation requires an exact timestamp");
  }
  return value;
}

function identifiers(value: unknown, maxLength: number): readonly string[] {
  return Object.freeze(readWorkArray(value, maxLength).map(workIdentifier));
}

function normalizeEvidence(value: unknown): PiOwnerEvidence {
  const entry = readWorkMetadata(value, ["binding", "record"], "owner evidence");
  const data = readWorkMetadata(entry.record, EVIDENCE_KEYS, "evidence record");
  // Core validation only sees detached, inert data, never the caller's getters or array methods.
  data.claims = identifiers(data.claims, 64);
  data.counterevidence_refs = identifiers(data.counterevidence_refs, 128);
  if (!isGovernanceEvidenceRecord(data)) throw new VistaProtocolError("owner evidence record is invalid");
  for (const key of ["evidence_id", "run_id", "source_ref", "effect_id", "authority", "content_digest", "validator", "validator_revision"] as const) {
    if (data[key] !== undefined) workIdentifier(data[key]);
  }
  if (data.source_sha !== undefined && !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u.test(data.source_sha)) {
    throw new VistaProtocolError("evidence head must be an exact digest");
  }
  timestamp(data.observed_at);
  if (data.fresh_until !== undefined && data.fresh_until !== null) timestamp(data.fresh_until);
  if (!/^[A-Za-z0-9_.-]+(?:\/[0-9]+)?$/u.test(data.redaction_profile) || data.redaction_profile.length > 128) {
    throw new VistaProtocolError("evidence redaction profile must be a bounded label");
  }
  return Object.freeze({ binding: snapshotPiWorkBinding(entry.binding), record: Object.freeze(data) });
}

function normalizeRequiredEvidence(value: unknown, sourceKind: PiOwnerSourceKind): readonly PiRequiredEvidence[] {
  const requirements = readWorkArray(value, 32).map((entry) => {
    const data = readWorkMetadata(entry, ["evidenceId", "kind", "sourceRef", "claims"], "required evidence");
    if (typeof data.kind !== "string" || !SOURCE_EVIDENCE_KINDS[sourceKind].includes(data.kind as GovernanceEvidenceKind)) {
      throw new VistaProtocolError("required evidence does not match the original source kind");
    }
    const claims = identifiers(data.claims, 64);
    if (claims.length === 0 || new Set(claims).size !== claims.length) {
      throw new VistaProtocolError("required evidence needs distinct scoped claims");
    }
    return Object.freeze({
      evidenceId: workIdentifier(data.evidenceId),
      kind: data.kind as GovernanceEvidenceKind,
      sourceRef: workIdentifier(data.sourceRef),
      claims,
    });
  });
  if (new Set(requirements.map((entry) => entry.evidenceId)).size !== requirements.length) {
    throw new VistaProtocolError("required evidence identities must be distinct");
  }
  return Object.freeze(requirements);
}

function normalizeEffects(value: unknown): readonly PiRequiredEffect[] {
  const effects = readWorkArray(value, 128).map((entry) => {
    const data = readWorkMetadata(entry, ["binding", "effectRef", "outcome", "disposition"], "required effect");
    if (typeof data.outcome !== "string" || !EFFECT_OUTCOMES.has(data.outcome as PiRequiredEffectOutcome)) {
      throw new VistaProtocolError("required effect outcome is invalid");
    }
    return Object.freeze({
      binding: snapshotPiWorkBinding(data.binding),
      effectRef: workIdentifier(data.effectRef),
      outcome: data.outcome as PiRequiredEffectOutcome,
      disposition: disposition(data.disposition),
    });
  });
  if (new Set(effects.map((entry) => entry.effectRef)).size !== effects.length) {
    throw new VistaProtocolError("required effect references must be distinct");
  }
  return Object.freeze(effects);
}

function normalizeReadback(value: unknown): PiOwnerReadback {
  const data = readWorkMetadata(value, OWNER_READBACK_KEYS, "owner readback");
  if (typeof data.sourceKind !== "string" || !Object.hasOwn(SOURCE_EVIDENCE_KINDS, data.sourceKind)) {
    throw new VistaProtocolError("owner readback source kind is invalid");
  }
  const sourceKind = data.sourceKind as PiOwnerSourceKind;
  return Object.freeze({
    binding: snapshotPiWorkBinding(data.binding),
    sourceKind,
    sourceRef: workIdentifier(data.sourceRef),
    disposition: disposition(data.disposition),
    observedAt: timestamp(data.observedAt),
    freshUntil: timestamp(data.freshUntil),
    requiredEvidence: normalizeRequiredEvidence(data.requiredEvidence, sourceKind),
    evidence: Object.freeze(readWorkArray(data.evidence, 32).map(normalizeEvidence)),
    requiredEffects: normalizeEffects(data.requiredEffects),
  });
}

function current(observedAt: string, freshUntil: string | null | undefined, now: number): boolean {
  const observed = Date.parse(observedAt);
  return typeof freshUntil === "string" && observed <= now && now < Date.parse(freshUntil);
}

function evidenceScopeMatches(evidence: PiOwnerEvidence, binding: PiWorkBinding): boolean {
  return samePiWorkBinding(evidence.binding, binding) && evidence.record.run_id === binding.runId
    && evidence.record.source_sha === binding.headSha;
}

function requiredEvidenceProblem(readback: PiOwnerReadback, now: number): PiResultReasonCode | undefined {
  if (readback.sourceKind !== "report" && readback.requiredEvidence.length === 0) {
    return "required_evidence_not_validated";
  }
  for (const requirement of readback.requiredEvidence) {
    const candidates = readback.evidence.filter((entry) => entry.record.evidence_id === requirement.evidenceId
      && evidenceScopeMatches(entry, readback.binding));
    if (candidates.length > 1) return "required_evidence_conflict";
    const selected = candidates[0]?.record;
    if (!selected || selected.kind !== requirement.kind || selected.source_ref !== requirement.sourceRef
      || !requirement.claims.every((claim) => selected.claims.includes(claim))) {
      return "required_evidence_not_validated";
    }
    if (selected.state === "conflicting" || selected.counterevidence_refs.length > 0) return "required_evidence_conflict";
    if (selected.state !== "validated" || !current(selected.observed_at, selected.fresh_until, now)
      || Date.parse(selected.observed_at) > Date.parse(readback.observedAt)) {
      return "required_evidence_not_validated";
    }
    // Only a current, same-object/claim/source contradiction matters, not unrelated or historical pending work.
    const conflict = readback.evidence.some((entry) => {
      const other = entry.record;
      return evidenceScopeMatches(entry, readback.binding) && other.kind === requirement.kind
        && other.source_ref === requirement.sourceRef && requirement.claims.some((claim) => other.claims.includes(claim))
        && current(other.observed_at, other.fresh_until, now) && Date.parse(other.observed_at) <= Date.parse(readback.observedAt)
        && (other.state === "conflicting" || other.state === "rejected" || other.counterevidence_refs.includes(selected.evidence_id));
    });
    if (conflict) return "required_evidence_conflict";
  }
  return undefined;
}

function result(
  binding: PiWorkBinding | null, decision: PiDeliveryDecision, outcome: PiResultConsumption["outcome"],
  reasonCode: PiResultReasonCode, resultRef?: string,
): PiResultConsumption {
  return Object.freeze({ binding, ...(resultRef === undefined ? {} : { resultRef }), decision, outcome, reasonCode,
    authorization: "none", readOnly: true });
}

/** @internal Shared fail-open observation result; never fabricate a work identity. */
export function unknownPiResultConsumption(
  binding: PiWorkBinding | null, reasonCode: PiResultReasonCode, resultRef?: string,
): PiResultConsumption {
  return result(binding, "reconcile_required", "unknown", reasonCode, resultRef);
}

/**
 * Evaluate metadata from an explicitly trusted owner reader. Calling this pure
 * function with arbitrary JSON does not verify its origin. No task is written,
 * effect replayed, user receipt acknowledged or execution/Gate permission granted.
 */
export function consumePiOwnerResult(expectedBindingValue: unknown, readbackValue: unknown, now: number = Date.now()): PiResultConsumption {
  let expected: PiWorkBinding;
  try { expected = snapshotPiWorkBinding(expectedBindingValue); }
  catch { return unknownPiResultConsumption(null, "binding_invalid"); }
  if (!Number.isFinite(now) || now < 0 || now > 8.64e15) return unknownPiResultConsumption(expected, "observation_time_invalid");
  let readback: PiOwnerReadback;
  try { readback = normalizeReadback(readbackValue); }
  catch { return unknownPiResultConsumption(expected, "owner_readback_invalid"); }

  if (!samePiWorkBinding(expected, readback.binding)) return unknownPiResultConsumption(expected, "binding_mismatch");
  if (!current(readback.observedAt, readback.freshUntil, now)) return unknownPiResultConsumption(expected, "owner_readback_not_current");
  if (readback.disposition === "unknown") return unknownPiResultConsumption(expected, "owner_outcome_unknown");
  if (readback.disposition === "rejected") return result(expected, "reportable_terminal", "failed", "owner_rejected");
  if (readback.sourceKind === "code" && expected.headSha === undefined) return unknownPiResultConsumption(expected, "source_head_missing");

  const effects = readback.requiredEffects;
  if (effects.some((effect) => !samePiWorkBinding(effect.binding, expected))) return unknownPiResultConsumption(expected, "required_effect_binding_mismatch");
  if (effects.some((effect) => effect.outcome === "pending")) return unknownPiResultConsumption(expected, "required_effect_pending");
  if (effects.some((effect) => effect.outcome === "unknown" || effect.disposition === "unknown")) return unknownPiResultConsumption(expected, "required_effect_unknown");
  if (effects.some((effect) => effect.outcome !== "settled" || effect.disposition !== "accepted")) {
    return result(expected, "reportable_terminal", "failed", "required_effect_not_successful");
  }
  const evidenceProblem = requiredEvidenceProblem(readback, now);
  if (evidenceProblem) return unknownPiResultConsumption(expected, evidenceProblem);
  return result(expected, "deliverable", "accepted", "owner_acceptance_confirmed");
}
