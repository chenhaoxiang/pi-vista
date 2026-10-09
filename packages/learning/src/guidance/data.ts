import { MAX_DOCUMENT_CHARACTERS, MAX_LIST_ITEMS, type ExperienceObservation, type FailureObservation } from "../contract.js";
import { canonical, digest, frozen, hash, invalid, label, list, own } from "../data.js";
import { observation } from "../input.js";
import type { GuidanceDocument, GuidanceReceipt, GuidanceReference, HistoricalGuidance } from "./contract.js";

/** Reuse raw-observation validation; do not encode derived analysis as raw facts. */
function rawObservation(input: unknown): ExperienceObservation {
  const safe = observation(input as ExperienceObservation);
  const { failure_analysis: analysis, ...base } = safe;
  if (analysis === undefined) return frozen(base);
  const original = own(input, ["experience_id", "run_id", "repo", "source_sha", "policy_version", "env_fingerprint", "task_type", "ts", "script", "steps", "model_id", "failure_analysis"], []);
  const raw = own(original.failure_analysis, ["failure_id", "run_id", "step_id", "ts", "stage", "reason_code", "hypotheses", "fix_applied", "fix_outcome"],
    ["failure_id", "run_id", "step_id", "ts", "stage", "reason_code"]);
  const failure: FailureObservation = frozen({ failure_id: analysis.failure_id, run_id: analysis.run_id, step_id: analysis.step_id,
    ts: analysis.ts, stage: analysis.stage, reason_code: analysis.reason_code,
    ...(raw.hypotheses === undefined ? {} : { hypotheses: frozen(list(raw.hypotheses, MAX_LIST_ITEMS).map(value => value as NonNullable<FailureObservation["hypotheses"]>[number])) }),
    ...(analysis.fix_applied === undefined ? {} : { fix_applied: analysis.fix_applied, fix_outcome: analysis.fix_outcome! }) });
  return frozen({ ...base, failure_analysis: failure });
}
function encode(experience: ExperienceObservation): HistoricalGuidance {
  return frozen({ schema: 1, purpose: "historical-guidance", current_verification: "not-checked",
    authorization: "none", executable: false, experience });
}
export function prepareGuidanceDocument(input: ExperienceObservation): GuidanceDocument {
  const experience = rawObservation(input); const content = canonical(encode(experience));
  if (content.length > MAX_DOCUMENT_CHARACTERS) invalid();
  return frozen({ title: `Historical guidance: ${experience.experience_id}`, content,
    tags: frozen(["pi-vista:guidance-v1"] as const), content_digest: hash(content) });
}
export function document(input: unknown): { readonly document: GuidanceDocument; readonly guidance: HistoricalGuidance } {
  const v = own(input, ["title", "content", "tags", "content_digest"]);
  if (typeof v.content !== "string" || !v.content.length || v.content.length > MAX_DOCUMENT_CHARACTERS) invalid();
  const contentDigest = digest(v.content_digest); if (hash(v.content) !== contentDigest) invalid();
  const parsed = own(JSON.parse(v.content), ["schema", "purpose", "current_verification", "authorization", "executable", "experience"]);
  if (parsed.schema !== 1 || parsed.purpose !== "historical-guidance" || parsed.current_verification !== "not-checked" ||
      parsed.authorization !== "none" || parsed.executable !== false) invalid();
  const expected = prepareGuidanceDocument(parsed.experience as ExperienceObservation);
  const tags = list(v.tags, 1, 1);
  if (expected.content !== v.content || expected.title !== v.title || tags[0] !== expected.tags[0] || v.content_digest !== expected.content_digest) invalid();
  return frozen({ document: expected, guidance: encode(rawObservation(parsed.experience)) });
}
export interface WriteRequest { readonly bank: string; readonly document: GuidanceDocument; readonly idempotency_key: string; }
export function writeRequest(bank: unknown, input: unknown): WriteRequest {
  const alias = label(bank); const safe = document(input).document;
  return frozen({ bank: alias, document: safe, idempotency_key: `guidance-${hash(canonical({ bank: alias, document: safe }))}` });
}
export function prefix(target: string): string { return `vista-guidance-v1-${target.slice(0, 16)}-`; }
export function documentId(request: WriteRequest, target: string): string { return `${prefix(target)}${hash(request.idempotency_key)}`; }
export function scopedId(input: unknown, target: string): string {
  if (typeof input !== "string" || !input.startsWith(prefix(target)) || !/^[a-f0-9]{64}$/u.test(input.slice(prefix(target).length))) invalid();
  return input;
}
export function envelope(request: WriteRequest, target: string): string {
  return canonical({ schema: 1, purpose: "pi-vista-hindsight-guidance", target_fingerprint: target, document_id: documentId(request, target), request });
}
export function original(text: unknown, target: string, id: string): WriteRequest {
  if (typeof text !== "string" || !text.length || text.length > 262_144) invalid();
  const v = own(JSON.parse(text), ["schema", "purpose", "target_fingerprint", "document_id", "request"]);
  const raw = own(v.request, ["bank", "document", "idempotency_key"]); const request = writeRequest(raw.bank, raw.document);
  if (v.schema !== 1 || v.purpose !== "pi-vista-hindsight-guidance" || v.target_fingerprint !== target || v.document_id !== id ||
      raw.idempotency_key !== request.idempotency_key || documentId(request, target) !== id || envelope(request, target) !== text) invalid();
  return request;
}
export function reference(bank: string, id: string): GuidanceReference {
  return frozen({ bank, document_id: id, current_verification: "not-checked", authorization: "none", executable: false });
}
export function receipt(request: WriteRequest, target: string): GuidanceReceipt {
  return frozen({ ...reference(request.bank, documentId(request, target)), content_digest: request.document.content_digest, idempotency_key: request.idempotency_key });
}
