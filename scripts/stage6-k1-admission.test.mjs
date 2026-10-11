import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { admitK1, snapshotHistoryContext } from "./stage6-k1-admission.mjs";
import { createAdmissionRequestBudget } from "./stage6-admission.mjs";
import { matchSdkContract, bindStage6Provenance } from "./stage6-sdk-provenance.mjs";

const h = x => createHash("sha256").update(x).digest("hex"), source = "a".repeat(40);
const context = { provider: "fixture-provider", model: "fixture-model", thinking: "max", sdk: "1.0.4", arm: "baseline", guidance_mode: "none", guidance_digest: null, harness_source_sha: "b".repeat(40), subject_source_sha: source, subject_history_digest: h("history"), broker_digest: h("broker") };
function provenance(overrides = {}) {
  const core = { schema: "pi-sdk-provenance/1", package_name: "@earendil-works/pi-coding-agent", version: "1.0.4", export_entry: "./dist/index.js", node_engine: ">=22.19.0", manifest_sha256: h("manifest"), entry_sha256: h("entry"), coverage: "manifest-and-public-entry", dependency_closure: "not-observed", verification: "metadata-only", authorization: "none", executable: false };
  const canonical = v => v && typeof v === "object" ? `{${Object.keys(v).sort().map(k => `${JSON.stringify(k)}:${canonical(v[k])}`).join(",")}}` : JSON.stringify(v);
  const observed = { ...core, identity_sha256: h(canonical(core)) };
  const expected = { contract_id: "fixture-sdk", package_name: core.package_name, version: core.version, export_entry: core.export_entry, node_engine: core.node_engine, manifest_sha256: core.manifest_sha256, entry_sha256: core.entry_sha256 };
  const broker = { schema: "readonly-broker-provenance/1", provider: context.provider, matched: true, reason_code: "broker-command-match", command_sha256: context.broker_digest, expected_command_sha256: context.broker_digest, target_path_sha256: h("path"), target_metadata_sha256: h("metadata"), verification: "metadata-only", credential_bytes_read: false, authorization: "none", executable: false };
  return bindStage6Provenance({ sdk: matchSdkContract(observed, expected), broker: { ...broker, ...overrides.broker }, subject_source_sha: source, history_digest: context.subject_history_digest, bindings: { run_id: "fixture-k1", repo: "pi-vista", source_sha: source, policy_version: "fixture-k1-1", env_fingerprint: h("env"), harness_source_sha: context.harness_source_sha, context_digest: null, artifact_digest: h("artifact"), ...overrides.bindings } });
}
const budget = { max_requests: 16, max_per_session: 2, deadline_ms: 1_200_000, k: 1 };
const input = extra => ({ context, expected: context, provenance: provenance(), history: null, budget, model_calls: 0, ...extra });

test("K1 metadata admission is baseline-only by default and cannot start a model", () => {
  const value = admitK1(input()); assert.equal(value.status, "metadata-admitted"); assert.equal(value.model_calls, 0); assert.equal(value.started_model_calls, 0); assert.equal(value.authorization, "none"); assert.equal(value.executable, false); assert.equal(value.history_status, "none");
});
test("guided K1 requires exact historical-only digest/context/subject binding", () => {
  const guidance = h("context"), guided = { ...context, arm: "guided", guidance_mode: "historical-observed", guidance_digest: guidance };
  const history = { schema: "stage6-history-context/1", purpose: "historical-guidance", current_verification: "not-checked", authorization: "none", executable: false, content_digest: context.subject_history_digest, subject_source_sha: source, context_digest: guidance, character_count: 100, provenance_digests: [h("current-context")] };
  const value = admitK1(input({ context: guided, expected: guided, history })); assert.equal(value.status, "metadata-admitted"); assert.equal(value.history_status, "historical-only");
  assert.equal(value.provenance.bindings.context_digest, null); assert.equal(value.history.context_digest, guidance);
  assert.equal(admitK1(input({ context: guided, expected: guided, history: { ...history, current_verification: "verified" } })).reason_code, "invalid-input");
});
test("K1 cross-checks broker provider/command and harness identity, not just matched flags", () => {
  for (const value of [
    provenance({ broker: { provider: "other-provider" } }),
    provenance({ broker: { command_sha256: h("other-command"), expected_command_sha256: h("other-command") } }),
    provenance({ bindings: { harness_source_sha: "c".repeat(40) } }),
  ]) assert.equal(admitK1(input({ provenance: value })).reason_code, "provenance-mismatch");
});
test("guided history mismatches and authority fields never become admission", () => {
  const guidance = h("context"), guided = { ...context, arm: "guided", guidance_mode: "historical-observed", guidance_digest: guidance };
  const history = { schema: "stage6-history-context/1", purpose: "historical-guidance", current_verification: "not-checked", authorization: "none", executable: false, content_digest: context.subject_history_digest, subject_source_sha: source, context_digest: guidance, character_count: 100, provenance_digests: [h("current-context")] };
  assert.equal(admitK1(input({ context: guided, expected: guided, history: { ...history, content_digest: h("other-history") } })).reason_code, "history-mismatch");
  assert.equal(admitK1(input({ context: guided, expected: guided, history: { ...history, context_digest: h("other-context") } })).reason_code, "history-mismatch");
  assert.equal(admitK1(input({ context: guided, expected: guided, history: { ...history, subject_source_sha: "c".repeat(40) } })).reason_code, "history-mismatch");
  assert.equal(admitK1(input({ context: guided, expected: guided, history: { ...history, authorization: "approved" } })).reason_code, "invalid-input");
  assert.equal(admitK1(input({ context: guided, expected: guided, history: { ...history, executable: true } })).reason_code, "invalid-input");
  assert.equal(admitK1(input({ context: guided, expected: guided, history: null })).reason_code, "history-mismatch");
  assert.equal(admitK1(input({ history })).reason_code, "baseline-history-unexpected");
});
test("copied provenance remains metadata and does not require an opaque proof handle", () => {
  const copied = JSON.parse(JSON.stringify(provenance()));
  assert.equal(admitK1(input({ provenance: copied })).status, "metadata-admitted");
  assert.equal(admitK1(input({ provenance: { ...copied, proof: true } })).reason_code, "invalid-input");
  assert.equal(admitK1(input({ context: { ...context, model: "other-model" } })).reason_code, "context-mismatch");
  assert.equal(admitK1(input({ context: { ...context, sdk: "1.0.5" }, expected: { ...context, sdk: "1.0.5" } })).reason_code, "provenance-mismatch");
});
test("K1 preserves consumed pre-admission counts and accepts only K1 budget declarations", () => {
  assert.equal(admitK1(input({ model_calls: 1 })).reason_code, "model-calls-before-admission"); assert.equal(admitK1(input({ model_calls: 1 })).model_calls, 1);
  assert.equal(admitK1(input({ model_calls: 1, context: { ...context, model: "other-model" } })).reason_code, "model-calls-before-admission");
  for (const changes of [{ k: 3 }, { max_requests: 17 }, { max_per_session: 3 }, { deadline_ms: 1_200_001 }, { deadline_ms: 999 }])
    assert.equal(admitK1(input({ budget: { ...budget, ...changes } })).reason_code, "invalid-input");
});
test("K1 metadata cannot become an execution-budget token", () => {
  const admitted = admitK1(input()); assert.equal(admitted.status, "metadata-admitted");
  assert.throws(() => createAdmissionRequestBudget(admitted), /admission-required/);
});
test("history/option getters/proxies reject without traps", () => {
  let calls = 0; const history = new Proxy({}, { get() { calls++; throw Error(); }, ownKeys() { calls++; throw Error(); } });
  assert.throws(() => snapshotHistoryContext(history), /stage6-k1-refused/);
  const bad = Object.defineProperty(input(), "context", { get() { calls++; throw Error(); } }); assert.equal(admitK1(bad).reason_code, "invalid-input"); assert.equal(calls, 0);
});
