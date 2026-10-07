import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { readFile, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createEvidenceVerifier, evidenceMessage, type EvidenceBinding, type EvidenceKind } from "@pi-vista/evidence";
import { createLearningLibrary, createPortableRecall, LearningError, type ArchiveOriginPin, type ExperienceObservation, type IngestRequest } from "@pi-vista/learning";
import { createHindsightStore, type HindsightStoreConfig } from "@pi-vista/learning/hindsight";

// Self-contained public-import child: also compiled with installed consumer TypeScript.
// Only synthetic public pins/safe requests survive; never keys, owner proof or private config discovery.
const [role, configPath, requestPath, installedRoot] = process.argv.slice(2); assert.ok(configPath && requestPath);
if (installedRoot) {
  for (const name of ["learning", "evidence"]) assert.equal(await realpath(fileURLToPath(import.meta.resolve(`@pi-vista/${name}`))), path.join(installedRoot, `@pi-vista/${name}/dist/index.js`));
  assert.equal(await realpath(fileURLToPath(import.meta.resolve("@pi-vista/learning/hindsight"))), path.join(installedRoot, "@pi-vista/learning/dist/hindsight/index.js"));
}
const config: HindsightStoreConfig = JSON.parse(await readFile(configPath, "utf8")); const store = createHindsightStore(config); const signal = new AbortController().signal;
const original: EvidenceBinding = { run_id: "producer-run", repo: "restart-repo", source_sha: "a".repeat(40), policy_version: "policy-1", env_fingerprint: "env-1" };
const bank = "fixture-bank"; const subjects = { gate: "gate-subject", test: "test-subject", guard: "guard-subject" };
const retrievalQuery = { repo: original.repo, source_sha: original.source_sha, policy_version: original.policy_version, env_fingerprint: original.env_fingerprint, task_type: "metadata-update" }; const query = { bank, ...retrievalQuery };
const hash = (text: string): string => createHash("sha256").update(text).digest("hex");
function owner(binding: EvidenceBinding, now: number) {
  const keys = generateKeyPairSync("ed25519");
  const details = { gate: { verdict: "pass", gate_version: "b".repeat(40), config_digest: "c".repeat(64), checks: [{ name: "source-check", outcome: "pass" }] },
    test: { suites: [{ name: "unit-suite", total: 1, passed: 1, failed: 0, skipped: 0, cancelled: 0 }] }, guard: { coverage: "complete", event_count: 1, blocked: 0 } };
  return createEvidenceVerifier({ sources: (["gate", "test", "guard"] as const).map((kind: EvidenceKind) => {
    const payload = { schema: 1, kind, issuer: "synthetic-owner", ...binding, receipt_ref: `ref-${kind}`, issued_at: now - 1000, expires_at: now + 5000, details: details[kind] };
    const message = evidenceMessage(payload); const receipt = { payload, content_digest: hash(message), signature: sign(null, Buffer.from(message), keys.privateKey).toString("base64") };
    return { subject: subjects[kind], issuer: "synthetic-owner", kind, public_key: keys.publicKey.export({ type: "spki", format: "pem" }).toString(), read: async () => receipt };
  }), gate_checks: ["source-check"], gate_version: "b".repeat(40), gate_config_digest: "c".repeat(64), test_suites: ["unit-suite"], now: () => now, max_age_ms: 10_000 });
}
if (process.send) {
  process.send({ stage: "ready" });
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(Error("synthetic child readiness deadline")), 5000);
    process.once("message", message => { clearTimeout(timer); if (message === "go") resolve(); else reject(Error("synthetic child instruction")); });
  });
}
let result: object;
if (role === "writer") {
  const request: IngestRequest = JSON.parse(await readFile(requestPath, "utf8"));
  try { await store.sink.ingest(request, signal); result = { state: "matched" }; }
  catch (error) { assert.ok(error instanceof LearningError); result = { state: "refused", code: error.code }; }
} else if (role === "producer") {
  const verifier = owner(original, 10_000); const keys = generateKeyPairSync("ed25519");
  const pin: ArchiveOriginPin = { role: "archive-origin", issuer: "restart-archiver", key_id: "origin-1", repo: original.repo, bank,
    public_key: keys.publicKey.export({ type: "spki", format: "pem" }).toString(), not_before: 0, not_after: 12_000, trust: "pinned-history" };
  const library = createLearningLibrary({ verifier, sink: store.sink, timeout_ms: 4000, archive: { origin: pin, now: () => 10_000,
    sign: async request => ({ signature: sign(null, Buffer.from(request.message), keys.privateKey).toString("base64") }) } });
  const observation: ExperienceObservation = { ...original, experience_id: "restart-experience", task_type: query.task_type, ts: 9500,
    script: { task_type: query.task_type, description: "bounded metadata validation", preconditions: ["source-bound"], steps: ["inspect-metadata"], postconditions: ["validated"], known_failures: [], applicable_to: [] },
    steps: [{ step_id: "step-1", tool: "metadata-validator", action_description: "validate bounded metadata", check_fn_ids: ["source-bound"], expected_result: "validated", on_failure: "stop", depends_on: [] }] };
  const verified = library.verifyCandidate(library.nominate(library.observe(observation)), await verifier.verify(original, subjects));
  const preview = await library.prepareArchive(verified, bank); const request = { bank, ...preview.document, idempotency_key: preview.idempotency_key };
  await writeFile(requestPath, JSON.stringify(request), { flag: "wx", mode: 0o600 }); await writeFile(`${requestPath}.pin`, JSON.stringify(pin), { flag: "wx", mode: 0o600 });
  const upload = await library.commitArchive(preview, { preview_digest: preview.preview_digest }); assert.equal(upload.authorization, "none"); assert.equal(verified.status, "verified");
  result = { state: upload.persistence, authorization: upload.authorization, executable: upload.executable };
} else if (role === "consumer") {
  const pin: ArchiveOriginPin = JSON.parse(await readFile(`${requestPath}.pin`, "utf8")); const request: IngestRequest = JSON.parse(await readFile(requestPath, "utf8"));
  const reconciled = await store.reconcile(request, signal); assert.equal(reconciled.state, "matched"); assert.equal(reconciled.authorization, "none");
  const recall = createPortableRecall({ origins: [pin], now: () => 20_000, max_age_ms: 60_000, timeout_ms: 4000, port: store.port });
  const selection = await recall.recall(query); assert.equal(selection.histories.length, 1); const history = selection.histories[0]!;
  assert.equal(history.current_verification, "not-checked"); assert.equal(history.lifecycle.state, "not-checked"); assert.ok(history.evidence.every(receipt => receipt.expires_at < 20_000));
  assert.equal(recall.compileContext(selection).item_count, 1); const current = { ...original, run_id: "consumer-run" }; const verifier = owner(current, 20_000);
  const library = createLearningLibrary({ verifier }); const observed = library.importHistorical(history, { ...current, experience_id: "consumer-experience", ts: 20_000 });
  assert.equal(observed.status, "observed"); assert.equal(observed.verification, undefined); assert.equal(library.retrieve([observed, history], retrievalQuery).handles.length, 0);
  assert.throws(() => library.verifyCandidate(library.nominate(observed), history as any), (error: unknown) => error instanceof LearningError && error.code === "unverified-evidence");
  result = { reconciliation: reconciled.state, history: history.verification, current_verification: history.current_verification, imported: observed.status,
    copied_proof_refused: true, executable: history.executable, authorization: history.authorization };
} else throw Error("invalid synthetic child role");
console.log(JSON.stringify({ role, pid: process.pid, node: process.version, ...result })); process.disconnect?.();
