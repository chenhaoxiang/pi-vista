import { CanaryError, RAW, TOOLS, requireCanary } from "./pi-agent-canary-support.mjs";

export function canaryApi(value) {
  // This operational canary has only been exercised with this public request adapter.
  requireCanary(value === "openai-responses", "model-drift"); return value;
}
function closed(value, keys) {
  requireCanary(value !== null && typeof value === "object" && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value)), "invalid-config");
  requireCanary(Object.keys(value).every(key => keys.includes(key)), "invalid-config"); return value;
}
function positive(value) { requireCanary(Number.isSafeInteger(value) && value > 0 && value <= 10000000, "invalid-config"); return value; }
function noExpansion(value) {
  if (typeof value === "string") requireCanary(!value.includes("$") && !value.trimStart().startsWith("!"), "config-command-refused");
  else if (value && typeof value === "object") for (const item of Object.values(value)) noExpansion(item);
}
/** Snapshot only the selected provider/model; no ambient file is handed back to the SDK. */
export function selectedCanaryProvider(config, options) {
  requireCanary(config?.providers && Object.hasOwn(config.providers, options.provider), "invalid-config");
  const provider = closed(config.providers[options.provider], ["baseUrl", "api", "apiKey", "models"]);
  canaryApi(provider.api);
  requireCanary(typeof provider.baseUrl === "string" && !provider.baseUrl.includes("$") && !provider.baseUrl.trimStart().startsWith("!"), "invalid-config");
  const url = new URL(provider.baseUrl);
  requireCanary(["https:", "http:"].includes(url.protocol) && !url.username && !url.password && !url.search && !url.hash, "invalid-config");
  requireCanary(url.protocol === "https:" || ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname), "invalid-config");
  requireCanary(Array.isArray(provider.models) && provider.models.length > 0 && provider.models.length <= 128, "invalid-config");
  const matches = provider.models.filter(model => model?.id === options.model); requireCanary(matches.length === 1, "invalid-config");
  const model = closed(matches[0], ["id", "name", "api", "reasoning", "input", "contextWindow", "maxTokens", "cost", "thinkingLevelMap"]);
  if (model.api !== undefined) canaryApi(model.api);
  noExpansion(model);
  requireCanary(typeof model.reasoning === "boolean" && Array.isArray(model.input) && model.input.length > 0 && model.input.every(value => ["text", "image"].includes(value)), "invalid-config");
  const levelMap = model.thinkingLevelMap;
  if (levelMap !== undefined) {
    closed(levelMap, ["off", "minimal", "low", "medium", "high", "xhigh", "max"]);
    for (const value of Object.values(levelMap)) requireCanary(value === null || ["none", "off", "minimal", "low", "medium", "high", "xhigh", "max"].includes(value), "invalid-config");
  }
  const cost = model.cost ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
  closed(cost, ["input", "output", "cacheRead", "cacheWrite"]);
  for (const key of ["input", "output", "cacheRead", "cacheWrite"]) requireCanary(Number.isFinite(cost[key]) && cost[key] >= 0, "invalid-config");
  if (provider.apiKey !== undefined) {
    requireCanary(typeof provider.apiKey === "string" && !provider.apiKey.includes("$"), "config-command-refused");
    if (options["readonly-broker-pin"] === undefined) noExpansion(provider.apiKey);
  }
  return { baseUrl: provider.baseUrl, api: provider.api, ...(provider.apiKey === undefined ? {} : { apiKey: provider.apiKey }), models: [{
    id: options.model, name: options.model, api: provider.api, reasoning: model.reasoning, input: [...model.input],
    contextWindow: positive(model.contextWindow), maxTokens: positive(model.maxTokens), cost: { ...cost },
    ...(levelMap === undefined ? {} : { thinkingLevelMap: { ...levelMap } }),
  }] };
}
export function validateEffectiveCanaryModel(model, options) {
  canaryApi(model?.api);
  requireCanary(model.provider === options.provider && model.id === options.model, "model-drift");
  for (const key of ["headers", "samplingParams", "samplingParamsByThinkingLevel", "compat"]) requireCanary(model[key] === undefined, "invalid-config");
}
const payloadKeys = ["model", "input", "stream", "store", "prompt_cache_key", "prompt_cache_retention", "prompt_cache_options", "max_output_tokens", "tools", "reasoning", "include"];
const plainText = content => typeof content === "string" ? content : Array.isArray(content) ? content.filter(block => ["text", "input_text"].includes(block.type)).map(block => block.text).join("") : "";
/** Called by the actual provider after named fields/sampling merge and before HTTP transport. */
export function guardCanaryPayload(payload, model, context, thinking) {
  closed(payload, payloadKeys);
  requireCanary(payload.model === model.id && payload.store === false && payload.stream === true && Array.isArray(payload.input), "model-drift");
  const expectedEffort = model.thinkingLevelMap?.[thinking] ?? (thinking === "off" ? "none" : thinking);
  requireCanary(payload.reasoning?.effort === expectedEffort, "model-drift");
  requireCanary(Array.isArray(payload.tools) && payload.tools.length === TOOLS.length && payload.tools.every(tool => tool.type === "function" && TOOLS.includes(tool.name)) && new Set(payload.tools.map(tool => tool.name)).size === TOOLS.length, "fixture-refused");
  const expectedText = plainText(context.messages.filter(message => message.role === "user").at(-1)?.content);
  const actualText = plainText(payload.input.filter(message => message.role === "user").at(-1)?.content);
  requireCanary(expectedText.startsWith(`${RAW[2]} Call canary_`) && actualText === expectedText, "fixture-refused");
}
export function observeThinking(session, options, evidence) {
  const actual = session.thinkingLevel;
  evidence.effectiveThinking = ["off", "minimal", "low", "medium", "high", "xhigh", "max"].includes(actual) ? actual : "not-captured";
  requireCanary(actual === options.thinking, "model-drift");
}
