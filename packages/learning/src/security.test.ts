import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createLearningLibrary, LearningError, MAX_STEPS, type ExperienceObservation, type LearningConfig, type LearningSink,
} from "@pi-vista/learning";
import { QUERY, learningFixture, ownerFixture, sampleObservation, verifiedExperience } from "./learning.fixtures.js";
const fails = (code: string) => (error: unknown) => error instanceof LearningError && error.code === code;

function checkFrozen(value: unknown): void {
  if (value === null || typeof value !== "object") return;
  assert.ok(Object.isFrozen(value));
  if (!Array.isArray(value)) assert.equal(Object.getPrototypeOf(value), null);
  for (const descriptor of Object.values(Object.getOwnPropertyDescriptors(value))) if (Object.hasOwn(descriptor, "value")) checkFrozen(descriptor.value);
}

test("ordinary/null-prototype and nonenumerable own data snapshot without mutating/freezing caller inputs", () => {
  const owner = ownerFixture(); const library = createLearningLibrary({ verifier: owner.verifier }); const input = sampleObservation();
  const nullInput = Object.assign(Object.create(null), input);
  Object.defineProperty(nullInput, "model_id", { value: "model-fixture", enumerable: false, writable: true });
  const handle = library.observe(nullInput); checkFrozen(handle); assert.equal(handle.model_id, "model-fixture"); assert.ok(!Object.isFrozen(input.script));
  (input.script as any).description = "changed-label"; (input.steps[0] as any).expected_result = "changed-result";
  assert.equal(handle.script.description, "bounded metadata validation"); assert.equal(handle.steps[0]!.expected_result, "observed");
});
test("all generated plans, lifecycle/replay/retrieval/context/evaluation views are deeply frozen safe records", async () => {
  const f = await learningFixture(); const plan = f.library.preparePromotion(f.verified, "fixture-bank");
  const replay = f.library.planReplay(f.verified, f.owner.expected); const selection = f.library.retrieve([f.verified], QUERY);
  const context = f.library.compileContext(selection); const evaluation = f.library.evaluateRetrieval([f.verified], [{ case_id: "fixture-case", query: QUERY, expected_ids: ["experience-1"] }]);
  for (const result of [plan, replay, selection, context, evaluation]) checkFrozen(result);
});
test("Proxies/revoked Proxies/accessors are rejected at every own-data seam without traps/getters", async () => {
  let calls = 0;
  const traps: ProxyHandler<object> = { get: () => { calls++; throw Error(); }, getPrototypeOf: () => { calls++; throw Error(); }, ownKeys: () => { calls++; throw Error(); }, getOwnPropertyDescriptor: () => { calls++; throw Error(); } };
  const proxy = new Proxy({}, traps); const revoked = Proxy.revocable({}, traps); revoked.revoke();
  const owner = ownerFixture(); const library = createLearningLibrary({ verifier: owner.verifier });
  for (const value of [proxy, revoked.proxy]) {
    assert.throws(() => createLearningLibrary(value as LearningConfig), fails("invalid-config"));
    assert.throws(() => createLearningLibrary({ verifier: value } as LearningConfig), fails("invalid-config"));
    assert.throws(() => createLearningLibrary({ verifier: owner.verifier, sink: value as LearningSink }), fails("invalid-config"));
    assert.throws(() => library.observe(value as ExperienceObservation), fails("invalid-input"));
    assert.throws(() => library.observe({ ...sampleObservation(), script: value } as ExperienceObservation), fails("invalid-input"));
    assert.throws(() => library.observe({ ...sampleObservation(), steps: value } as unknown as ExperienceObservation), fails("invalid-input"));
    assert.throws(() => library.retrieve(value as any, QUERY), fails("invalid-input"));
    assert.throws(() => library.retrieve([], value as any), fails("invalid-input"));
    assert.throws(() => library.compileContext(value as any), fails("stale-selection"));
    assert.throws(() => library.evaluateRetrieval([], value as any), fails("invalid-input"));
  }
  const input = sampleObservation(); Object.defineProperty(input, "experience_id", { get: () => { calls++; throw Error(); } });
  assert.throws(() => library.observe(input), fails("invalid-input"));
  const nested = sampleObservation(); Object.defineProperty(nested.steps[0], "tool", { get: () => { calls++; throw Error(); } });
  assert.throws(() => library.observe(nested), fails("invalid-input"));
  const config = { verifier: owner.verifier }; Object.defineProperty(config, "sink", { get: () => { calls++; throw Error(); } });
  assert.throws(() => createLearningLibrary(config), fails("invalid-config"));
  const verified = await verifiedExperience(library, owner); const plan = library.preparePromotion(verified, "fixture-bank");
  await assert.rejects(library.commitPromotion(proxy as any, { preview_digest: plan.preview_digest }), fails("invalid-plan"));
  await assert.rejects(library.commitPromotion(plan, proxy as any), fails("invalid-confirmation"));
  assert.equal(calls, 0);
});
test("inherited optional getters and custom object prototypes cannot contaminate snapshots", () => {
  let getters = 0; const owner = ownerFixture(); const library = createLearningLibrary({ verifier: owner.verifier });
  const input = sampleObservation(); const { model_id: _, ...withoutModel } = input;
  Object.defineProperty(Object.prototype, "model_id", { configurable: true, get: () => { getters++; throw Error(); } });
  try {
    const handle = library.observe(withoutModel); assert.equal(handle.model_id, undefined); assert.equal(getters, 0);
  } finally { delete (Object.prototype as any).model_id; }
  assert.throws(() => library.observe(Object.assign(Object.create({ inherited: "value" }), sampleObservation("custom-prototype"))), fails("invalid-input"));
});
test("symbols, undefined and unknown keys reject recursively before creating any handle", () => {
  const library = createLearningLibrary({ verifier: ownerFixture().verifier });
  for (const mutate of [
    (input: any) => { input[Symbol("hidden")] = "label"; }, (input: any) => { input.model_id = undefined; },
    (input: any) => { input.script.secret = "synthetic"; }, (input: any) => { input.script.description = undefined; },
    (input: any) => { input.steps[0].repair_action_id = "opaque-repair"; }, (input: any) => { input.steps[0].tool = undefined; },
    (input: any) => { input.script.known_failures[0][Symbol("hidden")] = "label"; },
  ]) {
    const input = sampleObservation(); mutate(input); assert.throws(() => library.observe(input), fails("invalid-input"));
  }
  assert.equal(library.observe(sampleObservation()).status, "observed");
});
test("sparse/custom/accessor/symbol arrays reject without iterators or accessors at every nested list", () => {
  let getters = 0; const library = createLearningLibrary({ verifier: ownerFixture().verifier });
  const sparse = new Array(1); const extra = ["safe-label"]; (extra as any).extra = "safe-label";
  const accessor = ["safe-label"]; Object.defineProperty(accessor, "0", { get: () => { getters++; throw Error(); } });
  const iterator = ["safe-label"]; Object.defineProperty(iterator, Symbol.iterator, { get: () => { getters++; throw Error(); } });
  const method = ["safe-label"]; Object.defineProperty(method, "map", { get: () => { getters++; throw Error(); } });
  const custom = Object.setPrototypeOf(["safe-label"], Object.create(Array.prototype));
  const undefinedItem = [undefined];
  for (const array of [sparse, extra, accessor, iterator, method, custom, undefinedItem]) {
    for (const mutate of [
      (input: any) => { input.script.preconditions = array; }, (input: any) => { input.steps[0].check_fn_ids = array; },
      (input: any) => { input.steps[0].depends_on = array; }, (input: any) => { input.script.known_failures = array; },
      (input: any) => { input.steps = array; },
    ]) {
      const input = sampleObservation(); mutate(input); assert.throws(() => library.observe(input), fails("invalid-input"));
    }
  }
  assert.equal(getters, 0);
});
for (const unsafe of ["/private/fixture", "https://example.invalid", "step;rm", "bash", "npm", "constructor", "raw\ncontent", "two  spaces",
  "wrapped_ghp_abcdefghijklmnop_suffix", "prefix_sk-abcdefghijklmnop", "prefix_xoxb-abcdefghijklmnop", "wrapped_AKIAABCDEFGHIJKLMNOP", "eyJabcdefghijklm.abcdefghijklmnop.abcdefghijklmnop"]) {
  test(`unsafe prose/path/command/wrapped-credential metadata ${JSON.stringify(unsafe)} is refused`, () => {
    const library = createLearningLibrary({ verifier: ownerFixture().verifier });
    for (const mutate of [(input: any) => { input.model_id = unsafe; }, (input: any) => { input.script.description = unsafe; }, (input: any) => { input.steps[0].action_description = unsafe; }]) {
      const input = sampleObservation(); mutate(input); assert.throws(() => library.observe(input), fails("invalid-input"));
    }
  });
}
test("array/item/metadata bounds, script task mismatch and non-forward dependencies fail closed", () => {
  const library = createLearningLibrary({ verifier: ownerFixture().verifier });
  for (const mutate of [
    (input: any) => { input.steps = []; }, (input: any) => { input.steps = Array(MAX_STEPS + 1).fill(input.steps[0]); },
    (input: any) => { input.script.steps = []; }, (input: any) => { input.script.task_type = "different-task"; },
    (input: any) => { input.script.description = "a".repeat(257); }, (input: any) => { input.experience_id = "a".repeat(129); },
    (input: any) => { input.ts = Infinity; }, (input: any) => { input.steps[1].step_id = "step-1"; },
    (input: any) => { input.steps[0].depends_on = ["step-2"]; }, (input: any) => { input.steps[1].depends_on = ["step-2"]; },
    (input: any) => { input.steps[1].depends_on = ["unknown-step"]; }, (input: any) => { input.steps[0].on_failure = "execute-repair"; },
    (input: any) => { input.script.preconditions = ["same-label", "same-label"]; },
  ]) { const input = sampleObservation(); mutate(input); assert.throws(() => library.observe(input), fails("invalid-input")); }
});
test("invalid config/options/callback descriptors are rejected before transport callbacks", () => {
  const owner = ownerFixture(); let calls = 0; const callback = async () => { calls++; return {}; };
  for (const config of [
    { verifier: owner.verifier, timeout_ms: 0 }, { verifier: owner.verifier, timeout_ms: 10_001 }, { verifier: owner.verifier, timeout_ms: undefined },
    { verifier: owner.verifier, sink: { ingest: callback } }, { verifier: owner.verifier, sink: { ingest: callback, readback: callback, extra: "label" } },
    { verifier: owner.verifier, sink: { ingest: true, readback: callback } }, { verifier: owner.verifier, trust: true },
  ]) assert.throws(() => createLearningLibrary(config as LearningConfig), fails("invalid-config"));
  assert.equal(calls, 0);
});
test("host config/caller mutation cannot redirect callbacks, banks or safe preview content", async () => {
  const owner = ownerFixture(); let originals = 0; let replacements = 0; let request: any;
  const sink: { ingest: LearningSink["ingest"]; readback: LearningSink["readback"] } = { ingest: async (value: any) => { originals++; request = value; return { document_id: "document-1", bank: value.bank, content_digest: value.content_digest, idempotency_key: value.idempotency_key }; },
    readback: async (receipt: any) => { originals++; return { ...receipt, title: request.title, content: request.content, tags: request.tags }; } };
  const library = createLearningLibrary({ verifier: owner.verifier, sink });
  sink.ingest = async () => { replacements++; return {}; }; sink.readback = async () => { replacements++; return {}; };
  const input = sampleObservation(); const candidate = library.nominate(library.observe(input));
  (input as any).repo = "changed-repo"; (input.script as any).description = "changed-metadata";
  const proof = await owner.verifier.verify(owner.expected, { gate: "gate-1", test: "suite-1", guard: "guard-1" });
  const verified = library.verifyCandidate(candidate, proof); const plan = library.preparePromotion(verified, "fixture-bank");
  assert.ok(plan.document.content.includes("bounded metadata validation")); assert.ok(!plan.document.content.includes("changed-metadata"));
  assert.equal((await library.commitPromotion(plan, { preview_digest: plan.preview_digest })).status, "trusted");
  assert.equal(originals, 2); assert.equal(replacements, 0);
});
test("malformed receipt/readback own-data rejects without invoking source getters", async () => {
  for (const phase of ["ingest", "readback"] as const) {
    const owner = ownerFixture(); let getters = 0; let request: any;
    const bad = Object.defineProperty({}, "document_id", { get: () => { getters++; throw Error(); } });
    const sink = { ingest: async (value: any) => { request = value; return phase === "ingest" ? bad : { document_id: "document-1", bank: value.bank, content_digest: value.content_digest, idempotency_key: value.idempotency_key }; },
      readback: async () => bad };
    const library = createLearningLibrary({ verifier: owner.verifier, sink }); const plan = library.preparePromotion(await verifiedExperience(library, owner), "fixture-bank");
    await assert.rejects(library.commitPromotion(plan, { preview_digest: plan.preview_digest }), fails("sink-mismatch")); assert.equal(getters, 0);
  }
});

test("forged Proxy handles/proofs never invoke traps in lifecycle, replay, statistics or verification", async () => {
  const owner = ownerFixture(); const library = createLearningLibrary({ verifier: owner.verifier }); let traps = 0;
  const proxy = new Proxy({}, { get: () => { traps++; throw Error(); }, ownKeys: () => { traps++; throw Error(); }, getPrototypeOf: () => { traps++; throw Error(); } });
  const candidate = library.nominate(library.observe(sampleObservation()));
  assert.throws(() => library.verifyCandidate(candidate, proxy as any), fails("unverified-evidence"));
  for (const call of [() => library.nominate(proxy as any), () => library.reject(proxy as any), () => library.deprecate(proxy as any),
    () => library.preparePromotion(proxy as any, "fixture-bank"), () => library.planReplay(proxy as any, owner.expected), () => library.modelStatistics([proxy as any])]) {
    assert.throws(call, fails("invalid-handle"));
  }
  assert.equal(traps, 0);
});

test("readback arrays/unknown fields/undefined/symbols and unsafe document IDs fail closed", async () => {
  for (const mutate of [
    (returned: any) => { returned.document_id = "wrapped_ghp_abcdefghijklmnop"; },
    (returned: any) => { returned.document_id = "/private/document"; },
    (returned: any) => { returned.extra = "safe-label"; }, (returned: any) => { returned.content = undefined; },
    (returned: any) => { returned[Symbol("hidden")] = "safe-label"; }, (returned: any) => { returned.tags = new Array(1); },
    (returned: any) => { returned.tags = Object.assign(["knowledge:skill"], { extra: "safe-label" }); },
  ]) {
    const owner = ownerFixture(); let request: any;
    const library = createLearningLibrary({ verifier: owner.verifier, sink: {
      ingest: async value => { request = value; return { document_id: "document-1", bank: value.bank, content_digest: value.content_digest, idempotency_key: value.idempotency_key }; },
      readback: async receipt => { const returned = { ...receipt, title: request.title, content: request.content, tags: request.tags }; mutate(returned); return returned; },
    } });
    const plan = library.preparePromotion(await verifiedExperience(library, owner), "fixture-bank");
    await assert.rejects(library.commitPromotion(plan, { preview_digest: plan.preview_digest }), fails("sink-mismatch"));
  }
});

test("bounded individually safe metadata cannot exceed the exact promotion document character cap", async () => {
  const owner = ownerFixture(); const library = createLearningLibrary({ verifier: owner.verifier }); const input: any = sampleObservation();
  const long = (prefix: string) => prefix + "a".repeat(128 - prefix.length);
  const values = Array.from({ length: 16 }, (_, index) => long(`label-${index}-`));
  const description = `${"a".repeat(127)} ${"b".repeat(128)}`;
  input.script.description = description; input.script.preconditions = values; input.script.steps = values;
  input.script.postconditions = values; input.script.applicable_to = values;
  input.script.known_failures = values.map((value: string) => ({ symptom: value, mitigation: value }));
  input.steps = values.map((value: string, index: number) => ({ step_id: value, tool: long("symbolic-tool-"), action_description: description,
    check_fn_ids: values, expected_result: long("symbolic-result-"), on_failure: "stop", depends_on: values.slice(0, index) }));
  const candidate = library.nominate(library.observe(input));
  const verified = library.verifyCandidate(candidate, await owner.verifier.verify(owner.expected, { gate: "gate-1", test: "suite-1", guard: "guard-1" }));
  assert.throws(() => library.preparePromotion(verified, "fixture-bank"), fails("invalid-input")); assert.equal(owner.calls.gate, 1);
});
