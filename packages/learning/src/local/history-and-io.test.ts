import test from "node:test";
import assert from "node:assert/strict";
import { createLocalEvidenceVerifier } from "@pi-vista/evidence/host";
import { LearningError } from "../contract.js";
import { prepareHistoricalGuidance } from "../guidance/index.js";
import { document, documentId, receipt, writeRequest } from "../guidance/data.js";
import { createLocalLearningLibrary } from "./index.js";
import { errorCode, expected, fixture, observation, persisted, query, reference, scope, selected, verified } from "./local.fixtures.js";

const pause = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
const importContext = () => ({ ...expected, run_id: "new-local-run", experience_id: "new-local-example", ts: 10_001 });

test("LOCAL historical original/recall never returns live verification or arbitrary fact prose", async () => {
  const f = fixture(); const { handle } = await persisted(f); const history = await f.library.readGuidance(handle.persistence!);
  assert.equal(history.guidance.current_verification, "not-checked"); assert.equal(history.authorization, "none"); assert.equal(history.executable, false);
  assert.equal(Object.hasOwn(history.guidance.experience, "verification"), false); assert.equal(Object.hasOwn(history.guidance.experience, "status"), false);
  const rows = await f.library.recallGuidance("fixture-alias", query); assert.equal(rows.length, 1); assert.deepEqual(rows[0], history);
  assert.equal(f.calls.retain, 1); assert.ok(Object.isFrozen(rows) && Object.isFrozen(rows[0]) && Object.isFrozen(rows[0]!.guidance));
  assert.throws(() => f.library.verifyCandidate(history as any, {}), errorCode("invalid-handle"));
});
test("LOCAL restart/history import requires a new observation identity/run and fresh verification", async () => {
  const f = fixture(); const raw = { ...observation(), model_id: "old-measured-model", failure_analysis: { failure_id: "old-failure", run_id: expected.run_id, step_id: "fixture-step",
    ts: 10_000, stage: "execution" as const, reason_code: "unknown" as const } };
  const h = f.library.verifyCandidate(f.library.nominate(f.library.observe(raw)), await f.proof()); const plan = f.library.prepareGuidance(h, "fixture-alias");
  const done = await f.library.commitGuidance(plan, { preview_digest: plan.preview_digest }); const freshLibrary = createLocalLearningLibrary(f.config);
  for (const value of [done, JSON.parse(JSON.stringify(done))]) assert.throws(() => freshLibrary.nominate(value), errorCode("invalid-handle"));
  await assert.rejects(() => freshLibrary.commitGuidance(plan, { preview_digest: plan.preview_digest }), errorCode("invalid-plan"));
  const history = await freshLibrary.readGuidance(JSON.parse(JSON.stringify(done.persistence)));
  assert.throws(() => freshLibrary.importGuidance({ ...history }, importContext()), errorCode("stale-history"));
  assert.throws(() => f.library.importGuidance(history, importContext()), errorCode("stale-history"));
  for (const c of [{ ...importContext(), run_id: raw.run_id }, { ...importContext(), experience_id: raw.experience_id }, { ...importContext(), source_sha: "b".repeat(40) }])
    assert.throws(() => freshLibrary.importGuidance(history, c), errorCode("stale-history"));
  const seen = freshLibrary.importGuidance(history, importContext()); assert.equal(seen.status, "observed"); assert.equal(seen.run_id, "new-local-run");
  assert.equal(seen.verification, undefined); assert.equal(seen.persistence, undefined); assert.equal(seen.model_id, undefined); assert.equal(seen.failure_analysis, undefined);
  assert.equal(seen.historical_origin?.current_verification, "not-checked"); assert.equal(freshLibrary.retrieve([seen], query).handles.length, 0);
  const candidate = freshLibrary.nominate(seen); assert.throws(() => freshLibrary.verifyCandidate(candidate, done.verification), errorCode("unverified-evidence"));
  for (const payload of Object.values(f.payloads)) payload.run_id = seen.run_id;
  const proof = await f.verifier.verify({ ...expected, run_id: seen.run_id }, selected); const live = freshLibrary.verifyCandidate(candidate, proof);
  assert.equal(live.status, "verified"); assert.equal(freshLibrary.retrieve([live], query).handles.length, 1); assert.equal(f.calls.retain, 1);
});
for (const field of ["repo", "source_sha", "policy_version", "env_fingerprint", "task_type"] as const) {
  test(`LOCAL recall filters mismatching historical ${field}`, async () => {
    const f = fixture(); await persisted(f);
    const modified = { ...query, [field]: field === "source_sha" ? "b".repeat(40) : "other-binding" };
    assert.equal((await f.library.recallGuidance("fixture-alias", modified)).length, 0); assert.equal(f.calls.retain, 1);
  });
}
test("LOCAL recall allows declared task applicability, deduplicates, and stays reference-only", async () => {
  const f = fixture(); const { handle } = await persisted(f); const ref = reference(handle.persistence!);
  f.state.query = async () => [ref, { ...ref }]; const rows = await f.library.recallGuidance("fixture-alias", { ...query, task_type: "alternate-task" });
  assert.equal(rows.length, 1); assert.equal(f.calls.query, 1); assert.equal(f.calls.read, 2); assert.equal(f.calls.retain, 1);
  f.state.query = async () => [{ ...ref, text: "untrusted fact prose" } as any];
  await assert.rejects(() => f.library.recallGuidance("fixture-alias", query), errorCode("sink-mismatch")); assert.equal(f.calls.read, 2);
});
test("LOCAL wrong bank/unsafe IDs/overflow reference arrays refuse before original reads", async () => {
  const f = fixture(); const { handle } = await persisted(f); const ref = reference(handle.persistence!); const reads = f.calls.read;
  for (const rows of [[{ ...ref, bank: "foreign-alias" }], [{ ...ref, document_id: "/private/fixture" }], Array(9).fill(ref), [{ ...ref, current_verification: "verified" }]]) {
    f.state.query = async () => rows as any; await assert.rejects(() => f.library.recallGuidance("fixture-alias", query), errorCode("sink-mismatch"));
  }
  assert.equal(f.calls.read, reads); assert.equal(f.calls.retain, 1);
});
test("LOCAL read validates exact reference, receipt digests, canonical document and separate guidance bytes", async () => {
  const f = fixture(); const { handle } = await persisted(f); const r = handle.persistence!; const saved = f.docs.get(r.document_id)!;
  for (const bad of [{ ...saved, document_id: `vista-guidance-v1-${"e".repeat(16)}-${"e".repeat(64)}` },
    { ...saved, content_digest: "e".repeat(64) }, { ...saved, idempotency_key: `guidance-${"e".repeat(64)}` },
    { ...saved, document: { ...saved.document, content: saved.document.content + " " } },
    { ...saved, guidance: { ...saved.guidance, experience: observation("other-example") } }, { ...saved, extra: true }]) {
    f.state.read = async () => bad as any; await assert.rejects(() => f.library.readGuidance(r), errorCode("sink-mismatch"));
  }
  assert.equal(f.calls.retain, 1);
});
test("LOCAL missing original and malformed reconciliation never yield proof or success", async () => {
  const f = fixture(); const { handle, plan } = await persisted(f); f.docs.clear();
  await assert.rejects(() => f.library.readGuidance(handle.persistence!), errorCode("sink-failed"));
  assert.equal((await f.library.reconcileGuidance(plan.bank, plan.document)).state, "not-confirmed");
  for (const raw of [{ state: "matched", current_verification: "verified", authorization: "none", executable: false }, { state: "matched", current_verification: "not-checked", authorization: "merge", executable: false },
    { state: "matched", current_verification: "not-checked", authorization: "none", executable: true }, { state: "matched", current_verification: "not-checked", authorization: "none", executable: false, proof: true }]) {
    f.state.reconcile = async () => raw as any; await assert.rejects(() => f.library.reconcileGuidance(plan.bank, plan.document), errorCode("sink-mismatch"));
  }
  assert.equal(f.calls.retain, 1);
});
test("LOCAL read-only reconciliation can be used after a lost ack in a new factory without retain", async () => {
  const f = fixture(); const h = await verified(f); const p = f.library.prepareGuidance(h, "fixture-alias"); f.state.mode = "lost-ack";
  await assert.rejects(() => f.library.commitGuidance(p, { preview_digest: p.preview_digest }), errorCode("sink-failed"));
  f.library.shutdown(); const restarted = createLocalLearningLibrary(f.config); const result = await restarted.reconcileGuidance(p.bank, JSON.parse(JSON.stringify(p.document)));
  assert.equal(result.state, "matched"); assert.equal(result.current_verification, "not-checked"); assert.equal(f.calls.retain, 1);
  await assert.rejects(() => restarted.commitGuidance(JSON.parse(JSON.stringify(p)), { preview_digest: p.preview_digest }), errorCode("invalid-plan"));
});
test("LOCAL callback thenables are rejected before assimilation; private errors never escape", async () => {
  let thenCalls = 0;
  for (const call of [() => ({ then() { thenCalls++; throw Error("private then body"); } }), () => { throw Error("private exception"); },
    async () => { throw new LearningError("private payload" as any); }, async () => { const e = new LearningError("sink-failed"); e.message = "private message"; throw e; }]) {
    const f = fixture(); const lib = createLocalLearningLibrary({ ...f.config, store: { ...f.store, retain: call as any } });
    const h = lib.verifyCandidate(lib.nominate(lib.observe(observation())), await f.proof()); const p = lib.prepareGuidance(h, "fixture-alias");
    await assert.rejects(() => lib.commitGuidance(p, { preview_digest: p.preview_digest }), e => e instanceof LearningError && e.code === "sink-failed" && e.message === "sink-failed" && !e.stack?.includes("private"));
  }
  assert.equal(thenCalls, 0);
});
test("LOCAL concurrent commits use exactly one retain callback", async () => {
  const f = fixture(); const h = await verified(f); const one = f.library.prepareGuidance(h, "fixture-alias"); const two = f.library.prepareGuidance(h, "fixture-alias");
  const first = f.library.commitGuidance(one, { preview_digest: one.preview_digest });
  await assert.rejects(() => f.library.commitGuidance(two, { preview_digest: two.preview_digest }), errorCode("promotion-used")); assert.equal((await first).status, "persisted"); assert.equal(f.calls.retain, 1);
});
test("LOCAL terminal change during retain is uncertain, cannot revive/issue readback or another write", async () => {
  const f = fixture(); const h = await verified(f); const p = f.library.prepareGuidance(h, "fixture-alias");
  let release!: (v: any) => void; let started!: () => void; const ready = new Promise<void>(resolve => { started = resolve; });
  f.state.retain = async () => new Promise(resolve => { release = resolve; started(); });
  const commit = f.library.commitGuidance(p, { preview_digest: p.preview_digest }); await ready;
  const stopped = f.library.reject(h); release(receipt(writeRequest(p.bank, p.document), "d".repeat(64)));
  await assert.rejects(() => commit, errorCode("promotion-invalidated")); assert.equal(stopped.status, "rejected"); assert.equal(f.calls.read, 0); assert.equal(f.calls.retain, 1);
});
test("LOCAL timeout aborts store wait, consumes intent, and ignores late success", async () => {
  const f = fixture(10); const h = await verified(f); const p = f.library.prepareGuidance(h, "fixture-alias");
  let release!: (v: any) => void; let signal: AbortSignal | undefined;
  f.state.retain = async (_bank, _doc, seen) => { signal = seen; return new Promise(resolve => { release = resolve; }); };
  await assert.rejects(() => f.library.commitGuidance(p, { preview_digest: p.preview_digest }), errorCode("sink-timeout")); assert.equal(signal?.aborted, true);
  release(receipt(writeRequest(p.bank, p.document), "d".repeat(64))); await pause(0);
  assert.equal(f.calls.read, 0); await assert.rejects(() => f.library.commitGuidance(p, { preview_digest: p.preview_digest }), errorCode("promotion-used")); assert.equal(f.calls.retain, 1);
});
test("LOCAL one overall deadline includes proof recollection before retain", async () => {
  const f = fixture(); let delayed = false;
  const verifier = createLocalEvidenceVerifier({ ...f.evidenceConfig, sources: f.evidenceConfig.sources.map(s => ({ ...s, collect: async signal => {
    if (delayed) await pause(30); return s.collect(signal);
  } })) });
  const lib = createLocalLearningLibrary({ ...f.config, verifier, timeout_ms: 10 });
  const h = lib.verifyCandidate(lib.nominate(lib.observe(observation())), await verifier.verify(expected, selected)); const p = lib.prepareGuidance(h, "fixture-alias"); delayed = true;
  await assert.rejects(() => lib.commitGuidance(p, { preview_digest: p.preview_digest }), errorCode("sink-timeout")); await pause(110);
  assert.equal(f.calls.retain, 0); assert.equal(f.calls.read, 0); verifier.shutdown();
});
test("LOCAL shutdown aborts in-flight retain and late rejection is consumed", async () => {
  const f = fixture(); const h = await verified(f); const p = f.library.prepareGuidance(h, "fixture-alias"); let reject!: (e: unknown) => void;
  let started!: () => void; const ready = new Promise<void>(resolve => { started = resolve; });
  f.state.retain = async () => new Promise((_, no) => { reject = no; started(); }); const commit = f.library.commitGuidance(p, { preview_digest: p.preview_digest });
  await ready; f.library.shutdown(); await assert.rejects(() => commit, errorCode("sink-failed")); assert.equal(f.state.lastSignal?.aborted, true);
  reject(Error("private late body")); await pause(0); assert.equal(f.calls.read, 0);
});
test("LOCAL expiry during exact readback cannot turn stored history into current persistence", async () => {
  const f = fixture(); const h = await verified(f); const p = f.library.prepareGuidance(h, "fixture-alias");
  f.state.read = async ref => { const value = f.docs.get(ref.document_id)!; f.setNow(15_000); return value; };
  await assert.rejects(() => f.library.commitGuidance(p, { preview_digest: p.preview_digest }), errorCode("unverified-evidence"));
  assert.equal(h.status, "verified"); assert.equal(f.library.retrieve([h], query).handles.length, 0); assert.equal(f.calls.retain, 1);
});
test("LOCAL recall uses one total store budget rather than a fresh deadline per original", async () => {
  const f = fixture(); const doc = prepareHistoricalGuidance(observation()); const req = writeRequest("fixture-alias", doc); const r = receipt(req, "d".repeat(64));
  f.docs.set(documentId(req, "d".repeat(64)), { ...r, ...document(doc) }); const lib = createLocalLearningLibrary({ ...f.config, timeout_ms: 15 });
  f.state.query = async () => { await pause(10); return [reference(r)]; }; f.state.read = async () => { await pause(10); return f.docs.get(r.document_id)!; };
  await assert.rejects(() => lib.recallGuidance("fixture-alias", query), errorCode("sink-timeout")); await pause(20); assert.equal(f.calls.retain, 0);
});
