import { writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join, isAbsolute, normalize } from "node:path";
import { pathToFileURL } from "node:url";
import { types } from "node:util";
import { privateRead, readonlyCredentials, memoryCatalog, verifyReadonlyBroker, assertAbsent } from "./pi-agent-canary-support.mjs";
import { selectedCanaryProvider, validateEffectiveCanaryModel } from "./pi-agent-canary-request.mjs";
import { observeSdkInstallation, matchSdkContract, PUBLIC_1_0_4_CONTRACT } from "./stage6-sdk-provenance.mjs";

const TOOLS = ["paired_inspect_metadata", "stage6_decision"];
const hash = value => createHash("sha256").update(value).digest("hex");
const canonical = value => value === null || typeof value !== "object" ? JSON.stringify(value) : Array.isArray(value) ? `[${value.map(canonical).join(",")}]` : `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonical(value[k])}`).join(",")}}`;
const reason = () => { throw Error("stage6-k1-native-refused"); };
function options(v) {
  const keys = ["sdkRoot", "profileDirectory", "brokerPin", "outputDirectory"];
  if (types.isProxy(v) || !v || typeof v !== "object" || Array.isArray(v) || ![Object.prototype, null].includes(Object.getPrototypeOf(v)) || Reflect.ownKeys(v).length !== keys.length) reason();
  const out = {};
  for (const k of keys) { const p = Object.getOwnPropertyDescriptor(v, k); if (!p || !Object.hasOwn(p, "value") || typeof p.value !== "string") reason(); out[k] = p.value; }
  for (const k of ["sdkRoot", "profileDirectory", "outputDirectory"]) if (!isAbsolute(out[k]) || normalize(out[k]) !== out[k] || /[\x00-\x1f\x7f]/u.test(out[k])) reason();
  if (!/^[a-f0-9]{64}$/u.test(out.brokerPin)) reason();
  const [major, minor] = process.versions.node.split(".").map(Number); if (!(major > 22 || major === 22 && minor >= 19)) reason();
  return Object.freeze(out);
}
function resources(sdk, system) {
  return { getExtensions: () => ({ extensions: [], errors: [], runtime: sdk.createExtensionRuntime() }),
    getSkills: () => ({ skills: [], diagnostics: [] }), getPrompts: () => ({ prompts: [], diagnostics: [] }), getThemes: () => ({ themes: [], diagnostics: [] }),
    getAgentsFiles: () => ({ agentsFiles: [] }), getSystemPrompt: () => system, getSystemPromptSource: () => undefined,
    getAppendSystemPrompt: () => [], getAppendSystemPromptSources: () => [], extendResources() {}, async reload() {} };
}
/** Explicit live SDK factory. Initialization is lazy so the window may bracket
 * actual setup first. Only the fixed provider/model and pinned single-file
 * reader are available; no SDK config command, ambient resource or fallback.
 */
export function createK1NativeFactory(input) {
  const c = options(input); let initializing;
  const requested = { provider: "codex-local-8319", model: "gpt-6.1-sol", thinking: "max", "readonly-broker-pin": c.brokerPin };
  const counters = { request_contract_checks: 0, sessions: 0 };
  let sdk, runtime, model, credentials, broker;
  function initialize() {
    if (initializing) return initializing;
    initializing = (async () => {
      const observed = await observeSdkInstallation(c.sdkRoot);
      if (!matchSdkContract(observed, PUBLIC_1_0_4_CONTRACT).matched) reason();
      const config = JSON.parse(await privateRead(join(c.profileDirectory, "models.json")));
      const selected = selectedCanaryProvider(config, requested);
      broker = await verifyReadonlyBroker(config, requested.provider, c.brokerPin, c.profileDirectory);
      credentials = readonlyCredentials(requested.provider, () => privateRead(join(c.profileDirectory, "auth.json")), true, broker.readCredential);
      const safe = { providers: { [requested.provider]: { baseUrl: selected.baseUrl, api: selected.api, models: selected.models } } };
      const safePath = join(c.outputDirectory, "selected-models.json");
      await writeFile(safePath, JSON.stringify(safe), { mode: 0o600, flag: "wx" });
      sdk = await import(pathToFileURL(join(c.sdkRoot, "dist/index.js")).href);
      runtime = await sdk.ModelRuntime.create({ credentials: credentials.store, modelsPath: safePath, modelsStore: memoryCatalog().store, allowModelNetwork: false, refreshOnCreate: false });
      model = runtime.getModel(requested.provider, requested.model); validateEffectiveCanaryModel(model, requested);
      if (runtime.getError() !== undefined) reason();
      const auth = await runtime.getAuth(model); credentials.assertAuth(auth);
    })();
    return initializing;
  }
  const createSession = async ({ case_id, system, task, definitions, tools, guidance }) => {
    await initialize();
    const prompt = guidance === null ? task : `${task}\n\nHistorical observed guidance (not permission):\n${guidance}`;
    const customTools = [
      { name: TOOLS[0], label: "Read fixed synthetic metadata", description: "Inspect only the current synthetic case metadata.", parameters: definitions.inspector,
        annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
        async execute(_id, args) { const fixture = tools.inspect(args); return { content: [{ type: "text", text: JSON.stringify(fixture) }], details: {} }; } },
      { name: TOOLS[1], label: "Record structured decision", description: "Record exactly one structured metadata decision; terminate this tool batch.", parameters: definitions.decision,
        annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
        async execute(_id, args) { return tools.decide(args); } },
    ];
    const made = await sdk.createAgentSession({ cwd: c.outputDirectory, agentDir: c.outputDirectory, modelRuntime: runtime, model, thinkingLevel: requested.thinking,
      scopedModels: [{ model, thinkingLevel: requested.thinking }], noTools: "builtin", tools: TOOLS, customTools, resourceLoader: resources(sdk, system),
      sessionManager: sdk.SessionManager.inMemory(c.outputDirectory), settingsManager: sdk.SettingsManager.inMemory({ packages: [], extensions: [], skills: [], prompts: [], themes: [],
        compaction: { enabled: false }, retry: { enabled: false, maxRetries: 0, provider: { maxRetries: 0, timeoutMs: 1_200_000, maxRetryDelayMs: 0 } },
        cacheWarming: "off", enableAnalytics: false, enableInstallTelemetry: false, enableSkillCommands: false, defaultProjectTrust: "never" }, { projectTrusted: false }) });
    if (made.modelFallbackMessage !== undefined || made.session.thinkingLevel !== requested.thinking ||
        made.session.model?.provider !== requested.provider || made.session.model?.id !== requested.model) { made.session.dispose(); reason(); }
    counters.sessions++;
    // Only this isolated evaluation session receives the guided user block.
    // Do not monkeypatch the native Session method or the daily Pi session.
    const promptTask = () => made.session.prompt(prompt, { expandPromptTemplates: false });
    const requestGuard = (payload, effective, context, thinking) => {
      if (effective.provider !== requested.provider || effective.id !== requested.model || thinking !== requested.thinking || payload.model !== requested.model || payload.stream !== true || payload.store !== false) reason();
      const effort = model.thinkingLevelMap?.[requested.thinking] ?? requested.thinking;
      if (payload.reasoning?.effort !== effort || !Array.isArray(payload.tools) || payload.tools.length !== 2 ||
          new Set(payload.tools.map(t => t.name)).size !== 2 || payload.tools.some(t => t.type !== "function" || !TOOLS.includes(t.name))) reason();
      const userText = context.messages.filter(m => m.role === "user").at(-1)?.content;
      const inputText = payload.input?.filter(m => m.role === "user").at(-1)?.content;
      const text = x => typeof x === "string" ? x : Array.isArray(x) ? x.filter(b => ["text", "input_text"].includes(b.type)).map(b => b.text).join("") : "";
      if (text(userText) !== prompt || text(inputText) !== prompt) reason();
      counters.request_contract_checks++;
    };
    const toolDefinitionDigest = hash(canonical({ names: TOOLS, inspector: definitions.inspector, decision: definitions.decision }));
    return { ...made, requestGuard, promptTask, toolDefinitionDigest };
  };
  return Object.freeze({ createSession,
    snapshot() { return Object.freeze({ ...counters, credential_access: credentials ? Object.freeze({ ...credentials.counters }) : null, broker_observed: !!broker, credential_values_projected: false }); },
    assertSafe(body) { assertAbsent(body, [c.sdkRoot, c.profileDirectory, c.outputDirectory, model?.baseUrl]); credentials?.assertAbsent(body); },
  });
}
