import test from "node:test";
import assert from "node:assert/strict";
import { createServer, type ServerResponse } from "node:http";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { LearningError, createLearningLibrary, type ExperienceObservation } from "@pi-vista/learning";
import { createLocalEvidenceVerifier, type LocalEvidenceConfig } from "@pi-vista/evidence/host";
import { createLocalLearningLibrary } from "@pi-vista/learning/local";
import { createHindsightGuidanceStore } from "@pi-vista/learning/guidance";

const root = fileURLToPath(new URL("../tmp/local-learning-integration/", import.meta.url));
const binding = { run_id: "fixture-run", repo: "fixture-repo", source_sha: "a".repeat(40), policy_version: "fixture-v1", env_fingerprint: "fixture-env" };
const query = { repo: binding.repo, source_sha: binding.source_sha, policy_version: binding.policy_version, env_fingerprint: binding.env_fingerprint, task_type: "fixture-task" };
const scope = "synthetic-public-plan-v1";
const observation: ExperienceObservation = { ...binding, experience_id: "public-example", task_type: "fixture-task", ts: 1000,
  script: { task_type: "fixture-task", description: "inspect fixture metadata", preconditions: [], steps: ["inspect-fixture"], postconditions: [], known_failures: [], applicable_to: [] },
  steps: [{ step_id: "fixture-step", tool: "fixture-reader", action_description: "inspect metadata", check_fn_ids: [], expected_result: "observed", on_failure: "stop", depends_on: [] }] };
async function fixture(lostAck = false) {
  await mkdir(root, { recursive: true }); const owned = await mkdtemp(path.join(root, "case-")); const journal = path.join(owned, "journal"); await mkdir(journal, { mode: 0o700 });
  const originals = new Map<string, string>(); let retains = 0;
  const json = (response: ServerResponse, code: number, value: unknown) => { response.writeHead(code, { "Content-Type": "application/json" }); response.end(JSON.stringify(value)); };
  const server = createServer(async (request, response) => {
    const route = new URL(request.url!, "http://fixture").pathname;
    if (route.endsWith("/config")) { json(response, 200, { bank_id: "fixture-bank", config: {}, overrides: {} }); return; }
    if (route.includes("/documents/")) {
      const id = route.split("/").pop()!; const content = originals.get(id);
      json(response, content === undefined ? 404 : 200, content === undefined ? {} : { id, bank_id: "fixture-bank", original_text: content, content_hash: null, created_at: "fixture-time", updated_at: "fixture-time", memory_unit_count: 1 }); return;
    }
    let body = ""; for await (const chunk of request) body += chunk.toString(); const input = JSON.parse(body);
    if (route.endsWith("/memories")) {
      retains++; originals.set(input.items[0].document_id, input.items[0].content);
      json(response, lostAck ? 503 : 200, { success: true, bank_id: "fixture-bank", items_count: 1, async: false }); return;
    }
    if (route.endsWith("/memories/recall")) { json(response, 200, { results: [...originals.keys()].map(document_id => ({ id: "fixture-fact", text: "untrusted fact prose never projected", document_id })) }); return; }
    json(response, 404, {});
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const endpoint = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const store = createHindsightGuidanceStore({ mode: "local-guidance", endpoint, banks: { "fixture-alias": "fixture-bank" }, journal_directory: journal, allow_loopback_http: true, timeout_ms: 5000 });
  const now = Date.now(); const details = { gate: { verdict: "pass", gate_version: "b".repeat(40), config_digest: "c".repeat(64), checks: [{ name: "fixture-build", outcome: "pass" }] },
    test: { suites: [{ name: "fixture-cases", total: 2, passed: 2, failed: 0, skipped: 0, cancelled: 0, todo: 0 }] }, guard: { coverage: "complete", event_count: 2, blocked: 0, dropped: 0 } };
  const config: LocalEvidenceConfig = { mode: "local-host", scope, gate_checks: ["fixture-build"], gate_version: "b".repeat(40), gate_config_digest: "c".repeat(64), test_suites: ["fixture-cases"], now: Date.now,
    sources: (["gate", "test", "guard"] as const).map(kind => ({ subject: kind, kind, producer: "fixture-producer", collect: async () => ({ schema: 1, scope, kind, producer: "fixture-producer", ...binding,
      result_ref: `fixture-${kind}`, observed_at: now - 1000, expires_at: now + 10_000, details: details[kind] }) })) };
  const verifier = createLocalEvidenceVerifier(config); const library = createLocalLearningLibrary({ mode: "local-learning", scope, verifier, store, timeout_ms: 5000 });
  const plan = async () => { const c = library.nominate(library.observe(observation)); const h = library.verifyCandidate(c, await verifier.verify(binding, { gate: "gate", test: "test", guard: "guard" })); return library.prepareGuidance(h, "fixture-alias"); };
  const close = async () => { library.shutdown(); verifier.shutdown(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); await rm(owned, { recursive: true, force: true }); };
  return { library, verifier, config, store, plan, retains: () => retains, close };
}

test("public LOCAL + actual guidance HTTP/journal compose exact preview/persist/recall without signed fallback", async () => {
  const f = await fixture(); try {
    const p = await f.plan(); const done = await f.library.commitGuidance(p, { preview_digest: p.preview_digest }); assert.equal(done.status, "persisted");
    const historical = await f.library.recallGuidance("fixture-alias", query); assert.equal(historical.length, 1); assert.equal(historical[0]?.document.content, p.document.content);
    assert.equal(historical[0]?.current_verification, "not-checked"); assert.equal(historical[0]?.authorization, "none"); assert.equal(historical[0]?.executable, false);
    assert.equal(JSON.stringify(historical).includes("untrusted fact prose"), false); assert.equal(f.retains(), 1);
    const context = f.library.compileContext(f.library.retrieve([done], query)); assert.equal(context.item_count, 1); assert.equal(context.executable, false);
    assert.throws(() => createLearningLibrary({ verifier: f.verifier as any }), e => e instanceof LearningError && e.code === "invalid-config");
  } finally { await f.close(); }
});
test("public LOCAL lost-ack + existing durable journal is readonly-reconciled by another factory, not repeated", async () => {
  const f = await fixture(true); try {
    const p = await f.plan(); await assert.rejects(() => f.library.commitGuidance(p, { preview_digest: p.preview_digest }), e => e instanceof LearningError && e.code === "sink-failed");
    const fresh = createLocalLearningLibrary({ mode: "local-learning", scope, verifier: createLocalEvidenceVerifier(f.config), store: f.store, timeout_ms: 5000 });
    const reconciled = await fresh.reconcileGuidance(p.bank, p.document); assert.equal(reconciled.state, "matched"); assert.equal(f.retains(), 1);
    const historical = await fresh.recallGuidance(p.bank, query); assert.equal(historical.length, 1);
    const seen = fresh.importGuidance(historical[0]!, { ...binding, run_id: "fresh-run", experience_id: "fresh-example", ts: 1001 });
    assert.equal(seen.status, "observed"); assert.equal(seen.verification, undefined); assert.equal(fresh.retrieve([seen], query).handles.length, 0); assert.equal(f.retains(), 1); fresh.shutdown();
  } finally { await f.close(); }
});
