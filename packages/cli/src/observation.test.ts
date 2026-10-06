import { deepStrictEqual, match, rejects, strictEqual } from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { access, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { CheckpointStore, EventStore } from "@pi-vista/core";
import type { VistaCheckpoint, VistaEvent } from "@pi-vista/protocol";
import { CliError, DEFAULT_LIMIT, MAX_ID_LENGTH, MAX_OUTPUT_BYTES, NESTED_LIMIT, observe, runCli, STATS_LIMIT, type ObservationRequest, type ObservationView } from "@pi-vista/cli";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const bin = join(root, "packages/cli/dist/bin.js");
const wrappedGhp = "prefixghp_1234567890suffix";
const wrappedPat = "prefixgithub_pat_1234567890suffix";
const sourceA = "a".repeat(40);
const sourceB = "b".repeat(40);

function event(run = "run-a", step = "s0", ts = 10): VistaEvent {
  return { run_id: run, step_id: `${run}_${step}`, ts, component: "gate", action: "gate:recorded", result: "ok", source_sha: sourceA, reason_code: "recorded", vista_version: "0.1.0" };
}

function checkpoint(run = "run-a", step = "s0"): VistaCheckpoint {
  return { run_id: run, step_id: `${run}_${step}`, ts: 10, task_goal: "synthetic narrative never displayed", current_state: "synthetic private content", completed_steps: [`${run}_${step}`], pending_steps: [], source_sha: sourceA, env_fingerprint: "env-synthetic", policy_version: "policy-1", check_fn_ids: ["check-synthetic"], resumable: true, resume_requires: ["source_sha_matches"] };
}

async function sandbox(): Promise<string> {
  await mkdir(join(root, "tmp"), { recursive: true });
  return mkdtemp(join(root, "tmp/cli-observation-"));
}

async function writeRun(base: string, run: string, records: readonly unknown[], suffix = ""): Promise<void> {
  await mkdir(join(base, "runs", run), { recursive: true });
  await writeFile(join(base, "runs", run, "events.jsonl"), `${records.map((value) => JSON.stringify(value)).join("\n")}\n${suffix}`, "utf8");
}

async function writeCheckpoint(base: string, filename: string, value: unknown, run = "run-a"): Promise<void> {
  await mkdir(join(base, "runs", run, "checkpoints"), { recursive: true });
  await writeFile(join(base, "runs", run, "checkpoints", `${filename}.json`), JSON.stringify(value), "utf8");
}

async function snapshot(base: string): Promise<string[]> {
  const result: string[] = [];
  async function walk(directory: string, relative: string): Promise<void> {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries.sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)) {
      const name = `${relative}${entry.name}`;
      if (entry.isDirectory()) {
        result.push(`directory:${name}`);
        await walk(join(directory, entry.name), `${name}/`);
      } else {
        const bytes = await readFile(join(directory, entry.name));
        result.push(`file:${name}:${bytes.length}:${createHash("sha256").update(bytes).digest("hex")}`);
      }
    }
  }
  await walk(base, "");
  return result;
}

function spawned(args: readonly string[], base?: string): { stdout: string; stderr: string; status: number | null } {
  const result = spawnSync(process.execPath, [bin, ...args, ...(base !== undefined ? ["--base-dir", base] : [])], { encoding: "utf8", cwd: root, env: {}, maxBuffer: MAX_OUTPUT_BYTES * 2 });
  strictEqual(result.error, undefined);
  strictEqual(result.signal, null);
  return { stdout: result.stdout, stderr: result.stderr, status: result.status };
}

function jsonView(output: string): ObservationView {
  return JSON.parse(output) as ObservationView;
}

function assertContract(view: ObservationView): void {
  strictEqual(view.observation, "recorded-only");
  strictEqual(view.independent_verification, "not-performed");
  strictEqual(view.authorization, "none");
  strictEqual(view.version_compatibility, "not-assessed");
  match(view.storage, /core-best-effort/u);
}

test("spawned vista four commands JSON/text and public API are offline, sanitized and byte/hash read-only", async () => {
  const base = await sandbox();
  try {
    await writeRun(base, "run-a", [event(), { ...event("run-a", "s1", 2), result: "failed", source_sha: sourceB, reason_code: "sha_mismatch", artifact_refs: [{ type: "gate_receipt", ref: "receipt-synthetic", sha: sourceB, verified: true, stats: { passed: 2 } }] }]);
    await writeRun(base, "run-b", [{ ...event("run-b"), component: "test", result: "unknown" }]);
    await writeCheckpoint(base, "run-a_s0", checkpoint());
    const before = await snapshot(base);
    const commands = [["history"], ["history", "run-a"], ["inspect", "run-a"], ["inspect", "run-a", "--step", "run-a_s0"], ["compare", "run-a", "run-b"], ["receipts", "run-a"]];
    for (const args of commands) {
      for (const json of [true, false]) {
        const argv = [...args, ...(json ? ["--json"] : [])];
        const child = spawned(argv, base);
        strictEqual(child.status, 0);
        strictEqual(child.stderr, "");
        const api = await runCli([...argv, "--base-dir", base]);
        deepStrictEqual(api, { exitCode: 0, stdout: child.stdout, stderr: "" });
        strictEqual(child.stdout.includes(base), false);
        strictEqual(Buffer.byteLength(child.stdout) <= MAX_OUTPUT_BYTES, true);
        if (json) assertContract(jsonView(child.stdout));
        else match(child.stdout, /Authorization: none/u);
      }
    }
    deepStrictEqual(await snapshot(base), before, "every directory entry and file byte hash must remain unchanged");
  } finally { await rm(base, { recursive: true, force: true }); }
});

test("history inventory is sorted, bounded, and withholds core-safe credential-bearing run names", async () => {
  const base = await sandbox();
  try {
    for (const name of ["run-z", "run-b", "run-a", wrappedPat, "bad name"]) await mkdir(join(base, "runs", name), { recursive: true });
    const view = await observe({ command: "history", baseDir: base, limit: 2 });
    strictEqual(view.command, "history");
    if (view.command !== "history" || view.mode !== "inventory") throw new Error("unexpected view");
    deepStrictEqual(view.runs, { items: ["run-a", "run-b"], total: 3, omitted: 1 });
    strictEqual(view.withheld_run_ids, 1);
    strictEqual(JSON.stringify(view).includes(wrappedPat), false);
  } finally { await rm(base, { recursive: true, force: true }); }
});

test("history timeline is chronological with deterministic projected-field tie ordering", async () => {
  const base = await sandbox();
  try {
    const a = join(base, "a"); const b = join(base, "b");
    const records = [event("run-a", "s2", 7), event("run-a", "s1", 7), event("run-a", "s0", 1), { ...event("run-a", "s1", 7), action: "gate:another" }];
    await writeRun(a, "run-a", records);
    await writeRun(b, "run-a", [...records].reverse());
    const first = await runCli(["history", "run-a", "--json", "--limit", "3", "--base-dir", a]);
    const second = await runCli(["history", "run-a", "--json", "--limit", "3", "--base-dir", b]);
    deepStrictEqual(first, second);
    const view = jsonView(first.stdout);
    if (view.command !== "history" || view.mode !== "timeline") throw new Error("unexpected view");
    deepStrictEqual(view.events.items.map((entry) => [entry.ts, entry.step_id, entry.action]), [[1, "run-a_s0", "gate:recorded"], [7, "run-a_s1", "gate:another"], [7, "run-a_s1", "gate:recorded"]]);
    strictEqual(view.events.total, 4); strictEqual(view.events.omitted, 1);
  } finally { await rm(base, { recursive: true, force: true }); }
});

test("best-effort event readers skip malformed, truncated, cross-identity and invalid-version records", async () => {
  const base = await sandbox();
  try {
    await writeRun(base, "run-a", [event(), event("run-b"), { ...event(), step_id: "run-b_s0" }, { ...event(), ts: "invalid" }, { ...event(), vista_version: "https://invalid.example" }], "not-json\n{\"truncated\":\n\n");
    const view = await observe({ command: "history", runId: "run-a", baseDir: base });
    if (view.command !== "history" || view.mode !== "timeline") throw new Error("unexpected view");
    strictEqual(view.reads.core_returned_events, 1);
    strictEqual(view.events.total, 1);
    assertContract(view);
  } finally { await rm(base, { recursive: true, force: true }); }
});

test("inspect enforces event step filter and public core checkpoint run/step binding", async () => {
  const base = await sandbox();
  try {
    await writeRun(base, "run-a", [event(), event("run-a", "s1", 1)]);
    await writeCheckpoint(base, "run-a_s0", checkpoint());
    await writeCheckpoint(base, "run-a_s1", { ...checkpoint(), step_id: "run-a_s1", ts: 1 });
    await writeCheckpoint(base, "run-a_cross", checkpoint("run-b", "cross"));
    await writeCheckpoint(base, "run-a_wrong", { ...checkpoint(), step_id: "run-a_other" });
    await writeCheckpoint(base, "run-b_s0", checkpoint("run-b"));
    await writeCheckpoint(base, "run-a_invalid", { ...checkpoint(), step_id: "run-a_invalid", completed_steps: ["run-b_s0"] });
    await writeFile(join(base, "runs/run-a/checkpoints/run-a_corrupt.json"), "not-json", "utf8");
    const all = await observe({ command: "inspect", runId: "run-a", baseDir: base });
    if (all.command !== "inspect") throw new Error("unexpected view");
    deepStrictEqual(all.checkpoints.items.map((entry) => entry.step_id), ["run-a_s0", "run-a_s1"]);
    const filtered = await observe({ command: "inspect", runId: "run-a", stepId: "run-a_s0", baseDir: base });
    if (filtered.command !== "inspect") throw new Error("unexpected view");
    strictEqual(filtered.events.total, 1); strictEqual(filtered.reads.core_returned_events, 1);
    deepStrictEqual(filtered.checkpoints.items.map((entry) => entry.step_id), ["run-a_s0"]);
    strictEqual(filtered.checkpoints.items[0]?.owner_claimed_resumable, true);
    const missing = await observe({ command: "inspect", runId: "run-a", stepId: "run-a_absent", baseDir: base });
    if (missing.command !== "inspect") throw new Error("unexpected view");
    deepStrictEqual(missing.checkpoints.items, []); deepStrictEqual(missing.events.items, []);
    strictEqual(JSON.stringify(all).includes("task_goal"), false);
    strictEqual(JSON.stringify(all).includes("current_state"), false);
  } finally { await rm(base, { recursive: true, force: true }); }
});

test("inspect checkpoint arrays and pages have stable lexical ordering and nested bounds", async () => {
  const base = await sandbox();
  try {
    const steps = Array.from({ length: NESTED_LIMIT + 2 }, (_, index) => `run-a_s${index}`);
    const cp = { ...checkpoint(), completed_steps: steps, pending_steps: [...steps].reverse(), check_fn_ids: steps };
    await writeCheckpoint(base, "run-a_s0", cp);
    await writeCheckpoint(base, "run-a_s1", { ...cp, step_id: "run-a_s1" });
    const view = await observe({ command: "inspect", runId: "run-a", baseDir: base, limit: 1 });
    if (view.command !== "inspect") throw new Error("unexpected view");
    strictEqual(view.checkpoints.total, 2); strictEqual(view.checkpoints.omitted, 1);
    const projected = view.checkpoints.items[0]!;
    strictEqual(projected.completed_steps.items.length, NESTED_LIMIT);
    strictEqual(projected.completed_steps.omitted, 2);
    deepStrictEqual(projected.completed_steps, projected.pending_steps);
    deepStrictEqual(projected.completed_steps.items, [...steps].sort().slice(0, NESTED_LIMIT));
  } finally { await rm(base, { recursive: true, force: true }); }
});

test("safe unknown versions are retained as recorded labels, never compatible/current/trusted", async () => {
  const base = await sandbox();
  try {
    await writeRun(base, "run-a", [{ ...event(), vista_version: "future/1" }, { ...event("run-a", "s1"), vista_version: undefined }]);
    for (const args of [["history", "run-a"], ["inspect", "run-a"]]) {
      const child = spawned([...args, "--json"], base);
      strictEqual(child.status, 0);
      const view = jsonView(child.stdout);
      assertContract(view);
      if (!((view.command === "history" && view.mode === "timeline") || view.command === "inspect")) throw new Error("unexpected view");
      strictEqual(view.events.items[0]?.vista_version, "future/1");
      strictEqual(Object.hasOwn(view.events.items[1]!, "vista_version"), false);
      strictEqual(child.stdout.includes('"trusted"'), false);
      strictEqual(child.stdout.includes('"current"'), false);
    }
  } finally { await rm(base, { recursive: true, force: true }); }
});

test("closed event/checkpoint projections defend core-retained wrapped tokens and unknown property names", async () => {
  const base = await sandbox();
  try {
    const unsafeKey = `label-${wrappedPat}`;
    const record = { ...event(), action: wrappedGhp, reason_code: wrappedPat, source_sha: wrappedGhp, vista_version: `future/${wrappedPat}`, component: `custom:${wrappedPat}`, branch: wrappedPat, session_id: wrappedGhp, [unsafeKey]: { nested: wrappedPat }, innocent_unknown: 23, mystery: "PRIVATE_UNKNOWN_TEXT", payload: { text: "PRIVATE_PAYLOAD" } };
    await writeRun(base, "run-a", [record, { ...event("run-a", wrappedGhp), action: "gate:recorded" }, { ...event("run-a", "long"), action: "a".repeat(4000) }]);
    await writeCheckpoint(base, "run-a_s0", { ...checkpoint(), source_sha: wrappedPat, env_fingerprint: wrappedGhp, policy_version: wrappedPat, completed_steps: [`run-a_${wrappedGhp}`], check_fn_ids: [wrappedPat], resume_requires: [wrappedGhp], [unsafeKey]: 99, task_goal: "PRIVATE_NARRATIVE" });
    await writeCheckpoint(base, `run-a_${wrappedGhp}`, { ...checkpoint(), step_id: `run-a_${wrappedGhp}` });
    const coreRecords = await new EventStore(base).readRun("run-a");
    strictEqual(coreRecords[0]?.action, wrappedGhp, "fixture must exercise a wrapped token surviving core redaction");
    strictEqual(coreRecords[0]?.vista_version, `future/${wrappedPat}`);
    for (const command of ["history", "inspect", "receipts"]) {
      for (const format of [[], ["--json"]]) {
        const child = spawned([command, "run-a", ...format], base);
        strictEqual(child.status, 0); strictEqual(child.stderr, "");
        for (const forbidden of [wrappedGhp, wrappedPat, unsafeKey, "PRIVATE_UNKNOWN_TEXT", "PRIVATE_PAYLOAD", "PRIVATE_NARRATIVE", "innocent_unknown", "session_id", "branch", base, "a".repeat(1000)]) strictEqual(child.stdout.includes(forbidden), false);
      }
    }
    const view = await observe({ command: "inspect", runId: "run-a", baseDir: base });
    if (view.command !== "inspect") throw new Error("unexpected view");
    strictEqual(view.reads.core_returned_events, 3); strictEqual(view.reads.projected_events, 2); strictEqual(view.reads.identity_withheld_events, 1);
    strictEqual(view.withheld_checkpoint_ids, 1);
    strictEqual(view.events.items[0]?.action, "[REDACTED]");
    strictEqual(view.checkpoints.items[0]?.source_sha, "[REDACTED]");
    deepStrictEqual(view.checkpoints.items[0]?.completed_steps.items, ["[REDACTED]"]);
  } finally { await rm(base, { recursive: true, force: true }); }
});

test("compare produces exact count deltas across all projected events, not only limited history", async () => {
  const base = await sandbox();
  try {
    await writeRun(base, "run-a", [event(), { ...event("run-a", "s1"), reason_code: undefined }]);
    await writeRun(base, "run-b", [{ ...event("run-b"), component: "test", result: "failed", source_sha: sourceB, reason_code: "ci_failed" }]);
    const view = await observe({ command: "compare", runIdA: "run-a", runIdB: "run-b", baseDir: base, limit: 1 });
    if (view.command !== "compare") throw new Error("unexpected view");
    deepStrictEqual(view.differences.component, { items: [{ label: "gate", a: 2, b: 0, delta_b_minus_a: -2 }], total: 2, omitted: 1 });
    deepStrictEqual(view.differences.result.items, [{ label: "failed", a: 0, b: 1, delta_b_minus_a: 1 }]);
    strictEqual(view.differences.reason_code.items[0]?.label, null);
    deepStrictEqual(view.differences.source_sha.items, [{ label: sourceA, a: 2, b: 0, delta_b_minus_a: -2 }]);
    strictEqual(view.reads_a.projected_events, 2);
    const same = await observe({ command: "compare", runIdA: "run-a", runIdB: "run-a", baseDir: base });
    if (same.command !== "compare") throw new Error("unexpected view");
    for (const field of ["component", "result", "reason_code", "source_sha"] as const) deepStrictEqual(same.differences[field], { items: [], total: 0, omitted: 0 });
    const child = spawned(["compare", "run-a", "run-b"], base);
    match(child.stdout, /not quality or success rankings/u);
  } finally { await rm(base, { recursive: true, force: true }); }
});

test("receipts deduplicate by type/ref/SHA and retain conflicting owner claims and run/step provenance", async () => {
  const base = await sandbox();
  try {
    const ref = { type: "gate_receipt", ref: "opaque-synthetic", sha: sourceA, verified: true, stats: { passed: 2, total: 2 } };
    await writeRun(base, "run-a", [
      { ...event(), artifact_refs: [ref, ref, { ...ref, sha: sourceB }, { ...ref, type: "test_result" }, { ...ref, sha: undefined }] },
      { ...event("run-a", "s1", 1), result: "failed", artifact_refs: [{ ...ref, verified: false, stats: { passed: 0, total: 2 } }] },
    ]);
    const view = await observe({ command: "receipts", runId: "run-a", baseDir: base });
    if (view.command !== "receipts") throw new Error("unexpected view");
    strictEqual(view.receipts.total, 4);
    const receipt = view.receipts.items.find((entry) => entry.type === "gate_receipt" && entry.sha === sourceA)!;
    strictEqual(receipt.occurrences, 3); strictEqual(receipt.observations.total, 2);
    deepStrictEqual(receipt.observations.items.map((entry) => [entry.event.run_id, entry.event.step_id, entry.owner_claimed_verified]), [["run-a", "run-a_s1", false], ["run-a", "run-a_s0", true]]);
    match(view.metadata, /owner-claimed; not independently verified; not authorization/u);
    assertContract(view);
    const child = spawned(["receipts", "run-a"], base);
    match(child.stdout, /owner_claimed_verified=true/u);
    match(child.stdout, /not independently verified; not authorization/u);
    strictEqual(child.stdout.includes("PASS"), false);
  } finally { await rm(base, { recursive: true, force: true }); }
});

test("receipts withhold URLs, paths, credential-bearing identities, unknown fields and unsafe stats keys", async () => {
  const base = await sandbox();
  try {
    const stats = { safe: wrappedPat, count: 2, [`label-${wrappedPat}`]: 3, constructor: 4 };
    const safe = { type: "gate_receipt", ref: "opaque-synthetic", verified: true, stats, unknown_number: 9898, unknown_body: "PRIVATE_BODY" };
    await writeRun(base, "run-a", [{ ...event(), artifact_refs: [safe, { type: "gate_receipt", ref: wrappedGhp }, { type: wrappedPat, ref: "opaque-type" }, { type: "gate_receipt", ref: "opaque-sha", sha: wrappedGhp }, { type: "gate_receipt", ref: "https://synthetic.invalid.example/private" }, { type: "gate_receipt", ref: "/synthetic/private/receipt.json" }] }]);
    for (const format of [[], ["--json"]]) {
      const child = spawned(["receipts", "run-a", ...format], base);
      strictEqual(child.status, 0); strictEqual(child.stderr, "");
      for (const forbidden of [wrappedPat, wrappedGhp, "constructor", "unknown_number", "unknown_body", "PRIVATE_BODY", "synthetic.invalid.example", "/synthetic/private", "https:"]) strictEqual(child.stdout.includes(forbidden), false);
    }
    const view = await observe({ command: "receipts", runId: "run-a", baseDir: base });
    if (view.command !== "receipts") throw new Error("unexpected view");
    strictEqual(view.withheld_refs, 5); strictEqual(view.receipts.total, 1);
    deepStrictEqual(view.receipts.items[0]?.observations.items[0]?.owner_claimed_stats.items, [{ label: "count", value: 2 }, { label: "safe", value: "[REDACTED]" }]);
    strictEqual(view.receipts.items[0]?.observations.items[0]?.withheld_stats, 2);
  } finally { await rm(base, { recursive: true, force: true }); }
});

test("receipts bound sorted reference, provenance and stats pages before rendering", async () => {
  const base = await sandbox();
  try {
    const stats = Object.fromEntries(Array.from({ length: STATS_LIMIT + 2 }, (_, index) => [`metric-${index}`, index]));
    await writeRun(base, "run-a", Array.from({ length: NESTED_LIMIT + 2 }, (_, index) => ({ ...event("run-a", `s${index}`, index), artifact_refs: [{ type: "gate_receipt", ref: "opaque-a", stats }, { type: "gate_receipt", ref: "opaque-b" }] })));
    const view = await observe({ command: "receipts", runId: "run-a", baseDir: base, limit: 1 });
    if (view.command !== "receipts") throw new Error("unexpected view");
    strictEqual(view.receipts.total, 2); strictEqual(view.receipts.omitted, 1);
    const receipt = view.receipts.items[0]!;
    strictEqual(receipt.ref, "opaque-a"); strictEqual(receipt.observations.total, NESTED_LIMIT + 2); strictEqual(receipt.observations.omitted, 2);
    strictEqual(receipt.observations.items[0]?.owner_claimed_stats.total, STATS_LIMIT + 2);
    strictEqual(receipt.observations.items[0]?.owner_claimed_stats.omitted, 2);
  } finally { await rm(base, { recursive: true, force: true }); }
});

test("top-level default and exact explicit limits retain counts over all recorded events", async () => {
  const base = await sandbox();
  try {
    await writeRun(base, "run-a", Array.from({ length: DEFAULT_LIMIT + 2 }, (_, index) => ({ ...event("run-a", `s${index}`, index), reason_code: `reason-${index}`, source_sha: `sha-${index}` })));
    const view = await observe({ command: "inspect", runId: "run-a", baseDir: base });
    if (view.command !== "inspect") throw new Error("unexpected view");
    strictEqual(view.events.items.length, DEFAULT_LIMIT); strictEqual(view.events.total, DEFAULT_LIMIT + 2); strictEqual(view.events.omitted, 2);
    strictEqual(view.recorded_counts.component.items[0]?.count, DEFAULT_LIMIT + 2);
    strictEqual(view.recorded_counts.reason_code.items.length, DEFAULT_LIMIT);
    strictEqual(view.recorded_counts.source_sha.omitted, 2);
  } finally { await rm(base, { recursive: true, force: true }); }
});

for (const state of ["empty", "missing", "corrupt", "unreadable"] as const) {
  test(`spawned ${state} storage is honest best-effort and does not create or modify storage`, async () => {
    const parent = await sandbox();
    const base = state === "missing" ? join(parent, "absent-store") : join(parent, "store");
    try {
      if (state !== "missing") await mkdir(base);
      if (state === "corrupt") {
        await writeRun(base, "run-a", [], "not-json\n{\n");
        await writeCheckpoint(base, "run-a_s0", { wrong: "identity" });
      } else if (state === "unreadable") {
        await mkdir(join(base, "runs/run-a/events.jsonl"), { recursive: true });
        await writeFile(join(base, "runs/run-a/checkpoints"), "not-a-directory", "utf8");
      }
      const before = await snapshot(parent);
      for (const args of [["history"], ["history", "run-a"], ["inspect", "run-a"], ["compare", "run-a", "run-b"], ["receipts", "run-a"]]) {
        for (const format of [[], ["--json"]]) {
          const child = spawned([...args, ...format], base);
          strictEqual(child.status, 0); strictEqual(child.stderr, "");
          strictEqual(child.stdout.includes(base), false);
          if (format.length > 0) {
            const view = jsonView(child.stdout);
            assertContract(view);
            if (view.command === "history" && view.mode === "timeline") strictEqual(view.events.total, 0);
            if (view.command === "inspect") { strictEqual(view.events.total, 0); strictEqual(view.checkpoints.total, 0); }
            if (view.command === "receipts") strictEqual(view.receipts.total, 0);
          }
          strictEqual(child.stdout.includes("PASS"), false);
        }
      }
      deepStrictEqual(await snapshot(parent), before);
      if (state === "missing") await rejects(() => access(base), { code: "ENOENT" });
    } finally { await rm(parent, { recursive: true, force: true }); }
  });
}

test("spawned errors use stderr/exit 2, without raw arguments, paths, secrets or stacks", () => {
  const argsList = [["history", "--bad-PRIVATE_ARG"], ["inspect", "/synthetic/PRIVATE_PATH"], ["inspect", wrappedPat], ["inspect", "run-a", "--step", "run-b_s0"], ["history", "--base-dir"], ["history", "--limit", "undefined"]];
  for (const args of argsList) deepStrictEqual(spawned(args), { stdout: "", stderr: "vista: invalid arguments. Use vista --help.\n", status: 2 });
});

test("spawned help/version use stdout/exit 0 without storage access", () => {
  for (const args of [[], ["--help"], ["inspect", "--help"]]) {
    const child = spawned(args); strictEqual(child.status, 0); strictEqual(child.stderr, ""); match(child.stdout, /offline, read-only/u);
  }
  deepStrictEqual(spawned(["--version"]), { stdout: "0.1.0\n", stderr: "", status: 0 });
});

test("unexpected public store errors are fixed and never surface the original error", async () => {
  const original = EventStore.prototype.readRun;
  EventStore.prototype.readRun = async () => { throw new Error(`/synthetic/PRIVATE_PATH ${wrappedPat} RAW_ARGUMENT`); };
  try {
    deepStrictEqual(await runCli(["history", "run-a", "--base-dir", "synthetic-unused"]), { exitCode: 1, stdout: "", stderr: "vista: observation unavailable.\n" });
    await rejects(() => observe({ command: "history", runId: "run-a", baseDir: "synthetic-unused" }), (error: unknown) => error instanceof CliError && error.code === "observation" && error.message === "observation unavailable");
  } finally { EventStore.prototype.readRun = original; }
});

test("runtime never invokes the public append/save methods", async () => {
  const base = await sandbox();
  const append = EventStore.prototype.append; const save = CheckpointStore.prototype.save;
  try {
    await writeRun(base, "run-a", [event()]); await writeCheckpoint(base, "run-a_s0", checkpoint());
    const before = await snapshot(base);
    EventStore.prototype.append = async () => { throw new Error("write method called"); };
    CheckpointStore.prototype.save = async () => { throw new Error("write method called"); };
    for (const args of [["history"], ["history", "run-a"], ["inspect", "run-a"], ["compare", "run-a", "run-a"], ["receipts", "run-a"]]) strictEqual((await runCli([...args, "--json", "--base-dir", base])).exitCode, 0);
    deepStrictEqual(await snapshot(base), before);
  } finally { EventStore.prototype.append = append; CheckpointStore.prototype.save = save; await rm(base, { recursive: true, force: true }); }
});

test("hard byte ceiling returns a fixed error and empty stdout rather than leaking an oversized view", async () => {
  const base = await sandbox();
  try {
    const run = "r".repeat(MAX_ID_LENGTH - 10);
    const stats = Object.fromEntries(Array.from({ length: STATS_LIMIT }, (_, index) => [`metric-${index}`, "v".repeat(64)]));
    const refs = Array.from({ length: 100 }, (_, index) => ({ type: "gate_receipt", ref: `opaque-${index}`, sha: "s".repeat(MAX_ID_LENGTH), verified: true, stats }));
    await writeRun(base, run, Array.from({ length: NESTED_LIMIT }, (_, index) => ({ ...event(run, `s${index}`, index), action: "a".repeat(64), reason_code: "q".repeat(64), source_sha: "s".repeat(MAX_ID_LENGTH), vista_version: "v".repeat(64), artifact_refs: refs })));
    const before = await snapshot(base);
    const child = spawned(["receipts", run, "--limit", "100", "--json"], base);
    deepStrictEqual(child, { status: 1, stdout: "", stderr: "vista: output limit exceeded.\n" });
    await rejects(() => observe({ command: "receipts", runId: run, baseDir: base, limit: 100 }), (error: unknown) => error instanceof CliError && error.code === "output");
    deepStrictEqual(await snapshot(base), before);
  } finally { await rm(base, { recursive: true, force: true }); }
});

test("inspect/compare/receipts JSON and text remain deterministic across reversed records and reference order", async () => {
  const base = await sandbox();
  try {
    const first = join(base, "first"); const second = join(base, "second");
    const refs = [{ type: "test_result", ref: "opaque-b", verified: false }, { type: "gate_receipt", ref: "opaque-a", sha: sourceA, verified: true, stats: { total: 3, passed: 2 } }];
    const records = [{ ...event("run-a", "s1", 2), artifact_refs: refs }, { ...event(), reason_code: "other", artifact_refs: [refs[1]!] }];
    for (const store of [first, second]) {
      await writeRun(store, "run-a", store === first ? records : [...records].reverse().map((record) => ({ ...record, artifact_refs: [...record.artifact_refs].reverse() })));
      await writeRun(store, "run-b", [event("run-b")]);
      await writeCheckpoint(store, "run-a_s1", { ...checkpoint("run-a", "s1"), completed_steps: ["run-a_s1", "run-a_s0"] });
      await writeCheckpoint(store, "run-a_s0", checkpoint());
    }
    for (const args of [["inspect", "run-a"], ["compare", "run-a", "run-b"], ["receipts", "run-a"]]) {
      for (const format of [[], ["--json"]]) {
        const a = spawned([...args, ...format], first); const b = spawned([...args, ...format], second);
        strictEqual(a.status, 0); strictEqual(a.stderr, ""); deepStrictEqual(a, b);
      }
    }
  } finally { await rm(base, { recursive: true, force: true }); }
});

test("spawned bin module-load failures are fixed stderr/exit 1 without filesystem paths or stacks", async () => {
  const base = await sandbox();
  try {
    const isolatedBin = join(base, "isolated-bin.mjs");
    await writeFile(isolatedBin, await readFile(bin));
    const child = spawnSync(process.execPath, [isolatedBin, "history"], { encoding: "utf8", cwd: base, env: {} });
    strictEqual(child.error, undefined); strictEqual(child.signal, null);
    strictEqual(child.status, 1); strictEqual(child.stdout, ""); strictEqual(child.stderr, "vista: observation unavailable.\n");
  } finally { await rm(base, { recursive: true, force: true }); }
});

test("spawned bin broken stdout pipe exits 1 without raw stream errors", { timeout: 5000 }, async () => {
  const child = spawn(process.execPath, [bin, "--help"], { cwd: root, env: {}, stdio: ["ignore", "pipe", "pipe"] });
  child.stdout!.destroy();
  let stderr = "";
  child.stderr!.setEncoding("utf8");
  child.stderr!.on("data", (value: string) => { stderr += value; });
  const result = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve, reject) => {
    child.on("error", reject);
    child.on("close", (code, signal) => { resolve({ code, signal }); });
  });
  deepStrictEqual(result, { code: 1, signal: null });
  strictEqual(stderr, "");
});

test("observe and runCli keep detached validated data when original inputs change during awaited reads", async () => {
  const base = await sandbox();
  const readRun = EventStore.prototype.readRun;
  let getterCalls = 0;
  const fail = () => { getterCalls += 1; throw new Error(`SYNTHETIC_PRIVATE_${wrappedGhp}`); };
  try {
    const before = await snapshot(base);
    const request: ObservationRequest = { command: "compare", runIdA: "run-a", runIdB: "run-b", baseDir: base, limit: 1 };
    const reads: string[] = [];
    EventStore.prototype.readRun = async function (runId) {
      strictEqual(this.baseDir, base);
      reads.push(runId);
      if (reads.length === 1) {
        for (const key of ["command", "runIdA", "runIdB", "baseDir", "limit", "then"]) {
          Object.defineProperty(request, key, { get: fail, configurable: true });
        }
        Object.setPrototypeOf(request, Object.defineProperty({}, "runId", { get: fail }));
      }
      await Promise.resolve();
      return [];
    };
    const view = await observe(request);
    if (view.command !== "compare") throw new Error("unexpected view");
    strictEqual(view.run_id_a, "run-a"); strictEqual(view.run_id_b, "run-b");
    deepStrictEqual(reads, ["run-a", "run-b"]);

    const argv = ["history", "run-a", "--json", "--base-dir", base];
    EventStore.prototype.readRun = async function (runId) {
      strictEqual(this.baseDir, base);
      reads.push(runId);
      argv.length = 0;
      Object.defineProperty(argv, "0", { get: fail });
      Object.defineProperty(argv, Symbol.iterator, { get: fail });
      Object.setPrototypeOf(argv, Object.defineProperty({}, "length", { get: fail }));
      await Promise.resolve();
      return [];
    };
    const result = await runCli(argv);
    strictEqual(result.exitCode, 0); strictEqual(result.stderr, "");
    const timeline = jsonView(result.stdout);
    if (timeline.command !== "history" || timeline.mode !== "timeline") throw new Error("unexpected view");
    strictEqual(timeline.run_id, "run-a");
    deepStrictEqual(reads, ["run-a", "run-b", "run-a"]);
    strictEqual(getterCalls, 0);
    strictEqual(JSON.stringify(view).includes(wrappedGhp), false);
    strictEqual(result.stdout.includes(wrappedGhp), false);
    deepStrictEqual(await snapshot(base), before);
  } finally { EventStore.prototype.readRun = readRun; await rm(base, { recursive: true, force: true }); }
});
