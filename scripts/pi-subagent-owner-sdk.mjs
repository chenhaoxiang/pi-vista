import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, normalize, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { ROOT, commandEnvironment, isMain } from "./release-utils.mjs";
const exec = promisify(execFile), hash = bytes => createHash("sha256").update(bytes).digest("hex");

/** Opt-in, isolated real SDK tool_result/end dispatch over a fixed native source
 * archive's scripted ChildSessionFactory. No real model/credential/installed
 * extension discovery. This is a test harness, not another execution owner.
 */
export async function runSubagentOwnerSdk({ sdk, native, observer = join(ROOT, "scripts/pi-work-observer.mjs") }) {
  for (const file of [sdk, native, observer]) assert.ok(typeof file === "string" && isAbsolute(file) && normalize(file) === file && !file.includes("\0"));
  const parent = join(ROOT, "tmp/native-result-seam"); await mkdir(parent, { recursive: true });
  const fixture = await mkdtemp(join(parent, "sdk-")), temp = join(fixture, "native"); await mkdir(temp);
  const args = ["--import", join(native, "test/support/register-loader.mjs"), import.meta.filename,
    `--sdk=${sdk}`, `--native=${native}`, `--observer=${observer}`, `--fixture=${fixture}`];
  const env = { ...commandEnvironment(), HOME: join(temp, "home"), USERPROFILE: join(temp, "home"), TMPDIR: temp, PI_SUBAGENTS_TEMP_ROOT: temp };
  await writeFile(join(fixture, "command.json"), JSON.stringify({ executable: process.execPath, args, env }, null, 2));
  try {
    const result = await exec(process.execPath, args, { cwd: ROOT, env, timeout: 180_000, maxBuffer: 2 * 1024 * 1024 });
    await writeFile(join(fixture, "stdout.log"), result.stdout); await writeFile(join(fixture, "stderr.log"), result.stderr);
    return { evidence: fixture, report: JSON.parse(result.stdout) };
  } catch (error) {
    await writeFile(join(fixture, "stdout.log"), error.stdout ?? ""); await writeFile(join(fixture, "stderr.log"), error.stderr ?? "");
    throw Error(`subagent-owner-sdk-failed; evidence=${fixture}`);
  }
}

async function child({ sdk, native, observer: entry, fixture }) {
  assert.ok(fixture.startsWith(join(ROOT, "tmp/native-result-seam") + sep));
  assert.equal(normalize(fixture), fixture); assert.equal(await realpath(fixture), fixture);
  assert.equal(process.env.PI_SUBAGENTS_TEMP_ROOT, join(fixture, "native"));
  assert.equal(process.env.HOME, join(fixture, "native/home"));
  const load = (root, file) => import(pathToFileURL(join(root, file)).href);
  const api = await load(sdk, "dist/index.js");
  const { AssistantMessageEventStream } = await load(dirname(sdk), "pi-ai/dist/utils/event-stream.js");
  const { createPiWorkObserver } = await import(pathToFileURL(entry).href);
  const { createMockPi, makeAgent, events: scriptedEvents } = await load(native, "test/support/helpers.ts");
  const { createSubagentExecutor } = await load(native, "src/runs/foreground/subagent-executor.ts");
  const { flattenSubagentToolOptions } = await load(native, "src/extension/subagent-options.ts");
  const { SubagentParams } = await load(native, "src/extension/schemas.ts");
  const { readAsyncPayload, waitForAsyncState } = await load(native, "test/support/async-execution-fixture.ts");
  assert.equal(JSON.parse(await readFile(join(sdk, "package.json"))).version, "1.5.0-fork.1");
  const modelRuntime = await api.ModelRuntime.create({ modelsPath: null, allowModelNetwork: false, refreshOnCreate: false,
    credentials: { async read() {}, async list() { return []; }, async modify() { assert.fail("credential write"); }, async delete() { assert.fail("credential delete"); } },
    modelsStore: { async read() {}, async write() {}, async delete() {} } });
  let transport = 0;
  for (const method of ["stream", "streamSimple", "complete", "completeSimple"]) modelRuntime[method] = () => { transport++; throw Error("unexpected model transport"); };
  modelRuntime.registerProvider("native-result-fixture", { api: "openai-completions", baseUrl: "http://127.0.0.1:1", apiKey: "synthetic",
    models: [{ id: "fixture", name: "fixture", reasoning: true, input: ["text"], contextWindow: 32768, maxTokens: 128, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }] });
  const mock = createMockPi(); mock.install();
  const rows = [], cases = [], originals = [], sdkEvents = [], middlewareReturns = [], errors = [];
  let missionId, missionPath, firstOwner, previousPayload, originalFiles;
  const project = join(fixture, "project"); await mkdir(project);
  const config = { missions: { directory: join(project, "missions"), globalIndex: false }, maxSubagentDepth: 1 };
  try {
    for (const parent of ["creation", "successor"]) {
      const sessionManager = api.SessionManager.create(project, join(fixture, `${parent}-sessions`));
      const bus = api.createEventBus(), observers = [];
      let mode = "normal", latestPayload, returnedResult, returnedDigest, inputDigest, currentObserver, toolExecutions = 0;
      const settingsManager = api.SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: false }, cacheWarming: "off", enableAnalytics: false, enableInstallTelemetry: false }, { projectTrusted: false });
      const beforeMiddleware = pi => {
        pi.on("tool_call", event => { if (event.toolName === "subagent" && mode === "blocked") return { block: true, reason: "synthetic block" }; });
        pi.on("tool_result", event => {
          if (event.toolName !== "subagent") return;
          if (mode === "error-before") return { isError: true };
          if (mode === "input-before") delete event.input.options.missionId;
        });
      };
      const afterMiddleware = pi => pi.on("tool_result", event => {
        if (event.toolName !== "subagent") return;
        // Even an already-completed native run must not be read before final end.
        assert.equal(currentObserver.status().ownerReads, cases.filter(row => row.parent === parent && row.mode !== "blocked").length);
        if (mode === "error-after") return { isError: true };
        if (mode === "details-after") return { details: { ...event.details, missionPath: join(project, "foreign", `${missionId}.json`) } };
        if (mode === "input-after") event.input.options.missionId = "changed-after-observer";
      });
      const observerFactory = pi => {
        const owner = createPiWorkObserver({ freshSessionsSince: "2000-01-01T00:00:00.000Z", store: { append: row => rows.push(row) }, diagnose() {} });
        currentObserver = owner; observers.push(owner);
        owner.extension({ ...pi, on(name, handler) {
          return pi.on(name, (event, ctx) => {
            if (name !== "tool_result") return handler(event, ctx);
            const inputBefore = hash(JSON.stringify(event.input)), resultBefore = hash(JSON.stringify([event.content, event.details, event.isError, event.usage]));
            const result = handler(event, ctx);
            assert.equal(result, undefined); assert.equal(hash(JSON.stringify(event.input)), inputBefore);
            assert.equal(hash(JSON.stringify([event.content, event.details, event.isError, event.usage])), resultBefore);
            middlewareReturns.push("undefined");
          });
        } });
      };
      const producerFactory = pi => {
        const executor = createSubagentExecutor({ pi, config, asyncByDefault: false, tempArtifactsDir: join(fixture, "artifacts"),
          getSubagentSessionRoot: () => join(fixture, "children"), expandTilde: value => value,
          discoverAgents: () => ({ agents: [makeAgent("worker")] }),
          state: { baseCwd: project, currentSessionId: null, asyncJobs: new Map(), foregroundControls: new Map(), lastForegroundControlId: null } });
        pi.registerTool({ name: "subagent", label: "Synthetic native subagent", description: "Scripted native source fixture", parameters: SubagentParams,
          async execute(callId, input, signal, onUpdate, ctx) {
            toolExecutions++; mock.onCall({ jsonl: [scriptedEvents.acceptanceReport()] });
            inputDigest = hash(JSON.stringify(input));
            const result = await executor.executePublic(callId, flattenSubagentToolOptions(input), signal, onUpdate, ctx);
            assert.notEqual(result.isError, true, "native synthetic launch failed");
            assert.equal(hash(JSON.stringify(input)), inputDigest);
            missionId = result.details.missionId; missionPath = result.details.missionPath;
            latestPayload = await readAsyncPayload(result.details.runId);
            const status = await waitForAsyncState(result.details.runId, value => value.processTerminal?.state === "observed", 15_000);
            const metadataPath = latestPayload.results[0].artifactPaths.metadataPath, metadata = JSON.parse(await readFile(metadataPath, "utf8"));
            const sidecarPath = join(result.details.asyncDir, "mission.json"), sidecar = JSON.parse(await readFile(sidecarPath, "utf8"));
            assert.equal(status.sessionId, sessionManager.getSessionFile()); assert.equal(status.toolCallId, callId);
            assert.equal(metadata.parentSessionId, sessionManager.getSessionId());
            assert.equal(metadata.runId, result.details.runId); assert.equal(sidecar.autoCreated, false);
            assert.equal(sidecar.missionId, missionId); assert.equal(join(sidecar.missionDir, `${missionId}.json`), missionPath);
            const mission = JSON.parse(await readFile(missionPath, "utf8")); firstOwner ??= mission.ownerSessionId;
            assert.equal(mission.ownerSessionId, firstOwner);
            assert.equal(mission.runs.filter(run => run.runId === result.details.runId && run.mode === "single" && run.asyncDir === result.details.asyncDir).length, 1);
            const files = [join(result.details.asyncDir, "status.json"), sidecarPath, metadataPath, latestPayload.results[0].artifactPaths.outputPath];
            const pinned = await Promise.all(files.map(async path => ({ path, sha256: hash(await readFile(path)) })));
            originals.push({ parent, mode, runId: result.details.runId, files: pinned });
            if (parent === "creation") originalFiles = pinned;
            if (mode === "missing-sidecar") await rm(sidecarPath);
            if (mode === "automatic-sidecar") await writeFile(sidecarPath, JSON.stringify({ ...sidecar, autoCreated: true }));
            if (mode === "foreign-metadata") await writeFile(metadataPath, JSON.stringify({ ...metadata, parentSessionId: "foreign-parent" }));
            returnedResult = mode === "tool-error" ? { ...result, isError: true } : result;
            returnedDigest = hash(JSON.stringify(returnedResult));
            bus.emit("subagent:async-complete", latestPayload); // exact native-generated early completion, not a fabricated SDK event
            return returnedResult;
          } });
        pi.on("tool_result", event => {
          if (event.toolName === "subagent") sdkEvents.push({ parent, mode, type: event.type, input: Object.hasOwn(event, "input"), details: Object.hasOwn(event, "details") });
        });
        pi.on("tool_execution_end", event => {
          if (event.toolName !== "subagent") return;
          assert.equal(Object.hasOwn(event, "args"), false); assert.equal(Object.hasOwn(event, "input"), false);
          sdkEvents.push({ parent, mode, type: event.type, args: false, isError: event.isError });
        });
      };
      const resourceLoader = new api.DefaultResourceLoader({ cwd: project, agentDir: join(fixture, parent), eventBus: bus, settingsManager,
        noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true, systemPrompt: "Synthetic only; no model transport",
        extensionFactories: [beforeMiddleware, observerFactory, afterMiddleware, producerFactory] });
      await resourceLoader.reload(); assert.deepEqual(resourceLoader.getExtensions().errors, []);
      const { session } = await api.createAgentSession({ cwd: project, agentDir: join(fixture, parent), resourceLoader, sessionManager, settingsManager,
        modelRuntime, model: modelRuntime.getModel("native-result-fixture", "fixture"), thinkingLevel: "max", tools: ["subagent"], eventBus: bus });
      try {
        await session.bindExtensions({ mode: "json", onError: event => errors.push(event.event ?? "unknown") });
        const selected = { model: session.model, thinking: session.thinkingLevel, tools: session.getActiveToolNames(), prompt: session.systemPrompt };
        if (previousPayload) { bus.emit("subagent:async-complete", previousPayload); assert.equal(currentObserver.status().ownerReads, 0); }
        const modes = parent === "creation" ? ["normal"] : ["normal", "input-after", "input-before", "error-before", "error-after", "details-after", "tool-error", "missing-sidecar", "automatic-sidecar", "foreign-metadata", "blocked"];
        for (mode of modes) {
          const callsBefore = toolExecutions, readsBefore = currentObserver.status().ownerReads, observationsBefore = currentObserver.observationSnapshot().observations.length;
          let rounds = 0;
          session.agent.streamFunction = () => {
            const stream = new AssistantMessageEventStream(), call = rounds++ === 0;
            const input = { agent: "worker", task: "PRIVATE_SYNTHETIC_TASK", async: true, options: { context: "fresh", acceptance: "checked",
              ...(parent === "creation" ? { mission: { title: "Synthetic mission" } } : { missionId }) } };
            const message = { role: "assistant", api: "openai-completions", provider: "native-result-fixture", model: "fixture", timestamp: Date.now(),
              content: call ? [{ type: "toolCall", id: `${parent}-${mode}`, name: "subagent", arguments: input }] : [{ type: "text", text: "PRIVATE_SYNTHETIC_REPLY" }],
              stopReason: call ? "toolUse" : "stop", usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
            stream.push({ type: "done", reason: message.stopReason, message }); stream.end(); return stream;
          };
          await session.prompt("PRIVATE_SYNTHETIC_PROMPT", { expandPromptTemplates: false }); await session.waitForIdle();
          while (currentObserver.status().inFlight) await currentObserver.drain();
          assert.equal(rounds, 2); assert.equal(transport, 0); assert.deepEqual(errors, []);
          const view = currentObserver.observationSnapshot().observations.at(-1)?.observation;
          const expected = ["normal", "input-after"].includes(mode) ? "accepted" : "unknown";
          if (mode === "blocked") {
            assert.equal(toolExecutions, callsBefore); assert.equal(currentObserver.status().ownerReads, readsBefore);
            assert.equal(currentObserver.observationSnapshot().observations.length, observationsBefore);
          } else {
            assert.equal(toolExecutions, callsBefore + 1); assert.equal(currentObserver.status().ownerReads, readsBefore + 1);
            const outcome = { parent, mode, expected, observed: view?.outcome, nativeRunParentMatches: view?.binding?.sessionId === sessionManager.getSessionId(), authorization: view?.authorization };
            cases.push(outcome);
            await writeFile(join(fixture, "cases.json"), JSON.stringify(cases, null, 2));
            await writeFile(join(fixture, "originals.json"), JSON.stringify(originals, null, 2));
            assert.equal(view?.outcome, expected, `${parent}/${mode}: real SDK event plus native-generated originals`);
            assert.equal(view.binding.sessionId, sessionManager.getSessionId()); assert.equal(view.binding.stageId, "subagent-output-available");
            assert.equal(view.binding.workRef.key, missionId);
            assert.equal(view.authorization, "none"); assert.equal(hash(JSON.stringify(returnedResult)), returnedDigest);
            const count = currentObserver.status().ownerReads;
            bus.emit("subagent:async-complete", latestPayload); while (currentObserver.status().inFlight) await currentObserver.drain();
            assert.equal(currentObserver.status().ownerReads, count, "duplicate completion must not reread");
          }
          if (mode === "blocked") cases.push({ parent, mode, executed: false, observed: "not-observed" });
        }
        previousPayload = latestPayload;
        if (parent === "successor") {
          const beforeTree = currentObserver.status().ownerReads;
          const firstUser = sessionManager.getEntries().find(entry => entry.type === "message" && entry.message.role === "user");
          await session.navigateTree(firstUser.id, { summarize: false });
          assert.equal(currentObserver.observationSnapshot().observations.length, 0);
          bus.emit("subagent:async-complete", latestPayload); while (currentObserver.status().inFlight) await currentObserver.drain();
          assert.equal(currentObserver.status().ownerReads, beforeTree);
          await session.reload(); assert.equal(observers.length, 2); assert.equal(currentObserver.status().ownerReads, 0);
          bus.emit("subagent:async-complete", latestPayload); while (currentObserver.status().inFlight) await currentObserver.drain();
          assert.equal(currentObserver.observationSnapshot().observations.length, 0);
        }
        assert.deepEqual({ model: session.model, thinking: session.thinkingLevel, tools: session.getActiveToolNames(), prompt: session.systemPrompt }, selected);
      } finally { session.dispose(); }
    }
    for (const file of originalFiles) assert.equal(hash(await readFile(file.path)), file.sha256, "old run originals changed");
    const safe = JSON.stringify({ rows, cases, sdkEvents });
    for (const value of [fixture, "PRIVATE_SYNTHETIC_TASK", "PRIVATE_SYNTHETIC_PROMPT", "PRIVATE_SYNTHETIC_REPLY"]) assert.ok(!safe.includes(value));
    assert.equal(mock.callCount(), originals.length); assert.equal(transport, 0); assert.deepEqual(errors, []);
    const report = { status: "passed", sdkVersion: "1.5.0-fork.1", nativePackageVersion: JSON.parse(await readFile(join(native, "package.json"))).version,
      cases, sdkEvents, observerHandlersReturnedUndefined: middlewareReturns.length, originalRuns: originals.length, oldRunOriginalsUnchanged: true,
      actualTreeAndReloadFenced: true, realModelTransport: transport, consumerDtoChanged: false, taskAcceptance: "not-checked", authorization: "none" };
    await writeFile(join(fixture, "report.json"), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report));
  } finally { mock.uninstall(); }
}

if (isMain(import.meta.url)) {
  const options = {};
  for (const arg of process.argv.slice(2)) {
    const match = /^--(sdk|native|observer|fixture)=(.+)$/u.exec(arg);
    if (!match || Object.hasOwn(options, match[1])) throw Error("invalid-subagent-owner-sdk-arguments");
    options[match[1]] = match[2];
  }
  if (options.fixture) await child(options);
  else console.log(JSON.stringify(await runSubagentOwnerSdk(options)));
}
