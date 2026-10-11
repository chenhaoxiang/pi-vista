import test from "node:test";
import assert from "node:assert/strict";
import { pairedFixture, expectedFixtureContract, caseTruth } from "./paired-evaluation-data.mjs";
import { classifyDecisionOutcome, createReferenceMockProvider, decisionToolContract, referenceDecision, STRICT_DECISION_SCHEMA } from "./stage6-decision-tool.mjs";
const cases = ["healthy-metadata", "stale-artifact", "environment-drift", "missing-metadata"];
const source = "a".repeat(40), env = "b".repeat(64), expected = expectedFixtureContract(source, env);
const metadata = id => pairedFixture(id, source, env);
const grade = (id, call, status = "completed") => classifyDecisionOutcome({ case_id: id, status, call, metadata: metadata(id), expected });

test("strict decision tool is closed and uses structured arguments, not free text", () => {
  assert.equal(STRICT_DECISION_SCHEMA.additionalProperties, false);
  for (const id of cases) assert.equal(decisionToolContract(id).parameters, STRICT_DECISION_SCHEMA);
  assert.throws(() => decisionToolContract("unknown"));
  assert.equal(grade(cases[0], JSON.stringify(referenceDecision(cases[0], metadata(cases[0]), expected))).outcome, "schema-invalid");
});
test("reference mock solver passes all fixed cases without model transport", () => {
  const provider = createReferenceMockProvider();
  for (const id of cases) {
    const call = provider.decide(id, metadata(id), expected);
    assert.deepEqual({ decision: call.arguments.decision, reason_code: call.arguments.reason_code }, caseTruth(id));
    assert.equal(grade(id, call).outcome, "decision-valid");
  }
  assert.equal(provider.calls, 4);
  assert.throws(() => referenceDecision(cases[0], metadata(cases[0]), { ...expected, required_fields: ["unknown"] }), /decision-schema-invalid/);
  assert.throws(() => referenceDecision(cases[0], metadata(cases[0]), { ...expected, required_fields: "title" }), /decision-schema-invalid/);
  assert.equal(referenceDecision(cases[0], { ...metadata(cases[0]), format_version: 2 }, expected).reason_code, "metadata-missing");
});
test("decision outcome distinguishes non-call, schema, refusal, provider and semantic failures", () => {
  const id = cases[0];
  assert.equal(grade(id, null).outcome, "tool-not-called"); assert.equal(grade(id, {}, "refusal").outcome, "refusal");
  assert.equal(grade(id, {}, "provider-error").outcome, "provider-error"); assert.equal(grade(id, {}).outcome, "schema-invalid");
  for (const status of ["cancelled", "timeout", "deadline", "stream-disconnected"]) assert.equal(grade(id, null, status).outcome, status);
  const bad = { name: "stage6_decision", arguments: { case_id: id, decision: "reject", reason_code: "source-mismatch" } };
  assert.equal(grade(id, bad).outcome, "semantic-mismatch");
});
test("extra fields, wrong case and wrong reason cannot become valid or authorizing", () => {
  const id = cases[0], valid = referenceDecision(id, metadata(id), expected);
  for (const args of [{ ...valid, raw: "private" }, { ...valid, case_id: cases[1] }, { ...valid, reason_code: "source-mismatch" }]) {
    const result = grade(id, { name: "stage6_decision", arguments: args }); assert.notEqual(result.outcome, "decision-valid"); assert.equal(result.authorization, "none");
  }
});
