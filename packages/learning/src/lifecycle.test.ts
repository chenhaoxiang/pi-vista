import { test } from "node:test";
import assert from "node:assert/strict";
import { createLearningLibrary, LearningError, MAX_EXPERIENCES, type ExperienceObservation, type LearningConfig } from "@pi-vista/learning";
import type { VerifiedEvidence } from "@pi-vista/evidence";
import { EXPECTED, QUERY, SUBJECTS, learningFixture, ownerFixture, sampleObservation, verifiedExperience } from "./learning.fixtures.js";

const fails = (code: string) => (error: unknown) => error instanceof LearningError && error.code === code && error.stack === `LearningError: ${code}`;

test("explicit observed -> candidate -> verified -> trusted invalidates previous lifecycle handles", async () => {
  const owner = ownerFixture(); const { sink, counts } = (await import("./learning.fixtures.js")).sinkFixture();
  const library = createLearningLibrary({ verifier: owner.verifier, sink });
  const observed = library.observe(sampleObservation()); assert.equal(observed.status, "observed"); assert.equal(observed.authorization, "none");
  const candidate = library.nominate(observed); assert.equal(candidate.status, "candidate");
  assert.throws(() => library.nominate(observed), fails("invalid-handle"));
  const proof = await owner.verifier.verify(EXPECTED, SUBJECTS); const verified = library.verifyCandidate(candidate, proof);
  assert.equal(verified.status, "verified"); assert.equal(verified.verification!.receipts.length, 3);
  assert.throws(() => library.reject(candidate), fails("invalid-handle"));
  const plan = library.preparePromotion(verified, "fixture-bank"); const trusted = await library.commitPromotion(plan, { preview_digest: plan.preview_digest });
  assert.equal(trusted.status, "trusted"); assert.equal(trusted.hindsight_doc_id, "document-1"); assert.equal(trusted.authorization, "none");
  assert.deepEqual(counts(), { ingests: 1, readbacks: 1 }); assert.equal(library.retrieve([verified, trusted], QUERY).rejected.stale, 1);
  assert.throws(() => library.preparePromotion(trusted, "fixture-bank"), fails("invalid-transition"));
});
for (const key of ["status", "verification", "trusted", "verified", "hindsight_doc_id", "superseded_by"] as const) {
  test(`observation cannot nominate its own ${key}`, () => {
    const library = createLearningLibrary({ verifier: ownerFixture().verifier });
    assert.throws(() => library.observe({ ...sampleObservation(), [key]: key === "status" ? "verified" : true } as unknown as ExperienceObservation), fails("invalid-input"));
  });
}
test("copies, serialized views and a different library cannot manufacture lifecycle handles", async () => {
  const f = await learningFixture();
  for (const fake of [{ ...f.verified }, JSON.parse(JSON.stringify(f.verified)), Object.assign(Object.create(null), f.verified)]) {
    assert.throws(() => f.library.preparePromotion(fake, "fixture-bank"), fails("invalid-handle"));
  }
  const other = createLearningLibrary({ verifier: f.owner.verifier });
  assert.throws(() => other.preparePromotion(f.verified, "fixture-bank"), fails("invalid-handle"));
  assert.equal(other.retrieve([f.verified], QUERY).rejected.unverified, 1);
});
test("a copied proof, flags or the same-shaped foreign-verifier proof cannot raise verification", async () => {
  const owner = ownerFixture(); const library = createLearningLibrary({ verifier: owner.verifier });
  const candidate = library.nominate(library.observe(sampleObservation())); const proof = await owner.verifier.verify(EXPECTED, SUBJECTS);
  const foreign = await ownerFixture().verifier.verify(EXPECTED, SUBJECTS);
  for (const fake of [{ ...proof }, JSON.parse(JSON.stringify(proof)), { gate_passed: true, tests_passed: true, guard_clean: true }, foreign]) {
    assert.throws(() => library.verifyCandidate(candidate, fake as VerifiedEvidence), fails("unverified-evidence"));
  }
  assert.equal(library.verifyCandidate(candidate, proof).status, "verified");
});
for (const field of ["run_id", "repo", "source_sha", "policy_version", "env_fingerprint"] as const) {
  test(`proof must match candidate ${field}`, async () => {
    const owner = ownerFixture(); const library = createLearningLibrary({ verifier: owner.verifier });
    const altered = { ...EXPECTED, [field]: field === "source_sha" ? "d".repeat(40) : "other-label" };
    const candidate = library.nominate(library.observe(sampleObservation("experience-1", altered)));
    const proof = await owner.verifier.verify(EXPECTED, SUBJECTS);
    assert.throws(() => library.verifyCandidate(candidate, proof), fails("unverified-evidence"));
  });
}
test("only branded factory verifier identities are accepted, without invoking fake methods", () => {
  const owner = ownerFixture(); let calls = 0;
  const fake = { verify: async () => { calls++; return {}; }, isCurrent: () => { calls++; return true; }, revalidate: async () => { calls++; return {}; } };
  for (const verifier of [fake, { ...owner.verifier }]) assert.throws(() => createLearningLibrary({ verifier } as LearningConfig), fails("invalid-config"));
  assert.equal(calls, 0);
});
test("expiration cannot raise verification or prepare a promotion", async () => {
  const owner = ownerFixture(); const library = createLearningLibrary({ verifier: owner.verifier });
  const candidate = library.nominate(library.observe(sampleObservation())); const proof = await owner.verifier.verify(EXPECTED, SUBJECTS);
  owner.setNow(15_000); assert.throws(() => library.verifyCandidate(candidate, proof), fails("unverified-evidence"));
  owner.setNow(10_000); const verified = library.verifyCandidate(candidate, proof); owner.setNow(15_000);
  assert.throws(() => library.preparePromotion(verified, "fixture-bank"), fails("unverified-evidence"));
});
test("invalid lifecycle jumps and terminal-state resurrection fail closed", async () => {
  const f = await learningFixture(); const observed = f.library.observe(sampleObservation("observed-2"));
  assert.throws(() => f.library.deprecate(observed), fails("invalid-transition"));
  assert.throws(() => f.library.verifyCandidate(observed, {} as VerifiedEvidence), fails("invalid-transition"));
  const rejected = f.library.reject(observed); assert.equal(rejected.status, "rejected");
  assert.throws(() => f.library.nominate(rejected), fails("invalid-transition"));
  assert.throws(() => f.library.reject(rejected), fails("invalid-transition"));
  const plan = f.library.preparePromotion(f.verified, "fixture-bank"); const rejectedVerified = f.library.reject(f.verified);
  assert.equal(rejectedVerified.status, "rejected");
  await assert.rejects(f.library.commitPromotion(plan, { preview_digest: plan.preview_digest }), fails("promotion-invalidated"));
  assert.deepEqual(f.transport.counts(), { ingests: 0, readbacks: 0 });
});
test("trusted may be deprecated, and verified/trusted may be superseded only by a fresh bound replacement", async () => {
  const f = await learningFixture(); const plan = f.library.preparePromotion(f.verified, "fixture-bank");
  const trusted = await f.library.commitPromotion(plan, { preview_digest: plan.preview_digest });
  const deprecated = f.library.deprecate(trusted); assert.equal(deprecated.status, "deprecated"); assert.equal(deprecated.hindsight_doc_id, undefined);
  assert.throws(() => f.library.preparePromotion(deprecated, "fixture-bank"), fails("unverified-evidence"));
  const old = await verifiedExperience(f.library, f.owner, "experience-old"); const next = await verifiedExperience(f.library, f.owner, "experience-next");
  assert.throws(() => f.library.supersede(old, old), fails("invalid-transition"));
  const superseded = f.library.supersede(old, next); assert.equal(superseded.status, "superseded"); assert.equal(superseded.superseded_by, "experience-next");
  assert.equal(f.library.retrieve([deprecated, superseded, next], QUERY).rejected.lifecycle, 2);
  assert.throws(() => f.library.reject(superseded), fails("invalid-transition"));
});
test("duplicate experience IDs and bounded library capacity reject without displacing records", () => {
  const library = createLearningLibrary({ verifier: ownerFixture().verifier }); const handle = library.observe(sampleObservation("experience-0"));
  assert.throws(() => library.observe(sampleObservation("experience-0")), fails("duplicate-experience"));
  for (let i = 1; i < MAX_EXPERIENCES; i++) library.observe(sampleObservation(`experience-${i}`));
  assert.throws(() => library.observe(sampleObservation("capacity-overflow")), fails("invalid-input"));
  assert.equal(library.nominate(handle).status, "candidate");
});
test("model identity is preserved only as sorted observational counts, never a routing or strength choice", () => {
  const library = createLearningLibrary({ verifier: ownerFixture().verifier });
  const a = library.observe({ ...sampleObservation("experience-a"), model_id: "model-z" });
  const b = library.observe({ ...sampleObservation("experience-b"), model_id: "model-a" });
  const c = library.observe({ ...sampleObservation("experience-c"), model_id: "model-z" });
  const stats = library.modelStatistics([a, b, c, a]); assert.equal(stats.authorization, "none"); assert.equal(stats.use, "observational-only");
  assert.deepEqual(stats.models.map(row => [row.model_id, row.observations]), [["model-a", 1], ["model-z", 2]]);
  assert.deepEqual(Object.keys(stats).sort(), ["authorization", "models", "use"]);
});
for (const [name, kind, change] of [
  ["gate override", "gate", (payload: any) => { payload.details.verdict = "owner-override"; }],
  ["gate missing checks", "gate", (payload: any) => { payload.details.checks = [{ name: "other-check", outcome: "pass" }]; }],
  ["failed test", "test", (payload: any) => { payload.details.suites[0].failed = 1; payload.details.suites[0].passed = 2; }],
  ["missing test suite", "test", (payload: any) => { payload.details.suites[0].name = "other-suite"; }],
  ["guard partial coverage", "guard", (payload: any) => { payload.details.coverage = "partial"; }],
  ["guard block", "guard", (payload: any) => { payload.details.blocked = 1; }],
] as const) {
  test(`signed ${name} cannot supply a proof for learning promotion`, async () => {
    const owner = ownerFixture(); const library = createLearningLibrary({ verifier: owner.verifier });
    const candidate = library.nominate(library.observe(sampleObservation())); change(owner.payloads[kind]); owner.seal(kind);
    await assert.rejects(owner.verifier.verify(EXPECTED, SUBJECTS), error => error instanceof Error && error.message === "unverified-evidence");
    assert.throws(() => library.preparePromotion(candidate, "fixture-bank"), fails("unverified-evidence"));
    assert.equal(library.retrieve([candidate], QUERY).handles.length, 0);
  });
}
