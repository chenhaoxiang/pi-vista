import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { mkdir, readFile, realpath, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createReceiptFileSources, type ReceiptFileConfig } from "@pi-vista/evidence/files";
import { createEvidenceVerifier, createEvidenceCheckRegistry, evidenceMessage, EvidenceError, type EvidenceBinding } from "@pi-vista/evidence";
import { createLearningLibrary, LearningError, type ExperienceObservation, type IngestRequest } from "@pi-vista/learning";

// Self-contained synthetic helper: copied/strict-compiled inside an actual retained
// npm consumer. Runtime imports only public packages and Node, never source tests.
const [role, directory, installedRoot] = process.argv.slice(2);
assert.ok(directory && path.isAbsolute(directory));
const root = await realpath(directory); const receiptRoot = path.join(root, "receipts");
const entries = Object.fromEntries(["@pi-vista/evidence", "@pi-vista/evidence/files", "@pi-vista/learning"].map(name => [name, fileURLToPath(import.meta.resolve(name))]));
if (installedRoot) for (const [name, entry] of Object.entries(entries)) {
  const packageName = name === "@pi-vista/evidence/files" ? "@pi-vista/evidence" : name;
  assert.equal(await realpath(entry), path.join(installedRoot, packageName, "dist", name.endsWith("/files") ? "files.js" : "index.js"));
}
const expected: EvidenceBinding = { run_id: "file-process-run", repo: "file-process-repo", source_sha: "a".repeat(40), policy_version: "policy-1", env_fingerprint: "env-1" };
const subjects = { gate: "file-gate", test: "file-test", guard: "file-guard" };
const kinds = ["gate", "test", "guard"] as const; let now = 10_000;
function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map(key => `${JSON.stringify(key)}:${canonical(record[key])}`).join(",")}}`;
}
const verifierFor = (config: ReceiptFileConfig) => createEvidenceVerifier({ sources: createReceiptFileSources(config),
  gate_checks: ["source-check"], gate_version: "b".repeat(40), gate_config_digest: "c".repeat(64), test_suites: ["unit-suite"],
  now: () => now, max_age_ms: 10_000, timeout_ms: 3000 });
const observation: ExperienceObservation = { ...expected, experience_id: "file-experience", task_type: "metadata-validation", ts: 9500,
  script: { task_type: "metadata-validation", description: "bounded metadata validation", preconditions: ["source-bound"], steps: ["validate-metadata"], postconditions: ["validated"], known_failures: [], applicable_to: [] },
  steps: [{ step_id: "step-1", tool: "metadata-validator", action_description: "validate metadata", check_fn_ids: ["source-bound"], expected_result: "validated", on_failure: "stop", depends_on: [] }] };
const query = { repo: expected.repo, source_sha: expected.source_sha, policy_version: expected.policy_version, env_fingerprint: expected.env_fingerprint, task_type: observation.task_type };
const evidenceRefused = (error: unknown) => error instanceof EvidenceError && error.code === "unverified-evidence";
const learningRefused = (error: unknown) => error instanceof LearningError && error.code === "unverified-evidence";
if (role === "producer") {
  await mkdir(receiptRoot, { mode: 0o700 });
  const keys = generateKeyPairSync("ed25519");
  const config: ReceiptFileConfig = { root: receiptRoot, max_bytes: 16_384, timeout_ms: 2000,
    sources: kinds.map(kind => ({ subject: subjects[kind], file_id: kind, issuer: "synthetic-file-owner", kind,
      public_key: keys.publicKey.export({ type: "spki", format: "pem" }).toString() })) };
  const details = {
    gate: { verdict: "pass", gate_version: "b".repeat(40), config_digest: "c".repeat(64), checks: [{ name: "source-check", outcome: "pass" }] },
    test: { suites: [{ name: "unit-suite", total: 2, passed: 2, failed: 0, skipped: 0, cancelled: 0 }] },
    guard: { coverage: "complete", event_count: 2, blocked: 0 },
  };
  for (const kind of kinds) {
    const payload = { schema: 1, kind, issuer: "synthetic-file-owner", ...expected, receipt_ref: `ref-${kind}`, issued_at: 9000, expires_at: 15_000, details: details[kind] };
    const seal = (value: unknown) => {
      const message = evidenceMessage(value);
      return canonical({ payload: JSON.parse(message), content_digest: createHash("sha256").update(message).digest("hex"), signature: sign(null, Buffer.from(message), keys.privateKey).toString("base64") });
    };
    await writeFile(path.join(receiptRoot, `${kind}.receipt.json`), seal(payload), { mode: 0o600, flag: "wx" });
    if (kind === "gate") await writeFile(path.join(root, "next-gate.json"), seal({ ...payload, receipt_ref: "published-next-gate" }), { mode: 0o600, flag: "wx" });
  }
  const verifier = verifierFor(config); const proof = await verifier.verify(expected, subjects);
  assert.ok(verifier.isCurrent(proof, expected));
  await writeFile(path.join(root, "config.json"), JSON.stringify(config), { mode: 0o600, flag: "wx" });
  await writeFile(path.join(root, "old-proof.json"), JSON.stringify(proof), { mode: 0o600, flag: "wx" });
  console.log(JSON.stringify({ role, pid: process.pid, node: process.version, entries, synthetic: true, authorization: proof.authorization, receipt_count: proof.receipts.length }));
} else if (role === "consumer") {
  const config = JSON.parse(await readFile(path.join(root, "config.json"), "utf8")) as ReceiptFileConfig;
  const oldProof: unknown = JSON.parse(await readFile(path.join(root, "old-proof.json"), "utf8"));
  const verifier = verifierFor(config); assert.equal(verifier.isCurrent(oldProof, expected), false);
  const proof = await verifier.verify(expected, subjects); assert.ok(verifier.isCurrent(proof, expected));
  for (const copy of [{ ...proof }, JSON.parse(JSON.stringify(proof))]) assert.equal(verifier.isCurrent(copy, expected), false);
  assert.equal(verifierFor(config).isCurrent(proof, expected), false);
  for (const field of ["run_id", "repo", "source_sha", "policy_version", "env_fingerprint"] as const) {
    const wrong = { ...expected, [field]: field === "source_sha" ? "d".repeat(40) : "wrong" };
    assert.equal(verifier.isCurrent(proof, wrong), false); await assert.rejects(verifier.verify(wrong, subjects), evidenceRefused);
  }
  const report = await createEvidenceCheckRegistry(verifier).run((["receipt_present", "test_passed", "custom:evidence/guard-clean"] as const).map((type, i) => ({
    check_id: `probe-${i}`, type, params: { subject: subjects[kinds[i]!], ...expected }, on_fail: "STOP" as const,
  })));
  assert.equal(report.satisfied, true); assert.equal(report.authorization, "none"); assert.equal(report.verification, "predicate-only");
  let ingests = 0, readbacks = 0; const documents = new Map<string, IngestRequest>();
  const library = createLearningLibrary({ verifier, sink: {
    ingest: async request => { ingests++; documents.set(request.idempotency_key, request); return { document_id: "synthetic-document", bank: request.bank, content_digest: request.content_digest, idempotency_key: request.idempotency_key }; },
    readback: async receipt => { readbacks++; const stored = documents.get(receipt.idempotency_key)!; return { ...receipt, title: stored.title, content: stored.content, tags: stored.tags }; },
  } });
  const candidate = library.nominate(library.observe(observation));
  for (const forged of [oldProof, { ...proof }, report, { verified: true, passed: true }, await verifierFor(config).verify(expected, subjects)])
    assert.throws(() => library.verifyCandidate(candidate, forged as typeof proof), learningRefused);
  const verified = library.verifyCandidate(candidate, proof); const plan = library.preparePromotion(verified, "synthetic-bank");
  assert.equal(ingests, 0); assert.equal(readbacks, 0);
  await assert.rejects(library.commitPromotion(plan, { preview_digest: "d".repeat(64) }), error => error instanceof LearningError && error.code === "invalid-confirmation");
  assert.equal(ingests, 0);
  // Explicitly confirm the exact synthetic preview, not a real owner approval.
  const trusted = await library.commitPromotion(plan, { preview_digest: plan.preview_digest });
  assert.equal(trusted.status, "trusted"); assert.equal(trusted.authorization, "none"); assert.equal(ingests, 1); assert.equal(readbacks, 1);
  assert.equal(library.compileContext(library.retrieve([trusted], query)).item_count, 1);
  assert.equal(library.planReplay(trusted, expected).executable, false);
  const changedCandidate = library.nominate(library.observe({ ...observation, experience_id: "changed-file-experience" }));
  const changed = library.verifyCandidate(changedCandidate, proof); const changedPlan = library.preparePromotion(changed, "synthetic-bank");
  // Cooperative actor publishes already signed synthetic bytes BEFORE a later read.
  const next = await readFile(path.join(root, "next-gate.json")); const staged = path.join(receiptRoot, "publication");
  await writeFile(staged, next, { mode: 0o600, flag: "wx" }); await rename(staged, path.join(receiptRoot, "gate.receipt.json"));
  await assert.rejects(verifier.revalidate(proof), evidenceRefused);
  await assert.rejects(library.commitPromotion(changedPlan, { preview_digest: changedPlan.preview_digest }), learningRefused);
  assert.equal(ingests, 1); assert.equal(readbacks, 1);
  assert.equal((await verifier.verify(expected, subjects)).receipts[0]!.receipt_ref, "published-next-gate");
  now = 15_000; assert.equal(verifier.isCurrent(proof, expected), false); assert.equal(library.retrieve([trusted], query).handles.length, 0);
  await assert.rejects(verifier.verify(expected, subjects), evidenceRefused);
  console.log(JSON.stringify({ role, pid: process.pid, node: process.version, entries, synthetic: true, copied_current_proof_refused: true,
    binding_checks: 5, predicate_only: report.verification, ingests, readbacks, confirmed_status: trusted.status, changed_file_refused: true,
    fresh_publication_seen: true, expiry_preserved: true, executable: false, authorization: trusted.authorization }));
} else throw Error("invalid synthetic child role");
