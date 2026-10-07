import { test } from "node:test";
import assert from "node:assert/strict";
import {
  classifyFailure, createLearningLibrary, LearningError, type FailureObservation, type ExperienceObservation,
} from "@pi-vista/learning";
import { EXPECTED, SUBJECTS, learningFixture, ownerFixture, sampleObservation, sinkFixture } from "./learning.fixtures.js";
const fails = (code: string) => (error: unknown) => error instanceof LearningError && error.code === code;
const failure: FailureObservation = { failure_id: "failure-1", run_id: "run-1", step_id: "step-2", ts: 9_500, stage: "validation", reason_code: "test_failed" };

for (const [reason, type, root] of [
  ["guard_block", "safety", "safety_block"], ["test_failed", "validation", "test_regression"], ["gate_blocked", "validation", "gate_rejection"],
  ["sha_mismatch", "binding", "source_drift"], ["env_mismatch", "binding", "environment_drift"], ["policy_mismatch", "binding", "policy_drift"],
  ["path_conflict", "workspace", "workspace_conflict"], ["transport_timeout", "transport", "transport_wait"], ["unknown", "unknown", "unclassified"],
] as const) {
  test(`observed ${reason} has bounded deterministic ${type}/${root} hypothesis, never cause authority`, () => {
    const result = classifyFailure({ ...failure, reason_code: reason });
    assert.equal(result.authorization, "none"); assert.equal(result.verification, "observed-only"); assert.equal(result.reason_code, reason);
    assert.equal(result.failure_type, type); assert.equal(result.root_cause, root); assert.equal(result.root_cause_basis, "hypothesis");
    assert.deepEqual([...result.hypotheses], [root]); assert.ok(Object.isFrozen(result)); assert.equal(Object.getPrototypeOf(result), null);
  });
}
test("provided root-cause hypotheses stay distinct from observed reasons; fix observations do not mint verification", () => {
  const result = classifyFailure({ ...failure, hypotheses: ["environment_drift"], fix_applied: "pin-environment", fix_outcome: "resolved" });
  assert.equal(result.reason_code, "test_failed"); assert.deepEqual([...result.hypotheses], ["test_regression", "environment_drift"]);
  assert.equal(result.verification, "observed-only"); assert.equal(result.fix_applied, "pin-environment");
});
test("failure classification rejects raw prose, forged authority, unknown codes and incomplete fix pairs", () => {
  for (const invalid of [
    { ...failure, root_cause: "arbitrary model narrative" }, { ...failure, reason_code: "unknown-free-form" }, { ...failure, verification: "verified" },
    { ...failure, hypotheses: ["unknown-free-form"] }, { ...failure, hypotheses: ["source_drift", "source_drift"] },
    { ...failure, fix_applied: "safe-fix" }, { ...failure, fix_outcome: "resolved" },
    { ...failure, fix_applied: "run shell command", fix_outcome: "resolved" }, { ...failure, fix_applied: "wrapped_ghp_abcdefghijklmnop", fix_outcome: "resolved" },
  ]) assert.throws(() => classifyFailure(invalid as FailureObservation), fails("invalid-input"));
});
test("failure records must bind the observation run and an existing symbolic step", () => {
  const library = createLearningLibrary({ verifier: ownerFixture().verifier });
  for (const changed of [{ ...failure, run_id: "another-run" }, { ...failure, step_id: "unrecorded-step" }]) {
    assert.throws(() => library.observe({ ...sampleObservation(), failure_analysis: changed }), fails("invalid-input"));
  }
  const observed = library.observe({ ...sampleObservation(), failure_analysis: failure });
  assert.equal(observed.failure_analysis!.reason_code, "test_failed"); assert.equal(observed.status, "observed");
});
test("correction is an exact safe dry-run requiring independent verified evidence and confirmed ingest/readback", async () => {
  const owner = ownerFixture(); const transport = sinkFixture(); const library = createLearningLibrary({ verifier: owner.verifier, sink: transport.sink });
  const observed = library.observe({ ...sampleObservation(), failure_analysis: { ...failure, fix_applied: "validate-before-recording", fix_outcome: "resolved" } });
  const candidate = library.nominate(observed); const correction = { failure_id: "failure-1", prior_claim: "missing-validation", correction_code: "validation-required" };
  assert.throws(() => library.prepareCorrection(candidate, "fixture-bank", correction), fails("unverified-evidence"));
  const verified = library.verifyCandidate(candidate, await owner.verifier.verify(EXPECTED, SUBJECTS));
  const plan = library.prepareCorrection(verified, "fixture-bank", correction);
  assert.equal(plan.document.title, "Correction: experience-1"); assert.deepEqual([...plan.document.tags], ["knowledge:failure"]);
  assert.equal(JSON.parse(plan.document.content).correction.correction_code, "validation-required");
  assert.deepEqual(transport.counts(), { ingests: 0, readbacks: 0 });
  await assert.rejects(library.commitPromotion(plan, { preview_digest: "f".repeat(64) }), fails("invalid-confirmation"));
  assert.equal((await library.commitPromotion(plan, { preview_digest: plan.preview_digest })).status, "trusted");
  assert.deepEqual(transport.counts(), { ingests: 1, readbacks: 1 });
});
test("correction for absent/unresolved failure or mismatched IDs cannot produce a preview", async () => {
  const f = await learningFixture(); const correction = { failure_id: "failure-1", prior_claim: "old-claim", correction_code: "bounded-fix" };
  assert.throws(() => f.library.prepareCorrection(f.verified, "fixture-bank", correction), fails("invalid-transition"));
  for (const outcome of ["partial", "failed"] as const) {
    const owner = ownerFixture(); const library = createLearningLibrary({ verifier: owner.verifier });
    const candidate = library.nominate(library.observe({ ...sampleObservation(), failure_analysis: { ...failure, fix_applied: "bounded-fix", fix_outcome: outcome } }));
    const verified = library.verifyCandidate(candidate, await owner.verifier.verify(EXPECTED, SUBJECTS));
    assert.throws(() => library.prepareCorrection(verified, "fixture-bank", correction), fails("invalid-transition"));
  }
});
test("correction fields are closed safe labels and snapshots, not raw artifact or model prose", async () => {
  const owner = ownerFixture(); const library = createLearningLibrary({ verifier: owner.verifier });
  const candidate = library.nominate(library.observe({ ...sampleObservation(), failure_analysis: { ...failure, fix_applied: "bounded-fix", fix_outcome: "resolved" } }));
  const verified = library.verifyCandidate(candidate, await owner.verifier.verify(EXPECTED, SUBJECTS));
  const input = { failure_id: "failure-1", prior_claim: "old-claim", correction_code: "bounded-fix" };
  for (const invalid of [{ ...input, prior_claim: "/private/artifact" }, { ...input, correction_code: "arbitrary fix prose" }, { ...input, artifact_content: "raw" }]) {
    assert.throws(() => library.prepareCorrection(verified, "fixture-bank", invalid), fails("invalid-input"));
  }
  assert.throws(() => library.prepareCorrection(verified, "fixture-bank", { ...input, failure_id: "different-failure" }), fails("invalid-transition"));
  const plan = library.prepareCorrection(verified, "fixture-bank", input); input.correction_code = "mutated-label";
  assert.equal(JSON.parse(plan.document.content).correction.correction_code, "bounded-fix");
});
test("same-run recorded replay and comparison are offline nonexecuting symbolic timelines", () => {
  const owner = ownerFixture(); const library = createLearningLibrary({ verifier: owner.verifier });
  const left = library.observe(sampleObservation("recorded-left"));
  const rightInput = sampleObservation("recorded-right"); (rightInput.steps[1] as any).expected_result = "different-result";
  const right = library.observe(rightInput); const replay = library.planReplay(left, EXPECTED);
  assert.equal(replay.authorization, "none"); assert.equal(replay.executable, false); assert.equal(replay.mode, "recorded-only");
  assert.deepEqual(replay.timeline.map(step => step.step_id), ["step-1", "step-2"]); assert.equal(owner.calls.gate, 0);
  const comparison = library.compareRecorded(left, right, EXPECTED); assert.equal(comparison.authorization, "none"); assert.equal(comparison.executable, false);
  assert.ok(comparison.script_equal); assert.equal(comparison.steps_equal, false); assert.ok(comparison.failure_reason_equal);
  assert.ok(library.compareRecorded(left, left, EXPECTED).steps_equal);
  assert.deepEqual(Object.keys(comparison).sort(), ["authorization", "executable", "failure_reason_equal", "left_step_ids", "mode", "right_step_ids", "run_id", "script_equal", "steps_equal"]);
});
for (const field of ["run_id", "repo", "source_sha", "policy_version", "env_fingerprint"] as const) {
  test(`recorded replay/comparison require same-run ${field} binding`, () => {
    const library = createLearningLibrary({ verifier: ownerFixture().verifier }); const left = library.observe(sampleObservation("left"));
    const altered = { ...EXPECTED, [field]: field === "source_sha" ? "d".repeat(40) : "other-binding" };
    const right = library.observe(sampleObservation("right", altered));
    assert.throws(() => library.planReplay(left, altered), fails("unverified-evidence"));
    assert.throws(() => library.compareRecorded(left, right, EXPECTED), fails("unverified-evidence"));
  });
}
test("replay never resolves arbitrary repair IDs, raw logged actions, copied or terminal handles", () => {
  const library = createLearningLibrary({ verifier: ownerFixture().verifier });
  for (const steps of [[{ ...sampleObservation().steps[0], repair_action_id: "opaque-repair" }], [{ ...sampleObservation().steps[0], action_description: "git reset --hard" }]]) {
    assert.throws(() => library.observe({ ...sampleObservation(), steps } as ExperienceObservation), fails("invalid-input"));
  }
  const observed = library.observe(sampleObservation()); assert.throws(() => library.planReplay({ ...observed }, EXPECTED), fails("invalid-handle"));
  const rejected = library.reject(observed); assert.throws(() => library.planReplay(rejected, EXPECTED), fails("invalid-transition"));
});
