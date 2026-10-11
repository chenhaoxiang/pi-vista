import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { isAbsolute, join, normalize } from "node:path";
import { pathToFileURL } from "node:url";
import { types, promisify } from "node:util";
import { execFile } from "node:child_process";
import { ROOT, commandEnvironment, createRunDirectory, isMain } from "./release-utils.mjs";
import { PAIR_SOURCE_SHA, pairedFixture, expectedFixtureContract } from "./paired-evaluation-data.mjs";
import { classifyDecisionOutcome, referenceDecision, STRICT_DECISION_SCHEMA } from "./stage6-decision-tool.mjs";
import { openStage6Pilot } from "./stage6-pilot-coordinator.mjs";
import { OBSERVED_INSTALLED_FORK_1_1_0_FORK_1_CONTRACT, bindStage6Provenance, matchSdkContract, observeReadonlyBrokerMetadata, observeSdkInstallation } from "./stage6-sdk-provenance.mjs";

const digest = value => createHash("sha256").update(value).digest("hex");
const SOURCE_SHA = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u;
const NODE_MINIMUM = [22, 19];

function refuse() { throw new Error("stage6-native-acceptance-refused"); }
function absolute(value) {
  if (typeof value !== "string" || !isAbsolute(value) || normalize(value) !== value || /[\u0000-\u001f\u007f]/u.test(value)) refuse();
  return value;
}
function snapshotOptions(input) {
  if (!input || typeof input !== "object" || Array.isArray(input) || types.isProxy(input) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(input)) || Reflect.ownKeys(input).length !== 2) refuse();
  const values = {};
  for (const key of ["sdk", "source_sha"]) {
    const p = Object.getOwnPropertyDescriptor(input, key);
    if (!p || !Object.hasOwn(p, "value") || p.value === undefined) refuse(); values[key] = p.value;
  }
  if (!nodeSupported() || typeof values.source_sha !== "string" || !SOURCE_SHA.test(values.source_sha)) refuse();
  return Object.freeze({ sdk: absolute(values.sdk), source_sha: values.source_sha });
}
async function readHarnessSource(expectedSha) {
  const env = commandEnvironment();
  const git = promisify(execFile);
  const head = await git("git", ["rev-parse", "HEAD"], { cwd: ROOT, env, shell: false, timeout: 5000, maxBuffer: 4096 });
  const state = await git("git", ["status", "--porcelain=v1", "--untracked-files=normal"], { cwd: ROOT, env, shell: false, timeout: 5000, maxBuffer: 8192 });
  if (head.stdout.trim() !== expectedSha || state.stdout.trim() !== "") throw Error("stage6-native-source-mismatch");
  return digest(await readFile(new URL(import.meta.url)));
}
function nodeSupported(version = process.versions.node) {
  const [major = 0, minor = 0] = version.split(".").map(Number);
  return major > NODE_MINIMUM[0] || major === NODE_MINIMUM[0] && minor >= NODE_MINIMUM[1];
}

export function parseStage6NativeAcceptanceOptions(args) {
  if (!Array.isArray(args) || types.isProxy(args) || Object.getPrototypeOf(args) !== Array.prototype || args.length !== 2 || Reflect.ownKeys(args).length !== 3) refuse();
  const options = Object.create(null);
  for (let i = 0; i < args.length; i++) {
    const p = Object.getOwnPropertyDescriptor(args, String(i));
    if (!p || !Object.hasOwn(p, "value") || typeof p.value !== "string") refuse();
    const match = /^--(sdk|source-sha)=(.+)$/u.exec(p.value);
    if (!match || Object.hasOwn(options, match[1])) refuse();
    options[match[1]] = match[2];
  }
  if (!options.sdk || !options["source-sha"] || !nodeSupported() || !SOURCE_SHA.test(options["source-sha"])) refuse();
  return Object.freeze({ sdk: absolute(options.sdk), source_sha: options["source-sha"] });
}

function sessionSnapshot(session) {
  const model = session.model;
  return { model: { provider: model.provider, id: model.id, name: model.name, api: model.api, baseUrl: model.baseUrl,
    reasoning: model.reasoning, contextWindow: model.contextWindow, maxTokens: model.maxTokens,
    input: [...model.input], cost: { ...model.cost }, thinkingLevelMap: structuredClone(model.thinkingLevelMap),
    headers: structuredClone(model.headers), compat: structuredClone(model.compat),
    samplingParams: structuredClone(model.samplingParams), samplingParamsByThinkingLevel: structuredClone(model.samplingParamsByThinkingLevel),
    promptCache: structuredClone(model.promptCache), inputLimits: structuredClone(model.inputLimits) }, thinking: session.thinkingLevel,
    tools: [...session.getActiveToolNames()], prompt: session.systemPrompt };
}

function nativeSessionResources(sdk) {
  return {
    getExtensions: () => ({ extensions: [], errors: [], runtime: sdk.createExtensionRuntime() }),
    getSkills: () => ({ skills: [], diagnostics: [] }), getPrompts: () => ({ prompts: [], diagnostics: [] }),
    getThemes: () => ({ themes: [], diagnostics: [] }), getAgentsFiles: () => ({ agentsFiles: [] }),
    getSystemPrompt: () => "Stage6 synthetic native acceptance only",
    getSystemPromptSource: () => undefined, getAppendSystemPrompt: () => [], getAppendSystemPromptSources: () => [],
    extendResources() {}, async reload() {},
  };
}

export async function runStage6NativeAcceptance(input) {
  const { sdk: sdkRoot, source_sha: sourceSha } = snapshotOptions(input);
  const artifactDigest = await readHarnessSource(sourceSha);
  const observed = await observeSdkInstallation(sdkRoot);
  const sdkMatch = matchSdkContract(observed, OBSERVED_INSTALLED_FORK_1_1_0_FORK_1_CONTRACT);
  if (!sdkMatch.matched) throw Error("stage6-native-sdk-mismatch");
  const output = await createRunDirectory("stage6-native-sdk");
  const profileDirectory = join(output, "profile"); await mkdir(profileDirectory, { mode: 0o700 });
  for (const name of ["auth.json", "models.json", "settings.json"]) await writeFile(join(profileDirectory, name), "{}", { mode: 0o600 });
  const brokerTarget = join(profileDirectory, "synthetic-key");
  await writeFile(brokerTarget, "NOT_A_REAL_CREDENTIAL", { mode: 0o600 });
  const brokerCommand = `cat ${brokerTarget}`, brokerDigest = digest(brokerCommand);
  const context = {
    provider: "stage6-sdk-fixture", model: "fixture", thinking: "high", sdk: "1.1.0-fork.1",
    arm: "baseline", guidance_mode: "none", guidance_digest: null, harness_source_sha: sourceSha,
    subject_source_sha: PAIR_SOURCE_SHA, subject_history_digest: digest("stage6-native-synthetic-history"), broker_digest: brokerDigest,
  };
  const bindings = {
    run_id: "stage6-native-sdk-acceptance", repo: "pi-vista", source_sha: PAIR_SOURCE_SHA,
    policy_version: "stage6-native-sdk-acceptance-1", env_fingerprint: digest("stage6-native-synthetic-environment"),
    harness_source_sha: sourceSha, context_digest: null, artifact_digest: artifactDigest,
  };
  const sdk = await import(pathToFileURL(join(sdkRoot, "dist/index.js")).href);
  assert.equal(sdkMatch.matched, true); assert.equal(sdkMatch.observed.version, context.sdk);
  const collectProvenance = async () => bindStage6Provenance({ sdk: matchSdkContract(await observeSdkInstallation(sdkRoot), OBSERVED_INSTALLED_FORK_1_1_0_FORK_1_CONTRACT),
    broker: await observeReadonlyBrokerMetadata({ profile_directory: profileDirectory, provider: context.provider, command: brokerCommand, expected_command_sha256: brokerDigest }),
    subject_source_sha: PAIR_SOURCE_SHA, history_digest: context.subject_history_digest, bindings });
  const expectedProvenance = await collectProvenance();
  const window = await openStage6Pilot({ profileDirectory, context, expected: context, bindings, expectedProvenance, model_calls: 0, max_requests: 2, deadline_ms: 60_000 }, { captureProfile: null, collectProvenance });
  assert.equal(window.status, "admitted");
  const fixture = pairedFixture("healthy-metadata", PAIR_SOURCE_SHA, bindings.env_fingerprint);
  const expected = expectedFixtureContract(PAIR_SOURCE_SHA, bindings.env_fingerprint);
  const metadataFile = join(output, "metadata.json"); await writeFile(metadataFile, JSON.stringify(fixture));
  let inspected, decisionCall, requestCount = 0, credentialReadAttempts = 0;
  const savedFetch = globalThis.fetch;
  let session;
  try {
  globalThis.fetch = async (url, init) => {
    assert.equal(String(url), "http://127.0.0.1:1/chat/completions");
    requestCount++; const payload = JSON.parse(init.body);
    assert.equal(payload.model, "fixture");
    assert.deepEqual(payload.tools.map(tool => tool.function.name).sort(), ["paired_inspect_metadata", "stage6_decision"]);
    const first = requestCount === 1, name = first ? "paired_inspect_metadata" : "stage6_decision";
    const args = first ? { case_id: fixture.case_id } : referenceDecision(fixture.case_id, inspected, expected);
    const chunk = { id: "chatcmpl-fixture", object: "chat.completion.chunk", created: 1, model: context.model,
      choices: [{ index: 0, delta: { role: "assistant", tool_calls: [{ index: 0, id: `stage6-native-${requestCount}`, type: "function", function: { name, arguments: JSON.stringify(args) } }] }, finish_reason: null }] };
    const ending = { id: "chatcmpl-fixture", object: "chat.completion.chunk", created: 1, model: context.model,
      choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } };
    return new Response(`data: ${JSON.stringify(chunk)}\n\ndata: ${JSON.stringify(ending)}\n\ndata: [DONE]\n\n`, { status: 200, headers: { "Content-Type": "text/event-stream" } });
  };
  const runtime = await sdk.ModelRuntime.create({ modelsPath: null, allowModelNetwork: false, refreshOnCreate: false,
    credentials: { async read() { credentialReadAttempts++; return undefined; }, async list() { return []; }, async modify() { assert.fail("credential write"); }, async delete() { assert.fail("credential delete"); } },
    modelsStore: { async read() { return undefined; }, async write() {}, async delete() {} } });
  runtime.registerProvider(context.provider, { api: "openai-completions", baseUrl: "http://127.0.0.1:1", apiKey: "synthetic-no-network",
    models: [{ id: context.model, name: context.model, reasoning: true, input: ["text"], contextWindow: 8192, maxTokens: 128, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }] });
  const nativeRead = sdk.createReadTool(output);
  const customTools = [
    { name: "paired_inspect_metadata", label: "Fixture inspector", description: "Read the fixed synthetic metadata fixture",
      parameters: { type: "object", properties: { case_id: { type: "string", enum: [fixture.case_id] } }, required: ["case_id"], additionalProperties: false },
      async execute(id, args, signal) { assert.equal(args.case_id, fixture.case_id); const result = await nativeRead.execute(id, { path: metadataFile }, signal); inspected = JSON.parse(result.content[0].text); return result; } },
    { name: "stage6_decision", label: "Fixture decision", description: "Emit a fixed structured fixture decision", parameters: STRICT_DECISION_SCHEMA,
      async execute(_id, args) { decisionCall = { name: "stage6_decision", arguments: args }; return { content: [{ type: "text", text: "Recorded structured fixture decision" }], details: args, terminate: true }; } },
  ];
  const resources = nativeSessionResources(sdk);
    ({ session } = await sdk.createAgentSession({ cwd: output, agentDir: output, modelRuntime: runtime, model: runtime.getModel(context.provider, context.model), thinkingLevel: context.thinking,
      tools: ["paired_inspect_metadata", "stage6_decision"], customTools, resourceLoader: resources, sessionManager: sdk.SessionManager.inMemory(output),
      settingsManager: sdk.SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: false }, cacheWarming: "off", enableAnalytics: false, enableInstallTelemetry: false }, { projectTrusted: false }) }));
    const before = sessionSnapshot(session);
    const originalStream = session.agent.streamFunction; window.bindSession(session);
    await session.prompt("Inspect the fixed metadata and emit the strict decision.", { expandPromptTemplates: false }); await session.waitForIdle();
    assert.equal(requestCount, 2); assert.ok(inspected); assert.equal(classifyDecisionOutcome({ case_id: fixture.case_id, status: "completed", call: decisionCall, metadata: inspected, expected }).outcome, "decision-valid");
    assert.deepEqual(sessionSnapshot(session), before);
    const receipt = await window.finalize(); assert.equal(receipt.integrity_status, "unchanged"); assert.equal(session.agent.streamFunction, originalStream);
    assert.equal(receipt.pretransport_attempts, requestCount); assert.equal(receipt.max_requests, 2);
    assert.equal(await readHarnessSource(sourceSha), artifactDigest);
    const report = { schema: "stage6-native-sdk-acceptance/1", status: "passed", scope: "synthetic SDK tool lifecycle only", harness_source_sha: sourceSha,
      runner_sha256: artifactDigest, sdk_version: observed.version, node: process.version,
      intercepted_provider_requests: requestCount, synthetic_responses: requestCount, credential_store_read_attempts: credentialReadAttempts,
      declared_scope: { real_model_calls: 0, bank_calls: 0, credential_bytes_read: false },
      native_read_implementation_verified: true, native_read_registry_dispatch: false, strict_decision: "decision-valid", receipt, authorization: "none", executable: false };
    await writeFile(join(output, "report.json"), `${JSON.stringify(report, null, 2)}\n`); return { report, evidence: output };
  } finally {
    globalThis.fetch = savedFetch;
    try { await window.finalize(); }
    finally { if (session) { try { if (!session.isIdle) await session.abort(); } finally { session.dispose(); } } }
  }
}

if (isMain(import.meta.url)) {
  try { const options = parseStage6NativeAcceptanceOptions(process.argv.slice(2)); console.log(JSON.stringify(await runStage6NativeAcceptance(options), null, 2)); }
  catch { console.error("stage6-native-acceptance-failed"); process.exitCode = 1; }
}
