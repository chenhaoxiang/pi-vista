import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import {
  createEvidenceVerifier, createEvidenceCheckRegistry, evidenceMessage, EvidenceError,
  type EvidenceBinding, type EvidenceConfig, type EvidenceKind,
} from "@pi-vista/evidence";

const expected: EvidenceBinding = { run_id: "run-1", repo: "fixture-repo", source_sha: "a".repeat(40), policy_version: "policy-1", env_fingerprint: "env-1" };
const selected = { gate: "gate-1", test: "tests-1", guard: "guard-1" };
function fixture() {
  let now = 10_000;
  const keys = generateKeyPairSync("ed25519");
  const publicKey = keys.publicKey.export({ type: "spki", format: "pem" }).toString();
  const payloads: Record<EvidenceKind, any> = {
    gate: { schema: 1, kind: "gate", issuer: "owner-1", ...expected, receipt_ref: "gate-ref", issued_at: 9_000, expires_at: 15_000,
      details: { verdict: "pass", gate_version: "b".repeat(40), config_digest: "c".repeat(64), checks: [{ name: "ci-1", outcome: "pass" }, { name: "review-1", outcome: "pass" }] } },
    test: { schema: 1, kind: "test", issuer: "owner-1", ...expected, receipt_ref: "test-ref", issued_at: 9_000, expires_at: 15_000,
      details: { suites: [{ name: "suite-1", total: 2, passed: 2, failed: 0, skipped: 0, cancelled: 0 }] } },
    guard: { schema: 1, kind: "guard", issuer: "owner-1", ...expected, receipt_ref: "guard-ref", issued_at: 9_000, expires_at: 15_000,
      details: { coverage: "complete", event_count: 5, blocked: 0 } },
  };
  const receipts: Record<EvidenceKind, any> = { gate: null, test: null, guard: null };
  function seal(k: EvidenceKind) {
    const message = evidenceMessage(payloads[k]);
    receipts[k] = { payload: payloads[k], content_digest: createHash("sha256").update(message).digest("hex"), signature: sign(null, Buffer.from(message), keys.privateKey).toString("base64") };
  }
  for (const k of ["gate", "test", "guard"] as const) seal(k);
  let calls = 0;
  const config: EvidenceConfig = {
    sources: (["gate", "test", "guard"] as const).map(k => ({ subject: selected[k], issuer: "owner-1", kind: k, public_key: publicKey,
      read: async () => { calls++; return receipts[k]; } })),
    gate_checks: ["ci-1", "review-1"], gate_version: "b".repeat(40), gate_config_digest: "c".repeat(64), test_suites: ["suite-1"], now: () => now, max_age_ms: 10_000,
  };
  return { verifier: createEvidenceVerifier(config), config, payloads, receipts, seal, keys,
    setNow: (value: number) => { now = value; }, calls: () => calls };
}
const rejects = (run: () => unknown) => assert.rejects(async () => run(), error => error instanceof EvidenceError && error.code === "unverified-evidence" && error.stack === "EvidenceError: unverified-evidence");

test("signed complete owner evidence produces a frozen non-authorizing provenance handle", async () => {
  const f = fixture(); const proof = await f.verifier.verify(expected, selected);
  assert.equal(proof.authorization, "none"); assert.equal(proof.verification, "authority-bound");
  assert.equal(proof.receipts.length, 3); assert.equal(f.calls(), 3);
  assert.ok(Object.isFrozen(proof)); assert.ok(Object.isFrozen(proof.receipts));
  assert.ok(f.verifier.isCurrent(proof, expected));
  assert.equal(f.verifier.isCurrent({ ...proof }, expected), false);
  assert.equal(fixture().verifier.isCurrent(proof, expected), false);
  assert.equal(f.verifier.isCurrent(proof, { ...expected, run_id: "run-2" }), false);
  assert.ok(f.verifier.isCurrent(await f.verifier.revalidate(proof), expected));
  assert.equal(f.calls(), 6);
});
for (const field of ["run_id", "repo", "source_sha", "policy_version", "env_fingerprint"] as const) {
  test(`signed ${field} mismatch is rejected`, async () => {
    const f = fixture(); f.payloads.gate[field] = field === "source_sha" ? "d".repeat(40) : "other-1"; f.seal("gate");
    await rejects(() => f.verifier.verify(expected, selected));
  });
}
for (const [name, mutate] of [
  ["signature", (f: ReturnType<typeof fixture>) => { f.receipts.gate.signature = "A".repeat(86) + "=="; }],
  ["digest", (f: ReturnType<typeof fixture>) => { f.receipts.gate.content_digest = "d".repeat(64); }],
  ["unsigned flags", (f: ReturnType<typeof fixture>) => { f.receipts.gate = { passed: true, verified: true }; }],
  ["unsealed mutation", (f: ReturnType<typeof fixture>) => { f.payloads.gate.details.checks[0].outcome = "fail"; }],
  ["extra field", (f: ReturnType<typeof fixture>) => { f.receipts.gate.path = "/private/fixture"; }],
  ["wrong signer", (f: ReturnType<typeof fixture>) => { f.receipts.gate.signature = sign(null, Buffer.from(evidenceMessage(f.payloads.gate)), generateKeyPairSync("ed25519").privateKey).toString("base64"); }],
] as const) {
  test(`${name} cannot manufacture a verified result`, async () => { const f = fixture(); mutate(f); await rejects(() => f.verifier.verify(expected, selected)); });
}
for (const verdict of ["fail", "owner-override"]) {
  test(`signed ${verdict} is not reusable gate PASS`, async () => { const f = fixture(); f.payloads.gate.details.verdict = verdict; f.seal("gate"); await rejects(() => f.verifier.verify(expected, selected)); });
}
for (const outcome of ["fail", "skipped", "pending"]) {
  test(`signed gate ${outcome} is rejected`, async () => { const f = fixture(); f.payloads.gate.details.checks[0].outcome = outcome; f.seal("gate"); await rejects(() => f.verifier.verify(expected, selected)); });
}
for (const field of ["gate_version", "config_digest"] as const) {
  test(`signed obsolete gate ${field} is rejected against host pins`, async () => {
    const f = fixture(); f.payloads.gate.details[field] = "d".repeat(field === "gate_version" ? 40 : 64); f.seal("gate");
    await rejects(() => f.verifier.verify(expected, selected));
  });
}
test("required gate checks and test suites cannot be omitted", async () => {
  const f = fixture(); f.payloads.gate.details.checks.pop(); f.seal("gate"); await rejects(() => f.verifier.verify(expected, selected));
  const g = fixture(); g.payloads.test.details.suites[0].name = "other-suite"; g.seal("test"); await rejects(() => g.verifier.verify(expected, selected));
});
for (const field of ["failed", "skipped", "cancelled"] as const) {
  test(`signed test ${field} is not a passed suite`, async () => {
    const f = fixture(); f.payloads.test.details.suites[0][field] = 1; f.payloads.test.details.suites[0].passed = 1; f.seal("test");
    await rejects(() => f.verifier.verify(expected, selected));
  });
}
test("zero tests, inconsistent counts, duplicate checks/suites and unsupported versions reject independently", () => {
  for (const [k, change] of [
    ["test", (f: ReturnType<typeof fixture>) => { f.payloads.test.details.suites[0].total = 0; }],
    ["test", (f: ReturnType<typeof fixture>) => { f.payloads.test.details.suites[0].total = 10; }],
    ["gate", (f: ReturnType<typeof fixture>) => { f.payloads.gate.details.checks.push(f.payloads.gate.details.checks[0]); }],
    ["test", (f: ReturnType<typeof fixture>) => { f.payloads.test.details.suites.push(f.payloads.test.details.suites[0]); }],
    ["guard", (f: ReturnType<typeof fixture>) => { f.payloads.guard.schema = 2; }],
  ] as const) { const f = fixture(); change(f); assert.throws(() => evidenceMessage(f.payloads[k]), EvidenceError); }
});
for (const [name, mutate] of [
  ["partial guard", (p: any) => { p.details.coverage = "partial"; }],
  ["blocked guard", (p: any) => { p.details.blocked = 1; }],
] as const) {
  test(`${name} cannot mint clean coverage`, async () => { const f = fixture(); mutate(f.payloads.guard); f.seal("guard"); await rejects(() => f.verifier.verify(expected, selected)); });
}
for (const now of [8_000, 15_000, 30_000]) {
  test(`future/expired evidence at ${now} fails and invalidates existing handles`, async () => {
    const f = fixture(); const proof = await f.verifier.verify(expected, selected); f.setNow(now);
    assert.equal(f.verifier.isCurrent(proof, expected), false); await rejects(() => f.verifier.verify(expected, selected));
  });
}
test("overlong validity windows reject even when currently unexpired", async () => {
  const f = fixture(); f.payloads.gate.expires_at = 100_000; f.seal("gate"); await rejects(() => f.verifier.verify(expected, selected));
});
test("changed signed source evidence cannot reuse an old reviewed preview", async () => {
  const f = fixture(); const proof = await f.verifier.verify(expected, selected); f.payloads.gate.receipt_ref = "changed-ref"; f.seal("gate");
  await rejects(() => f.verifier.revalidate(proof));
});
test("kind and issuer must match their registered source", async () => {
  const f = fixture(); f.payloads.gate.issuer = "other-owner"; f.seal("gate"); await rejects(() => f.verifier.verify(expected, selected));
  f.receipts.gate = f.receipts.test; await rejects(() => f.verifier.verify(expected, selected));
});
test("malformed own-data boundaries never invoke getters or proxy traps", async () => {
  let called = 0; const evil = new Proxy({}, { get: () => { called++; throw Error(); }, ownKeys: () => { called++; throw Error(); } });
  const f = fixture();
  await rejects(() => f.verifier.verify(evil as EvidenceBinding, selected));
  assert.equal(f.calls(), 0); assert.equal(called, 0);
  const accessor = Object.defineProperty({}, "payload", { get: () => { called++; } }); f.receipts.gate = accessor;
  await rejects(() => f.verifier.verify(expected, selected)); assert.equal(called, 0);
  assert.throws(() => createEvidenceVerifier(evil as EvidenceConfig), EvidenceError); assert.equal(called, 0);
});
test("configured readers and requirements are detached from later source mutation", async () => {
  const f = fixture(); (f.config.sources[0] as any).read = async () => ({ passed: true }); (f.config.gate_checks as string[]).push("new-check");
  assert.ok(await f.verifier.verify(expected, selected));
});
test("unknown aliases, wrong kinds and hostile subject maps fail before readers", async () => {
  const f = fixture();
  await rejects(() => f.verifier.verify(expected, { ...selected, gate: "unknown-1" }));
  await rejects(() => f.verifier.verify(expected, { ...selected, gate: "tests-1" })); assert.equal(f.calls(), 0);
});
test("reader rejection, timeout, arbitrary thenable and late success fail closed", async () => {
  const f = fixture();
  for (const read of [async () => { throw Error("private-error"); }, () => new Promise(resolve => setTimeout(() => resolve(f.receipts.gate), 40)), () => ({ then: () => { throw Error(); } })]) {
    const cfg = { ...f.config, timeout_ms: 5, sources: f.config.sources.map((s, i) => i === 0 ? { ...s, read: read as any } : s) };
    await rejects(() => createEvidenceVerifier(cfg).verify(expected, selected));
  }
});
test("private keys, duplicate sources, unsafe labels and malformed options reject", () => {
  const f = fixture();
  for (const cfg of [
    { ...f.config, sources: [...f.config.sources, f.config.sources[0]!] },
    { ...f.config, timeout_ms: 0 }, { ...f.config, max_age_ms: Infinity },
    { ...f.config, test_suites: ["/private/fixture"] },
    { ...f.config, sources: f.config.sources.map(s => ({ ...s, public_key: f.keys.privateKey.export({ type: "pkcs8", format: "pem" }).toString() })) },
    { ...f.config, sources: f.config.sources.map(s => ({ ...s, public_key: s.public_key + f.keys.privateKey.export({ type: "pkcs8", format: "pem" }).toString() })) },
  ]) assert.throws(() => createEvidenceVerifier(cfg), e => e instanceof EvidenceError && e.code === "invalid-config");
});
test("credential/path/shell content is refused rather than included in messages or proofs", async () => {
  for (const bad of ["/private/fixture", "https://example.invalid", "task;rm", "wrapped_ghp_abcdefghijklmnop"]) {
    const f = fixture(); f.payloads.gate.receipt_ref = bad;
    await rejects(() => f.verifier.verify(expected, selected));
    assert.throws(() => evidenceMessage(f.payloads.gate), EvidenceError);
  }
});
test("public Check Function probes read signed evidence anew and remain predicate-only", async () => {
  const f = fixture(); const registry = createEvidenceCheckRegistry(f.verifier);
  const defs = (["receipt_present", "test_passed", "custom:evidence/guard-clean"] as const).map((type, i) => ({
    check_id: `check-${i}`, type, params: { subject: Object.values(selected)[i]!, ...expected }, on_fail: "STOP" as const,
  }));
  const pass = await registry.run(defs); assert.ok(pass.satisfied); assert.equal(pass.verification, "predicate-only"); assert.equal(pass.authorization, "none");
  f.payloads.test.details.suites[0].failed = 1; f.payloads.test.details.suites[0].passed = 1; f.seal("test");
  const stop = await registry.run(defs.map(d => ({ ...d, on_fail: "WARN" as const })));
  assert.equal(stop.satisfied, false); assert.equal(stop.results[1]!.reason, "handler-threw"); assert.equal(stop.results[2]!.status, "skipped");
  assert.equal(f.verifier.isCurrent(pass as any, expected), false);
});
test("probe schema errors and missing source aliases cause no reader calls", async () => {
  const f = fixture(); const registry = createEvidenceCheckRegistry(f.verifier);
  for (const params of [{ subject: "unknown-1", ...expected }, { subject: selected.gate, ...expected, extra: "x" }]) {
    const report = await registry.run([{ check_id: "check-1", type: "receipt_present", params, on_fail: "WARN" }]);
    assert.equal(report.satisfied, false);
  }
  assert.equal(f.calls(), 0);
  assert.throws(() => createEvidenceCheckRegistry({ ...f.verifier }), EvidenceError);
});
