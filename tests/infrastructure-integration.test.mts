import { deepStrictEqual, match, ok, rejects, strictEqual } from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { createPiRunContext, type PiCheckpointInput, type PiToolCallInput } from "@pi-vista/adapter-pi";
import { emitWorkspaceGuardObservation, type WorkspaceGuardObservation } from "@pi-vista/adapter-workspace-guard";
import { emitAiGateEvidence, type AiGateEvidence } from "@pi-vista/adapter-ai-gate";
import { CheckpointStore, emitVistaEvent, EventStore, VistaProtocolError } from "@pi-vista/core";
import { MAX_OUTPUT_BYTES, observe, runCli, type ObservationView } from "@pi-vista/cli";
import { CheckError, CheckRegistry, type CheckHandler, type CheckReport } from "@pi-vista/checks";
import { VISTA_PROTOCOL_VERSION, type VistaCheckFunction, type VistaEvent } from "@pi-vista/protocol";

const root = fileURLToPath(new URL("../", import.meta.url));
const bin = join(root, "packages/cli/dist/bin.js");
const runId = "run-integration-a";
const otherRunId = "run-integration-b";
const sourceSha = "a".repeat(40);
const otherSha = "b".repeat(40);
const sharedHash = "c".repeat(64);

async function sandbox(): Promise<string> {
  await mkdir(join(root, "tmp"), { recursive: true });
  return mkdtemp(join(root, "tmp/infrastructure-integration-"));
}

async function snapshot(base: string): Promise<string[]> {
  const entries: string[] = [];
  async function walk(directory: string, prefix: string): Promise<void> {
    const children = await readdir(directory, { withFileTypes: true });
    for (const child of children.sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)) {
      const relative = `${prefix}${child.name}`;
      if (child.isDirectory()) {
        entries.push(`directory:${relative}`);
        await walk(join(directory, child.name), `${relative}/`);
      } else {
        const bytes = await readFile(join(directory, child.name));
        entries.push(`file:${relative}:${bytes.length}:${createHash("sha256").update(bytes).digest("hex")}`);
      }
    }
  }
  await walk(base, "");
  return entries;
}

function checkpointInput(stepId: string, completed: string[] = [stepId]): PiCheckpointInput {
  return {
    step_id: stepId, task_goal: "synthetic integration", current_state: "observations recorded",
    completed_steps: completed, pending_steps: [], source_sha: sourceSha,
    env_fingerprint: "env-synthetic", policy_version: "policy-synthetic",
    check_fn_ids: ["sha-binding", "env-binding"], resumable: true,
    resume_requires: ["source_sha_matches"],
  };
}

async function recordChain(base: string) {
  const store = new EventStore(base);
  const checkpoints = new CheckpointStore(base);
  let now = 100;
  const context = createPiRunContext({ runId, sessionId: "session-synthetic", store, checkpointStore: checkpoints, clock: () => now++ });
  strictEqual(context.runId, runId);
  strictEqual(context.stepId, undefined);
  const firstStep = context.nextStep();
  await context.emitToolCall({ tool: "read", target_class: "tracked_file" });
  await context.emitToolResult({ tool: "read", result: "ok", artifact_refs: [{ type: "tool_receipt", ref: "receipt-tool", verified: true, stats: { passed: 1 } }] });
  await emitWorkspaceGuardObservation({
    run_id: context.runId, trace_id: "pair-synthetic", source_sha: sourceSha,
    event: "decision.summary", verdict: "allow", rule: "shadow-policy", shadow: true,
    shared_input_hash: sharedHash,
  }, { store, stepId: firstStep, now: now++ });
  await emitAiGateEvidence({
    run_id: context.runId, source_sha: sourceSha, head_sha: sourceSha, action: "ci_match",
    status: "success", passed: true, required: true, receipt_ref: "receipt-match",
  }, { store, stepId: firstStep, now: now++ });
  const secondStep = context.nextStep();
  await context.emitToolCall({ tool: "read" });
  await context.emitToolResult({ tool: "read", result: "unknown" });
  const mismatches: AiGateEvidence[] = [
    { action: "ci_mismatch_result", result: "ok", receipt_ref: "receipt-mismatch-result" },
    { action: "ci_mismatch_status", status: "success", receipt_ref: "receipt-mismatch-status" },
    { action: "ci_mismatch_failed", result: "failed", receipt_ref: "receipt-mismatch-failed" },
  ];
  for (const evidence of mismatches) {
    await emitAiGateEvidence({ ...evidence, run_id: context.runId, source_sha: sourceSha, head_sha: otherSha }, { store, stepId: secondStep, now: now++ });
  }
  await emitVistaEvent({
    run_id: context.runId, step_id: secondStep, component: "custom:integration/v1",
    action: "integration:recorded", result: "unknown", vista_version: "future/1",
  }, { store, now: now++ });
  await context.checkpoint(checkpointInput(secondStep, [firstStep, secondStep]));
  await context.end();
  await emitAiGateEvidence({ run_id: otherRunId, action: "ci_match", status: "failure", source_sha: otherSha, head_sha: otherSha }, { store, stepId: `${otherRunId}_s0`, now: now++ });
  return { store, checkpoints, firstStep, secondStep };
}

function assertObservation(view: ObservationView): void {
  strictEqual(view.observation, "recorded-only");
  strictEqual(view.independent_verification, "not-performed");
  strictEqual(view.authorization, "none");
  strictEqual(view.version_compatibility, "not-assessed");
  match(view.storage, /core-best-effort/u);
}

function spawned(argv: readonly string[], base: string) {
  const child = spawnSync(process.execPath, [bin, ...argv, "--base-dir", base], { cwd: root, env: {}, encoding: "utf8", maxBuffer: MAX_OUTPUT_BYTES * 2 });
  strictEqual(child.error, undefined);
  strictEqual(child.signal, null);
  return { exitCode: child.status, stdout: child.stdout, stderr: child.stderr };
}

function assertPredicateOnly(report: CheckReport): void {
  strictEqual(report.verification, "predicate-only");
  strictEqual(report.authorization, "none");
  deepStrictEqual(Object.keys(report).sort(), ["authorization", "results", "satisfied", "verification"]);
  for (const result of report.results) deepStrictEqual(Object.keys(result).sort(), ["check_id", "reason", "status", "type"]);
}

test("public Pi, guard and gate observations persist a common run/step chain and bound checkpoint", async () => {
  const base = await sandbox();
  try {
    const { store, checkpoints, firstStep, secondStep } = await recordChain(base);
    deepStrictEqual([firstStep, secondStep], [`${runId}_s0`, `${runId}_s1`]);
    const events = await store.readRun(runId);
    strictEqual(events.length, 10);
    for (const event of events) {
      strictEqual(event.run_id, runId);
      ok([firstStep, secondStep].includes(event.step_id));
      strictEqual(event.vista_version, event.action === "integration:recorded" ? "future/1" : VISTA_PROTOCOL_VERSION);
    }
    strictEqual(events.filter(event => event.component === "pi").length, 4);
    const guard = events.find(event => event.component === "guard");
    strictEqual(guard?.step_id, firstStep);
    strictEqual(guard?.action, "guard:decision.summary:shadow");
    strictEqual(guard?.result, "ok");
    strictEqual(guard?.reason_code, "shadow-policy");
    deepStrictEqual(guard?.artifact_refs, [{ type: "shadow_input", ref: `shadow-input-${sharedHash}` }]);
    const matchEvent = events.find(event => event.action === "gate:ci_match");
    strictEqual(matchEvent?.result, "ok");
    strictEqual(matchEvent?.source_sha, sourceSha);
    strictEqual(matchEvent?.artifact_refs?.find(ref => ref.type === "gate_metadata")?.stats?.sha_relation, "match");
    const raw = (await readFile(join(base, "runs", runId, "events.jsonl"), "utf8")).trim().split("\n").map(line => JSON.parse(line) as VistaEvent);
    deepStrictEqual(raw, events, "actual core redaction and persisted JSONL must preserve the safe evidence");
    for (const [action, key, outcome, result] of [
      ["ci_mismatch_result", "owner_result", "ok", "unknown"],
      ["ci_mismatch_status", "owner_status", "success", "unknown"],
      ["ci_mismatch_failed", "owner_result", "failed", "failed"],
    ]) {
      const event = raw.find(record => record.action === `gate:${action}`);
      ok(event);
      strictEqual(event.step_id, secondStep);
      strictEqual(event.result, result);
      strictEqual(event.reason_code, "sha_mismatch");
      strictEqual(Object.hasOwn(event, "source_sha"), false, "neither conflicting SHA becomes the event binding");
      const stats = event.artifact_refs?.find(ref => ref.type === "gate_metadata")?.stats;
      deepStrictEqual(stats, { head_sha: otherSha, source_sha: sourceSha, sha_relation: "mismatch", [key!]: outcome });
    }
    for (const event of raw.filter(record => record.component === "gate")) {
      for (const ref of event.artifact_refs ?? []) strictEqual(Object.hasOwn(ref, "verified"), false);
    }
    const checkpoint = await checkpoints.load(runId, secondStep);
    ok(checkpoint);
    deepStrictEqual(checkpoint.completed_steps, [firstStep, secondStep]);
    strictEqual(checkpoint.run_id, runId);
    strictEqual(checkpoint.step_id, secondStep);
    strictEqual(checkpoint.source_sha, sourceSha);
    deepStrictEqual(await checkpoints.listCheckpoints(runId), [secondStep]);
    strictEqual(await checkpoints.load(otherRunId, secondStep), null);
  } finally { await rm(base, { recursive: true, force: true }); }
});

test("unified CLI API and real bin give deterministic recorded-only views without changing any storage hash", async t => {
  const base = await sandbox();
  try {
    const { firstStep, secondStep } = await recordChain(base);
    const before = await snapshot(base);
    for (const args of [["history"], ["history", runId], ["inspect", runId], ["inspect", runId, "--step", secondStep], ["compare", runId, otherRunId], ["receipts", runId]]) {
      for (const json of [false, true]) {
        const argv = [...args, ...(json ? ["--json"] : [])];
        const child = spawned(argv, base);
        strictEqual(child.exitCode, 0);
        strictEqual(child.stderr, "");
        deepStrictEqual(child, await runCli([...argv, "--base-dir", base]));
        deepStrictEqual(spawned(argv, base), child);
        strictEqual(child.stdout.includes(base), false);
        if (json) assertObservation(JSON.parse(child.stdout) as ObservationView);
        else match(child.stdout, /Independent verification: not performed\. Authorization: none/u);
      }
    }
    const inspection = await observe({ command: "inspect", runId, baseDir: base });
    if (inspection.command !== "inspect") throw new Error("unexpected view");
    strictEqual(inspection.events.total, 10);
    deepStrictEqual(inspection.checkpoints.items.map(checkpoint => [checkpoint.step_id, checkpoint.owner_claimed_resumable]), [[secondStep, true]]);
    strictEqual(inspection.events.items.find(event => event.action === "integration:recorded")?.vista_version, "future/1");
    strictEqual(JSON.stringify(inspection).includes("task_goal"), false);
    const filtered = await observe({ command: "inspect", runId, stepId: firstStep, baseDir: base });
    if (filtered.command !== "inspect") throw new Error("unexpected view");
    strictEqual(filtered.events.total, 4);
    strictEqual(filtered.checkpoints.total, 0);
    const receipts = await observe({ command: "receipts", runId, baseDir: base });
    if (receipts.command !== "receipts") throw new Error("unexpected view");
    assertObservation(receipts);
    match(receipts.metadata, /owner-claimed/u);
    const tool = receipts.receipts.items.find(ref => ref.ref === "receipt-tool");
    strictEqual(tool?.observations.items[0]?.owner_claimed_verified, true, "only the explicit Pi owner claim is displayed");
    const metadata = receipts.receipts.items.find(ref => ref.type === "gate_metadata");
    ok(metadata);
    for (const [action, key, outcome] of [["ci_mismatch_result", "owner_result", "ok"], ["ci_mismatch_status", "owner_status", "success"], ["ci_mismatch_failed", "owner_result", "failed"]]) {
      const observation: typeof metadata.observations.items[number] | undefined = metadata.observations.items.find(item => item.event.action === `gate:${action}`);
      ok(observation);
      strictEqual(observation.event.run_id, runId);
      strictEqual(observation.event.step_id, secondStep);
      strictEqual(Object.hasOwn(observation.event, "source_sha"), false);
      strictEqual(observation.owner_claimed_verified, null);
      strictEqual(observation.owner_claimed_stats.items.find(stat => stat.label === key)?.value, outcome);
      strictEqual(observation.owner_claimed_stats.items.find(stat => stat.label === "sha_relation")?.value, "mismatch");
    }
    const comparison = await observe({ command: "compare", runIdA: runId, runIdB: otherRunId, baseDir: base });
    if (comparison.command !== "compare") throw new Error("unexpected view");
    deepStrictEqual(comparison.differences.component.items.find(item => item.label === "gate"), { label: "gate", a: 4, b: 1, delta_b_minus_a: -3 });
    strictEqual(spawned(["history", "--json"], join(base, "absent")).exitCode, 0);
    const after = await snapshot(base);
    deepStrictEqual(after, before, "directory inventory, sizes and every SHA-256 must be unchanged, including absent storage");
    t.diagnostic(JSON.stringify({ storage_before: before, storage_after: after, unchanged: true }));
  } finally { await rm(base, { recursive: true, force: true }); }
});

test("stored checkpoint metadata drives opt-in predicates, not owner verification or a cached authorization", async () => {
  const base = await sandbox();
  try {
    const { checkpoints, secondStep } = await recordChain(base);
    const checkpoint = await checkpoints.load(runId, secondStep);
    ok(checkpoint);
    const before = await snapshot(base);
    const definitions: VistaCheckFunction[] = [
      { check_id: "sha-binding", type: "sha_matches", params: { expected: checkpoint.source_sha, actual: "{sha}" }, on_fail: "STOP" },
      { check_id: "env-binding", type: "env_matches", params: { expected: checkpoint.env_fingerprint, actual: checkpoint.env_fingerprint }, on_fail: "WARN" },
    ];
    const checks = new CheckRegistry();
    const missing = await checks.run(definitions, { sha: checkpoint.source_sha });
    strictEqual(missing.satisfied, false);
    strictEqual(missing.results[0]?.reason, "missing-handler");
    checks.registerBindingPredicates();
    const passing = await checks.run(definitions, { sha: checkpoint.source_sha });
    assertPredicateOnly(passing);
    strictEqual(passing.satisfied, true);
    deepStrictEqual(passing.results.map(result => result.status), ["passed", "passed"]);
    const changed = await checks.run(definitions, { sha: otherSha });
    assertPredicateOnly(changed);
    strictEqual(changed.satisfied, false);
    deepStrictEqual(changed.results.map(result => [result.status, result.reason]), [["failed", "predicate-false"], ["skipped", "stopped"]]);
    const warning = await checks.run([
      { ...definitions[1]!, params: { expected: checkpoint.env_fingerprint, actual: "env-changed" } },
      definitions[0]!,
    ], { sha: checkpoint.source_sha });
    assertPredicateOnly(warning);
    strictEqual(warning.satisfied, false);
    deepStrictEqual(warning.results.map(result => result.status), ["warning", "passed"]);
    strictEqual(JSON.stringify(passing).includes(sourceSha), false);
    deepStrictEqual(await snapshot(base), before, "predicate evaluation never writes event/checkpoint storage");
  } finally { await rm(base, { recursive: true, force: true }); }
});

test("adapter raw fields and cross-run bindings reject before writes; strict gate/CLI/checks wrapped-token boundaries stay closed", async () => {
  const base = await sandbox();
  try {
    let appends = 0;
    let saves = 0;
    let predicates = 0;
    const actual = new EventStore(base);
    const checkpoints = new CheckpointStore(base);
    const store = { async append(event: VistaEvent) { appends++; await actual.append(event); } };
    const checkpointStore = { async save(checkpoint: Parameters<CheckpointStore["save"]>[0]) { saves++; await checkpoints.save(checkpoint); } };
    const context = createPiRunContext({ runId, sessionId: "session-synthetic", store, checkpointStore });
    const stepId = context.nextStep();
    const before = await snapshot(base);
    const guard: WorkspaceGuardObservation = { run_id: runId, event: "decision.summary", verdict: "allow" };
    const gate: AiGateEvidence = { run_id: runId, action: "ci_check", status: "success" };
    for (const field of ["command", "cwd", "path", "credentials", "stdout", "model_input"]) {
      await rejects(context.emitToolCall({ tool: "read", [field]: "synthetic-forbidden" } as PiToolCallInput), VistaProtocolError);
      await rejects(emitWorkspaceGuardObservation({ ...guard, [field]: "synthetic-forbidden" } as WorkspaceGuardObservation, { store, stepId }), VistaProtocolError);
      await rejects(emitAiGateEvidence({ ...gate, [field]: "synthetic-forbidden" } as AiGateEvidence, { store, stepId }), VistaProtocolError);
    }
    for (const partial of [
      { run_id: otherRunId }, { step_id: `${otherRunId}_s0` },
      { completed_steps: [`${otherRunId}_s0`] }, { pending_steps: [`${otherRunId}_s0`] },
    ]) await rejects(context.checkpoint({ ...checkpointInput(stepId), ...partial }), VistaProtocolError);
    await rejects(emitWorkspaceGuardObservation(guard, { store, stepId: `${otherRunId}_s0` }), VistaProtocolError);
    await rejects(emitAiGateEvidence(gate, { store, stepId: `${otherRunId}_s0` }), VistaProtocolError);
    await rejects(actual.append({ run_id: runId, step_id: `${otherRunId}_s0`, ts: 1, component: "pi", action: "pi:recorded", result: "ok" }), VistaProtocolError);
    const checks = new CheckRegistry();
    checks.register("env_matches", () => { predicates++; return true; });
    for (const token of ["prefixghp_1234567890suffix", "prefixgithub_pat_1234567890suffix"]) {
      await rejects(emitAiGateEvidence({ ...gate, run_id: token }, { store }), VistaProtocolError);
      await rejects(emitAiGateEvidence({ ...gate, receipt_ref: token }, { store, stepId }), VistaProtocolError);
      await rejects(emitAiGateEvidence(gate, { store, runId: token }), VistaProtocolError);
      await rejects(emitAiGateEvidence(gate, { store, stepId: `${runId}_${token}` }), VistaProtocolError);
      const invalid = spawned(["inspect", token, "--json"], base);
      strictEqual(invalid.exitCode, 2);
      deepStrictEqual(invalid, await runCli(["inspect", token, "--json", "--base-dir", base]));
      strictEqual(invalid.stdout, "");
      strictEqual(invalid.stderr.includes(token), false);
      strictEqual((await runCli(["inspect", runId, "--step", `${runId}_${token}`, "--base-dir", base])).exitCode, 2);
      await rejects(checks.run([{ check_id: token, type: "env_matches", params: {}, on_fail: "STOP" }]), CheckError);
      await rejects(checks.run([{ check_id: "env-binding", type: "env_matches", params: { expected: token, actual: token }, on_fail: "STOP" }]), CheckError);
    }
    await context.end();
    deepStrictEqual([appends, saves, predicates], [0, 0, 0]);
    deepStrictEqual(await snapshot(base), before);
  } finally { await rm(base, { recursive: true, force: true }); }
});

test("core/adapters remain fail-open on synthetic storage I/O and observer timeouts while predicates fail closed", { timeout: 5000 }, async () => {
  const base = await sandbox();
  try {
    const blocked = join(base, "blocked-store");
    await writeFile(blocked, "synthetic non-directory", "utf8");
    const before = await snapshot(base);
    const ioStore = new EventStore(blocked);
    const ioCheckpoints = new CheckpointStore(blocked);
    const context = createPiRunContext({ runId, sessionId: "session-synthetic", store: ioStore, checkpointStore: ioCheckpoints, persistTimeoutMs: 1 });
    const stepId = context.nextStep();
    const pi = await context.emitToolResult({ tool: "read", result: "ok" });
    strictEqual(pi?.result, "ok");
    await context.checkpoint(checkpointInput(stepId));
    strictEqual((await emitWorkspaceGuardObservation({ run_id: runId, event: "decision.summary", verdict: "allow" }, { store: ioStore, stepId }))?.result, "ok");
    strictEqual((await emitAiGateEvidence({ run_id: runId, action: "ci_check", status: "success" }, { store: ioStore, stepId }))?.result, "ok");
    await context.end();
    deepStrictEqual(await ioStore.readRun(runId), []);
    strictEqual(await ioCheckpoints.load(runId, stepId), null);
    for (const append of [() => Promise.reject(new Error("synthetic observer failure")), () => new Promise<void>(() => {})]) {
      const store = { append };
      strictEqual((await emitVistaEvent({ run_id: runId, component: "pi", action: "pi:recorded", result: "unknown" }, { store, persistTimeoutMs: 1 }))?.result, "unknown");
      ok(await emitWorkspaceGuardObservation({ run_id: runId, event: "decision.summary", verdict: "allow" }, { store, stepId, persistTimeoutMs: 1 }));
      ok(await emitAiGateEvidence({ run_id: runId, action: "ci_check", status: "success" }, { store, stepId, persistTimeoutMs: 1 }));
    }
    for (const emit of [() => Promise.reject(new Error("synthetic observer failure")), () => new Promise<undefined>(() => {})]) {
      const custom = createPiRunContext({ runId, sessionId: "session-synthetic", emit, checkpointStore: { save: () => new Promise<void>(() => {}) }, persistTimeoutMs: 1 });
      strictEqual(await custom.emitToolCall({ tool: "read" }), undefined);
      await custom.checkpoint(checkpointInput(custom.stepId!));
      await custom.flush();
      await custom.end();
    }
    const handlers: Array<[CheckHandler, string]> = [
      [() => { throw new Error("synthetic predicate failure"); }, "handler-threw"],
      [(() => "not-a-boolean") as unknown as CheckHandler, "invalid-verdict"],
      [() => new Promise<boolean>(() => {}), "timeout"],
    ];
    for (const [handler, reason] of handlers) {
      const checks = new CheckRegistry();
      let followingCalls = 0;
      checks.register("custom:integration/predicate", handler);
      checks.register("env_matches", () => { followingCalls++; return true; });
      const report = await checks.run([
        { check_id: "broken-observer", type: "custom:integration/predicate", params: {}, on_fail: "WARN" },
        { check_id: "following", type: "env_matches", params: {}, on_fail: "STOP" },
      ], {}, { timeoutMs: 1 });
      assertPredicateOnly(report);
      strictEqual(report.satisfied, false);
      deepStrictEqual(report.results.map(result => [result.status, result.reason]), [["failed", reason], ["skipped", "stopped"]]);
      strictEqual(followingCalls, 0);
    }
    deepStrictEqual(await snapshot(base), before);
  } finally { await rm(base, { recursive: true, force: true }); }
});
