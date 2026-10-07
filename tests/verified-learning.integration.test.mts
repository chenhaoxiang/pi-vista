import { deepStrictEqual, ok, rejects, strictEqual, throws } from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { emitShadowObservation, toVistaEventInput, type ShadowObservation } from "@pi-vista/adapter-shadow";
import { observe } from "@pi-vista/cli";
import { EventStore } from "@pi-vista/core";
import {
  createEvidenceCheckRegistry, createEvidenceVerifier, evidenceMessage, EvidenceError,
  type EvidenceBinding, type EvidenceKind, type VerifiedEvidence,
} from "@pi-vista/evidence";
import {
  createLearningLibrary, LearningError, type ExperienceHandle, type ExperienceObservation,
  type IngestRequest, type LearningLibrary, type LearningSink,
} from "@pi-vista/learning";

const root = fileURLToPath(new URL("../", import.meta.url));
const EXPECTED: EvidenceBinding = {
  run_id: "synthetic-learning-run", repo: "synthetic-repo", source_sha: "a".repeat(40),
  policy_version: "synthetic-policy-1", env_fingerprint: "synthetic-env-1",
};
const SUBJECTS = { gate: "synthetic-gate", test: "synthetic-tests", guard: "synthetic-guard" };
const QUERY = {
  repo: EXPECTED.repo, source_sha: EXPECTED.source_sha, policy_version: EXPECTED.policy_version,
  env_fingerprint: EXPECTED.env_fingerprint, task_type: "metadata-validation",
};

/** Generated disposable keys, fixed clock and in-memory receipts; no owner or session reads. */
function ownerFixture() {
  let now = 10_000;
  const keys = generateKeyPairSync("ed25519");
  const kinds = ["gate", "test", "guard"] as const;
  const details = {
    gate: { verdict: "pass", gate_version: "b".repeat(40), config_digest: "c".repeat(64), checks: [{ name: "synthetic-check", outcome: "pass" }] },
    test: { suites: [{ name: "synthetic-suite", total: 2, passed: 2, failed: 0, skipped: 0, cancelled: 0 }] },
    guard: { coverage: "complete", event_count: 2, blocked: 0 },
  };
  const payloads = new Map<EvidenceKind, Record<string, unknown>>();
  const receipts = new Map<EvidenceKind, unknown>();
  const reads = { gate: 0, test: 0, guard: 0 };
  function reseal(kind: EvidenceKind, patch: Record<string, unknown> = {}) {
    const payload = { ...payloads.get(kind), ...patch };
    const message = evidenceMessage(payload);
    payloads.set(kind, payload);
    receipts.set(kind, {
      payload, content_digest: createHash("sha256").update(message).digest("hex"),
      signature: sign(null, Buffer.from(message), keys.privateKey).toString("base64"),
    });
  }
  for (const kind of kinds) {
    payloads.set(kind, {
      schema: 1, kind, issuer: "synthetic-owner", ...EXPECTED, receipt_ref: `synthetic-${kind}-receipt`,
      issued_at: 9_000, expires_at: 15_000, details: details[kind],
    });
    reseal(kind);
  }
  const verifier = createEvidenceVerifier({
    sources: kinds.map(kind => ({
      subject: SUBJECTS[kind], kind, issuer: "synthetic-owner",
      public_key: keys.publicKey.export({ type: "spki", format: "pem" }).toString(),
      read: async () => { reads[kind]++; return receipts.get(kind); },
    })),
    gate_checks: ["synthetic-check"], gate_version: "b".repeat(40), gate_config_digest: "c".repeat(64),
    test_suites: ["synthetic-suite"], now: () => now, max_age_ms: 10_000, timeout_ms: 100,
  });
  return { verifier, receipts, reads, reseal, setNow: (value: number) => { now = value; } };
}

function syntheticObservation(id = "synthetic-experience"): ExperienceObservation {
  return {
    ...EXPECTED, experience_id: id, task_type: QUERY.task_type, ts: 9_500, model_id: "synthetic-model",
    script: {
      task_type: QUERY.task_type, description: "bounded metadata validation", preconditions: ["source-bound"],
      steps: ["inspect-metadata", "validate-metadata"], postconditions: ["validated"],
      known_failures: [{ symptom: "source-drift", mitigation: "refetch-evidence" }], applicable_to: [],
    },
    steps: [
      { step_id: "synthetic-step-1", tool: "metadata-reader", action_description: "inspect metadata", check_fn_ids: ["source-bound"], expected_result: "observed", on_failure: "stop", depends_on: [] },
      { step_id: "synthetic-step-2", tool: "metadata-validator", action_description: "validate metadata", check_fn_ids: ["receipt-bound"], expected_result: "validated", on_failure: "escalate", depends_on: ["synthetic-step-1"] },
    ],
  };
}

/** The only injected sink stores exact synthetic requests in a process-local Map. */
function memorySink() {
  const documents = new Map<string, IngestRequest>();
  let ingests = 0, readbacks = 0;
  const sink: LearningSink = {
    ingest: async (request, signal) => {
      strictEqual(signal.aborted, false);
      ingests++;
      documents.set(request.idempotency_key, request);
      return { document_id: "synthetic-document", bank: request.bank, content_digest: request.content_digest, idempotency_key: request.idempotency_key };
    },
    readback: async (receipt, signal) => {
      strictEqual(signal.aborted, false);
      readbacks++;
      const stored = documents.get(receipt.idempotency_key);
      ok(stored);
      return { ...receipt, title: stored.title, content: stored.content, tags: stored.tags };
    },
  };
  return { sink, documents, counts: () => ({ ingests, readbacks }) };
}

async function verifiedFixture() {
  const owner = ownerFixture(), transport = memorySink();
  const library = createLearningLibrary({ verifier: owner.verifier, sink: transport.sink });
  const candidate = library.nominate(library.observe(syntheticObservation()));
  const proof = await owner.verifier.verify(EXPECTED, SUBJECTS);
  const verified = library.verifyCandidate(candidate, proof);
  return { owner, transport, library, candidate, proof, verified };
}

function learningCode(code: LearningError["code"]) {
  return (error: unknown) => error instanceof LearningError && error.code === code;
}

function shadowObservation(verdict: ShadowObservation["verdict"] = "pass"): ShadowObservation {
  return {
    schema: "shadow-observation/1", shadow: true, model_family: "kev", model_id: "kev-4b",
    model_version: "synthetic-v1", verdict, status: "observed", context_status: "complete",
    correlation: { run_id: EXPECTED.run_id, step_id: `${EXPECTED.run_id}_s0`, source_sha: EXPECTED.source_sha, policy_version: EXPECTED.policy_version, pair_id: "synthetic-pair", shared_input_hash: "d".repeat(64) },
    asset_evidence: { scope: "synthetic", verified: false, realInputIsolationProven: false, receipt_ref: "synthetic-shadow-receipt", receipt_sha256: "e".repeat(64) },
    humanExpectationWritten: false, trainingEligible: false, promotionEligible: false,
  };
}

test("public signed receipts -> candidate -> exact dry-run -> confirmed synthetic sink -> trusted retrieval and non-executing replay", async () => {
  const { owner, transport, library, candidate, proof, verified } = await verifiedFixture();
  strictEqual(candidate.status, "candidate");
  strictEqual(verified.status, "verified");
  strictEqual(proof.authorization, "none");
  const registry = createEvidenceCheckRegistry(owner.verifier);
  const report = await registry.run([
    { check_id: "synthetic-gate-check", type: "receipt_present", params: { subject: SUBJECTS.gate, ...EXPECTED }, on_fail: "STOP" },
    { check_id: "synthetic-test-check", type: "test_passed", params: { subject: SUBJECTS.test, ...EXPECTED }, on_fail: "STOP" },
    { check_id: "synthetic-guard-check", type: "custom:evidence/guard-clean", params: { subject: SUBJECTS.guard, ...EXPECTED }, on_fail: "STOP" },
  ]);
  strictEqual(report.satisfied, true);
  strictEqual(report.verification, "predicate-only");
  strictEqual(report.authorization, "none");
  const readsBeforePreview = { ...owner.reads };
  const plan = library.preparePromotion(verified, "synthetic-bank");
  deepStrictEqual(owner.reads, readsBeforePreview, "preview does not re-read evidence");
  deepStrictEqual(transport.counts(), { ingests: 0, readbacks: 0 });
  strictEqual(plan.mode, "dry-run");
  strictEqual(plan.document.content_digest, createHash("sha256").update(plan.document.content).digest("hex"));
  strictEqual(plan.document.content.includes("PRIVATE KEY"), false);
  strictEqual(plan.document.content.includes("signature"), false);
  const trusted = await library.commitPromotion(plan, { preview_digest: plan.preview_digest });
  deepStrictEqual(transport.counts(), { ingests: 1, readbacks: 1 });
  deepStrictEqual(owner.reads, { gate: readsBeforePreview.gate + 1, test: readsBeforePreview.test + 1, guard: readsBeforePreview.guard + 1 });
  strictEqual(trusted.status, "trusted");
  strictEqual(trusted.authorization, "none");
  strictEqual(trusted.hindsight_doc_id, "synthetic-document");
  strictEqual(transport.documents.get(plan.idempotency_key)?.content, plan.document.content);
  const selection = library.retrieve([trusted, verified, JSON.parse(JSON.stringify(trusted))], QUERY);
  deepStrictEqual(selection.handles, [trusted]);
  strictEqual(selection.rejected.stale, 1);
  strictEqual(selection.rejected.unverified, 1);
  const context = library.compileContext(selection, { max_characters: 8_192 });
  strictEqual(context.authorization, "none");
  strictEqual(context.budget_unit, "characters");
  strictEqual(context.character_count, context.content.length);
  strictEqual(context.item_count, 1);
  deepStrictEqual(context.provenance[0]?.receipt_digests, trusted.verification?.receipts.map(receipt => receipt.content_digest));
  strictEqual(context.content.includes("synthetic-model"), false);
  const replay = library.planReplay(trusted, EXPECTED);
  strictEqual(replay.executable, false);
  strictEqual(replay.authorization, "none");
  strictEqual(replay.mode, "recorded-only");
  deepStrictEqual(replay.timeline.map(step => step.tool), ["metadata-reader", "metadata-validator"]);
  deepStrictEqual(transport.counts(), { ingests: 1, readbacks: 1 }, "retrieval/context/replay never execute or write");
});

test("verified-only context and fixture evaluation work before any sink commit without claiming model capability", async () => {
  const { library, transport, verified } = await verifiedFixture();
  const selected = library.retrieve([verified], QUERY);
  strictEqual(selected.handles[0]?.status, "verified");
  const evaluation = library.evaluateRetrieval([verified], [{ case_id: "synthetic-case", query: QUERY, expected_ids: [verified.experience_id] }]);
  strictEqual(evaluation.successful_selections, 1);
  strictEqual(evaluation.coverage, 1);
  strictEqual(evaluation.capability_claim, "none");
  strictEqual(evaluation.authorization, "none");
  const bounded = library.compileContext(selected, { max_characters: 128 });
  strictEqual(bounded.item_count, 0);
  deepStrictEqual(bounded.omitted_ids, [verified.experience_id]);
  ok(bounded.character_count <= 128);
  deepStrictEqual(transport.counts(), { ingests: 0, readbacks: 0 });
});

test("unsigned legacy flags and shadow observations cannot verify a candidate or produce trusted retrieval", async () => {
  const owner = ownerFixture(), transport = memorySink();
  const library = createLearningLibrary({ verifier: owner.verifier, sink: transport.sink });
  const candidate = library.nominate(library.observe(syntheticObservation()));
  const shadow = shadowObservation();
  const projected = toVistaEventInput(shadow);
  strictEqual(projected.result, "unknown");
  for (const forged of [{ ...EXPECTED, verified: true, passed: true, authorization: "none" }, shadow, projected]) {
    throws(() => library.verifyCandidate(candidate, forged as unknown as VerifiedEvidence), learningCode("unverified-evidence"));
    deepStrictEqual(library.retrieve([forged], QUERY).handles, []);
  }
  owner.receipts.set("gate", { passed: true, verified: true, source_sha: EXPECTED.source_sha });
  await rejects(owner.verifier.verify(EXPECTED, SUBJECTS), EvidenceError);
  strictEqual(candidate.status, "candidate");
  deepStrictEqual(transport.counts(), { ingests: 0, readbacks: 0 });
});

test("copied proofs, handles, predicate reports and plans cannot restore process-local provenance", async () => {
  const { owner, transport, library, proof, verified } = await verifiedFixture();
  const second = library.nominate(library.observe(syntheticObservation("synthetic-second")));
  throws(() => library.verifyCandidate(second, { ...proof }), learningCode("unverified-evidence"));
  throws(() => library.verifyCandidate(second, { authorization: "none", verification: "predicate-only", satisfied: true } as unknown as VerifiedEvidence), learningCode("unverified-evidence"));
  const other: LearningLibrary = createLearningLibrary({ verifier: owner.verifier });
  deepStrictEqual(other.retrieve([verified], QUERY).handles, []);
  const copied = JSON.parse(JSON.stringify(verified)) as ExperienceHandle;
  deepStrictEqual(library.retrieve([copied], QUERY).handles, []);
  const plan = library.preparePromotion(verified, "synthetic-bank");
  await rejects(library.commitPromotion({ ...plan }, { preview_digest: plan.preview_digest }), learningCode("invalid-plan"));
  await rejects(library.commitPromotion(plan, { preview_digest: "f".repeat(64) }), learningCode("invalid-confirmation"));
  deepStrictEqual(transport.counts(), { ingests: 0, readbacks: 0 });
});

test("expiry between preview and confirmation refuses sink writes and invalidates selected context", async () => {
  const { owner, transport, library, verified } = await verifiedFixture();
  const plan = library.preparePromotion(verified, "synthetic-bank");
  const selection = library.retrieve([verified], QUERY);
  owner.setNow(15_000);
  await rejects(library.commitPromotion(plan, { preview_digest: plan.preview_digest }), learningCode("unverified-evidence"));
  const stale = library.retrieve([verified], QUERY);
  deepStrictEqual(stale.handles, []);
  strictEqual(stale.rejected.stale, 1);
  throws(() => library.compileContext(selection), learningCode("stale-selection"));
  deepStrictEqual(transport.counts(), { ingests: 0, readbacks: 0 });
});

test("freshly signed source drift and changed receipt hashes both refuse confirmation before the synthetic sink", async () => {
  for (const patch of [{ source_sha: "f".repeat(40) }, { receipt_ref: "synthetic-replaced-gate" }]) {
    const { owner, transport, library, verified } = await verifiedFixture();
    const plan = library.preparePromotion(verified, "synthetic-bank");
    owner.reseal("gate", patch);
    await rejects(library.commitPromotion(plan, { preview_digest: plan.preview_digest }), learningCode("unverified-evidence"));
    strictEqual(verified.status, "verified");
    deepStrictEqual(transport.counts(), { ingests: 0, readbacks: 0 });
  }
});

test("uncertain synthetic readback never mints trusted state or permits a second write", async () => {
  const owner = ownerFixture(), transport = memorySink();
  const library = createLearningLibrary({ verifier: owner.verifier, sink: {
    ingest: transport.sink.ingest,
    readback: async (receipt, signal) => ({ ...await transport.sink.readback(receipt, signal) as Record<string, unknown>, content: "synthetic-mismatch" }),
  } });
  const candidate = library.nominate(library.observe(syntheticObservation()));
  const verified = library.verifyCandidate(candidate, await owner.verifier.verify(EXPECTED, SUBJECTS));
  const plan = library.preparePromotion(verified, "synthetic-bank");
  await rejects(library.commitPromotion(plan, { preview_digest: plan.preview_digest }), learningCode("sink-mismatch"));
  strictEqual(verified.status, "verified");
  strictEqual(library.retrieve([verified], QUERY).handles[0]?.status, "verified");
  await rejects(library.commitPromotion(plan, { preview_digest: plan.preview_digest }), learningCode("promotion-used"));
  deepStrictEqual(transport.counts(), { ingests: 1, readbacks: 1 });
});

test("public shadow -> core JSONL -> unchanged observation CLI preserves non-positive outcomes and unverified receipt refs", async () => {
  await mkdir(join(root, "tmp"), { recursive: true });
  const directory = await mkdtemp(join(root, "tmp/verified-learning-integration-"));
  try {
    const store = new EventStore(directory);
    for (const [index, verdict] of (["pass", "veto", "abstain"] as const).entries()) {
      const emitted = await emitShadowObservation(shadowObservation(verdict), {
        store: { append: event => store.append(event) }, seq: index, now: 1_000 + index,
      });
      ok(emitted);
      strictEqual(emitted.source_sha, EXPECTED.source_sha);
    }
    const events = await store.readRun(EXPECTED.run_id);
    deepStrictEqual(events.map(event => event.result), ["unknown", "blocked", "abstain"]);
    for (const event of events) {
      strictEqual(event.model_id, "kev-4b");
      const metadata = event.artifact_refs?.find(ref => ref.type === "shadow_metadata")?.stats;
      strictEqual(metadata?.safety_role, "observation-only");
      strictEqual(metadata?.trainingEligible, 0);
      strictEqual(metadata?.promotionEligible, 0);
      for (const ref of event.artifact_refs ?? []) {
        strictEqual(Object.hasOwn(ref, "verified"), false);
        strictEqual(Object.hasOwn(ref, "sha"), false, "content digests are not source SHA evidence");
      }
    }
    const path = join(directory, "runs", EXPECTED.run_id, "events.jsonl");
    const before = await readFile(path, "utf8");
    const inspection = await observe({ command: "inspect", runId: EXPECTED.run_id, baseDir: directory });
    strictEqual(inspection.independent_verification, "not-performed");
    strictEqual(inspection.authorization, "none");
    if (inspection.command !== "inspect") throw new Error("unexpected synthetic view");
    strictEqual(inspection.events.total, 3);
    const receipts = await observe({ command: "receipts", runId: EXPECTED.run_id, baseDir: directory });
    if (receipts.command !== "receipts") throw new Error("unexpected synthetic view");
    const receipt = receipts.receipts.items.find(item => item.type === "shadow_receipt");
    ok(receipt);
    for (const observation of receipt.observations.items) strictEqual(observation.owner_claimed_verified, null);
    strictEqual(await readFile(path, "utf8"), before);
    const owner = ownerFixture();
    const library = createLearningLibrary({ verifier: owner.verifier });
    deepStrictEqual(library.retrieve(events, QUERY).handles, [], "persisted shadow metadata cannot mint learning provenance");
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("no default network or sink: hermetic public imports and synthetic verification use an empty parent environment", () => {
  // Builtin hooks are installed before dynamic public imports. The child gets no parent session/config inputs.
  const program = `
import { strictEqual, rejects } from "node:assert/strict";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import tls from "node:tls";
import { syncBuiltinESMExports } from "node:module";
// Darwin's runtime can create this locale bookkeeping key even with spawn env: {}.
strictEqual(Object.keys(process.env).filter(key => key !== "__CF_USER_TEXT_ENCODING").length, 0);
delete process.env.__CF_USER_TEXT_ENCODING;
strictEqual(Object.keys(process.env).length, 0);
let networkCalls = 0;
const deny = () => { networkCalls++; throw new Error("synthetic network refused"); };
globalThis.fetch = deny;
for (const api of [http, https]) { api.request = deny; api.get = deny; }
net.connect = deny; net.createConnection = deny; net.Socket.prototype.connect = deny; tls.connect = deny;
syncBuiltinESMExports();
const { createEvidenceVerifier, evidenceMessage } = await import("@pi-vista/evidence");
const { createLearningLibrary, LearningError } = await import("@pi-vista/learning");
const { toVistaEventInput } = await import("@pi-vista/adapter-shadow");
const EXPECTED = ${JSON.stringify(EXPECTED)};
const SUBJECTS = ${JSON.stringify(SUBJECTS)};
const QUERY = ${JSON.stringify(QUERY)};
const ownerFixture = ${ownerFixture.toString()};
const syntheticObservation = ${syntheticObservation.toString()};
const shadowObservation = ${shadowObservation.toString()};
const owner = ownerFixture();
const library = createLearningLibrary({ verifier: owner.verifier });
const candidate = library.nominate(library.observe(syntheticObservation()));
const verified = library.verifyCandidate(candidate, await owner.verifier.verify(EXPECTED, SUBJECTS));
const plan = library.preparePromotion(verified, "synthetic-bank");
await rejects(library.commitPromotion(plan, { preview_digest: plan.preview_digest }), error => error instanceof LearningError && error.code === "sink-unavailable");
strictEqual(owner.reads.gate, 1); strictEqual(owner.reads.test, 1); strictEqual(owner.reads.guard, 1);
strictEqual(library.retrieve([verified], QUERY).handles.length, 1);
strictEqual(library.planReplay(verified, EXPECTED).executable, false);
strictEqual(toVistaEventInput(shadowObservation()).result, "unknown");
strictEqual(networkCalls, 0);
console.log(JSON.stringify({ synthetic: true, parentEnvironmentKeys: 0, networkCalls, defaultSink: "unavailable", replayExecutable: false }));
`;
  const child = spawnSync(process.execPath, ["--input-type=module", "--eval", program], {
    cwd: root, env: {}, encoding: "utf8", timeout: 10_000, maxBuffer: 64 * 1024,
  });
  strictEqual(child.error, undefined);
  strictEqual(child.signal, null);
  strictEqual(child.status, 0, child.stderr);
  deepStrictEqual(JSON.parse(child.stdout), { synthetic: true, parentEnvironmentKeys: 0, networkCalls: 0, defaultSink: "unavailable", replayExecutable: false });
});
