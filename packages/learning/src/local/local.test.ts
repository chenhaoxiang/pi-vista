import test from "node:test";
import assert from "node:assert/strict";
import { createLearningLibrary } from "../index.js";
import { prepareHistoricalGuidance } from "../guidance/index.js";
import { createLocalLearningLibrary } from "./index.js";
import { errorCode, expected, fixture, observation, persisted, query, scope, verified } from "./local.fixtures.js";

test("LOCAL creation/observe/candidate is effect-free and status cannot supply proof", async () => {
  const f = fixture(); assert.deepEqual(f.calls, { collect: 0, retain: 0, read: 0, query: 0, reconcile: 0 });
  const raw = observation(); const seen = f.library.observe(raw);
  assert.equal(seen.status, "observed"); assert.equal(seen.authorization, "none"); assert.equal(seen.executable, false);
  const candidate = f.library.nominate(seen); assert.equal(candidate.status, "candidate");
  assert.throws(() => f.library.prepareGuidance(candidate, "fixture-alias"), errorCode("unverified-evidence"));
  assert.throws(() => f.library.verifyCandidate(candidate, { ...expected, passed: true }), errorCode("unverified-evidence"));
  assert.equal(f.calls.collect, 0); assert.equal(f.calls.retain, 0);
  const live = f.library.verifyCandidate(candidate, await f.proof());
  assert.equal(live.status, "verified"); assert.equal(live.verification?.verification, "local-host-process"); assert.equal(live.verification?.scope, scope);
  assert.ok(Object.isFrozen(live) && Object.isFrozen(live.script) && Object.isFrozen(live.script.steps) && Object.isFrozen(live.steps));
  assert.equal(Object.hasOwn(live, "receipts"), false); assert.equal(Object.hasOwn(live, "signature"), false);
  assert.throws(() => f.library.nominate(seen), errorCode("invalid-handle"));
});
for (const flag of ["status", "verification", "persistence", "historical_origin", "authorization", "executable"]) {
  test(`LOCAL observed input cannot carry ${flag}`, () => {
    const f = fixture(); assert.throws(() => f.library.observe({ ...observation(), [flag]: "verified" } as any), errorCode("invalid-input"));
    assert.equal(f.library.observe(observation()).status, "observed"); assert.equal(f.calls.retain, 0);
  });
}
for (const unsafe of ["/private/fixture", "https://example.invalid", "task;rm", "wrapped_ghp_abcdefghijklmnop"]) {
  test("LOCAL unsafe raw labels refuse without effects or identity reservation", () => {
    const f = fixture(); assert.throws(() => f.library.observe({ ...observation(), experience_id: unsafe }), errorCode("invalid-input"));
    f.library.observe(observation()); assert.equal(f.calls.collect + f.calls.retain, 0);
  });
}
test("LOCAL hostile own-data/config callbacks reject proxies/accessors without running traps", () => {
  let traps = 0; const proxy = new Proxy({}, { get() { traps++; throw Error(); }, ownKeys() { traps++; throw Error(); } });
  const f = fixture(); assert.throws(() => createLocalLearningLibrary(proxy as any), errorCode("invalid-config"));
  assert.throws(() => f.library.observe(proxy as any), errorCode("invalid-input"));
  const raw = Object.defineProperty(observation(), "steps", { get() { traps++; throw Error(); } });
  assert.throws(() => f.library.observe(raw), errorCode("invalid-input"));
  const store = Object.defineProperty({ ...f.store }, "retain", { get() { traps++; throw Error(); } });
  assert.throws(() => createLocalLearningLibrary({ ...f.config, store }), errorCode("invalid-config"));
  assert.equal(traps, 0);
});
test("LOCAL config requires exact verifier identity, closed mode and callbacks", () => {
  const f = fixture();
  for (const config of [{ ...f.config, mode: "signed" }, { ...f.config, approved: true }, { ...f.config, scope: "/private/fixture" },
    { ...f.config, verifier: { ...f.verifier } }, { ...f.config, store: { ...f.store, extra: true } },
    { ...f.config, store: { ...f.store, retain: true } }, { ...f.config, timeout_ms: 0 }])
    assert.throws(() => createLocalLearningLibrary(config as any), errorCode("invalid-config"));
  assert.throws(() => createLearningLibrary({ verifier: f.verifier as any }), errorCode("invalid-config"));
});
for (const key of ["run_id", "repo", "source_sha", "policy_version", "env_fingerprint"] as const) {
  test(`LOCAL candidate/proof exact ${key} binding is mandatory`, async () => {
    const f = fixture(); const input = { ...observation(), [key]: key === "source_sha" ? "b".repeat(40) : "other-binding" };
    const c = f.library.nominate(f.library.observe(input));
    const proof = await f.proof(); assert.throws(() => f.library.verifyCandidate(c, proof), errorCode("unverified-evidence")); assert.equal(f.calls.retain, 0);
  });
}
test("LOCAL copied/JSON/foreign proof and incorrect scope cannot mint verified handles", async () => {
  const f = fixture(); const c = f.library.nominate(f.library.observe(observation())); const proof = await f.proof(); const other = fixture();
  for (const p of [{ ...proof }, JSON.parse(JSON.stringify(proof)), await other.proof()])
    assert.throws(() => f.library.verifyCandidate(c, p), errorCode("unverified-evidence"));
  const scoped = createLocalLearningLibrary({ ...f.config, scope: "different-scope" }); const sc = scoped.nominate(scoped.observe(observation()));
  assert.throws(() => scoped.verifyCandidate(sc, proof), errorCode("unverified-evidence"));
});
test("LOCAL config/input mutation cannot redirect store callback or persisted document", async () => {
  const f = fixture(); const raw = observation(); const seen = f.library.observe(raw);
  (raw.script.steps as string[])[0] = "changed-step"; (f.store as any).retain = async () => { throw Error("changed callback"); };
  const c = f.library.nominate(seen); const live = f.library.verifyCandidate(c, await f.proof());
  const plan = f.library.prepareGuidance(live, "fixture-alias"); assert.equal(JSON.parse(plan.document.content).experience.script.steps[0], "inspect-fixture");
  const done = await f.library.commitGuidance(plan, { preview_digest: plan.preview_digest }); assert.equal(done.status, "persisted"); assert.equal(f.calls.retain, 1);
});
test("LOCAL raw failure facts survive canonical preview without a derived root-cause claim", async () => {
  const f = fixture(); const raw = { ...observation(), failure_analysis: { failure_id: "fixture-failure", run_id: expected.run_id,
    step_id: "fixture-step", ts: 10_000, stage: "execution" as const, reason_code: "unknown" as const } };
  const c = f.library.nominate(f.library.observe(raw)); const h = f.library.verifyCandidate(c, await f.proof()); const plan = f.library.prepareGuidance(h, "fixture-alias");
  assert.deepEqual(JSON.parse(plan.document.content).experience.failure_analysis, raw.failure_analysis);
  assert.equal(JSON.parse(plan.document.content).current_verification, "not-checked"); assert.equal(JSON.parse(plan.document.content).executable, false);
  assert.equal(Object.hasOwn(JSON.parse(plan.document.content).experience, "status"), false);
  assert.deepEqual(plan.document, prepareHistoricalGuidance(raw));
});
test("LOCAL previews, exact confirmation, current proof rotation and canonical readback precede persistence", async () => {
  const f = fixture(); const h = await verified(f); const p = f.library.prepareGuidance(h, "fixture-alias");
  assert.equal(p.mode, "dry-run"); assert.equal(p.authorization, "none"); assert.equal(p.executable, false); assert.equal(f.calls.retain, 0);
  assert.ok(Object.isFrozen(p) && Object.isFrozen(p.document));
  await assert.rejects(() => f.library.commitGuidance({ ...p }, { preview_digest: p.preview_digest }), errorCode("invalid-plan"));
  for (const confirmation of [{ preview_digest: "f".repeat(64) }, { preview_digest: p.preview_digest, approved: true }])
    await assert.rejects(() => f.library.commitGuidance(p, confirmation), errorCode("invalid-confirmation"));
  assert.equal(f.calls.retain, 0); const done = await f.library.commitGuidance(p, { preview_digest: p.preview_digest });
  assert.equal(done.status, "persisted"); assert.equal(done.persistence?.current_verification, "not-checked"); assert.equal(done.executable, false);
  assert.equal(f.calls.collect, 6); assert.equal(f.calls.retain, 1); assert.equal(f.calls.read, 1);
  await assert.rejects(() => f.library.commitGuidance(p, { preview_digest: p.preview_digest }), errorCode("promotion-used"));
});
test("LOCAL independent plans are all consumed after one confirmed attempt", async () => {
  const f = fixture(); const h = await verified(f); const one = f.library.prepareGuidance(h, "fixture-alias"); const two = f.library.prepareGuidance(h, "other-alias");
  f.state.mode = "lost-ack"; await assert.rejects(() => f.library.commitGuidance(one, { preview_digest: one.preview_digest }), errorCode("sink-failed"));
  await assert.rejects(() => f.library.commitGuidance(two, { preview_digest: two.preview_digest }), errorCode("promotion-used"));
  f.state.mode = "normal"; const newProof = await f.proof(); const refreshed = f.library.verifyCandidate(h, newProof); const again = f.library.prepareGuidance(refreshed, "fixture-alias");
  await assert.rejects(() => f.library.commitGuidance(again, { preview_digest: again.preview_digest }), errorCode("promotion-used")); assert.equal(f.calls.retain, 1);
  const reconciled = await f.library.reconcileGuidance(one.bank, one.document); assert.equal(reconciled.state, "matched"); assert.equal(reconciled.current_verification, "not-checked"); assert.equal(f.calls.retain, 1);
});
for (const mode of ["bad-ack", "bad-read"] as const) {
  test(`LOCAL ${mode} is a mismatch, never ack-based persistence`, async () => {
    const f = fixture(); const h = await verified(f); const p = f.library.prepareGuidance(h, "fixture-alias"); f.state.mode = mode;
    await assert.rejects(() => f.library.commitGuidance(p, { preview_digest: p.preview_digest }), errorCode("sink-mismatch"));
    assert.equal(h.status, "verified"); assert.equal(h.persistence, undefined); assert.equal(f.calls.retain, 1);
    await assert.rejects(() => f.library.commitGuidance(p, { preview_digest: p.preview_digest }), errorCode("promotion-used"));
  });
}
test("LOCAL expiry or rejected generation stops a prepared write before effects", async () => {
  for (const mode of ["expired", "rejected"]) {
    const f = fixture(); const h = await verified(f); const p = f.library.prepareGuidance(h, "fixture-alias");
    if (mode === "expired") f.setNow(15_000); else f.library.reject(h);
    await assert.rejects(() => f.library.commitGuidance(p, { preview_digest: p.preview_digest }), errorCode(mode === "expired" ? "unverified-evidence" : "promotion-invalidated")); assert.equal(f.calls.retain, 0);
  }
});
test("LOCAL failed evidence refresh consumes write attempt, never uses stale flags", async () => {
  const f = fixture(); const h = await verified(f); const p = f.library.prepareGuidance(h, "fixture-alias"); f.payloads.guard.result_ref = "changed-result";
  await assert.rejects(() => f.library.commitGuidance(p, { preview_digest: p.preview_digest }), errorCode("unverified-evidence")); assert.equal(f.calls.retain, 0);
  await assert.rejects(() => f.library.commitGuidance(p, { preview_digest: p.preview_digest }), errorCode("promotion-used"));
  assert.equal(f.library.retrieve([h], query).handles.length, 0);
});
test("LOCAL missing store allows preview but never consumes a commit or starts collection", async () => {
  const f = fixture(); const lib = createLocalLearningLibrary({ mode: "local-learning", scope, verifier: f.verifier });
  const h = lib.verifyCandidate(lib.nominate(lib.observe(observation())), await f.proof()); const p = lib.prepareGuidance(h, "fixture-alias");
  await assert.rejects(() => lib.commitGuidance(p, { preview_digest: p.preview_digest }), errorCode("sink-unavailable")); assert.equal(f.calls.collect, 3);
  await assert.rejects(() => lib.readGuidance({ bank: "fixture-alias", document_id: `vista-guidance-v1-${"d".repeat(16)}-${"d".repeat(64)}`, current_verification: "not-checked", authorization: "none", executable: false }), errorCode("sink-unavailable"));
});
test("LOCAL terminal lifecycle and copied handles invalidate selections without executing", async () => {
  const f = fixture(); const a = await verified(f, "example-a"); const b = await verified(f, "example-b");
  const selection = f.library.retrieve([a, b, { ...a }, a], query); assert.deepEqual(selection.handles.map(h => h.experience_id), ["example-a", "example-b"]);
  assert.equal(selection.rejected.unverified, 1); assert.equal(f.library.compileContext(selection).item_count, 2);
  const superseded = f.library.supersede(a, b); assert.equal(superseded.status, "superseded"); assert.equal(superseded.superseded_by, "example-b");
  assert.throws(() => f.library.compileContext(selection), errorCode("stale-selection"));
  assert.throws(() => f.library.verifyCandidate(superseded, {}), errorCode("invalid-transition"));
  const { handle } = await persisted(f, "example-c"); const sel = f.library.retrieve([handle], query); f.library.deprecate(handle);
  assert.throws(() => f.library.compileContext(sel), errorCode("stale-selection")); assert.equal(f.calls.retain, 1);
});
test("LOCAL context is opt-in bounded character data with live provenance, not a Pi hook", async () => {
  const f = fixture(); const h = await verified(f); const selection = f.library.retrieve([h], query); const full = f.library.compileContext(selection);
  assert.equal(full.executable, false); assert.equal(full.authorization, "none"); assert.equal(full.budget_unit, "characters");
  assert.equal(full.character_count, full.content.length); assert.equal(full.provenance[0]?.scope, scope);
  assert.ok(full.provenance[0]?.observation_digests.every(d => d.length === 64));
  const small = f.library.compileContext(selection, { max_characters: 128 }); assert.ok(small.content.length <= 128); assert.deepEqual(small.omitted_ids, [h.experience_id]);
  assert.throws(() => f.library.compileContext({ ...selection }), errorCode("stale-selection"));
  f.setNow(15_000); assert.throws(() => f.library.compileContext(selection), errorCode("stale-selection")); assert.equal(f.calls.retain, 0);
});
test("LOCAL retirement invalidates all live views but does not retire a shared verifier", async () => {
  const f = fixture(); const h = await verified(f); const p = f.library.prepareGuidance(h, "fixture-alias"); const selected = f.library.retrieve([h], query); f.library.shutdown(); f.library.shutdown();
  assert.throws(() => f.library.observe(observation("other-example")), errorCode("invalid-transition")); assert.throws(() => f.library.compileContext(selected), errorCode("invalid-transition"));
  await assert.rejects(() => f.library.commitGuidance(p, { preview_digest: p.preview_digest }), errorCode("invalid-transition"));
  assert.ok(await f.proof()); assert.equal(f.calls.retain, 0);
});
