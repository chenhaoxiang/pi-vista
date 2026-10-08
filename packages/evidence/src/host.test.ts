import test from "node:test";
import assert from "node:assert/strict";
import { createLocalEvidenceVerifier, isLocalEvidenceVerifier, type LocalEvidenceConfig,
  type LocalObservation, type LocalEvidenceVerifier } from "./host.js";
import { EvidenceError, isEvidenceVerifier, createEvidenceCheckRegistry, type EvidenceBinding } from "./index.js";

const expected: EvidenceBinding = { run_id: "host-run-1", repo: "fixture-repo", source_sha: "a".repeat(40),
  policy_version: "host-v1", env_fingerprint: "fixture-env" };
const selected = { gate: "gate-1", test: "tests-1", guard: "guard-1" };
function fixture() {
  let now = 10_000; let calls = 0;
  const observations: Record<string, any> = Object.fromEntries(["gate", "test", "guard"].map(kind => [kind, {
    schema: 1, scope: "fixed-host-plan-v1", kind, producer: `host-${kind}`, ...expected,
    result_ref: `result-${kind}`, observed_at: 9_000, expires_at: 15_000,
    details: kind === "gate" ? { verdict: "pass", gate_version: "b".repeat(40), config_digest: "c".repeat(64),
      checks: [{ name: "build-ok", outcome: "pass" }, { name: "types-ok", outcome: "pass" }] } :
      kind === "test" ? { suites: [{ name: "native-cases", total: 2, passed: 2, failed: 0, skipped: 0, cancelled: 0, todo: 0 }] } :
      { coverage: "complete", event_count: 2, blocked: 0, dropped: 0 },
  }]));
  const config: LocalEvidenceConfig = { mode: "local-host", scope: "fixed-host-plan-v1", gate_checks: ["build-ok", "types-ok"],
    gate_version: "b".repeat(40), gate_config_digest: "c".repeat(64), test_suites: ["native-cases"], now: () => now,
    sources: ["gate", "test", "guard"].map((kind, i) => ({ subject: Object.values(selected)[i]!, producer: `host-${kind}`,
      kind: kind as LocalObservation["kind"], collect: async () => { calls++; return observations[kind]; } })),
    max_age_ms: 10_000, timeout_ms: 1_000 };
  const verifier = createLocalEvidenceVerifier(config);
  return { config, verifier, observations, setNow: (n: number) => { now = n; }, calls: () => calls };
}
const rejects = (call: () => Promise<unknown>) => assert.rejects(call, e => e instanceof EvidenceError && e.code === "unverified-evidence");

test("explicit local host produces frozen non-executing process proof, no signed receipt", async () => {
  const f = fixture(); const proof = await f.verifier.verify(expected, selected);
  assert.equal(proof.verification, "local-host-process"); assert.equal(proof.trust_basis, "explicit-trusted-host");
  assert.equal(proof.scope, "fixed-host-plan-v1"); assert.equal(proof.portable, false);
  assert.equal(proof.authorization, "none"); assert.equal(proof.executable, false); assert.equal(f.calls(), 3);
  assert.ok(f.verifier.isCurrent(proof, expected)); assert.ok(isLocalEvidenceVerifier(f.verifier));
  assert.equal(isEvidenceVerifier(f.verifier), false); assert.equal(isLocalEvidenceVerifier({ ...f.verifier }), false);
  assert.ok(Object.isFrozen(proof) && Object.isFrozen(proof.observations) && proof.observations.every(Object.isFrozen));
  assert.deepEqual(proof.observations.map(s => s.kind), ["gate", "test", "guard"]);
  assert.equal(Object.hasOwn(proof, "receipts"), false); assert.equal(JSON.stringify(proof).includes("signature"), false);
  assert.throws(() => createEvidenceCheckRegistry(f.verifier as any), EvidenceError);
});
test("copy, JSON, forged status, other verifier and primitive cannot restore local provenance", async () => {
  const f = fixture(); const proof = await f.verifier.verify(expected, selected); const other = fixture();
  for (const candidate of [{ ...proof }, JSON.parse(JSON.stringify(proof)), { verified: true, passed: true }, null, true, "verified"])
    assert.equal(f.verifier.isCurrent(candidate, expected), false);
  assert.equal(other.verifier.isCurrent(proof, expected), false); await rejects(() => other.verifier.revalidate(proof));
});
for (const key of ["run_id", "repo", "source_sha", "policy_version", "env_fingerprint"] as const) {
  test(`local ${key} mismatch refuses without relabeling`, async () => {
    const f = fixture(); f.observations.guard[key] = key === "source_sha" ? "d".repeat(40) : "different-binding";
    await rejects(() => f.verifier.verify(expected, selected));
  });
}
for (const [name, change] of [
  ["scope", (p: any) => { p.scope = "other-host-plan"; }],
  ["producer", (p: any) => { p.producer = "other-producer"; }],
  ["kind", (p: any) => { p.kind = "test"; }],
  ["schema", (p: any) => { p.schema = 2; }],
  ["missing binding", (p: any) => { delete p.run_id; }],
  ["unknown identity", (p: any) => { p.owner_authorized = true; }],
] as const) {
  test(`local source ${name} cannot create truth`, async () => { const f = fixture(); change(f.observations.gate); await rejects(() => f.verifier.verify(expected, selected)); });
}
for (const verdict of ["fail", "owner-override"]) {
  test(`local gate ${verdict} cannot become normal gate pass`, async () => { const f = fixture(); f.observations.gate.details.verdict = verdict; await rejects(() => f.verifier.verify(expected, selected)); });
}
for (const outcome of ["fail", "skipped", "pending"]) {
  test(`local gate check ${outcome} refuses`, async () => { const f = fixture(); f.observations.gate.details.checks[0].outcome = outcome; await rejects(() => f.verifier.verify(expected, selected)); });
}
for (const pin of ["gate_version", "config_digest"] as const) {
  test(`local ${pin} must equal explicit host pin`, async () => {
    const f = fixture(); f.observations.gate.details[pin] = "d".repeat(pin === "gate_version" ? 40 : 64);
    await rejects(() => f.verifier.verify(expected, selected));
  });
}
for (const field of ["failed", "skipped", "cancelled", "todo"] as const) {
  test(`local tests with ${field} cannot pass`, async () => {
    const f = fixture(); f.observations.test.details.suites[0][field] = 1; f.observations.test.details.suites[0].passed = 1;
    await rejects(() => f.verifier.verify(expected, selected));
  });
}
test("empty, inconsistent, duplicated or missing required suites/checks refuse", async () => {
  for (const edit of [
    (f: ReturnType<typeof fixture>) => { f.observations.test.details.suites = []; },
    (f: ReturnType<typeof fixture>) => { f.observations.test.details.suites[0].total = 0; },
    (f: ReturnType<typeof fixture>) => { f.observations.test.details.suites[0].total = 9; },
    (f: ReturnType<typeof fixture>) => { f.observations.test.details.suites.push(f.observations.test.details.suites[0]); },
    (f: ReturnType<typeof fixture>) => { f.observations.test.details.suites[0].name = "not-required"; },
    (f: ReturnType<typeof fixture>) => { f.observations.gate.details.checks.pop(); },
    (f: ReturnType<typeof fixture>) => { f.observations.gate.details.checks.push(f.observations.gate.details.checks[0]); },
  ]) { const f = fixture(); edit(f); await rejects(() => f.verifier.verify(expected, selected)); }
});
for (const [name, edit] of [
  ["partial", (p: any) => { p.details.coverage = "partial"; }],
  ["blocked", (p: any) => { p.details.blocked = 1; }],
  ["dropped", (p: any) => { p.details.dropped = 1; }],
  ["zero events", (p: any) => { p.details.event_count = 0; }],
  ["missing dropped", (p: any) => { delete p.details.dropped; }],
] as const) {
  test(`local guard ${name} refuses rather than fabricating completeness`, async () => {
    const f = fixture(); edit(f.observations.guard); await rejects(() => f.verifier.verify(expected, selected));
  });
}
for (const bad of ["/private/fixture", "https://example.invalid", "task;rm", "wrapped_ghp_abcdefghijklmnop"]) {
  test(`unsafe local label ${bad.split(/[:/;]/u)[0]} refuses`, async () => {
    const f = fixture(); f.observations.gate.result_ref = bad; await rejects(() => f.verifier.verify(expected, selected));
  });
}
test("null-prototype own data works but hostile accessors/proxies never run", async () => {
  const f = fixture(); f.observations.gate = Object.assign(Object.create(null), f.observations.gate);
  assert.ok(await f.verifier.verify(expected, selected)); let calls = 0;
  const proxy = new Proxy({}, { ownKeys() { calls++; throw Error(); }, get() { calls++; throw Error(); } });
  await rejects(() => f.verifier.verify(proxy as EvidenceBinding, selected)); assert.equal(calls, 0);
  assert.throws(() => createLocalEvidenceVerifier(proxy as LocalEvidenceConfig), EvidenceError); assert.equal(calls, 0);
  Object.defineProperty(f.observations.guard, "details", { get() { calls++; throw Error(); } });
  await rejects(() => f.verifier.verify(expected, selected)); assert.equal(calls, 0);
});
test("unknown aliases, kind-swapped selectors and unknown selector fields cause zero collection", async () => {
  for (const selector of [{ ...selected, gate: "unknown" }, { ...selected, gate: selected.test }, { ...selected, extra: true }]) {
    const f = fixture(); await rejects(() => f.verifier.verify(expected, selector)); assert.equal(f.calls(), 0);
  }
});
test("mode/key/flag drift, unsupported configuration, duplicate subjects and missing kind refuse", () => {
  const f = fixture();
  for (const c of [{ ...f.config, mode: "signed" }, { ...f.config, approved: true }, { ...f.config, public_key: "any" },
    { ...f.config, scope: "/private/fixture" }, { ...f.config, max_age_ms: Infinity }, { ...f.config, timeout_ms: 0 },
    { ...f.config, sources: [...f.config.sources, f.config.sources[0]!] }, { ...f.config, sources: f.config.sources.slice(0, 2) },
    { ...f.config, gate_checks: [] }, { ...f.config, test_suites: ["one", "one"] }])
    assert.throws(() => createLocalEvidenceVerifier(c as any), e => e instanceof EvidenceError && e.code === "invalid-config");
});
test("input/configuration mutation cannot redirect captured requirements or proof contents", async () => {
  const f = fixture(); const proof = await f.verifier.verify(expected, selected);
  (f.config.sources[0] as any).collect = async () => ({ passed: true }); (f.config.gate_checks as string[]).push("new-check");
  f.observations.gate.result_ref = "new-reference"; assert.equal(proof.observations[0]!.result_ref, "result-gate");
  assert.ok(await f.verifier.verify(expected, selected));
});
test("revalidation re-collects all3, rotates exact handle and consumes prior challenge", async () => {
  const f = fixture(); const proof = await f.verifier.verify(expected, selected); const fresh = await f.verifier.revalidate(proof);
  assert.equal(f.calls(), 6); assert.notEqual(fresh, proof); assert.ok(f.verifier.isCurrent(fresh, expected));
  assert.equal(f.verifier.isCurrent(proof, expected), false); await rejects(() => f.verifier.revalidate(proof));
});
test("changed or failed revalidation revokes old proof and does not export a fresh one", async () => {
  for (const change of [(f: ReturnType<typeof fixture>) => { f.observations.guard.result_ref = "different-reference"; },
    (f: ReturnType<typeof fixture>) => { f.observations.test.details.suites[0].name = "missing-suite"; }]) {
    const f = fixture(); const proof = await f.verifier.verify(expected, selected); change(f);
    await rejects(() => f.verifier.revalidate(proof)); assert.equal(f.verifier.isCurrent(proof, expected), false);
  }
});
test("expiry/high-water rollback cannot resurrect an old or fresh local proof", async () => {
  const f = fixture(); const proof = await f.verifier.verify(expected, selected); f.setNow(15_000);
  assert.equal(f.verifier.isCurrent(proof, expected), false); f.setNow(10_000);
  assert.equal(f.verifier.isCurrent(proof, expected), false); await rejects(() => f.verifier.verify(expected, selected));
  f.setNow(20_000); await rejects(() => f.verifier.verify(expected, selected));
});
test("a clock rollback before expiry permanently fails this factory's time context", async () => {
  const f = fixture(); const proof = await f.verifier.verify(expected, selected); f.setNow(9_999);
  assert.equal(f.verifier.isCurrent(proof, expected), false); f.setNow(10_001);
  await rejects(() => f.verifier.verify(expected, selected));
});
test("future observations, excessive validity and invalid clocks refuse", async () => {
  const f = fixture(); f.observations.gate.observed_at = 10_001; await rejects(() => f.verifier.verify(expected, selected));
  const g = fixture(); g.observations.gate.expires_at = 50_000; await rejects(() => g.verifier.verify(expected, selected));
  for (const now of [() => Infinity, () => -1, () => { throw Error("private-error"); }])
    assert.throws(() => createLocalEvidenceVerifier({ ...g.config, now }), e => e instanceof EvidenceError && e.message === "invalid-config");
});
test("monotonic elapsed TTL expires even when the trusted wall clock is held constant", async () => {
  const f = fixture(); for (const p of Object.values(f.observations)) { p.observed_at = 10_000; p.expires_at = 10_030; }
  const proof = await f.verifier.verify(expected, selected); await new Promise(resolve => setTimeout(resolve, 40));
  assert.equal(f.verifier.isCurrent(proof, expected), false); await rejects(() => f.verifier.revalidate(proof));
});
test("late rejection/thenable/throw are consumed without private error projection", async () => {
  const f = fixture(); let thenCalls = 0;
  for (const collect of [async () => { throw Error("private-body"); }, () => { throw Error("private-body"); },
    () => ({ then() { thenCalls++; throw Error("private-body"); } }), () => new Promise((_, reject) => setTimeout(() => reject(Error("private-body")), 30))]) {
    const v = createLocalEvidenceVerifier({ ...f.config, timeout_ms: 5, sources: f.config.sources.map((s, i) => i === 0 ? { ...s, collect: collect as any } : s) });
    await rejects(() => v.verify(expected, selected)); v.shutdown();
  }
  await new Promise(resolve => setTimeout(resolve, 40)); assert.equal(thenCalls, 0);
});
test("one overall collection deadline cannot become three fresh reader budgets", async () => {
  const f = fixture(); const v = createLocalEvidenceVerifier({ ...f.config, timeout_ms: 25,
    sources: f.config.sources.map(s => ({ ...s, collect: async signal => { await new Promise(resolve => setTimeout(resolve, 15)); assert.ok(typeof signal.aborted === "boolean"); return f.observations[s.kind]; } })) });
  await rejects(() => v.verify(expected, selected)); assert.equal(v.isCurrent({ verified: true }, expected), false);
});
test("shutdown aborts in-flight collection and never permits late revival", async () => {
  const f = fixture(); let release!: (x: unknown) => void; let signal: AbortSignal | undefined;
  const v: LocalEvidenceVerifier = createLocalEvidenceVerifier({ ...f.config, sources: f.config.sources.map((s, i) => i === 0 ? {
    ...s, collect: async seen => { signal = seen; return new Promise(resolve => { release = resolve; }); },
  } : s) });
  const pending = v.verify(expected, selected); v.shutdown(); assert.ok(signal?.aborted);
  release(f.observations.gate); await rejects(() => pending); await rejects(() => v.verify(expected, selected)); v.shutdown();
  const proof = await f.verifier.verify(expected, selected); f.verifier.shutdown();
  assert.equal(f.verifier.isCurrent(proof, expected), false); await rejects(() => f.verifier.revalidate(proof));
});
