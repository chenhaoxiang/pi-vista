import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { createEvidenceVerifier, evidenceMessage, type EvidenceBinding, type EvidenceKind } from "@pi-vista/evidence";
import { createLearningLibrary, type ExperienceObservation, type IngestRequest, type LearningLibrary, type LearningSink, type SinkReceipt } from "@pi-vista/learning";

export const EXPECTED: EvidenceBinding = { run_id: "run-1", repo: "fixture-repo", source_sha: "a".repeat(40), policy_version: "policy-1", env_fingerprint: "env-1" };
export const SUBJECTS = { gate: "gate-1", test: "suite-1", guard: "guard-1" };
export const QUERY = { repo: EXPECTED.repo, source_sha: EXPECTED.source_sha, policy_version: EXPECTED.policy_version, env_fingerprint: EXPECTED.env_fingerprint, task_type: "metadata-update" };

/** Synthetic generated owner keys and in-memory receipts only; excluded from the runtime build. */
export function ownerFixture(expected: EvidenceBinding = EXPECTED) {
  let now = 10_000; const keys = generateKeyPairSync("ed25519");
  // Deliberately mutable fixture payloads allow signed and unsigned corruption tests.
  const payloads: Record<EvidenceKind, any> = {
    gate: { schema: 1, kind: "gate", issuer: "fixture-owner", ...expected, receipt_ref: "gate-ref", issued_at: 9_000, expires_at: 15_000,
      details: { verdict: "pass", gate_version: "b".repeat(40), config_digest: "c".repeat(64), checks: [{ name: "ci-check", outcome: "pass" }] } },
    test: { schema: 1, kind: "test", issuer: "fixture-owner", ...expected, receipt_ref: "suite-ref", issued_at: 9_000, expires_at: 15_000,
      details: { suites: [{ name: "unit-suite", total: 3, passed: 3, failed: 0, skipped: 0, cancelled: 0 }] } },
    guard: { schema: 1, kind: "guard", issuer: "fixture-owner", ...expected, receipt_ref: "guard-ref", issued_at: 9_000, expires_at: 15_000,
      details: { coverage: "complete", event_count: 5, blocked: 0 } },
  };
  const receipts: Record<EvidenceKind, any> = { gate: null, test: null, guard: null };
  function seal(kind: EvidenceKind) {
    const message = evidenceMessage(payloads[kind]); receipts[kind] = { payload: payloads[kind], content_digest: createHash("sha256").update(message).digest("hex"),
      signature: sign(null, Buffer.from(message), keys.privateKey).toString("base64") };
  }
  for (const kind of ["gate", "test", "guard"] as const) seal(kind);
  const calls = { gate: 0, test: 0, guard: 0 };
  const hooks: Partial<Record<EvidenceKind, (signal: AbortSignal) => Promise<unknown>>> = {};
  const verifier = createEvidenceVerifier({
    sources: (["gate", "test", "guard"] as const).map(kind => ({ subject: SUBJECTS[kind], kind, issuer: "fixture-owner",
      public_key: keys.publicKey.export({ type: "spki", format: "pem" }).toString(),
      read: (signal: AbortSignal) => { calls[kind]++; return hooks[kind] ? hooks[kind]!(signal) : Promise.resolve(receipts[kind]); } })),
    gate_checks: ["ci-check"], gate_version: "b".repeat(40), gate_config_digest: "c".repeat(64), test_suites: ["unit-suite"],
    now: () => now, max_age_ms: 10_000, timeout_ms: 50,
  });
  return { verifier, expected, payloads, receipts, seal, calls, hooks, setNow: (value: number) => { now = value; } };
}
export function sampleObservation(id = "experience-1", expected: EvidenceBinding = EXPECTED): ExperienceObservation {
  return { ...expected, experience_id: id, task_type: "metadata-update", ts: 9_500, model_id: "model-fixture",
    script: { task_type: "metadata-update", description: "bounded metadata validation", preconditions: ["source-bound"], steps: ["inspect-metadata", "validate-metadata"],
      postconditions: ["validated"], known_failures: [{ symptom: "stale-source", mitigation: "refetch-evidence" }], applicable_to: ["metadata-repair"] },
    steps: [{ step_id: "step-1", tool: "metadata-reader", action_description: "inspect bounded metadata", check_fn_ids: ["source-bound"], expected_result: "observed", on_failure: "stop", depends_on: [] },
      { step_id: "step-2", tool: "metadata-validator", action_description: "validate bounded metadata", check_fn_ids: ["receipt-bound"], expected_result: "validated", on_failure: "escalate", depends_on: ["step-1"] }] };
}
export function sinkFixture() {
  let ingests = 0; let readbacks = 0; const requests: IngestRequest[] = []; const seenReceipts: SinkReceipt[] = [];
  const stored = new Map<string, IngestRequest>();
  const sink: LearningSink = {
    ingest: async request => { ingests++; requests.push(request); stored.set(request.idempotency_key, request);
      return { document_id: `document-${ingests}`, bank: request.bank, content_digest: request.content_digest, idempotency_key: request.idempotency_key }; },
    readback: async receipt => { readbacks++; seenReceipts.push(receipt); const request = stored.get(receipt.idempotency_key)!;
      return { ...receipt, title: request.title, content: request.content, tags: request.tags }; },
  };
  return { sink, requests, seenReceipts, counts: () => ({ ingests, readbacks }) };
}
export async function verifiedExperience(library: LearningLibrary, owner: ReturnType<typeof ownerFixture>, id = "experience-1") {
  const candidate = library.nominate(library.observe(sampleObservation(id, owner.expected)));
  const proof = await owner.verifier.verify(owner.expected, SUBJECTS);
  return library.verifyCandidate(candidate, proof);
}
export async function learningFixture() {
  const owner = ownerFixture(); const transport = sinkFixture(); const library = createLearningLibrary({ verifier: owner.verifier, sink: transport.sink });
  const verified = await verifiedExperience(library, owner);
  return { owner, transport, library, verified };
}
export function deferred<T>() {
  let resolve!: (value: T) => void; let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
