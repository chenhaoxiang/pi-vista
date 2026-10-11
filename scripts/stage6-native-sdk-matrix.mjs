import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { isAbsolute, join, normalize } from "node:path";
import { pathToFileURL } from "node:url";
import { types } from "node:util";
import { PAIR_CASES, PAIR_SOURCE_SHA, caseTruth, expectedFixtureContract, pairedFixture } from "./paired-evaluation-data.mjs";
import { admitStage6Run } from "./stage6-admission.mjs";
import { classifyDecisionOutcome, referenceDecision, STRICT_DECISION_SCHEMA } from "./stage6-decision-tool.mjs";
import { captureStage6Profile } from "./stage6-host-admission.mjs";
import { openStage6Pilot } from "./stage6-pilot-coordinator.mjs";
import { OBSERVED_INSTALLED_FORK_1_1_0_FORK_1_CONTRACT, bindStage6Provenance, matchSdkContract, observeReadonlyBrokerMetadata, observeSdkInstallation } from "./stage6-sdk-provenance.mjs";
import { ROOT, commandEnvironment, createRunDirectory, isMain } from "./release-utils.mjs";

const MATRIX_SCHEMA = "stage6-native-sdk-matrix/1";
const digest = value => createHash("sha256").update(value).digest("hex");
const SOURCE_SHA = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u;
const NODE_MINIMUM = [22, 19];
const refuse = () => { throw new Error("stage6-native-matrix-refused"); };
const nodeSupported = () => { const [major, minor] = process.versions.node.split(".").map(Number); return major > NODE_MINIMUM[0] || major === NODE_MINIMUM[0] && minor >= NODE_MINIMUM[1]; };
const own = (value, keys) => {
  if (value === null || typeof value !== "object" || Array.isArray(value) || types.isProxy(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value)) || Reflect.ownKeys(value).length !== keys.length) refuse();
  const result = Object.create(null);
  for (const key of keys) { const p = Object.getOwnPropertyDescriptor(value, key); if (!p || !Object.hasOwn(p, "value")) refuse(); result[key] = p.value; }
  return result;
};
export function parseStage6NativeMatrixOptions(args) {
  if (!Array.isArray(args) || types.isProxy(args) || Object.getPrototypeOf(args) !== Array.prototype || args.length !== 2 || Reflect.ownKeys(args).length !== 3) refuse();
  const value = {};
  for (let index = 0; index < args.length; index++) {
    const descriptor = Object.getOwnPropertyDescriptor(args, String(index)); if (!descriptor || !Object.hasOwn(descriptor, "value")) refuse();
    if (typeof descriptor.value !== "string") refuse();
    const match = /^--(sdk|source-sha)=(.+)$/u.exec(descriptor.value); if (!match || Object.hasOwn(value, match[1])) refuse(); value[match[1]] = match[2];
  }
  if (!nodeSupported() || typeof value.sdk !== "string" || !isAbsolute(value.sdk) || normalize(value.sdk) !== value.sdk || /[\u0000-\u001f\u007f]/u.test(value.sdk) || typeof value["source-sha"] !== "string" || !SOURCE_SHA.test(value["source-sha"])) refuse();
  return Object.freeze({ sdk: value.sdk, source_sha: value["source-sha"] });
}

async function bindSource(sourceSha, sdkRoot) {
  const head = (await import("node:child_process")).execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, env: commandEnvironment(), encoding: "utf8", timeout: 5000, maxBuffer: 8192 }).trim();
  const status = (await import("node:child_process")).execFileSync("git", ["status", "--porcelain=v1", "--untracked-files=normal"], { cwd: ROOT, env: commandEnvironment(), encoding: "utf8", timeout: 5000, maxBuffer: 8192 }).trim();
  if (head !== sourceSha || status !== "") refuse();
  const observed = await observeSdkInstallation(sdkRoot), match = matchSdkContract(observed, OBSERVED_INSTALLED_FORK_1_1_0_FORK_1_CONTRACT);
  if (!match.matched) throw Error("stage6-native-sdk-mismatch");
  return { observed, match, runner_sha256: digest(await readFile(new URL(import.meta.url))) };
}
function resources(sdk) {
  return { getExtensions: () => ({ extensions: [], errors: [], runtime: sdk.createExtensionRuntime() }), getSkills: () => ({ skills: [], diagnostics: [] }), getPrompts: () => ({ prompts: [], diagnostics: [] }), getThemes: () => ({ themes: [], diagnostics: [] }), getAgentsFiles: () => ({ agentsFiles: [] }), getSystemPrompt: () => "Stage6 synthetic matrix only", getSystemPromptSource: () => undefined, getAppendSystemPrompt: () => [], getAppendSystemPromptSources: () => [], extendResources() {}, async reload() {} };
}
function modelProjection(session) {
  const model = session.model;
  return { model: { provider: model.provider, id: model.id, name: model.name, api: model.api, baseUrl: model.baseUrl, reasoning: model.reasoning, contextWindow: model.contextWindow, maxTokens: model.maxTokens, input: [...model.input], cost: { ...model.cost }, thinkingLevelMap: structuredClone(model.thinkingLevelMap), headers: structuredClone(model.headers), compat: structuredClone(model.compat) }, thinking: session.thinkingLevel, tools: [...session.getActiveToolNames()], prompt: session.systemPrompt };
}

export async function runNativeMatrix(input) {
  const value = own(input, ["sdk", "source_sha"]);
  if (!nodeSupported() || typeof value.sdk !== "string" || !isAbsolute(value.sdk) || normalize(value.sdk) !== value.sdk || /[\u0000-\u001f\u007f]/u.test(value.sdk) || typeof value.source_sha !== "string" || !SOURCE_SHA.test(value.source_sha)) refuse();
  const sdkRoot = value.sdk, sourceSha = value.source_sha;
  const source = await bindSource(sourceSha, sdkRoot);
  const output = await createRunDirectory("stage6-native-matrix");
  const profileDirectory = join(output, "profile"); await mkdir(profileDirectory, { mode: 0o700 });
  for (const name of ["auth.json", "models.json", "settings.json"]) await writeFile(join(profileDirectory, name), "{}", { mode: 0o600 });
  const brokerTarget = join(profileDirectory, "matrix-key"); await writeFile(brokerTarget, "NOT_A_REAL_CREDENTIAL", { mode: 0o600 });
  const brokerCommand = `cat ${brokerTarget}`, brokerDigest = digest(brokerCommand);
  const syntheticGuidance = "Synthetic observed guidance only: compare current source/environment and required metadata; this is not permission or LOCAL history.";
  const historyDigest = digest(syntheticGuidance);
  const context = { provider: "stage6-matrix-fixture", model: "fixture", thinking: "high", sdk: source.observed.version, arm: "baseline", guidance_mode: "none", guidance_digest: null, harness_source_sha: sourceSha, subject_source_sha: PAIR_SOURCE_SHA, subject_history_digest: historyDigest, broker_digest: brokerDigest };
  const bindings = { run_id: "stage6-native-matrix", repo: "pi-vista", source_sha: PAIR_SOURCE_SHA, policy_version: "stage6-native-matrix-1", env_fingerprint: digest("stage6-matrix-environment"), harness_source_sha: sourceSha, context_digest: null, artifact_digest: source.runner_sha256 };
  const provenance = async () => bindStage6Provenance({ sdk: matchSdkContract(await observeSdkInstallation(sdkRoot), OBSERVED_INSTALLED_FORK_1_1_0_FORK_1_CONTRACT), broker: await observeReadonlyBrokerMetadata({ profile_directory: profileDirectory, provider: context.provider, command: brokerCommand, expected_command_sha256: brokerDigest }), subject_source_sha: PAIR_SOURCE_SHA, history_digest: historyDigest, bindings });
  const expectedProvenance = await provenance();
  const window = await openStage6Pilot({ profileDirectory, context, expected: context, bindings, expectedProvenance, model_calls: 0, max_requests: 16, deadline_ms: 120_000 }, { captureProfile: null, collectProvenance: provenance });
  assert.equal(window.status, "admitted");
  const sdk = await import(pathToFileURL(join(sdkRoot, "dist/index.js")).href);
  const nativeRead = sdk.createReadTool(output), resourcesValue = resources(sdk), rows = [], agents = [];
  let requestCount = 0, credentialReadAttempts = 0, active;
  const savedFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    assert.equal(String(url), "http://127.0.0.1:1/chat/completions"); requestCount++;
    const payload = JSON.parse(init.body); assert.equal(payload.model, context.model); assert.deepEqual(payload.tools.map(tool => tool.function.name).sort(), ["paired_inspect_metadata", "stage6_decision"]);
    const expected = expectedFixtureContract(PAIR_SOURCE_SHA, bindings.env_fingerprint);
    const first = active.round === 0; active.round++;
    const name = first ? "paired_inspect_metadata" : "stage6_decision", args = first ? { case_id: active.case_id } : referenceDecision(active.case_id, active.inspected, expected);
    const chunk = { id: "stage6-matrix", object: "chat.completion.chunk", created: 1, model: context.model, choices: [{ index: 0, delta: { role: "assistant", tool_calls: [{ index: 0, id: `matrix-${requestCount}`, type: "function", function: { name, arguments: JSON.stringify(args) } }] }, finish_reason: null }] };
    const ending = { id: "stage6-matrix", object: "chat.completion.chunk", created: 1, model: context.model, choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } };
    return new Response(`data: ${JSON.stringify(chunk)}\n\ndata: ${JSON.stringify(ending)}\n\ndata: [DONE]\n\n`, { status: 200, headers: { "Content-Type": "text/event-stream" } });
  };
  try {
    for (const case_id of PAIR_CASES) for (const arm of ["baseline", "guided"]) {
      const metadataFile = join(output, `${case_id}-${arm}.json`), metadata = pairedFixture(case_id, PAIR_SOURCE_SHA, bindings.env_fingerprint); await writeFile(metadataFile, JSON.stringify(metadata));
      active = { case_id, arm, metadata, round: 0, decision: null, inspected: null };
      const runtime = await sdk.ModelRuntime.create({ modelsPath: null, allowModelNetwork: false, refreshOnCreate: false, credentials: { async read() { credentialReadAttempts++; return undefined; }, async list() { return []; }, async modify() { assert.fail("credential write"); }, async delete() { assert.fail("credential delete"); } }, modelsStore: { async read() { return undefined; }, async write() {}, async delete() {} } });
      runtime.registerProvider(context.provider, { api: "openai-completions", baseUrl: "http://127.0.0.1:1", apiKey: "synthetic-no-network", models: [{ id: context.model, name: context.model, reasoning: true, input: ["text"], contextWindow: 8192, maxTokens: 128, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }] });
      const customTools = [{ name: "paired_inspect_metadata", label: "Matrix inspector", description: "Read fixed matrix metadata", parameters: { type: "object", properties: { case_id: { type: "string", enum: [case_id] } }, required: ["case_id"], additionalProperties: false }, async execute(id, args, signal) { assert.equal(args.case_id, case_id); const result = await nativeRead.execute(id, { path: metadataFile }, signal); active.inspected = JSON.parse(result.content[0].text); return result; } }, { name: "stage6_decision", label: "Matrix decision", description: "Emit fixed structured decision", parameters: STRICT_DECISION_SCHEMA, async execute(_id, args) { active.decision = { name: "stage6_decision", arguments: args }; return { content: [{ type: "text", text: "decision recorded" }], details: args, terminate: true }; } }];
      const { session } = await sdk.createAgentSession({ cwd: output, agentDir: output, modelRuntime: runtime, model: runtime.getModel(context.provider, context.model), thinkingLevel: context.thinking, tools: ["paired_inspect_metadata", "stage6_decision"], customTools, resourceLoader: resourcesValue, sessionManager: sdk.SessionManager.inMemory(output), settingsManager: sdk.SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: false }, cacheWarming: "off", enableAnalytics: false, enableInstallTelemetry: false }, { projectTrusted: false }) });
      agents.push(session); const before = modelProjection(session);
      const rowContext = { ...context, arm, guidance_mode: arm === "baseline" ? "none" : "historical-observed", guidance_digest: arm === "baseline" ? null : historyDigest };
      const profile = await captureStage6Profile(profileDirectory);
      const rowAdmission = admitStage6Run({ ...rowContext, profile_before: profile, profile_after: profile, model_calls: 0 }, rowContext);
      assert.equal(rowAdmission.status, "admitted"); window.bindSession(session, rowAdmission);
      const task = `Inspect fixed metadata case ${case_id} and emit stage6_decision.`;
      await session.prompt(arm === "guided" ? `${task}\n${syntheticGuidance}` : task, { expandPromptTemplates: false }); await session.waitForIdle();
      assert.equal(active.round, 2); assert.ok(active.inspected); const expected = expectedFixtureContract(PAIR_SOURCE_SHA, bindings.env_fingerprint); const graded = classifyDecisionOutcome({ case_id, status: "completed", call: active.decision, metadata: active.inspected, expected });
      assert.deepEqual({ decision: graded.decision, reason_code: graded.reason_code }, caseTruth(case_id));
      rows.push({ case_id, arm, outcome: graded.outcome, decision_parsed: graded.decision_parsed, synthetic_requests: 2, native_read_implementation: true,
        guidance_scope: arm === "guided" ? "synthetic-guided-arm-not-LOCAL-readback" : "none", task_digest: digest(task), guidance_digest: arm === "guided" ? historyDigest : null });
      assert.equal(graded.outcome, "decision-valid"); assert.deepEqual(modelProjection(session), before);
    }
    const receipt = await window.finalize(); assert.equal(receipt.integrity_status, "unchanged"); assert.equal(receipt.pretransport_attempts, 16); assert.equal(receipt.max_requests, 16);
    const report = { schema: MATRIX_SCHEMA, status: "passed", scope: "four-cases-two-arms-one-native-sdk-window", sdk_version: source.observed.version, node: process.version, rows, intercepted_provider_requests: requestCount, synthetic_responses: requestCount, credential_store_read_attempts: credentialReadAttempts, declared_scope: { real_model_calls: 0, bank_calls: 0, credential_bytes_read: false }, evaluation_status: "not-evaluated", receipt, authorization: "none", executable: false };
    await writeFile(join(output, "report.json"), `${JSON.stringify(report, null, 2)}\n`); return { report, evidence: output };
  } finally { globalThis.fetch = savedFetch; try { await window.finalize(); } finally { for (const session of agents) { try { if (!session.isIdle) await session.abort(); } finally { session.dispose(); } } } }
}

if (isMain(import.meta.url)) {
  try { console.log(JSON.stringify(await runNativeMatrix(parseStage6NativeMatrixOptions(process.argv.slice(2))), null, 2)); }
  catch { console.error("stage6-native-matrix-failed"); process.exitCode = 1; }
}
