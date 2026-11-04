import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile, realpath } from "node:fs/promises";
import { dirname, join, isAbsolute, normalize, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { EventStore } from "@pi-vista/core";
import { OWNER_RESULT_EVENT, WORK_OBSERVATION_QUERY_EVENT, WORK_OBSERVATION_REPLY_PREFIX, WORK_OBSERVATION_CHANGED_EVENT } from "./pi-work-observer.mjs";
import { ROOT, commandEnvironment, createRunDirectory, isMain } from "./release-utils.mjs";
const exec = promisify(execFile), sha = x => createHash("sha256").update(x).digest("hex");

/** Isolated actual SDK/discovery/native tool dispatch. Synthetic data by default.
 * Explicit ownerReport reads exactly that caller-selected file; no discovery,
 * history, credential, model transport or other global extension is loaded.
 */
export async function runWorkObserverSdk({ sdkRoot, entry, ownerReport, todoEntry } = {}) {
  for (const value of [sdkRoot, entry, ...(ownerReport ? [ownerReport] : []), ...(todoEntry ? [todoEntry] : [])]) {
    if (typeof value !== "string" || !isAbsolute(value) || normalize(value) !== value || value.includes("\0")) throw Error("invalid-work-observer-sdk-path");
  }
  const output = await createRunDirectory("work-observer-sdk"), results = [];
  for (const scenario of ["normal", "old-session", "storage-fault"]) {
    const fixture = join(output, scenario); await mkdir(fixture);
    const env = { ...commandEnvironment(), HOME: fixture, TMPDIR: fixture };
    const args = [import.meta.filename, `--sdk=${sdkRoot}`, `--entry=${entry}`, `--fixture=${fixture}`, `--scenario=${scenario}`];
    if (ownerReport) args.push(`--report=${ownerReport}`);
    if (todoEntry) args.push(`--todo=${todoEntry}`);
    try {
      const value = await exec(process.execPath, args, { cwd: ROOT, env, timeout: 60_000, maxBuffer: 1024 * 1024 });
      await writeFile(join(output, `${scenario}.stdout.json`), value.stdout); await writeFile(join(output, `${scenario}.stderr.log`), value.stderr);
      results.push(JSON.parse(value.stdout));
    } catch (error) {
      await writeFile(join(output, `${scenario}.stdout.json`), error.stdout ?? ""); await writeFile(join(output, `${scenario}.stderr.log`), error.stderr ?? "");
      throw Error(`work-observer-sdk-failed:${scenario}; evidence=${output}`);
    }
  }
  const report = { status: "passed", scope: ownerReport ? "explicit-owner-file-native-sdk-readback" : "synthetic-native-sdk-integration", modelRequests: 0,
    defaultInstallation: false, hindsightChanges: 0, entrySha256: sha(await readFile(entry)), results };
  await writeFile(join(output, "report.json"), JSON.stringify(report, null, 2) + "\n"); return { evidence: output, report };
}
async function child({ sdk, entry, fixture, scenario, report, todo }) {
  assert.ok(fixture.startsWith(join(ROOT, "tmp/release-contract") + sep));
  assert.equal(normalize(fixture), fixture); assert.equal(await realpath(fixture), fixture);
  assert.equal(process.env.HOME, fixture);
  assert.ok(["normal", "old-session", "storage-fault"].includes(scenario));
  const api = await import(pathToFileURL(join(sdk, "dist/index.js")));
  const { AssistantMessageEventStream } = await import(pathToFileURL(join(dirname(sdk), "pi-ai/dist/utils/event-stream.js")));
  const events = api.createEventBus(), extensions = join(fixture, "extensions"); await mkdir(extensions);
  await writeFile(join(extensions, "pi-vista-work.ts"), await readFile(entry), { flag: "wx", mode: 0o600 });
  const body = report ? await readFile(report) : Buffer.from("SYNTHETIC_OWNER_REPORT\n");
  const reportPath = join(fixture, "owner-report.txt"); await writeFile(reportPath, body);
  const digest = sha(body), sessionManager = api.SessionManager.inMemory(ROOT);
  if (scenario === "old-session") sessionManager.getHeader().timestamp = "2000-01-01T00:00:00.000Z";
  if (scenario === "storage-fault") { await mkdir(join(fixture, ".pi")); await writeFile(join(fixture, ".pi/vista"), "not a directory"); }
  const modelRuntime = await api.ModelRuntime.create({ modelsPath: null, allowModelNetwork: false, refreshOnCreate: false,
    credentials: { async read() {}, async list() { return []; }, async modify() { assert.fail("credential write"); }, async delete() { assert.fail("credential delete"); } },
    modelsStore: { async read() {}, async write() {}, async delete() {} } });
  let transport = 0; for (const method of ["stream", "streamSimple", "complete", "completeSimple"]) modelRuntime[method] = () => { transport++; throw Error("unexpected model transport"); };
  modelRuntime.registerProvider("work-observer-fixture", { api: "openai-completions", baseUrl: "http://127.0.0.1:1", apiKey: "synthetic", models: [{ id: "fixture", name: "fixture", reasoning: true, input: ["text"], contextWindow: 8192, maxTokens: 128, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }] });
  const settingsManager = api.SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: false }, cacheWarming: "off", enableAnalytics: false, enableInstallTelemetry: false }, { projectTrusted: false });
  const views = [], snapshots = [], originals = [], observationNotifications = [];
  events.on(WORK_OBSERVATION_CHANGED_EVENT, value => observationNotifications.push(value));
  let currentContext, queryCount = 0;
  function queryObservations() {
    const requestId = `sdk_${++queryCount}`, hostSessionId = sessionManager.getSessionId(); let response;
    const unsubscribe = events.on(WORK_OBSERVATION_REPLY_PREFIX + requestId, value => { response = value; });
    try { events.emit(WORK_OBSERVATION_QUERY_EVENT, { version: 1, requestId, hostSessionId }); }
    finally { unsubscribe(); }
    assert.equal(response?.version, 1); assert.equal(response?.requestId, requestId); assert.equal(response.snapshot.hostSessionId, hostSessionId);
    return response.snapshot;
  }
  const resources = new api.DefaultResourceLoader({ cwd: ROOT, agentDir: fixture, eventBus: events, settingsManager, additionalExtensionPaths: todo ? [todo] : [],
    noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true, systemPrompt: "Synthetic dispatch, no model transport",
    extensionFactories: [pi => {
      pi.on("session_start", (_event, ctx) => { currentContext = ctx; });
      if (!todo) pi.registerTool({ name: "todo", label: "Synthetic Todo", description: "Synthetic native Todo structure", parameters: { type: "object", properties: { action: { type: "string" }, subject: { type: "string" }, id: { type: "number" }, status: { type: "string" } }, required: ["action"] },
        async execute(_id, args) { return { content: [{ type: "text", text: "PRIVATE_TODO_BODY" }], details: { action: args.action, tasks: [{ id: 1, status: args.action === "create" ? "pending" : "completed", subject: "PRIVATE_SUBJECT" }], nextId: 2 } }; } });
      pi.on("tool_execution_end", event => {
        if (event.toolName !== "read") return;
        const id = currentContext.sessionManager.getSessionId();
        const binding = { workRef: { owner: "example/host-report", kind: "task", key: "existing-report" }, stageId: "report", runId: "report-reader", sessionId: id, revision: 0 };
        const reference = { binding, resultRef: "existing-owner-report" };
        pi.events.emit(OWNER_RESULT_EVENT, { hostSessionId: id, reference, async readOwner() {
          const original = await readFile(reportPath); assert.equal(sha(original), digest); originals.push(digest);
          const time = Date.now(), observedAt = new Date(time).toISOString(), freshUntil = new Date(time + 60_000).toISOString();
          const record = { evidence_id: "original-report", run_id: binding.runId, kind: "readback", state: "validated", source_ref: "existing-owner-report",
            content_digest: digest, claims: ["report-original-matched"], observed_at: observedAt, fresh_until: freshUntil, counterevidence_refs: [], redaction_profile: "metadata-only" };
          return { binding, sourceKind: "report", sourceRef: "existing-owner-report", disposition: "accepted", observedAt, freshUntil,
            requiredEvidence: [{ evidenceId: "original-report", kind: "readback", sourceRef: "existing-owner-report", claims: ["report-original-matched"] }], evidence: [{ binding, record }], requiredEffects: [] };
        }, onObservation: value => views.push(value) });
      });
      pi.registerCommand("work-fixture-status", { description: "fixture", handler: async () => {} });
      pi.on("agent_settled", () => {
        const command = pi.getCommands().find(c => c.name === "vista-work-status");
        snapshots.push(Boolean(command));
      });
    }] });
  await resources.reload(); assert.deepEqual(resources.getExtensions().errors, []);
  const { session } = await api.createAgentSession({ cwd: ROOT, agentDir: fixture, resourceLoader: resources, sessionManager, settingsManager,
    modelRuntime, model: modelRuntime.getModel("work-observer-fixture", "fixture"), thinkingLevel: "high", tools: ["read", "todo"], eventBus: events });
  const errors = [];
  try {
    await session.bindExtensions({ mode: "json", onError: value => errors.push(value) });
    const before = { model: session.model, thinking: session.thinkingLevel, tools: session.getActiveToolNames(), prompt: session.systemPrompt };
    const initialSnapshot = queryObservations();
    assert.equal(initialSnapshot.coverage, scenario === "old-session" ? "not-applicable" : "not-observed");
    let rounds = 0;
    session.agent.streamFunction = () => {
      const round = rounds++, stream = new AssistantMessageEventStream();
      const content = round === 0 ? [{ type: "toolCall", id: "todo-call", name: "todo", arguments: { action: "create", subject: "PRIVATE_SUBJECT" } }] : round === 1 ? [{ type: "toolCall", id: "read-call", name: "read", arguments: { path: reportPath } }] : round === 2 ? [{ type: "toolCall", id: "todo-complete", name: "todo", arguments: { action: "update", id: 1, status: "completed" } }] : [{ type: "text", text: "PRIVATE_MODEL_BODY" }];
      const message = { role: "assistant", api: "openai-completions", provider: "work-observer-fixture", model: "fixture", timestamp: Date.now(), content, stopReason: round < 3 ? "toolUse" : "stop", usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
      stream.push({ type: "done", reason: message.stopReason, message }); stream.end(); return stream;
    };
    await session.prompt("PRIVATE_PROMPT_BODY", { expandPromptTemplates: false }); await session.waitForIdle();
    // Event port is notification-only; wait for this test's original callback,
    // not by running another agent turn or polling production state.
    const deadline = Date.now() + 2000;
    while (scenario !== "old-session" && views.length === 0 && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 5));
    assert.equal(rounds, 4); assert.equal(transport, 0); assert.deepEqual(errors, []);
    const todoResult = session.messages.filter(m => m.role === "toolResult" && m.toolName === "todo").at(-1);
    assert.equal(todoResult?.isError, false, JSON.stringify(todoResult));
    assert.deepEqual({ model: session.model, thinking: session.thinkingLevel, tools: session.getActiveToolNames(), prompt: session.systemPrompt }, before);
    const read = session.messages.filter(m => m.role === "toolResult" && m.toolName === "read").at(-1); assert.equal(read.isError, false); assert.equal(sha(Buffer.from(read.content[0].text)), digest);
    const store = new EventStore(); let rows = [];
    if (scenario === "normal") {
      while (Date.now() < deadline) { rows = (await Promise.all((await store.listRuns()).map(run => store.readRun(run)))).flat(); if (rows.length >= 4) break; await new Promise(resolve => setTimeout(resolve, 5)); }
      assert.ok(rows.some(x => x.action === "pi:work:loaded"));
      assert.ok(rows.some(x => x.action === "pi:work:todo-record" && x.reason_code === "native_todo_pending_unverified"));
      assert.ok(rows.some(x => x.action === "pi:work:todo-record" && x.reason_code === "native_todo_completed_unverified" && x.result === "unknown"));
      assert.equal(views[0].decision, "deliverable");
      assert.ok(rows.some(x => x.action === "pi:work:owner-result" && x.reason_code === "owner_acceptance_confirmed"));
      const raw = JSON.stringify(rows); for (const value of ["PRIVATE_PROMPT_BODY", "PRIVATE_SUBJECT", "PRIVATE_TODO_BODY", "PRIVATE_MODEL_BODY", reportPath, body.toString()]) assert.ok(!raw.includes(value));
    } else if (scenario === "old-session") { assert.deepEqual(await store.listRuns(), []); assert.deepEqual(views, []); assert.deepEqual(originals, []); }
    else { assert.equal(views[0].decision, "deliverable"); assert.deepEqual(await store.listRuns(), []); }
    assert.ok(snapshots.every(Boolean));
    const completed = queryObservations(), originalReads = originals.length, notifications = observationNotifications.length;
    assert.ok(notifications > 0); assert.deepEqual(observationNotifications.at(-1).snapshot, completed);
    assert.equal(completed.coverage, scenario === "old-session" ? "not-applicable" : "observed");
    if (scenario !== "old-session") {
      assert.equal(completed.observations.length, 1); assert.deepEqual(completed.observations[0].observation, views[0]);
      assert.equal(completed.observations[0].kind, "result"); assert.ok(Number.isSafeInteger(completed.observations[0].observedAt));
      assert.equal(Object.hasOwn(completed.observations[0].observation, "freshUntil"), false);
    }
    for (let i = 0; i < 3; i++) assert.deepEqual(queryObservations(), completed);
    assert.equal(originals.length, originalReads); assert.equal(observationNotifications.length, notifications);
    const exported = JSON.stringify(completed);
    for (const value of ["PRIVATE_PROMPT_BODY", "PRIVATE_SUBJECT", "PRIVATE_TODO_BODY", "PRIVATE_MODEL_BODY", reportPath, body.toString()]) assert.ok(!exported.includes(value));
    process.stdout.write(JSON.stringify({ scenario, passed: true, sdk: JSON.parse(await readFile(join(sdk, "package.json"))).version,
      conventionalDiscovery: true, nativeRead: true, todoSource: todo ? "explicit-installed-native-extension" : "synthetic-tool", originalReportSha256: digest, ownerCallbacks: originals.length, ownerDecision: views[0]?.decision ?? "not-observed", persistedEvents: rows.length,
      observationQueries: queryCount, observationCoverage: completed.coverage, queryAdditionalOwnerReads: originals.length - originalReads,
      queryTimestampAndSequenceUnchanged: true, nativeModelThinkingToolsPromptPreserved: true, modelTransportCalls: transport, hindsightChanges: 0, authorization: "none" }) + "\n");
  } finally { if (!session.isIdle) await session.abort(); session.dispose(); }
}
if (isMain(import.meta.url)) {
  const values = {};
  for (const arg of process.argv.slice(2)) { const match = /^--(sdk|entry|fixture|scenario|report|todo)=(.+)$/u.exec(arg); if (!match || Object.hasOwn(values, match[1])) throw Error("invalid-work-sdk-arguments"); values[match[1]] = match[2]; }
  if (values.fixture) await child(values);
  else console.log(JSON.stringify(await runWorkObserverSdk({ sdkRoot: values.sdk, entry: values.entry, ownerReport: values.report, todoEntry: values.todo })));
}
