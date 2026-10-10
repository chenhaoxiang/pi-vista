import { LearningError, type ExperienceObservation } from "../contract.js";
import { canonical, digest, frozen, hash, invalid, label, own } from "../data.js";
import { document, prepareGuidanceDocument, writeRequest } from "../guidance/data.js";
import type { GuidanceReadback, GuidanceReceipt, GuidanceReference } from "../guidance/contract.js";

const REFERENCE_KEYS = ["bank", "document_id", "current_verification", "authorization", "executable"];
export function snapshotReference(input: unknown): GuidanceReference | GuidanceReceipt {
  const v = own(input, [...REFERENCE_KEYS, "content_digest", "idempotency_key"], REFERENCE_KEYS);
  if (v.current_verification !== "not-checked" || v.authorization !== "none" || v.executable !== false ||
      typeof v.document_id !== "string" || !/^vista-guidance-v1-[a-f0-9]{16}-[a-f0-9]{64}$/u.test(v.document_id) ||
      Object.hasOwn(v, "content_digest") !== Object.hasOwn(v, "idempotency_key")) invalid();
  const base = { bank: label(v.bank), document_id: v.document_id, current_verification: "not-checked" as const,
    authorization: "none" as const, executable: false as const };
  if (!Object.hasOwn(v, "content_digest")) return frozen(base);
  if (typeof v.idempotency_key !== "string" || !/^guidance-[a-f0-9]{64}$/u.test(v.idempotency_key) ||
      v.document_id.slice(-64) !== hash(v.idempotency_key)) invalid();
  return frozen({ ...base, content_digest: digest(v.content_digest), idempotency_key: v.idempotency_key });
}
export function receipt(input: unknown, bank: string, doc: Parameters<typeof document>[0]): GuidanceReceipt {
  const safe = snapshotReference(input);
  const request = writeRequest(bank, doc);
  if (!("content_digest" in safe) || safe.bank !== bank || safe.content_digest !== request.document.content_digest ||
      safe.idempotency_key !== request.idempotency_key) throw new LearningError("sink-mismatch");
  return safe;
}
export function readback(input: unknown, expected: GuidanceReference | GuidanceReceipt): GuidanceReadback {
  const v = own(input, [...REFERENCE_KEYS, "content_digest", "idempotency_key", "document", "guidance"]);
  const decoded = document(v.document);
  const safe = receipt(Object.fromEntries([...REFERENCE_KEYS, "content_digest", "idempotency_key"].map(key => [key, v[key]])), expected.bank, decoded.document);
  const g = own(v.guidance, ["schema", "purpose", "current_verification", "authorization", "executable", "experience"]);
  if (g.schema !== 1 || g.purpose !== "historical-guidance" || g.current_verification !== "not-checked" ||
      g.authorization !== "none" || g.executable !== false || safe.document_id !== expected.document_id ||
      canonical(document(prepareGuidanceDocument(g.experience as ExperienceObservation)).guidance) !== canonical(decoded.guidance) ||
      ("content_digest" in expected && (safe.content_digest !== expected.content_digest || safe.idempotency_key !== expected.idempotency_key)))
    throw new LearningError("sink-mismatch");
  return frozen({ ...safe, document: decoded.document, guidance: decoded.guidance });
}
