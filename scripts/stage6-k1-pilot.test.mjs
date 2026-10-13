import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { createLocalEvidenceVerifier } from "@pi-vista/evidence/host";
import { prepareHistoricalGuidance } from "@pi-vista/learning/guidance";
import { prepareK1ActualHistory } from "./stage6-k1-history-host.mjs";
import { workflowObservation } from "./local-learning-workflow.mjs";
import { PUBLIC_1_0_4_CONTRACT, matchSdkContract, bindStage6Provenance } from "./stage6-sdk-provenance.mjs";
import { spawnSync } from "node:child_process";
import { k1PilotTask, k1PilotTools, runK1Pilot, summarizeK1Usage } from "./stage6-k1-pilot.mjs";
import { PAIR_SOURCE_SHA, PAIR_HISTORY_DIGEST, caseTruth } from "./paired-evaluation-data.mjs";

const hash = x => createHash("sha256").update(x).digest("hex");
const canonical = x => x !== null && typeof x === "object" ? Array.isArray(x) ? `[${x.map(canonical).join(",")}]` : `{${Object.keys(x).sort().map(k => `${JSON.stringify(k)}:${canonical(x[k])}`).join(",")}}` : JSON.stringify(x);
async function pilotFixture(failure = null) {
  const env = hash(JSON.stringify({ node: "v26.9.0", platform: "darwin", arch: "arm64", scope: "fixed-local-learning-command-plan-v1", plan: ["source-contract", "learning-native", "packed-consumer-contract"] }));
  const old = workflowObservation(PAIR_SOURCE_SHA, "workflow-01a11fcc-actual", env), document = prepareHistoricalGuidance(old);
  assert.equal(document.content_digest, PAIR_HISTORY_DIGEST);
  const bank = "stage5-isolated-test", key = `guidance-${hash(canonical({ bank, document }))}`;
  const ref = { bank, document_id: `vista-guidance-v1-${"b".repeat(16)}-${hash(key)}`, content_digest: PAIR_HISTORY_DIGEST, idempotency_key: key, current_verification: "not-checked", authorization: "none", executable: false };
  const expected = { run_id: "k1-current", repo: old.repo, source_sha: old.source_sha, policy_version: old.policy_version, env_fingerprint: env }, scope = "pilot-test";
  const stamp = Date.now(), config = hash("config");
  const observations = Object.fromEntries(["gate", "test", "guard"].map(kind => [kind, { schema: 1, scope, kind, producer: `pilot-${kind}`, ...expected,
    result_ref: `result-${kind}`, observed_at: stamp, expires_at: stamp + 60_000,
    details: kind === "gate" ? { verdict: "pass", gate_version: PAIR_SOURCE_SHA, config_digest: config, checks: [{ name: "source", outcome: "pass" }] } :
      kind === "test" ? { suites: [{ name: "native", total: 1, passed: 1, failed: 0, cancelled: 0, skipped: 0, todo: 0 }] } : { coverage: "complete", event_count: 2, blocked: 0, dropped: 0 } }]));
  const verifier = createLocalEvidenceVerifier({ mode: "local-host", scope, gate_checks: ["source"], gate_version: PAIR_SOURCE_SHA, gate_config_digest: config, test_suites: ["native"], now: Date.now, max_age_ms: 60_000,
    sources: ["gate", "test", "guard"].map(kind => ({ subject: kind, kind, producer: `pilot-${kind}`, collect: async () => observations[kind] })) });
  const preparedHistory = await prepareK1ActualHistory({ reference: ref, scope, verifier, read: async () => ({ ...ref, document, guidance: JSON.parse(document.content) }), binding: expected, experience_id: "new-k1", now: Date.now });
  const sdkCore = { schema: "pi-sdk-provenance/1", package_name: PUBLIC_1_0_4_CONTRACT.package_name, version: "1.0.4", export_entry: "./dist/index.js", node_engine: ">=22.19.0", manifest_sha256: PUBLIC_1_0_4_CONTRACT.manifest_sha256, entry_sha256: PUBLIC_1_0_4_CONTRACT.entry_sha256,
    coverage: "manifest-and-public-entry", dependency_closure: "not-observed", verification: "metadata-only", authorization: "none", executable: false };
  const sdk = matchSdkContract({ ...sdkCore, identity_sha256: hash(canonical(sdkCore)) }, PUBLIC_1_0_4_CONTRACT);
  const brokerDigest = hash("command"), broker = { schema: "readonly-broker-provenance/1", provider: "codex-local-8319", matched: true, reason_code: "broker-command-match", command_sha256: brokerDigest, expected_command_sha256: brokerDigest, target_path_sha256: hash("path"), target_metadata_sha256: hash("stat"), verification: "metadata-only", credential_bytes_read: false, authorization: "none", executable: false };
  const harness = "b".repeat(40), bindings = { ...expected, harness_source_sha: harness, context_digest: null, artifact_digest: hash("artifact") };
  const provenance = bindStage6Provenance({ sdk, broker, subject_source_sha: PAIR_SOURCE_SHA, history_digest: PAIR_HISTORY_DIGEST, bindings });
  const profile = { protected: { models: hash("models") }, volatile: { root: hash("root") } };
  const context = { provider: "codex-local-8319", model: "gpt-6.1-sol", thinking: "max", sdk: "1.0.4", arm: "baseline", guidance_mode: "none", guidance_digest: null, harness_source_sha: harness, subject_source_sha: PAIR_SOURCE_SHA, subject_history_digest: PAIR_HISTORY_DIGEST, broker_digest: brokerDigest };
  let created = 0, requests = 0;
  const createSession = async ({ case_id, system, tools }) => {
    created++; const handlers = new Set();
    const session = { sessionId: `session-${created}`, model: { provider: context.provider, id: context.model }, thinkingLevel: "max", systemPrompt: system,
      getActiveToolNames: () => ["paired_inspect_metadata", "stage6_decision"], subscribe: h => { handlers.add(h); return () => handlers.delete(h); },
      agent: { streamFunction: async () => { requests++; }, abort() {} }, async waitForIdle() {}, async abort() {}, dispose() {},
      async prompt() {
        const emit = event => { for (const h of handlers) h(event); };
        await session.agent.streamFunction(session.model, {}, { reasoning: "max" });
        tools.inspect({ case_id }); emit({ type: "tool_execution_end" });
        const usage = { input: 10, output: 5, cacheRead: 0, cacheWrite: 0, totalTokens: 15, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
        emit({ type: "message_end", message: { role: "assistant", stopReason: "toolUse", content: [], usage } });
        if (failure === "provider") { emit({ type: "message_end", message: { role: "assistant", stopReason: "error", errorMessage: "503 unavailable", content: [], usage } }); return; }
        await session.agent.streamFunction(session.model, {}, { reasoning: "max" });
        tools.decide({ case_id, ...(failure === "semantic" ? { decision: "accept", reason_code: "metadata-current" } : caseTruth(case_id)) }); emit({ type: "tool_execution_end" });
        emit({ type: "message_end", message: { role: "assistant", stopReason: "toolUse", content: [], usage } });
      } };
    return { session, requestGuard: () => {}, toolDefinitionDigest: hash("fixture-tools") };
  };
  return { input: { profileDirectory: "/fixture", context, bindings, provenance, preparedHistory }, ports: { createSession, checkSource: async () => {}, collectProvenance: async () => provenance, captureProfile: async () => profile },
    counts: () => ({ created, requests }), close: () => { preparedHistory.shutdown(); verifier.shutdown(); } };
}

test("one real coordinator window executes eight mock sessions and counts sixteen attempts", async () => {
  const f = await pilotFixture();
  try { const report = await runK1Pilot(f.input, f.ports); assert.equal(report.status, "measured"); assert.equal(report.fresh_sessions, 8); assert.equal(report.rows.length, 8);
    assert.equal(report.receipt.pretransport_attempts, 16); assert.equal(report.receipt.max_requests, 16); assert.equal(report.receipt.integrity_status, "unchanged");
    assert.equal(report.aggregate.baseline.successes, 4); assert.equal(report.aggregate.guided.successes, 4); assert.deepEqual(f.counts(), { created: 8, requests: 16 });
  } finally { f.close(); }
});
test("semantic mismatches remain measured failures, provider errors remain unknown and stop", async () => {
  const a = await pilotFixture("semantic");
  try { const r = await runK1Pilot(a.input, a.ports); assert.equal(r.status, "measured"); assert.equal(r.aggregate.baseline.successes, 1); assert.equal(r.aggregate.guided.successes, 1); } finally { a.close(); }
  const b = await pilotFixture("provider");
  try { const r = await runK1Pilot(b.input, b.ports); assert.equal(r.status, "unknown"); assert.equal(r.aggregate, null); assert.equal(r.fresh_sessions, 1); assert.equal(r.receipt.pretransport_attempts, 1); } finally { b.close(); }
});

test("pilot task and strict tool definitions are fixed and non-authorizing", () => {
  const task = k1PilotTask("healthy-metadata", PAIR_SOURCE_SHA, "a".repeat(64));
  const tools = k1PilotTools("healthy-metadata");
  assert.match(task, /paired_inspect_metadata/); assert.match(task, /stage6_decision/);
  assert.deepEqual(tools.inspector.properties.case_id.enum, ["healthy-metadata", "stale-artifact", "environment-drift", "missing-metadata"]);
  assert.equal(tools.decision.additionalProperties, false);
});
test("Usage summary preserves optional reasoning and rejects no data", () => {
  assert.deepEqual(summarizeK1Usage([{ usage: { input: 2, output: 3, cacheRead: 1, cacheWrite: 0, totalTokens: 6, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }, reasoning: 1 } }]),
    { input: 2, output: 3, cacheRead: 1, cacheWrite: 0, totalTokens: 6, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }, reasoning: 1 });
  assert.throws(() => summarizeK1Usage([]), /stage6-k1-usage-unavailable/);
});
test("actual pilot rejects copied prepared history before any session or transport", async () => {
  await assert.rejects(runK1Pilot({ profileDirectory: "/fixture", context: {}, bindings: {}, provenance: {}, preparedHistory: { isCurrent: () => true } }, {}), /stage6-k1-pilot-refused/);
});
test("pilot module import is inert and has no startup filesystem/network call", async () => {
  const url = new URL("./stage6-k1-pilot.mjs", import.meta.url);
  const child = spawnSync(process.execPath, ["--input-type=module", "-e", `globalThis.fetch=()=>{throw Error('network')};globalThis.setTimeout=()=>{throw Error('timer')};await import(${JSON.stringify(url.href)});console.log('imported')`], { encoding: "utf8", timeout: 5000, env: { PATH: process.env.PATH, HOME: "/nonexistent", TMPDIR: "/nonexistent" } });
  assert.equal(child.status, 0); assert.equal(child.stdout, "imported\n"); assert.equal(child.stderr, "");
});
