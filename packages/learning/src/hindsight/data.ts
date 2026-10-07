import { types } from "node:util";
import { LearningError, MAX_DOCUMENT_CHARACTERS, type IngestRequest, type SafeDocument, type SinkReceipt } from "../contract.js";
import { canonical, digest, frozen, hash, invalid, label, list, own } from "../data.js";
import { correction } from "../input.js";
import { decodeDocument, experience, receipts } from "../portable-data.js";

export function storageRequest(input: unknown): IngestRequest {
  const v = own(input, ["bank", "title", "content", "tags", "content_digest", "idempotency_key"]);
  const bank = label(v.bank);
  if (typeof v.content !== "string" || !v.content.length || v.content.length > MAX_DOCUMENT_CHARACTERS) invalid();
  const contentDigest = digest(v.content_digest); if (hash(v.content) !== contentDigest) invalid();
  const tags = list(v.tags, 1, 1); let title: string; let tag: SafeDocument["tags"][number]; let prefix: string;
  if (typeof v.idempotency_key === "string" && v.idempotency_key.startsWith("archive-")) {
    const decoded = decodeDocument({ title: v.title, content: v.content, tags, content_digest: contentDigest });
    if (decoded.payload.origin.bank !== bank) invalid();
    title = v.title as string; tag = tags[0] as SafeDocument["tags"][number]; prefix = "archive";
  } else {
    const p = own(JSON.parse(v.content) as unknown, ["schema", "authorization", "purpose", "experience", "evidence", "correction"],
      ["schema", "authorization", "purpose", "experience", "evidence"]);
    if (p.schema !== 1 || p.authorization !== "none" || !["verified_experience", "correction"].includes(p.purpose as string)) invalid();
    const e = experience(p.experience); const evidence = receipts(p.evidence);
    const fix = p.purpose === "correction" ? correction(p.correction as Parameters<typeof correction>[0]) : undefined;
    if ((fix === undefined && Object.hasOwn(p, "correction")) || (fix !== undefined &&
      (!e.failure_analysis || fix.failure_id !== e.failure_analysis.failure_id || e.failure_analysis.fix_outcome !== "resolved"))) invalid();
    if (canonical({ schema: 1, authorization: "none", purpose: p.purpose, experience: e, evidence,
      ...(fix === undefined ? {} : { correction: fix }) }) !== v.content) invalid();
    tag = fix !== undefined || e.failure_analysis !== undefined ? "knowledge:failure" : "knowledge:skill";
    title = `${fix === undefined ? (tag === "knowledge:failure" ? "Failure pattern" : "Verified skill") : "Correction"}: ${e.experience_id}`;
    if (v.title !== title || tags[0] !== tag) invalid(); prefix = "learning";
  }
  const document: SafeDocument = frozen({ title, content: v.content, tags: frozen([tag]), content_digest: contentDigest });
  const identity = `${prefix}-${hash(canonical({ bank, document }))}`;
  if (v.idempotency_key !== identity || v.content_digest !== contentDigest) invalid();
  return frozen({ bank, ...document, idempotency_key: identity });
}
export function targetFingerprint(endpoint: string, bank: string, bankId: string): string {
  return hash(canonical({ endpoint, bank, bank_id: bankId }));
}
export function documentPrefix(target: string): string { return `vista-v1-${target.slice(0, 16)}-`; }
export function documentId(request: IngestRequest, target: string): string { return `${documentPrefix(target)}${hash(request.idempotency_key)}`; }
export function scopedId(input: unknown, target: string): string {
  if (typeof input !== "string" || !input.startsWith(documentPrefix(target)) || !/^[a-f0-9]{64}$/u.test(input.slice(documentPrefix(target).length))) invalid();
  return input;
}
export function storageEnvelope(request: IngestRequest, target: string): string {
  return canonical({ schema: 1, purpose: "pi-vista-hindsight-original", target_fingerprint: target, document_id: documentId(request, target), request });
}
export function originalRequest(text: unknown, target: string, id: string): IngestRequest {
  if (typeof text !== "string" || text.length > 262_144 || !text.length) invalid();
  const e = own(JSON.parse(text) as unknown, ["schema", "purpose", "target_fingerprint", "document_id", "request"]);
  const request = storageRequest(e.request);
  if (e.schema !== 1 || e.purpose !== "pi-vista-hindsight-original" || e.target_fingerprint !== target || e.document_id !== id ||
    documentId(request, target) !== id || storageEnvelope(request, target) !== text) invalid();
  return request;
}
export function receiptOf(request: IngestRequest, target: string): SinkReceipt {
  return frozen({ document_id: documentId(request, target), bank: request.bank, content_digest: request.content_digest, idempotency_key: request.idempotency_key });
}
const aborted = Object.getOwnPropertyDescriptor(AbortSignal.prototype, "aborted")!.get!;
export function validSignal(input: unknown): AbortSignal {
  if (types.isProxy(input) || input === null || typeof input !== "object" || Object.getPrototypeOf(input) !== AbortSignal.prototype) invalid();
  aborted.call(input); return input as AbortSignal;
}
/** Native HTTP abort/byte bounds; filesystem sync and host scheduler delays cannot be preempted. */
export async function storeOperation<T>(signal: AbortSignal, timeout: number, call: (signal: AbortSignal, check: () => void) => Promise<T>): Promise<T> {
  const controller = new AbortController(); let timedOut = false; const start = performance.now();
  const cancel = (): void => controller.abort();
  EventTarget.prototype.addEventListener.call(signal, "abort", cancel, { once: true });
  const timer = setTimeout(() => { timedOut = true; cancel(); }, timeout);
  const check = (): void => {
    if (timedOut || performance.now() - start >= timeout) throw new LearningError("sink-timeout");
    if (aborted.call(signal) || controller.signal.aborted) throw new LearningError("sink-failed");
  };
  try { check(); const result = await call(controller.signal, check); check(); return result; }
  catch (error) {
    if (timedOut || performance.now() - start >= timeout) throw new LearningError("sink-timeout");
    if (error instanceof LearningError && ["sink-failed", "sink-timeout", "sink-mismatch"].includes(error.code)) throw error;
    throw new LearningError("sink-failed");
  } finally { clearTimeout(timer); EventTarget.prototype.removeEventListener.call(signal, "abort", cancel); }
}
