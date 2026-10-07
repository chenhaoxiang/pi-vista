import { test } from "node:test";
import assert from "node:assert/strict";
import { createLearningLibrary, LearningError } from "@pi-vista/learning";
import { QUERY, SUBJECTS, learningFixture, sampleObservation } from "./learning.fixtures.js";

// Characterize the live private-capability seam before adding portable history.
test("portable seam baseline: serialized, copied and foreign live handles/proofs cannot restore provenance", async () => {
  const f = await learningFixture();
  const other = createLearningLibrary({ verifier: f.owner.verifier });
  const candidate = other.nominate(other.observe(sampleObservation("new-experience")));
  const proof = await f.owner.verifier.verify(f.owner.expected, SUBJECTS);
  for (const copy of [{ ...proof }, JSON.parse(JSON.stringify(proof))]) {
    assert.throws(() => other.verifyCandidate(candidate, copy), (error: unknown) => error instanceof LearningError && error.code === "unverified-evidence");
  }
  for (const copy of [{ ...f.verified }, JSON.parse(JSON.stringify(f.verified)), f.verified]) {
    assert.equal(other.retrieve([copy], QUERY).handles.length, 0);
    assert.throws(() => other.preparePromotion(copy, "fixture-bank"), (error: unknown) => error instanceof LearningError && error.code === "invalid-handle");
  }
});
test("portable seam baseline: expired and withdrawn current handles remain non-authorizing historical snapshots", async () => {
  const f = await learningFixture(); const original = JSON.stringify(f.verified);
  f.owner.setNow(15_000);
  assert.equal(f.library.retrieve([f.verified], QUERY).handles.length, 0);
  assert.throws(() => f.library.preparePromotion(f.verified, "fixture-bank"), (error: unknown) => error instanceof LearningError && error.code === "unverified-evidence");
  const withdrawn = f.library.reject(f.verified);
  assert.equal(withdrawn.authorization, "none"); assert.equal(withdrawn.status, "rejected");
  assert.equal(JSON.stringify(f.verified), original);
  assert.equal(f.library.retrieve([withdrawn], QUERY).handles.length, 0);
});
