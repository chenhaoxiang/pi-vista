import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";
import { admitStage6Run, classifyProfileDrift, createAdmissionRequestBudget, profileDigest, profileSnapshot } from "./stage6-admission.mjs";

const d = value => createHash("sha256").update(value).digest("hex");
const profile = (volatile = d("v"), protectedValue = d("p")) => ({ protected: { auth: protectedValue, settings: d("s") }, volatile: { cache: volatile, root: d("r") } });
const context = { provider: "codex-local-8319", model: "gpt-6.1-sol", thinking: "max", sdk: "1.0.4", arm: "baseline", guidance_mode: "none", guidance_digest: null, harness_source_sha: d("h"), subject_source_sha: d("u"), subject_history_digest: d("i"), broker_digest: null };
const input = (overrides = {}) => ({ ...context, profile_before: profile(), profile_after: profile(), model_calls: 0, ...overrides });

test("offline modules import without filesystem/network/model side effects", async () => {
  const source = await readFile(new URL("./stage6-admission.mjs", import.meta.url), "utf8");
  const decision = await readFile(new URL("./stage6-decision-tool.mjs", import.meta.url), "utf8");
  for (const body of [source, decision]) assert.doesNotMatch(body, /node:fs|node:child_process|https?:|fetch\s*\(/u);
  const run = promisify(execFile);
  const code = `globalThis.fetch=()=>{throw Error("fetch");}; await import(${JSON.stringify(new URL("./stage6-admission.mjs", import.meta.url).href)}); await import(${JSON.stringify(new URL("./stage6-decision-tool.mjs", import.meta.url).href)}); console.log("imported");`;
  const result = await run(process.execPath, ["--input-type=module", "-e", code], { env: { PATH: "/usr/bin:/bin", HOME: "/nonexistent", TMPDIR: "/nonexistent" }, shell: false });
  assert.equal(result.stdout.trim(), "imported"); assert.equal(result.stderr, "");
});

test("profile snapshots are closed, canonical and digestable without filesystem reads", () => {
  const value = profileSnapshot(profile()); assert.equal(Object.isFrozen(value), true); assert.equal(profileDigest(value).length, 64);
  const getter = { protected: {}, volatile: {} }; Object.defineProperty(getter.protected, "auth", { get() { throw Error("getter"); } }); assert.throws(() => profileSnapshot(getter));
  assert.throws(() => profileSnapshot(new Proxy(profile(), { get() { throw Error("proxy"); } })));
});
test("profile drift separates protected changes from volatile unknown attribution", () => {
  const before = profile(); assert.equal(classifyProfileDrift(before, profile()).classification, "unchanged");
  const protectedAfter = profile(); protectedAfter.protected.auth = d("x"); const p = classifyProfileDrift(before, protectedAfter);
  assert.equal(p.classification, "protected-profile-drift"); assert.deepEqual(p.protected_changed, ["auth"]);
  const v = classifyProfileDrift(before, profile(d("x"))); assert.equal(v.classification, "volatile-profile-drift-unknown-attribution"); assert.deepEqual(v.volatile_changed, ["cache"]);
});
test("admission success binds exact context and budget without starting model calls", () => {
  const result = admitStage6Run(input(), context); assert.equal(result.status, "admitted"); assert.equal(result.model_calls, 0);
  assert.equal(result.authorization, "none"); assert.equal(result.profile_before_digest, result.profile_after_digest); assert.equal(result.drift.classification, "unchanged");
  const budget = createAdmissionRequestBudget(result, 2); assert.equal(createAdmissionRequestBudget(result, 2), budget); assert.equal(budget.take(), 1); assert.equal(budget.take(), 2); assert.throws(() => budget.take(), /request-budget-exhausted/); assert.throws(() => createAdmissionRequestBudget(result, 3), /admission-budget-mismatch/); assert.deepEqual(budget.status(), { verification: "metadata-only", authorization: "none", model_calls: 2, max_requests: 2 });
});
test("protected/volatile drift and context mismatch refuse before any model request", () => {
  const protectedAfter = profile(); protectedAfter.protected.auth = d("x"); const p = admitStage6Run(input({ profile_after: protectedAfter }), context);
  assert.equal(p.reason_code, "protected-profile-drift"); assert.equal(p.model_calls, 0); assert.throws(() => createAdmissionRequestBudget(p), /admission-required/);
  const v = admitStage6Run(input({ profile_after: profile(d("x")) }), context); assert.equal(v.reason_code, "volatile-profile-drift-unknown-attribution");
  const mismatch = admitStage6Run(input({ model: "other-model" }), context); assert.equal(mismatch.reason_code, "model-mismatch");
  const guided = { ...context, arm: "guided", guidance_mode: "historical-observed", guidance_digest: d("g") };
  assert.equal(admitStage6Run(input(guided), guided).status, "admitted");
});
test("invalid provenance and pre-admission calls preserve refusal without fallback", () => {
  for (const bad of [input({ subject_source_sha: "not-a-digest" }), input({ broker_digest: "not-a-digest" }), input({ profile_before: undefined })]) {
    const result = admitStage6Run(bad, context); assert.equal(result.status, "refused"); assert.equal(result.admitted, false); assert.equal(result.authorization, "none");
  }
  const calls = admitStage6Run(input({ model_calls: 1 }), context); assert.equal(calls.reason_code, "model-calls-before-admission"); assert.equal(calls.model_calls, 1);
});
