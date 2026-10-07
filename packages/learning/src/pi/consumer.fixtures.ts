import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { createEvidenceVerifier, evidenceMessage, type EvidenceBinding, type EvidenceKind } from "@pi-vista/evidence";
import { createLearningLibrary, type ArchiveOriginPin } from "@pi-vista/learning";
import { createPiObservation, type PiExtensionAPI, type PiNotification, type PiTask, type PiUIContext } from "@pi-vista/learning/pi";
import type { VistaEvent } from "@pi-vista/core";

/** Self-contained public-import synthetic exercise, also copied into exact installed-tarball consumers. */
export async function runPiConsumerFixture(): Promise<void> {
  const task: PiTask = { repo: "fixture-repo", source_sha: "a".repeat(40), policy_version: "policy-1", env_fingerprint: "env-1",
    task_type: "metadata-update", task_goal: "bounded metadata validation", bank: "fixture-bank" };
  let time = 10_000; const keys = generateKeyPairSync("ed25519"); const publicKey = keys.publicKey.export({ type: "spki", format: "pem" }).toString();
  let expected: EvidenceBinding = { run_id: "historical-run", repo: task.repo, source_sha: task.source_sha, policy_version: task.policy_version, env_fingerprint: task.env_fingerprint };
  const subjects = { gate: "fixture-gate", test: "fixture-test", guard: "fixture-guard" };
  const details = {
    gate: { verdict: "pass", gate_version: "b".repeat(40), config_digest: "c".repeat(64), checks: [{ name: "source-check", outcome: "pass" }] },
    test: { suites: [{ name: "fixture-suite", total: 1, passed: 1, failed: 0, skipped: 0, cancelled: 0 }] },
    guard: { coverage: "complete", event_count: 1, blocked: 0 },
  };
  function receipt(kind: EvidenceKind) {
    const payload = { schema: 1, kind, issuer: "fixture-owner", ...expected, receipt_ref: `fixture-${kind}-ref`, issued_at: 9000, expires_at: 15_000, details: details[kind] };
    const message = evidenceMessage(payload); return { payload, content_digest: createHash("sha256").update(message).digest("hex"), signature: sign(null, Buffer.from(message), keys.privateKey).toString("base64") };
  }
  const verifier = createEvidenceVerifier({ now: () => time, max_age_ms: 10_000, timeout_ms: 50,
    sources: (["gate", "test", "guard"] as const).map(kind => ({ subject: subjects[kind], issuer: "fixture-owner", kind, public_key: publicKey, read: async () => receipt(kind) })),
    gate_checks: ["source-check"], gate_version: "b".repeat(40), gate_config_digest: "c".repeat(64), test_suites: ["fixture-suite"] });
  const pin: ArchiveOriginPin = { role: "archive-origin", issuer: "fixture-origin", key_id: "fixture-key", repo: task.repo, bank: task.bank,
    public_key: publicKey, not_before: 0, not_after: 20_000, trust: "pinned-history" };
  const library = createLearningLibrary({ verifier, archive: { origin: pin, now: () => time,
    sign: async request => ({ signature: sign(null, Buffer.from(request.message), keys.privateKey).toString("base64") }) }, timeout_ms: 50 });
  const candidate = library.nominate(library.observe({ ...expected, experience_id: "fixture-experience", ts: 9500, task_type: task.task_type,
    script: { task_type: task.task_type, description: "bounded metadata validation", preconditions: ["source-bound"], steps: ["inspect-metadata"], postconditions: ["observed"], known_failures: [], applicable_to: [] },
    steps: [{ step_id: "fixture-step", tool: "metadata-reader", action_description: "inspect bounded metadata", check_fn_ids: [], expected_result: "observed", on_failure: "stop", depends_on: [] }] }));
  const verified = library.verifyCandidate(candidate, await verifier.verify(expected, subjects)); const archive = await library.prepareArchive(verified, task.bank);
  const events: VistaEvent[] = []; const hooks = new Map<PiNotification, (event: unknown, context: PiUIContext) => undefined>();
  const commands: string[] = [];
  const api: PiExtensionAPI = { on(name, handler) { hooks.set(name, handler); return () => { hooks.delete(name); }; }, registerCommand(name) { commands.push(name); } };
  const ui: PiUIContext = { hasUI: false, ui: { notify() { assert.fail("no UI in consumer fixture"); } } };
  const addon = createPiObservation({ now: () => time, resolve_task: async () => task, tools: [{ native_name: "read", classification: "metadata-reader" }],
    events: { append: async event => { events.push(event); } }, verifier, subjects, timeout_ms: 100,
    history: { origins: [pin], now: () => time, max_age_ms: 60_000, timeout_ms: 50,
      port: { query: async () => ({ documents: [{ document_id: "fixture-history", bank: task.bank }] }), read: async ref => ({ ...ref, document: archive.document }) } } });
  addon.extension(api); assert.equal(hooks.size, 7); assert.equal(commands.length, 4);
  const fire = (name: PiNotification, event: unknown = {}) => assert.equal(hooks.get(name)!(event, ui), undefined);
  async function idle() { for (let i = 0; i < 100; i++) { if (addon.controller.status().pending_work === 0) return; await delay(2); } assert.fail("fixture deadline"); }
  fire("session_start"); fire("agent_start"); await idle(); expected = addon.controller.status().binding!;
  fire("tool_execution_start", { toolCallId: "raw-one", toolName: "read", args: { canary: "private-arguments" } });
  fire("tool_execution_start", { toolCallId: "raw-two", toolName: "read", args: { canary: "private-arguments" } });
  fire("tool_execution_end", { toolCallId: "raw-two", isError: true, result: { canary: "private-result" } });
  fire("tool_execution_end", { toolCallId: "raw-one", isError: false, result: { canary: "private-result" } }); await idle();
  const starts = events.filter(e => e.action === "pi:tool-execution-start"); const ends = events.filter(e => e.action === "pi:tool-execution-end");
  assert.deepEqual(ends.map(e => e.step_id), [starts[1]!.step_id, starts[0]!.step_id]); assert.deepEqual(ends.map(e => e.result), ["failed", "ok"]);
  const preview = await addon.controller.preview(); assert.equal(preview.context.item_count, 1); await assert.rejects(addon.controller.adopt({ ...preview }, preview.preview_digest));
  const adopted = await addon.controller.adopt(preview, preview.preview_digest); assert.equal(adopted.selection, "local-guidance-acknowledgement"); assert.equal(adopted.current, "MISSING");
  const status = await addon.controller.verifyCurrent(); assert.equal(status.current, "current-verified"); assert.equal(status.authorization, "none"); assert.equal(status.executable, false);
  time = 15_000; assert.equal(addon.controller.status().current, "MISSING"); fire("agent_end"); await idle(); assert.equal(addon.controller.status().phase, "active");
  fire("agent_settled"); await idle(); assert.equal(addon.controller.status().phase, "settled"); fire("session_shutdown");
  assert.equal(addon.controller.status().binding, undefined); assert.doesNotMatch(JSON.stringify(events), /raw-one|raw-two|private-arguments|private-result/u);
}
