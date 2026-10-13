import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { createLocalEvidenceVerifier } from "@pi-vista/evidence/host";
import { prepareHistoricalGuidance } from "@pi-vista/learning/guidance";
import { prepareK1ActualHistory } from "./stage6-k1-history-host.mjs";
import { workflowObservation } from "./local-learning-workflow.mjs";
import { PAIR_SOURCE_SHA, PAIR_HISTORY_DIGEST } from "./paired-evaluation-data.mjs";

const hash = x => createHash("sha256").update(x).digest("hex");
const canonical = x => x !== null && typeof x === "object" ? Array.isArray(x) ? `[${x.map(canonical).join(",")}]` : `{${Object.keys(x).sort().map(k => `${JSON.stringify(k)}:${canonical(x[k])}`).join(",")}}` : JSON.stringify(x);
const environment = hash(JSON.stringify({ node: "v26.9.0", platform: "darwin", arch: "arm64", scope: "fixed-local-learning-command-plan-v1", plan: ["source-contract", "learning-native", "packed-consumer-contract"] }));
function fixture() {
  let now = 50_000, reads = 0, collects = 0;
  const old = workflowObservation(PAIR_SOURCE_SHA, "workflow-01a11fcc-actual", environment);
  const document = prepareHistoricalGuidance(old);
  assert.equal(document.content_digest, PAIR_HISTORY_DIGEST);
  const bank = "stage5-isolated-test", key = `guidance-${hash(canonical({ bank, document }))}`;
  const reference = { bank, document_id: `vista-guidance-v1-${"b".repeat(16)}-${hash(key)}`, current_verification: "not-checked", authorization: "none", executable: false, content_digest: document.content_digest, idempotency_key: key };
  const history = { ...reference, document, guidance: JSON.parse(document.content) };
  const binding = { run_id: "current-k1-history", repo: old.repo, source_sha: old.source_sha, policy_version: old.policy_version, env_fingerprint: old.env_fingerprint };
  const scope = "k1-fixture-history", config = hash("k1-test-config");
  const observations = Object.fromEntries(["gate", "test", "guard"].map(kind => [kind, {
    schema: 1, scope, kind, producer: `k1-${kind}`, ...binding, result_ref: `k1-${kind}-result`, observed_at: now, expires_at: now + 5000,
    details: kind === "gate" ? { verdict: "pass", gate_version: PAIR_SOURCE_SHA, config_digest: config, checks: [{ name: "source", outcome: "pass" }] } :
      kind === "test" ? { suites: [{ name: "native", total: 1, passed: 1, failed: 0, cancelled: 0, skipped: 0, todo: 0 }] } :
        { coverage: "complete", event_count: 2, blocked: 0, dropped: 0 },
  }]));
  const verifier = createLocalEvidenceVerifier({ mode: "local-host", scope, gate_version: PAIR_SOURCE_SHA, gate_config_digest: config,
    gate_checks: ["source"], test_suites: ["native"], now: () => now, max_age_ms: 5000,
    sources: ["gate", "test", "guard"].map(kind => ({ subject: kind, kind, producer: `k1-${kind}`, collect: async () => { collects++; return observations[kind]; } })) });
  const input = { reference, scope, verifier, read: async () => { reads++; return history; }, binding, experience_id: "current-k1-experience", now: () => now };
  return { input, verifier, history, observations, stats: () => ({ reads, collects }), advance: n => { now += n; } };
}
test("public history is re-read, imported as new observed identity, genuinely verified and compiled", async () => {
  const f = fixture(); const prepared = await prepareK1ActualHistory(f.input);
  try {
    assert.deepEqual(f.stats(), { reads: 1, collects: 3 });
    assert.equal(prepared.summary.guidance_reimported, true); assert.equal(prepared.summary.guidance_currently_verified, true);
    assert.equal(prepared.history_context.content_digest, PAIR_HISTORY_DIGEST); assert.equal(prepared.summary.item_count, 1);
    assert.equal(prepared.summary.proof_portable, false); assert.equal(prepared.summary.authorization, "none"); assert.equal(prepared.summary.executable, false);
    assert.notEqual(prepared.compiled_context.provenance[0].run_id, f.history.guidance.experience.run_id);
    assert.notEqual(prepared.compiled_context.provenance[0].experience_id, f.history.guidance.experience.experience_id);
    assert.equal(prepared.isCurrent(), true); prepared.check();
    prepared.shutdown(); assert.equal(prepared.isCurrent(), false); assert.throws(() => prepared.check(), /stage6-k1-history-host-refused/);
  } finally { prepared.shutdown(); f.verifier.shutdown(); }
});
test("old proof/handle/plan fields and a copied verifier cannot authorize history", async () => {
  const f = fixture();
  for (const value of [{ ...f.input, proof: {} }, { ...f.input, handle: {} }, { ...f.input, plan: {} }, { ...f.input, verifier: { ...f.verifier } }]) {
    await assert.rejects(prepareK1ActualHistory(value), /stage6-k1-history-host-refused/);
  }
  assert.deepEqual(f.stats(), { reads: 0, collects: 0 }); f.verifier.shutdown();
});
test("wrong reference digest rejects before the read or verifier collect", async () => {
  const f = fixture(); await assert.rejects(prepareK1ActualHistory({ ...f.input, reference: { ...f.input.reference, content_digest: hash("other") } }), /stage6-k1-history-host-refused/);
  assert.deepEqual(f.stats(), { reads: 0, collects: 0 }); f.verifier.shutdown();
});
test("source/repo/policy/environment mismatch rejects rather than relabels history", async () => {
  for (const key of ["source_sha", "repo", "policy_version", "env_fingerprint"]) {
    const f = fixture();
    await assert.rejects(prepareK1ActualHistory({ ...f.input, binding: { ...f.input.binding, [key]: key === "source_sha" ? "f".repeat(40) : "different" } }), /stage6-k1-history-host-refused/);
    assert.equal(f.stats().collects, 0); f.verifier.shutdown();
  }
});
test("history run or experience identity cannot be reused", async () => {
  for (const change of ["run", "experience"]) {
    const f = fixture(); const value = change === "run" ? { ...f.input, binding: { ...f.input.binding, run_id: f.history.guidance.experience.run_id } } :
      { ...f.input, experience_id: f.history.guidance.experience.experience_id };
    await assert.rejects(prepareK1ActualHistory(value), /stage6-k1-history-host-refused/); assert.equal(f.stats().collects, 0); f.verifier.shutdown();
  }
});
test("failed or expired native observations cannot produce current context", async () => {
  for (const failure of ["test", "guard", "expiry"]) {
    const f = fixture();
    if (failure === "test") f.observations.test.details.suites[0].passed = 0;
    if (failure === "guard") f.observations.guard.details.blocked = 1;
    if (failure === "expiry") f.advance(5000);
    await assert.rejects(prepareK1ActualHistory(f.input), /stage6-k1-history-host-refused/); f.verifier.shutdown();
  }
});
test("expiry after compilation invalidates check without recollecting or renewing", async () => {
  const f = fixture(); const prepared = await prepareK1ActualHistory(f.input); f.advance(5000);
  assert.equal(prepared.isCurrent(), false); assert.throws(() => prepared.check(), /stage6-k1-history-host-refused/);
  assert.deepEqual(f.stats(), { reads: 1, collects: 3 }); prepared.shutdown(); f.verifier.shutdown();
});
test("bad readback/thenable and canonical content edits are refused without private errors", async () => {
  for (const edit of [null, { ...fixture().history, current_verification: "verified" }, { then() { throw Error("PRIVATE_CONTENT"); } }]) {
    const f = fixture(); await assert.rejects(prepareK1ActualHistory({ ...f.input, read: async () => edit }), e => e.message === "stage6-k1-history-host-refused"); f.verifier.shutdown();
  }
});
test("option getters/proxies reject before hooks", async () => {
  const f = fixture(); let calls = 0;
  const p = new Proxy({}, { ownKeys() { calls++; throw Error(); } });
  const getter = Object.defineProperty({ ...f.input }, "read", { get() { calls++; throw Error(); } });
  await assert.rejects(prepareK1ActualHistory(p)); await assert.rejects(prepareK1ActualHistory(getter));
  assert.equal(calls, 0); assert.deepEqual(f.stats(), { reads: 0, collects: 0 }); f.verifier.shutdown();
});
test("import remains inert and only explicit call can read history", async () => {
  const url = new URL("./stage6-k1-history-host.mjs", import.meta.url); const source = await readFile(url, "utf8");
  assert.equal(/from ["']node:(?:fs|http|https|child_process)/u.test(source), false);
  const child = spawnSync(process.execPath, ["--input-type=module", "-e", `globalThis.fetch=()=>{throw Error('network')};globalThis.setTimeout=()=>{throw Error('timer')};await import(${JSON.stringify(url.href)});console.log('imported');`], { encoding: "utf8", timeout: 5000, env: { PATH: process.env.PATH, HOME: "/nonexistent", TMPDIR: "/nonexistent" } });
  assert.equal(child.status, 0); assert.equal(child.stdout, "imported\n"); assert.equal(child.stderr, "");
});
