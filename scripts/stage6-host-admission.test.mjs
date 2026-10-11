import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { ROOT } from "./release-utils.mjs";
import { bindStage6Stream, captureStage6Profile, collectStage6Admission } from "./stage6-host-admission.mjs";
import { admitStage6Run, profileSnapshot } from "./stage6-admission.mjs";

const digest = value => createHash("sha256").update(value).digest("hex");
const profile = () => profileSnapshot({ protected: { auth: digest("auth") }, volatile: { root: digest("root") } });
const context = { provider: "fixture-provider", model: "fixture-model", thinking: "max", sdk: "fixture-sdk", arm: "baseline", guidance_mode: "none", guidance_digest: null, harness_source_sha: digest("harness"), subject_source_sha: "a".repeat(40), subject_history_digest: digest("history"), broker_digest: null };

test("readonly profile capture hashes only metadata and collect admission stays non-authorizing", async () => {
  await mkdir(join(ROOT, "tmp"), { recursive: true });
  const directory = await mkdtemp(join(ROOT, "tmp", "stage6-profile-fixture-"));
  try {
    await writeFile(join(directory, "auth.json"), "PRIVATE_AUTH\n", { mode: 0o600 });
    await writeFile(join(directory, "models.json"), "{\"fixture\":true}\n", { mode: 0o600 });
    await writeFile(join(directory, "settings.json"), "{}\n", { mode: 0o600 });
    const before = await captureStage6Profile(directory); const after = await captureStage6Profile(directory);
    assert.equal(before.protected.auth.length, 64); assert.deepEqual(before, after);
    const admission = await collectStage6Admission({ profileDirectory: directory, context, expected: context });
    assert.equal(admission.status, "admitted"); assert.equal(admission.authorization, "none"); assert.equal(admission.executable, false); assert.equal(admission.model_calls, 0);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("host admission adapter does not run at import and binds a shared pretransport budget", () => {
  const admission = admitStage6Run({ ...context, profile_before: profile(), profile_after: profile(), model_calls: 0 }, context);
  assert.equal(admission.status, "admitted");
  let shared = 0, forwarded = 0;
  const session = { agent: { streamFunction: (_model, _ctx, _options) => { forwarded++; return "stream"; } } };
  const original = session.agent.streamFunction;
  const binding = bindStage6Stream(session, admission, { take(model, thinking) { assert.equal(model.provider, "fixture-provider"); assert.equal(thinking, "max"); shared++; } }, { maxPerSession: 2 });
  assert.equal(session.agent.streamFunction({ provider: "fixture-provider", id: "fixture-model" }, {}, { reasoning: "max" }), "stream");
  assert.equal(session.agent.streamFunction({ provider: "fixture-provider", id: "fixture-model" }, {}, { reasoning: "max" }), "stream");
  assert.throws(() => session.agent.streamFunction({ provider: "fixture-provider", id: "fixture-model" }, {}, { reasoning: "max" }), /stage6-session-budget-exhausted/);
  assert.throws(() => session.agent.streamFunction({ provider: "other", id: "fixture-model" }, {}, { reasoning: "max" }), /stage6-model-binding-mismatch/);
  assert.deepEqual(binding.status(), { session_attempts: 2, admission_attempts: 2, active: true, authorization: "none", executable: false });
  assert.equal(shared, 2); assert.equal(forwarded, 2);
  const oldWrapper = session.agent.streamFunction;
  binding.shutdown(); assert.equal(session.agent.streamFunction, original);
  assert.throws(() => oldWrapper({ provider: "fixture-provider", id: "fixture-model" }, {}, { reasoning: "max" }), /stage6-stream-withdrawn/);
});

test("host collection refuses malformed context before any profile access or getter", async () => {
  let reads = 0;
  const input = { profileDirectory: "/nonexistent", context, expected: context };
  Object.defineProperty(input, "context", { get() { reads++; throw Error("private getter"); } });
  await assert.rejects(collectStage6Admission(input), /stage6-collection-refused/);
  await assert.rejects(collectStage6Admission({ profileDirectory: "/nonexistent", context: {}, expected: context }), /stage6-admission-refused/);
  assert.equal(reads, 0);
});

test("host binding refuses copied admission and non-native sessions", () => {
  const admission = admitStage6Run({ ...context, profile_before: profile(), profile_after: profile(), model_calls: 0 }, context);
  const copy = { ...admission };
  assert.throws(() => bindStage6Stream({ agent: { streamFunction() {} } }, copy, { take() {} }), /admission-required/);
  assert.throws(() => bindStage6Stream({}, admission, { take() {} }), /stage6-stream-binding-refused/);
});
