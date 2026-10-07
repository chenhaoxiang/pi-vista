import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import {
  createLearningLibrary, LearningError, type ArchivePlan, type IngestRequest, type LearningConfig, type LearningSink,
} from "@pi-vista/learning";
import { QUERY, deferred, ownerFixture, sampleObservation, sinkFixture, verifiedExperience } from "./learning.fixtures.js";
import { BANK, archiveFixture, canonical, originFixture, sha256, signedResponse } from "./portable.fixtures.js";
const fails = (code: string) => (error: unknown) => error instanceof LearningError && error.code === code && error.message === code && error.stack === `LearningError: ${code}`;
const ack = (request: IngestRequest) => ({ document_id: "archive-document", bank: request.bank, content_digest: request.content_digest, idempotency_key: request.idempotency_key });

function frozenTree(input: any): void {
  if (input === null || typeof input !== "object") return;
  assert.ok(Object.isFrozen(input)); if (!Array.isArray(input)) assert.equal(Object.getPrototypeOf(input), null);
  for (const descriptor of Object.values(Object.getOwnPropertyDescriptors(input))) if ("value" in descriptor) frozenTree(descriptor.value);
}
test("portable producer: fresh exact evidence is re-read before signing a detached bounded archive preview, without memory writes", async () => {
  const f = await archiveFixture(); const plan = f.plan;
  assert.deepEqual(f.owner.calls, { gate: 2, test: 2, guard: 2 }); assert.equal(f.origin.calls(), 1);
  assert.deepEqual(f.transport.counts(), { ingests: 0, readbacks: 0 });
  assert.equal(plan.authorization, "none"); assert.equal(plan.executable, false); assert.equal(plan.mode, "dry-run");
  assert.equal(plan.archive_digest, sha256(canonical(JSON.parse(plan.document.content).payload)));
  assert.equal(plan.document.content_digest, sha256(plan.document.content));
  assert.equal(plan.preview_digest, sha256(canonical({ bank: plan.bank, document: plan.document })));
  assert.equal(plan.idempotency_key, `archive-${plan.preview_digest}`); frozenTree(plan);
  assert.throws(() => { (plan.origin as any).issuer = "changed-issuer"; }, TypeError);
  const envelope = JSON.parse(plan.document.content);
  assert.deepEqual(Object.keys(envelope).sort(), ["content_digest", "payload", "signature"]);
  assert.equal(envelope.payload.source_status_at_archive, "verified");
  assert.equal(envelope.payload.evidence.length, 3); assert.equal(envelope.payload.experience.script.description, "bounded metadata validation");
  assert.ok(!plan.document.content.includes("PUBLIC KEY")); assert.ok(!plan.document.content.includes("details"));
  assert.ok(!plan.document.content.includes("hindsight_doc_id"));
  const again = await f.library.prepareArchive(f.verified, BANK); assert.equal(again.preview_digest, plan.preview_digest);
});
test("portable producer: raw/status/copied/serialized/foreign/Proxy handles cannot reach signer or owner readers", async () => {
  const f = await archiveFixture(); const other = createLearningLibrary({ verifier: f.owner.verifier, archive: f.origin.producer });
  let traps = 0; const hostile = new Proxy({}, { get: () => { traps++; throw Error(); }, getPrototypeOf: () => { traps++; throw Error(); } });
  const calls = { ...f.owner.calls }; const signatures = f.origin.calls();
  for (const fake of [sampleObservation(), { ...f.verified }, JSON.parse(JSON.stringify(f.verified)), { status: "trusted" }, hostile]) {
    await assert.rejects(f.library.prepareArchive(fake as any, BANK), fails("invalid-handle"));
  }
  await assert.rejects(other.prepareArchive(f.verified, BANK), fails("invalid-handle"));
  assert.deepEqual(f.owner.calls, calls); assert.equal(f.origin.calls(), signatures); assert.equal(traps, 0);
});
for (const stage of ["observed", "candidate", "expired", "rejected", "superseded"] as const) {
  test(`portable producer: ${stage} cannot export authenticated history`, async () => {
    const owner = ownerFixture(); const origin = originFixture(); const library = createLearningLibrary({ verifier: owner.verifier, archive: origin.producer });
    let handle = stage === "observed" ? library.observe(sampleObservation()) : stage === "candidate" ? library.nominate(library.observe(sampleObservation())) : await verifiedExperience(library, owner);
    if (stage === "expired") owner.setNow(15_000);
    if (stage === "rejected") handle = library.reject(handle);
    if (stage === "superseded") handle = library.supersede(handle, await verifiedExperience(library, owner, "replacement-experience"));
    const before = { ...owner.calls };
    await assert.rejects(library.prepareArchive(handle, BANK), fails("unverified-evidence"));
    assert.equal(origin.calls(), 0); assert.deepEqual(owner.calls, before);
  });
}
test("portable producer: current trusted state can archive; deprecated and obsolete prior handles cannot", async () => {
  const f = await archiveFixture();
  const promotion = f.library.preparePromotion(f.verified, BANK); const trusted = await f.library.commitPromotion(promotion, { preview_digest: promotion.preview_digest });
  await assert.rejects(f.library.prepareArchive(f.verified, BANK), fails("invalid-handle"));
  const plan = await f.library.prepareArchive(trusted, BANK); assert.equal(JSON.parse(plan.document.content).payload.source_status_at_archive, "trusted");
  const deprecated = f.library.deprecate(trusted);
  await assert.rejects(f.library.commitArchive(plan, { preview_digest: plan.preview_digest }), fails("archive-invalidated"));
  await assert.rejects(f.library.prepareArchive(trusted, BANK), fails("invalid-handle"));
  await assert.rejects(f.library.prepareArchive(deprecated, BANK), fails("unverified-evidence"));
});
for (const kind of ["gate", "test", "guard"] as const) {
  test(`portable producer: changed signed ${kind} claim is not cached as eligible for archive signing or upload`, async () => {
    const f = await archiveFixture(); f.owner.payloads[kind].receipt_ref = "changed-ref"; f.owner.seal(kind);
    await assert.rejects(f.library.prepareArchive(f.verified, BANK), fails("unverified-evidence"));
    assert.equal(f.origin.calls(), 1);
    await assert.rejects(f.library.commitArchive(f.plan, { preview_digest: f.plan.preview_digest }), fails("unverified-evidence"));
    assert.deepEqual(f.transport.counts(), { ingests: 0, readbacks: 0 });
    await assert.rejects(f.library.commitArchive(f.plan, { preview_digest: f.plan.preview_digest }), fails("archive-used"));
  });
}
test("portable producer: owner refresh error/timeout/late rejection cannot sign or upload; upload refresh consumes its attempt", async () => {
  for (const phase of ["prepare", "commit"] as const) {
    const f = await archiveFixture(); const late = deferred<unknown>(); let signal!: AbortSignal;
    f.owner.hooks.test = value => { signal = value; return late.promise; };
    const operation = phase === "prepare" ? f.library.prepareArchive(f.verified, BANK) : f.library.commitArchive(f.plan, { preview_digest: f.plan.preview_digest });
    await assert.rejects(operation, fails("unverified-evidence")); assert.ok(signal.aborted);
    late.reject(Error("late synthetic owner rejection")); await new Promise(resolve => setTimeout(resolve, 10));
    assert.equal(f.origin.calls(), 1); assert.deepEqual(f.transport.counts(), { ingests: 0, readbacks: 0 });
    if (phase === "commit") await assert.rejects(f.library.commitArchive(f.plan, { preview_digest: f.plan.preview_digest }), fails("archive-used"));
    f.owner.hooks.test = async () => { throw Error("synthetic private owner detail"); };
    await assert.rejects(f.library.prepareArchive(f.verified, BANK), fails("unverified-evidence")); assert.equal(f.origin.calls(), 1);
  }
});
test("portable producer: lifecycle withdrawn during owner refresh cannot sign a portable preview", async () => {
  const f = await archiveFixture(); const gate = deferred<unknown>(); f.owner.hooks.gate = () => gate.promise;
  const pending = f.library.prepareArchive(f.verified, BANK); f.library.reject(f.verified); gate.resolve(f.owner.receipts.gate);
  await assert.rejects(pending, fails("archive-invalidated")); assert.equal(f.origin.calls(), 1); assert.deepEqual(f.transport.counts(), { ingests: 0, readbacks: 0 });
});
test("portable producer: no default signer/sink, wrong scope and a backdated archive clock cannot export", async () => {
  const owner = ownerFixture(); const library = createLearningLibrary({ verifier: owner.verifier }); const verified = await verifiedExperience(library, owner);
  await assert.rejects(library.prepareArchive(verified, BANK), fails("archive-unavailable")); assert.equal(owner.calls.gate, 1);
  const origin = originFixture(); const l = createLearningLibrary({ verifier: owner.verifier, archive: origin.producer }); const h = await verifiedExperience(l, owner);
  await assert.rejects(l.prepareArchive(h, "wrong-bank"), fails("unverified-archive"));
  origin.setNow(9_999); await assert.rejects(l.prepareArchive(h, BANK), fails("unverified-archive")); assert.equal(origin.calls(), 0);
  const freshOrigin = originFixture(); const noSink = createLearningLibrary({ verifier: owner.verifier, archive: freshOrigin.producer });
  const plan = await noSink.prepareArchive(await verifiedExperience(noSink, owner), BANK);
  await assert.rejects(noSink.commitArchive(plan, { preview_digest: plan.preview_digest }), fails("sink-unavailable"));
});
for (const response of [true, {}, { ok: true }, { signature: "invalid-signature" }, { signature: "a".repeat(86) + "==" }, { signature: undefined }]) {
  test(`portable producer: malformed or wrong-key signer response ${JSON.stringify(response)} rejects`, async () => {
    const owner = ownerFixture(); const origin = originFixture(); origin.hooks.sign = async () => response;
    const library = createLearningLibrary({ verifier: owner.verifier, archive: origin.producer });
    await assert.rejects(library.prepareArchive(await verifiedExperience(library, owner), BANK), fails("sink-mismatch"));
  });
}
test("portable producer: signer must sign the exact canonical payload with the pinned key", async () => {
  for (const change of ["message", "key"] as const) {
    const owner = ownerFixture(); const origin = originFixture(); const other = originFixture();
    origin.hooks.sign = async request => signedResponse(change === "key" ? other : origin, change === "message" ? { ...request, message: request.message + " " } : request);
    const library = createLearningLibrary({ verifier: owner.verifier, archive: origin.producer });
    await assert.rejects(library.prepareArchive(await verifiedExperience(library, owner), BANK), fails("sink-mismatch"));
  }
});
test("portable producer: signer exception/timeout/late rejection/native-promise boundary has fixed errors and best-effort abort", async () => {
  const owner = ownerFixture(); const origin = originFixture(); const late = deferred<unknown>(); let signal!: AbortSignal;
  origin.hooks.sign = (_request, s) => { signal = s; return late.promise; };
  const library = createLearningLibrary({ verifier: owner.verifier, archive: origin.producer, timeout_ms: 5 }); const handle = await verifiedExperience(library, owner);
  await assert.rejects(library.prepareArchive(handle, BANK), fails("sink-timeout")); assert.ok(signal.aborted);
  late.reject(Error("synthetic private callback detail")); await new Promise(resolve => setTimeout(resolve, 10));
  origin.hooks.sign = () => { throw Error("synthetic private callback detail"); };
  await assert.rejects(library.prepareArchive(handle, BANK), fails("sink-failed"));
  let traps = 0; const thenable = Object.defineProperty({}, "then", { get: () => { traps++; throw Error(); } });
  const proxy = new Proxy(Promise.resolve({}), { get: () => { traps++; throw Error(); } });
  for (const result of [thenable, proxy]) { origin.hooks.sign = (() => result) as any; await assert.rejects(library.prepareArchive(handle, BANK), fails("sink-failed")); }
  origin.hooks.sign = request => { const promise = Promise.resolve(signedResponse(origin, request)); Object.defineProperty(promise, "then", { get: () => { traps++; throw Error(); } }); return promise; };
  assert.equal((await library.prepareArchive(handle, BANK)).authorization, "none"); assert.equal(traps, 0);
});
test("portable producer: over-deadline synchronous signer cannot succeed; lifecycle/clock/expiry races cannot finish a preview", async () => {
  for (const action of ["blocking", "reject", "expire", "key-expire", "clock-rollback"] as const) {
    const owner = ownerFixture(); const origin = originFixture(); let handle: any; let library: ReturnType<typeof createLearningLibrary>;
    origin.hooks.sign = request => {
      if (action === "blocking") { const start = performance.now(); while (performance.now() - start < 15) { /* trusted synthetic callback */ } }
      if (action === "reject") library.reject(handle);
      if (action === "expire") owner.setNow(15_000);
      if (action === "key-expire") origin.setNow(12_000);
      if (action === "clock-rollback") origin.setNow(9_999);
      return Promise.resolve(signedResponse(origin, request));
    };
    library = createLearningLibrary({ verifier: owner.verifier, archive: origin.producer, timeout_ms: action === "blocking" ? 5 : 1000 }); handle = await verifiedExperience(library, owner);
    await assert.rejects(library.prepareArchive(handle, BANK), fails(action === "blocking" ? "sink-timeout" : action === "reject" ? "archive-invalidated" : action === "expire" ? "unverified-evidence" : "unverified-archive"));
  }
});
test("portable upload: exact confirmation and readback do not raise verified to trusted or grant permission", async () => {
  const f = await archiveFixture();
  for (const confirmation of [{ approved: true }, { preview_digest: "f".repeat(64) }, { preview_digest: f.plan.preview_digest, status: "trusted" }, { preview_digest: undefined }]) {
    await assert.rejects(f.library.commitArchive(f.plan, confirmation as any), fails("invalid-confirmation"));
  }
  assert.equal(f.owner.calls.gate, 2); assert.deepEqual(f.transport.counts(), { ingests: 0, readbacks: 0 });
  const result = await f.library.commitArchive(f.plan, { preview_digest: f.plan.preview_digest }); frozenTree(result);
  assert.equal(result.authorization, "none"); assert.equal(result.executable, false); assert.equal(result.persistence, "host-readback-matched");
  assert.equal(f.library.retrieve([f.verified], QUERY).handles[0]!.status, "verified"); assert.equal(f.verified.hindsight_doc_id, undefined);
  assert.deepEqual(f.owner.calls, { gate: 3, test: 3, guard: 3 }); assert.deepEqual(f.transport.counts(), { ingests: 1, readbacks: 1 });
});
test("portable upload: copied, serialized, foreign and ordinary promotion plans cannot request a write", async () => {
  const f = await archiveFixture(); const other = createLearningLibrary({ verifier: f.owner.verifier, archive: f.origin.producer, sink: f.transport.sink });
  for (const plan of [{ ...f.plan }, JSON.parse(JSON.stringify(f.plan)), f.library.preparePromotion(f.verified, BANK)]) {
    await assert.rejects(f.library.commitArchive(plan as ArchivePlan, { preview_digest: plan.preview_digest }), fails("invalid-plan"));
  }
  await assert.rejects(other.commitArchive(f.plan, { preview_digest: f.plan.preview_digest }), fails("invalid-plan"));
  await assert.rejects(f.library.commitPromotion(f.plan as any, { preview_digest: f.plan.preview_digest }), fails("invalid-plan"));
  assert.deepEqual(f.transport.counts(), { ingests: 0, readbacks: 0 });
});
test("portable upload: concurrent/same/equivalent plans perform one attempt, even when persistence is uncertain", async () => {
  const f = await archiveFixture(); const again = await f.library.prepareArchive(f.verified, BANK);
  const results = await Promise.allSettled([f.library.commitArchive(f.plan, { preview_digest: f.plan.preview_digest }), f.library.commitArchive(again, { preview_digest: again.preview_digest })]);
  assert.equal(results.filter(row => row.status === "fulfilled").length, 1); assert.deepEqual(f.transport.counts(), { ingests: 1, readbacks: 1 });
  const failure = await archiveFixture({ sink: { ingest: async () => { throw Error("uncertain synthetic write"); }, readback: async () => ({}) } });
  await assert.rejects(failure.library.commitArchive(failure.plan, { preview_digest: failure.plan.preview_digest }), fails("sink-failed"));
  const replacement = await failure.library.prepareArchive(failure.verified, BANK);
  await assert.rejects(failure.library.commitArchive(replacement, { preview_digest: replacement.preview_digest }), fails("archive-used"));
});
for (const phase of ["ingest", "readback"] as const) {
  for (const field of ["document_id", "bank", "content_digest", "idempotency_key", "title", "content", "tags"] as const) {
    if (phase === "ingest" && ["title", "content", "tags"].includes(field)) continue;
    test(`portable upload: ${phase} ${field} mismatch rejects without current trust`, async () => {
      let request!: IngestRequest; let reads = 0;
      const sink: LearningSink = { ingest: async value => { request = value; const receipt: any = ack(value); if (phase === "ingest") receipt[field] = field === "document_id" ? "/unsafe/document" : field === "content_digest" ? "f".repeat(64) : "wrong-value"; return receipt; },
        readback: async receipt => { reads++; const result: any = { ...receipt, title: request.title, content: request.content, tags: request.tags };
          if (phase === "readback") result[field] = field === "tags" ? ["knowledge:failure"] : field === "content_digest" ? "f".repeat(64) : "wrong-value"; return result; } };
      const f = await archiveFixture({ sink }); await assert.rejects(f.library.commitArchive(f.plan, { preview_digest: f.plan.preview_digest }), fails("sink-mismatch"));
      assert.equal(reads, phase === "ingest" ? 0 : 1); assert.equal(f.verified.status, "verified");
    });
  }
  test(`portable upload: ${phase} timeout aborts and consumes late rejection plus retry opportunity`, async () => {
    const transport = sinkFixture(); const late = deferred<unknown>(); let signal!: AbortSignal;
    const f = await archiveFixture({ timeout_ms: 5, sink: { ...transport.sink, [phase]: (...args: any[]) => { signal = args[1]; return late.promise; } } });
    await assert.rejects(f.library.commitArchive(f.plan, { preview_digest: f.plan.preview_digest }), fails("sink-timeout")); assert.ok(signal.aborted);
    late.reject(Error("late synthetic write")); await new Promise(resolve => setTimeout(resolve, 10));
    await assert.rejects(f.library.commitArchive(f.plan, { preview_digest: f.plan.preview_digest }), fails("archive-used")); assert.equal(f.verified.status, "verified");
  });
}
test("portable upload: lifecycle or current evidence expiry after either host write/readback cannot become success", async () => {
  for (const phase of ["ingest", "readback"] as const) for (const action of ["reject", "expire"] as const) {
    const owner = ownerFixture(); const origin = originFixture(); let library: ReturnType<typeof createLearningLibrary>; let handle: any; let request!: IngestRequest;
    const act = () => { if (action === "reject") library.reject(handle); else owner.setNow(15_000); };
    const sink: LearningSink = { ingest: async value => { request = value; if (phase === "ingest") act(); return ack(value); }, readback: async receipt => { if (phase === "readback") act(); return { ...receipt, title: request.title, content: request.content, tags: request.tags }; } };
    library = createLearningLibrary({ verifier: owner.verifier, archive: origin.producer, sink }); handle = await verifiedExperience(library, owner); const plan = await library.prepareArchive(handle, BANK);
    await assert.rejects(library.commitArchive(plan, { preview_digest: plan.preview_digest }), fails(action === "reject" ? "archive-invalidated" : "unverified-evidence"));
  }
});
test("portable producer: pin/config mutation is detached and invalid key/role/revocation/own-data configurations reject", async () => {
  const owner = ownerFixture(); const origin = originFixture();
  const library = createLearningLibrary({ verifier: owner.verifier, archive: origin.producer });
  (origin.pin as any).bank = "changed-bank"; (origin.producer as any).sign = async () => ({ signature: "bad" });
  const plan = await library.prepareArchive(await verifiedExperience(library, owner), BANK); assert.equal(plan.bank, BANK);
  const other = originFixture(); const rsa = generateKeyPairSync("rsa", { modulusLength: 2048 });
  for (const changes of [{ role: "gate" }, { trust: "revoked" }, { trust: undefined }, { not_before: 20, not_after: 10 }, { public_key: other.keys.privateKey.export({ type: "pkcs8", format: "pem" }).toString() },
    { public_key: rsa.publicKey.export({ type: "spki", format: "pem" }).toString() }, { issuer: "wrapped_ghp_abcdefghijklmnop" }, { extra: true }]) {
    assert.throws(() => createLearningLibrary({ verifier: owner.verifier, archive: { ...other.producer, origin: { ...other.pin, ...changes } } } as LearningConfig), fails("invalid-config"));
  }
});
