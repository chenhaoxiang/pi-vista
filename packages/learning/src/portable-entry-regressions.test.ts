import { test } from "node:test";
import assert from "node:assert/strict";
import { createLearningLibrary, createPortableRecall, LearningError } from "@pi-vista/learning";
import { EXPECTED, SUBJECTS } from "./learning.fixtures.js";
import { archiveFixture, BANK, SCOPE } from "./portable.fixtures.js";
const fails = (code: string) => (error: unknown) => error instanceof LearningError && error.code === code;

test("historical import refuses the old run even with a different ID and authentic current old proof", async () => {
  const f = await archiveFixture();
  const recall = createPortableRecall({ origins: [f.origin.pin], now: () => 10_000, max_age_ms: 60_000 });
  const history = await recall.authenticate(f.plan.document, SCOPE);
  const proof = await f.owner.verifier.verify(EXPECTED, SUBJECTS);
  assert.ok(f.owner.verifier.isCurrent(proof, EXPECTED));
  const receiver = createLearningLibrary({ verifier: f.owner.verifier });
  assert.throws(() => receiver.importHistorical(history, { ...EXPECTED, experience_id: "new-import", ts: 10_000 }), fails("unverified-archive"));
  // The refusal does not reserve the attempted ID; a distinct current run can observe it.
  const observed = receiver.importHistorical(history, { ...EXPECTED, run_id: "genuinely-new-run", experience_id: "new-import", ts: 10_000 });
  assert.equal(observed.status, "observed");
  const candidate = receiver.nominate(observed);
  assert.throws(() => receiver.verifyCandidate(candidate, proof), fails("unverified-evidence"));
  assert.equal(candidate.status, "candidate");
});

test("a fresh library refuses historical experience ID reuse even with a genuinely new run", async () => {
  const f = await archiveFixture();
  const recall = createPortableRecall({ origins: [f.origin.pin], now: () => 10_000, max_age_ms: 60_000 });
  const history = await recall.authenticate(f.plan.document, SCOPE);
  const receiver = createLearningLibrary({ verifier: f.owner.verifier });
  assert.throws(() => receiver.importHistorical(history, { ...EXPECTED, run_id: "genuinely-new-run",
    experience_id: history.experience.experience_id, ts: 10_000 }), fails("unverified-archive"));
  const valid = receiver.importHistorical(history, { ...EXPECTED, run_id: "genuinely-new-run", experience_id: "new-record", ts: 10_000 });
  assert.equal(valid.status, "observed"); assert.equal(valid.verification, undefined);
});

test("public historical select cannot retain or coerce extra internal counter seed arguments", async () => {
  const f = await archiveFixture();
  const recall = createPortableRecall({ origins: [f.origin.pin], now: () => 10_000, max_age_ms: 60_000 });
  const history = await recall.authenticate(f.plan.document, SCOPE);
  const query = { bank: BANK, repo: EXPECTED.repo, source_sha: EXPECTED.source_sha, policy_version: EXPECTED.policy_version,
    env_fingerprint: EXPECTED.env_fingerprint, task_type: history.experience.task_type };
  let coercions = 0; let traps = 0;
  const mutable = { valueOf() { coercions++; return 999; } };
  const proxy = new Proxy({}, { get() { traps++; throw Error("synthetic unused counter"); } });
  const invoke = recall.select as (...args: unknown[]) => ReturnType<typeof recall.select>;
  for (const seed of [mutable, proxy, "counter", Infinity, NaN]) {
    const empty = invoke([], query, seed, seed);
    assert.deepEqual(Object.values(empty.rejected), [0, 0, 0, 0, 0]);
    assert.ok(Object.values(empty.rejected).every(value => typeof value === "number" && Number.isFinite(value)));
    assert.ok(Object.isFrozen(empty.rejected));
    const wrongBank = invoke([history], { ...query, bank: "different-bank" }, seed, seed);
    assert.equal(wrongBank.rejected.bank, 1); assert.equal(wrongBank.rejected.duplicate, 0);
  }
  assert.equal(coercions, 0); assert.equal(traps, 0);
  assert.equal(Object.isFrozen(mutable), false, "caller object is neither frozen nor retained");
});
