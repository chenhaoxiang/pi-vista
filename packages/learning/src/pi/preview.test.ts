import { test } from "node:test";
import assert from "node:assert/strict";
import { createPiObservation, type PiPreview } from "@pi-vista/learning/pi";
import type { PortableRecallConfig, SafeDocument } from "@pi-vista/learning";
import { archiveFixture, alteredDocument } from "../portable.fixtures.js";
import { deferred, ownerFixture, SUBJECTS } from "../learning.fixtures.js";
import { harness, start, idle, delay, TASK } from "./observation.fixtures.js";

async function historyFixture(options: Partial<PortableRecallConfig> = {}) {
  const f = await archiveFixture(); let time = 20_000; let queryCalls = 0; let readCalls = 0; let document: SafeDocument = f.plan.document; let state = "active";
  const history: PortableRecallConfig = { origins: [f.origin.pin], now: () => time, max_age_ms: 60_000, timeout_ms: 50,
    port: { query: async () => { queryCalls++; return { documents: [{ document_id: "history-one", bank: TASK.bank }] }; },
      read: async ref => { readCalls++; return { ...ref, document }; } },
    lifecycle: async ref => ({ ...ref, state, checked_at: 20_000, expires_at: 25_000 }), ...options };
  return { ...f, history, setNow: (value: number) => { time = value; }, setState: (value: string) => { state = value; },
    setDocument: (value: SafeDocument) => { document = value; }, calls: () => ({ queryCalls, readCalls }) };
}
test("genuine signed whole Script/Step preview and explicit exact local adoption never create current proof or writes", async () => {
  const f = await historyFixture(); const h = harness({ history: f.history }); await start(h);
  const p = await h.controller.preview(); assert.equal(p.context.item_count, 1); assert.ok(Object.isFrozen(p.context)); assert.ok(Object.isFrozen(p.context.provenance));
  assert.match(p.context.content, /metadata-reader/u); assert.match(p.context.content, /step-2/u); assert.match(p.context.content, /current-verification=not-checked/u);
  assert.equal(p.context.provenance[0]!.repo, TASK.repo); assert.equal(p.context.provenance[0]!.source_sha, TASK.source_sha);
  assert.equal(h.controller.status().history, "historical-authenticated"); assert.equal(h.controller.status().selection, "none");
  const status = await h.controller.adopt(p, p.preview_digest); assert.equal(status.selection, "local-guidance-acknowledgement"); assert.equal(status.current, "MISSING");
  assert.equal(status.authorization, "none"); assert.equal(status.executable, false); assert.deepEqual(f.calls(), { queryCalls: 2, readCalls: 2 });
  assert.deepEqual(f.transport.counts(), { ingests: 0, readbacks: 0 }); assert.equal(h.messages.length, 0);
});
for (const mode of ["copy", "foreign", "digest", "stale-view"] as const) test(`${mode} preview identity refuses before fresh reads`, async () => {
  const f = await historyFixture(); const h = harness({ history: f.history }); await start(h); const p = await h.controller.preview(); let view: PiPreview = p; let digest = p.preview_digest;
  if (mode === "copy") view = { ...p };
  if (mode === "foreign") { const other = harness({ history: f.history }); await start(other); view = await other.controller.preview(); }
  if (mode === "digest") digest = "a".repeat(64);
  if (mode === "stale-view") await h.controller.preview();
  const before = f.calls(); await assert.rejects(h.controller.adopt(view, digest), /refused/u); assert.deepEqual(f.calls(), before); assert.equal(h.controller.status().selection, "none");
});
for (const binding of ["repo", "source_sha", "policy_version", "env_fingerprint", "task_type", "bank"] as const) test(`exact ${binding} history selection mismatch is MISSING`, async () => {
  const f = await historyFixture(); const h = harness({ history: f.history }); h.setTask({ ...TASK, [binding]: binding === "source_sha" ? "b".repeat(40) : "foreign-alias" }); await start(h);
  await assert.rejects(h.controller.preview(), /refused/u); assert.equal(h.controller.status().history, "MISSING");
});
for (const mode of ["forged", "status-only", "revoked-pin", "overage", "withdrawn", "too-small-budget", "empty", "failed-read", "failed-query"] as const) test(`history ${mode} never publishes partial positive guidance`, async () => {
  const f = await historyFixture(); let history = f.history; let maxCharacters = 8192;
  if (mode === "forged") f.setDocument(alteredDocument(f.plan.document, env => { env.signature = "A".repeat(86) + "=="; }));
  if (mode === "status-only") f.setDocument({ ...f.plan.document, content: '{"status":"verified"}' });
  if (mode === "revoked-pin") history = { ...history, origins: [{ ...f.origin.pin, trust: "revoked" }] };
  if (mode === "overage") f.setNow(80_001);
  if (mode === "withdrawn") f.setState("revoked");
  if (mode === "too-small-budget") maxCharacters = 128;
  if (mode === "empty") history = { ...history, port: { ...history.port!, query: async () => ({ documents: [] }) } };
  if (mode === "failed-read") history = { ...history, port: { ...history.port!, read: async () => { throw Error("private-history-canary"); } } };
  if (mode === "failed-query") history = { ...history, port: { ...history.port!, query: async () => { throw Error("private-history-canary"); } } };
  const h = harness({ history, max_characters: maxCharacters }); await start(h); await assert.rejects(h.controller.preview(), /refused/u);
  assert.equal(h.controller.status().history, "MISSING"); assert.equal(h.controller.status().selection, "none"); assert.doesNotMatch(JSON.stringify(h.controller.status()), /history-canary/u);
});
test("whole character budget omission is explicit and no positive empty preview is minted", async () => {
  const f = await historyFixture(); const h = harness({ history: f.history }); await start(h); const p = await h.controller.preview();
  assert.equal(p.context.character_count, p.context.content.length); assert.ok(p.context.character_count <= 8192);
  const small = harness({ history: f.history, max_characters: p.context.character_count - 1 }); await start(small);
  await assert.rejects(small.controller.preview(), /refused/u); assert.equal(small.controller.status().history, "MISSING");
});
for (const mode of ["expiry", "revocation", "changed-document", "task-drift"] as const) test(`adoption rechecks ${mode} and clears local guidance`, async () => {
  const f = await historyFixture(); const h = harness({ history: f.history }); await start(h); const p = await h.controller.preview();
  if (mode === "expiry") f.setNow(25_000);
  if (mode === "revocation") f.setState("revoked");
  if (mode === "changed-document") f.setDocument(alteredDocument(f.plan.document, env => { env.payload.experience.script.description = "changed safe metadata"; }, f.origin));
  if (mode === "task-drift") h.setTask({ ...TASK, task_goal: "different bounded goal" });
  await assert.rejects(h.controller.adopt(p, p.preview_digest), /refused/u); assert.equal(h.controller.status().history, "MISSING"); assert.equal(h.controller.status().selection, "none");
});
test("status invalidates expired selected history without restoring current authority", async () => {
  const f = await historyFixture(); const h = harness({ history: f.history }); await start(h); const p = await h.controller.preview(); await h.controller.adopt(p, p.preview_digest);
  f.setNow(25_000); assert.equal(h.controller.status().history, "MISSING"); assert.equal(h.controller.status().selection, "none");
});
test("missing history/verifier is explicit refusal; no automatic task-start recall without opt-in", async () => {
  const f = await historyFixture(); const h = harness({ history: f.history }); await start(h); assert.deepEqual(f.calls(), { queryCalls: 0, readCalls: 0 });
  await assert.rejects(h.controller.verifyCurrent(), /refused/u); const missing = harness(); await start(missing);
  await assert.rejects(missing.controller.preview(), /refused/u); assert.equal(missing.controller.status().current, "MISSING");
});
test("explicit task-start preview is detached and old-epoch late result cannot update new status/UI", async () => {
  const d = deferred<unknown>(); const f = await historyFixture({ port: { query: () => d.promise, read: async () => { assert.fail("obsolete recall must not read"); } } });
  const h = harness({ history: f.history, preview_on_start: true }); h.fire("agent_start"); await delay(2);
  h.fire("session_start"); h.setTask({ ...TASK, task_goal: "new bounded goal" }); d.resolve({ documents: [{ document_id: "history-one", bank: TASK.bank }] });
  await idle(h.controller); assert.equal(h.controller.status().phase, "MISSING"); assert.equal(h.controller.status().history, "MISSING"); assert.equal(h.messages.length, 0);
});
test("explicit task-start preview opt-in produces authentic read-only history", async () => {
  const f = await historyFixture(); const h = harness({ history: f.history, preview_on_start: true }); await start(h);
  assert.equal(h.controller.status().history, "historical-authenticated"); assert.deepEqual(f.transport.counts(), { ingests: 0, readbacks: 0 });
});
for (const failure of ["hang", "late-reject", "thenable"] as const) test(`recall ${failure} is bounded and fail-open`, async () => {
  const d = deferred<unknown>(); const f = await historyFixture({ port: { query: () => failure === "thenable" ? { get then() { return assert.fail("then getter"); } } as unknown as Promise<unknown> : d.promise,
    read: async () => { assert.fail("unavailable query never reads"); } } });
  const h = harness({ history: f.history, timeout_ms: 15 }); await start(h); await assert.rejects(h.controller.preview(), /refused/u);
  if (failure === "late-reject") { d.reject(Error("private-late-history")); await delay(2); }
  assert.equal(h.controller.status().history, "MISSING"); h.fire("agent_end"); await idle(h.controller); assert.equal(h.controller.status().phase, "active");
});
test("commands output safe UI only; hostile/rejecting/no-UI contexts do not change results or inject messages", async () => {
  const f = await historyFixture(); const h = harness({ history: f.history }); await start(h);
  await h.commands.get("vista-preview")!.handler("", h.ctx); assert.match(h.messages[0]!, /historical-authenticated/u);
  const p = h.controller.status().preview_digest!; await h.commands.get("vista-adopt")!.handler(p, h.ctx); assert.equal(h.controller.status().selection, "local-guidance-acknowledgement");
  for (const ctx of [{ hasUI: false, get ui() { return assert.fail("no UI"); } }, { hasUI: true, ui: { notify: () => { throw Error("private-ui-canary"); } } },
    { hasUI: true, ui: { notify: () => Promise.reject(Error("private-ui-canary")) } }]) await h.commands.get("vista-status")!.handler("", ctx);
  assert.doesNotMatch(h.messages.join(""), /ui-canary|BEGIN PUBLIC KEY|signature|raw-result/u); assert.equal(h.controller.status().current, "MISSING");
});
function bindOwner(owner: ReturnType<typeof ownerFixture>, h: ReturnType<typeof harness>) {
  const binding = h.controller.status().binding!;
  for (const kind of ["gate", "test", "guard"] as const) { Object.assign(owner.payloads[kind], binding); owner.seal(kind); }
}
test("only exact fresh full-five-bound evidence verification yields current-verified; history/adoption are independent", async () => {
  const owner = ownerFixture(); const h = harness({ verifier: owner.verifier, subjects: SUBJECTS, now: () => 10_000 }); await start(h); bindOwner(owner, h);
  const status = await h.controller.verifyCurrent(); assert.equal(status.current, "current-verified"); assert.equal(status.history, "MISSING"); assert.equal(status.authorization, "none"); assert.equal(status.executable, false);
  owner.setNow(15_000); assert.equal(h.controller.status().current, "MISSING");
});
for (const binding of ["run_id", "repo", "source_sha", "policy_version", "env_fingerprint"] as const) test(`current evidence ${binding} mismatch cannot become verified`, async () => {
  const owner = ownerFixture(); const h = harness({ verifier: owner.verifier, subjects: SUBJECTS }); await start(h); bindOwner(owner, h);
  owner.payloads.gate[binding] = binding === "source_sha" ? "f".repeat(40) : "foreign-scope"; owner.seal("gate");
  await assert.rejects(h.controller.verifyCurrent(), /refused/u); assert.equal(h.controller.status().current, "MISSING");
});
test("changed task and session replacement invalidate current proof; late old verification cannot restore it", async () => {
  const owner = ownerFixture(); const h = harness({ verifier: owner.verifier, subjects: SUBJECTS }); await start(h); bindOwner(owner, h); await h.controller.verifyCurrent();
  const run = h.controller.status().binding!.run_id; h.setTask({ ...TASK, env_fingerprint: "changed-env" }); await assert.rejects(h.controller.verifyCurrent(), /refused/u);
  assert.notEqual(h.controller.status().binding!.run_id, run); assert.equal(h.controller.status().current, "MISSING");
  bindOwner(owner, h); const d = deferred<unknown>(); owner.hooks.gate = () => d.promise; const late = h.controller.verifyCurrent(); const handled = assert.rejects(late, /refused/u);
  await delay(2); h.fire("session_start"); d.resolve(owner.receipts.gate); await handled; assert.equal(h.controller.status().current, "MISSING"); assert.equal(h.controller.status().binding, undefined);
});
for (const mode of ["throw", "hang", "late-reject", "task-drift"] as const) test(`explicit owner verification ${mode} cannot block hooks or yield old positive proof`, async () => {
  const owner = ownerFixture(); const d = deferred<unknown>(); const h = harness({ verifier: owner.verifier, subjects: SUBJECTS, timeout_ms: 15 }); await start(h); bindOwner(owner, h);
  owner.hooks.gate = () => { if (mode === "throw") throw Error("private-owner-canary"); return d.promise; };
  const checked = h.controller.verifyCurrent(); const refused = assert.rejects(checked, /refused/u); await delay(2);
  h.fire("agent_end"); assert.equal(h.controller.status().phase, "active");
  if (mode === "task-drift") { h.setTask({ ...TASK, source_sha: "f".repeat(40) }); d.resolve(owner.receipts.gate); }
  await refused;
  if (mode === "late-reject") { d.reject(Error("private-owner-canary")); await delay(2); }
  assert.equal(h.controller.status().current, "MISSING"); assert.doesNotMatch(JSON.stringify(h.controller.status()), /owner-canary/u);
});
test("late explicit preview command cannot publish failure or guidance into replacement UI", async () => {
  const d = deferred<unknown>(); const f = await historyFixture({ port: { query: () => d.promise, read: async () => { assert.fail("obsolete read"); } } });
  const h = harness({ history: f.history }); await start(h); const command = h.commands.get("vista-preview")!.handler("", h.ctx);
  await delay(2); h.fire("session_start"); d.resolve({ documents: [] }); await command; assert.equal(h.messages.length, 0); assert.equal(h.controller.status().history, "MISSING");
});
test("copied/status-only verifier and serialized proof config cannot mint current proof", () => {
  const owner = ownerFixture(); const base = { now: () => 20_000, resolve_task: async () => TASK, tools: [], subjects: SUBJECTS };
  for (const verifier of [{ ...owner.verifier }, { verify: async () => ({ verification: "authority-bound" }), isCurrent: () => true }]) {
    assert.throws(() => createPiObservation({ ...base, verifier } as any), /invalid-config/u);
  }
  assert.throws(() => createPiObservation({ ...base, verifier: owner.verifier, proof: { verification: "authority-bound" } } as any), /invalid-config/u);
});
