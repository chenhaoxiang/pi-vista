import { createHash, generateKeyPairSync, sign } from "node:crypto";
import {
  createLearningLibrary, createPortableRecall,
  type ArchiveOriginPin, type ArchiveProducerConfig, type ArchiveSignRequest, type LearningSink, type PortableRecallConfig, type SafeDocument,
} from "@pi-vista/learning";
import { EXPECTED, ownerFixture, sinkFixture, verifiedExperience } from "./learning.fixtures.js";

export const BANK = "fixture-bank";
export const SCOPE = { repo: EXPECTED.repo, bank: BANK };
export function canonical(value: any): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) as string;
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
}
export const sha256 = (value: string): string => createHash("sha256").update(value, "utf8").digest("hex");
/** Synthetic ephemeral signing key; neither production config nor runtime build output. */
export function originFixture() {
  const keys = generateKeyPairSync("ed25519"); let time = 10_000; let calls = 0;
  const pin: ArchiveOriginPin = { role: "archive-origin", issuer: "fixture-archiver", key_id: "origin-key-1", repo: EXPECTED.repo, bank: BANK,
    public_key: keys.publicKey.export({ type: "spki", format: "pem" }).toString(), not_before: 0, not_after: 12_000, trust: "pinned-history" };
  const hooks: { sign?: ArchiveProducerConfig["sign"] } = {};
  const producer: ArchiveProducerConfig = { origin: pin, now: () => time, sign: (request, signal) => {
    calls++; return hooks.sign ? hooks.sign(request, signal) : Promise.resolve({ signature: sign(null, Buffer.from(request.message), keys.privateKey).toString("base64") });
  } };
  return { keys, pin, producer, hooks, calls: () => calls, setNow: (value: number) => { time = value; } };
}
export async function archiveFixture(options: { sink?: LearningSink; timeout_ms?: number } = {}) {
  const owner = ownerFixture(); const origin = originFixture(); const transport = sinkFixture();
  const library = createLearningLibrary({ verifier: owner.verifier, archive: origin.producer, sink: options.sink ?? transport.sink,
    ...(options.timeout_ms === undefined ? {} : { timeout_ms: options.timeout_ms }) });
  const verified = await verifiedExperience(library, owner);
  const plan = await library.prepareArchive(verified, BANK);
  return { owner, origin, transport, library, verified, plan };
}
export function recallFixture(origin: ReturnType<typeof originFixture>, document: SafeDocument, options: Partial<PortableRecallConfig> = {}) {
  let time = 20_000; let queries = 0; let reads = 0;
  const recall = createPortableRecall({ origins: [origin.pin], now: () => time, max_age_ms: 60_000,
    port: { query: async () => { queries++; return { documents: [{ document_id: "archive-document", bank: BANK }] }; },
      read: async ref => { reads++; return { ...ref, document }; } }, ...options });
  return { recall, setNow: (value: number) => { time = value; }, calls: () => ({ queries, reads }) };
}
export function alteredDocument(document: SafeDocument, mutate: (envelope: any) => void, origin?: ReturnType<typeof originFixture>): SafeDocument {
  const envelope = JSON.parse(document.content); mutate(envelope);
  if (origin) {
    envelope.content_digest = sha256(canonical(envelope.payload));
    envelope.signature = sign(null, Buffer.from(canonical(envelope.payload)), origin.keys.privateKey).toString("base64");
  }
  const content = canonical(envelope); return { ...document, content, content_digest: sha256(content) };
}
export const signedResponse = (origin: ReturnType<typeof originFixture>, request: ArchiveSignRequest): { signature: string } =>
  ({ signature: sign(null, Buffer.from(request.message), origin.keys.privateKey).toString("base64") });
