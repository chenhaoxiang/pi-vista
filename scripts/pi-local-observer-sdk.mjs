import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, normalize, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { EventStore } from "@pi-vista/core";
import { ROOT, commandEnvironment, createRunDirectory, isMain } from "./release-utils.mjs";

const ENTRY = join(ROOT, "scripts", "pi-local-observer.mjs");
const exec = promisify(execFile);
const digest = bytes => createHash("sha256").update(bytes).digest("hex");

/** Explicit installed-SDK acceptance; only synthetic provider streams and owned fixtures. */
export async function runLocalObserverSdk(sdkRoot) {
  if (typeof sdkRoot !== "string" || !isAbsolute(sdkRoot) || normalize(sdkRoot) !== sdkRoot || sdkRoot.includes("\0")) throw new Error("invalid-sdk-path");
  const output = await createRunDirectory("local-observer-sdk");
  const results = [];
  for (const scenario of ["normal", "storage-fault", "missing-head"]) {
    const fixture = join(output, scenario);
    await mkdir(fixture);
    const env = { ...commandEnvironment(), HOME: fixture, TMPDIR: fixture };
    try {
      const value = await exec(process.execPath, [import.meta.filename, `--sdk=${sdkRoot}`, `--fixture=${fixture}`, `--scenario=${scenario}`], {
        cwd: ROOT, env, timeout: 60_000, maxBuffer: 1024 * 1024, shell: false,
      });
      await writeFile(join(output, `${scenario}.stdout.json`), value.stdout);
      await writeFile(join(output, `${scenario}.stderr.log`), value.stderr);
      results.push(JSON.parse(value.stdout));
    } catch (error) {
      await writeFile(join(output, `${scenario}.stdout.json`), error.stdout ?? "");
      await writeFile(join(output, `${scenario}.stderr.log`), error.stderr ?? "");
      await writeFile(join(output, "failure.json"), JSON.stringify({ scenario, exit: error.code ?? null }));
      throw new Error(`local-observer-sdk-failed: ${scenario}; evidence=${output}`);
    }
  }
  const report = { schema: 1, status: "passed", source_sha256: digest(await readFile(ENTRY)),
    scope: "isolated-default-entry-sdk-notification", actual_default_installation: false,
    current_permission: false, bank_access: false, results };
  await writeFile(join(output, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  return { report, evidence: output };
}

async function child(sdkRoot, fixture, scenario) {
  assert.ok(["normal", "storage-fault", "missing-head"].includes(scenario));
  assert.ok(fixture.startsWith(join(ROOT, "tmp", "release-contract") + "/"));
  assert.equal(process.env.HOME, fixture);
  const sdk = await import(pathToFileURL(join(sdkRoot, "dist/index.js")).href);
  const loader = await import(pathToFileURL(join(sdkRoot, "dist/core/extensions/loader.js")).href);
  const { AssistantMessageEventStream } = await import(pathToFileURL(join(dirname(sdkRoot), "pi-ai/dist/utils/event-stream.js")).href);
  const packageInfo = JSON.parse(await readFile(join(sdkRoot, "package.json"), "utf8"));
  assert.equal(packageInfo.name, "@earendil-works/pi-coding-agent");
  const cwd = scenario === "missing-head" ? fixture : ROOT;
  if (scenario === "missing-head") await exec("/usr/bin/git", ["-c", "core.hooksPath=/dev/null", "init", "--initial-branch=main", fixture], { env: commandEnvironment(), shell: false });
  const modelRuntime = await sdk.ModelRuntime.create({ modelsPath: null, allowModelNetwork: false, refreshOnCreate: false,
    credentials: { async read() { return undefined; }, async list() { return []; }, async modify() { assert.fail("credential write"); }, async delete() { assert.fail("credential delete"); } },
    modelsStore: { async read() { return undefined; }, async write() {}, async delete() {} } });
  let transportCalls = 0;
  for (const method of ["stream", "streamSimple", "complete", "completeSimple"]) modelRuntime[method] = () => {
    transportCalls++; throw new Error("synthetic transport unexpectedly invoked");
  };
  modelRuntime.registerProvider("local-observer-fixture", { api: "openai-completions", baseUrl: "http://127.0.0.1:1", apiKey: "synthetic-no-network",
    models: [{ id: "fixture", name: "fixture", reasoning: true, input: ["text"], contextWindow: 8192, maxTokens: 128, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }] });
  let loaded;
  const contextShape = [];
  const resources = {
    getExtensions: () => loaded, getSkills: () => ({ skills: [], diagnostics: [] }),
    getPrompts: () => ({ prompts: [], diagnostics: [] }), getThemes: () => ({ themes: [], diagnostics: [] }),
    getAgentsFiles: () => ({ agentsFiles: [] }), getSystemPrompt: () => "Synthetic observer acceptance only",
    getSystemPromptSource: () => undefined, getAppendSystemPrompt: () => [], getAppendSystemPromptSources: () => [],
    extendResources(paths) { assert.ok(!Object.values(paths).some(value => value?.length)); },
    async reload() {
      loaded = await loader.loadExtensions([ENTRY], cwd, undefined, loader.createExtensionRuntime());
      assert.deepEqual(loaded.errors, []);
      const proof = await loader.loadExtensionFromFactory(pi => {
        pi.on("session_start", (_event, ctx) => {
          const descriptor = Object.getOwnPropertyDescriptor(ctx, "cwd");
          const commands = pi.getCommands();
          contextShape.push({ ownCwd: !!descriptor, accessor: typeof descriptor?.get === "function", cwdMatched: resolve(ctx.cwd) === resolve(cwd),
            commandsArray: Array.isArray(commands), observerCommands: commands.filter(c => c.name.startsWith("vista-")).length });
        });
      }, cwd, sdk.createEventBus(), loaded.runtime, "<inline:observer-context-check>");
      loaded.extensions.push(proof);
    },
  };
  if (scenario === "storage-fault") { await mkdir(join(fixture, ".pi")); await writeFile(join(fixture, ".pi/vista"), "synthetic non-directory"); }
  const proofFile = join(fixture, "native-proof.txt");
  await writeFile(proofFile, "PRIVATE_TOOL_BODY\n");
  await resources.reload();
  const { session, modelFallbackMessage } = await sdk.createAgentSession({ cwd, agentDir: fixture, modelRuntime,
    model: modelRuntime.getModel("local-observer-fixture", "fixture"), thinkingLevel: "high", tools: ["read"],
    resourceLoader: resources, sessionManager: sdk.SessionManager.inMemory(cwd),
    settingsManager: sdk.SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: false }, cacheWarming: "off", enableAnalytics: false, enableInstallTelemetry: false }, { projectTrusted: false }) });
  assert.equal(modelFallbackMessage, undefined);
  const errors = [];
  try {
    await session.bindExtensions({ mode: "json", onError: error => errors.push(error) });
    const before = { model: session.model, thinking: session.thinkingLevel, tools: session.getActiveToolNames(), prompt: session.systemPrompt };
    let rounds = 0;
    session.agent.streamFunction = () => {
      const first = rounds++ === 0;
      const stream = new AssistantMessageEventStream();
      const message = { role: "assistant", api: "openai-completions", provider: "local-observer-fixture", model: "fixture", timestamp: Date.now(),
        content: first ? [{ type: "toolCall", id: "fixture-call", name: "read", arguments: { path: proofFile } }] : [{ type: "text", text: "PRIVATE_MODEL_BODY" }],
        stopReason: first ? "toolUse" : "stop", usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
      stream.push({ type: "done", reason: message.stopReason, message }); stream.end(); return stream;
    };
    await session.prompt("PRIVATE_PROMPT_BODY", { expandPromptTemplates: false });
    await session.waitForIdle();
    const result = session.messages.filter(message => message.role === "toolResult").at(-1);
    assert.equal(Boolean(result.isError), false);
    assert.equal(result.content[0].text.trim(), "PRIVATE_TOOL_BODY");
    assert.equal(rounds, 2);
    assert.deepEqual({ model: session.model, thinking: session.thinkingLevel, tools: session.getActiveToolNames(), prompt: session.systemPrompt }, before);
    assert.equal(errors.length, 0);
    assert.equal(contextShape.length, 1);
    assert.ok(contextShape[0].ownCwd && contextShape[0].cwdMatched && contextShape[0].commandsArray, JSON.stringify(contextShape[0]));
    assert.equal(contextShape[0].observerCommands, 4);
    const store = new EventStore();
    assert.equal(store.baseDir, join(fixture, ".pi", "vista"));
    let events = [];
    const deadline = performance.now() + 5_000;
    if (scenario === "normal") {
      while (!events.some(event => event.action === "pi:agent-settled") || events.length < 5) {
        events = (await Promise.all((await store.listRuns()).map(run => store.readRun(run)))).flat();
        assert.ok(performance.now() < deadline, "default entry did not persist actual notifications");
        await delay(5);
      }
      assert.equal(events.length, 5);
      assert.ok(events.some(event => event.action === "pi:tool-execution-end" && event.result === "ok"));
      assert.ok(events.every(event => event.repo === "session-cwd" && event.source_sha));
      const raw = JSON.stringify(events);
      for (const privateValue of ["PRIVATE_TOOL_BODY", "PRIVATE_PROMPT_BODY", "PRIVATE_MODEL_BODY", proofFile, cwd]) assert.ok(!raw.includes(privateValue));
    } else {
      await delay(50);
      assert.deepEqual(await store.listRuns(), []);
    }
    assert.equal(transportCalls, 0);
    const report = { scenario, passed: true, sdk_version: packageInfo.version, node: process.version,
      context: contextShape[0], persisted_events: events.length, native_read_verified: true,
      primary_model_thinking_tools_prompt_preserved: true, synthetic_requests: rounds, intercepted_model_runtime_calls: transportCalls,
      authorization: "none", executable: false, default_path_isolated: true };
    process.stdout.write(`${JSON.stringify(report)}\n`);
  } finally { if (!session.isIdle) await session.abort(); session.dispose(); }
}

export function parseLocalObserverSdkOptions(args) {
  const values = {};
  for (const value of args) {
    const match = /^--(sdk|fixture|scenario)=(.+)$/u.exec(value);
    if (!match || Object.hasOwn(values, match[1])) throw new Error("usage: --sdk=<installed package root>");
    values[match[1]] = match[2];
  }
  if (!values.sdk || !isAbsolute(values.sdk) || normalize(values.sdk) !== values.sdk || values.sdk.includes("\0")) throw new Error("invalid-sdk-path");
  if ((values.fixture === undefined) !== (values.scenario === undefined)) throw new Error("invalid-fixture");
  if (values.fixture !== undefined && (!isAbsolute(values.fixture) || normalize(values.fixture) !== values.fixture || values.fixture.includes("\0") ||
      !values.fixture.startsWith(join(ROOT, "tmp", "release-contract") + "/"))) throw new Error("invalid-fixture");
  return values;
}

if (isMain(import.meta.url)) {
  try {
    const values = parseLocalObserverSdkOptions(process.argv.slice(2));
    if (values.fixture || values.scenario) { if (!values.fixture || !values.scenario) throw new Error("invalid-fixture"); await child(values.sdk, values.fixture, values.scenario); }
    else console.log(JSON.stringify(await runLocalObserverSdk(values.sdk)));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
