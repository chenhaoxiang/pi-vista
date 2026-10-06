import { rejects, strictEqual } from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { createPiRunContext, type PiCheckpointInput } from "@pi-vista/adapter-pi";
import { emitWorkspaceGuardObservation } from "@pi-vista/adapter-workspace-guard";
import { CheckpointStore, EventStore, hasKnownCredential, VistaProtocolError, type VistaEvent } from "@pi-vista/core";

const root = fileURLToPath(new URL("../", import.meta.url));
const credentialCases = [
  ["wrapped-classic", "run_ghp_123456789012345678901234567890123456_s0"],
  ["fine-grained", `run_github_pat_${"A".repeat(82)}_s0`],
] as const;
async function sandbox(): Promise<string> {
  await mkdir(join(root, "tmp"), { recursive: true });
  return mkdtemp(join(root, "tmp/shared-metadata-safety-"));
}
async function inventory(base: string): Promise<string> {
  const entries: string[] = [];
  async function walk(directory: string, prefix: string): Promise<void> {
    for (const child of (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      const relative = `${prefix}${child.name}`;
      if (child.isDirectory()) { entries.push(`dir:${relative}`); await walk(join(directory, child.name), `${relative}/`); }
      else { const bytes = await readFile(join(directory, child.name)); entries.push(`${relative}:${bytes.length}:${createHash("sha256").update(bytes).digest("hex")}`); }
    }
  }
  await walk(base, "");
  return JSON.stringify(entries);
}
function protocolError(error: unknown): boolean {
  return error instanceof VistaProtocolError && error.code === "VISTA_PROTOCOL_ERROR" && !hasKnownCredential(error.message);
}
function checkpoint(): PiCheckpointInput {
  return { task_goal: "synthetic summary", current_state: "synthetic state", source_sha: "a".repeat(40), env_fingerprint: "env-synthetic", policy_version: "policy-1", resumable: false };
}

for (const component of ["pi", "guard"] as const) {
  for (const [caseName, runId] of credentialCases) {
    test(`shared metadata regression: ${component} ${caseName} rejects before actual EventStore or custom callbacks`, async t => {
      const base = await sandbox();
      try {
        await writeFile(join(base, "sentinel"), "synthetic preexisting bytes");
        const actual = new EventStore(base);
        const checkpoints = new CheckpointStore(base);
        let appends = 0;
        let saves = 0;
        let emits = 0;
        const store = { async append(event: VistaEvent) { appends++; await actual.append(event); } };
        const checkpointStore = { async save(value: Parameters<CheckpointStore["save"]>[0]) { saves++; await checkpoints.save(value); } };
        const before = await inventory(base);
        if (component === "pi") {
          await rejects(async () => {
            const context = createPiRunContext({ runId, store, checkpointStore });
            await context.emitToolResult({ tool: "read", result: "ok" });
          }, protocolError);
          await rejects(async () => {
            const context = createPiRunContext({ run_id: runId, store, checkpointStore, emit: async partial => { emits++; await store.append(partial as VistaEvent); return partial as VistaEvent; } });
            await context.emitToolCall({ tool: "read" });
            await context.checkpoint(checkpoint());
          }, protocolError);
        } else {
          await rejects(emitWorkspaceGuardObservation({ run_id: runId, event: "decision.summary", verdict: "allow" }, { store }), protocolError);
          await rejects(emitWorkspaceGuardObservation({ event: "decision.summary", verdict: "allow" }, { store, runId }), protocolError);
        }
        strictEqual(appends, 0);
        strictEqual(saves, 0);
        strictEqual(emits, 0);
        strictEqual(await inventory(base) === before, true);
        t.diagnostic(JSON.stringify({ component, case: caseName, rejected: true, value_free_error: true, append_calls: appends, save_calls: saves, custom_emit_calls: emits, storage_inventory_and_bytes_unchanged: true }));
      } finally { await rm(base, { recursive: true, force: true }); }
    });
  }
}

test("shared metadata public imports: safe identities persist; known tool/ref/checkpoint inputs never reach callbacks", async () => {
  const base = await sandbox();
  try {
    const actual = new EventStore(base);
    const checkpoints = new CheckpointStore(base);
    let appends = 0;
    let saves = 0;
    let emits = 0;
    const store = { async append(value: VistaEvent) { appends++; await actual.append(value); } };
    const checkpointStore = { async save(value: Parameters<CheckpointStore["save"]>[0]) { saves++; await checkpoints.save(value); } };
    const runId = "run-security-integration";
    const context = createPiRunContext({ runId, sessionId: "session-security-integration", store, checkpointStore, now: 123 });
    await context.emitToolResult({ tool: "read", result: "ok", artifact_refs: [{ type: "test_result", ref: "receipt-safe", sha: "b".repeat(64), stats: { total: 192, suite: "unit" } }] });
    await context.checkpoint(checkpoint());
    await emitWorkspaceGuardObservation({ run_id: runId, event: "decision.summary", verdict: "allow", branch: "feature/metadata-safety", model_id: "provider/model-v9" }, { store, stepId: context.stepId!, now: 123 });
    const before = await inventory(base);
    const custom = createPiRunContext({ runId, store, checkpointStore, emit: async partial => { emits++; return partial as VistaEvent; } });
    for (const [, value] of credentialCases) {
      await rejects(custom.emitToolCall({ tool: value }), protocolError);
      await rejects(custom.emitToolResult({ tool: "read", result: "ok", artifact_refs: [{ type: "receipt", ref: value }] }), protocolError);
      await rejects(custom.checkpoint({ ...checkpoint(), source_sha: value }), protocolError);
      await rejects(emitWorkspaceGuardObservation({ run_id: runId, event: "decision.summary", verdict: "allow" }, { store, stepId: `${runId}_${value}` }), protocolError);
    }
    strictEqual(appends, 2);
    strictEqual(saves, 1);
    strictEqual(emits, 0);
    strictEqual(await inventory(base) === before, true);
    strictEqual((await actual.readRun(runId)).length, 2);
    strictEqual(hasKnownCredential(JSON.stringify(await checkpoints.load(runId, context.stepId!))), false);
  } finally { await rm(base, { recursive: true, force: true }); }
});
