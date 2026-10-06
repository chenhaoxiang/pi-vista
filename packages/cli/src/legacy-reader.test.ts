import { deepStrictEqual, strictEqual } from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { CheckpointStore, EventStore, type VistaCheckpoint, type VistaEvent } from "@pi-vista/core";
import { observe, runCli } from "@pi-vista/cli";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const wrappedGhp = "prefixghp_1234567890suffix";
const wrappedPat = "prefixgithub_pat_1234567890suffix";

test("CLI defense-in-depth still projects fixed safe views when legacy public readers return tainted data", async () => {
  await mkdir(join(root, "tmp"), { recursive: true });
  const base = await mkdtemp(join(root, "tmp/cli-legacy-reader-"));
  const original = {
    listRuns: EventStore.prototype.listRuns, readRun: EventStore.prototype.readRun, append: EventStore.prototype.append,
    listCheckpoints: CheckpointStore.prototype.listCheckpoints, load: CheckpointStore.prototype.load, save: CheckpointStore.prototype.save,
  };
  let writes = 0;
  const event: VistaEvent = {
    run_id: "run-a", step_id: "run-a_s0", ts: 123, component: `custom:${wrappedPat}`,
    action: wrappedGhp, result: "ok", reason_code: wrappedPat, source_sha: wrappedGhp,
    vista_version: `future/${wrappedPat}`,
    artifact_refs: [
      { type: "gate_receipt", ref: "receipt-safe", stats: { safe: wrappedPat, count: 2, [`label-${wrappedPat}`]: 3, constructor: 4 } },
      { type: "gate_receipt", ref: wrappedGhp }, { type: wrappedPat, ref: "receipt-type" },
      { type: "gate_receipt", ref: "receipt-sha", sha: wrappedGhp },
      { type: "gate_receipt", ref: "https://synthetic.invalid.example/private" },
    ],
  };
  const checkpoint: VistaCheckpoint = {
    run_id: "run-a", step_id: "run-a_s0", ts: 123, task_goal: "PRIVATE_NARRATIVE", current_state: "PRIVATE_STATE",
    source_sha: wrappedPat, env_fingerprint: wrappedGhp, policy_version: wrappedPat,
    completed_steps: [`run-a_${wrappedGhp}`], pending_steps: [], check_fn_ids: [wrappedPat], resume_requires: [wrappedGhp], resumable: true,
  };
  try {
    await writeFile(join(base, "sentinel"), "synthetic unchanged bytes");
    EventStore.prototype.listRuns = async () => ["run-a", "run-b", wrappedPat];
    EventStore.prototype.readRun = async () => [
      { ...event, [wrappedPat]: "PRIVATE_UNKNOWN_TEXT", payload: "PRIVATE_PAYLOAD" },
      { ...event, step_id: `run-a_${wrappedGhp}` },
    ];
    CheckpointStore.prototype.listCheckpoints = async () => ["run-a_s0", `run-a_${wrappedGhp}`];
    CheckpointStore.prototype.load = async (_runId, stepId) => {
      strictEqual(stepId, "run-a_s0", "unsafe checkpoint ID must not be loaded");
      return checkpoint;
    };
    EventStore.prototype.append = async () => { writes++; throw new Error("unexpected write"); };
    CheckpointStore.prototype.save = async () => { writes++; throw new Error("unexpected write"); };
    for (const args of [["history"], ["history", "run-a"], ["inspect", "run-a"], ["receipts", "run-a"]]) {
      for (const format of [[], ["--json"]]) {
        const output = await runCli([...args, ...format, "--base-dir", base]);
        strictEqual(output.exitCode, 0);
        strictEqual(output.stderr, "");
        for (const forbidden of [wrappedGhp, wrappedPat, "PRIVATE_NARRATIVE", "PRIVATE_STATE", "PRIVATE_UNKNOWN_TEXT", "PRIVATE_PAYLOAD", "synthetic.invalid.example", "constructor", base]) {
          strictEqual(output.stdout.includes(forbidden), false);
        }
      }
    }
    const history = await observe({ command: "history", baseDir: base });
    if (history.command !== "history" || history.mode !== "inventory") throw new Error("unexpected view");
    strictEqual(history.withheld_run_ids, 1);
    deepStrictEqual(history.runs.items, ["run-a", "run-b"]);
    const inspect = await observe({ command: "inspect", runId: "run-a", baseDir: base });
    if (inspect.command !== "inspect") throw new Error("unexpected view");
    deepStrictEqual(inspect.reads, { core_returned_events: 2, projected_events: 1, identity_withheld_events: 1 });
    strictEqual(inspect.withheld_checkpoint_ids, 1);
    strictEqual(inspect.events.items[0]?.action, "[REDACTED]");
    strictEqual(inspect.events.items[0]?.component, "[REDACTED]");
    strictEqual(inspect.events.items[0]?.vista_version, "[REDACTED]");
    strictEqual(inspect.checkpoints.items[0]?.source_sha, "[REDACTED]");
    deepStrictEqual(inspect.checkpoints.items[0]?.completed_steps.items, ["[REDACTED]"]);
    const receipts = await observe({ command: "receipts", runId: "run-a", baseDir: base });
    if (receipts.command !== "receipts") throw new Error("unexpected view");
    strictEqual(receipts.withheld_refs, 4);
    strictEqual(receipts.receipts.total, 1);
    deepStrictEqual(receipts.receipts.items[0]?.observations.items[0]?.owner_claimed_stats.items, [{ label: "count", value: 2 }, { label: "safe", value: "[REDACTED]" }]);
    strictEqual(receipts.receipts.items[0]?.observations.items[0]?.withheld_stats, 2);
    strictEqual(writes, 0);
    deepStrictEqual(await readdir(base), ["sentinel"]);
    strictEqual(await readFile(join(base, "sentinel"), "utf8"), "synthetic unchanged bytes");
  } finally {
    EventStore.prototype.listRuns = original.listRuns;
    EventStore.prototype.readRun = original.readRun;
    EventStore.prototype.append = original.append;
    CheckpointStore.prototype.listCheckpoints = original.listCheckpoints;
    CheckpointStore.prototype.load = original.load;
    CheckpointStore.prototype.save = original.save;
    await rm(base, { recursive: true, force: true });
  }
});
