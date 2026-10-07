import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  createLearningLibrary, LearningError, type IngestRequest, type LearningSink, type PromotionPlan, type SinkReceipt,
} from "@pi-vista/learning";
import { QUERY, deferred, learningFixture, ownerFixture, sinkFixture, verifiedExperience } from "./learning.fixtures.js";
const fails = (code: string) => (error: unknown) => error instanceof LearningError && error.code === code && error.message === code && error.stack === `LearningError: ${code}`;
const ack = (request: IngestRequest): SinkReceipt => ({ document_id: "fixture-document", bank: request.bank, content_digest: request.content_digest, idempotency_key: request.idempotency_key });
const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");
function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) as string;
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(",")}}`;
}

test("dry-run exact content/preview digests are stable, immutable, offline and bound to bank", async () => {
  const f = await learningFixture(); const before = { ...f.owner.calls };
  const plan = f.library.preparePromotion(f.verified, "fixture-bank"); const again = f.library.preparePromotion(f.verified, "fixture-bank");
  assert.deepEqual(f.owner.calls, before); assert.deepEqual(f.transport.counts(), { ingests: 0, readbacks: 0 });
  assert.equal(plan.authorization, "none"); assert.equal(plan.mode, "dry-run"); assert.equal(plan.preview_digest, again.preview_digest);
  assert.equal(plan.document.content_digest, sha256(plan.document.content));
  assert.equal(plan.preview_digest, sha256(canonical({ bank: plan.bank, document: plan.document })));
  assert.notEqual(plan.preview_digest, f.library.preparePromotion(f.verified, "other-bank").preview_digest);
  assert.equal(plan.idempotency_key, `learning-${plan.preview_digest}`);
  for (const object of [plan, plan.document, plan.document.tags]) assert.ok(Object.isFrozen(object));
  assert.throws(() => { (plan.document as any).content = "other-content"; }, TypeError);
  const trusted = await f.library.commitPromotion(plan, { preview_digest: plan.preview_digest });
  assert.equal(trusted.status, "trusted"); assert.deepEqual(f.owner.calls, { gate: 2, test: 2, guard: 2 });
  assert.equal(f.transport.requests[0]!.content, plan.document.content);
  assert.equal(f.transport.requests[0]!.idempotency_key, plan.idempotency_key);
  assert.ok(Object.isFrozen(f.transport.requests[0])); assert.ok(Object.isFrozen(f.transport.seenReceipts[0]));
  assert.ok(!plan.document.content.includes("signature"));
});
test("confirmation must name the exact preview and cannot be replaced by booleans or altered content", async () => {
  const f = await learningFixture(); const plan = f.library.preparePromotion(f.verified, "fixture-bank");
  for (const confirmation of [{ preview_digest: "f".repeat(64) }, { confirmed: true }, { preview_digest: plan.preview_digest, approved: true }, { preview_digest: undefined }]) {
    await assert.rejects(f.library.commitPromotion(plan, confirmation as any), fails("invalid-confirmation"));
  }
  assert.deepEqual(f.transport.counts(), { ingests: 0, readbacks: 0 }); assert.equal(f.owner.calls.gate, 1);
  assert.equal((await f.library.commitPromotion(plan, { preview_digest: plan.preview_digest })).status, "trusted");
});
test("forged, copied, serialized and foreign-library plans cannot call any transport", async () => {
  const f = await learningFixture(); const plan = f.library.preparePromotion(f.verified, "fixture-bank");
  for (const fake of [{ ...plan }, JSON.parse(JSON.stringify(plan)), { ...plan, bank: "other-bank" }, { ...plan, document: { ...plan.document, content: "changed" } }]) {
    await assert.rejects(f.library.commitPromotion(fake, { preview_digest: plan.preview_digest }), fails("invalid-plan"));
  }
  const other = createLearningLibrary({ verifier: f.owner.verifier, sink: f.transport.sink });
  await assert.rejects(other.commitPromotion(plan, { preview_digest: plan.preview_digest }), fails("invalid-plan"));
  assert.deepEqual(f.transport.counts(), { ingests: 0, readbacks: 0 });
});
for (const kind of ["gate", "test", "guard"] as const) {
  test(`commit refetches and refuses changed signed ${kind} receipt before any sink call`, async () => {
    const f = await learningFixture(); const plan = f.library.preparePromotion(f.verified, "fixture-bank");
    f.owner.payloads[kind].receipt_ref = "changed-reference"; f.owner.seal(kind);
    await assert.rejects(f.library.commitPromotion(plan, { preview_digest: plan.preview_digest }), fails("unverified-evidence"));
    assert.deepEqual(f.transport.counts(), { ingests: 0, readbacks: 0 });
    assert.deepEqual(f.owner.calls, { gate: 2, test: 2, guard: 2 });
    assert.equal(f.library.retrieve([f.verified], QUERY).handles[0]!.status, "verified");
  });
}
test("stale preview evidence fails before readers/sinks, and owner read errors cannot be cached as success", async () => {
  const f = await learningFixture(); const plan = f.library.preparePromotion(f.verified, "fixture-bank"); f.owner.setNow(15_000);
  await assert.rejects(f.library.commitPromotion(plan, { preview_digest: plan.preview_digest }), fails("unverified-evidence"));
  assert.equal(f.owner.calls.gate, 1); assert.deepEqual(f.transport.counts(), { ingests: 0, readbacks: 0 });
  const g = await learningFixture(); const p = g.library.preparePromotion(g.verified, "fixture-bank");
  g.owner.hooks.gate = async () => { throw Error("private owner path /fixture/private"); };
  await assert.rejects(g.library.commitPromotion(p, { preview_digest: p.preview_digest }), fails("unverified-evidence"));
  assert.deepEqual(g.transport.counts(), { ingests: 0, readbacks: 0 });
});
test("no default sink exists and dry-run stays available without transport", async () => {
  const owner = ownerFixture(); const library = createLearningLibrary({ verifier: owner.verifier });
  const verified = await verifiedExperience(library, owner); const plan = library.preparePromotion(verified, "fixture-bank");
  await assert.rejects(library.commitPromotion(plan, { preview_digest: plan.preview_digest }), fails("sink-unavailable"));
  assert.equal(owner.calls.gate, 1);
});
for (const bad of [true, false, 1, "persisted", null, {}, { ok: true }, { document_id: "fixture-document", bank: "fixture-bank", content_digest: "a".repeat(64), idempotency_key: "other-identity" }]) {
  test(`malformed acknowledgement ${JSON.stringify(bad)} cannot mark trusted or trigger readback`, async () => {
    const owner = ownerFixture(); let reads = 0;
    const library = createLearningLibrary({ verifier: owner.verifier, sink: { ingest: async () => bad, readback: async () => { reads++; return true; } } });
    const verified = await verifiedExperience(library, owner); const plan = library.preparePromotion(verified, "fixture-bank");
    await assert.rejects(library.commitPromotion(plan, { preview_digest: plan.preview_digest }), fails("sink-mismatch"));
    assert.equal(reads, 0); assert.equal(library.retrieve([verified], QUERY).handles[0]!.status, "verified");
  });
}
for (const field of ["document_id", "bank", "content_digest", "idempotency_key", "title", "content", "tags"] as const) {
  test(`readback ${field} must match the exact ingest request/receipt`, async () => {
    const owner = ownerFixture(); let request!: IngestRequest; let reads = 0;
    const sink: LearningSink = { ingest: async value => { request = value; return ack(value); }, readback: async receipt => {
      reads++; const returned: Record<string, unknown> = { ...receipt, title: request.title, content: request.content, tags: request.tags };
      returned[field] = field === "tags" ? ["knowledge:failure"] : field === "content_digest" ? "f".repeat(64) : "mismatched-value"; return returned;
    } };
    const library = createLearningLibrary({ verifier: owner.verifier, sink }); const verified = await verifiedExperience(library, owner);
    const plan = library.preparePromotion(verified, "fixture-bank");
    await assert.rejects(library.commitPromotion(plan, { preview_digest: plan.preview_digest }), fails("sink-mismatch"));
    assert.equal(reads, 1); assert.equal(library.retrieve([verified], QUERY).handles[0]!.status, "verified");
  });
}
test("ingest bank/hash/identity mismatches are refused before readback", async () => {
  for (const field of ["bank", "content_digest", "idempotency_key"] as const) {
    const owner = ownerFixture(); let reads = 0;
    const library = createLearningLibrary({ verifier: owner.verifier, sink: { ingest: async request => ({ ...ack(request), [field]: field === "content_digest" ? "f".repeat(64) : "other-value" }),
      readback: async () => { reads++; return {}; } } });
    const plan = library.preparePromotion(await verifiedExperience(library, owner), "fixture-bank");
    await assert.rejects(library.commitPromotion(plan, { preview_digest: plan.preview_digest }), fails("sink-mismatch")); assert.equal(reads, 0);
  }
});
for (const phase of ["ingest", "readback"] as const) {
  test(`${phase} exceptions/rejections are value-free and do not create trusted state`, async () => {
    for (const asyncThrow of [false, true]) {
      const owner = ownerFixture(); const transport = sinkFixture();
      const fail = asyncThrow ? async () => { throw Error("private credential ghp_abcdefghijklmnop /fixture/private"); } : () => { throw Error("private details"); };
      const library = createLearningLibrary({ verifier: owner.verifier, sink: { ...transport.sink, [phase]: fail } });
      const verified = await verifiedExperience(library, owner); const plan = library.preparePromotion(verified, "fixture-bank");
      await assert.rejects(library.commitPromotion(plan, { preview_digest: plan.preview_digest }), fails("sink-failed"));
      assert.equal(library.retrieve([verified], QUERY).handles[0]!.status, "verified");
    }
  });
  test(`${phase} timeout aborts, consumes late rejection, and cannot be retried through another plan`, async () => {
    const owner = ownerFixture(); const transport = sinkFixture(); const late = deferred<unknown>(); let signal!: AbortSignal;
    const library = createLearningLibrary({ verifier: owner.verifier, timeout_ms: 5, sink: { ...transport.sink, [phase]: (...args: any[]) => { signal = args[1]; return late.promise; } } });
    const verified = await verifiedExperience(library, owner); const plan = library.preparePromotion(verified, "fixture-bank");
    await assert.rejects(library.commitPromotion(plan, { preview_digest: plan.preview_digest }), fails("sink-timeout")); assert.ok(signal.aborted);
    late.reject(Error("late fixture rejection")); await new Promise(resolve => setTimeout(resolve, 10));
    assert.equal(library.retrieve([verified], QUERY).handles[0]!.status, "verified");
    const again = library.preparePromotion(verified, "fixture-bank"); assert.equal(again.idempotency_key, plan.idempotency_key);
    await assert.rejects(library.commitPromotion(again, { preview_digest: again.preview_digest }), fails("promotion-used"));
    const redirected = library.preparePromotion(verified, "another-bank");
    await assert.rejects(library.commitPromotion(redirected, { preview_digest: redirected.preview_digest }), fails("promotion-used"));
  });
}
test("arbitrary thenables and Proxy promise transports reject without reading .then or invoking traps", async () => {
  let traps = 0;
  const thenable = Object.defineProperty({}, "then", { get: () => { traps++; throw Error(); } });
  const proxy = new Proxy(Promise.resolve(true), { get: () => { traps++; throw Error(); }, getPrototypeOf: () => { traps++; throw Error(); } });
  for (const returned of [thenable, proxy]) {
    const owner = ownerFixture(); const library = createLearningLibrary({ verifier: owner.verifier, sink: { ingest: (() => returned) as any, readback: async () => ({}) } });
    const plan = library.preparePromotion(await verifiedExperience(library, owner), "fixture-bank");
    await assert.rejects(library.commitPromotion(plan, { preview_digest: plan.preview_digest }), fails("sink-failed"));
  }
  assert.equal(traps, 0);
});
test("a fulfilled native promise's shadow .then getter is not consulted", async () => {
  const owner = ownerFixture(); let request!: IngestRequest; let getters = 0;
  const library = createLearningLibrary({ verifier: owner.verifier, sink: {
    ingest: value => { request = value; const promise = Promise.resolve(ack(value)); Object.defineProperty(promise, "then", { get: () => { getters++; throw Error(); } }); return promise; },
    readback: async receipt => ({ ...receipt, title: request.title, content: request.content, tags: request.tags }),
  } });
  const plan = library.preparePromotion(await verifiedExperience(library, owner), "fixture-bank");
  assert.equal((await library.commitPromotion(plan, { preview_digest: plan.preview_digest })).status, "trusted"); assert.equal(getters, 0);
});
test("same-plan concurrent commits and equivalent plans perform at most one ingestion", async () => {
  const f = await learningFixture(); const plan = f.library.preparePromotion(f.verified, "fixture-bank");
  const other = f.library.preparePromotion(f.verified, "fixture-bank");
  const results = await Promise.allSettled([f.library.commitPromotion(plan, { preview_digest: plan.preview_digest }),
    f.library.commitPromotion(plan, { preview_digest: plan.preview_digest }), f.library.commitPromotion(other, { preview_digest: other.preview_digest })]);
  assert.equal(results.filter(result => result.status === "fulfilled").length, 1);
  for (const result of results) if (result.status === "rejected") assert.ok(fails("promotion-used")(result.reason));
  assert.deepEqual(f.transport.counts(), { ingests: 1, readbacks: 1 });
});
test("competing bank previews for one experience cannot race multiple writes", async () => {
  const f = await learningFixture(); const one = f.library.preparePromotion(f.verified, "fixture-bank"); const two = f.library.preparePromotion(f.verified, "another-bank");
  const pending = f.library.commitPromotion(one, { preview_digest: one.preview_digest });
  await assert.rejects(f.library.commitPromotion(two, { preview_digest: two.preview_digest }), fails("promotion-used"));
  await pending; assert.deepEqual(f.transport.counts(), { ingests: 1, readbacks: 1 });
});
test("lifecycle invalidation during evidence refresh prevents ingestion", async () => {
  const f = await learningFixture(); const plan = f.library.preparePromotion(f.verified, "fixture-bank"); const gate = deferred<unknown>();
  f.owner.hooks.gate = () => gate.promise;
  const pending = f.library.commitPromotion(plan, { preview_digest: plan.preview_digest }); f.library.reject(f.verified); gate.resolve(f.owner.receipts.gate);
  await assert.rejects(pending, fails("promotion-invalidated")); assert.deepEqual(f.transport.counts(), { ingests: 0, readbacks: 0 });
});
test("lifecycle invalidation or expiry after a write cannot mint trusted", async () => {
  for (const action of ["reject", "expire"] as const) {
    const owner = ownerFixture(); let library: ReturnType<typeof createLearningLibrary>; let verified: Awaited<ReturnType<typeof verifiedExperience>>;
    const sink: LearningSink = { ingest: async request => { if (action === "reject") library.reject(verified); else owner.setNow(15_000); return ack(request); },
      readback: async () => { throw Error("must not reach readback"); } };
    library = createLearningLibrary({ verifier: owner.verifier, sink }); verified = await verifiedExperience(library, owner);
    const plan = library.preparePromotion(verified, "fixture-bank");
    await assert.rejects(library.commitPromotion(plan, { preview_digest: plan.preview_digest }), fails(action === "reject" ? "promotion-invalidated" : "unverified-evidence"));
  }
});
test("over-deadline synchronous trusted transport is not mistaken for bounded success", async () => {
  const owner = ownerFixture(); const library = createLearningLibrary({ verifier: owner.verifier, timeout_ms: 5, sink: {
    ingest: request => { const start = performance.now(); while (performance.now() - start < 15) { /* synthetic blocking trusted host */ } return Promise.resolve(ack(request)); },
    readback: async () => ({}),
  } });
  const plan = library.preparePromotion(await verifiedExperience(library, owner), "fixture-bank");
  await assert.rejects(library.commitPromotion(plan, { preview_digest: plan.preview_digest }), fails("sink-timeout"));
});

test("stable content identity survives a new library and later proof timestamp, not a durable deduplication promise", async () => {
  const f = await learningFixture(); const original = f.library.preparePromotion(f.verified, "fixture-bank"); f.owner.setNow(10_001);
  const other = createLearningLibrary({ verifier: f.owner.verifier }); const fresh = await verifiedExperience(other, f.owner);
  const next = other.preparePromotion(fresh, "fixture-bank");
  assert.equal(next.preview_digest, original.preview_digest); assert.equal(next.idempotency_key, original.idempotency_key);
  assert.deepEqual(f.transport.counts(), { ingests: 0, readbacks: 0 });
});

test("owner refresh timeout before ingestion consumes its one-shot attempt and late rejection", async () => {
  const f = await learningFixture(); const plan = f.library.preparePromotion(f.verified, "fixture-bank"); const pending = deferred<unknown>(); let signal!: AbortSignal;
  f.owner.hooks.test = value => { signal = value; return pending.promise; };
  await assert.rejects(f.library.commitPromotion(plan, { preview_digest: plan.preview_digest }), fails("unverified-evidence"));
  assert.ok(signal.aborted); pending.reject(Error("late synthetic owner rejection")); await new Promise(resolve => setTimeout(resolve, 10));
  assert.deepEqual(f.transport.counts(), { ingests: 0, readbacks: 0 });
  await assert.rejects(f.library.commitPromotion(plan, { preview_digest: plan.preview_digest }), fails("promotion-used"));
});

test("matching readback followed by proof expiry still cannot mint trusted", async () => {
  const owner = ownerFixture(); let request!: IngestRequest;
  const library = createLearningLibrary({ verifier: owner.verifier, sink: {
    ingest: async value => { request = value; return ack(value); },
    readback: async receipt => { owner.setNow(15_000); return { ...receipt, title: request.title, content: request.content, tags: request.tags }; },
  } });
  const verified = await verifiedExperience(library, owner); const plan = library.preparePromotion(verified, "fixture-bank");
  await assert.rejects(library.commitPromotion(plan, { preview_digest: plan.preview_digest }), fails("unverified-evidence"));
  owner.setNow(10_000); assert.equal(library.retrieve([verified], QUERY).handles[0]!.status, "verified");
});
