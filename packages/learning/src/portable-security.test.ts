import { test } from "node:test";
import assert from "node:assert/strict";
import { createLearningLibrary, createPortableRecall, LearningError } from "@pi-vista/learning";
import { EXPECTED, QUERY, ownerFixture, verifiedExperience } from "./learning.fixtures.js";
import { BANK, SCOPE, archiveFixture, originFixture, recallFixture } from "./portable.fixtures.js";
const fails = (code: string) => (error: unknown) => error instanceof LearningError && error.code === code;

test("portable hostile producer configuration and signer response reject without proxy/getter/array/coercion execution", async () => {
  const owner = ownerFixture(); const origin = originFixture(); let calls = 0;
  // Native host promise resolution may read .then before returning; it is not library reflection.
  const traps = { get: (_target: object, key: PropertyKey) => { if (key === "then") return undefined; calls++; throw Error(); }, getPrototypeOf: () => { calls++; throw Error(); }, ownKeys: () => { calls++; throw Error(); }, getOwnPropertyDescriptor: () => { calls++; throw Error(); } };
  const proxy = new Proxy({}, traps); const revoked = Proxy.revocable({}, traps); revoked.revoke();
  const fnProxy = new Proxy(() => { calls++; return 10_000; }, { apply: () => { calls++; throw Error(); } });
  const accessor = Object.defineProperty({}, "signature", { get: () => { calls++; throw Error(); } });
  for (const value of [proxy, revoked.proxy]) {
    assert.throws(() => createLearningLibrary({ verifier: owner.verifier, archive: value as any }), fails("invalid-config"));
    assert.throws(() => createLearningLibrary({ verifier: owner.verifier, archive: { ...origin.producer, origin: value as any } }), fails("invalid-config"));
  }
  for (const field of ["now", "sign"] as const) {
    assert.throws(() => createLearningLibrary({ verifier: owner.verifier, archive: { ...origin.producer, [field]: fnProxy } as any }), fails("invalid-config"));
  }
  const library = createLearningLibrary({ verifier: owner.verifier, archive: origin.producer }); const handle = await verifiedExperience(library, owner);
  for (const value of [proxy, revoked.proxy, accessor, [], Object.assign(Object.create({ inherited: true }), { signature: "unused" }), { signature: undefined }, { signature: "unused", [Symbol("hidden")]: true }]) {
    origin.hooks.sign = async () => value;
    await assert.rejects(library.prepareArchive(handle, BANK), fails(value === revoked.proxy ? "sink-failed" : "sink-mismatch"));
  }
  assert.equal(calls, 0);
});
test("portable config/optional normalized reads stay null-prototype under inherited archive/port/timeout getters", async () => {
  const owner = ownerFixture(); const origin = originFixture(); let getters = 0;
  const names = ["archive", "port", "timeout_ms", "model_id", "failure_analysis", "historical_origin", "historicalOrigin", "proof"];
  for (const name of names) {
    Object.defineProperty(Object.prototype, name, { configurable: true, get: () => { getters++; throw Error(); } });
  }
  try {
    const library = createLearningLibrary({ verifier: owner.verifier });
    await assert.rejects(library.prepareArchive(await verifiedExperience(library, owner), BANK), fails("archive-unavailable"));
    const recall = createPortableRecall({ origins: [origin.pin], now: () => 20_000, max_age_ms: 60_000 });
    await assert.rejects(recall.recall({ ...QUERY, bank: BANK }), fails("recall-unavailable"));
  } finally { for (const name of names) delete (Object.prototype as any)[name]; }
  assert.equal(getters, 0);
});
test("portable query/read/lifecycle responses reject hostile own descriptors and custom arrays without traps", async () => {
  const f = await archiveFixture(); let traps = 0;
  const handler = { get: (_target: object, key: PropertyKey) => { if (key === "then") return undefined; traps++; throw Error(); }, ownKeys: () => { traps++; throw Error(); }, getPrototypeOf: () => { traps++; throw Error(); } };
  const proxy = new Proxy({}, handler); const revoked = Proxy.revocable({}, handler); revoked.revoke();
  const accessor = Object.defineProperty({}, "documents", { get: () => { traps++; throw Error(); } });
  for (const phase of ["query", "read", "lifecycle"] as const) {
    for (const response of [proxy, revoked.proxy, accessor, Object.create({ inherited: true }), { [Symbol("hidden")]: "label" }]) {
      const port = { query: async () => ({ documents: [{ document_id: "archive-document", bank: BANK }] }), read: async (ref: any) => ({ ...ref, document: f.plan.document }) };
      const r = recallFixture(f.origin, f.plan.document, phase === "lifecycle" ? { lifecycle: async () => response } : { port: { ...port, [phase]: async () => response } });
      await assert.rejects(r.recall.recall({ ...QUERY, bank: BANK }), fails(response === revoked.proxy ? "sink-failed" : "sink-mismatch"));
    }
  }
  const badArrays = [Object.assign([{ document_id: "archive-document", bank: BANK }], { extra: true }), Object.setPrototypeOf([], Object.create(Array.prototype)), [undefined]];
  for (const documents of badArrays) {
    const r = recallFixture(f.origin, f.plan.document, { port: { query: async () => ({ documents }), read: async () => ({}) } });
    await assert.rejects(r.recall.recall({ ...QUERY, bank: BANK }), fails("sink-mismatch"));
  }
  assert.equal(traps, 0);
});
test("portable observed-only import rejects hostile context/copy handles; no ordinary observe status or origin restoration", async () => {
  const f = await archiveFixture(); const r = recallFixture(f.origin, f.plan.document); const history = await r.recall.authenticate(f.plan.document, SCOPE);
  const library = createLearningLibrary({ verifier: ownerFixture().verifier }); let traps = 0;
  const proxy = new Proxy({}, { get: () => { traps++; throw Error(); }, ownKeys: () => { traps++; throw Error(); }, getPrototypeOf: () => { traps++; throw Error(); } });
  const context = { ...EXPECTED, run_id: "new-run", experience_id: "new-experience", ts: 20_000 };
  assert.throws(() => library.importHistorical(history, proxy as any), fails("invalid-input"));
  assert.throws(() => library.importHistorical(proxy as any, context), fails("unverified-archive"));
  const withGetter = { ...context }; Object.defineProperty(withGetter, "experience_id", { get: () => { traps++; throw Error(); } });
  assert.throws(() => library.importHistorical(history, withGetter), fails("invalid-input"));
  const imported = library.importHistorical(history, context);
  assert.throws(() => library.observe({ ...history.experience, experience_id: "raw-origin", historical_origin: imported.historical_origin } as any), fails("invalid-input"));
  assert.throws(() => library.importHistorical(JSON.parse(JSON.stringify(history)), { ...context, experience_id: "serialized-history" }), fails("unverified-archive"));
  assert.equal(traps, 0); assert.equal(imported.status, "observed");
});
