import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { createLocalEvidenceVerifier } from "./host.js";
import { EvidenceError } from "./index.js";

/** Test-process-only monotonic clock seam; no real host/settings changes. */
function fixture(t: TestContext) {
  let mono = 0; let crossing = false;
  t.mock.method(performance, "now", () => mono);
  const expected = { run_id: "host-clock-run", repo: "fixture-repo", source_sha: "a".repeat(40), policy_version: "host-v1", env_fingerprint: "fixture-env" };
  const details = {
    gate: { verdict: "pass", gate_version: "b".repeat(40), config_digest: "c".repeat(64), checks: [{ name: "fixture-check", outcome: "pass" }] },
    test: { suites: [{ name: "fixture-suite", total: 1, passed: 1, failed: 0, skipped: 0, cancelled: 0, todo: 0 }] },
    guard: { coverage: "complete", event_count: 2, blocked: 0, dropped: 0 },
  };
  const verifier = createLocalEvidenceVerifier({ mode: "local-host", scope: "fixed-clock-scope", now: () => 10_000,
    gate_checks: ["fixture-check"], gate_version: "b".repeat(40), gate_config_digest: "c".repeat(64), test_suites: ["fixture-suite"],
    max_age_ms: 1_000, timeout_ms: 1_000,
    sources: (["gate", "test", "guard"] as const).map(kind => ({ subject: kind, kind, producer: "fixture-host", collect: async () => {
      if (crossing) mono = 250;
      return { schema: 1, scope: "fixed-clock-scope", kind, producer: "fixture-host", ...expected,
        result_ref: `fixture-${kind}`, observed_at: 10_000, expires_at: 10_200, details: details[kind] };
    } })),
  });
  return { verifier, expected, selected: { gate: "gate", test: "test", guard: "guard" },
    at: (value: number) => { mono = value; }, cross: () => { crossing = true; } };
}
const unverified = (error: unknown) => error instanceof EvidenceError && error.code === "unverified-evidence";

test("constant wall clock rotation cannot renew identical observation freshness", async t => {
  const f = fixture(t); const proof = await f.verifier.verify(f.expected, f.selected);
  f.at(150); const rotated = await f.verifier.revalidate(proof);
  assert.ok(f.verifier.isCurrent(rotated, f.expected)); assert.equal(f.verifier.isCurrent(proof, f.expected), false);
  f.at(220); assert.equal(f.verifier.isCurrent(rotated, f.expected), false);
  await assert.rejects(() => f.verifier.revalidate(rotated), unverified);
});
test("constant wall clock cannot reacquire expired unchanged observations through direct verify", async t => {
  const f = fixture(t); const proof = await f.verifier.verify(f.expected, f.selected);
  f.at(250); assert.equal(f.verifier.isCurrent(proof, f.expected), false);
  await assert.rejects(() => f.verifier.verify(f.expected, f.selected), unverified);
});
test("collection crossing the immutable observation expiry cannot finish revalidation", async t => {
  const f = fixture(t); const proof = await f.verifier.verify(f.expected, f.selected);
  f.at(150); f.cross(); await assert.rejects(() => f.verifier.revalidate(proof), unverified);
  assert.equal(f.verifier.isCurrent(proof, f.expected), false);
});
test("malformed isCurrent bindings never revoke an unchanged valid local proof or invoke traps", async t => {
  const f = fixture(t); const proof = await f.verifier.verify(f.expected, f.selected); let traps = 0;
  const proxy = new Proxy({}, { ownKeys() { traps++; throw Error(); }, get() { traps++; throw Error(); } });
  const accessor = Object.defineProperty({ ...f.expected }, "run_id", { get() { traps++; throw Error(); } });
  for (const query of [{}, null, proxy, accessor, { ...f.expected, unknown: true }, { ...f.expected, source_sha: "bad" }]) {
    assert.equal(f.verifier.isCurrent(proof, query as any), false);
    assert.ok(f.verifier.isCurrent(proof, f.expected));
  }
  assert.equal(traps, 0); const fresh = await f.verifier.revalidate(proof);
  assert.ok(f.verifier.isCurrent(fresh, f.expected));
});
