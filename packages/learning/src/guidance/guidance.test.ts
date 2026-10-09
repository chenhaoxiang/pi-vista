import test from "node:test";
import assert from "node:assert/strict";
import { createServer, type ServerResponse } from "node:http";
import { mkdir, mkdtemp, readdir, rm, chmod, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { LearningError, type ExperienceObservation } from "../contract.js";
import { createHindsightStore } from "../hindsight/index.js";
import { createHindsightGuidanceStore, prepareHistoricalGuidance, type HindsightGuidanceConfig } from "./index.js";

const root = fileURLToPath(new URL("../../../../tmp/guidance-tests/", import.meta.url));
function observation(): ExperienceObservation {
  return { experience_id: "fixture-guide", run_id: "fixture-run", repo: "fixture-repo", source_sha: "a".repeat(40),
    policy_version: "fixture-v1", env_fingerprint: "fixture-env", task_type: "fixture-task", ts: 1000,
    script: { task_type: "fixture-task", description: "inspect fixture metadata", preconditions: [], steps: ["inspect-fixture"], postconditions: [], known_failures: [], applicable_to: [] },
    steps: [{ step_id: "fixture-step", tool: "fixture-reader", action_description: "inspect metadata", check_fn_ids: [], expected_result: "observed", on_failure: "stop", depends_on: [] }] };
}
const fixedError = (error: unknown) => error instanceof LearningError && ["sink-failed", "sink-timeout", "sink-mismatch"].includes(error.code);
const invalidInput = (error: unknown) => error instanceof LearningError && error.code === "invalid-input";
async function fixture() {
  await mkdir(root, { recursive: true }); const owned = await mkdtemp(path.join(root, "case-")); const journal = path.join(owned, "journal"); await mkdir(journal, { mode: 0o700 });
  const docs = new Map<string, string>(); const calls = { retain: 0, original: 0, recall: 0, config: 0 };
  const state = { mode: "normal", exists: true, badOriginal: false, badBank: false, extraOriginal: false, delay: 0,
    recallResults: undefined as unknown[] | undefined, retainBody: undefined as any };
  const json = (res: ServerResponse, status: number, value: unknown) => { res.writeHead(status, { "Content-Type": "application/json" }); res.end(JSON.stringify(value)); };
  const server = createServer(async (req, res) => {
    const route = new URL(req.url!, "http://fixture").pathname;
    if (route === "/v1/default/banks/fixture-bank/config") { calls.config++; json(res, state.exists ? 200 : 404, { bank_id: "fixture-bank", config: {}, overrides: {} }); return; }
    if (route.includes("/documents/") && req.method === "GET") {
      calls.original++; const id = decodeURIComponent(route.split("/").pop()!); const text = docs.get(id);
      if (!text) { json(res, 404, {}); return; }
      const value = { id, bank_id: state.badBank ? "foreign-bank" : "fixture-bank", original_text: state.badOriginal ? null : text,
        content_hash: "server-hash-not-proof", created_at: "fixture-time", updated_at: "fixture-time", memory_unit_count: 1,
        ...(state.extraOriginal ? { unsafe_extension: true } : {}) };
      if (state.delay) setTimeout(() => json(res, 200, value), state.delay); else json(res, 200, value); return;
    }
    let body = ""; for await (const part of req) body += part.toString(); const value = JSON.parse(body);
    if (route === "/v1/default/banks/fixture-bank/memories" && req.method === "POST") {
      calls.retain++; state.retainBody = value; const item = value.items[0]; docs.set(item.document_id, item.content);
      if (state.mode === "lost-ack") { json(res, 500, { private_error: "not-projected" }); return; }
      if (state.mode === "claim-unsent") { docs.delete(item.document_id); json(res, 500, {}); return; }
      json(res, 200, { success: state.mode !== "bad-ack", bank_id: "fixture-bank", items_count: 1, async: false }); return;
    }
    if (route === "/v1/default/banks/fixture-bank/memories/recall" && req.method === "POST") {
      calls.recall++; assert.equal(value.trace, false); assert.equal(value.tags_match, "all_strict");
      json(res, 200, { results: state.recallResults ?? [...docs.keys()].map(document_id => ({ id: "fact-id", text: "untrusted fact prose never returned", document_id })) }); return;
    }
    json(res, 404, {});
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve)); const endpoint = `http://127.0.0.1:${(server.address() as {port: number}).port}`;
  const config: HindsightGuidanceConfig = { mode: "local-guidance", endpoint, banks: { "fixture-alias": "fixture-bank" }, journal_directory: journal,
    allow_loopback_http: true, timeout_ms: 1000 };
  const store = createHindsightGuidanceStore(config);
  const close = async () => { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); await rm(owned, { recursive: true, force: true }); };
  return { owned, journal, endpoint, config, store, docs, calls, state, close };
}
const signal = () => new AbortController().signal;
const query = { repo: "fixture-repo", source_sha: "a".repeat(40), policy_version: "fixture-v1", env_fingerprint: "fixture-env", task_type: "fixture-task" };

test("guidance pure canonical document retains raw observations with no current or signed status", () => {
  const doc = prepareHistoricalGuidance(observation()); const value = JSON.parse(doc.content);
  assert.equal(value.current_verification, "not-checked"); assert.equal(value.authorization, "none"); assert.equal(value.executable, false);
  assert.equal(value.purpose, "historical-guidance"); assert.equal(value.experience.experience_id, "fixture-guide");
  assert.equal(Object.hasOwn(value.experience, "status"), false); assert.equal(Object.hasOwn(value, "signature"), false);
  assert.ok(Object.isFrozen(doc) && Object.isFrozen(doc.tags)); assert.equal(doc.content_digest.length, 64);
});
test("guidance raw unknown failure round-trips without derived root-cause fields or invented hypotheses", async () => {
  const f = await fixture(); try {
    const raw = { ...observation(), failure_analysis: { failure_id: "fixture-failure", run_id: "fixture-run", step_id: "fixture-step", ts: 1001,
      stage: "execution" as const, reason_code: "unknown" as const } };
    const doc = prepareHistoricalGuidance(raw); const payload = JSON.parse(doc.content);
    assert.deepEqual(payload.experience.failure_analysis, raw.failure_analysis);
    const receipt = await f.store.retain("fixture-alias", doc, signal()); const read = await f.store.read(receipt, signal());
    assert.deepEqual(JSON.parse(read.document.content).experience.failure_analysis, raw.failure_analysis); assert.equal(read.guidance.current_verification, "not-checked");
  } finally { await f.close(); }
});
test("guidance raw hypotheses/fix stay bounded original metadata, never repair permission", () => {
  const raw = { ...observation(), failure_analysis: { failure_id: "fixture-failure", run_id: "fixture-run", step_id: "fixture-step", ts: 1001,
    stage: "execution" as const, reason_code: "unknown" as const, hypotheses: ["unclassified" as const], fix_applied: "fixture-fix", fix_outcome: "partial" as const } };
  assert.deepEqual(JSON.parse(prepareHistoricalGuidance(raw).content).experience.failure_analysis, raw.failure_analysis);
});
for (const bad of ["/private/fixture", "task;rm", "wrapped_ghp_abcdefghijklmnop", "https://example.invalid"]) {
  test("guidance unsafe experience label refuses without storage", () => assert.throws(() => prepareHistoricalGuidance({ ...observation(), experience_id: bad }), invalidInput));
}
test("guidance hostile DTOs/accessors/copies of higher-status handles reject without traps", () => {
  let traps = 0; const proxy = new Proxy({}, { get() { traps++; throw Error(); }, ownKeys() { traps++; throw Error(); } });
  assert.throws(() => prepareHistoricalGuidance(proxy as ExperienceObservation), invalidInput);
  const accessor = Object.defineProperty(observation(), "script", { get() { traps++; throw Error(); } });
  assert.throws(() => prepareHistoricalGuidance(accessor), invalidInput);
  assert.throws(() => prepareHistoricalGuidance({ ...observation(), status: "verified" } as any), invalidInput); assert.equal(traps, 0);
});
test("guidance retain/read/query repeat checks exact originals and never projects fact text or proof", async () => {
  const f = await fixture(); try {
    const doc = prepareHistoricalGuidance(observation()); const receipt = await f.store.retain("fixture-alias", doc, signal());
    assert.equal(f.calls.retain, 1); assert.equal(receipt.current_verification, "not-checked"); assert.equal(receipt.executable, false);
    assert.deepEqual(Object.keys(f.state.retainBody).sort(), ["async", "items"]); const item = f.state.retainBody.items[0];
    assert.equal(item.timestamp, "unset"); assert.equal(item.update_mode, "replace"); assert.equal(item.tags.length, 2);
    const read = await f.store.read(receipt, signal()); assert.equal(read.document.content, doc.content);
    assert.equal(read.guidance.experience.source_sha, observation().source_sha);
    const refs = await f.store.query("fixture-alias", query, signal()); assert.equal(refs.length, 1); assert.equal(refs[0]!.document_id, receipt.document_id);
    assert.equal(JSON.stringify(refs).includes("untrusted fact"), false); assert.ok(Object.isFrozen(refs));
    assert.deepEqual(await f.store.retain("fixture-alias", doc, signal()), receipt); assert.equal(f.calls.retain, 1);
    assert.equal((await f.store.reconcile("fixture-alias", doc, signal())).state, "matched"); assert.equal(f.calls.retain, 1);
  } finally { await f.close(); }
});
test("guidance a fresh store instance uses existing journal/originals without another retain", async () => {
  const f = await fixture(); try {
    const doc = prepareHistoricalGuidance(observation()); const first = await f.store.retain("fixture-alias", doc, signal());
    const afterRestart = createHindsightGuidanceStore(f.config); const read = await afterRestart.read(JSON.parse(JSON.stringify(first)), signal());
    assert.equal(read.guidance.current_verification, "not-checked"); assert.deepEqual(await afterRestart.retain("fixture-alias", doc, signal()), first); assert.equal(f.calls.retain, 1);
  } finally { await f.close(); }
});
for (const mode of ["lost-ack", "bad-ack"]) {
  test(`guidance ${mode} retains uncertainty then reconciles only original bytes`, async () => {
    const f = await fixture(); try {
      f.state.mode = mode; const doc = prepareHistoricalGuidance(observation()); await assert.rejects(() => f.store.retain("fixture-alias", doc, signal()), fixedError);
      assert.equal(f.calls.retain, 1); f.state.mode = "normal";
      const result = await f.store.reconcile("fixture-alias", doc, signal()); assert.equal(result.state, "matched"); assert.equal(result.current_verification, "not-checked");
      await f.store.retain("fixture-alias", doc, signal()); assert.equal(f.calls.retain, 1);
    } finally { await f.close(); }
  });
}
test("guidance claimed missing original never permits a second POST", async () => {
  const f = await fixture(); try {
    f.state.mode = "claim-unsent"; const doc = prepareHistoricalGuidance(observation()); await assert.rejects(() => f.store.retain("fixture-alias", doc, signal()), fixedError);
    f.state.mode = "normal"; await assert.rejects(() => f.store.retain("fixture-alias", doc, signal()), fixedError);
    assert.equal(f.calls.retain, 1); assert.equal((await f.store.reconcile("fixture-alias", doc, signal())).state, "not-confirmed"); assert.equal(f.calls.retain, 1);
  } finally { await f.close(); }
});
for (const field of ["badOriginal", "badBank", "extraOriginal"] as const) {
  test(`guidance ${field} cannot turn an ack/hash echo into persistence acceptance`, async () => {
    const f = await fixture(); try {
      f.state[field] = true; await assert.rejects(() => f.store.retain("fixture-alias", prepareHistoricalGuidance(observation()), signal()), fixedError); assert.equal(f.calls.retain, 1);
      assert.equal((await f.store.reconcile("fixture-alias", prepareHistoricalGuidance(observation()), signal())).state, "not-confirmed"); assert.equal(f.calls.retain, 1);
    } finally { await f.close(); }
  });
}
test("guidance missing bank fails without lazy creation or consuming a local claim", async () => {
  const f = await fixture(); try {
    f.state.exists = false; const doc = prepareHistoricalGuidance(observation()); await assert.rejects(() => f.store.retain("fixture-alias", doc, signal()), fixedError);
    assert.equal(f.calls.retain, 0); assert.deepEqual(await readdir(f.journal), []); await assert.rejects(() => f.store.query("fixture-alias", query, signal()), fixedError); assert.equal(f.calls.recall, 0);
    f.state.exists = true; await f.store.retain("fixture-alias", doc, signal()); assert.equal(f.calls.retain, 1);
  } finally { await f.close(); }
});
test("guidance unknown aliases and malformed documents/ref flags reject before network", async () => {
  const f = await fixture(); try {
    const doc = prepareHistoricalGuidance(observation()); const before = { ...f.calls };
    await assert.rejects(() => f.store.retain("unknown", doc, signal()), invalidInput);
    for (const bad of [{ ...doc, content: doc.content + " " }, { ...doc, content_digest: "b".repeat(64) }, { ...doc, tags: ["knowledge:skill"] }, { ...doc, signature: "forged" }])
      await assert.rejects(() => f.store.retain("fixture-alias", bad as any, signal()), invalidInput);
    await assert.rejects(() => f.store.read({ bank: "fixture-alias", document_id: "foreign", current_verification: "verified", authorization: "none", executable: false } as any, signal()), invalidInput);
    assert.deepEqual(f.calls, before);
  } finally { await f.close(); }
});
test("guidance requested receipt digest/key must be validated and matched rather than ignored", async () => {
  const f = await fixture(); try {
    const doc = prepareHistoricalGuidance(observation()); const receipt = await f.store.retain("fixture-alias", doc, signal());
    await assert.rejects(() => f.store.read({ ...receipt, content_digest: "b".repeat(64) }, signal()), fixedError);
    await assert.rejects(() => f.store.read({ ...receipt, idempotency_key: "bad-key" }, signal()), invalidInput);
    await assert.rejects(() => f.store.read({ ...receipt, idempotency_key: undefined } as any, signal()), invalidInput);
  } finally { await f.close(); }
});
test("guidance recall deduplicates/excludes foreign/null refs and malformed entries fail closed", async () => {
  const f = await fixture(); try {
    const receipt = await f.store.retain("fixture-alias", prepareHistoricalGuidance(observation()), signal());
    f.state.recallResults = [{ id: "fact-1", text: "never shown", document_id: receipt.document_id }, { id: "fact-2", text: "duplicate", document_id: receipt.document_id },
      { id: "fact-3", text: "foreign", document_id: "foreign-id" }, { id: "fact-4", text: "null", document_id: null }];
    assert.equal((await f.store.query("fixture-alias", query, signal())).length, 1);
    f.state.recallResults.push({ id: "fact-5", text: "malformed", document_id: 1 }); await assert.rejects(() => f.store.query("fixture-alias", query, signal()), fixedError);
  } finally { await f.close(); }
});
test("guidance pre-abort has zero filesystem/network writes and does not claim an attempt", async () => {
  const f = await fixture(); try {
    const abort = new AbortController(); abort.abort(); const doc = prepareHistoricalGuidance(observation());
    await assert.rejects(() => f.store.retain("fixture-alias", doc, abort.signal), fixedError); assert.deepEqual(await readdir(f.journal), []); assert.deepEqual(f.calls, { retain: 0, original: 0, recall: 0, config: 0 });
    await f.store.retain("fixture-alias", doc, signal()); assert.equal(f.calls.retain, 1);
  } finally { await f.close(); }
});
test("guidance timeout after an actual commit remains uncertain and never repeats POST", async () => {
  const f = await fixture(); try {
    f.state.delay = 1000; const store = createHindsightGuidanceStore({ ...f.config, timeout_ms: 500 }); const doc = prepareHistoricalGuidance(observation());
    await assert.rejects(() => store.retain("fixture-alias", doc, signal()), fixedError); assert.equal(f.calls.retain, 1);
    f.state.delay = 0; assert.equal((await f.store.reconcile("fixture-alias", doc, signal())).state, "matched"); assert.equal(f.calls.retain, 1);
  } finally { await f.close(); }
});
for (const mode of [0o755, 0o777]) {
  test(`guidance invalid journal mode ${mode.toString(8)} fails before HTTP`, async () => {
    const f = await fixture(); try {
      await chmod(f.journal, mode); await assert.rejects(() => f.store.retain("fixture-alias", prepareHistoricalGuidance(observation()), signal()), fixedError); assert.equal(f.calls.config, 0);
    } finally { await f.close(); }
  });
}
test("guidance linked/partial claims cannot be reset and reused", async () => {
  const f = await fixture(); try {
    const doc = prepareHistoricalGuidance(observation()); f.state.mode = "claim-unsent"; await assert.rejects(() => f.store.retain("fixture-alias", doc, signal()), fixedError);
    const intent = (await readdir(f.journal)).find(x => x.endsWith('.intent'))!; await writeFile(path.join(f.journal, intent), "partial", { mode: 0o600 });
    await assert.rejects(() => f.store.retain("fixture-alias", doc, signal()), fixedError); assert.equal(f.calls.retain, 1);
  } finally { await f.close(); }
});
test("guidance config is explicit and refuses redirects/userinfo/network/plain mode/key injections", async () => {
  const f = await fixture(); try {
    for (const config of [{ ...f.config, mode: "signed" }, { ...f.config, allow_loopback_http: false }, { ...f.config, endpoint: "http://localhost:8888" },
      { ...f.config, endpoint: "http://192.0.2.1" }, { ...f.config, endpoint: "https://user:secret@example.invalid" }, { ...f.config, endpoint: "https://example.invalid/path" },
      { ...f.config, timeout_ms: 180001 }, { ...f.config, headers: {} }, { ...f.config, banks: { a: "same", b: "same" } },
      { ...f.config, journal_directory: '/tmp/../outside' }]) assert.throws(() => createHindsightGuidanceStore(config as any), e => e instanceof LearningError && e.code === "invalid-config");
    let traps = 0; const proxy = new Proxy({}, { ownKeys() { traps++; throw Error(); } }); assert.throws(() => createHindsightGuidanceStore(proxy as any), LearningError); assert.equal(traps, 0);
  } finally { await f.close(); }
});
test("guidance original signed store rejects unsigned request without effects or conversion", async () => {
  const f = await fixture(); try {
    const doc = prepareHistoricalGuidance(observation()); const signed = createHindsightStore({ endpoint: f.endpoint, allow_loopback_http: true, banks: f.config.banks, journal_directory: f.journal });
    await assert.rejects(() => signed.sink.ingest({ bank: "fixture-alias", ...doc, idempotency_key: "guidance-fake" } as any, signal()), invalidInput);
    assert.deepEqual(f.calls, { retain: 0, original: 0, recall: 0, config: 0 });
  } finally { await f.close(); }
});
