import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { assessK1Readiness, validateK1Readiness } from "./stage6-k1-facts.mjs";
import { PUBLIC_1_0_4_CONTRACT, matchSdkContract } from "./stage6-sdk-provenance.mjs";
import { PAIR_SOURCE_SHA, PAIR_HISTORY_DIGEST, PAIR_TIMEOUT_MS } from "./paired-evaluation-data.mjs";
const hash = x => createHash("sha256").update(x).digest("hex");
const canonical = x => x !== null && typeof x === "object" ? `{${Object.keys(x).sort().map(k => `${JSON.stringify(k)}:${canonical(x[k])}`).join(",")}}` : JSON.stringify(x);
function input() {
  const pin = PUBLIC_1_0_4_CONTRACT;
  const core = { schema: "pi-sdk-provenance/1", package_name: pin.package_name, version: pin.version, export_entry: pin.export_entry,
    node_engine: pin.node_engine, manifest_sha256: pin.manifest_sha256, entry_sha256: pin.entry_sha256,
    coverage: "manifest-and-public-entry", dependency_closure: "not-observed", verification: "metadata-only", authorization: "none", executable: false };
  return {
    sdk: matchSdkContract({ ...core, identity_sha256: hash(canonical(core)) }, pin),
    broker: { schema: "readonly-broker-provenance/1", provider: "codex-local-8319", matched: true, reason_code: "broker-command-match",
      command_sha256: hash("synthetic-command"), expected_command_sha256: hash("synthetic-command"), target_path_sha256: hash("synthetic-path"),
      target_metadata_sha256: hash("synthetic-stat"), verification: "metadata-only", credential_bytes_read: false, authorization: "none", executable: false },
    subject: { repo: "pi-vista", source_sha: PAIR_SOURCE_SHA, policy_version: "stage5-policy", env_fingerprint: hash("fixture-env") },
    history: { schema: "stage6-history-context/1", purpose: "historical-guidance", current_verification: "not-checked", authorization: "none", executable: false,
      content_digest: PAIR_HISTORY_DIGEST, subject_source_sha: PAIR_SOURCE_SHA, context_digest: hash("fixture-context"), character_count: 256, provenance_digests: [hash("fixture-observation")] },
    current_verifier: { fresh: true, accepted: true, source_sha: PAIR_SOURCE_SHA, history_digest: PAIR_HISTORY_DIGEST, verification: "metadata-only", authorization: "none", executable: false },
    model: { provider: "codex-local-8319", model: "gpt-6.1-sol", thinking: "max", sdk: "1.0.4", tool: "paired_inspect_metadata", retry_count: 0 },
    budget: { cases: 4, arms: 2, fresh_sessions: 8, max_requests: 16, max_per_session: 2, deadline_ms: PAIR_TIMEOUT_MS, retry_count: 0 },
    metrics: { rows: 8, source_sha: PAIR_SOURCE_SHA, adapter: "public-usage-to-paired", aggregate: true, usage_complete: true },
  };
}
test("synthetic supplied facts are metadata consistent, never proof or window authority", () => {
  const value = assessK1Readiness(input());
  assert.equal(value.status, "ready"); assert.equal(value.reason_code, null);
  assert.equal(value.authorization, "none"); assert.equal(value.executable, false); assert.equal(value.verification, "metadata-only");
  assert.equal(value.sdk_contract, "public-1.0.4"); assert.equal(value.metric_rows, 8);
  assert.ok(Object.isFrozen(value)); assert.ok(Object.isFrozen(value.budget));
  assert.equal(Object.hasOwn(value, "proof"), false); assert.equal(Object.hasOwn(value, "permission"), false);
  assert.deepEqual(validateK1Readiness(JSON.parse(JSON.stringify(value))), value);
});
test("fork or altered public contract cannot be relabelled as the accepted SDK", () => {
  const x = input(); x.sdk = { ...x.sdk, matched: false };
  assert.equal(assessK1Readiness(x).reason_code, "sdk-contract-mismatch");
  const y = input();
  y.sdk = matchSdkContract(y.sdk.observed, { ...PUBLIC_1_0_4_CONTRACT, contract_id: "fixture-contract" });
  assert.equal(assessK1Readiness(y).reason_code, "sdk-contract-mismatch");
});
test("absent or mismatched history and subject cannot satisfy readiness", () => {
  for (const patch of [{ history: null }, { history: { ...input().history, content_digest: hash("other") } },
    { history: { ...input().history, subject_source_sha: "f".repeat(40) } }]) {
    assert.equal(assessK1Readiness({ ...input(), ...patch }).reason_code, "history-mismatch");
  }
  assert.equal(assessK1Readiness({ ...input(), subject: { ...input().subject, source_sha: "f".repeat(40) } }).reason_code, "subject-mismatch");
});
test("current-verifier declarations must be fresh and associated; no old label promotion", () => {
  for (const patch of [{ fresh: false }, { accepted: false }, { source_sha: "f".repeat(40) }, { history_digest: hash("other") }, { authorization: "allow" }, { executable: true }]) {
    const x = input(); x.current_verifier = { ...x.current_verifier, ...patch };
    assert.equal(assessK1Readiness(x).reason_code, "current-verifier-not-fresh");
  }
});
test("broker metadata mismatch and wrong provider stay not-ready", () => {
  const x = input(); x.broker = { ...x.broker, command_sha256: hash("other"), matched: false, reason_code: "broker-command-mismatch", target_path_sha256: null, target_metadata_sha256: null };
  assert.equal(assessK1Readiness(x).reason_code, "broker-mismatch");
  const y = input(); y.broker = { ...y.broker, provider: "other-provider" };
  assert.equal(assessK1Readiness(y).reason_code, "broker-mismatch");
});
test("model, thinking, SDK, tool and retries retain the frozen actual metric contract", () => {
  for (const patch of [{ provider: "other" }, { model: "other" }, { thinking: "high" }, { sdk: "1.1.0-fork.1" }, { tool: "other" }, { retry_count: 1 }]) {
    const x = input(); x.model = { ...x.model, ...patch };
    assert.equal(assessK1Readiness(x).reason_code, "model-mismatch");
  }
});
test("a budget declaration cannot change eight-session sixteen-request K1 scope", () => {
  for (const patch of [{ cases: 3 }, { arms: 1 }, { fresh_sessions: 7 }, { max_requests: 17 }, { max_per_session: 3 }, { deadline_ms: 1000 }, { retry_count: 1 }]) {
    const x = input(); x.budget = { ...x.budget, ...patch };
    assert.equal(assessK1Readiness(x).reason_code, "budget-mismatch");
  }
});
test("metrics lifecycle-only or incomplete Usage declaration cannot become complete", () => {
  for (const patch of [{ rows: 7 }, { source_sha: "f".repeat(40) }, { adapter: "lifecycle-only" }, { aggregate: false }, { usage_complete: false }]) {
    const x = input(); x.metrics = { ...x.metrics, ...patch };
    assert.equal(assessK1Readiness(x).reason_code, "metrics-mismatch");
  }
});
test("own-data closure rejects proxies, getters, extras and missing facts without hooks", () => {
  let calls = 0;
  const p = new Proxy({}, { ownKeys() { calls++; throw Error("raw"); } });
  const g = Object.defineProperty(input(), "history", { get() { calls++; throw Error("raw"); } });
  for (const value of [p, g, { ...input(), permission: true }, { ...input(), current_verifier: undefined }]) {
    assert.equal(assessK1Readiness(value).reason_code, "invalid-input");
  }
  assert.equal(calls, 0);
});
test("refusal is fixed, value-free and closed after JSON roundtrip", () => {
  const x = input(); x.subject.repo = "wrapped_sk-12345678";
  const r = assessK1Readiness(x); assert.equal(r.reason_code, "invalid-input");
  assert.equal(JSON.stringify(r).includes(x.subject.repo), false);
  assert.deepEqual(validateK1Readiness(JSON.parse(JSON.stringify(r))), r);
  assert.throws(() => validateK1Readiness({ ...r, provider: "anything" }), /stage6-k1-readiness-refused/);
  assert.throws(() => validateK1Readiness({ ...r, proof: true }), /stage6-k1-readiness-refused/);
});
test("copied ready metadata does not tolerate changed pins or permission", () => {
  const r = assessK1Readiness(input());
  for (const patch of [{ source_sha: "f".repeat(40) }, { subject_source_sha: "f".repeat(40) }, { history_digest: hash("other") }, { model: "other" }, { authorization: "allow" }, { executable: true }]) {
    assert.throws(() => validateK1Readiness({ ...r, ...patch }), /stage6-k1-readiness-refused/);
  }
});
test("facts module imports only existing pure contracts and performs no startup I/O", async () => {
  const url = new URL("./stage6-k1-facts.mjs", import.meta.url);
  const source = await readFile(url, "utf8");
  const imports = [...source.matchAll(/from\s+["']([^"']+)["']/gu)].map(m => m[1]);
  assert.deepEqual(imports, ["node:util", "@pi-vista/core", "./stage6-k1-admission.mjs", "./stage6-k1-metrics-adapter.mjs", "./stage6-sdk-provenance.mjs", "./paired-evaluation-data.mjs"]);
  assert.equal(/import\s*\(|export[^;]*from/gu.test(source), false);
  const output = spawnSync(process.execPath, ["--input-type=module", "-e", `globalThis.fetch=()=>{throw Error('network')};globalThis.setTimeout=()=>{throw Error('timer')};await import(${JSON.stringify(url.href)});console.log('imported');`],
    { encoding: "utf8", timeout: 5000, env: { PATH: process.env.PATH, HOME: "/nonexistent", TMPDIR: "/nonexistent" } });
  assert.equal(output.status, 0);
  assert.equal(output.stdout, "imported\n");
  assert.equal(output.stderr, "");
});
