import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdir } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { prepareHistoricalGuidance } from "@pi-vista/learning/guidance";
import { createLocalLearningLibrary } from "@pi-vista/learning/local";
import { createLocalEvidenceVerifier } from "@pi-vista/evidence/host";
import { matchSdkContract, bindStage6Provenance } from "./stage6-sdk-provenance.mjs";
import { buildK1HistoryContext } from "./stage6-k1-history-context.mjs";
import { PAIR_SOURCE_SHA } from "./paired-evaluation-data.mjs";
import { snapshotK1HostPreviewOptions, safeK1HostProjection } from "./stage6-k1-host-preview.mjs";
import { snapshotSyntheticHostOptions, SYNTHETIC_FAULTS, createSyntheticSdkHost, admitSyntheticK1Plan } from "./stage6-synthetic-sdk-host.mjs";

const sha = value => createHash("sha256").update(value).digest("hex");
const supported = () => { const [major, minor] = process.versions.node.split(".").map(Number); return major > 22 || major === 22 && minor >= 19; };
const callback = () => ({ historyReadback: {}, localCompiledContext: {} });
const canonical = value => value === null || typeof value !== "object" ? JSON.stringify(value) : Array.isArray(value) ? `[${value.map(canonical).join(",")}]` : `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
export async function localFixture(source = PAIR_SOURCE_SHA) {
  const binding = { run_id: "history-run", repo: "pi-vista", source_sha: source, policy_version: "fixture-policy", env_fingerprint: sha("fixture-environment") };
  const experience = { ...binding, experience_id: "history-experience", task_type: "metadata-validation", ts: 1,
    script: { task_type: "metadata-validation", description: "inspect fixture metadata", preconditions: [], steps: ["inspect-fixture"], postconditions: [], known_failures: [], applicable_to: [] },
    steps: [{ step_id: "fixture-step", tool: "fixture-reader", action_description: "inspect fixture metadata", check_fn_ids: [], expected_result: "observed", on_failure: "stop", depends_on: [] }] };
  const document = prepareHistoricalGuidance(experience), bank = "fixture-bank", idempotency_key = `guidance-${sha(canonical({ bank, document }))}`;
  const stored = { bank, document_id: `vista-guidance-v1-${"b".repeat(16)}-${sha(idempotency_key)}`, current_verification: "not-checked", authorization: "none", executable: false, content_digest: document.content_digest, idempotency_key, document, guidance: JSON.parse(document.content) };
  const current = { ...binding, run_id: "compiled-run" }, scope = "fixture-scope";
  const details = { gate: { verdict: "pass", gate_version: "b".repeat(40), config_digest: "c".repeat(64), checks: [{ name: "fixture-build", outcome: "pass" }] },
    test: { suites: [{ name: "fixture-cases", total: 1, passed: 1, failed: 0, skipped: 0, cancelled: 0, todo: 0 }] }, guard: { coverage: "complete", event_count: 1, blocked: 0, dropped: 0 } };
  let reads = 0, writes = 0;
  const verifier = createLocalEvidenceVerifier({ mode: "local-host", scope, gate_checks: ["fixture-build"], gate_version: "b".repeat(40), gate_config_digest: "c".repeat(64), test_suites: ["fixture-cases"], now: () => 1000,
    sources: ["gate", "test", "guard"].map(kind => ({ subject: `fixture-${kind}`, producer: `fixture-${kind}`, kind, collect: async () => ({ schema: 1, scope, kind, producer: `fixture-${kind}`, ...current, result_ref: `fixture-${kind}-result`, observed_at: 900, expires_at: 10_000, details: details[kind] }) })) });
  const library = createLocalLearningLibrary({ mode: "local-learning", scope, verifier,
    store: { read: async () => { reads++; return stored; }, retain: async () => { writes++; throw Error("no-write"); }, query: async () => { throw Error("no-query"); }, reconcile: async () => { throw Error("no-reconcile"); } } });
  try {
    const historyReadback = await library.readGuidance({ bank, document_id: stored.document_id, current_verification: "not-checked", authorization: "none", executable: false });
    const imported = library.importGuidance(historyReadback, { ...current, experience_id: "compiled-experience", ts: 2 });
    assert.equal(imported.status, "observed"); assert.equal(imported.verification, undefined);
    const verified = library.verifyCandidate(library.nominate(imported), await verifier.verify(current, { gate: "fixture-gate", test: "fixture-test", guard: "fixture-guard" }));
    const localCompiledContext = library.compileContext(library.retrieve([verified], { repo: binding.repo, source_sha: source, policy_version: binding.policy_version, env_fingerprint: binding.env_fingerprint, task_type: experience.task_type }), { max_items: 1 });
    assert.equal(reads, 1); assert.equal(writes, 0); return { historyReadback, localCompiledContext };
  } finally { library.shutdown(); verifier.shutdown(); }
}
function metadataFixture(history) {
  const context = { provider: "fixture-provider", model: "fixture-model", thinking: "high", sdk: "1.1.0-fork.1", arm: "baseline", guidance_mode: "none", guidance_digest: null, harness_source_sha: "b".repeat(40), subject_source_sha: PAIR_SOURCE_SHA, subject_history_digest: history.content_digest, broker_digest: sha("broker") };
  const core = { schema: "pi-sdk-provenance/1", package_name: "@earendil-works/pi-coding-agent", version: context.sdk, export_entry: "./dist/index.js", node_engine: ">=22.19.0", manifest_sha256: sha("manifest"), entry_sha256: sha("entry"), coverage: "manifest-and-public-entry", dependency_closure: "not-observed", verification: "metadata-only", authorization: "none", executable: false };
  const observed = { ...core, identity_sha256: sha(canonical(core)) };
  const sdk = matchSdkContract(observed, { contract_id: "fixture-sdk", package_name: core.package_name, version: core.version, export_entry: core.export_entry, node_engine: core.node_engine, manifest_sha256: core.manifest_sha256, entry_sha256: core.entry_sha256 });
  const broker = { schema: "readonly-broker-provenance/1", provider: context.provider, matched: true, reason_code: "broker-command-match", command_sha256: context.broker_digest, expected_command_sha256: context.broker_digest, target_path_sha256: sha("path"), target_metadata_sha256: sha("metadata"), verification: "metadata-only", credential_bytes_read: false, authorization: "none", executable: false };
  const provenance = bindStage6Provenance({ sdk, broker, subject_source_sha: PAIR_SOURCE_SHA, history_digest: history.content_digest, bindings: { run_id: "window-run", repo: "pi-vista", source_sha: PAIR_SOURCE_SHA, policy_version: "fixture-policy", env_fingerprint: sha("fixture-env"), harness_source_sha: context.harness_source_sha, context_digest: null, artifact_digest: sha("artifact") } });
  return { context, provenance };
}

test("legacy synthetic host option and fault contracts remain unchanged without a K1 callback", () => {
  const input = { sdk: "/synthetic/explicit-sdk", source_sha: "a".repeat(40), max_requests: 16 };
  if (supported()) {
    assert.deepEqual(snapshotSyntheticHostOptions(input), input);
    assert.deepEqual(snapshotSyntheticHostOptions({ ...input, deadline_ms: 5000 }), { ...input, deadline_ms: 5000 });
  } else assert.throws(() => snapshotSyntheticHostOptions(input), /stage6-synthetic-host-refused/);
  assert.deepEqual(SYNTHETIC_FAULTS, ["semantic-mismatch", "schema-invalid", "provider-error", "cancelled", "timeout", "deadline", "stream-disconnected", "profile-drift", "request-guard", "session-budget"]);
});

test("public LOCAL input compiles into eight pretransport K1 admissions without a window or second budget", async () => {
  const fixture = await localFixture();
  const dto = buildK1HistoryContext({ history: fixture.historyReadback, context: fixture.localCompiledContext });
  const { context, provenance } = metadataFixture(dto);
  const plan = admitSyntheticK1Plan(dto, context, provenance, 16, 5000);
  assert.equal(plan.length, 8); assert.equal(new Set(plan.map(row => `${row.case_id}/${row.arm}`)).size, 8);
  for (const row of plan) {
    assert.equal(row.admission.status, "metadata-admitted"); assert.equal(row.admission.model_calls, 0); assert.equal(row.admission.started_model_calls, 0);
    assert.equal(row.admission.provenance.bindings.context_digest, null); assert.equal(row.context.subject_history_digest, dto.content_digest);
    assert.equal(row.admission.history === null, row.arm === "baseline");
    assert.equal(row.context.guidance_digest, row.arm === "guided" ? dto.context_digest : null);
  }
});
test("metadata admission mismatch is a pure refusal before any window/session/pretransport/fetch", async () => {
  const fixture = await localFixture(), dto = buildK1HistoryContext({ history: fixture.historyReadback, context: fixture.localCompiledContext });
  const { context, provenance } = metadataFixture(dto);
  const changed = bindStage6Provenance({ sdk: provenance.sdk, broker: { ...provenance.broker, provider: "other-provider" }, subject_source_sha: provenance.subject_source_sha, history_digest: provenance.history_digest, bindings: provenance.bindings });
  const result = admitSyntheticK1Plan(dto, context, changed, 16, 5000);
  assert.equal(result.length, 8); assert.ok(result.every(row => row.admission.status === "refused" && row.admission.reason_code === "provenance-mismatch" && row.admission.started_model_calls === 0));
});
test("K1 second-argument proxies/getters/extra authority reject before source/SDK/profile", async () => {
  let traps = 0; const hook = () => { traps++; throw Error("PRIVATE"); };
  const options = { sdk: "/nonexistent-sdk", source_sha: "a".repeat(40), max_requests: 16, deadline_ms: 1000 };
  const accessor = {}; Object.defineProperty(accessor, "prepareK1Plan", { get: hook });
  const bad = [accessor, new Proxy({ prepareK1Plan: callback }, { get: hook, ownKeys: hook }), { prepareK1Plan: callback, budget: {} }, { prepareK1Plan: new Proxy(callback, { apply: hook }) }];
  for (const port of bad) await assert.rejects(createSyntheticSdkHost(options, port), error => error.message === "stage6-k1-host-preview-refused" && error.k1_phase === "input" && error.profile_fixture_prepared === false && error.session_count === 0 && error.fetch_count === 0);
  assert.equal(traps, 0);
});
test("invalid trusted history/raw/source callback data refuses before source/SDK/profile/session/fetch", async () => {
  if (!supported()) return;
  const fixture = await localFixture(), wrong = await localFixture("e".repeat(40));
  const options = { sdk: "/nonexistent-sdk", source_sha: "a".repeat(40), max_requests: 16, deadline_ms: 1000 };
  const hostDirectories = async () => { try { return (await readdir(new URL("../tmp/release-contract/", import.meta.url))).filter(name => name.startsWith("stage6-synthetic-host-")).sort(); } catch (error) { if (error.code === "ENOENT") return []; throw error; } };
  const before = await hostDirectories();
  const cases = [null, { ...fixture, permission: true }, { ...fixture, historyReadback: { ...fixture.historyReadback, authorization: "approved" } }, { ...fixture, localCompiledContext: { ...fixture.localCompiledContext, raw: "PRIVATE" } }, wrong];
  // Isolate fetch interception from other files in the integrated test runner.
  const script = `import assert from 'node:assert/strict'; const {createSyntheticSdkHost}=await import(${JSON.stringify(new URL("./stage6-synthetic-sdk-host.mjs", import.meta.url).href)}); let fetches=0; globalThis.fetch=()=>{fetches++;throw Error('unexpected-fetch')}; for(const value of ${JSON.stringify(cases)}) { await assert.rejects(createSyntheticSdkHost(${JSON.stringify(options)},{prepareK1Plan:()=>value}), error=>error.message==='stage6-k1-host-preview-refused'&&error.k1_phase==='input'&&error.profile_fixture_prepared===false&&error.window_created===false&&error.session_count===0&&error.fetch_count===0); } console.log(JSON.stringify({fetches}));`;
  const result = await promisify(execFile)(process.execPath, ["--input-type=module", "-e", script], { shell: false, timeout: 5000, maxBuffer: 8192 });
  assert.deepEqual(JSON.parse(result.stdout), { fetches: 0 }); assert.equal(result.stderr, ""); assert.deepEqual(await hostDirectories(), before);
});
test("native Promise preparation wait is bounded and late settlement cannot start setup", async () => {
  if (!supported()) return;
  let resolve; const promise = new Promise(done => { resolve = done; });
  const start = performance.now();
  await assert.rejects(createSyntheticSdkHost({ sdk: "/nonexistent-sdk", source_sha: "a".repeat(40), max_requests: 16, deadline_ms: 1000 }, { prepareK1Plan: () => promise }), error => error.k1_reason_code === "stage6-k1-preparation-timeout" && error.window_created === false && error.session_count === 0 && error.fetch_count === 0);
  assert.ok(performance.now() - start >= 900); assert.ok(performance.now() - start < 5000);
  resolve({ historyReadback: {}, localCompiledContext: {} }); await new Promise(done => setImmediate(done));
});
test("K1 preview options are closed and require exactly one trusted callback", () => {
  const good = { sdk: "/synthetic/explicit-sdk", source_sha: "a".repeat(40), max_requests: 16, deadline_ms: 5000, prepareK1Plan: callback };
  assert.equal(snapshotK1HostPreviewOptions(good).prepareK1Plan, callback);
  for (const bad of [
    { ...good, extra: true }, { ...good, max_requests: 15 }, { ...good, deadline_ms: 999 }, { ...good, prepareK1Plan: {} },
    new Proxy(good, { ownKeys() { throw Error("PRIVATE"); } }),
  ]) assert.throws(() => snapshotK1HostPreviewOptions(bad), /stage6-k1-preview-refused/);
  let calls = 0; const accessor = { ...good }; Object.defineProperty(accessor, "prepareK1Plan", { get() { calls++; throw Error("PRIVATE"); } });
  assert.throws(() => snapshotK1HostPreviewOptions(accessor), /stage6-k1-preview-refused/); assert.equal(calls, 0);
});

test("safe K1 projection rejects raw history/context/path/proof fields and preserves non-authorizing counters", () => {
  const admission = { status: "metadata-admitted", reason_code: null, model_calls: 0, started_model_calls: 0, verification: "metadata-only", authorization: "none", executable: false };
  const row = { case_id: "healthy-metadata", arm: "baseline", fault: null, failure_origin: null, outcome: "decision-valid", decision_outcome: "decision-valid", decision_parsed: true, execution_stop: "toolUse", pretransport_attempts: 2, intercepted_fetch: 2, inspector_executions: 1, decision_executions: 1, message_end_events: 2, tool_execution_end_events: 2, abort_signal_observed: false, late_sse_body_sent: false, task_digest: sha("task"), guidance_scope: "none", guidance_digest: null, k1_admission: admission };
  const receipt = { schema: "stage6-pilot-window/1", status: "closed", reason_code: null, integrity_status: "unchanged", evaluation_status: "not-evaluated", observed_pre_admission_calls: 0, pretransport_attempts: 16, max_requests: 16, profile_before_digest: sha("before"), profile_after_digest: sha("before"), drift: { classification: "unchanged", protected_changed: [], volatile_changed: [], attribution: "not-observed" }, provenance_before_digest: sha("p-before"), provenance_after_digest: sha("p-before"), verification: "metadata-only", authorization: "none", executable: false };
  const report = { schema: "stage6-synthetic-sdk-host/1", harness_source_sha: "a".repeat(40), host_sha256: sha("host"), sdk_version: "1.1.0-fork.1", node: process.version, rows: Array.from({ length: 8 }, (_, index) => ({ ...row, case_id: ["healthy-metadata", "stale-artifact", "environment-drift", "missing-metadata"][Math.floor(index / 2)], arm: index % 2 === 0 ? "baseline" : "guided", guidance_scope: index % 2 === 0 ? "none" : "synthetic-LOCAL-fixture-not-actual-history", guidance_digest: index % 2 === 0 ? null : sha("context"), k1_admission: admission })), fresh_agents: 8, intercepted_fetch: 16, synthetic_responses: 16, credential_store_read_attempts: 0, receipt, k1_plan: Array.from({ length: 8 }, (_, index) => ({ case_id: ["healthy-metadata", "stale-artifact", "environment-drift", "missing-metadata"][Math.floor(index / 2)], arm: index % 2 === 0 ? "baseline" : "guided", history_status: index % 2 === 0 ? "none" : "historical-only", history_digest: index % 2 === 0 ? null : sha("history"), context_digest: index % 2 === 0 ? null : sha("context"), admission })), evaluation_status: "not-evaluated", declared_scope: { real_model_calls: 0, bank_calls: 0, credential_bytes_read: false }, authorization: "none", executable: false };
  const result = safeK1HostProjection(report);
  assert.equal(result.status, "passed"); assert.equal(result.k1_plan.length, 8); assert.equal(result.rows.length, 8); assert.equal(result.receipt.pretransport_attempts, 16);
  assert.equal(safeK1HostProjection({ ...report, credential_store_read_attempts: 212 }).status, "passed");
  assert.equal(safeK1HostProjection({ ...report, credential_store_read_attempts: 212 }).credential_store_read_attempts, 212);
  for (const forbidden of ["history", "content", "raw", "path", "proof", "permission", "budget", "prepareK1Plan"]) assert.equal(Object.hasOwn(result, forbidden), false);
  assert.throws(() => safeK1HostProjection({ ...report, rows: report.rows.map(row => ({ ...row, raw: "PRIVATE" })) }), /stage6-k1-preview-refused/);
  assert.throws(() => safeK1HostProjection({ ...report, k1_plan: Array(8).fill(report.k1_plan[0]) }), /stage6-k1-preview-refused/);
  assert.throws(() => safeK1HostProjection({ ...report, k1_plan: report.k1_plan.map(row => row.arm === "guided" ? { ...row, context_digest: sha("different") } : row) }), /stage6-k1-preview-refused/);
  assert.equal(safeK1HostProjection({ ...report, intercepted_fetch: 15 }).status, "unknown");
  assert.equal(safeK1HostProjection({ ...report, receipt: { ...receipt, profile_after_digest: sha("different-profile") } }).status, "unknown");
  assert.throws(() => safeK1HostProjection({ ...report, k1_plan: report.k1_plan.map(row => ({ ...row, admission: { ...admission, model_calls: 1 } })) }), /stage6-k1-preview-refused/);
  assert.equal(safeK1HostProjection({ ...report, receipt: { ...receipt, reason_code: "stage6-provenance-drift", integrity_status: "unknown" } }).status, "unknown");
});
