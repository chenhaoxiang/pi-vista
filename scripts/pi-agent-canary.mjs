import { lstat, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { CheckpointStore, EventStore, redactAll } from "@pi-vista/core";
import { createPiObservation } from "@pi-vista/learning/pi";
import { RAW, ROOT, TOOLS, CanaryError, assertAbsent, constrainStream, createBudget, createFaultPort, createFixtureTools, createTrial, failureCode, ownedFailureSite, providerFailureCategory, forbidConfigCommands, verifyReadonlyBroker, hash, memoryCatalog, parseCanaryOptions, privateEvidenceFiles, privateRead, profileSnapshot, profileComparison, readonlyCredentials, requireCanary, sdkPin } from "./pi-agent-canary-support.mjs";

import { selectedCanaryProvider, validateEffectiveCanaryModel, guardCanaryPayload, observeThinking } from "./pi-agent-canary-request.mjs";

const OBSERVER_TIMEOUT = 80;
const classifications = Object.freeze(["fixture-alpha", "fixture-beta", "fixture-pair", "fixture-wait"]);
const hooks = ["session_start", "session_shutdown", "agent_start", "agent_end", "agent_settled", "tool_execution_start", "tool_execution_end"];
const stopReasons = ["stop", "toolUse", "aborted", "error", "length", "pending", "deferred"];
const text = content => content?.filter(block => block.type === "text").map(block => block.text).join("") ?? "";

export async function observerIdle(controller, budget, fault = false) {
  const deadline = performance.now() + Math.min(2000, budget.remaining());
  for (;;) {
    const status = controller.status();
    if (status.pending_work === 0 && (fault || status.pending_callbacks === 0)) return status;
    requireCanary(performance.now() < deadline, "deadline"); await budget.wait(delay(5));
  }
}
function nonAuthorizing(status) {
  requireCanary(status.authorization === "none" && status.executable === false && status.current === "MISSING" && status.history === "MISSING" && status.selection === "none");
}
function stableStatus(status) { const { pending_callbacks, pending_work, ...rest } = status; return JSON.stringify(rest); }
// Core append is best-effort and concurrent; exact event values, not disk order or object prototypes, round-trip.
const canonicalMetadata = value => value === null || typeof value !== "object" ? JSON.stringify(value) : Array.isArray(value)
  ? `[${value.map(canonicalMetadata).join(",")}]` : `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalMetadata(value[key])}`).join(",")}}`;
const eventValues = events => events.map(canonicalMetadata).sort();

async function scenario(sdk, modelRuntime, model, options, directory, kind, budget, runtimeEvidence) {
  const fixtures = createFixtureTools(path.join(directory, "workspace"));
  const generations = [], responses = [], calls = new Map(); let phase = "startup", extensionErrors = 0, violated = false;
  const faults = kind === "fault" ? createFaultPort() : undefined;
  const runtime = await budget.wait(sdk.createAgentSessionRuntime(async target => {
    const settingsManager = sdk.SettingsManager.inMemory({ packages: [], extensions: [], skills: [], prompts: [], themes: [], defaultTools: [],
      compaction: { enabled: false }, retry: { enabled: false, maxRetries: 0, provider: { maxRetries: 0, timeoutMs: Math.min(150000, options["deadline-ms"]), maxRetryDelayMs: 0 } },
      cacheWarming: "off", enableInstallTelemetry: false, enableAnalytics: false, enableSkillCommands: false, defaultProjectTrust: "never" });
    const resourceLoader = new sdk.DefaultResourceLoader({ cwd: target.cwd, agentDir: target.agentDir, settingsManager,
      noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true,
      systemPrompt: "Only perform the fixed synthetic canary tasks. Use exactly the requested fixture tool once, never any other tool. After its result return exactly the requested marker. No other actions or prose.",
      extensionFactories: [async pi => {
        // DefaultResourceLoader invokes this anew on actual session.reload(). Never reuse a registered addon.
        const generation = { number: generations.length + 1, events: [], checkpoints: [], lifecycle: [], counts: Object.fromEntries(hooks.map(name => [name, 0])) };
        const baseDir = path.join(directory, "observations", `${kind}-${options["source-sha"].slice(0, 12)}-g${generation.number}`);
        await mkdir(baseDir, { mode: 0o700 });
        generation.eventStore = new EventStore({ baseDir }); generation.checkpointStore = new CheckpointStore({ baseDir });
        generation.addon = createPiObservation({ resolve_task: async () => ({ repo: "canary-fixture", source_sha: options["source-sha"], policy_version: "canary-v1", env_fingerprint: "private-fixture-v1", task_type: `canary-${phase}`, task_goal: "synthetic fixture lifecycle", bank: "synthetic-no-bank", session_alias: `canary-${kind}` }),
          now: () => Date.now(), tools: TOOLS.map((native_name, i) => ({ native_name, classification: classifications[i] })), timeout_ms: OBSERVER_TIMEOUT, max_pending_work: 64, max_correlations: 64,
          events: { append: async event => { generation.events.push(event); if (faults) return faults.call(); await generation.eventStore.append(event); } },
          checkpoints: { save: async checkpoint => { generation.checkpoints.push(checkpoint); if (faults) return faults.call(); await generation.checkpointStore.save(checkpoint); } },
        });
        generations.push(generation); generation.addon.extension(pi);
        for (const name of hooks) pi.on(name, event => {
          generation.counts[name]++;
          if (name === "session_start" || name === "session_shutdown") {
            const allowed = name === "session_start" ? ["startup", "reload"] : ["reload", "quit"];
            if (!allowed.includes(event.reason)) violated = true;
            else generation.lifecycle.push({ event: name, reason: event.reason });
          }
        });
      }],
    });
    await budget.wait(resourceLoader.reload());
    requireCanary(resourceLoader.getExtensions().errors.length === 0 && (resourceLoader.getExtensions().warnings?.length ?? 0) === 0);
    for (const resource of [resourceLoader.getSkills().skills, resourceLoader.getPrompts().prompts, resourceLoader.getThemes().themes, resourceLoader.getAgentsFiles().agentsFiles]) requireCanary(resource.length === 0);
    const made = await budget.wait(sdk.createAgentSession({ ...target, modelRuntime, model, thinkingLevel: options.thinking, scopedModels: [{ model, thinkingLevel: options.thinking }], settingsManager, resourceLoader, noTools: "builtin", tools: [...TOOLS], customTools: fixtures.tools }));
    requireCanary(made.modelFallbackMessage === undefined);
    return { ...made, services: { cwd: target.cwd, agentDir: target.agentDir, modelRuntime, settingsManager, resourceLoader, diagnostics: [] }, diagnostics: [] };
  }, { cwd: path.join(directory, "workspace"), agentDir: path.join(directory, "agent"), sessionManager: sdk.SessionManager.inMemory(path.join(directory, "workspace")) }));
  const session = runtime.session, identity = session.sessionId;
  const requestState = constrainStream(session, budget, (payload, effectiveModel, context, thinking) => {
    guardCanaryPayload(payload, effectiveModel, context, thinking); runtimeEvidence.payloadChecks++;
  });
  const unsubscribe = session.subscribe(event => {
    if (event.type === "message_end" && event.message?.role === "assistant") {
      const message = event.message;
      if (message.provider !== options.provider || message.model !== options.model || message.api !== model.api || message.thinkingLevel !== options.thinking || (message.responseModel !== undefined && message.responseModel !== options.model)) violated = true;
      const issued = (message.content ?? []).filter(block => block.type === "toolCall").map(block => ({ id: block.id, name: block.name }));
      responses.push({ phase, stopReason: stopReasons.includes(message.stopReason) ? message.stopReason : "unknown", issued, finalText: text(message.content),
        failureCategory: message.stopReason === "error" ? providerFailureCategory(message.errorMessage) : "none", requestSignalAborted: requestState.requestSignalAborted() });
    } else if (event.type === "tool_execution_start") {
      if (!TOOLS.includes(event.toolName) || typeof event.toolCallId !== "string" || event.toolCallId.length > 256 || calls.size >= 64 || calls.has(event.toolCallId)) { violated = true; return; }
      calls.set(event.toolCallId, { alias: `call-${calls.size + 1}`, phase, tool: event.toolName, parent: event.parentToolCallId, args: event.args, originalArgs: JSON.stringify(event.args), start: calls.size * 2, ended: false });
    } else if (event.type === "tool_execution_end") {
      const call = calls.get(event.toolCallId);
      if (!call || call.ended || call.tool !== event.toolName || call.parent !== event.parentToolCallId) { violated = true; return; }
      call.ended = true; call.isError = event.isError;
      call.argsUnchanged = JSON.stringify(call.args) === call.originalArgs && fixtures.inputs.get(event.toolCallId) === call.originalArgs;
      call.resultUnchanged = event.isError ? undefined : fixtures.returned.get(event.toolCallId) === JSON.stringify({ content: event.result?.content, details: event.result?.details });
      call.endOrder = [...calls.values()].filter(item => item.ended).length;
    } else if (["auto_retry_start", "compaction_start", "summarization_retry_scheduled"].includes(event.type)) { violated = true; session.agent.abort(); }
  });
  await budget.wait(session.bindExtensions({ mode: "print", onError: () => { extensionErrors++; session.agent.abort(); } }));
  function pinned() {
    requireCanary(session === runtime.session && identity === session.sessionId && session.sessionFile === undefined && session.model?.provider === options.provider && session.model?.id === options.model && session.thinkingLevel === options.thinking && !violated && extensionErrors === 0);
    requireCanary(JSON.stringify(session.getAllTools().map(tool => tool.name).sort()) === JSON.stringify([...TOOLS].sort()));
    requireCanary(JSON.stringify(session.getActiveToolNames().sort()) === JSON.stringify([...TOOLS].sort()));
    requireCanary(JSON.stringify(session.getCallableToolNames().sort()) === JSON.stringify(["canary_alpha", "canary_beta"]));
  }
  const phases = []; const diagnostics = { kind, phase, phaseAccepted: phases, identityViolation: false };
  async function task(name, tool, fixture, abort = false) {
    phase = name; diagnostics.phase = name; observeThinking(session, options, runtimeEvidence); pinned(); const generation = generations.at(-1), firstResponse = responses.length;
    const expectedMarker = `${RAW[3]} ${name.toUpperCase()}_OK`;
    const prompt = `${RAW[2]} Call ${tool} exactly once with fixture=${fixture}, privacy=${RAW[0]}. ${abort ? "Wait for host cancellation; do not claim completion." : `After its result respond exactly ${expectedMarker}.`}`;
    const prompting = session.prompt(prompt, { expandPromptTemplates: false });
    if (abort) {
      await budget.wait(Promise.race([fixtures.waiting.started.promise, prompting.then(() => { throw new CanaryError("assertion-failed"); })]));
      requireCanary(fixtures.waiting.active && session.isStreaming);
      await budget.wait(session.abort());
    }
    await budget.wait(prompting); await budget.wait(session.waitForIdle());
    const status = await budget.wait(observerIdle(generation.addon.controller, budget, !!faults), 2000);
    nonAuthorizing(status); pinned();
    requireCanary(status.phase === "settled" && status.correlations === 0 && status.binding !== undefined && session.isIdle);
    requireCanary(!phases.some(item => item.runId === status.binding.run_id));
    const observedResponses = responses.slice(firstResponse), observedCalls = [...calls.entries()].filter(([, call]) => call.phase === name);
    diagnostics.identityViolation = violated;
    diagnostics.responseStops = observedResponses.map(response => response.stopReason);
    diagnostics.responseFailureCategories = observedResponses.map(response => response.failureCategory);
    diagnostics.responseSignalsAborted = observedResponses.map(response => response.requestSignalAborted);
    diagnostics.observedCalls = observedCalls.map(([, call]) => ({ alias: call.alias, tool: call.tool, nested: call.parent !== undefined,
      ended: call.ended, isError: call.isError, argsUnchanged: call.argsUnchanged, resultUnchanged: call.resultUnchanged }));
    requireCanary(observedResponses.length > 0 && observedCalls.length === (tool === "canary_parallel" ? 3 : 1));
    const top = observedCalls.filter(([, call]) => call.parent === undefined);
    requireCanary(top.length === 1 && top[0][1].tool === tool && observedResponses.some(response => response.issued.some(call => call.id === top[0][0] && call.name === tool)));
    for (const [, call] of observedCalls) requireCanary(call.ended && call.argsUnchanged && (abort ? call.isError === true : call.isError === false && call.resultUnchanged));
    if (tool === "canary_parallel") {
      const nested = observedCalls.filter(([, call]) => call.parent === top[0][0]);
      requireCanary(nested.length === 2 && fixtures.maximumReads === 2);
      requireCanary(nested.find(([, call]) => call.tool === "canary_beta")[1].endOrder < nested.find(([, call]) => call.tool === "canary_alpha")[1].endOrder);
    }
    const last = observedResponses.at(-1);
    if (abort) requireCanary(fixtures.waiting.signalReleased && !fixtures.waiting.active &&
      (["toolUse", "aborted"].includes(last.stopReason) || (last.stopReason === "error" && last.requestSignalAborted)) &&
      !observedResponses.some(response => ["length", "deferred"].includes(response.stopReason) || (response.stopReason === "error" && !response.requestSignalAborted)));
    else requireCanary(last.stopReason === "stop" && last.finalText.trim() === expectedMarker && session.getLastAssistantText()?.trim() === expectedMarker && observedResponses.every(response => ["toolUse", "stop"].includes(response.stopReason)));
    const events = generation.events.filter(event => event.run_id === status.binding.run_id);
    const steps = events.filter(event => event.action === "pi:tool-execution-start").map(start => ({ classification: start.target_class, stepId: start.step_id, result: events.find(end => end.action === "pi:tool-execution-end" && end.step_id === start.step_id)?.result ?? "MISSING" }));
    if (!faults) {
      requireCanary(status.dropped === 0 && steps.length === observedCalls.length && new Set(steps.map(step => step.stepId)).size === steps.length && steps.every(step => step.result === (abort ? "failed" : "ok")));
      requireCanary(events.filter(event => event.action === "pi:agent-settled").length === 1 && events.filter(event => event.action === "pi:agent-end").every(event => event.result === "unknown"));
      requireCanary(JSON.stringify(eventValues(await generation.eventStore.readRun(status.binding.run_id))) === JSON.stringify(eventValues(events.map(event => redactAll(event)))));
      const checkpoints = generation.checkpoints.filter(checkpoint => checkpoint.run_id === status.binding.run_id);
      requireCanary(checkpoints.length === 2);
      for (const checkpoint of checkpoints) {
        requireCanary(!checkpoint.resumable && checkpoint.completed_steps.length === 0 && checkpoint.pending_steps.length === 0 && checkpoint.check_fn_ids.length === 0);
        requireCanary(canonicalMetadata(await generation.checkpointStore.load(checkpoint.run_id, checkpoint.step_id)) === canonicalMetadata(redactAll(checkpoint)));
      }
    } else requireCanary(status.dropped > 0 && status.pending_callbacks > 0);
    phases.push({ phase: name, sessionAlias: `canary-${kind}`, generation: generation.number, runId: status.binding.run_id, responseCount: observedResponses.length,
      finalStopReason: last.stopReason, finalFailureCategory: last.failureCategory, finalRequestSignalAborted: last.requestSignalAborted,
      markerMatched: !abort, intendedCancellation: abort, signalReleased: abort ? fixtures.waiting.signalReleased : false,
      settled: true, argsUnchanged: true, resultBodiesUnchanged: abort ? "cancelled-no-success-result" : true,
      modelIssuedParent: true, nestedCalls: observedCalls.length - 1, overlappingReads: tool === "canary_parallel" ? fixtures.maximumReads : 1,
      steps, observation: { dropped: status.dropped, pendingCallbacks: status.pending_callbacks, eventBasis: faults ? "port-attempts-not-persisted" : "core-exact-event-values-unordered", persistedEvents: faults ? 0 : events.length, coverage: "observed-only", current: "MISSING", history: "MISSING", authorization: "none", executable: false } });
  }
  let disposed = false;
  async function dispose() {
    if (disposed) return; await budget.wait(runtime.dispose()); disposed = true; unsubscribe();
  }
  try {
    if (!faults) {
      await task("startup", "canary_alpha", "alpha"); await task("parallel", "canary_parallel", "pair");
      await task("abort", "canary_wait", "wait", true); await task("subsequent", "canary_beta", "beta");
      const old = generations.at(-1), count = generations.length;
      phase = "reload"; await budget.wait(session.reload());
      requireCanary(generations.length === count + 1 && generations.at(-1).addon !== old.addon && old.addon.controller.status().phase === "shutdown");
      requireCanary(generations.at(-1).counts.session_start === 1);
      await task("reload", "canary_alpha", "alpha");
    } else { await task("fault-one", "canary_parallel", "pair"); await task("fault-two", "canary_parallel", "pair"); }
    // SDK runtime.dispose is the awaited public shutdown lifecycle, not AgentSession.dispose alone.
    await dispose();
    const before = generations.map(generation => stableStatus(generation.addon.controller.status()));
    faults?.release(); await budget.wait(delay(OBSERVER_TIMEOUT * 2));
    for (const [i, generation] of generations.entries()) {
      const status = generation.addon.controller.status(); nonAuthorizing(status);
      requireCanary(status.phase === "shutdown" && status.pending_work === 0 && status.pending_callbacks === 0 && before[i] === stableStatus(status));
    }
    requireCanary(generations[0].lifecycle[0]?.reason === "startup" && generations.at(-1).lifecycle.at(-1)?.reason === "quit");
    if (!faults) requireCanary(generations[0].lifecycle.at(-1)?.reason === "reload" && generations[1].lifecycle[0]?.reason === "reload");
    if (faults) requireCanary(faults.counts.reject > 1 && faults.counts.hang > 1 && faults.counts.lateRejection > 1 && faults.counts.released === faults.counts.hang + faults.counts.lateRejection);
    pinned();
    const stats = session.getSessionStats();
    const usage = { tokens: {}, cost: null, basis: "SDK-session-statistics-not-independent-billing" };
    for (const key of ["input", "output", "cacheRead", "cacheWrite", "total"]) { requireCanary(Number.isFinite(stats.tokens[key]) && stats.tokens[key] >= 0); usage.tokens[key] = stats.tokens[key]; }
    requireCanary(Number.isFinite(stats.cost) && stats.cost >= 0); usage.cost = stats.cost;
    return { kind, phases, sameSessionAfterAbort: !faults, reloadWithNewAddon: !faults, awaitedShutdown: true, lateRevival: false, extensionErrors, usage,
      generations: generations.map(generation => ({ number: generation.number, lifecycle: generation.lifecycle, notificationCounts: generation.counts })),
      ...(faults ? { faultCallbacks: { ...faults.counts } } : {}) };
  } catch (error) {
    if (error instanceof CanaryError) Object.defineProperty(error, "canaryDiagnostics", { value: diagnostics });
    throw error;
  } finally {
    session.agent.abort(); faults?.release();
    if (!disposed) { try { await Promise.race([runtime.dispose(), delay(1000)]); } catch { /* Main still reports failure, never successful cleanup. */ } unsubscribe(); }
  }
}

// Exported solely for deterministic synthetic SDK mocks. The CLI has no injected SDK/fallback path.
export async function runRuntimeTrials(sdk, modelRuntime, model, options, directory, budget, scenarios = [], runtimeEvidence = { effectiveThinking: "not-captured", payloadChecks: 0 }) {
  for (const kind of ["primary", "fault"]) scenarios.push(await scenario(sdk, modelRuntime, model, options, directory, kind, budget, runtimeEvidence));
  requireCanary((await readdir(path.join(directory, "agent"))).length === 0);
  for (const { text: body } of await privateEvidenceFiles(path.join(directory, "observations"))) assertAbsent(body, [directory, options.sdk, options["profile-dir"]]);
  return scenarios;
}

export function quarantineDiagnostics() {
  const counters = { stdoutWrites: 0, stderrWrites: 0, unhandledRejections: 0 };
  const restore = [];
  for (const [name, stream] of [["stdoutWrites", process.stdout], ["stderrWrites", process.stderr]]) {
    const write = stream.write; restore.push(() => { stream.write = write; });
    stream.write = function (_chunk, encoding, callback) { counters[name]++; const done = typeof encoding === "function" ? encoding : callback; if (typeof done === "function") done(); return true; };
  }
  const rejection = () => { counters.unhandledRejections++; };
  process.on("unhandledRejection", rejection);
  return { counters, restore() { process.off("unhandledRejection", rejection); for (const undo of restore) undo(); } };
}
async function sourceHashes() {
  const scripts = {};
  for (const name of ["pi-agent-canary.mjs", "pi-agent-canary-support.mjs", "pi-agent-canary-request.mjs"])  scripts[name] = hash(await readFile(path.join(ROOT, "scripts", name)));
  const modules = {};
  for (const name of ["@pi-vista/core", "@pi-vista/learning/pi"]) modules[name] = hash(await readFile(fileURLToPath(import.meta.resolve(name))));
  return { scripts, publicEntrySha256: modules, compiledTransitiveHealth: "not-claimed" };
}
export async function canaryMain(args) {
  let options;
  try { options = parseCanaryOptions(args); } catch (error) { return { schema: 1, status: "refused", actualRun: "not-run", failure: failureCode(error), authorization: "none", executable: false }; }
  const terminalWrite = process.stdout.write.bind(process.stdout), quarantine = quarantineDiagnostics();
  const budget = createBudget(options); let directory, credentials, before, broker, sdk, report;
  const runtimeEvidence = { effectiveThinking: "not-captured", payloadChecks: 0 };
  const hardDeadline = setTimeout(() => {
    terminalWrite(JSON.stringify({ schema: 1, status: "failed", actualRun: "deadline-unsettled", failure: "deadline", requestAttempts: budget.attempts, authorization: "none", executable: false, rawDataLogged: false }) + "\n"); process.exit(1);
  }, options["deadline-ms"] + 5000);
  try {
    const pin = await budget.wait(sdkPin(options.sdk));
    before = await budget.wait(profileSnapshot(options["profile-dir"]));
    credentials = readonlyCredentials(options.provider, () => privateRead(path.join(options["profile-dir"], "auth.json")), options["readonly-broker-pin"] !== undefined);
    // Static mode refuses commands. Optional operator-pinned mode admits only one verified read-only cat key broker.
    const modelConfig = JSON.parse(await budget.wait(privateRead(path.join(options["profile-dir"], "models.json"))));
    const selected = selectedCanaryProvider(modelConfig, options);
    if (options["readonly-broker-pin"] !== undefined) broker = await budget.wait(verifyReadonlyBroker(modelConfig, options.provider, options["readonly-broker-pin"], options["profile-dir"]));
    else forbidConfigCommands(selected);
    credentials = readonlyCredentials(options.provider, () => privateRead(path.join(options["profile-dir"], "auth.json")), broker !== undefined, broker?.readCredential);
    await budget.wait(credentials.store.read(options.provider));
    directory = await budget.wait(createTrial(options["output-root"]));
    // Loading a private closed config at creation avoids registerProvider's implicit ALL-provider availability refresh.
    const safeConfig = { providers: { [options.provider]: { baseUrl: selected.baseUrl, api: selected.api, models: selected.models } } };
    const safeConfigPath = path.join(directory, "selected-models.json");
    await writeFile(safeConfigPath, JSON.stringify(safeConfig), { flag: "wx", mode: 0o600 });
    sdk = await budget.wait(import(pathToFileURL(pin.entry).href));
    const catalogs = memoryCatalog();
    const modelRuntime = await budget.wait(sdk.ModelRuntime.create({ credentials: credentials.store, modelsPath: safeConfigPath, modelsStore: catalogs.store, allowModelNetwork: false, refreshOnCreate: false }));
    const model = modelRuntime.getModel(options.provider, options.model);
    validateEffectiveCanaryModel(model, options);
    requireCanary(modelRuntime.getError() === undefined, "invalid-config");
    const auth = await budget.wait(modelRuntime.getAuth(model)); credentials.assertAuth(auth);
    const privateStrings = [directory, options.sdk, options["profile-dir"], model.baseUrl, ...Object.values(auth.auth.headers ?? {}), ...Object.values(model.headers ?? {})].filter(value => typeof value === "string" && value.length > 0);
    privateStrings.push(directory);
    report = { schema: 1, status: "running", actualRun: "started", authorization: "none", executable: false, provider: options.provider, model: options.model, api: model.api,
      requestedThinking: options.thinking, effectiveThinking: "not-captured", sdk: { version: pin.version, manifestSha256: pin.manifestSha256, publicEntrySha256: pin.entrySha256, fullDeclarationHealth: "unresolved-not-tested" }, node: process.version,
      sourceSha: options["source-sha"], sourceBinding: "operator-supplied", sourceHashes: await budget.wait(sourceHashes()),
      budget: { maxModelRounds: options["max-model-rounds"], deadlineMs: options["deadline-ms"] }, credentialMode: options["readonly-broker-pin"] === undefined ? "static-provider-api-key" : "operator-pinned-readonly-model-broker", sessionPersistence: "in-memory", catalogPersistence: "in-memory", catalogNetwork: false, rawDataLogged: false };
    report.scenarios = []; await runRuntimeTrials(sdk, modelRuntime, model, options, directory, budget, report.scenarios, runtimeEvidence);
    report.effectiveThinking = runtimeEvidence.effectiveThinking; report.validatedPayloads = runtimeEvidence.payloadChecks;
    requireCanary(runtimeEvidence.payloadChecks > 0 && runtimeEvidence.payloadChecks <= budget.attempts);
    requireCanary(quarantine.counters.unhandledRejections === 0 && credentials.counters.blockedWrites === 0 && credentials.counters.foreignReadAttempts === 0);
    const profile = profileComparison(before, await budget.wait(profileSnapshot(options["profile-dir"])));
    requireCanary(profile.protectedFilesUnchanged);
    if (broker) { report.brokerTargetMetadataUnchanged = JSON.stringify(broker.before) === JSON.stringify(await broker.capture()); requireCanary(report.brokerTargetMetadataUnchanged); }
    report.profileMetadataUnchanged = profile.metadataUnchanged; report.profileObservation = profile; report.credentialAccess = { ...credentials.counters }; report.catalogAccess = { ...catalogs.counters };
    report.requestAttempts = budget.attempts; report.diagnostics = { ...quarantine.counters }; report.status = "passed"; report.actualRun = "completed";
    const serialized = JSON.stringify(report); assertAbsent(serialized, privateStrings); credentials.assertAbsent(serialized);
    for (const { text: body } of await privateEvidenceFiles(path.join(directory, "observations"))) { assertAbsent(body, privateStrings); credentials.assertAbsent(body); }
  } catch (error) {
    report = { ...(report ?? { schema: 1, authorization: "none", executable: false }), status: "failed", actualRun: directory ? "started-not-accepted" : "not-run", failure: failureCode(error), ...(ownedFailureSite(error) === undefined ? {} : { ownedFailureSite: ownedFailureSite(error) }), requestAttempts: budget.attempts, rawDataLogged: false };
    // Never project foreign errors, frames, config, paths, model text or half-built raw ledger state.
    report.effectiveThinking = runtimeEvidence.effectiveThinking; report.validatedPayloads = runtimeEvidence.payloadChecks;
    if (error instanceof CanaryError && Object.hasOwn(error, "canaryDiagnostics")) report.failedScenario = error.canaryDiagnostics;
    if (before) { try {
      const profile = profileComparison(before, await profileSnapshot(options["profile-dir"]));
      report.profileMetadataUnchanged = profile.metadataUnchanged; report.profileObservation = profile;
    } catch { report.profileMetadataUnchanged = false; } }
    if (broker) { try { report.brokerTargetMetadataUnchanged = JSON.stringify(broker.before) === JSON.stringify(await broker.capture()); } catch { report.brokerTargetMetadataUnchanged = false; } }
    if (credentials) report.credentialAccess = { ...credentials.counters };
  }
  try {
    const serialized = JSON.stringify(report, null, 2) + "\n";
    assertAbsent(serialized, [options.sdk, options["profile-dir"], options["output-root"]]); credentials?.assertAbsent(serialized);
    if (directory) await writeFile(path.join(directory, "report.json"), serialized, { flag: "wx", mode: 0o600 });
    return report;
  } catch { return { schema: 1, status: "failed", actualRun: "not-accepted", failure: "assertion-failed", authorization: "none", executable: false, rawDataLogged: false }; }
  finally { clearTimeout(hardDeadline); quarantine.restore(); }
}
if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  process.umask(0o077);
  const report = await canaryMain(process.argv.slice(2));
  process.stdout.write(JSON.stringify(report, null, 2) + "\n");
  // This opt-in child owns all timers/promises; stop even when a trusted callback ignored cancellation.
  process.exit(report.status === "passed" ? 0 : 1);
}
