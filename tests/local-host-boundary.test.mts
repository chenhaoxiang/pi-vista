import test from "node:test";
import assert from "node:assert/strict";
import * as signedEvidence from "@pi-vista/evidence";
import { createLocalEvidenceVerifier, isLocalEvidenceVerifier, type LocalEvidenceConfig } from "@pi-vista/evidence/host";
import { createLearningLibrary, LearningError } from "@pi-vista/learning";

function local() {
  const binding = { run_id: "local-fixture", repo: "fixture-repo", source_sha: "a".repeat(40), policy_version: "local-v1", env_fingerprint: "fixture-env" };
  const details = {
    gate: { verdict: "pass", gate_version: "b".repeat(40), config_digest: "c".repeat(64), checks: [{ name: "fixture-check", outcome: "pass" }] },
    test: { suites: [{ name: "fixture-cases", total: 1, passed: 1, failed: 0, skipped: 0, cancelled: 0, todo: 0 }] },
    guard: { coverage: "complete", event_count: 2, blocked: 0, dropped: 0 },
  };
  const config: LocalEvidenceConfig = { mode: "local-host", scope: "fixture-only", now: () => 10_000,
    gate_checks: ["fixture-check"], gate_version: "b".repeat(40), gate_config_digest: "c".repeat(64), test_suites: ["fixture-cases"],
    sources: (["gate", "test", "guard"] as const).map(kind => ({ subject: kind, kind, producer: "fixture-host", collect: async () => ({
      schema: 1, scope: "fixture-only", kind, producer: "fixture-host", ...binding,
      observed_at: 9_000, expires_at: 15_000, result_ref: `fixture-${kind}`, details: details[kind],
    }) })) };
  return { binding, verifier: createLocalEvidenceVerifier(config) };
}

test("public local addon identity is never added to the signed root or original Learning", async () => {
  const f = local(); assert.ok(isLocalEvidenceVerifier(f.verifier));
  assert.equal(signedEvidence.isEvidenceVerifier(f.verifier), false);
  assert.equal(Object.hasOwn(signedEvidence, "createLocalEvidenceVerifier"), false);
  assert.throws(() => createLearningLibrary({ verifier: f.verifier as any }), e => e instanceof LearningError);
  const proof = await f.verifier.verify(f.binding, { gate: "gate", test: "test", guard: "guard" });
  assert.equal(proof.authorization, "none"); assert.equal(proof.executable, false);
  assert.equal(proof.verification, "local-host-process");
  f.verifier.shutdown(); assert.equal(f.verifier.isCurrent(proof, f.binding), false);
});
test("a new controller after serialized history cannot recover local current proof", async () => {
  const f = local(); const proof = await f.verifier.verify(f.binding, { gate: "gate", test: "test", guard: "guard" });
  const saved = JSON.parse(JSON.stringify(proof)); f.verifier.shutdown();
  const afterRestart = local(); assert.equal(afterRestart.verifier.isCurrent(saved, afterRestart.binding), false);
  const fresh = await afterRestart.verifier.verify(afterRestart.binding, { gate: "gate", test: "test", guard: "guard" });
  assert.ok(afterRestart.verifier.isCurrent(fresh, afterRestart.binding));
  assert.equal(afterRestart.verifier.isCurrent(saved, afterRestart.binding), false);
  afterRestart.verifier.shutdown();
});
