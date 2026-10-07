import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { readFile, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createEvidenceVerifier, evidenceMessage, type EvidenceBinding, type EvidenceKind } from "@pi-vista/evidence";
import {
  createLearningLibrary, createPortableRecall, LearningError,
  type ArchiveOriginPin, type ExperienceObservation, type IngestRequest, type SafeDocument,
} from "@pi-vista/learning";

// Executed only as a test child, also compiled/run from exact installed tarballs.
// No key, real session, owner service, environment config or network input is used.
const [role, directory, installedRoot] = process.argv.slice(2);
assert.ok(directory && path.isAbsolute(directory));
const root = await realpath(directory);
const learningEntry = await realpath(fileURLToPath(import.meta.resolve("@pi-vista/learning")));
const evidenceEntry = await realpath(fileURLToPath(import.meta.resolve("@pi-vista/evidence")));
if (installedRoot) {
  assert.equal(learningEntry, path.join(installedRoot, "@pi-vista/learning/dist/index.js"));
  assert.equal(evidenceEntry, path.join(installedRoot, "@pi-vista/evidence/dist/index.js"));
}
const bank = "restart-bank";
const original: EvidenceBinding = { run_id: "producer-run", repo: "restart-repo", source_sha: "a".repeat(40), policy_version: "policy-1", env_fingerprint: "env-1" };
const subjects = { gate: "restart-gate", test: "restart-test", guard: "restart-guard" };
const retrievalQuery = { repo: original.repo, source_sha: original.source_sha, policy_version: original.policy_version, env_fingerprint: original.env_fingerprint, task_type: "metadata-update" };
const query = { ...retrievalQuery, bank };
const digest = (value: string): string => createHash("sha256").update(value).digest("hex");
const fails = (error: unknown): boolean => error instanceof LearningError && error.code === "unverified-evidence";
function currentOwner(expected: EvidenceBinding, time: number) {
  // Fresh owner keys in this child only, never the archived origin key or old process key.
  const keys = generateKeyPairSync("ed25519"); let now = time; let reads = 0;
  const details = {
    gate: { verdict: "pass", gate_version: "b".repeat(40), config_digest: "c".repeat(64), checks: [{ name: "source-check", outcome: "pass" }] },
    test: { suites: [{ name: "unit-suite", total: 3, passed: 3, failed: 0, skipped: 0, cancelled: 0 }] },
    guard: { coverage: "complete", event_count: 5, blocked: 0 },
  };
  const verifier = createEvidenceVerifier({ sources: (["gate", "test", "guard"] as const).map((kind: EvidenceKind) => {
    const payload = { schema: 1, kind, issuer: "restart-owner", ...expected, receipt_ref: `ref-${kind}`, issued_at: time - 1000, expires_at: time + 5000, details: details[kind] };
    const message = evidenceMessage(payload);
    const receipt = { payload, content_digest: digest(message), signature: sign(null, Buffer.from(message), keys.privateKey).toString("base64") };
    return { subject: subjects[kind], issuer: "restart-owner", kind, public_key: keys.publicKey.export({ type: "spki", format: "pem" }).toString(),
      read: async () => { reads++; return receipt; } };
  }), gate_checks: ["source-check"], gate_version: "b".repeat(40), gate_config_digest: "c".repeat(64), test_suites: ["unit-suite"], now: () => now, max_age_ms: 10_000 });
  return { verifier, reads: () => reads, setNow: (value: number) => { now = value; } };
}
const observation: ExperienceObservation = { ...original, experience_id: "restart-experience", task_type: "metadata-update", ts: 9500,
  script: { task_type: "metadata-update", description: "bounded metadata validation", preconditions: ["source-bound"], steps: ["inspect-metadata"], postconditions: ["validated"], known_failures: [], applicable_to: [] },
  steps: [{ step_id: "step-1", tool: "metadata-validator", action_description: "validate bounded metadata", check_fn_ids: ["source-bound"], expected_result: "validated", on_failure: "stop", depends_on: [] }] };
if (role === "producer") {
  const owner = currentOwner(original, 10_000); const keys = generateKeyPairSync("ed25519");
  const pin: ArchiveOriginPin = { role: "archive-origin", issuer: "restart-archiver", key_id: "restart-origin", repo: original.repo, bank,
    public_key: keys.publicKey.export({ type: "spki", format: "pem" }).toString(), not_before: 0, not_after: 12_000, trust: "pinned-history" };
  let ingests = 0; let readbacks = 0;
  const library = createLearningLibrary({ verifier: owner.verifier, archive: { origin: pin, now: () => 10_000,
    sign: async request => ({ signature: sign(null, Buffer.from(request.message), keys.privateKey).toString("base64") }) },
    sink: {
      ingest: async (request: IngestRequest) => {
        ingests++; const persisted = { document_id: "restart-document", ...request };
        // File-backed mock Hindsight, never a real bank. Only exact safe derived documents.
        await writeFile(path.join(root, "document.json"), JSON.stringify(persisted), { flag: "wx" });
        return { document_id: persisted.document_id, bank: persisted.bank, content_digest: persisted.content_digest, idempotency_key: persisted.idempotency_key };
      },
      readback: async receipt => {
        readbacks++; const stored = JSON.parse(await readFile(path.join(root, "document.json"), "utf8"));
        return { ...receipt, title: stored.title, content: stored.content, tags: stored.tags };
      },
    } });
  const candidate = library.nominate(library.observe(observation));
  const verified = library.verifyCandidate(candidate, await owner.verifier.verify(original, subjects));
  const preview = await library.prepareArchive(verified, bank); assert.equal(ingests, 0); assert.equal(readbacks, 0);
  const upload = await library.commitArchive(preview, { preview_digest: preview.preview_digest });
  assert.equal(upload.persistence, "host-readback-matched"); assert.equal(upload.authorization, "none");
  assert.equal(verified.status, "verified"); assert.equal(library.retrieve([verified], retrievalQuery).handles.length, 1);
  await writeFile(path.join(root, "pin.json"), JSON.stringify(pin), { flag: "wx" });
  assert.equal(owner.reads(), 9); assert.equal(ingests, 1); assert.equal(readbacks, 1);
  console.log(JSON.stringify({ role, pid: process.pid, node: process.version, learningEntry, evidenceEntry, archive_digest: preview.archive_digest,
    document_digest: preview.document.content_digest, owner_reads: owner.reads(), ingests, readbacks, authorization: upload.authorization }));
} else if (role === "consumer") {
  // Nothing from the old process survives except public pins and persisted safe port data.
  const pin: ArchiveOriginPin = JSON.parse(await readFile(path.join(root, "pin.json"), "utf8")); let queries = 0; let reads = 0;
  const recall = createPortableRecall({ origins: [pin], now: () => 20_000, max_age_ms: 60_000,
    port: { query: async () => { queries++; return { documents: [{ document_id: "restart-document", bank }] }; },
      read: async ref => { reads++; const stored = JSON.parse(await readFile(path.join(root, "document.json"), "utf8"));
        const document: SafeDocument = { title: stored.title, content: stored.content, tags: stored.tags, content_digest: stored.content_digest };
        return { ...ref, document }; } } });
  const selection = await recall.recall(query); assert.equal(selection.histories.length, 1); const history = selection.histories[0]!;
  assert.equal(history.verification, "historical-authenticated"); assert.equal(history.current_verification, "not-checked");
  assert.equal(history.lifecycle.state, "not-checked"); assert.ok(history.evidence.every(receipt => receipt.expires_at < 20_000));
  assert.equal(history.executable, false); assert.equal(history.authorization, "none");
  const context = recall.compileContext(selection); assert.equal(context.item_count, 1); assert.equal(context.current_verification, "not-checked");
  assert.ok(context.content.includes("bounded metadata validation")); assert.ok(context.character_count <= context.max_characters);
  assert.equal(recall.select([history], { ...query, source_sha: "d".repeat(40) }).histories.length, 0);
  // Only now create a genuinely new run/owner verifier; no archived proof/key restores current trust.
  const current = { ...original, run_id: "consumer-run" }; const owner = currentOwner(current, 20_000);
  const library = createLearningLibrary({ verifier: owner.verifier });
  const imported = library.importHistorical(history, { ...current, experience_id: "consumer-experience", ts: 20_000 });
  assert.equal(imported.status, "observed"); assert.equal(imported.verification, undefined); assert.equal(imported.historical_origin!.run_id, "producer-run");
  assert.equal(library.retrieve([imported, history], retrievalQuery).handles.length, 0); assert.equal(owner.reads(), 0);
  const candidate = library.nominate(imported);
  assert.throws(() => library.verifyCandidate(candidate, history as any), fails);
  assert.throws(() => library.verifyCandidate(candidate, { ...history, verification: "authority-bound", status: "trusted" } as any), fails);
  assert.throws(() => library.observe({ ...observation, experience_id: "copied-status", status: "trusted" } as any), (e: unknown) => e instanceof LearningError && e.code === "invalid-input");
  const proof = await owner.verifier.verify(current, subjects); const verified = library.verifyCandidate(candidate, proof);
  assert.equal(owner.reads(), 3); assert.equal(verified.status, "verified"); assert.equal(library.retrieve([verified], retrievalQuery).handles.length, 1);
  assert.equal(library.planReplay(verified, current).executable, false);
  owner.setNow(25_000); assert.equal(library.retrieve([verified], retrievalQuery).handles.length, 0);
  assert.equal(recall.compileContext(selection).current_verification, "not-checked");
  console.log(JSON.stringify({ role, pid: process.pid, node: process.version, learningEntry, evidenceEntry, archive_digest: history.archive_digest, queries, reads,
    historical_authentication: history.verification, current_verification: history.current_verification, imported_state: imported.status,
    copied_current_proof_refused: true, fresh_current_owner_reads: owner.reads(), fresh_current_verification: verified.status,
    current_expiry_preserved: true, executable: history.executable, authorization: history.authorization }));
} else {
  throw Error("invalid synthetic child role");
}
