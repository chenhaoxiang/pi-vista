import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { prepareHistoricalGuidance } from "@pi-vista/learning/guidance";
import { createLocalEvidenceVerifier } from "@pi-vista/evidence/host";
import { createLocalLearningLibrary } from "@pi-vista/learning/local";
import { buildK1HistoryContext } from "./stage6-k1-history-context.mjs";
import { snapshotHistoryContext } from "./stage6-k1-admission.mjs";

const sha = value => createHash("sha256").update(value).digest("hex");
const canonical = value => value === null || typeof value !== "object" ? JSON.stringify(value) : Array.isArray(value) ? `[${value.map(canonical).join(",")}]` : `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
const contextHeader = "authorization=none\nexecutable=false\nmode=local-script-step-context\nbudget=characters-not-tokens\n";
const source = "a".repeat(40), env = sha("env");
const experience = { experience_id: "experience-1", run_id: "run-1", repo: "pi-vista", source_sha: source, policy_version: "stage5-policy", env_fingerprint: env, task_type: "metadata-validation", ts: 1,
  script: { task_type: "metadata-validation", description: "validate fixture metadata", preconditions: [], steps: ["inspect-fixture"], postconditions: [], known_failures: [], applicable_to: [] },
  steps: [{ step_id: "fixture-step", tool: "fixture-reader", action_description: "inspect fixture metadata", check_fn_ids: [], expected_result: "observed", on_failure: "stop", depends_on: [] }] };
const prepared = prepareHistoricalGuidance(experience);
function history(overrides = {}, bank = "fixture-bank") {
  const document = { ...prepared };
  const guidance = { schema: 1, purpose: "historical-guidance", current_verification: "not-checked", authorization: "none", executable: false, experience };
  const idempotency_key = `guidance-${sha(canonical({ bank, document }))}`;
  return { bank, document_id: `vista-guidance-v1-${"b".repeat(16)}-${sha(idempotency_key)}`, current_verification: "not-checked", authorization: "none", executable: false, content_digest: document.content_digest, idempotency_key, document, guidance, ...overrides };
}
function context(overrides = {}) {
  const provenance = [{ run_id: "run-2", repo: "pi-vista", source_sha: source, policy_version: "stage5-policy", env_fingerprint: env, experience_id: "experience-current", status: "verified", scope: "fixture-scope", observation_digests: [sha("observation")] }];
  const value = { mode: "local-script-step-context", authorization: "none", executable: false, budget_unit: "characters", max_characters: 16_384, item_count: 1, selected_ids: ["experience-current"], omitted_ids: [], provenance, ...overrides };
  if (!Object.hasOwn(overrides, "content")) value.content = `${contextHeader}${canonical({ authorization: "none", executable: false, provenance: value.provenance[0], script: experience.script, steps: experience.steps })}\n`;
  if (!Object.hasOwn(overrides, "character_count")) value.character_count = value.content.length;
  return value;
}
async function actualPublicLocalContext(description = "validate fixture metadata") {
  const current = { ...experience, experience_id: "experience-current", run_id: "run-2", script: { ...experience.script, description } };
  const gate = { schema: 1, scope: "fixture-scope", kind: "gate", producer: "fixture-gate", run_id: "run-2", repo: "pi-vista", source_sha: source, policy_version: "stage5-policy", env_fingerprint: env, result_ref: "fixture-gate-result", observed_at: 900, expires_at: 10_000,
    details: { verdict: "pass", gate_version: "b".repeat(40), config_digest: "c".repeat(64), checks: [{ name: "fixture-build", outcome: "pass" }] } };
  const test = { schema: 1, scope: "fixture-scope", kind: "test", producer: "fixture-test", run_id: "run-2", repo: "pi-vista", source_sha: source, policy_version: "stage5-policy", env_fingerprint: env, result_ref: "fixture-test-result", observed_at: 900, expires_at: 10_000,
    details: { suites: [{ name: "fixture-cases", total: 1, passed: 1, failed: 0, skipped: 0, cancelled: 0, todo: 0 }] } };
  const guard = { schema: 1, scope: "fixture-scope", kind: "guard", producer: "fixture-guard", run_id: "run-2", repo: "pi-vista", source_sha: source, policy_version: "stage5-policy", env_fingerprint: env, result_ref: "fixture-guard-result", observed_at: 900, expires_at: 10_000,
    details: { coverage: "complete", event_count: 1, blocked: 0, dropped: 0 } };
  const verifier = createLocalEvidenceVerifier({ mode: "local-host", scope: "fixture-scope", gate_checks: ["fixture-build"], gate_version: "b".repeat(40), gate_config_digest: "c".repeat(64), test_suites: ["fixture-cases"], now: () => 1_000,
    sources: [{ subject: "fixture-gate", producer: "fixture-gate", kind: "gate", collect: async () => gate }, { subject: "fixture-test", producer: "fixture-test", kind: "test", collect: async () => test }, { subject: "fixture-guard", producer: "fixture-guard", kind: "guard", collect: async () => guard }] });
  let reads = 0, retains = 0;
  const stored = history();
  const store = { read: async () => { reads++; return stored; }, retain: async () => { retains++; throw Error("fixture-no-write"); }, query: async () => { throw Error("fixture-no-query"); }, reconcile: async () => { throw Error("fixture-no-reconcile"); } };
  const library = createLocalLearningLibrary({ mode: "local-learning", scope: "fixture-scope", verifier, store });
  try {
    const reference = { bank: stored.bank, document_id: stored.document_id, current_verification: "not-checked", authorization: "none", executable: false };
    const readback = await library.readGuidance(reference);
    const observed = description === experience.script.description
      ? library.importGuidance(readback, { run_id: "run-2", repo: "pi-vista", source_sha: source, policy_version: "stage5-policy", env_fingerprint: env, experience_id: "experience-current", ts: 2 })
      : library.observe(current);
    assert.equal(observed.status, "observed"); assert.equal(observed.verification, undefined);
    const candidate = library.nominate(observed); const proof = await verifier.verify({ run_id: "run-2", repo: "pi-vista", source_sha: source, policy_version: "stage5-policy", env_fingerprint: env }, { gate: "fixture-gate", test: "fixture-test", guard: "fixture-guard" });
    const verified = library.verifyCandidate(candidate, proof);
    const compiled = library.compileContext(library.retrieve([verified], { repo: "pi-vista", source_sha: source, policy_version: "stage5-policy", env_fingerprint: env, task_type: "metadata-validation" }), { max_items: 1 });
    assert.equal(reads, 1); assert.equal(retains, 0); return compiled;
  } finally { library.shutdown(); verifier.shutdown(); }
}

test("bridge returns the existing stage6-history-context/1 DTO only", () => {
  const result = buildK1HistoryContext({ history: history(), context: context() });
  assert.deepEqual(Object.keys(result).sort(), ["authorization", "character_count", "content_digest", "context_digest", "current_verification", "executable", "provenance_digests", "purpose", "schema", "subject_source_sha"].sort());
  assert.equal(result.schema, "stage6-history-context/1"); assert.equal(result.content_digest, history().content_digest); assert.equal(result.subject_source_sha, source);
  assert.equal(result.context_digest, sha(context().content)); assert.equal(result.character_count, context().content.length); assert.equal(result.provenance_digests.length, 1);
  assert.equal(result.current_verification, "not-checked"); assert.equal(result.authorization, "none"); assert.equal(result.executable, false);
  for (const forbidden of ["content", "document", "guidance", "selected_ids", "path", "proof", "permission", "budget", "idempotency_key"]) assert.equal(Object.hasOwn(result, forbidden), false);
});
test("positive input uses the public LOCAL compileContext contract while keeping three run layers separate", async () => {
  const compiled = await actualPublicLocalContext();
  assert.equal(compiled.mode, "local-script-step-context"); assert.equal(compiled.item_count, 1); assert.equal(compiled.omitted_ids.length, 0);
  assert.equal(compiled.provenance.length, 1); assert.equal(compiled.provenance[0].run_id, "run-2"); assert.notEqual(compiled.provenance[0].run_id, experience.run_id);
  const result = buildK1HistoryContext({ history: history(), context: compiled });
  assert.equal(result.schema, "stage6-history-context/1"); assert.equal(result.subject_source_sha, source); assert.equal(result.authorization, "none"); assert.equal(result.executable, false);
});
test("current compilation cannot reuse the historical run or experience identity", () => {
  for (const changed of [{ run_id: experience.run_id }, { experience_id: experience.experience_id }]) {
    const p = { ...context().provenance[0], ...changed };
    assert.throws(() => buildK1HistoryContext({ history: history(), context: context({ provenance: [p], selected_ids: [p.experience_id] }) }), /stage6-k1-history-context-refused/);
  }
});
test("public LOCAL compiled script substitution is rejected rather than silently relabeled", async () => {
  const compiled = await actualPublicLocalContext("tampered compiled guidance");
  assert.throws(() => buildK1HistoryContext({ history: history(), context: compiled }), /stage6-k1-history-context-refused/);
});
test("history document digest and source binding are checked without creating current proof", () => {
  const good = buildK1HistoryContext({ history: history(), context: context() }); assert.deepEqual(buildK1HistoryContext({ history: JSON.parse(JSON.stringify(history())), context: JSON.parse(JSON.stringify(context())) }), good);
  for (const bad of [
    history({ content_digest: sha("other") }), history({ idempotency_key: `guidance-${sha("other-key")}` }),
    history({}, "invalid/bank"), history({}, "wrapped_ghp_abcdefghijklmnop_suffix"),
    history({ guidance: { ...history().guidance, schema: 2 } }), history({ guidance: { ...history().guidance, purpose: "current-guidance" } }),
    history({ document_id: `vista-guidance-v1-${"b".repeat(16)}-${sha("other-id")}` }),
    history({ document: { ...history().document, content: "different" } }),
    history({ guidance: { ...history().guidance, current_verification: "verified" } }),
    history({ guidance: { ...history().guidance, authorization: "approved" } }),
    history({ guidance: { ...history().guidance, executable: true } }),
    history({ guidance: { ...history().guidance, experience: { ...history().guidance.experience, source_sha: "e".repeat(40) } } }),
    history({ document: { ...history().document, tags: ["pi-vista:guidance-v1", "unexpected"] } }),
  ]) assert.throws(() => buildK1HistoryContext({ history: bad, context: context() }), /stage6-k1-history-context-refused/);
});
test("compiled context digest is independent from history content digest", () => {
  const a = buildK1HistoryContext({ history: history(), context: context() });
  const b = buildK1HistoryContext({ history: history(), context: context({ provenance: [{ ...context().provenance[0], observation_digests: [sha("other-observation")] }] }) });
  assert.equal(a.content_digest, b.content_digest); assert.notEqual(a.context_digest, b.context_digest); assert.equal(a.subject_source_sha, b.subject_source_sha);
});
test("compiled context mode/budget/item/provenance/raw/path fields refuse", () => {
  for (const bad of [
    { mode: "other" }, { authorization: "approved" }, { executable: true }, { budget_unit: "tokens" },
    { character_count: 0 }, { character_count: context().content.length + 1 }, { max_characters: 16_385 }, { item_count: 0 },
    { selected_ids: ["/private/path"] }, { selected_ids: [] }, { omitted_ids: ["../secret"] },
    { provenance: [] }, { provenance: [{ ...context().provenance[0], status: "observed" }] },
    { provenance: [{ ...context().provenance[0], policy_version: "other-policy" }] },
    { provenance: [{ ...context().provenance[0], observation_digests: ["not-a-digest"] }] },
  ]) assert.throws(() => buildK1HistoryContext({ history: history(), context: context(bad) }), /stage6-k1-history-context-refused/);
  const multi = context({ item_count: 2, selected_ids: ["experience-1", "experience-2"], provenance: [context().provenance[0], { ...context().provenance[0], experience_id: "experience-2" }] });
  assert.throws(() => buildK1HistoryContext({ history: history(), context: multi }), /stage6-k1-history-context-refused/);
});
test("closed own-data/proxy/accessor/unknown fields refuse before trusted data traversal", () => {
  let calls = 0;
  const extra = { ...history(), raw: "PRIVATE_RAW" }; assert.throws(() => buildK1HistoryContext({ history: extra, context: context() }), /stage6-k1-history-context-refused/);
  const proxy = new Proxy(history(), { ownKeys() { calls++; throw Error("PRIVATE"); }, get() { calls++; throw Error("PRIVATE"); } });
  assert.throws(() => buildK1HistoryContext({ history: proxy, context: context() }), /stage6-k1-history-context-refused/);
  const accessor = { history: history(), context: context() }; Object.defineProperty(accessor, "context", { get() { calls++; throw Error("PRIVATE"); } });
  assert.throws(() => buildK1HistoryContext(accessor), /stage6-k1-history-context-refused/); assert.equal(calls, 0);
});
test("baseline/null history is not silently converted into a guided DTO", () => {
  assert.throws(() => buildK1HistoryContext({ history: null, context: context() }), /stage6-k1-history-context-refused/);
  assert.throws(() => buildK1HistoryContext({ history: history(), context: { ...context(), raw_output: "x" } }), /stage6-k1-history-context-refused/);
});
test("substituted content/header/steps/provenance or noncanonical whitespace refuses even with the right character count", () => {
  const good = context();
  const substitutions = [
    '{"unrelated":true}\n', good.content.replace("authorization=none", "authorization=approved"),
    good.content.replace("inspect-fixture", "substituted-fixture"), good.content.replace("fixture-reader", "substituted-reader"),
    good.content.replace("\"run-2\"", "\"unrelated-run\""), `${good.content}\n`,
  ];
  for (const content of substitutions) assert.throws(() => buildK1HistoryContext({ history: history(), context: context({ content }) }), /stage6-k1-history-context-refused/);
});
test("single-source bridge refuses omitted/truncated/multiple entries and stable binding mismatch", () => {
  const p = context().provenance[0];
  for (const changed of [{ repo: "different-repo" }, { source_sha: "b".repeat(40) }, { policy_version: "different-policy" }, { env_fingerprint: sha("different-env") }]) {
    assert.throws(() => buildK1HistoryContext({ history: history(), context: context({ provenance: [{ ...p, ...changed }] }) }), /stage6-k1-history-context-refused/);
  }
  for (const changed of [{ omitted_ids: ["omitted-experience"] }, { selected_ids: ["unrelated-experience"] }, { selected_ids: ["experience-1", "extra"] }, { provenance: [p, p] }]) {
    assert.throws(() => buildK1HistoryContext({ history: history(), context: context(changed) }), /stage6-k1-history-context-refused/);
  }
});
test("historical flags/title/tags and extra proof/status/permission inputs refuse with one fixed error", () => {
  const cases = [
    history({ current_verification: "verified" }), history({ authorization: "approved" }), history({ executable: true }),
    history({ document: { ...history().document, title: "PRIVATE_UNEXPECTED_TITLE" } }), history({ document: { ...history().document, tags: ["other-tag"] } }),
    history({ guidance: { ...history().guidance, experience: { ...experience, status: "verified" } } }), history({ permission: "approved" }), history({ proof: "PRIVATE_PROOF" }),
  ];
  for (const bad of cases) assert.throws(() => buildK1HistoryContext({ history: bad, context: context() }), error => {
    assert.equal(error.message, "stage6-k1-history-context-refused"); assert.equal(error.message.includes("PRIVATE"), false); return true;
  });
  for (const field of ["raw", "path", "handle", "proof", "permission", "budget"]) assert.throws(() => buildK1HistoryContext({ history: history(), context: { ...context(), [field]: "PRIVATE_FIELD" } }), /stage6-k1-history-context-refused/);
});
test("oversized history/context/list and invalid declared budget refuse without truncation", () => {
  const hugeHistory = "x".repeat(65_537), hugeContext = "x".repeat(8_193);
  assert.throws(() => buildK1HistoryContext({ history: history({ content_digest: sha(hugeHistory), document: { ...history().document, content: hugeHistory, content_digest: sha(hugeHistory) } }), context: context() }), /stage6-k1-history-context-refused/);
  for (const changed of [{ content: hugeContext }, { max_characters: 0 }, { max_characters: 127 }, { max_characters: Number.NaN }, { max_characters: 16_385 }, { provenance: [{ ...context().provenance[0], observation_digests: Array(17).fill(sha("same")) }] }]) {
    assert.throws(() => buildK1HistoryContext({ history: history(), context: context(changed) }), /stage6-k1-history-context-refused/);
  }
});
test("nested proxies/accessors/symbols/array hooks refuse without executing user code", () => {
  let traps = 0; const fail = () => { traps++; throw Error("PRIVATE_HOOK"); };
  const proxy = new Proxy({}, { get: fail, ownKeys: fail, getPrototypeOf: fail });
  const raw = history(), compiled = context();
  const badInputs = [
    { history: { ...raw, document: proxy }, context: compiled }, { history: { ...raw, guidance: proxy }, context: compiled },
    { history: { ...raw, guidance: { ...raw.guidance, experience: proxy } }, context: compiled },
    { history: raw, context: new Proxy(compiled, { get: fail, ownKeys: fail }) }, { history: raw, context: { ...compiled, provenance: new Proxy([], { get: fail }) } },
    { history: raw, context: { ...compiled, provenance: [proxy] } }, { history: { ...raw, [Symbol("private")]: true }, context: compiled },
  ];
  const docAccessor = { ...raw.document }; Object.defineProperty(docAccessor, "content", { get: fail }); badInputs.push({ history: { ...raw, document: docAccessor }, context: compiled });
  const pAccessor = { ...compiled.provenance[0] }; Object.defineProperty(pAccessor, "run_id", { get: fail }); badInputs.push({ history: raw, context: { ...compiled, provenance: [pAccessor] } });
  const tagsAccessor = ["pi-vista:guidance-v1"]; Object.defineProperty(tagsAccessor, "0", { get: fail }); badInputs.push({ history: { ...raw, document: { ...raw.document, tags: tagsAccessor } }, context: compiled });
  const observationAccessor = [sha("safe")]; Object.defineProperty(observationAccessor, "0", { get: fail }); badInputs.push({ history: raw, context: { ...compiled, provenance: [{ ...compiled.provenance[0], observation_digests: observationAccessor }] } });
  const experienceAccessor = { ...experience }; Object.defineProperty(experienceAccessor, "script", { get: fail }); badInputs.push({ history: { ...raw, guidance: { ...raw.guidance, experience: experienceAccessor } }, context: compiled });
  for (const bad of badInputs) assert.throws(() => buildK1HistoryContext(bad), /stage6-k1-history-context-refused/);
  assert.equal(traps, 0);
});
test("known credential-bearing or unsafe current metadata labels do not survive bridge validation", () => {
  const badLabels = ["wrapped_ghp_abcdefghijklmnop_suffix", "wrapgithub_pat_1234567890suffix", "/private/path", "label;command", "https://example.invalid", "field:raw"];
  for (const value of badLabels) {
    for (const key of ["run_id", "experience_id", "scope"]) {
      const changed = { ...context().provenance[0], [key]: value };
      const input = context({ provenance: [changed], ...(key === "experience_id" ? { selected_ids: [value] } : {}) });
      assert.throws(() => buildK1HistoryContext({ history: history(), context: input }), /stage6-k1-history-context-refused/);
    }
  }
});
test("metadata-only output remains closed and cannot carry proof/permission/budget after roundtrip", () => {
  const result = buildK1HistoryContext({ history: history(), context: context() }); const roundtrip = JSON.parse(JSON.stringify(result));
  assert.deepEqual(snapshotHistoryContext(roundtrip), result);
  for (const key of ["proof", "permission", "budget", "selected_ids", "content", "path"]) {
    const bad = { ...roundtrip, [key]: true };
    assert.throws(() => snapshotHistoryContext(bad), /stage6-k1-refused/);
    assert.equal(Object.hasOwn(result, key), false);
  }
});
