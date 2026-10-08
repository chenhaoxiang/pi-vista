import assert from "node:assert/strict";
import { test } from "node:test";
import { RAW, TOOLS, constrainStream, createBudget, failureCode } from "./pi-agent-canary-support.mjs";
import { canaryApi, selectedCanaryProvider, validateEffectiveCanaryModel, guardCanaryPayload, observeThinking } from "./pi-agent-canary-request.mjs";
const options = { provider: "synthetic-provider", model: "synthetic-model", thinking: "max", "deadline-ms": 1000, "max-model-rounds": 2 };
const definition = { id: options.model, reasoning: true, input: ["text"], contextWindow: 64000, maxTokens: 4096, thinkingLevelMap: { max: "max" } };
const config = () => ({ providers: { [options.provider]: { api: "openai-responses", baseUrl: "https://synthetic.invalid/v1", models: [{ ...definition }] } } });
const model = () => ({ ...definition, provider: options.provider, api: "openai-responses" });
const prompt = `${RAW[2]} Call canary_alpha exactly once`;
const context = { messages: [{ role: "user", content: prompt }] };
const payload = () => ({ model: options.model, input: [{ role: "user", content: [{ type: "input_text", text: prompt }] }], store: false, stream: true,
  tools: TOOLS.map(name => ({ type: "function", name })), reasoning: { effort: "max" } });
const refused = error => ["invalid-config", "model-drift", "fixture-refused", "config-command-refused"].includes(failureCode(error));
test("canary registers only a detached closed selected model/provider, never unselected commands or ambient JSON", () => {
  const input = config(); input.providers.unrelated = { apiKey: "!not-requested", models: [] };
  const selected = selectedCanaryProvider(input, options); assert.equal(selected.models.length, 1); assert.equal(selected.api, "openai-responses");
  input.providers[options.provider].models[0].thinkingLevelMap = { max: "none" };
  assert.equal(selected.models[0].thinkingLevelMap.max, "max"); assert.equal(Object.hasOwn(selected, "unrelated"), false);
  validateEffectiveCanaryModel(model(), options);
});
for (const field of ["samplingParams", "samplingParamsByThinkingLevel", "headers", "compat", "baseUrl"]) test(`canary rejects selected model request control ${field} before runtime construction`, () => {
  const c = config(); c.providers[options.provider].models[0][field] = field === "baseUrl" ? "https://synthetic-other.invalid" : { store: true };
  assert.throws(() => selectedCanaryProvider(c, options), refused);
});
for (const field of ["headers", "modelOverrides", "samplingParams", "authHeader", "streamSimple"]) test(`canary rejects selected provider envelope control ${field}`, () => {
  const c = config(); c.providers[options.provider][field] = { input: [] }; assert.throws(() => selectedCanaryProvider(c, options), refused);
});
for (const field of ["baseUrl", "apiKey"]) test(`canary rejects selected ${field} environment expansion`, () => {
  const c = config(); c.providers[options.provider][field] = "${SYNTHETIC_SECRET}"; assert.throws(() => selectedCanaryProvider(c, options), refused);
});
test("canary API accepts only the exercised public adapter, before any report label projection", () => {
  assert.equal(canaryApi("openai-responses"), "openai-responses");
  for (const api of ["sk-api-dummy1234", "synthetic-api", "openai-completions", undefined]) {
    assert.throws(() => canaryApi(api), refused); const c = config(); c.providers[options.provider].api = api;
    assert.throws(() => selectedCanaryProvider(c, options), refused);
  }
});
for (const field of ["store", "background", "tools", "model", "reasoning", "input", "previous_response_id"]) test(`actual provider payload cannot override ${field}`, () => {
  const p = payload(); const value = { store: true, background: true, tools: [{ type: "web_search_preview" }], model: "unapproved-model", reasoning: { effort: "none" }, input: [{ role: "user", content: "changed" }], previous_response_id: "foreign-response" }[field];
  p[field] = value; assert.throws(() => guardCanaryPayload(p, model(), context, "max"), refused);
});
test("actual provider guard validates the current user task, declared four functions and mapped effort", () => {
  const p = payload(); guardCanaryPayload(p, model(), context, "max");
  const mapped = { ...model(), thinkingLevelMap: { max: "xhigh" } }; p.reasoning.effort = "xhigh"; guardCanaryPayload(p, mapped, context, "max");
  p.tools.push({ type: "function", name: TOOLS[0] }); assert.throws(() => guardCanaryPayload(p, mapped, context, "max"), refused);
});
test("canary validates the FINAL public onPayload result before forwarding it, consuming no overridden payload", async () => {
  let returned; const original = payload();
  const session = { agent: { streamFunction: async (m, c, opts) => { returned = await opts.onPayload(original, m); return "stream"; } } };
  const evidence = constrainStream(session, createBudget(options), guardCanaryPayload);
  const controller = new AbortController();
  await assert.rejects(session.agent.streamFunction(model(), context, { reasoning: "max", signal: controller.signal, onPayload: p => ({ ...p, store: true }) }), refused);
  assert.equal(returned, undefined); assert.equal(evidence.requestSignalAborted(), false);
  controller.abort(); assert.equal(evidence.requestSignalAborted(), true);
});
test("effective thinking is observed before rejecting a clamp and is never copied from the requested level", () => {
  const evidence = { effectiveThinking: "not-captured" };
  assert.throws(() => observeThinking({ thinkingLevel: "high" }, options, evidence), refused);
  assert.equal(evidence.effectiveThinking, "high"); observeThinking({ thinkingLevel: "max" }, options, evidence);
  assert.equal(evidence.effectiveThinking, "max");
});
