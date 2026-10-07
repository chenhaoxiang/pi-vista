import { createPublicKey, verify as verifySignature, type KeyObject } from "node:crypto";
import { types } from "node:util";
import type { ReceiptSummary } from "@pi-vista/evidence";
import { LearningError, MAX_DOCUMENT_CHARACTERS, type FailureObservation, type SafeDocument } from "./contract.js";
import type { ArchiveOrigin, ArchiveOriginPin, ArchivePayload, ArchiveProducerConfig, ArchiveScope, ArchiveSignRequest, SafeExperienceSnapshot } from "./portable-contract.js";
import { bindingOf, bounded, canonical, choice, digest, frozen, hash, integer, invalid, label, list, own } from "./data.js";
import { observation } from "./input.js";
import { classifyFailure } from "./failure.js";

export interface OriginPin extends ArchiveOrigin { readonly key: KeyObject; readonly not_before: number; readonly not_after: number; readonly trust: ArchiveOriginPin["trust"]; }
export interface ArchiveProducer { readonly pin: OriginPin; readonly now: () => number; readonly sign: ArchiveProducerConfig["sign"]; }
export function callback<T>(input: unknown): T {
  if (typeof input !== "function" || types.isProxy(input)) invalid(); return input as T;
}
/** A host clock is trusted, but a detected rollback cannot resurrect history in this instance. */
export function clock(input: unknown): () => number {
  const now = callback<() => number>(input); let last = integer(now());
  return () => { const value = integer(now()); if (value < last) invalid(); last = value; return value; };
}
export function origin(input: unknown): ArchiveOrigin {
  const v = own(input, ["role", "issuer", "key_id", "repo", "bank"]);
  if (v.role !== "archive-origin") invalid();
  return frozen({ role: "archive-origin", issuer: label(v.issuer), key_id: label(v.key_id), repo: label(v.repo), bank: label(v.bank) });
}
export function originOf(pin: ArchiveOrigin): ArchiveOrigin {
  return origin({ role: pin.role, issuer: pin.issuer, key_id: pin.key_id, repo: pin.repo, bank: pin.bank });
}
export function scope(input: unknown): ArchiveScope {
  const v = own(input, ["repo", "bank"]); return frozen({ repo: label(v.repo), bank: label(v.bank) });
}
export function pin(input: unknown): OriginPin {
  const v = own(input, ["role", "issuer", "key_id", "repo", "bank", "public_key", "not_before", "not_after", "trust"]);
  const o = origin({ role: v.role, issuer: v.issuer, key_id: v.key_id, repo: v.repo, bank: v.bank });
  if (typeof v.public_key !== "string" || v.public_key.length > 4096 ||
    !/^-----BEGIN PUBLIC KEY-----\n[A-Za-z0-9+/=\n]+\n-----END PUBLIC KEY-----\n?$/u.test(v.public_key)) invalid();
  const key = createPublicKey(v.public_key);
  if (key.type !== "public" || key.asymmetricKeyType !== "ed25519" ||
    key.export({ type: "spki", format: "pem" }).toString().trim() !== v.public_key.trim()) invalid();
  const start = integer(v.not_before); const end = integer(v.not_after); if (end <= start) invalid();
  return frozen({ ...o, key, not_before: start, not_after: end, trust: choice(v.trust, ["pinned-history", "revoked"]) });
}
export function sameOrigin(a: ArchiveOrigin, b: ArchiveOrigin): boolean {
  return a.role === b.role && a.issuer === b.issuer && a.key_id === b.key_id && a.repo === b.repo && a.bank === b.bank;
}
export function originIdentity(o: ArchiveOrigin): string { return canonical(originOf(o)); }
export function producer(input: unknown): ArchiveProducer {
  const v = own(input, ["origin", "now", "sign"]);
  const p = pin(v.origin); const now = clock(v.now);
  if (p.trust !== "pinned-history") invalid();
  return frozen({ pin: p, now, sign: callback<ArchiveProducerConfig["sign"]>(v.sign) });
}
export function experience(input: unknown): SafeExperienceSnapshot {
  const required = ["experience_id", "run_id", "repo", "source_sha", "policy_version", "env_fingerprint", "task_type", "ts", "script", "steps"];
  const v = own(input, [...required, "model_id", "failure_analysis"], required);
  let failure: FailureObservation | undefined;
  if (v.failure_analysis !== undefined) {
    const f = own(v.failure_analysis, ["authorization", "verification", "failure_id", "run_id", "step_id", "ts", "stage", "reason_code", "failure_type", "root_cause", "root_cause_basis", "hypotheses", "fix_applied", "fix_outcome"],
      ["authorization", "verification", "failure_id", "run_id", "step_id", "ts", "stage", "reason_code", "failure_type", "root_cause", "root_cause_basis", "hypotheses"]);
    const observed = { failure_id: f.failure_id, run_id: f.run_id, step_id: f.step_id, ts: f.ts, stage: f.stage, reason_code: f.reason_code, hypotheses: f.hypotheses,
      ...(f.fix_applied === undefined ? {} : { fix_applied: f.fix_applied }), ...(f.fix_outcome === undefined ? {} : { fix_outcome: f.fix_outcome }) } as FailureObservation;
    const classified = classifyFailure(observed);
    for (const field of ["authorization", "verification", "failure_type", "root_cause", "root_cause_basis"] as const) {
      if (f[field] !== classified[field]) invalid();
    }
    const hypotheses = list(f.hypotheses, 16);
    if (hypotheses.length !== classified.hypotheses.length || hypotheses.some((item, index) => item !== classified.hypotheses[index])) invalid();
    failure = observed;
  }
  // This is the same script/step/metadata decoder used by live observation, never a second permissive schema.
  return observation({ ...bindingOf(v as unknown as SafeExperienceSnapshot), experience_id: v.experience_id, task_type: v.task_type, ts: v.ts, script: v.script, steps: v.steps,
    ...(v.model_id === undefined ? {} : { model_id: v.model_id }), ...(failure === undefined ? {} : { failure_analysis: failure }) } as Parameters<typeof observation>[0]);
}
export function receipts(input: unknown): readonly ReceiptSummary[] {
  const kinds = ["gate", "test", "guard"] as const;
  return frozen(list(input, 3, 3).map((item, index) => {
    const v = own(item, ["kind", "issuer", "receipt_ref", "content_digest", "expires_at"]);
    if (v.kind !== kinds[index]) invalid();
    return frozen({ kind: kinds[index]!, issuer: label(v.issuer), receipt_ref: label(v.receipt_ref), content_digest: digest(v.content_digest), expires_at: integer(v.expires_at) });
  }));
}
export function payload(input: unknown): ArchivePayload {
  const v = own(input, ["schema", "purpose", "authorization", "executable", "origin", "archived_at", "source_status_at_archive", "experience", "evidence"]);
  if (v.schema !== 1 || v.purpose !== "portable-experience-history" || v.authorization !== "none" || v.executable !== false) invalid();
  const o = origin(v.origin); const e = experience(v.experience); const evidence = receipts(v.evidence); const time = integer(v.archived_at);
  if (o.repo !== e.repo || evidence.some(receipt => receipt.expires_at <= time)) invalid();
  return frozen({ schema: 1, purpose: "portable-experience-history", authorization: "none", executable: false,
    origin: o, archived_at: time, source_status_at_archive: choice(v.source_status_at_archive, ["verified", "trusted"]), experience: e, evidence });
}
export function signature(input: unknown): string {
  if (typeof input !== "string" || input.length !== 88 || !/^[A-Za-z0-9+/]{86}==$/u.test(input)) invalid();
  const bytes = Buffer.from(input, "base64"); if (bytes.length !== 64 || bytes.toString("base64") !== input) invalid(); return input;
}
export function authenticateSignature(p: ArchivePayload, declared: unknown, sig: unknown, key: OriginPin): string {
  const message = canonical(p); const contentDigest = digest(declared); const encoded = signature(sig);
  if (hash(message) !== contentDigest || !sameOrigin(p.origin, key) || key.trust !== "pinned-history" ||
    p.archived_at < key.not_before || p.archived_at >= key.not_after ||
    !verifySignature(null, Buffer.from(message, "utf8"), key.key, Buffer.from(encoded, "base64"))) invalid();
  return contentDigest;
}
function title(p: ArchivePayload): string { return `Historical ${p.experience.failure_analysis === undefined ? "skill" : "failure"}: ${p.experience.experience_id}`; }
function tag(p: ArchivePayload): "knowledge:skill" | "knowledge:failure" { return p.experience.failure_analysis === undefined ? "knowledge:skill" : "knowledge:failure"; }
export function document(p: ArchivePayload, sig: string): SafeDocument {
  const content = canonical({ payload: p, content_digest: hash(canonical(p)), signature: sig });
  if (content.length > MAX_DOCUMENT_CHARACTERS) invalid();
  return frozen({ title: title(p), content, tags: frozen([tag(p)]), content_digest: hash(content) });
}
export function decodeDocument(input: unknown): { readonly payload: ArchivePayload; readonly archive_digest: string; readonly signature: string } {
  const v = own(input, ["title", "content", "tags", "content_digest"]);
  if (typeof v.content !== "string" || v.content.length > MAX_DOCUMENT_CHARACTERS || v.content.length === 0) invalid();
  const envelope = own(JSON.parse(v.content) as unknown, ["payload", "content_digest", "signature"]);
  const p = payload(envelope.payload); const contentDigest = digest(envelope.content_digest); const sig = signature(envelope.signature);
  if (canonical({ payload: p, content_digest: contentDigest, signature: sig }) !== v.content || hash(canonical(p)) !== contentDigest ||
    digest(v.content_digest) !== hash(v.content) || v.title !== title(p) || list(v.tags, 1, 1)[0] !== tag(p)) invalid();
  return frozen({ payload: p, archive_digest: contentDigest, signature: sig });
}
export async function signDocument(p: ArchivePayload, host: ArchiveProducer, timeout: number): Promise<SafeDocument> {
  const message = canonical(p); const contentDigest = hash(message);
  // Reject oversized safe metadata before handing anything to the signer.
  if (message.length + 256 > MAX_DOCUMENT_CHARACTERS) invalid();
  const request: ArchiveSignRequest = frozen({ ...p.origin, message, content_digest: contentDigest });
  const result = await bounded(signal => host.sign(request, signal), timeout, value => {
    const v = own(value, ["signature"]); const sig = signature(v.signature);
    authenticateSignature(p, contentDigest, sig, host.pin); return frozen({ signature: sig });
  });
  return document(p, result.signature);
}
export function requireProducerTime(p: ArchivePayload, host: ArchiveProducer): void {
  try {
    const now = host.now();
    if (p.archived_at > now || now < host.pin.not_before || now >= host.pin.not_after || host.pin.trust !== "pinned-history") invalid();
  } catch { throw new LearningError("unverified-archive"); }
}
