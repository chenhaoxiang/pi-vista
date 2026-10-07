import { test } from "node:test";
import assert from "node:assert/strict";
import { chmod, mkdir, readFile, readdir, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { createLearningLibrary, createPortableRecall, LearningError, type IngestRequest, type SinkReceipt } from "@pi-vista/learning";
import { createHindsightStore, type HindsightStoreConfig } from "@pi-vista/learning/hindsight";
import { QUERY, ownerFixture, verifiedExperience } from "./learning.fixtures.js";
import { BANK, archiveFixture, canonical, sha256 } from "./portable.fixtures.js";
import { documentResponse, fixtureEnvelope, httpFixture, journalName, json, requestOf, signal } from "./hindsight-http.fixtures.js";
const fails = (code?: string) => (error: unknown): boolean => error instanceof LearningError && (code === undefined || error.code === code) && error.stack === `LearningError: ${error.code}`;
const config: HindsightStoreConfig = { endpoint: "https://synthetic.example", banks: { "fixture-bank": "synthetic-bank" }, journal_directory: "/synthetic-private-directory" };
const promotion = async () => { const owner = ownerFixture(); const library = createLearningLibrary({ verifier: owner.verifier });
  return requestOf(library.preparePromotion(await verifiedExperience(library, owner), BANK)); };
const rebind = (request: IngestRequest): IngestRequest => {
  const document = { title: request.title, content: request.content, tags: request.tags, content_digest: sha256(request.content) };
  return { bank: request.bank, ...document, idempotency_key: `${request.idempotency_key.split("-")[0]}-${sha256(canonical({ bank: request.bank, document }))}` };
};

test("hindsight exact confirmed HTTP promotion is independently read back, frozen/private and durable before retain", async () => {
  const f = await httpFixture({ bearer_token: "synthetic-private-bearer" });
  try {
    assert.deepEqual(Object.keys(f.store).sort(), ["port", "reconcile", "sink"]); assert.ok(Object.isFrozen(f.store) && Object.isFrozen(f.store.sink) && Object.isFrozen(f.store.port));
    assert.deepEqual(f.calls, { retain: 0, get: 0, recall: 0, other: 0 });
    f.hooks.afterRetain = async () => { const files = await readdir(f.directory); assert.equal(files.filter(file => file.endsWith(".intent")).length, 1); assert.equal(files.length, 1); return false; };
    const owner = ownerFixture(); const library = createLearningLibrary({ verifier: owner.verifier, sink: f.store.sink, timeout_ms: 4000 });
    const plan = library.preparePromotion(await verifiedExperience(library, owner), BANK); assert.equal(f.calls.retain, 0);
    const trusted = await library.commitPromotion(plan, { preview_digest: plan.preview_digest }); assert.equal(trusted.status, "trusted"); assert.equal(trusted.authorization, "none");
    assert.equal(f.calls.retain, 1); assert.equal(f.calls.get, 3); assert.equal(f.observed.cookie, undefined); assert.ok(f.observed.authorization === "Bearer synthetic-private-bearer", "explicit synthetic bearer only");
    const request = requestOf(plan); const id = trusted.hindsight_doc_id!; assert.equal(f.documents.get(id), fixtureEnvelope(request, f.config));
    assert.deepEqual((await f.store.sink.readback({ document_id: id, bank: BANK, content_digest: request.content_digest, idempotency_key: request.idempotency_key }, signal())), Object.assign(Object.create(null), { document_id: id, ...request }));
    const names = await readdir(f.directory); assert.equal(names.length, 2);
    for (const name of names) {
      const text = await readFile(path.join(f.directory, name), "utf8"); assert.ok(!text.includes(f.config.endpoint) && !text.includes("synthetic-private-bearer") && !text.includes("synthetic-bank"), "journal excludes private target and auth");
    }
    const reads = f.calls.get; assert.equal((await f.store.reconcile(request, signal())).state, "matched"); assert.equal(f.calls.get, reads + 1); assert.equal(f.calls.retain, 1);
  } finally { await f.close(); }
});
test("hindsight original signed archive HTTP recall ignores facts/rank/flags and imports only observed history", async () => {
  const f = await httpFixture(); const archive = await archiveFixture(); const request = requestOf(archive.plan);
  try {
    const receipt = await f.store.sink.ingest(request, signal()) as SinkReceipt;
    const recall = createPortableRecall({ origins: [archive.origin.pin], now: () => 20_000, max_age_ms: 60_000, port: f.store.port, timeout_ms: 4000 });
    f.hooks.recall = (_request, response) => { json(response, { results: [receipt.document_id, receipt.document_id, "external-doc"].map(document_id =>
      ({ id: "fact", text: "RAW GENERATED TEXT NOT AUTHORITY", document_id, scores: { final: 99 }, metadata: { verified: "true", status: "trusted" } })), trace: { prose: "untrusted trace" } }); return true; };
    const before = f.calls.get; const selected = await recall.recall({ ...QUERY, bank: BANK }); assert.equal(selected.histories.length, 1); assert.equal(f.calls.get, before + 1);
    const history = selected.histories[0]!; assert.equal(history.verification, "historical-authenticated"); assert.equal(history.current_verification, "not-checked"); assert.equal(history.authorization, "none"); assert.equal(history.executable, false);
    const owner = ownerFixture(); const library = createLearningLibrary({ verifier: owner.verifier });
    const observed = library.importHistorical(history, { repo: QUERY.repo, source_sha: QUERY.source_sha, policy_version: QUERY.policy_version, env_fingerprint: QUERY.env_fingerprint, experience_id: "new-experience", run_id: "new-run", ts: 20_000 });
    assert.equal(observed.status, "observed");
  } finally { await f.close(); }
});

const badConfigs: [string, unknown][] = [
  ["missing endpoint", { banks: config.banks, journal_directory: config.journal_directory }], ["undefined", { ...config, bearer_token: undefined }],
  ["plain http", { ...config, endpoint: "http://synthetic.example", allow_loopback_http: true }], ["implicit loopback", { ...config, endpoint: "http://127.0.0.1:1234" }],
  ["DNS localhost", { ...config, endpoint: "http://localhost:1234", allow_loopback_http: true }], ["ambiguous loopback", { ...config, endpoint: "http://127.1:1234", allow_loopback_http: true }],
  ["url auth", { ...config, endpoint: "https://user:secret@synthetic.example" }], ["query", { ...config, endpoint: "https://synthetic.example?token=secret" }],
  ["fragment", { ...config, endpoint: "https://synthetic.example#secret" }], ["prefix", { ...config, endpoint: "https://synthetic.example/api" }],
  ["backslash", { ...config, endpoint: "https://synthetic.example\\" }], ["case", { ...config, endpoint: "HTTPS://synthetic.example" }],
  ["relative root", { ...config, journal_directory: "relative" }], ["ancestor normalization", { ...config, journal_directory: "/private/../root" }],
  ["root", { ...config, journal_directory: "/" }], ["empty banks", { ...config, banks: {} }],
  ["duplicate actual banks", { ...config, banks: { first: "synthetic-bank", second: "synthetic-bank" } }], ["unsafe alias", { ...config, banks: { "unsafe/path": "synthetic-bank" } }],
  ["unsafe actual bank", { ...config, banks: { first: "unsafe/path" } }], ["token newline", { ...config, bearer_token: "synthetic\nsecret" }],
  ["unknown headers", { ...config, headers: { Cookie: "synthetic" } }], ["bad timeout", { ...config, timeout_ms: 10_001 }],
  ["bad response bound", { ...config, max_response_bytes: 0 }], ["bad loopback permission", { ...config, allow_loopback_http: "yes" }],
];
for (const [name, value] of badConfigs) test(`hindsight config refuses ${name} with fixed private error and no I/O`, () => assert.throws(() => createHindsightStore(value as HindsightStoreConfig), fails("invalid-config")));

test("hindsight input/config proxies, revoked proxies, getters and hostile arrays are refused without reflection traps or effects", async () => {
  let calls = 0; const handler = { get: () => { calls++; throw Error(); }, ownKeys: () => { calls++; throw Error(); }, getPrototypeOf: () => { calls++; throw Error(); } };
  const proxy = new Proxy({}, handler); const revoked = Proxy.revocable({}, handler); revoked.revoke(); const getter = Object.defineProperty({}, "endpoint", { get: () => { calls++; throw Error(); } });
  for (const value of [proxy, revoked.proxy, getter, [], Object.create(config), { ...config, [Symbol("hidden")]: "data" }]) assert.throws(() => createHindsightStore(value as any), fails("invalid-config"));
  for (const banks of [proxy, revoked.proxy, Object.defineProperty({}, BANK, { get: () => { calls++; throw Error(); } })]) assert.throws(() => createHindsightStore({ ...config, banks } as any), fails("invalid-config"));
  const f = await httpFixture(); const good = await promotion();
  try {
    const accessor = { ...good }; Object.defineProperty(accessor, "content", { get: () => { calls++; throw Error(); } });
    for (const value of [proxy, revoked.proxy, accessor, Object.create(good), { ...good, tags: Object.assign([...good.tags], { extra: true }) }, { ...good, tags: new Array(1) }, { ...good, tags: proxy }, { ...good, [Symbol("hidden")]: "data" }]) {
      await assert.rejects(f.store.sink.ingest(value as any, signal()), fails("invalid-input"));
    }
    await assert.rejects(f.store.sink.ingest(good, proxy as any), fails("invalid-input"));
    assert.deepEqual(f.calls, { retain: 0, get: 0, recall: 0, other: 0 }); assert.deepEqual(await readdir(f.directory), []); assert.equal(calls, 0);
  } finally { await f.close(); }
});
const badRequests: [string, (request: IngestRequest) => IngestRequest][] = [
  ["title", request => rebind({ ...request, title: "unapproved title" })], ["tags", request => rebind({ ...request, tags: ["knowledge:failure"] })],
  ["hash", request => ({ ...request, content_digest: "0".repeat(64) })], ["identity", request => ({ ...request, idempotency_key: `learning-${"0".repeat(64)}` })],
  ["unknown bank", request => rebind({ ...request, bank: "unknown-bank" })], ["arbitrary content", request => rebind({ ...request, content: "raw arbitrary prose" })],
  ["noncanonical", request => rebind({ ...request, content: JSON.stringify(JSON.parse(request.content), null, 1) })],
  ["status flag", request => { const data = JSON.parse(request.content); data.experience.status = "trusted"; return rebind({ ...request, content: canonical(data) }); }],
  ["unknown version", request => { const data = JSON.parse(request.content); data.schema = 2; return rebind({ ...request, content: canonical(data) }); }],
  ["credential metadata", request => { const data = JSON.parse(request.content); data.experience.script.description = "ghp_" + "A".repeat(36); return rebind({ ...request, content: canonical(data) }); }],
  ["uppercase digest", request => ({ ...request, content_digest: request.content_digest.toUpperCase() })],
];
for (const [name, change] of badRequests) test(`hindsight ingest rejects ${name} before any effect, even with rebound preview`, async () => {
  const f = await httpFixture(); try { await assert.rejects(f.store.sink.ingest(change(await promotion()), signal()), fails("invalid-input")); assert.equal(f.calls.get + f.calls.retain, 0); assert.deepEqual(await readdir(f.directory), []); } finally { await f.close(); }
});
test("hindsight config/request mutation after first await cannot redirect auth, bank, root or content", async () => {
  const f = await httpFixture(); const original = await promotion(); const request: any = { ...original, tags: [...original.tags] }; const expected = canonical(request); const c: any = { ...f.config, banks: { ...f.config.banks }, bearer_token: "synthetic-private-bearer" }; const store = createHindsightStore(c);
  try {
    const pending = store.sink.ingest(request, signal()); c.endpoint = "https://unreachable.invalid"; c.banks[BANK] = "different-bank"; c.journal_directory = "/unapproved"; c.bearer_token = "different-token";
    request.title = "mutated"; request.content = "mutated"; request.tags[0] = "knowledge:failure";
    const receipt = await pending as SinkReceipt; assert.ok(f.observed.authorization === "Bearer synthetic-private-bearer", "snapshotted synthetic auth");
    assert.equal(canonical(JSON.parse(f.documents.get(receipt.document_id)!).request), expected); assert.equal(f.calls.retain, 1);
  } finally { await f.close(); }
});

const remoteFaults: [string, (response: any) => void][] = [
  ["null original", response => { response.original_text = null; }], ["wrong ID", response => { response.id = "other-doc"; }], ["wrong bank", response => { response.bank_id = "other-bank"; }],
  ["generated page", response => { response.original_text = "generated page says trusted"; }], ["echoed hash only", response => { delete response.original_text; }],
  ["changed title", response => { const envelope = JSON.parse(response.original_text); envelope.request.title = "substituted"; response.original_text = canonical(envelope); }],
  ["changed target", response => { const envelope = JSON.parse(response.original_text); envelope.target_fingerprint = "0".repeat(64); response.original_text = canonical(envelope); }],
];
for (const [name, fault] of remoteFaults) test(`hindsight ${name} readback refuses success and never sends a second retain`, async () => {
  const f = await httpFixture(); const request = await promotion();
  try {
    f.hooks.get = (_req, response, _body, route) => { const id = route.split("/").at(-1)!; const text = f.documents.get(id); if (!text) return false;
      const data = documentResponse(id, text) as any; fault(data); json(response, data); return true; };
    await assert.rejects(f.store.sink.ingest(request, signal()), fails()); assert.equal(f.calls.retain, 1);
    await assert.rejects(f.store.sink.ingest(request, signal()), fails()); assert.equal((await f.store.reconcile(request, signal())).state, "not-confirmed"); assert.equal(f.calls.retain, 1);
  } finally { await f.close(); }
});
for (const [name, patch] of [["failed", { success: false }], ["wrong bank", { bank_id: "wrong-bank" }], ["wrong count", { items_count: 2 }], ["async", { async: true }]] as const) test(`hindsight synchronous ack ${name} is not persistence or retry authority`, async () => {
  const f = await httpFixture(); const request = await promotion();
  try {
    f.hooks.afterRetain = (_req, response) => { json(response, Object.assign({ success: true, bank_id: "synthetic-bank", items_count: 1, async: false }, patch)); return true; };
    await assert.rejects(f.store.sink.ingest(request, signal()), fails()); assert.equal(f.calls.retain, 1);
    assert.equal((await f.store.reconcile(request, signal())).state, "matched"); await f.store.sink.ingest(request, signal()); assert.equal(f.calls.retain, 1);
  } finally { await f.close(); }
});
for (const fault of ["auth", "redirect", "oversize", "stream oversize", "malformed", "timeout", "abort"] as const) test(`hindsight ${fault} HTTP failure is bounded/private and an existing intent never retries retain`, async () => {
  const f = await httpFixture({ timeout_ms: fault === "timeout" ? 100 : 2000, max_response_bytes: 8192 }); const request = await promotion(); const controller = new AbortController();
  try {
    f.hooks.get = (_req, response) => {
      if (fault === "auth") json(response, { detail: "synthetic-private-error" }, 401);
      else if (fault === "redirect") { response.writeHead(307, { Location: `${f.config.endpoint}/forbidden-redirect` }); response.end(); }
      else if (fault === "oversize") { response.writeHead(200, { "Content-Length": "9000" }); response.end("x".repeat(9000)); }
      else if (fault === "stream oversize") { response.writeHead(200); response.write("x".repeat(5000)); response.end("x".repeat(5000)); }
      else if (fault === "malformed") response.end("not json synthetic-private-error");
      else if (fault === "abort") controller.abort();
      return true;
    };
    await assert.rejects(f.store.sink.ingest(request, controller.signal), fails());
    await assert.rejects(f.store.sink.ingest(request, signal()), fails()); assert.equal(f.calls.retain, 0); assert.equal(f.calls.other, 0);
    assert.equal((await f.store.reconcile(request, signal())).state, "not-confirmed"); assert.equal((await readdir(f.directory)).length, 1);
  } finally { await f.close(); }
});

test("hindsight corrections and safe failure snapshots use the unchanged strict decoder", async () => {
  const f = await httpFixture(); const archive = await archiveFixture();
  try {
    const payload = JSON.parse((await promotion()).content); payload.experience.failure_analysis = { authorization: "none", verification: "observed-only", failure_id: "failure-1", run_id: payload.experience.run_id, step_id: "step-1", ts: 9500,
      stage: "validation", reason_code: "test_failed", failure_type: "validation", root_cause: "test_regression", root_cause_basis: "hypothesis", hypotheses: ["test_regression"], fix_applied: "bounded-fix", fix_outcome: "resolved" };
    payload.purpose = "correction"; payload.correction = { failure_id: "failure-1", prior_claim: "prior-claim", correction_code: "corrected" };
    const request = rebind({ ...requestOf(archive.plan), idempotency_key: "learning-placeholder", title: "Correction: experience-1", content: canonical(payload), tags: ["knowledge:failure"] });
    await f.store.sink.ingest(request, signal()); assert.equal(f.calls.retain, 1);
    payload.experience.failure_analysis.root_cause = "unclassified";
    await assert.rejects(f.store.sink.ingest(rebind({ ...request, content: canonical(payload) }), signal()), fails("invalid-input")); assert.equal(f.calls.retain, 1);
  } finally { await f.close(); }
});

test("hindsight scoped refs/receipt/query/unsigned archive cannot bypass current authority or silently partially recall", async () => {
  const f = await httpFixture(); const archive = await archiveFixture(); const request = requestOf(archive.plan);
  try {
    const receipt = await f.store.sink.ingest(request, signal()) as SinkReceipt;
    const before = f.calls.get;
    for (const ref of [{ document_id: receipt.document_id, bank: "unknown-bank" }, { document_id: "arbitrary-document", bank: BANK }, { document_id: receipt.document_id.replace(/.$/u, "z"), bank: BANK }]) await assert.rejects(f.store.port.read(ref, signal()), fails("invalid-input"));
    await assert.rejects(f.store.port.query({ ...QUERY, bank: BANK, prompt: "raw prompt" } as any, signal()), fails("invalid-input")); assert.equal(f.calls.get, before);
    await assert.rejects(f.store.sink.readback({ ...receipt, content_digest: "0".repeat(64) }, signal()), fails("sink-mismatch"));
    const text = f.documents.get(receipt.document_id)!; const envelope = JSON.parse(text); const inner = JSON.parse(envelope.request.content); inner.signature = Buffer.alloc(64).toString("base64");
    envelope.request = rebind({ ...envelope.request, content: canonical(inner) });
    // A self-consistent new safe historical CLAIM is transportable, but its signature is never authenticated by storage.
    const forgedReceipt = await f.store.sink.ingest(envelope.request, signal()) as SinkReceipt;
    const recall = createPortableRecall({ origins: [archive.origin.pin], now: () => 20_000, max_age_ms: 60_000, port: f.store.port });
    await assert.rejects(recall.recall({ ...QUERY, bank: BANK }), fails("unverified-archive"));
    f.documents.delete(forgedReceipt.document_id); await assert.rejects(f.store.port.read({ document_id: forgedReceipt.document_id, bank: BANK }, signal()), fails("sink-mismatch"));
    const selected = await recall.recall({ ...QUERY, bank: BANK }); const history = selected.histories[0]!;
    const library = createLearningLibrary({ verifier: ownerFixture().verifier }); const imported = library.importHistorical(history, { repo: QUERY.repo, source_sha: QUERY.source_sha, policy_version: QUERY.policy_version, env_fingerprint: QUERY.env_fingerprint, experience_id: "new-experience", run_id: "new-run", ts: 20_000 });
    assert.equal(imported.status, "observed"); assert.equal(imported.verification, undefined); assert.equal(library.retrieve([imported, history], QUERY).handles.length, 0);
    assert.throws(() => library.verifyCandidate(library.nominate(imported), history as any), fails("unverified-evidence"));
    assert.equal(f.calls.retain, 2);
  } finally { await f.close(); }
});

for (const fault of ["missing directory", "permissive directory", "symlink directory", "symlink intent", "permissive intent", "partial intent", "partial completion"] as const) test(`hindsight POSIX ${fault} is fail-closed with no remote retain`, async () => {
  const f = await httpFixture(); const request = await promotion(); let store = f.store;
  try {
    const file = path.join(f.directory, `${journalName(request)}.intent`);
    if (fault === "missing directory") store = createHindsightStore({ ...f.config, journal_directory: path.join(f.root, "missing") });
    if (fault === "permissive directory") await chmod(f.directory, 0o755);
    if (fault === "symlink directory") { const link = path.join(f.root, "link"); await symlink(f.directory, link); store = createHindsightStore({ ...f.config, journal_directory: link }); }
    if (fault === "symlink intent") { const target = path.join(f.root, "outside"); await writeFile(target, "unchanged", { mode: 0o600 }); await symlink(target, file); }
    if (fault === "permissive intent") await writeFile(file, fixtureEnvelope(request, f.config), { mode: 0o644 });
    if (fault === "partial intent") await writeFile(file, "{", { mode: 0o600 });
    if (fault === "partial completion") { await writeFile(file, fixtureEnvelope(request, f.config), { mode: 0o600 }); await writeFile(path.join(f.directory, `${journalName(request)}.complete`), "{", { mode: 0o600 }); }
    await assert.rejects(store.sink.ingest(request, signal()), fails()); assert.equal((await store.reconcile(request, signal())).state, "not-confirmed"); assert.equal(f.calls.retain, 0);
    if (fault === "symlink intent") assert.equal(await readFile(path.join(f.root, "outside"), "utf8"), "unchanged");
  } finally { await f.close(); }
});
test("hindsight preaborted operation and reconciliation with no intent perform no write or implicit recovery", async () => {
  const f = await httpFixture(); const request = await promotion();
  try { const abort = new AbortController(); abort.abort(); await assert.rejects(f.store.sink.ingest(request, abort.signal), fails());
    assert.equal((await f.store.reconcile(request, signal())).state, "not-confirmed"); assert.deepEqual(await readdir(f.directory), []); assert.equal(f.calls.retain + f.calls.get, 0); }
  finally { await f.close(); }
});

test("hindsight recall references are bounded, sorted and namespace-bound; malformed candidates cannot yield partial success", async () => {
  const f = await httpFixture(); const archive = await archiveFixture(); const receipt = await f.store.sink.ingest(requestOf(archive.plan), signal()) as SinkReceipt;
  try {
    const missing = `${receipt.document_id.slice(0, -64)}${"0".repeat(64)}`; const generated = (document_id: unknown) => ({ id: "fact", text: "untrusted prose", document_id });
    f.hooks.recall = (_req, response) => { json(response, { results: [generated(receipt.document_id), generated(missing), generated(receipt.document_id), generated(null), generated("external-doc")] }); return true; };
    const projected = await f.store.port.query({ ...QUERY, bank: BANK }, signal()) as { documents: { document_id: string; bank: string }[] };
    assert.deepEqual(projected.documents.map(ref => ref.document_id), [receipt.document_id, missing].sort());
    const recall = createPortableRecall({ origins: [archive.origin.pin], now: () => 20_000, max_age_ms: 60_000, port: f.store.port });
    await assert.rejects(recall.recall({ ...QUERY, bank: BANK }), fails());
    for (const results of [Array.from({ length: 65 }, () => generated(receipt.document_id)), [generated(1)], [generated(`${receipt.document_id.slice(0, -1)}z`)]]) {
      f.hooks.recall = (_req, response) => { json(response, { results }); return true; }; await assert.rejects(f.store.port.query({ ...QUERY, bank: BANK }, signal()), fails());
    }
    assert.equal(f.calls.retain, 1);
  } finally { await f.close(); }
});
test("hindsight bank-scoped IDs cannot select another mapping; generated hash/metadata are ignored with exact original", async () => {
  const f = await httpFixture(); const request = await promotion();
  try {
    const receipt = await f.store.sink.ingest(request, signal()) as SinkReceipt;
    const store = createHindsightStore({ ...f.config, banks: { ...f.config.banks, second: "second-bank" } }); const reads = f.calls.get;
    await assert.rejects(store.port.read({ document_id: receipt.document_id, bank: "second" }, signal()), fails("invalid-input")); assert.equal(f.calls.get, reads);
    f.hooks.get = (_req, response, _body, route) => { const id = route.split("/").at(-1)!; json(response, { ...documentResponse(id, f.documents.get(id)!), content_hash: "not-a-proof", document_metadata: { status: "trusted", verified: true } }); return true; };
    const readback = await f.store.sink.readback(receipt, signal()) as any; assert.equal(readback.content, request.content); assert.equal(readback.content_digest, request.content_digest);
    await assert.rejects(f.store.port.read({ document_id: receipt.document_id, bank: BANK }, signal()), fails("sink-mismatch")); assert.equal(f.calls.retain, 1);
  } finally { await f.close(); }
});
test("hindsight first preflight mismatch and nonregular intent refuse before retain, with no takeover", async () => {
  const f = await httpFixture(); const request = await promotion();
  try {
    const envelope = fixtureEnvelope(request, f.config); const id = JSON.parse(envelope).document_id; f.documents.set(id, "impostor original");
    await assert.rejects(f.store.sink.ingest(request, signal()), fails()); assert.equal(f.calls.retain, 0);
    f.documents.delete(id); await assert.rejects(f.store.sink.ingest(request, signal()), fails()); assert.equal(f.calls.retain, 0);
    const rePrepared = rebind(await promotion());
    assert.equal(rePrepared.idempotency_key, request.idempotency_key); // Re-preparation cannot evade the immutable claim.
  } finally { await f.close(); }
  const second = await httpFixture(); try { await mkdir(path.join(second.directory, `${journalName(request)}.intent`), { mode: 0o700 }); await assert.rejects(second.store.sink.ingest(request, signal()), fails()); assert.equal(second.calls.retain, 0); } finally { await second.close(); }
});
