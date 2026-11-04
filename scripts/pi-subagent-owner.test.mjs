import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile, rm, symlink, readFile } from "node:fs/promises";
import { join } from "node:path";
import { createSubagentOwnerProducer, readSubagentFile } from "./pi-subagent-owner.mjs";
import { readPiOwnerResult } from "@pi-vista/adapter-pi";
import { ROOT } from "./release-utils.mjs";

async function fixture(fn, ownerIsFile = false) {
  await mkdir(join(ROOT, "tmp"), { recursive: true });
  const root = await mkdtemp(join(ROOT, "tmp/subagent-owner-"));
  const asyncDir = join(root, "run-one"), missionPath = join(root, "mission-one.json"), output = join(root, "report.md"), metadataPath = join(root, "artifact-meta.json");
  await mkdir(asyncDir); await writeFile(output, "PRIVATE_ORIGINAL_REPORT");
  let host = "parent-session";
  const nativeOwner = ownerIsFile ? join(root, "native-session.jsonl") : host;
  const mission = { schemaVersion: 1, id: "mission-one", ownerSessionId: nativeOwner, status: "active",
    runs: [{ runId: "run-one", asyncDir, status: "complete", mode: "single" }], artifacts: [{ kind: "output", path: output }] };
  const status = { lifecycleArtifactVersion: 3, runId: "run-one", sessionId: nativeOwner, mode: "single", state: "complete", processTerminal: { runId: "run-one", state: "observed" }, steps: [{ status: "complete", exitCode: 0 }] };
  const metadata = { runId: "run-one", parentSessionId: host, index: 0, exitCode: 0, artifactPaths: { outputPath: output, metadataPath } };
  const save = async () => { await writeFile(missionPath, JSON.stringify(mission)); await writeFile(join(asyncDir, "status.json"), JSON.stringify(status)); await writeFile(metadataPath, JSON.stringify(metadata)); };
  await save();
  const pending = new Set(), views = [], diagnostics = [];
  const producer = createSubagentOwnerProducer({ hostSessionId: () => host, nativeOwnerId: () => nativeOwner, diagnose: () => diagnostics.push("unavailable"), publish: payload => {
    const promise = readPiOwnerResult(payload.reference, { readOwner: payload.readOwner }).then(value => { views.push(value); payload.onObservation(value); }).finally(() => pending.delete(promise));
    pending.add(promise); return true;
  } });
  const launch = { toolName: "subagent", result: { details: { mode: "single", runId: "run-one", asyncId: "run-one", asyncDir, missionId: "mission-one", missionPath } } };
  const complete = { id: "run-one", runId: "run-one", sessionId: nativeOwner, asyncDir, state: "complete", timestamp: Date.now(), results: [{ savedOutputPath: output, artifactPaths: { metadataPath } }] };
  const drain = async () => { while (pending.size) await Promise.all([...pending]); };
  try { await fn({ root, asyncDir, missionPath, output, mission, status, metadata, metadataPath, save, producer, launch, complete, views, diagnostics, drain, setHost: value => { host = value; } }); }
  finally { await drain(); await rm(root, { recursive: true, force: true }); }
}

test("native mission/run/output originals produce scoped availability, not task acceptance", () => fixture(async f => {
  f.producer.onTool(f.launch); await f.drain(); assert.equal(f.views[0].outcome, "unknown");
  f.producer.onCompletion(f.complete); await f.drain();
  const view = f.views.at(-1); assert.equal(view.decision, "deliverable", JSON.stringify(view));
  assert.equal(view.binding.workRef.key, "mission-one"); assert.equal(view.binding.stageId, "subagent-output-available");
  assert.equal(view.authorization, "none"); assert.equal(f.producer.status().taskAcceptance, "not-checked");
  assert.ok(!JSON.stringify(f.views).includes("PRIVATE_ORIGINAL_REPORT")); assert.ok(!JSON.stringify(f.views).includes(f.root));
}));

test("native persisted session owner maps from exact host file reference without leaking paths", () => fixture(async f => {
  f.producer.onCompletion(f.complete); f.producer.onTool(f.launch); await f.drain();
  assert.equal(f.views.at(-1).decision, "deliverable"); assert.equal(f.views.at(-1).binding.sessionId, "parent-session");
  assert.ok(!JSON.stringify(f.views).includes(f.root));
}, true));

test("actual failed original is reportable failure even if the completion says success", () => fixture(async f => {
  f.status.state = "failed"; await f.save(); f.producer.onTool(f.launch); await f.drain();
  f.producer.onCompletion({ ...f.complete, success: true }); await f.drain();
  assert.equal(f.views.at(-1).outcome, "failed"); assert.equal(f.views.at(-1).decision, "reportable_terminal");
}));

test("completion before launch result is retained and only inspected after native association", () => fixture(async f => {
  f.producer.onCompletion(f.complete); await f.drain(); assert.equal(f.views.length, 0);
  f.producer.onTool(f.launch); await f.drain(); assert.equal(f.views.at(-1).decision, "deliverable");
}));

test("duplicate notification does not reread or replay the result", () => fixture(async f => {
  f.producer.onTool(f.launch); await f.drain(); f.producer.onCompletion(f.complete); await f.drain();
  const count = f.views.length; f.producer.onCompletion(f.complete); await f.drain();
  assert.equal(f.views.length, count); assert.equal(f.producer.status().duplicate, 1);
}));

test("native wait result supplies an exact artifact when mission projection lags completion", () => fixture(async f => {
  f.mission.runs[0].status = "active"; f.mission.artifacts = []; await f.save();
  f.producer.onTool(f.launch); await f.drain();
  f.producer.onTool({ toolName: "bg_wait", result: { details: { completions: [{ runId: "run-one", state: "complete", results: f.complete.results }] } } });
  await f.drain(); assert.equal(f.views.at(-1).decision, "deliverable");
  assert.equal(f.producer.status().taskAcceptance, "not-checked");
}));

test("pending process proof stays unknown until original process terminal arrives", () => fixture(async f => {
  f.status.processTerminal.state = "pending"; await f.save();
  f.producer.onTool(f.launch); f.producer.onCompletion(f.complete); await f.drain(); assert.equal(f.views.at(-1).outcome, "unknown");
  f.status.processTerminal.state = "observed"; await f.save(); f.producer.onTerminal({ runId: "run-one" }); await f.drain();
  assert.equal(f.views.at(-1).decision, "deliverable");
}));

test("mission ownership and native metadata run/output binding are checked from originals", () => fixture(async f => {
  f.producer.onTool(f.launch); await f.drain();
  f.mission.ownerSessionId = "other-parent"; await f.save(); f.producer.onCompletion(f.complete); await f.drain();
  assert.equal(f.views.at(-1).outcome, "unknown");
  f.mission.ownerSessionId = "parent-session"; f.metadata.artifactPaths.outputPath = join(f.root, "other.md"); await f.save();
  f.producer.onTerminal({ runId: "run-one" }); await f.drain(); assert.equal(f.views.at(-1).outcome, "unknown");
}));

test("lost or empty original report is unknown, not native success", () => fixture(async f => {
  f.producer.onTool(f.launch); await f.drain(); await writeFile(f.output, "");
  f.producer.onCompletion(f.complete); await f.drain(); assert.equal(f.views.at(-1).outcome, "unknown");
  await rm(f.output); f.producer.onTerminal({ runId: "run-one" }); await f.drain(); assert.equal(f.views.at(-1).reasonCode, "owner_reader_failed");
}));

test("foreign completion, substituted output and reset cannot attach to current successor", () => fixture(async f => {
  f.producer.onTool(f.launch); await f.drain();
  f.producer.onCompletion({ ...f.complete, sessionId: "other-parent" }); await f.drain(); assert.equal(f.views.length, 1);
  f.producer.onCompletion(f.complete); await f.drain(); const count = f.views.length;
  f.producer.onCompletion({ ...f.complete, timestamp: f.complete.timestamp + 1, results: [{ savedOutputPath: join(f.root, "other.md"), artifactPaths: { metadataPath: f.metadataPath } }] }); await f.drain(); assert.equal(f.views.length, count);
  f.producer.reset(); f.setHost("successor"); f.producer.onCompletion(f.complete); await f.drain(); assert.equal(f.views.length, count);
}));

test("descriptor-only native payload handling refuses getters/proxies without invocation", () => fixture(async f => {
  let calls = 0;
  f.producer.onTool(new Proxy({}, { get() { calls++; throw Error(); } }));
  f.producer.onTool(Object.defineProperty({}, "toolName", { get() { calls++; throw Error(); } }));
  f.producer.onCompletion(new Proxy({}, { get() { calls++; throw Error(); } }));
  await f.drain(); assert.equal(calls, 0); assert.equal(f.views.length, 0);
}));

test("bounded original file reader refuses symlink, directory and oversized content", () => fixture(async f => {
  const link = join(f.root, "link.md"); await symlink(f.output, link);
  await assert.rejects(readSubagentFile(link)); await assert.rejects(readSubagentFile(f.root));
  await assert.rejects(readSubagentFile(f.output, 3));
  assert.equal((await readSubagentFile(f.output)).toString(), "PRIVATE_ORIGINAL_REPORT");
  assert.equal((await readFile(f.output)).toString(), "PRIVATE_ORIGINAL_REPORT");
}));
