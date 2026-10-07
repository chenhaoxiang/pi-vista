import { strict as assert } from "node:assert";
import { test } from "node:test";
import { toVistaEventInput, emitShadowObservation, type ShadowObservation } from "@pi-vista/adapter-shadow";
import { fixedError, HASH } from "./fixtures.mjs";

function minimal(extra: Record<string, unknown> = {}): ShadowObservation {
  return { schema: "shadow-observation/1", shadow: true, model_family: "kev", model_id: "kev-4b",
    model_version: "synthetic-v1", verdict: "pass", status: "observed", context_status: "complete",
    correlation: { run_id: "own-only-run" }, humanExpectationWritten: false, trainingEligible: false,
    promotionEligible: false, ...extra } as ShadowObservation;
}
function restore(key: string, prior: PropertyDescriptor | undefined): void {
  Reflect.deleteProperty(Object.prototype, key);
  if (prior !== undefined) Object.defineProperty(Object.prototype, key, prior);
}

test("inherited canonical step data is neither projected nor accepted as request corroboration", () => {
  const input = minimal();
  const prior = Object.getOwnPropertyDescriptor(Object.prototype, "step_id");
  try {
    Object.defineProperty(Object.prototype, "step_id", { configurable: true, writable: true, value: "own-only-run_ambient" });
    const output = toVistaEventInput(input);
    assert.equal(Object.hasOwn(output, "step_id"), false);
    assert.equal(output.result, "unknown");
    assert.throws(() => toVistaEventInput(minimal({ request: { run_id: "own-only-run", step_id: "own-only-run_ambient" } })), fixedError);
  } finally { restore("step_id", prior); }
});

for (const key of ["step_id", "source_sha", "policy_version", "fingerprint", "row_evidence", "asset_evidence", "vote_ref", "confidence", "reason_code", "stats"]) {
  test(`omitted optional ${key} never reads inherited getters after normalization/projection`, () => {
    const input = minimal(); const prior = Object.getOwnPropertyDescriptor(Object.prototype, key); let reads = 0;
    try {
      Object.defineProperty(Object.prototype, key, { configurable: true, get() { reads++; throw Error("synthetic inherited getter"); } });
      // Unchanged core redaction may reject a globally getter-only destination
      // property; that rejection must be fixed/value-free, never a getter read.
      try {
        const output = toVistaEventInput(input);
        assert.equal(output.result, "unknown");
        assert.equal(Object.hasOwn(output, key), false);
      } catch (error) { assert.equal(fixedError(error), true); }
      assert.equal(reads, 0);
    } finally { restore(key, prior); }
    assert.equal(reads, 0);
  });
}

test("inherited row and asset optionals remain absent on normalized nested records", () => {
  const input = minimal({ model_family: "laya", model_id: "laya-421m",
    row_evidence: { sample_id: "sample-1", row_sha256: HASH, ownerReviewCandidate: true, ownerAdjudicationRequired: true, forcedAbstain: false },
    asset_evidence: { scope: "synthetic", verified: false, realInputIsolationProven: false, asset_ref: "asset-1" } });
  for (const key of ["packet_sha256", "input_sha256", "contract_map_sha256", "asset_sha256", "receipt_ref", "license_mode"]) {
    const prior = Object.getOwnPropertyDescriptor(Object.prototype, key); let reads = 0;
    try {
      Object.defineProperty(Object.prototype, key, { configurable: true, get() { reads++; throw Error("synthetic nested getter"); } });
      assert.equal(toVistaEventInput(input).result, "unknown"); assert.equal(reads, 0);
    } finally { restore(key, prior); }
  }
});

test("core handoff does not replace an omitted source/step with inherited ambient data", async () => {
  const input = minimal();
  const originals = ["step_id", "source_sha", "seq", "stepId"].map(key => [key, Object.getOwnPropertyDescriptor(Object.prototype, key)] as const);
  let captured: unknown;
  try {
    for (const [key] of originals) Object.defineProperty(Object.prototype, key, { configurable: true, writable: true,
      value: key === "step_id" ? "own-only-run_ambient" : key === "source_sha" ? "d".repeat(40) : key === "seq" ? 999 : "own-only-run_ambient" });
    const emitted = await emitShadowObservation(input, { now: 7, store: { async append(event) { captured = event; } } });
    assert.ok(emitted); assert.equal(captured, emitted);
    assert.notEqual(emitted.step_id, "own-only-run_ambient");
    assert.equal(Object.hasOwn(emitted, "source_sha"), false);
    assert.equal(Object.hasOwn(JSON.parse(JSON.stringify(emitted)), "source_sha"), false);
  } finally { for (const [key, prior] of originals) restore(key, prior); }
});

test("emission option getters are not read when options omit them", async () => {
  const input = minimal();
  for (const key of ["seq", "stepId", "clock", "baseDir", "persistTimeoutMs"]) {
    const prior = Object.getOwnPropertyDescriptor(Object.prototype, key); let reads = 0;
    try {
      Object.defineProperty(Object.prototype, key, { configurable: true, get() { reads++; throw Error("synthetic option getter"); } });
      const result = await emitShadowObservation(input, { now: 8, store: { async append() {} } });
      assert.ok(result); assert.equal(reads, 0);
    } finally { restore(key, prior); }
  }
});
