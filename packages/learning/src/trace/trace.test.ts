import assert from "node:assert/strict";
import { test } from "node:test";
import { draftTraceExperience, type TraceDraftInput } from "@pi-vista/learning/trace";
import { createLearningLibrary } from "@pi-vista/learning";
import { ownerFixture } from "../learning.fixtures.js";

const expected = { run_id: "fixture-run", repo: "fixture-repo", source_sha: "a".repeat(40), policy_version: "policy-v1", env_fingerprint: "env-v1" };
function event(step: number, ts: number, action: string, result = "unknown", tool?: string): Record<string, unknown> {
  return { ...expected, step_id: `${expected.run_id}_s${step}`, ts, component: "pi", action, result, vista_version: "0.1.0", session_id: "fixture-session", ...(tool === undefined ? {} : { target_class: tool }) };
}
function input(): TraceDraftInput {
  return { experience_id: "experience-1", expected, dropped_count: 0,
    task: { task_type: "metadata-update", description: "bounded metadata workflow", preconditions: ["source-bound"], postconditions: ["observed"], applicable_to: [] },
    events: [event(0, 1000, "pi:agent-start"), event(2, 1100, "pi:tool-execution-start", "unknown", "metadata-reader"), event(3, 1110, "pi:tool-execution-start", "unknown", "metadata-checker"),
      event(3, 1200, "pi:tool-execution-end", "ok", "metadata-checker"), event(2, 1300, "pi:tool-execution-end", "ok", "metadata-reader"), event(8, 1400, "pi:agent-end"), event(9, 1500, "pi:agent-settled")] };
}
function mutable() { return JSON.parse(JSON.stringify(input())) as any; }
test("parallel safe draft preserves original pairs/steps, never invents dependencies/proof/status or task PASS", () => {
  const d = draftTraceExperience(input()); assert.equal(d.mode, "dry-run-trace-draft"); assert.equal(d.authorization, "none"); assert.equal(d.executable, false);
  assert.equal(d.current_verification, "not-checked"); assert.equal(d.basis, "untrusted-input-shape-only"); assert.equal(d.dependency_basis, "not-inferred");
  assert.deepEqual(d.observation.steps.map(step => step.step_id), ["fixture-run_s2", "fixture-run_s3"]);
  assert.equal(d.pairs[0]!.end_ts, 1300); assert.equal(d.pairs[1]!.end_ts, 1200);
  assert.ok(d.observation.steps.every(step => step.depends_on.length === 0 && step.check_fn_ids.length === 0 && step.on_failure === "stop"));
  assert.equal(Object.hasOwn(d.observation, "status"), false); assert.equal(Object.hasOwn(d.observation, "verification"), false);
  assert.equal(d.observation.ts, 1500); assert.match(d.trace_digest, /^[a-f0-9]{64}$/);
});
for (const order of ["reverse", "rotate", "swapped-completions"] as const) test(`${order} array storage order does not change safe draft/digest`, () => {
  const original = input(); const events = [...original.events];
  if (order === "reverse") events.reverse(); if (order === "rotate") events.push(...events.splice(0, 3));
  if (order === "swapped-completions") [events[3], events[4]] = [events[4], events[3]];
  assert.deepEqual(draftTraceExperience({ ...original, events }), draftTraceExperience(original));
});
for (const result of ["failed", "blocked"] as const) test(`${result} becomes bounded raw unknown failure observation, not inferred test/guard/root truth`, () => {
  const v = mutable(); v.events[3].result = result; const d = draftTraceExperience(v);
  assert.equal(d.observation.failure_analysis!.reason_code, "unknown"); assert.equal(d.observation.failure_analysis!.stage, "execution");
  assert.equal(d.observation.failure_analysis!.step_id, "fixture-run_s3"); assert.equal(d.observation.failure_analysis!.ts, 1200);
  assert.equal(Object.hasOwn(d.observation.failure_analysis!, "root_cause"), false); assert.equal(Object.hasOwn(d.observation.failure_analysis!, "fix_outcome"), false);
  const owner = ownerFixture(); const library = createLearningLibrary({ verifier: owner.verifier }); const observed = library.observe(d.observation);
  assert.equal(observed.status, "observed"); assert.equal(observed.failure_analysis!.verification, "observed-only"); assert.equal(library.nominate(observed).status, "candidate");
});
test("explicit library observe/nominate works, copied draft remains no current handle or proof and never calls owner ports", () => {
  const owner = ownerFixture(); const library = createLearningLibrary({ verifier: owner.verifier }); const d = draftTraceExperience(input());
  const observed = library.observe(d.observation), candidate = library.nominate(observed); assert.equal(candidate.status, "candidate");
  assert.throws(() => library.verifyCandidate(candidate, d as any), /unverified-evidence/);
  assert.throws(() => library.preparePromotion(candidate, "fixture-bank"), /unverified-evidence/);
  const { run_id: _run, ...retrieval } = expected;
  assert.equal(library.retrieve([d, { ...candidate }], { ...retrieval, task_type: "metadata-update" }).handles.length, 0);
  assert.deepEqual(owner.calls, { gate: 0, test: 0, guard: 0 });
});
for (const field of ["run_id", "repo", "source_sha", "policy_version", "env_fingerprint"] as const) test(`one mixed ${field} event refuses before draft`, () => {
  const v = mutable(); v.events[3][field] = field === "source_sha" ? "b".repeat(40) : "foreign-context";
  assert.throws(() => draftTraceExperience(v), /invalid-input/);
});
for (const field of ["status", "verification", "raw", "model_text", "command", "sink"] as const) test(`unknown ${field} input cannot influence status or be retained`, () => {
  const v = mutable(); v[field] = "private-canary"; assert.throws(() => draftTraceExperience(v), /invalid-input/);
});
for (const field of ["args", "result_body", "model_id", "artifact_refs", "layer", "trace_id", "unknown"] as const) test(`unaccepted ${field} event field rejects`, () => {
  const v = mutable(); v.events[2][field] = "private-canary"; assert.throws(() => draftTraceExperience(v), /invalid-input/);
});
for (const failure of ["start-missing", "settled-missing", "end-missing", "duplicate-start", "duplicate-end", "unmatched-end", "class-mismatch", "session-mismatch", "life-id-reused", "unknown-result", "nonzero-drop", "end-before-start", "outside-time", "tool-id-foreign", "future-version"] as const) test(`trace ${failure} refuses rather than repairing missing metadata`, () => {
  const v = mutable();
  if (failure === "start-missing") v.events.splice(0, 1); if (failure === "settled-missing") v.events.pop(); if (failure === "end-missing") v.events.splice(5, 1);
  if (failure === "duplicate-start") v.events.push({ ...v.events[1] }); if (failure === "duplicate-end") v.events.push({ ...v.events[3] });
  if (failure === "unmatched-end") v.events[3].step_id = "fixture-run_s5";
  if (failure === "class-mismatch") v.events[3].target_class = "metadata-reader"; if (failure === "session-mismatch") v.events[3].session_id = "foreign-session";
  if (failure === "life-id-reused") v.events[5].step_id = "fixture-run_s2"; if (failure === "unknown-result") v.events[3].result = "unknown";
  if (failure === "nonzero-drop") v.dropped_count = 1; if (failure === "end-before-start") v.events[3].ts = 1090;
  if (failure === "outside-time") v.events[1].ts = 999; if (failure === "tool-id-foreign") v.events[1].step_id = "foreign_s2"; if (failure === "future-version") v.events[3].vista_version = "future-2";
  assert.throws(() => draftTraceExperience(v), /invalid-input/);
});
for (const label of ["/private/path", "https://private.invalid", "echo dangerous", "wrapped-ghp_" + "a".repeat(36), "sk-proj-" + "a".repeat(64), ""] as const) test(`unsafe template ${label.slice(0, 12)} rejects without echoing raw value`, () => {
  const v = mutable(); v.task.description = label;
  try { draftTraceExperience(v); assert.fail("must reject"); } catch (e) { assert.match(String(e), /invalid-input/); assert.equal((e as Error).stack, "LearningError: invalid-input"); }
});
test("closed own-data proxy/getter/inherited/symbol/sparse boundaries never invoke input behavior", () => {
  let traps = 0; const p = new Proxy(input(), { ownKeys() { traps++; throw Error("private"); }, get() { traps++; throw Error("private"); } });
  assert.throws(() => draftTraceExperience(p), /invalid-input/);
  const getter = { ...input() }; Object.defineProperty(getter, "events", { get() { traps++; return input().events; } });
  assert.throws(() => draftTraceExperience(getter), /invalid-input/); assert.throws(() => draftTraceExperience(Object.create(input())), /invalid-input/);
  const symbol = { ...input(), [Symbol("private")]: true }; assert.throws(() => draftTraceExperience(symbol), /invalid-input/);
  const events = [...input().events]; delete events[1]; assert.throws(() => draftTraceExperience({ ...input(), events }), /invalid-input/);
  assert.equal(traps, 0);
});
test("output is detached/deep-frozen and later caller mutation cannot redirect its observation", () => {
  const v = mutable(); const d = draftTraceExperience(v); v.task.description = "changed"; v.events[1].target_class = "changed";
  assert.equal(d.observation.script.description, "bounded metadata workflow"); assert.equal(d.pairs[0]!.tool_class, "metadata-reader");
  for (const value of [d, d.observation, d.observation.script, d.observation.steps, d.observation.steps[0], d.pairs, d.pairs[0]]) assert.equal(Object.isFrozen(value), true);
});
test("zero/over-bound traces and metadata templates cannot truncate into a valid partial experience", () => {
  assert.throws(() => draftTraceExperience({ ...input(), events: [] }), /invalid-input/);
  assert.throws(() => draftTraceExperience({ ...input(), events: Array(65).fill(input().events[0]) }), /invalid-input/);
  const v = mutable(); v.task.description = "a".repeat(257); assert.throws(() => draftTraceExperience(v), /invalid-input/);
});
