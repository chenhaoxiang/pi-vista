import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { chmod, lstat, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { after, test } from "node:test";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { BODY, NAMESPACE, RAW, ROOT, TOOLS, CanaryError, abortable, assertAbsent, constrainStream, createBudget, createFaultPort, createFixtureTools, createTrial, deferred, failureCode, ownedFailureSite, providerFailureCategory, fixtureRead, forbidConfigCommands, verifyReadonlyBroker, hash, memoryCatalog, parseCanaryOptions, privateEvidenceFiles, privateRead, profileSnapshot, profileComparison, readonlyCredentials, sdkPin, validateFixtureArguments } from "./pi-agent-canary-support.mjs";
import { explicitCanaryResources } from "./pi-agent-canary-resources.mjs";
import { trialWriteBoundary } from "./pi-agent-canary-writes.mjs";
import { canaryMain, observerIdle, quarantineDiagnostics, runRuntimeTrials } from "./pi-agent-canary.mjs";

// node:test runs this file in its own child; only test-created data below tmp is used.
const oldUmask = process.umask(0o077); after(() => { process.umask(oldUmask); });
const exec = promisify(execFile);
const args = () => ["--allow-live", "--sdk=/synthetic/sdk", "--profile-dir=/synthetic/profile", "--provider=synthetic-provider", "--model=synthetic-model", "--thinking=max", `--output-root=${path.join(ROOT, "tmp", NAMESPACE)}`, `--test-namespace=${NAMESPACE}`, `--source-sha=${"a".repeat(40)}`, "--max-model-rounds=16", "--deadline-ms=15000"];
const options = () => parseCanaryOptions(args());
const refused = (code = "assertion-failed") => error => failureCode(error) === code;
async function fixture(callback) {
  await mkdir(path.join(ROOT, "tmp"), { recursive: true });
  const directory = await mkdtemp(path.join(ROOT, "tmp", "canary-unit-"));
  try { return await callback(directory); } finally { await rm(directory, { recursive: true, force: true }); }
}
async function trial(directory) {
  for (const name of ["agent", "workspace", "observations"]) await mkdir(path.join(directory, name), { mode: 0o700 });
  for (const name of ["alpha", "beta"]) await writeFile(path.join(directory, "workspace", `${name}.txt`), BODY[name], { mode: 0o600 });
  return directory;
}

// Deliberately synthetic public-shape SDK. No installed SDK import, profile, auth or provider.
function mockSdk(change = {}) {
  const made = [], settings = [], managers = [];
  class Loader {
    constructor(config) { this.config = config; this.handlers = new Map(); }
    async reload() {
      this.handlers = new Map();
      const api = { on: (name, handler) => { const list = this.handlers.get(name) ?? []; list.push(handler); this.handlers.set(name, list); return () => {}; }, registerCommand() {} };
      for (const factory of this.config.extensionFactories) await factory(api);
    }
    async notify(event) { for (const handler of this.handlers.get(event.type) ?? []) await handler(event, {}); }
    getExtensions() { return { errors: [], warnings: [], extensions: [] }; }
    getSkills() { return { skills: [] }; } getPrompts() { return { prompts: [] }; }
    getThemes() { return { themes: [] }; } getAgentsFiles() { return { agentsFiles: [] }; }
  }
  class Session {
    constructor(config) {
      Object.assign(this, { config, model: config.model, thinkingLevel: config.thinkingLevel, sessionId: `synthetic-session-${made.length + 1}`, sessionFile: undefined, isStreaming: false, isIdle: true });
      this.listeners = new Set(); this.number = 0; this.nested = 0; this.messages = []; this.responses = 0;
      this.agent = { streamFunction: () => ({}), abort: () => this.controller?.abort() }; made.push(this);
    }
    async event(event) {
      for (const extension of this.config.resourceLoader.getExtensions().extensions) for (const handler of extension.handlers.get(event.type) ?? []) await handler(event, {});
      for (const listener of this.listeners) listener(event);
    }
    subscribe(listener) { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
    async bindExtensions() { await this.event({ type: "session_start", reason: "startup" }); }
    getAllTools() { return this.config.customTools; }
    getActiveToolNames() { return this.getAllTools().map(tool => tool.name); }
    getCallableToolNames() { return this.getAllTools().filter(tool => tool.exposure === "direct").map(tool => tool.name); }
    async runTool(name, params, parent) {
      const id = parent ? `${parent}/${++this.nested}` : `synthetic-call-${++this.number}`;
      const definition = this.config.customTools.find(tool => tool.name === name);
      await this.event({ type: "tool_execution_start", toolName: name, toolCallId: id, parentToolCallId: parent, args: params });
      let result, isError = false;
      try {
        result = await definition.execute(id, params, this.controller.signal, undefined, { tools: this.config.customTools.filter(tool => tool.exposure === "direct"), executeTool: (tool, input) => this.runTool(tool, input, id) });
      } catch (error) { isError = true; result = { content: [{ type: "text", text: failureCode(error) }], details: undefined }; }
      if (change.mutateArgs) params.privacy = "synthetic-mutation";
      if (change.mutateResult && !isError) result.content[0].text = "synthetic-mutation";
      await this.event({ type: "tool_execution_end", toolName: name, toolCallId: id, parentToolCallId: parent, result, isError });
      return { toolCall: { id, name }, result, isError };
    }
    prompt(prompt) {
      this.controller = new AbortController(); this.isStreaming = true; this.isIdle = false;
      this.pending = (async () => {
        await this.event({ type: "agent_start" });
        const name = /Call (canary_[a-z]+) exactly/.exec(prompt)[1], fixtureName = /fixture=([a-z]+)/.exec(prompt)[1];
        this.agent.streamFunction(this.model, {}, { reasoning: this.thinkingLevel, signal: this.controller.signal });
        const message = { role: "assistant", provider: this.model.provider, model: this.model.id, api: this.model.api, thinkingLevel: this.thinkingLevel, stopReason: "toolUse", content: [{ type: "toolCall", id: `synthetic-call-${this.number + 1}`, name }] };
        this.responses++; this.messages.push(message); await this.event({ type: "message_end", message });
        await this.runTool(name, { fixture: fixtureName, privacy: RAW[0] });
        if (this.controller.signal.aborted && change.abortTerminalError) {
          this.agent.streamFunction(this.model, {}, { reasoning: this.thinkingLevel, signal: this.controller.signal });
          const cancelled = { ...message, stopReason: "error", errorMessage: "synthetic cancellation", content: [] };
          this.responses++; this.messages.push(cancelled); await this.event({ type: "message_end", message: cancelled });
        }
        if (!this.controller.signal.aborted) {
          this.agent.streamFunction(this.model, {}, { reasoning: this.thinkingLevel, signal: this.controller.signal });
          const final = { ...message, stopReason: change.stopReason ?? "stop", content: [{ type: "text", text: change.wrongMarker ? "wrong-synthetic-marker" : /respond exactly (MODEL_BODY_CANARY [A-Z_-]+_OK)/.exec(prompt)[1] }] };
          this.responses++; this.messages.push(final); await this.event({ type: "message_end", message: final });
        }
      })().finally(async () => { await this.event({ type: "agent_end" }); this.isStreaming = false; this.isIdle = true; await this.event({ type: "agent_settled" }); });
      return this.pending;
    }
    async abort() { this.agent.abort(); await this.pending; }
    async waitForIdle() { await this.pending; }
    async reload() { await this.event({ type: "session_shutdown", reason: "reload" }); await this.config.resourceLoader.reload(); await this.event({ type: "session_start", reason: "reload" }); }
    getLastAssistantText() { return this.messages.at(-1)?.content.filter(block => block.type === "text").map(block => block.text).join(""); }
    getSessionStats() { return { tokens: { input: this.responses, output: this.responses, cacheRead: 0, cacheWrite: 0, total: this.responses * 2 }, cost: 0 }; }
  }
  return { made, settings, managers, sdk: {
    SettingsManager: { inMemory: (config, trust) => { settings.push(config); return { ...config, isProjectTrusted: () => trust?.projectTrusted ?? true }; } },
    createExtensionRuntime: () => ({}),
    SessionManager: { inMemory: cwd => { const manager = { cwd, persistence: "in-memory" }; managers.push(manager); return manager; } },
    DefaultResourceLoader: Loader,
    createAgentSession: async config => { assert.deepEqual(config.tools, TOOLS); assert.equal(config.noTools, "builtin"); return { session: new Session(config) }; },
    createAgentSessionRuntime: async (factory, target) => { const result = await factory(target); return { ...result, async dispose() { await result.session.event({ type: "session_shutdown", reason: "quit" }); } }; },
  } };
}
const model = { provider: "synthetic-provider", id: "synthetic-model", api: "synthetic-api" };

 test("pi-agent-canary refuses missing live opt-in before any SDK/profile or default writes", async () => {
  const report = await canaryMain(["--sdk=/nonexistent/private-sdk", "--profile-dir=/nonexistent/private-profile"]);
  assert.deepEqual(report, { schema: 1, status: "refused", actualRun: "not-run", failure: "live-required", authorization: "none", executable: false });
  await fixture(async directory => {
    const before = await readdir(directory);
    const result = await exec(process.execPath, [path.join(ROOT, "scripts/pi-agent-canary.mjs"), "--profile-dir=/nonexistent/private-profile"], { cwd: directory, env: { PATH: "/nonexistent" } }).catch(error => error);
    assert.equal(result.code, 1); assert.equal(result.stderr, ""); assert.equal(JSON.parse(result.stdout).actualRun, "not-run");
    assert.deepEqual(await readdir(directory), before); assertAbsent(result.stdout, ["/nonexistent/private-profile"]);
  });
});

test("pi-agent-canary option guards reject unknown, duplicate, missing, unsafe and unbounded modes", () => {
  assert.equal(Object.isFrozen(options()), true);
  for (const extra of ["--unknown", "--allow-live", "--provider=duplicate", "raw-command", "--allow-live=false"]) assert.throws(() => parseCanaryOptions([...args(), extra]), refused("invalid-config"));
  for (const [key, value] of [["sdk", "relative"], ["provider", "sk_synthetic"], ["model", "https://synthetic.invalid"], ["thinking", "fallback"], ["max-model-rounds", "33"], ["max-model-rounds", "0"], ["deadline-ms", "1200001"], ["source-sha", "not-a-sha"], ["test-namespace", "daily-sessions"], ["output-root", "/synthetic/operator"]]) {
    assert.throws(() => parseCanaryOptions(args().map(arg => arg.startsWith(`--${key}=`) ? `--${key}=${value}` : arg)));
  }
  assert.throws(() => parseCanaryOptions(args().filter(arg => !arg.startsWith("--thinking="))), refused("invalid-config"));
});

test("pi-agent-canary readonly credentials reject writes/OAuth/commands/missing provider without calling modifiers", async () => {
  let reads = 0, modifiers = 0; const auth = { "synthetic-provider": { type: "api_key", key: RAW[4] }, unrelated: { type: "oauth", access: "unused" } };
  const credentials = readonlyCredentials(model.provider, async () => { reads++; return JSON.stringify(auth); });
  assert.equal(await credentials.store.read("unrelated"), undefined); assert.equal(reads, 0); assert.deepEqual(await credentials.store.list(), []);
  assert.deepEqual(await credentials.store.read(model.provider), auth[model.provider]); credentials.assertAuth({ auth: { apiKey: RAW[4] } });
  assert.throws(() => credentials.assertAuth({ auth: { apiKey: "silent-fallback" } }), refused("credential-refused"));
  for (const operation of [() => credentials.store.modify(model.provider, async () => { modifiers++; }), () => credentials.store.delete(model.provider)]) await assert.rejects(operation(), refused("credential-write-forbidden"));
  assert.equal(modifiers, 0); assert.equal(credentials.counters.blockedWrites, 2); assert.throws(() => credentials.assertAbsent(JSON.stringify(auth)), refused());
  for (const credential of [undefined, { type: "api_key", key: RAW[4], env: { SYNTHETIC: "overlay" } }, { type: "oauth", access: "synthetic" }, { type: "api_key", key: "!synthetic-command" }, { type: "api_key", key: "$SYNTHETIC" }, { type: "api_key", key: "" }]) {
    const bad = readonlyCredentials(model.provider, async () => JSON.stringify({ [model.provider]: credential })); await assert.rejects(bad.store.read(model.provider), refused("credential-refused"));
  }
  auth[model.provider].key = "changed-synthetic-key"; await assert.rejects(credentials.store.read(model.provider), refused("credential-refused"));
});

test("pi-agent-canary model catalog is memory-only and command sources are refused before SDK loading", async () => {
  const catalog = memoryCatalog(); await catalog.store.write("synthetic", { models: [model] }); assert.deepEqual(await catalog.store.read("synthetic"), { models: [model] });
  await catalog.store.delete("synthetic"); assert.equal(await catalog.store.read("synthetic"), undefined); assert.deepEqual(catalog.counters, { reads: 2, writes: 1, deletes: 1 });
  forbidConfigCommands({ providers: { synthetic: { api: "synthetic-api", baseUrl: RAW[6] } } });
  assert.throws(() => forbidConfigCommands({ providers: [{ headers: { authorization: " !synthetic-command" } }] }), refused("config-command-refused"));
});

test("pi-agent-canary pinned readonly broker permits only the exact selected private single-file reader", async () => fixture(async directory => {
  const target = path.join(directory, "synthetic-key"); await writeFile(target, RAW[4], { mode: 0o600 });
  const command = `cat ${target}`, config = { providers: { [model.provider]: { apiKey: `!${command}`, models: [{ id: model.id }] }, unrelated: { apiKey: "!unrequested-command" } } };
  await verifyReadonlyBroker(config, model.provider, hash(command), directory);
  for (const [changed, pin] of [[config, "a".repeat(64)], [{ providers: { [model.provider]: { apiKey: `!${command}; echo unsafe` } } }, hash(`${command}; echo unsafe`)], [{ providers: { [model.provider]: { apiKey: `!${command}`, headers: { extra: "!unsafe-command" } } } }, hash(command)]]) await assert.rejects(verifyReadonlyBroker(changed, model.provider, pin, directory));
  await chmod(target, 0o644); await assert.rejects(verifyReadonlyBroker(config, model.provider, hash(command), directory), refused("private-file-required")); await chmod(target, 0o600);
  const missing = readonlyCredentials(model.provider, async () => "{}", true); assert.equal(await missing.store.read(model.provider), undefined);
  missing.assertAuth({ auth: { apiKey: RAW[4] } }); assert.throws(() => missing.assertAuth({ auth: { apiKey: "different" } }), refused("credential-refused"));
  assert.throws(() => missing.assertAbsent(RAW[4]), refused()); await assert.rejects(missing.store.modify(model.provider, async () => ({})), refused("credential-write-forbidden"));
}));

test("pi-agent-canary private profile reads reject permissions/symlinks and metadata detects drift", async () => fixture(async directory => {
  const file = path.join(directory, "auth.json"); await writeFile(file, "{}", { mode: 0o600 }); await writeFile(path.join(directory, "models.json"), "{}", { mode: 0o600 });
  const before = await profileSnapshot(directory); assert.equal(await privateRead(file), "{}"); assert.deepEqual(await profileSnapshot(directory), before);
  await chmod(file, 0o644); await assert.rejects(privateRead(file), refused("private-file-required")); await chmod(file, 0o600);
  await symlink(file, path.join(directory, "linked.json")); await assert.rejects(privateRead(path.join(directory, "linked.json")), refused("private-file-required"));
  await writeFile(file, "{\"synthetic\":true}"); assert.notDeepEqual(await profileSnapshot(directory), before);
}));

test("pi-agent-canary profile observation distinguishes volatile root metadata from protected-file mutation", () => {
  const before = { ".": [1, 2, 3, 0o700, 501, 10, 10], "auth.json": [1, 4, 5, 0o600, 501, 10, 10] };
  const after = { ...before, ".": [1, 2, 8, 0o700, 501, 11, 11] };
  assert.deepEqual(profileComparison(before, after), { metadataUnchanged: false, protectedFilesUnchanged: true, configurationFilesUnchanged: true, sharedCatalogMetadataUnchanged: true, changedEntries: ["."], directoryDriftAttribution: "unknown-concurrent-host" });
  assert.equal(profileComparison(before, { ...after, "auth.json": [1, 4, 6, 0o600, 501, 11, 11] }).protectedFilesUnchanged, false);
  assert.equal(profileComparison(before, { ...after, ".": [1, 9, 8, 0o700, 501, 11, 11] }).protectedFilesUnchanged, false);
  assert.equal(ownedFailureSite(new Error("private foreign /private/raw")), undefined);
});

test("pi-agent-canary write boundary refuses ordinary writes outside its owned trial and restores idempotently", async () => fixture(async directory => {
  const owned = path.join(directory, "owned"); await mkdir(owned, { mode: 0o700 });
  const boundary = trialWriteBoundary(owned); const { default: fs } = await import("node:fs"); const { default: promises } = await import("node:fs/promises");
  try {
    await promises.writeFile(path.join(owned, "safe.json"), "{}"); assert.equal(await readFile(path.join(owned, "safe.json"), "utf8"), "{}");
    for (const operation of [() => promises.writeFile(path.join(directory, "unsafe.json"), "private"), () => fs.writeFileSync(path.join(directory, "unsafe.json"), "private"), () => fs.openSync(path.join(directory, "unsafe.json"), "w"), () => fs.createWriteStream(path.join(directory, "unsafe.json")), () => promises.rename(path.join(owned, "safe.json"), path.join(directory, "unsafe.json"))]) {
      try { await operation(); assert.fail("write must be denied"); } catch (e) { assert.equal(failureCode(e), "unsafe-path"); }
    }
    assert.equal(boundary.counts.blockedOperations, 5); assert.ok(boundary.counts.permittedOperations > 0);
    assert.equal(await lstat(path.join(directory, "unsafe.json")).catch(() => null), null);
  } finally { boundary.restore(); boundary.restore(); }
  await writeFile(path.join(directory, "post-restore.json"), "{}");
}));

test("pi-agent-canary fixture reads reject traversal/outside/symlink/replacement and honor cancellation", async () => fixture(async directory => {
  await trial(directory); const workspace = path.join(directory, "workspace");
  assert.equal(await fixtureRead(workspace, "alpha"), BODY.alpha);
  for (const name of ["../auth", "/outside", "alpha.txt", "..", "unknown"]) await assert.rejects(fixtureRead(workspace, name), refused("fixture-refused"));
  const controller = new AbortController(); controller.abort(); await assert.rejects(fixtureRead(workspace, "alpha", controller.signal), refused("fixture-aborted"));
  await rm(path.join(workspace, "beta.txt")); await symlink(path.join(workspace, "alpha.txt"), path.join(workspace, "beta.txt")); await assert.rejects(fixtureRead(workspace, "beta"), refused("private-file-required"));
  await writeFile(path.join(workspace, "alpha.txt"), "unrecognized-synthetic-body"); await assert.rejects(fixtureRead(workspace, "alpha"), refused("fixture-refused"));
}));

test("pi-agent-canary fixed tool args refuse accessors/proxies/extra fields without traversing raw data", () => {
  const input = { fixture: "alpha", privacy: RAW[0] }; validateFixtureArguments(input, "alpha"); let gets = 0;
  const getter = Object.defineProperty({ privacy: RAW[0] }, "fixture", { get() { gets++; return "alpha"; } });
  const proxy = new Proxy(input, { get() { gets++; throw new Error(RAW[1]); } });
  for (const params of [getter, proxy, { ...input, path: RAW[7] }, { ...input, fixture: "../outside" }, Object.create(input)]) assert.throws(() => validateFixtureArguments(params, "alpha"), refused("fixture-refused"));
  assert.equal(gets, 0);
});

test("pi-agent-canary fixture-only parallel tools overlap and waiting/rendezvous release on abort", async () => fixture(async directory => {
  await trial(directory); const fixtures = createFixtureTools(path.join(directory, "workspace")), controller = new AbortController();
  let seq = 0; const ctx = { tools: fixtures.tools.filter(tool => tool.exposure === "direct"), executeTool: async (name, params) => ({ isError: false, result: await fixtures.tools.find(tool => tool.name === name).execute(`nested-${++seq}`, params, controller.signal) }) };
  const parent = await fixtures.tools[2].execute("parent", { fixture: "pair", privacy: RAW[0] }, controller.signal, undefined, ctx);
  assert.equal(parent.content[0].text, `${BODY.alpha}\n${BODY.beta}`); assert.equal(fixtures.maximumReads, 2);
  const waiting = fixtures.tools[3].execute("waiting", { fixture: "wait", privacy: RAW[0] }, controller.signal); await fixtures.waiting.started.promise;
  assert.equal(fixtures.waiting.active, true); controller.abort(); await assert.rejects(waiting, refused("fixture-aborted")); assert.equal(fixtures.waiting.signalReleased, true); assert.equal(fixtures.waiting.active, false);
  const blocked = new AbortController(), hold = abortable(new Promise(() => {}), blocked.signal); blocked.abort(); await assert.rejects(hold, refused("fixture-aborted"));
}));

test("pi-agent-canary budget blocks excess/different model/thinking BEFORE forwarding original request arguments", async () => {
  let clock = 0; const budget = createBudget({ ...options(), "max-model-rounds": 1 }, () => clock); let invoked = 0, forwarded;
  const session = { agent: { streamFunction: (...input) => { invoked++; forwarded = input; return "synthetic-stream"; } } }; constrainStream(session, budget);
  const context = {}, request = { reasoning: "max" }; assert.equal(session.agent.streamFunction(model, context, request), "synthetic-stream"); assert.deepEqual(forwarded, [model, context, request]); assert.equal(forwarded[1], context); assert.equal(forwarded[2], request);
  assert.throws(() => session.agent.streamFunction(model, context, request), refused("round-budget")); assert.equal(invoked, 1);
  for (const [changed, thinking] of [[{ ...model, provider: "different" }, "max"], [model, "minimal"]]) assert.throws(() => budget.take(changed, thinking), refused("model-drift"));
  clock = 15001; assert.throws(() => budget.remaining(), refused("deadline"));
  const short = createBudget({ ...options(), "deadline-ms": 10 }); const late = deferred(); await assert.rejects(short.wait(late.promise), refused("deadline")); late.reject(new Error(RAW[1])); await new Promise(resolve => setTimeout(resolve, 5));
});

test("pi-agent-canary faults repeat bounded reject/hang/late rejection and settle without unhandled failure", async () => {
  const port = createFaultPort(), attempts = [];
  for (let i = 0; i < 6; i++) attempts.push(port.call().catch(() => "synthetic-rejection-consumed"));
  assert.deepEqual(port.counts, { reject: 2, hang: 2, lateRejection: 2, released: 0 }); port.release(); await Promise.all(attempts);
  assert.equal(port.counts.released, 4); port.release(); assert.equal(port.counts.released, 4);
});

test("pi-agent-canary privacy rejects raw bodies, escaped private paths and arbitrary diagnostics without coercion", () => {
  assertAbsent(JSON.stringify({ authorization: "none", current: "MISSING", sdkVersion: "1.0.4" }));
  for (const marker of RAW) assert.throws(() => assertAbsent(JSON.stringify({ metadata: marker })), refused());
  assert.throws(() => assertAbsent(JSON.stringify({ detail: "synthetic\nprivate" }), ["synthetic\nprivate"]), refused());
  let gets = 0; const hostile = new Proxy({}, { get() { gets++; throw new Error(RAW[1]); } });
  assert.equal(failureCode(hostile), "external-failure"); assert.equal(failureCode(new Error(RAW[1])), "external-failure"); assert.equal(failureCode(new CanaryError("deadline")), "deadline"); assert.equal(gets, 0);
});

test("pi-agent-canary provider diagnostics are closed categories, never raw endpoint/error/credential output", () => {
  assert.equal(providerFailureCategory(`stream disconnected before response.completed ${RAW[6]} ${RAW[4]}`), "stream-disconnected");
  assert.equal(providerFailureCategory(`400 invalid tool_call_id ${RAW[7]}`), "request-contract");
  assert.equal(providerFailureCategory(`401 unauthorized ${RAW[4]}`), "authentication");
  assert.equal(providerFailureCategory(`429 quota ${RAW[4]}`), "quota");
  assert.equal(providerFailureCategory(undefined), "unspecified");
  assert.equal(providerFailureCategory(RAW[1]), "unclassified-provider-error");
});

test("pi-agent-canary SDK pin refuses unsupported Node/version/private entry using only dummy public files", async () => fixture(async directory => {
  await mkdir(path.join(directory, "dist")); await writeFile(path.join(directory, "dist/index.js"), "export const synthetic = true;\n");
  const manifest = { name: "@earendil-works/pi-coding-agent", version: "1.0.4", exports: { ".": { import: "./dist/index.js" } } };
  await writeFile(path.join(directory, "package.json"), JSON.stringify(manifest)); const pin = await sdkPin(directory, "26.9.0"); assert.match(pin.entrySha256, /^[a-f0-9]{64}$/);
  await assert.rejects(sdkPin(directory, "20.20.2"), refused("invalid-config")); await assert.rejects(sdkPin(directory, "22.18.0"), refused("invalid-config"));
  for (const bad of [{ ...manifest, version: "1.0.5" }, { ...manifest, exports: { ".": { import: "./dist/private.js" } } }]) { await writeFile(path.join(directory, "package.json"), JSON.stringify(bad)); await assert.rejects(sdkPin(directory, "26.9.0"), refused("invalid-config")); }
}));

test("pi-agent-canary explicit trial creation never follows a symlink output root", async () => fixture(async directory => {
  const root = path.join(directory, "owned"); const created = await createTrial(root);
  assert.equal((await lstat(created)).mode & 0o077, 0); assert.equal(await privateRead(path.join(created, "workspace/alpha.txt")), BODY.alpha);
  await symlink(root, path.join(directory, "linked")); await assert.rejects(createTrial(path.join(directory, "linked")), refused("unsafe-path"));
}));

test("pi-agent-canary host ResourceLoader contains only explicit supported declarations and constructs anew without discovery", async () => {
  let factories = 0, runtimes = 0;
  const loader = explicitCanaryResources({ createExtensionRuntime: () => ({ generation: ++runtimes }) }, api => {
    factories++; api.on("session_start", () => undefined); api.registerCommand("vista-status", { description: "safe", handler: async () => {} });
  }, "fixed synthetic prompt");
  await loader.reload(); const old = loader.getExtensions(); await loader.reload(); const current = loader.getExtensions();
  assert.notEqual(old, current); assert.equal(factories, 2); assert.equal(runtimes, 2); assert.equal(current.extensions[0].tools.size, 0);
  assert.deepEqual(loader.getSkills().skills, []); assert.deepEqual(loader.getAgentsFiles().agentsFiles, []); assert.equal(loader.getSystemPrompt(), "fixed synthetic prompt");
  assert.throws(() => loader.extendResources({ skillPaths: [{ path: "/private/no-read" }] }), refused());
  await assert.rejects(explicitCanaryResources({ createExtensionRuntime: () => ({}) }, api => api.on("tool_call", () => undefined), "fixed").reload(), refused());
});

test("pi-agent-canary synthetic runtime orchestration checks all lifecycle phases and exact private core readback", async () => fixture(async directory => {
  await trial(directory); const host = mockSdk(), config = options(), budget = createBudget(config);
  const result = await runRuntimeTrials(host.sdk, {}, model, config, directory, budget);
  assert.equal(host.made.length, 2); assert.equal(result[0].observerTimeoutMs, 500); assert.equal(result[1].observerTimeoutMs, 80); assert.equal(budget.attempts, 13); assert.equal(host.managers.every(manager => manager.persistence === "in-memory"), true);
  assert.equal(host.settings.every(setting => !setting.retry.enabled && setting.retry.provider.maxRetries === 0 && !setting.compaction.enabled && setting.cacheWarming === "off"), true);
  assert.deepEqual(result[0].phases.map(phase => phase.phase), ["startup", "parallel", "abort", "subsequent", "reload"]);
  assert.equal(new Set(result[0].phases.map(phase => phase.runId)).size, 5); assert.equal(result[0].sameSessionAfterAbort, true); assert.equal(result[0].reloadWithNewAddon, true);
  assert.equal(result[0].phases[1].nestedCalls, 2); assert.equal(result[0].phases[1].overlappingReads, 2); assert.equal(result[0].phases[2].signalReleased, true);
  assert.equal(result.every(scenario => scenario.awaitedShutdown && !scenario.lateRevival), true);
  assert.equal(result[1].phases.every(phase => phase.observation.dropped > 0 && phase.observation.persistedEvents === 0 && phase.observation.current === "MISSING"), true);
  assertAbsent(JSON.stringify(result), [directory, config.sdk, config["profile-dir"]]);
  const files = await privateEvidenceFiles(path.join(directory, "observations")); assert.ok(files.length > 0); for (const file of files) assertAbsent(file.text);
  assert.deepEqual(await readdir(path.join(directory, "agent")), []);
}));

test("pi-agent-canary synthetic prompts resolving cannot pass wrong marker, provider stop/error or mutated tool data", async () => {
  for (const change of [{ wrongMarker: true }, { stopReason: "error" }, { mutateArgs: true }, { mutateResult: true }]) await fixture(async directory => {
    await trial(directory); const host = mockSdk(change), config = options();
    await assert.rejects(runRuntimeTrials(host.sdk, {}, model, config, directory, createBudget(config)), refused());
  });
});

test("pi-agent-canary intended cancellation accepts SDK error stop only when both tool and actual request signals were aborted", async () => fixture(async directory => {
  await trial(directory); const host = mockSdk({ abortTerminalError: true }), config = options();
  const scenarios = await runRuntimeTrials(host.sdk, {}, model, config, directory, createBudget(config));
  const aborted = scenarios[0].phases.find(phase => phase.phase === "abort");
  assert.equal(aborted.finalStopReason, "error"); assert.equal(aborted.finalRequestSignalAborted, true); assert.equal(aborted.signalReleased, true);
  assert.equal(aborted.intendedCancellation, true); assert.equal(aborted.markerMatched, false);
  assert.equal(scenarios[0].phases.find(phase => phase.phase === "subsequent").finalStopReason, "stop");
}));

test("pi-agent-canary synthetic observer deadline and request exhaustion fail rather than manufacture acceptance", async () => fixture(async directory => {
  const short = createBudget({ ...options(), "deadline-ms": 15 });
  await assert.rejects(observerIdle({ status: () => ({ pending_work: 1, pending_callbacks: 0 }) }, short), refused("deadline"));
  await trial(directory); const config = { ...options(), "max-model-rounds": 1 };
  await assert.rejects(runRuntimeTrials(mockSdk().sdk, {}, model, config, directory, createBudget(config)), refused("round-budget"));
}));

test("pi-agent-canary imports and diagnostic quarantine do not disclose data or load a global SDK", async () => fixture(async directory => {
  const source = `await import(${JSON.stringify(pathToFileURL(path.join(ROOT, "scripts/pi-agent-canary.mjs")).href)});`;
  const before = await readdir(directory), imported = await exec(process.execPath, ["--input-type=module", "-e", source], { cwd: directory, env: { PATH: "/nonexistent" } });
  assert.equal(imported.stdout, ""); assert.equal(imported.stderr, ""); assert.deepEqual(await readdir(directory), before);
  const quarantine = quarantineDiagnostics(); let callback = false;
  try { process.stdout.write(RAW[1], () => { callback = true; }); process.stderr.write(RAW[4]); }
  finally { quarantine.restore(); }
  assert.equal(callback, true); assert.equal(quarantine.counters.stdoutWrites, 1); assert.equal(quarantine.counters.stderrWrites, 1);
}));
