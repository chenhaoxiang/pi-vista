import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { isAbsolute, join, normalize } from "node:path";
import { pathToFileURL } from "node:url";
import { execFile } from "node:child_process";
import { promisify, types } from "node:util";
import { PAIR_CASES, PAIR_SOURCE_SHA, caseTruth, expectedFixtureContract, pairedFixture } from "./paired-evaluation-data.mjs";
import { admitStage6Run, snapshotStage6Context } from "./stage6-admission.mjs";
import { admitK1, snapshotHistoryContext } from "./stage6-k1-admission.mjs";
import { buildK1HistoryContext } from "./stage6-k1-history-context.mjs";
import { classifyDecisionOutcome, referenceDecision, STRICT_DECISION_SCHEMA } from "./stage6-decision-tool.mjs";
import { captureStage6Profile } from "./stage6-host-admission.mjs";
import { openStage6Pilot } from "./stage6-pilot-coordinator.mjs";
import { OBSERVED_INSTALLED_FORK_1_1_0_FORK_1_CONTRACT, bindStage6Provenance, matchSdkContract, observeReadonlyBrokerMetadata, observeSdkInstallation } from "./stage6-sdk-provenance.mjs";
import { ROOT, commandEnvironment, createRunDirectory } from "./release-utils.mjs";

const hash = value => createHash("sha256").update(value).digest("hex");
const SHA = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u;
const K1_WINDOW_BINDING = Object.freeze({ repo: "pi-vista", source_sha: PAIR_SOURCE_SHA, policy_version: "stage6-synthetic-host-1", env_fingerprint: hash("synthetic-environment") });
export const SYNTHETIC_FAULTS = Object.freeze(["semantic-mismatch", "schema-invalid", "provider-error", "cancelled", "timeout", "deadline", "stream-disconnected", "profile-drift", "request-guard", "session-budget"]);
const refuse = () => { throw Error("stage6-synthetic-host-refused"); };
function k1Refusal(phase, reason_code, details = {}) {
  const error = Error("stage6-k1-host-preview-refused"); error.k1_phase = phase; error.k1_reason_code = reason_code;
  if (phase === "input" || phase === "metadata-admission") Object.assign(error, { profile_fixture_prepared: false, metadata_fixture_prepared: false, window_created: false, session_count: 0, pretransport_attempts: 0, fetch_count: 0 });
  Object.assign(error, details); return error;
}
function snapshotK1Ports(input) {
  if (input === undefined) return null;
  if (!input || typeof input !== "object" || Array.isArray(input) || types.isProxy(input) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(input)) || Reflect.ownKeys(input).length !== 1) throw k1Refusal("input", "stage6-k1-options-refused");
  const descriptor = Object.getOwnPropertyDescriptor(input, "prepareK1Plan");
  if (!descriptor || !Object.hasOwn(descriptor, "value") || typeof descriptor.value !== "function" || types.isProxy(descriptor.value)) throw k1Refusal("input", "stage6-k1-options-refused");
  return Object.freeze({ prepareK1Plan: descriptor.value });
}
function snapshotK1SubjectBinding(historyReadback) {
  try {
    const document = Object.getOwnPropertyDescriptor(historyReadback, "document")?.value;
    const content = document && Object.getOwnPropertyDescriptor(document, "content")?.value;
    if (typeof content !== "string") throw Error();
    const experience = JSON.parse(content).experience;
    const result = {};
    for (const key of ["repo", "source_sha", "policy_version", "env_fingerprint"]) {
      const descriptor = experience && Object.getOwnPropertyDescriptor(experience, key);
      if (!descriptor || !Object.hasOwn(descriptor, "value") || typeof descriptor.value !== "string") throw Error();
      result[key] = descriptor.value;
    }
    return Object.freeze(result);
  } catch { throw k1Refusal("input", "stage6-k1-subject-binding-mismatch"); }
}
function snapshotK1CallbackResult(input) {
  if (!input || typeof input !== "object" || Array.isArray(input) || types.isProxy(input) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(input)) || Reflect.ownKeys(input).length !== 2) throw k1Refusal("input", "stage6-k1-input-refused");
  const result = {};
  for (const key of ["historyReadback", "localCompiledContext"]) {
    const descriptor = Object.getOwnPropertyDescriptor(input, key);
    if (!descriptor || !Object.hasOwn(descriptor, "value") || descriptor.value === undefined || types.isProxy(descriptor.value)) throw k1Refusal("input", "stage6-k1-input-refused");
    result[key] = descriptor.value;
  }
  return Object.freeze(result);
}
function waitK1Preparation(promise, timeout_ms) {
  return new Promise((resolve, reject) => {
    let done = false;
    const finish = (value, error) => { if (done) return; done = true; clearTimeout(timer); if (error) reject(error); else resolve(value); };
    const timer = setTimeout(() => finish(null, k1Refusal("input", "stage6-k1-preparation-timeout")), timeout_ms);
    // A timeout bounds this wait, not JS or trusted-callback side effects. Late
    // settlement is consumed and can never continue host setup.
    Promise.prototype.then.call(promise, value => {
      try { finish({ snapshot: snapshotK1CallbackResult(value) }); } catch { finish(null, k1Refusal("input", "stage6-k1-input-refused")); }
    }, () => finish(null, k1Refusal("input", "stage6-k1-input-refused")));
  });
}
function safeK1Admission(value) {
  return Object.freeze({ status: value.status, reason_code: value.reason_code, model_calls: value.model_calls,
    started_model_calls: value.started_model_calls, verification: value.verification, authorization: value.authorization, executable: value.executable });
}
function prepareK1Rows(history, baseContext, options) {
  const dto = snapshotHistoryContext(history), context = snapshotStage6Context(baseContext);
  if (!dto || dto.subject_source_sha !== PAIR_SOURCE_SHA || context.subject_source_sha !== PAIR_SOURCE_SHA) throw k1Refusal("input", "stage6-k1-subject-source-mismatch");
  if (context.subject_history_digest !== dto.content_digest) throw k1Refusal("metadata-admission", "history-mismatch");
  const guidedContext = Object.freeze({ ...context, arm: "guided", guidance_mode: "historical-observed", guidance_digest: dto.context_digest, subject_history_digest: dto.content_digest });
  const baselineContext = Object.freeze({ ...context, arm: "baseline", guidance_mode: "none", guidance_digest: null, subject_history_digest: dto.content_digest });
  const budget = { max_requests: options.max_requests, max_per_session: 2, deadline_ms: options.deadline_ms ?? 120_000, k: 1 };
  return Object.freeze(PAIR_CASES.flatMap(case_id => [
    Object.freeze({ case_id, arm: "baseline", context: baselineContext, expected: baselineContext, history: null, budget }),
    Object.freeze({ case_id, arm: "guided", context: guidedContext, expected: guidedContext, history: dto, budget }),
  ]));
}
/** Pure plan data, not an issued Stage6 admission/window/budget. */
export function admitSyntheticK1Plan(history, context, provenance, max_requests, deadline_ms) {
  const inputs = prepareK1Rows(history, context, { max_requests, deadline_ms });
  return Object.freeze(inputs.map(row => {
    const admission = admitK1({ context: row.context, expected: row.expected, provenance, history: row.history, budget: row.budget, model_calls: 0 });
    return Object.freeze({ case_id: row.case_id, arm: row.arm, context: row.context, admission });
  }));
}
export function snapshotSyntheticHostOptions(input) {
  if (!input || typeof input !== "object" || Array.isArray(input) || types.isProxy(input) || ![Object.prototype, null].includes(Object.getPrototypeOf(input))) refuse();
  const keys = Reflect.ownKeys(input);
  if (keys.length !== 3 && keys.length !== 4 || keys.some(key => !["sdk", "source_sha", "max_requests", "deadline_ms"].includes(key))) refuse();
  const result = {};
  for (const key of ["sdk", "source_sha", "max_requests"]) { const p = Object.getOwnPropertyDescriptor(input, key); if (!p || !Object.hasOwn(p, "value")) refuse(); result[key] = p.value; }
  if (Object.hasOwn(input, "deadline_ms")) { const p = Object.getOwnPropertyDescriptor(input, "deadline_ms"); if (!p || !Object.hasOwn(p, "value") || !Number.isSafeInteger(p.value) || p.value < 1000 || p.value > 120_000) refuse(); result.deadline_ms = p.value; }
  const [major, minor] = process.versions.node.split(".").map(Number);
  if (!(major > 22 || major === 22 && minor >= 19) || typeof result.sdk !== "string" || !isAbsolute(result.sdk) || normalize(result.sdk) !== result.sdk || /[\u0000-\u001f\u007f]/u.test(result.sdk) || typeof result.source_sha !== "string" || !SHA.test(result.source_sha) || !Number.isSafeInteger(result.max_requests) || result.max_requests < 1 || result.max_requests > 16) refuse();
  return Object.freeze(result);
}
async function sourceBinding(expected) {
  const exec = promisify(execFile), options = { cwd: ROOT, env: commandEnvironment(), shell: false, timeout: 5000, maxBuffer: 8192 };
  const head = await exec("git", ["rev-parse", "HEAD"], options);
  const state = await exec("git", ["status", "--porcelain=v1", "--untracked-files=normal"], options);
  if (head.stdout.trim() !== expected || state.stdout.trim() !== "") throw Error("stage6-synthetic-source-mismatch");
  return hash(await readFile(new URL(import.meta.url)));
}
const emptyResources = sdk => ({ getExtensions: () => ({ extensions: [], errors: [], runtime: sdk.createExtensionRuntime() }), getSkills: () => ({ skills: [], diagnostics: [] }), getPrompts: () => ({ prompts: [], diagnostics: [] }), getThemes: () => ({ themes: [], diagnostics: [] }), getAgentsFiles: () => ({ agentsFiles: [] }), getSystemPrompt: () => "Stage6 synthetic SDK harness only", getSystemPromptSource: () => undefined, getAppendSystemPrompt: () => [], getAppendSystemPromptSources: () => [], extendResources() {}, async reload() {} });
const projection = session => ({ model: JSON.parse(JSON.stringify(session.model)), thinking: session.thinkingLevel, tools: [...session.getActiveToolNames()], prompt: session.systemPrompt });
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
function sseText(model, name, args, sequence) {
  const chunk = { id: "synthetic-stage6", object: "chat.completion.chunk", created: 1, model, choices: [{ index: 0, delta: { role: "assistant", tool_calls: [{ index: 0, id: `synthetic-${sequence}`, type: "function", function: { name, arguments: JSON.stringify(args) } }] }, finish_reason: null }] };
  const ending = { id: "synthetic-stage6", object: "chat.completion.chunk", created: 1, model, choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } };
  return `data: ${JSON.stringify(chunk)}\n\ndata: ${JSON.stringify(ending)}\n\ndata: [DONE]\n\n`;
}
function sse(model, name, args, sequence) { return new Response(sseText(model, name, args, sequence), { status: 200, headers: { "Content-Type": "text/event-stream" } }); }

/** Explicit model-free host. There is no network fall-through from this fetch seam. */
export async function createSyntheticSdkHost(input, k1Options) {
  const ports = snapshotK1Ports(k1Options);
  const options = snapshotSyntheticHostOptions(input);
  let k1 = null;
  if (ports) {
    try {
      let raw = ports.prepareK1Plan();
      if (types.isProxy(raw)) throw Error();
      const prepared = types.isPromise(raw) ? await waitK1Preparation(raw, options.deadline_ms ?? 120_000) : { snapshot: snapshotK1CallbackResult(raw) };
      const snapshot = prepared.snapshot;
      const dto = buildK1HistoryContext({ history: snapshot.historyReadback, context: snapshot.localCompiledContext });
      const subject = snapshotK1SubjectBinding(snapshot.historyReadback);
      if (dto.subject_source_sha !== PAIR_SOURCE_SHA || Object.keys(K1_WINDOW_BINDING).some(key => subject[key] !== K1_WINDOW_BINDING[key])) throw k1Refusal("input", dto.subject_source_sha !== PAIR_SOURCE_SHA ? "stage6-k1-subject-source-mismatch" : "stage6-k1-subject-binding-mismatch");
      k1 = Object.freeze({ history: dto, guidance: Object.getOwnPropertyDescriptor(snapshot.localCompiledContext, "content").value });
    } catch (error) {
      const reason = !types.isProxy(error) && error !== null && typeof error === "object" ? Object.getOwnPropertyDescriptor(error, "k1_reason_code") : null;
      if (reason && Object.hasOwn(reason, "value") && ["stage6-k1-subject-source-mismatch", "stage6-k1-subject-binding-mismatch", "stage6-k1-preparation-timeout"].includes(reason.value)) throw error;
      throw k1Refusal("input", "stage6-k1-input-refused");
    }
  }
  const runnerDigest = await sourceBinding(options.source_sha);
  const observed = await observeSdkInstallation(options.sdk), sdkMatch = matchSdkContract(observed, OBSERVED_INSTALLED_FORK_1_1_0_FORK_1_CONTRACT);
  if (!sdkMatch.matched) throw Error("stage6-synthetic-sdk-mismatch");
  const output = await createRunDirectory("stage6-synthetic-host"), profileDirectory = join(output, "profile"); await mkdir(profileDirectory, { mode: 0o700 });
  for (const name of ["auth.json", "models.json", "settings.json"]) await writeFile(join(profileDirectory, name), "{}", { mode: 0o600 });
  const target = join(profileDirectory, "synthetic-key"); await writeFile(target, "NOT_A_REAL_CREDENTIAL", { mode: 0o600 });
  const command = `cat ${target}`, guidance = k1?.guidance ?? "Synthetic observed-only context: compare source, environment and required metadata; this is not LOCAL history or permission.", historyDigest = k1?.history.content_digest ?? hash(guidance);
  const context = { provider: "stage6-matrix-fixture", model: "fixture", thinking: "high", sdk: observed.version, arm: "baseline", guidance_mode: "none", guidance_digest: null, harness_source_sha: options.source_sha, subject_source_sha: PAIR_SOURCE_SHA, subject_history_digest: historyDigest, broker_digest: hash(command) };
  const bindings = { run_id: "stage6-synthetic-host", ...K1_WINDOW_BINDING, harness_source_sha: options.source_sha, context_digest: null, artifact_digest: runnerDigest };
  const provenance = async () => bindStage6Provenance({ sdk: matchSdkContract(await observeSdkInstallation(options.sdk), OBSERVED_INSTALLED_FORK_1_1_0_FORK_1_CONTRACT), broker: await observeReadonlyBrokerMetadata({ profile_directory: profileDirectory, provider: context.provider, command, expected_command_sha256: context.broker_digest }), subject_source_sha: PAIR_SOURCE_SHA, history_digest: historyDigest, bindings });
  const expectedProvenance = await provenance();
  let k1Plan = null;
  if (k1) {
    k1Plan = admitSyntheticK1Plan(k1.history, context, expectedProvenance, options.max_requests, options.deadline_ms ?? 120_000);
    const rejected = k1Plan.find(row => row.admission.status !== "metadata-admitted");
    const reason = rejected?.admission.reason_code ?? (options.max_requests !== k1Plan.length * 2 ? "stage6-k1-plan-capacity-mismatch" : null);
    if (reason) {
      const details = { profile_fixture_prepared: true, metadata_fixture_prepared: true, broker_observed: true, window_created: false, session_count: 0, pretransport_attempts: 0, fetch_count: 0,
        admission: rejected ? safeK1Admission(rejected.admission) : null, harness_source_sha: options.source_sha, host_sha256: runnerDigest, sdk_version: observed.version, node: process.version };
      await writeFile(join(output, "k1-refusal.json"), JSON.stringify({ phase: "metadata-admission", reason_code: reason, ...details, observation_scope: "host-control-flow-not-callback-or-OS-effects", verification: "metadata-only", authorization: "none", executable: false }, null, 2) + "\n");
      throw k1Refusal("metadata-admission", reason, details);
    }
  }
  const window = await openStage6Pilot({ profileDirectory, context, expected: context, bindings, expectedProvenance, model_calls: 0, max_requests: options.max_requests, deadline_ms: options.deadline_ms ?? 120_000 }, { captureProfile: null, collectProvenance: provenance }); assert.equal(window.status, "admitted");
  const sdk = await import(pathToFileURL(join(options.sdk, "dist/index.js")).href), nativeRead = sdk.createReadTool(output);
  let fetchCount = 0, responses = 0, credentialReads = 0, active, closed = false, finishPromise;
  const sessions = [], rows = [], nativeAgents = new Set(), streams = [], savedFetch = globalThis.fetch;
  let rowRunning = false;
  const k1Started = new Set();
  globalThis.fetch = async (url, init) => {
    assert.equal(String(url), "http://127.0.0.1:1/chat/completions"); assert.ok(active && !closed);
    fetchCount++; active.fetches++; const payload = JSON.parse(init.body); assert.equal(payload.model, context.model); assert.deepEqual(payload.tools.map(tool => tool.function.name).sort(), ["paired_inspect_metadata", "stage6_decision"]);
    if (k1) {
      const user = payload.messages.filter(message => message.role === "user").at(-1);
      const text = typeof user?.content === "string" ? user.content : user?.content?.filter(part => part.type === "text").map(part => part.text).join("");
      const task = `Inspect synthetic metadata case ${active.case_id} and emit stage6_decision.`;
      assert.equal(typeof text, "string"); assert.equal(hash(text), hash(active.arm === "guided" ? `${task}\n${guidance}` : task));
      active.requestContractChecks++;
    }
    if (["cancelled", "timeout", "deadline"].includes(active.fault)) {
      assert.ok(init.signal); active.fetchSignal = init.signal;
      const row = active;
      return new Promise((resolve, reject) => {
        init.signal.addEventListener("abort", () => { row.abortObserved = true; row.abortBarrier.resolve(); }, { once: true });
        row.timeoutReject = () => { row.timeoutRejected = true; reject(new DOMException("synthetic response timeout", "TimeoutError")); };
        row.abortResponseResolve = () => { responses++; resolve(new Response(sseText(context.model, "stage6_decision", { case_id: row.case_id, ...caseTruth(row.case_id) }, 999), { status: 200, headers: { "Content-Type": "text/event-stream" } })); };
        row.started.resolve();
      });
    }
    if (active.fault === "stream-disconnected") { responses++; return new Response(new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode("data: {\"partial\":true}\n\n")); controller.error(new Error("synthetic stream disconnected")); } }), { status: 200, headers: { "Content-Type": "text/event-stream" } }); }
    if (active.fault === "provider-error") { responses++; return new Response('{"error":{"message":"synthetic provider error","type":"invalid_request_error"}}', { status: 400, headers: { "Content-Type": "application/json" } }); }
    const first = active.fetches === 1 || active.fault === "session-budget", name = first ? "paired_inspect_metadata" : "stage6_decision";
    let args = first ? { case_id: active.case_id } : referenceDecision(active.case_id, active.inspected, active.expected);
    if (!first && active.fault === "semantic-mismatch") args = { case_id: active.case_id, decision: "reject", reason_code: "source-mismatch" };
    if (!first && active.fault === "schema-invalid") args = { ...args, unexpected: true };
    responses++; return sse(context.model, name, args, fetchCount);
  };
  return Object.freeze({
    output, sdk_version: observed.version,
    async runRow(case_id, arm, fault = null) {
      if (closed || rowRunning || !PAIR_CASES.includes(case_id) || !["baseline", "guided"].includes(arm) || fault !== null && ![...SYNTHETIC_FAULTS, "window-budget"].includes(fault)) refuse();
      if (k1Plan) {
        const key = `${case_id}/${arm}`;
        if (fault !== null || k1Started.has(key)) throw k1Refusal("row", "stage6-k1-row-refused");
        k1Started.add(key);
      }
      rowRunning = true;
      const metadata = pairedFixture(case_id, PAIR_SOURCE_SHA, bindings.env_fingerprint), expected = expectedFixtureContract(PAIR_SOURCE_SHA, bindings.env_fingerprint), metadataFile = join(output, `row-${rows.length}.json`); await writeFile(metadataFile, JSON.stringify(metadata));
      active = { case_id, arm, fault, expected, requestContractChecks: 0, fetches: 0, inspected: null, invocation: null, inspectorExecutions: 0, decisionExecutions: 0, abortObserved: false, started: deferred(), abortBarrier: deferred(), abortResponseResolve: null, messageEnds: 0, toolEnds: 0 };
      const row = active, attemptsBefore = window.statusSnapshot().pretransport_attempts;
      const runtime = await sdk.ModelRuntime.create({ modelsPath: null, allowModelNetwork: false, refreshOnCreate: false, credentials: { async read() { credentialReads++; return undefined; }, async list() { return []; }, async modify() { assert.fail("credential write"); }, async delete() { assert.fail("credential delete"); } }, modelsStore: { async read() { return undefined; }, async write() {}, async delete() {} } });
      runtime.registerProvider(context.provider, { api: "openai-completions", baseUrl: "http://127.0.0.1:1", apiKey: "synthetic-no-network", models: [{ id: context.model, name: context.model, reasoning: true, input: ["text"], contextWindow: 8192, maxTokens: 128, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }] });
      const customTools = [{ name: "paired_inspect_metadata", label: "Synthetic inspector", description: "Read fixed synthetic metadata", parameters: { type: "object", properties: { case_id: { type: "string", enum: [case_id] } }, required: ["case_id"], additionalProperties: false }, async execute(id, args, signal) { assert.equal(args.case_id, case_id); row.inspectorExecutions++; const result = await nativeRead.execute(id, { path: metadataFile }, signal); row.inspected = JSON.parse(result.content[0].text); return result; } }, { name: "stage6_decision", label: "Synthetic decision", description: "Emit terminating structured decision", parameters: STRICT_DECISION_SCHEMA, async execute(_id, args) { row.decisionExecutions++; row.invocation = { name: "stage6_decision", arguments: args }; return { content: [{ type: "text", text: "synthetic decision" }], details: args, terminate: true }; } }];
      const { session } = await sdk.createAgentSession({ cwd: output, agentDir: output, modelRuntime: runtime, model: runtime.getModel(context.provider, context.model), thinkingLevel: context.thinking, tools: ["paired_inspect_metadata", "stage6_decision"], customTools, resourceLoader: emptyResources(sdk), sessionManager: sdk.SessionManager.inMemory(output), settingsManager: sdk.SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: false }, cacheWarming: "off", enableAnalytics: false, enableInstallTelemetry: false }, { projectTrusted: false }) });
      assert.ok(!nativeAgents.has(session.agent)); nativeAgents.add(session.agent); sessions.push(session);
      const before = projection(session), original = session.agent.streamFunction, profile = await captureStage6Profile(profileDirectory); streams.push({ session, original });
      const preparedK1 = k1Plan?.find(row => row.case_id === case_id && row.arm === arm);
      const rowContext = preparedK1?.context ?? { ...context, arm, guidance_mode: arm === "guided" ? "historical-observed" : "none", guidance_digest: arm === "guided" ? historyDigest : null };
      const admission = admitStage6Run({ ...rowContext, profile_before: profile, profile_after: profile, model_calls: 0 }, rowContext);
      const binding = window.bindSession(session, admission, fault === "request-guard" ? { requestGuard() { throw Error("synthetic-request-guard-refused"); } } : {});
      session.subscribe(event => { if (event.type === "message_end") { row.messageEnds++; if (event.message.role === "assistant") for (const item of event.message.content) if (item.type === "toolCall" && item.name === "stage6_decision") row.invocation = { name: item.name, arguments: item.arguments }; } if (event.type === "tool_execution_end") row.toolEnds++; });
      const task = `Inspect synthetic metadata case ${case_id} and emit stage6_decision.`, prompt = session.prompt(arm === "guided" ? `${task}\n${guidance}` : task, { expandPromptTemplates: false });
      if (["cancelled", "timeout", "deadline"].includes(fault)) {
        let timer;
        try { await Promise.race([row.started.promise, new Promise((_, reject) => { timer = setTimeout(() => reject(Error("stage6-synthetic-barrier-deadline")), 10_000); })]); }
        finally { clearTimeout(timer); }
        if (fault === "timeout") row.timeoutReject();
        else {
          if (fault === "deadline") await new Promise(done => setTimeout(done, (options.deadline_ms ?? 120_000) + 100));
          const abort = session.abort(); await row.abortBarrier.promise;
          row.abortResponseResolve(); row.lateBodySent = true; await abort;
        }
      }
      await prompt; await session.waitForIdle();
      const last = session.messages.filter(message => message.role === "assistant").at(-1), stopped = last?.stopReason;
      if (["cancelled", "deadline"].includes(fault)) { assert.equal(row.abortObserved, true); assert.equal(stopped, "aborted"); await new Promise(done => setImmediate(done)); assert.equal(row.lateBodySent, true); assert.equal(row.decisionExecutions, 0); }
      if (fault === "timeout") { assert.equal(row.timeoutRejected, true); assert.equal(stopped, "error"); }
      if (["provider-error", "request-guard", "session-budget", "window-budget", "stream-disconnected"].includes(fault)) assert.equal(stopped, "error");
      const status = ["cancelled", "timeout", "deadline", "stream-disconnected"].includes(fault) ? fault : fault === "provider-error" ? "provider-error" : "completed";
      const decision = classifyDecisionOutcome({ case_id, status, call: row.invocation, metadata: row.inspected ?? metadata, expected });
      if (fault === null || fault === "profile-drift") { assert.equal(decision.outcome, "decision-valid"); assert.deepEqual({ decision: decision.decision, reason_code: decision.reason_code }, caseTruth(case_id)); assert.equal(row.fetches, 2); }
      if (fault === "semantic-mismatch") assert.equal(decision.outcome, "semantic-mismatch");
      if (fault === "schema-invalid") { assert.equal(decision.outcome, "schema-invalid"); assert.equal(row.decisionExecutions, 0); }
      if (fault === "cancelled") assert.equal(decision.outcome, "cancelled");
      if (["timeout", "deadline"].includes(fault)) assert.equal(decision.outcome, fault);
      if (fault === "stream-disconnected") assert.equal(decision.outcome, "stream-disconnected");
      if (fault === "request-guard") assert.equal(row.fetches, 0);
      if (fault === "window-budget" && attemptsBefore === options.max_requests) { assert.equal(row.fetches, 0); assert.equal(window.statusSnapshot().pretransport_attempts, attemptsBefore); }
      assert.deepEqual(projection(session), before);
      if (fault === "profile-drift") await writeFile(join(profileDirectory, "auth.json"), '{"synthetic_drift":true}', { mode: 0o600 });
      if (fault === null || fault === "profile-drift") { assert.ok(row.messageEnds >= 2); assert.equal(row.toolEnds, 2); }
      const failureOrigin = ["request-guard", "session-budget", "window-budget"].includes(fault) ? "local-coordinator-rejection" : fault === "stream-disconnected" ? "provider-stream-disconnected" : fault === "provider-error" ? "provider-error" : fault;
      const result = Object.freeze({ case_id, arm, fault, failure_origin: failureOrigin, outcome: fault === "request-guard" ? "request-guard-rejected" : fault === "session-budget" ? "session-budget-exhausted" : fault === "window-budget" ? "window-budget-exhausted" : decision.outcome, decision_outcome: failureOrigin === "local-coordinator-rejection" ? null : decision.outcome, decision_parsed: failureOrigin === "local-coordinator-rejection" ? false : decision.decision_parsed, execution_stop: stopped, pretransport_attempts: binding.status().session_attempts, intercepted_fetch: row.fetches, inspector_executions: row.inspectorExecutions, decision_executions: row.decisionExecutions, message_end_events: row.messageEnds, tool_execution_end_events: row.toolEnds, abort_signal_observed: row.abortObserved, late_sse_body_sent: row.lateBodySent === true, task_digest: hash(task), guidance_scope: arm === "guided" ? k1 ? "synthetic-LOCAL-fixture-not-actual-history" : "synthetic-guided-arm-not-LOCAL-readback" : "none", guidance_digest: arm === "guided" ? k1?.history.context_digest ?? historyDigest : null,
        ...(preparedK1 ? { k1_admission: safeK1Admission(preparedK1.admission), request_contract_checks: row.requestContractChecks } : {}) });
      rows.push(result); rowRunning = false; return result;
    },
    finish() {
      if (finishPromise) return finishPromise;
      closed = true; globalThis.fetch = savedFetch;
      finishPromise = (async () => {
        try { const receipt = await window.finalize(); for (const entry of streams) assert.equal(entry.session.agent.streamFunction, entry.original); assert.equal(await sourceBinding(options.source_sha), runnerDigest); const result = Object.freeze({ schema: "stage6-synthetic-sdk-host/1", harness_source_sha: options.source_sha, host_sha256: runnerDigest, sdk_version: observed.version, node: process.version, rows: Object.freeze(rows), fresh_agents: nativeAgents.size, intercepted_fetch: fetchCount, synthetic_responses: responses, credential_store_read_attempts: credentialReads, receipt, ...(k1Plan ? { observation_scope: "synthetic-transport-and-host-counters-not-callback-effects", k1_plan: Object.freeze(k1Plan.map(row => Object.freeze({ case_id: row.case_id, arm: row.arm, history_status: row.admission.history_status, history_digest: row.admission.history?.content_digest ?? null, context_digest: row.admission.history?.context_digest ?? null, admission: safeK1Admission(row.admission) }))) } : {}), evaluation_status: "not-evaluated", declared_scope: { real_model_calls: 0, bank_calls: 0, credential_bytes_read: false }, authorization: "none", executable: false }); await writeFile(join(output, "report.json"), JSON.stringify(result, null, 2)+"\n"); return result; }
        finally { for (const session of sessions) { try { if (!session.isIdle) await session.abort(); } finally { session.dispose(); } } }
      })();
      return finishPromise;
    },
  });
}
