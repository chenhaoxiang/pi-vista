import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createLearningLibrary, createPortableRecall, LearningError, MAX_DOCUMENT_CHARACTERS,
  type HistoricalExperience, type PortableRecallConfig, type SafeDocument,
} from "@pi-vista/learning";
import { EXPECTED, QUERY, SUBJECTS, deferred, ownerFixture, sampleObservation } from "./learning.fixtures.js";
import { BANK, SCOPE, alteredDocument, archiveFixture, canonical, originFixture, recallFixture, sha256 } from "./portable.fixtures.js";
const fails = (code: string) => (error: unknown) => error instanceof LearningError && error.code === code && error.message === code && error.stack === `LearningError: ${code}`;
const historicalQuery = { ...QUERY, bank: BANK };
function checkFrozen(input: any): void {
  if (input === null || typeof input !== "object") return;
  assert.ok(Object.isFrozen(input)); if (!Array.isArray(input)) assert.equal(Object.getPrototypeOf(input), null);
  for (const descriptor of Object.values(Object.getOwnPropertyDescriptors(input))) if ("value" in descriptor) checkFrozen(descriptor.value);
}

test("portable history: retired explicitly pinned key authenticates history after original receipt expiry, never current verification", async () => {
  const f = await archiveFixture(); const r = recallFixture(f.origin, f.plan.document);
  const history = await r.recall.authenticate(f.plan.document, SCOPE); checkFrozen(history);
  assert.equal(history.verification, "historical-authenticated"); assert.equal(history.signature_checked, true);
  assert.equal(history.current_verification, "not-checked"); assert.equal(history.authorization, "none"); assert.equal(history.executable, false);
  assert.equal(history.lifecycle.state, "not-checked"); assert.ok(history.evidence.every(receipt => receipt.expires_at < 20_000));
  assert.equal(history.archive_digest, f.plan.archive_digest);
  assert.deepEqual(r.calls(), { queries: 0, reads: 0 });
  const selection = await r.recall.recall(historicalQuery); checkFrozen(selection);
  assert.equal(selection.histories.length, 1); assert.deepEqual(r.calls(), { queries: 1, reads: 1 });
  const context = r.recall.compileContext(selection); checkFrozen(context);
  assert.equal(context.item_count, 1); assert.equal(context.current_verification, "not-checked"); assert.equal(context.executable, false);
  assert.ok(context.content.includes("current-verification=not-checked")); assert.ok(context.content.includes("bounded metadata validation"));
  assert.ok(!context.content.includes("signature\"")); assert.ok(!context.content.includes("model-fixture"));
  assert.equal(context.character_count, context.content.length); assert.equal(context.budget_unit, "characters");
});
for (const field of ["schema", "purpose", "authorization", "executable", "archived_at", "source_status_at_archive", "origin", "experience", "evidence"] as const) {
  test(`portable history: signed closed-schema ${field} mismatch cannot authenticate`, async () => {
    const f = await archiveFixture(); const r = recallFixture(f.origin, f.plan.document);
    const doc = alteredDocument(f.plan.document, envelope => {
      const p = envelope.payload;
      if (field === "schema") p.schema = 2;
      if (field === "purpose") p.purpose = "knowledge-page";
      if (field === "authorization") p.authorization = "execute";
      if (field === "executable") p.executable = true;
      if (field === "archived_at") p.archived_at = 15_000;
      if (field === "source_status_at_archive") p.source_status_at_archive = "deprecated";
      if (field === "origin") p.origin.role = "gate";
      if (field === "experience") p.experience.status = "trusted";
      if (field === "evidence") p.evidence[0].kind = "guard";
    }, f.origin);
    await assert.rejects(r.recall.authenticate(doc, SCOPE), fails("unverified-archive"));
  });
}
for (const field of ["signature", "content_digest", "bank", "repo", "issuer", "key_id", "source_sha", "policy_version", "env_fingerprint", "script", "steps"] as const) {
  test(`portable history: unsigned ${field} alteration cannot authenticate by digest/tag/status echo`, async () => {
    const f = await archiveFixture(); const r = recallFixture(f.origin, f.plan.document);
    const doc = alteredDocument(f.plan.document, envelope => {
      if (field === "signature") envelope.signature = "a".repeat(86) + "==";
      else if (field === "content_digest") envelope.content_digest = "f".repeat(64);
      else if (["bank", "repo", "issuer", "key_id"].includes(field)) envelope.payload.origin[field] = "wrong-label";
      else if (field === "script") envelope.payload.experience.script.description = "changed-label";
      else if (field === "steps") envelope.payload.experience.steps[0].expected_result = "changed-label";
      else envelope.payload.experience[field] = field === "source_sha" ? "d".repeat(40) : "wrong-label";
    });
    await assert.rejects(r.recall.authenticate(doc, SCOPE), fails("unverified-archive"));
  });
}
test("portable history: exact canonical document/title/tags/hash are required, not generated knowledge prose or status-only storage", async () => {
  const f = await archiveFixture(); const r = recallFixture(f.origin, f.plan.document);
  for (const doc of [
    { ...f.plan.document, content: "Verified knowledge page", content_digest: sha256("Verified knowledge page") },
    { ...f.plan.document, content: JSON.stringify({ status: "trusted", authorization: "none" }), content_digest: sha256(JSON.stringify({ status: "trusted", authorization: "none" })) },
    { ...f.plan.document, content: JSON.stringify(JSON.parse(f.plan.document.content), null, 2), content_digest: sha256(JSON.stringify(JSON.parse(f.plan.document.content), null, 2)) },
    { ...f.plan.document, title: "Generated page" }, { ...f.plan.document, tags: ["knowledge:failure"] }, { ...f.plan.document, content_digest: "f".repeat(64) },
    { ...f.plan.document, content: "x".repeat(MAX_DOCUMENT_CHARACTERS + 1) },
    { ...f.plan.document, status: "trusted" },
  ]) await assert.rejects(r.recall.authenticate(doc as SafeDocument, SCOPE), fails("unverified-archive"));
});
test("portable history: unknown/wrong-key/revoked/wrong-scope and key-interval mismatches reject", async () => {
  const f = await archiveFixture(); const other = originFixture();
  for (const changes of [{ issuer: "unknown-issuer" }, { key_id: "unknown-key" }, { public_key: other.pin.public_key }, { trust: "revoked" },
    { bank: "wrong-bank" }, { repo: "wrong-repo" }, { not_before: 10_001 }, { not_after: 10_000 }]) {
    const r = createPortableRecall({ origins: [{ ...f.origin.pin, ...changes } as any], now: () => 20_000, max_age_ms: 60_000 });
    await assert.rejects(r.authenticate(f.plan.document, SCOPE), fails("unverified-archive"));
  }
  const r = recallFixture(f.origin, f.plan.document);
  await assert.rejects(r.recall.authenticate(f.plan.document, { ...SCOPE, bank: "wrong-bank" }), fails("unverified-archive"));
  await assert.rejects(r.recall.authenticate(f.plan.document, { ...SCOPE, repo: "wrong-repo" }), fails("unverified-archive"));
});
test("portable history: explicit age policy, future timestamps and detected clock rollback fail closed", async () => {
  const f = await archiveFixture(); const r = recallFixture(f.origin, f.plan.document, { max_age_ms: 10_000 });
  const history = await r.recall.authenticate(f.plan.document, SCOPE); const selected = r.recall.select([history], historicalQuery);
  r.setNow(20_001); assert.throws(() => r.recall.compileContext(selected), fails("stale-history"));
  await assert.rejects(r.recall.authenticate(f.plan.document, SCOPE), fails("unverified-archive"));
  r.setNow(20_000); await assert.rejects(r.recall.authenticate(f.plan.document, SCOPE), fails("unverified-archive"));
  const future = recallFixture(f.origin, f.plan.document, { now: () => 9_999 });
  await assert.rejects(future.recall.authenticate(f.plan.document, SCOPE), fails("unverified-archive"));
  for (const changes of [{ max_age_ms: undefined }, { max_age_ms: 0 }, { max_age_ms: Infinity }, { max_age_ms: 31_536_000_001 }, { origins: [] }, { origins: [f.origin.pin, f.origin.pin] }]) {
    assert.throws(() => createPortableRecall({ origins: [f.origin.pin], now: () => 20_000, max_age_ms: 60_000, ...changes } as PortableRecallConfig), fails("invalid-config"));
  }
});
for (const state of ["deprecated", "revoked", "rejected", "superseded"] as const) {
  test(`portable history: explicit trusted-host ${state} lifecycle excludes even an authentic origin signature`, async () => {
    const f = await archiveFixture(); const r = recallFixture(f.origin, f.plan.document, { lifecycle: async ref => ({ ...ref, state, checked_at: 19_000, expires_at: 25_000 }) });
    await assert.rejects(r.recall.authenticate(f.plan.document, SCOPE), fails("archive-withdrawn"));
    await assert.rejects(r.recall.recall(historicalQuery), fails("archive-withdrawn"));
  });
}
test("portable history: lifecycle coverage is bound, fresh and honestly labelled; missing coverage never says current active", async () => {
  const f = await archiveFixture(); const r = recallFixture(f.origin, f.plan.document, { lifecycle: async ref => ({ ...ref, state: "active", checked_at: 19_000, expires_at: 25_000 }) });
  const history = await r.recall.authenticate(f.plan.document, SCOPE); assert.equal(history.lifecycle.state, "eligible-at-policy-check");
  const selected = r.recall.select([history], historicalQuery); r.setNow(25_000);
  assert.throws(() => r.recall.compileContext(selected), fails("stale-history"));
  const library = createLearningLibrary({ verifier: ownerFixture().verifier });
  assert.throws(() => library.importHistorical(history, { ...EXPECTED, run_id: "new-run", experience_id: "new-experience", ts: 25_000 }), fails("stale-history"));
  for (const mutation of [{ archive_digest: "f".repeat(64) }, { repo: "wrong-repo" }, { bank: "wrong-bank" }, { issuer: "wrong-issuer" }, { key_id: "wrong-key" },
    { role: "gate" }, { checked_at: 20_001 }, { expires_at: 20_000 }, { state: "unknown" }, { checked_at: 1, expires_at: 999_999_999 }, { extra: true }]) {
    const bad = recallFixture(f.origin, f.plan.document, { lifecycle: async ref => ({ ...ref, state: "active", checked_at: 19_000, expires_at: 25_000, ...mutation }) });
    await assert.rejects(bad.recall.authenticate(f.plan.document, SCOPE), fails("sink-mismatch"));
  }
});
test("portable history: bank/repo/source/policy/environment/task differences are excluded, not silently compatible", async () => {
  const f = await archiveFixture(); const r = recallFixture(f.origin, f.plan.document); const history = await r.recall.authenticate(f.plan.document, SCOPE);
  for (const field of ["bank", "repo", "source_sha", "policy_version", "env_fingerprint", "task_type"] as const) {
    const result = r.recall.select([history], { ...historicalQuery, [field]: field === "source_sha" ? "d".repeat(40) : "different-label" });
    assert.equal(result.histories.length, 0); assert.equal(result.rejected[field === "bank" ? "bank" : field === "task_type" ? "task" : "mismatch"], 1);
  }
  assert.equal(r.recall.select([history], { ...historicalQuery, task_type: "metadata-repair" }).histories.length, 1);
  const copied = { ...history };
  assert.throws(() => r.recall.select([copied], historicalQuery), fails("unverified-archive"));
  const other = recallFixture(f.origin, f.plan.document); assert.throws(() => other.recall.select([history], historicalQuery), fails("unverified-archive"));
  assert.throws(() => r.recall.compileContext({ ...r.recall.select([history], historicalQuery) }), fails("stale-history"));
});
test("portable history: deterministic ordering/dedup/limits and whole-entry item/character budgets do not claim model capability", async () => {
  const f = await archiveFixture(); const r = recallFixture(f.origin, f.plan.document);
  const second = await f.library.prepareArchive(await (async () => {
    const candidate = f.library.nominate(f.library.observe(sampleObservation("a-experience"))); return f.library.verifyCandidate(candidate, await f.owner.verifier.verify(EXPECTED, SUBJECTS));
  })(), BANK);
  const a = await r.recall.authenticate(second.document, SCOPE); const b = await r.recall.authenticate(f.plan.document, SCOPE);
  const selected = r.recall.select([b, a, b], historicalQuery); assert.deepEqual(selected.histories.map(v => v.experience.experience_id), ["a-experience", "experience-1"]);
  assert.equal(selected.rejected.duplicate, 1); assert.equal(r.recall.select([b, a], { ...historicalQuery, limit: 1 }).rejected.limit, 1);
  const minimal = r.recall.compileContext(selected, { max_characters: 128 }); assert.equal(minimal.item_count, 0); assert.ok(minimal.character_count <= 128); assert.equal(minimal.omitted_digests.length, 2);
  const single = r.recall.compileContext(selected, { max_items: 1 }); assert.equal(single.item_count, 1); assert.equal(single.omitted_digests.length, 1);
  const exact = r.recall.compileContext(selected, { max_characters: single.character_count }); assert.equal(exact.item_count, 1); assert.equal(exact.content, single.content);
  assert.equal(single.authorization, "none"); assert.equal(single.current_verification, "not-checked");
});
test("portable history: observed-only import preserves safe origin and requires genuinely new current proof through the normal API", async () => {
  const f = await archiveFixture(); const r = recallFixture(f.origin, f.plan.document); const history = await r.recall.authenticate(f.plan.document, SCOPE);
  const current = { ...EXPECTED, run_id: "new-run" }; const owner = ownerFixture(current); const library = createLearningLibrary({ verifier: owner.verifier });
  const imported = library.importHistorical(history, { ...current, experience_id: "imported-experience", ts: 20_000 }); checkFrozen(imported);
  assert.equal(imported.status, "observed"); assert.equal(imported.verification, undefined); assert.equal(imported.hindsight_doc_id, undefined); assert.equal(imported.model_id, undefined);
  assert.equal(imported.historical_origin!.run_id, EXPECTED.run_id); assert.equal(imported.historical_origin!.archive_digest, f.plan.archive_digest);
  assert.equal(library.retrieve([imported, history], QUERY).handles.length, 0);
  const candidate = library.nominate(imported);
  for (const fake of [history, { ...history, status: "trusted" }, JSON.parse(f.plan.document.content), { verification: "authority-bound", receipts: history.evidence }]) {
    assert.throws(() => library.verifyCandidate(candidate, fake as any), fails("unverified-evidence"));
  }
  assert.deepEqual(owner.calls, { gate: 0, test: 0, guard: 0 });
  const proof = await owner.verifier.verify(current, SUBJECTS); const verified = library.verifyCandidate(candidate, proof);
  assert.equal(verified.status, "verified"); assert.equal(verified.historical_origin!.archive_digest, history.archive_digest);
  assert.throws(() => library.importHistorical({ ...history }, { ...current, experience_id: "copy", ts: 20_000 }), fails("unverified-archive"));
  for (const field of ["repo", "source_sha", "policy_version", "env_fingerprint"] as const) {
    assert.throws(() => library.importHistorical(history, { ...current, experience_id: "mismatch", ts: 20_000, [field]: field === "source_sha" ? "d".repeat(40) : "different-label" }), fails("unverified-archive"));
  }
  for (const extra of [{ status: "trusted" }, { verification: proof }, { ts: undefined }]) {
    assert.throws(() => library.importHistorical(history, { ...current, experience_id: "bad-import", ts: 20_000, ...extra } as any), fails("invalid-input"));
  }
});
test("portable history: failure provenance uses the exact safe live decoder without relabelling old-run fixes in observed import", async () => {
  const owner = ownerFixture(); const origin = originFixture(); const library = createLearningLibrary({ verifier: owner.verifier, archive: origin.producer });
  const input = { ...sampleObservation(), failure_analysis: { failure_id: "failure-1", run_id: EXPECTED.run_id, step_id: "step-1", ts: 9_500, stage: "validation" as const,
    reason_code: "test_failed" as const, fix_applied: "bounded-fix", fix_outcome: "resolved" as const } };
  const candidate = library.nominate(library.observe(input)); const verified = library.verifyCandidate(candidate, await owner.verifier.verify(EXPECTED, SUBJECTS));
  const plan = await library.prepareArchive(verified, BANK); const r = recallFixture(origin, plan.document); const history = await r.recall.authenticate(plan.document, SCOPE);
  assert.equal(history.experience.failure_analysis!.verification, "observed-only"); assert.equal(plan.document.tags[0], "knowledge:failure");
  assert.ok(r.recall.compileContext(r.recall.select([history], historicalQuery)).content.includes("test_regression"));
  const imported = library.importHistorical(history, { ...EXPECTED, run_id: "new-run", experience_id: "new-failure-guidance", ts: 20_000 }); assert.equal(imported.failure_analysis, undefined);
  const corrupted = alteredDocument(plan.document, e => { e.payload.experience.failure_analysis.root_cause_basis = "verified-cause"; }, origin);
  await assert.rejects(r.recall.authenticate(corrupted, SCOPE), fails("unverified-archive"));
});
test("portable ports: query returns only bounded refs; wrong-bank refs are excluded before reads and duplicates do not duplicate read/selection", async () => {
  const f = await archiveFixture(); let reads = 0;
  const r = recallFixture(f.origin, f.plan.document, { port: {
    query: async () => ({ documents: [{ document_id: "archive-document", bank: BANK }, { document_id: "archive-document", bank: BANK }, { document_id: "other-document", bank: "other-bank" }] }),
    read: async ref => { reads++; assert.ok(Object.isFrozen(ref)); return { ...ref, document: f.plan.document }; },
  } });
  const selection = await r.recall.recall(historicalQuery); assert.equal(reads, 1); assert.equal(selection.histories.length, 1); assert.equal(selection.rejected.bank, 1); assert.equal(selection.rejected.duplicate, 1);
  const offline = createPortableRecall({ origins: [f.origin.pin], now: () => 20_000, max_age_ms: 60_000 });
  await assert.rejects(offline.recall(historicalQuery), fails("recall-unavailable")); assert.equal((await offline.authenticate(f.plan.document, SCOPE)).authorization, "none");
});
for (const phase of ["query", "read", "lifecycle"] as const) {
  test(`portable ports: ${phase} rejection/timeout/late rejection/thenables have fixed errors and never return partial success`, async () => {
    const f = await archiveFixture(); const late = deferred<unknown>(); let signal!: AbortSignal;
    const failure = (...args: any[]) => { signal = args[1]; return late.promise; };
    const config = (fn: any): Partial<PortableRecallConfig> => phase === "lifecycle" ? { lifecycle: fn, timeout_ms: 5 } : { timeout_ms: 5, port: {
      query: async () => ({ documents: [{ document_id: "archive-document", bank: BANK }] }), read: async ref => ({ ...ref, document: f.plan.document }), [phase]: fn,
    } };
    const r = recallFixture(f.origin, f.plan.document, config(failure));
    await assert.rejects(r.recall.recall(historicalQuery), fails("sink-timeout")); assert.ok(signal.aborted);
    late.reject(Error("late synthetic private transport detail")); await new Promise(resolve => setTimeout(resolve, 10));
    const thrown = recallFixture(f.origin, f.plan.document, config(() => { throw Error("synthetic private transport detail"); }));
    await assert.rejects(thrown.recall.recall(historicalQuery), fails("sink-failed"));
    let traps = 0; const thenable = Object.defineProperty({}, "then", { get: () => { traps++; throw Error(); } }); const proxy = new Proxy(Promise.resolve({}), { get: () => { traps++; throw Error(); } });
    for (const result of [thenable, proxy]) { const bad = recallFixture(f.origin, f.plan.document, config(() => result)); await assert.rejects(bad.recall.recall(historicalQuery), fails("sink-failed")); }
    assert.equal(traps, 0);
  });
}
test("portable ports: malformed/unsafe refs, overbounds and read ID/bank/document mismatches reject without status-only success", async () => {
  const f = await archiveFixture(); let reads = 0;
  for (const response of [true, { documents: new Array(1) }, { documents: Array.from({ length: 65 }, (_, i) => ({ document_id: `doc-${i}`, bank: BANK })) },
    { documents: [{ document_id: "/unsafe/doc", bank: BANK }] }, { documents: [{ document_id: "safe-doc", bank: BANK, status: "trusted" }] }]) {
    const r = recallFixture(f.origin, f.plan.document, { port: { query: async () => response, read: async () => { reads++; return {}; } } });
    await assert.rejects(r.recall.recall(historicalQuery), fails("sink-mismatch"));
  }
  assert.equal(reads, 0);
  for (const response of [true, { document_id: "wrong-doc", bank: BANK, document: f.plan.document }, { document_id: "archive-document", bank: "wrong-bank", document: f.plan.document },
    { document_id: "archive-document", bank: BANK, document: { status: "trusted", content_digest: f.plan.document.content_digest } }]) {
    const r = recallFixture(f.origin, f.plan.document, { port: { query: async () => ({ documents: [{ document_id: "archive-document", bank: BANK }] }), read: async () => response } });
    await assert.rejects(r.recall.recall(historicalQuery), fails("sink-mismatch"));
  }
});
test("portable own-data boundary: proxies/revoked/accessors/custom prototypes/symbols/undefined/arrays never invoke traps or inherited optional getters", async () => {
  const f = await archiveFixture(); let traps = 0;
  const handler = { get: () => { traps++; throw Error(); }, getPrototypeOf: () => { traps++; throw Error(); }, ownKeys: () => { traps++; throw Error(); }, getOwnPropertyDescriptor: () => { traps++; throw Error(); } };
  const proxy = new Proxy({}, handler); const revoked = Proxy.revocable({}, handler); revoked.revoke();
  const accessor = Object.defineProperty({}, "content", { get: () => { traps++; throw Error(); } });
  const r = recallFixture(f.origin, f.plan.document);
  for (const input of [proxy, revoked.proxy, accessor, Object.assign(Object.create({ inherited: true }), f.plan.document), { ...f.plan.document, [Symbol("hidden")]: "label" }, { ...f.plan.document, tags: undefined },
    { ...f.plan.document, tags: new Array(1) }, { ...f.plan.document, tags: Object.assign(["knowledge:skill"], { extra: "label" }) }]) {
    await assert.rejects(r.recall.authenticate(input as SafeDocument, SCOPE), fails("unverified-archive"));
  }
  for (const input of [proxy, revoked.proxy]) {
    assert.throws(() => createPortableRecall(input as PortableRecallConfig), fails("invalid-config"));
    assert.throws(() => createPortableRecall({ origins: [input] as any, now: () => 20_000, max_age_ms: 60_000 }), fails("invalid-config"));
    assert.throws(() => createPortableRecall({ origins: [f.origin.pin], now: () => 20_000, max_age_ms: 60_000, port: input as any }), fails("invalid-config"));
    await assert.rejects(r.recall.recall(input as any), fails("invalid-input"));
    assert.throws(() => r.recall.select(input as any, historicalQuery), fails("invalid-input"));
    assert.throws(() => r.recall.compileContext(input as any), fails("stale-history"));
  }
  Object.defineProperty(Object.prototype, "lifecycle", { configurable: true, get: () => { traps++; throw Error(); } });
  Object.defineProperty(Object.prototype, "max_lifecycle_age_ms", { configurable: true, get: () => { traps++; throw Error(); } });
  try {
    const without = createPortableRecall({ origins: [f.origin.pin], now: () => 20_000, max_age_ms: 60_000 });
    assert.equal((await without.authenticate(f.plan.document, SCOPE)).lifecycle.state, "not-checked");
  } finally { delete (Object.prototype as any).lifecycle; delete (Object.prototype as any).max_lifecycle_age_ms; }
  assert.equal(traps, 0);
});
test("portable historical schema rejects unsafe derived content, dependency/count/failure mismatches and unknown/undefined fields even if signed", async () => {
  const f = await archiveFixture(); const r = recallFixture(f.origin, f.plan.document);
  for (const mutate of [
    (p: any) => { p.experience.script.description = "wrapped_ghp_abcdefghijklmnop"; }, (p: any) => { p.experience.script.description = "https://example.invalid"; },
    (p: any) => { p.experience.steps[0].tool = "bash"; }, (p: any) => { p.experience.steps[0].depends_on = ["step-2"]; },
    (p: any) => { p.experience.steps[0].repair_action_id = "opaque-repair"; }, (p: any) => { p.experience.script.task_type = "wrong-task"; },
    (p: any) => { p.experience.model_id = "wrapped_AKIAABCDEFGHIJKLMNOP"; }, (p: any) => { p.experience.artifacts = ["raw-artifact"]; },
    (p: any) => { p.evidence = []; }, (p: any) => { p.evidence[0].expires_at = Infinity; }, (p: any) => { p.origin.extra = "unknown-label"; },
  ]) {
    const doc = alteredDocument(f.plan.document, envelope => mutate(envelope.payload), f.origin);
    await assert.rejects(r.recall.authenticate(doc, SCOPE), fails("unverified-archive"));
  }
});
test("portable port/config snapshots remain detached and can only perform explicitly injected callbacks", async () => {
  const f = await archiveFixture(); let originals = 0; let replaced = 0;
  const port = { query: async () => { originals++; return { documents: [{ document_id: "archive-document", bank: BANK }] }; }, read: async (ref: any) => { originals++; return { ...ref, document: f.plan.document }; } };
  const r = createPortableRecall({ origins: [f.origin.pin], now: () => 20_000, max_age_ms: 60_000, port });
  (f.origin.pin as any).trust = "revoked"; port.query = async () => { replaced++; return { documents: [] }; }; port.read = async () => { replaced++; return {}; };
  assert.equal((await r.recall(historicalQuery)).histories.length, 1); assert.equal(originals, 2); assert.equal(replaced, 0);
});
