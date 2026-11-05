import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile, rm, symlink, readFile } from "node:fs/promises";
import { join } from "node:path";
import { createSubagentOwnerProducer, readSubagentFile } from "./pi-subagent-owner.mjs";
import { readPiOwnerResult } from "@pi-vista/adapter-pi";
import { createPiWorkObserver } from "./pi-work-observer.mjs";
import { EventEmitter } from "node:events";
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
  const pending = new Set(), views = [], diagnostics = [], reads = [];
  const reader = { read: readSubagentFile };
  const producer = createSubagentOwnerProducer({ hostSessionId: () => host, nativeOwnerId: () => nativeOwner,
    readFile: (...args) => { reads.push(args[0]); return reader.read(...args); }, diagnose: () => diagnostics.push("unavailable"), publish: payload => {
    const promise = readPiOwnerResult(payload.reference, { readOwner: payload.readOwner }).then(value => { views.push(value); payload.onObservation(value); }).finally(() => pending.delete(promise));
    pending.add(promise); return true;
  } });
  const launch = { toolName: "subagent", result: { details: { mode: "single", runId: "run-one", asyncId: "run-one", asyncDir, missionId: "mission-one", missionPath } } };
  const complete = { id: "run-one", runId: "run-one", sessionId: nativeOwner, asyncDir, state: "complete", timestamp: Date.now(), results: [{ savedOutputPath: output, artifactPaths: { metadataPath } }] };
  const drain = async () => { while (pending.size) await Promise.all([...pending]); };
  try { await fn({ root, asyncDir, missionPath, output, mission, status, metadata, metadataPath, save, producer, launch, complete, views, diagnostics, reads, reader, drain, setHost: value => { host = value; } }); }
  finally { await drain(); await rm(root, { recursive: true, force: true }); }
}

function explicitMissionFixture(fn) {
  return fixture(async f => {
    f.mission.ownerSessionId = join(f.root, "creation-parent.jsonl");
    f.mission.runs.unshift({ runId: "old-run", mode: "single", asyncDir: join(f.root, "old-run"), status: "complete" });
    f.mission.acceptance = { status: "review-required" };
    Object.assign(f.launch, { type: "tool_execution_end", toolCallId: "call-one", isError: false });
    f.status.toolCallId = "call-one";
    const result = { type: "tool_result", toolName: "subagent", toolCallId: "call-one", isError: false,
      input: { agent: "worker", task: "PRIVATE_TASK_BODY", options: { missionId: f.mission.id } }, details: structuredClone(f.launch.result.details) };
    const sidecarPath = join(f.asyncDir, "mission.json");
    const sidecar = { schemaVersion: 1, missionId: f.mission.id, projectRoot: f.root, missionDir: f.root,
      globalIndexDir: join(f.root, "index"), writeGlobalIndex: false, autoCreated: false };
    const saveSidecar = () => writeFile(sidecarPath, JSON.stringify(sidecar));
    await f.save(); await saveSidecar();
    const send = async () => { f.producer.onToolResult(result); f.producer.onTool(f.launch); f.producer.onCompletion(f.complete); await f.drain(); };
    await fn({ ...f, result, sidecar, sidecarPath, saveSidecar, send });
  }, true);
}

test("tool_result snapshots explicit missionId; end without args confirms once before current native originals", () => explicitMissionFixture(async f => {
  const originals = await Promise.all([f.missionPath, f.sidecarPath, f.metadataPath, f.output].map(file => readFile(file, "utf8")));
  const resultBefore = structuredClone(f.result), endBefore = structuredClone(f.launch);
  assert.equal(f.producer.onToolResult(f.result), undefined); f.producer.onCompletion(f.complete); f.producer.onTerminal({ runId: "run-one" });
  assert.deepEqual(f.reads, []); assert.equal(f.views.length, 0); assert.equal(Object.hasOwn(f.launch, "args"), false);
  assert.equal(f.producer.onTool(f.launch), undefined); await f.drain();
  const view = f.views.at(-1);
  assert.equal(view.decision, "deliverable"); assert.equal(view.binding.sessionId, "parent-session");
  assert.equal(view.binding.runId, "run-one"); assert.equal(view.binding.workRef.key, "mission-one");
  assert.equal(view.binding.stageId, "subagent-output-available"); assert.equal(view.authorization, "none");
  assert.equal(f.producer.status().taskAcceptance, "not-checked");
  assert.deepEqual(f.result, resultBefore); assert.deepEqual(f.launch, endBefore);
  assert.deepEqual(await Promise.all([f.missionPath, f.sidecarPath, f.metadataPath, f.output].map(file => readFile(file, "utf8"))), originals);
  const reads = f.reads.length;
  f.producer.onToolResult(f.result); f.producer.onTool(f.launch); f.producer.onCompletion(f.complete); await f.drain();
  assert.equal(f.views.length, 1); assert.equal(f.reads.length, reads);
  assert.ok(!f.reads.some(file => file.includes("old-run")));
  for (const value of [f.root, "PRIVATE_TASK_BODY", "PRIVATE_ORIGINAL_REPORT"]) assert.ok(!JSON.stringify(f.views).includes(value));
}));

for (const form of ["flat", "both"]) test(`native ${form} missionId request retains the same binding`, () => explicitMissionFixture(async f => {
  f.result.input.missionId = f.mission.id;
  if (form === "flat") delete f.result.input.options;
  await f.send(); assert.equal(f.views.at(-1).decision, "deliverable");
}));

const invalidRequests = [
  ["missing input", f => { delete f.result.input; }],
  ["implicit", f => { delete f.result.input.options.missionId; }],
  ["explicit creation", f => { f.result.input.options = { mission: { title: "New" } }; }],
  ["creation with reuse", f => { f.result.input.options.mission = {}; }],
  ["foreign requested mission", f => { f.result.input.options.missionId = "foreign"; }],
  ["conflicting flat request", f => { f.result.input.missionId = "foreign"; }],
  ["no agent", f => { delete f.result.input.agent; }],
  ["resume", f => { f.result.input.action = "resume"; }],
  ["management", f => { f.result.input.action = "mission.attach-run"; }],
  ["workflow", f => { f.result.input.workflow = true; }],
  ["script", f => { f.result.input.options.script = "return 1"; }],
  ["tasks", f => { f.result.input.tasks = []; }],
  ["nested call", f => { f.result.parentToolCallId = "outer"; }],
  ["result error", f => { f.result.isError = true; }],
  ["missing error state", f => { delete f.result.isError; }],
  ["partial association", f => { f.result.details.missionWarning = "PRIVATE_WARNING"; }],
  ["caller flag", f => { delete f.result.input; f.result.details.explicitMissionId = "mission-one"; }],
];
for (const [label, change] of invalidRequests) test(`tool_result does not authorize mission creation-owner mismatch for ${label}`, () => explicitMissionFixture(async f => {
  change(f); await f.send(); assert.equal(f.views.at(-1).outcome, "unknown");
  assert.ok(!f.reads.includes(f.sidecarPath)); assert.ok(!f.reads.includes(f.output));
}));

const invalidOriginals = [
  ["sidecar version", f => { f.sidecar.schemaVersion = 2; }],
  ["sidecar automatic", f => { f.sidecar.autoCreated = true; }],
  ["sidecar missing autoCreated", f => { delete f.sidecar.autoCreated; }],
  ["sidecar mission", f => { f.sidecar.missionId = "foreign"; }],
  ["sidecar directory", f => { f.sidecar.missionDir = join(f.root, "foreign"); }],
  ["sidecar relative directory", f => { f.sidecar.missionDir = "."; }],
  ["mission identity", f => { f.mission.id = "foreign"; }],
  ["missing creation owner", f => { delete f.mission.ownerSessionId; }],
  ["missing run", f => { f.mission.runs.pop(); }],
  ["duplicate ledger run", f => { f.mission.runs.push({ ...f.mission.runs[1] }); }],
  ["ledger mode", f => { f.mission.runs[1].mode = "workflow"; }],
  ["ledger directory", f => { f.mission.runs[1].asyncDir = join(f.root, "foreign"); }],
  ["status owner", f => { f.status.sessionId = f.mission.ownerSessionId; }],
  ["status run", f => { f.status.runId = "old-run"; }],
  ["status call", f => { f.status.toolCallId = "foreign-call"; }],
  ["missing status call", f => { delete f.status.toolCallId; }],
  ["status mode", f => { f.status.mode = "workflow"; }],
  ["status version", f => { f.status.lifecycleArtifactVersion = 2; }],
  ["status resume", f => { f.status.revivedFrom = "old-run"; }],
  ["status nested", f => { f.status.isNested = true; }],
  ["status workflow", f => { f.status.parentWorkflowRunId = "workflow"; }],
  ["metadata owner", f => { f.metadata.parentSessionId = "old-parent"; }],
  ["metadata run", f => { f.metadata.runId = "old-run"; }],
  ["metadata index", f => { f.metadata.index = 1; }],
  ["metadata exit", f => { f.metadata.exitCode = 1; }],
  ["metadata path", f => { f.metadata.artifactPaths.metadataPath = join(f.root, "foreign.json"); }],
  ["output path", f => { f.metadata.artifactPaths.outputPath = join(f.root, "foreign.md"); }],
];
for (const [label, change] of invalidOriginals) test(`explicit missionId refuses mismatched native ${label}`, () => explicitMissionFixture(async f => {
  change(f); await f.save(); await f.saveSidecar(); await f.send();
  assert.equal(f.views.at(-1).outcome, "unknown"); assert.ok(!f.reads.includes(f.output));
}));

for (const kind of ["missing", "corrupt", "foreign symlink"]) test(`explicit missionId refuses ${kind} sidecar`, () => explicitMissionFixture(async f => {
  await rm(f.sidecarPath);
  if (kind === "corrupt") await writeFile(f.sidecarPath, "{");
  if (kind === "foreign symlink") { const foreign = join(f.root, "foreign.json"); await writeFile(foreign, JSON.stringify(f.sidecar)); await symlink(foreign, f.sidecarPath); }
  await f.send(); assert.equal(f.views.at(-1).reasonCode, "owner_reader_failed"); assert.ok(!f.reads.includes(f.output));
}));

for (const kind of ["error", "result error", "path", "mission", "mode", "warning"]) test(`later result middleware ${kind} cannot grant cross-owner observation`, () => explicitMissionFixture(async f => {
  f.producer.onToolResult(f.result); f.producer.onCompletion(f.complete); assert.equal(f.reads.length, 0);
  if (kind === "error") f.launch.isError = true;
  if (kind === "result error") f.launch.result.isError = true;
  if (kind === "path") f.launch.result.details.asyncDir = join(f.root, "foreign-run");
  if (kind === "mission") f.launch.result.details.missionId = "foreign";
  if (kind === "mode") f.launch.result.details.mode = "workflow";
  if (kind === "warning") f.launch.result.details.missionWarning = "PRIVATE_WARNING";
  f.producer.onTool(f.launch); await f.drain(); assert.equal(f.views.at(-1).outcome, "unknown"); assert.equal(f.reads.length, 0);
}));

test("tool_result captures identity rather than keeping mutable middleware input/details or task bodies", () => explicitMissionFixture(async f => {
  f.producer.onToolResult(f.result);
  f.result.input.options.missionId = "changed-after-observer"; f.result.details.missionPath = "/foreign/mission-one.json";
  f.producer.onCompletion(f.complete); f.producer.onTool(f.launch); await f.drain();
  assert.equal(f.views.at(-1).decision, "deliverable"); assert.equal(f.views.at(-1).binding.workRef.key, "mission-one");
}));

test("tool_result hostile descriptors/proxies never execute and never become explicit evidence", () => explicitMissionFixture(async f => {
  let traps = 0;
  const original = structuredClone(f.result.input);
  for (const input of [
    new Proxy(original, { ownKeys() { traps++; throw Error(); } }),
    Object.defineProperty({ ...original }, "task", { get() { traps++; throw Error(); } }),
    { ...original, options: new Proxy(original.options, { get() { traps++; throw Error(); } }) },
    { ...original, options: Object.create({ missionId: "mission-one" }) },
    { ...original, options: Object.defineProperty({}, "missionId", { get() { traps++; return "mission-one"; } }) },
  ]) {
    f.producer.reset(); f.result.input = input; await f.send(); assert.equal(f.views.at(-1).outcome, "unknown");
  }
  assert.equal(traps, 0); assert.ok(!f.reads.includes(f.sidecarPath));
}));

test("foreign/late result, end and tree changes never upgrade a prior end-only or replacement record", () => explicitMissionFixture(async f => {
  f.producer.onTool(f.launch); await f.drain(); // no native result evidence
  f.producer.onToolResult(f.result); f.producer.onCompletion(f.complete); await f.drain(); assert.equal(f.views.at(-1).outcome, "unknown");
  f.producer.reset(); f.producer.onToolResult(f.result); f.producer.onTree(); f.producer.onCompletion(f.complete); f.producer.onTool(f.launch); await f.drain();
  assert.equal(f.views.at(-1).outcome, "unknown");
  f.producer.reset(); f.producer.onToolResult(f.result); f.producer.onTool({ ...f.launch, toolCallId: "foreign-call" });
  assert.equal(f.producer.status().originals, 0);
  f.producer.reset(); f.setHost("replacement"); f.producer.onCompletion(f.complete); await f.drain();
  assert.equal(f.producer.status().associated, 0);
}));

test("result/end observation refuses accessor final flags without executing them", () => explicitMissionFixture(async f => {
  let traps = 0;
  f.producer.onToolResult(f.result); f.producer.onCompletion(f.complete);
  Object.defineProperty(f.launch.result.details, "missionWarning", { get() { traps++; return undefined; } });
  f.producer.onTool(f.launch); await f.drain();
  assert.equal(traps, 0); assert.equal(f.views.at(-1).outcome, "unknown"); assert.equal(f.reads.length, 0);
}));

test("tool_result admission is bounded and carries no read on overflow", () => explicitMissionFixture(async f => {
  for (let i = 0; i < 257; i++) f.producer.onToolResult({ ...f.result, toolCallId: `call-${i}`, details: { ...f.result.details,
    runId: `run-${i}`, asyncId: `run-${i}`, asyncDir: join(f.root, `run-${i}`) } });
  assert.equal(f.producer.status().associated, 256); assert.equal(f.producer.status().unavailable, 1);
  assert.deepEqual(f.reads, []);
}));

test("explicit missionId reader failure and duplicate completion stay non-authorizing without retry", () => explicitMissionFixture(async f => {
  f.reader.read = (file, cap) => { if (file === f.sidecarPath) throw Error("PRIVATE_READER_FAILURE"); return readSubagentFile(file, cap); };
  await f.send(); assert.equal(f.views.at(-1).reasonCode, "owner_reader_failed"); const reads = f.reads.length;
  f.reader.read = readSubagentFile; f.producer.onTool(f.launch); f.producer.onCompletion(f.complete); await f.drain(); assert.equal(f.reads.length, reads);
  f.producer.onTerminal({ runId: "run-one" }); await f.drain(); assert.equal(f.views.at(-1).decision, "deliverable");
  assert.ok(!JSON.stringify(f.views).includes("PRIVATE_READER_FAILURE"));
}));

test("same-owner explicit request retains four-original reads without requiring a sidecar", () => explicitMissionFixture(async f => {
  f.mission.ownerSessionId = f.status.sessionId; delete f.status.toolCallId; await f.save(); await rm(f.sidecarPath);
  f.producer.onCompletion(f.complete); f.producer.onToolResult(f.result); f.producer.onTool(f.launch); await f.drain();
  assert.equal(f.views.at(-1).decision, "deliverable");
  assert.deepEqual(f.reads, [f.missionPath, join(f.asyncDir, "status.json"), f.metadataPath, f.output]);
}));

test("explicit missionId pending/failed native originals and late reads retain existing semantics", () => explicitMissionFixture(async f => {
  f.status.processTerminal.state = "pending"; await f.save(); await f.send(); assert.equal(f.views.at(-1).outcome, "unknown");
  f.status.state = "failed"; await f.save(); f.producer.onTerminal({ runId: "run-one" }); await f.drain();
  assert.equal(f.views.at(-1).outcome, "failed"); assert.equal(f.views.at(-1).decision, "reportable_terminal");
  f.producer.reset(); f.status.state = "complete"; f.status.processTerminal.state = "observed"; await f.save();
  let release, entered;
  const started = new Promise(resolve => { entered = resolve; }), blocked = new Promise(resolve => { release = resolve; });
  f.reader.read = async (file, cap) => { if (file === f.sidecarPath) { entered(); await blocked; } return readSubagentFile(file, cap); };
  f.producer.onToolResult(f.result); f.producer.onCompletion(f.complete); f.producer.onTool(f.launch); await started;
  f.producer.onTerminal({ runId: "run-one" }); f.producer.reset(); f.setHost("successor-session"); release(); await f.drain();
  assert.equal(f.views.at(-1).binding.sessionId, "parent-session"); assert.equal(f.producer.status().originals, 0);
  assert.equal(f.producer.status().associated, 0);
}));

test("work host tool_result is notification-only, current-context bound and reset fenced", () => explicitMissionFixture(async f => {
  const handlers = new Map(), events = new EventEmitter(), rows = [];
  const pi = { on(name, fn) { handlers.set(name, fn); }, registerCommand() {}, getCommands: () => [],
    events: { emit: (name, value) => events.emit(name, value), on(name, fn) { events.on(name, fn); return () => events.off(name, fn); } } };
  const observer = createPiWorkObserver({ freshSessionsSince: "2026-01-01T00:00:00.000Z", store: { append: row => rows.push(row) }, diagnose() {} });
  observer.extension(pi);
  const ctx = (id = "parent-session", owner = f.status.sessionId) => ({ sessionManager: { getSessionId: () => id, getSessionFile: () => owner,
    getHeader: () => ({ id, timestamp: "2026-01-01T00:00:00.000Z" }), getBranch() { assert.fail("history scan"); } } });
  const drain = async () => { while (observer.status().inFlight) await observer.drain(); };
  handlers.get("session_start")({}, ctx());
  assert.equal(handlers.get("tool_result")(f.result, ctx("foreign")), undefined);
  assert.equal(observer.status().ownerProducer.associated, 0);
  assert.equal(handlers.get("tool_result")(f.result, ctx()), undefined);
  assert.equal(observer.status().ownerReads, 0);
  handlers.get("session_tree")(); events.emit("subagent:async-complete", f.complete);
  handlers.get("tool_execution_end")(f.launch); await drain();
  assert.equal(observer.observationSnapshot().observations.at(-1).observation.outcome, "unknown");
  handlers.get("session_start")({ reason: "reload" }, ctx());
  events.emit("subagent:async-complete", f.complete);
  handlers.get("tool_result")(f.result, ctx()); handlers.get("tool_execution_end")(f.launch); await drain();
  const prior = observer.observationSnapshot(); assert.equal(prior.observations.at(-1).observation.decision, "deliverable");
  const count = observer.status().ownerReads;
  handlers.get("tool_result")(f.result, ctx()); handlers.get("tool_execution_end")(f.launch); await drain();
  assert.equal(observer.status().ownerReads, count);
  handlers.get("session_shutdown")(); handlers.get("tool_result")(f.result, ctx()); handlers.get("tool_execution_end")(f.launch); await drain();
  assert.equal(observer.observationSnapshot().observations.length, 0);
  handlers.get("session_start")({}, ctx("successor", join(f.root, "successor.jsonl")));
  handlers.get("tool_result")(f.result, ctx()); events.emit("subagent:async-complete", f.complete); await drain();
  assert.equal(observer.status().ownerProducer.associated, 0); assert.equal(observer.observationSnapshot().observations.length, 0);
  assert.equal(prior.observations.at(-1).observation.binding.sessionId, "parent-session");
  assert.ok(!JSON.stringify([rows, prior]).includes(f.root));
}));

test("native mission/run/output originals produce scoped availability, not task acceptance", () => fixture(async f => {
  f.producer.onTool(f.launch); await f.drain(); assert.equal(f.views[0].outcome, "unknown");
  f.producer.onCompletion(f.complete); await f.drain();
  const view = f.views.at(-1); assert.equal(view.decision, "deliverable", JSON.stringify(view));
  assert.equal(view.binding.workRef.key, "mission-one"); assert.equal(view.binding.stageId, "subagent-output-available");
  assert.equal(view.authorization, "none"); assert.equal(f.producer.status().taskAcceptance, "not-checked");
  assert.ok(!JSON.stringify(f.views).includes("PRIVATE_ORIGINAL_REPORT")); assert.ok(!JSON.stringify(f.views).includes(f.root));
}));

test("installed host wiring routes native events through actual observer consumption and safe rows", () => fixture(async f => {
  const handlers = new Map(), events = new EventEmitter(), rows = []; let diagnostics = 0;
  const pi = { on(name, fn) { handlers.set(name, fn); return () => handlers.delete(name); },
    events: { emit(name, payload) { events.emit(name, payload); }, on(name, fn) { events.on(name, fn); return () => events.off(name, fn); } },
    registerCommand() {}, getCommands: () => [] };
  const observer = createPiWorkObserver({ freshSessionsSince: "2026-01-01T00:00:00.000Z", store: { append: event => { rows.push(event); } }, diagnose: () => { diagnostics++; } });
  observer.extension(pi); handlers.get("session_start")({}, { sessionManager: {
    getSessionId: () => "parent-session", getSessionFile: () => f.mission.ownerSessionId,
    getHeader: () => ({ id: "parent-session", timestamp: "2026-01-01T00:00:00.000Z" }),
  } });
  handlers.get("tool_execution_end")(f.launch); await observer.drain();
  events.emit("subagent:async-complete", f.complete); await observer.drain();
  assert.equal(observer.status().deliverable, 1); assert.equal(observer.status().ownerProducer.taskAcceptance, "not-checked");
  const last = rows.at(-1); assert.equal(last.result, "ok"); assert.equal(last.artifact_refs[0].ref, "subagent-output-available");
  const json = JSON.stringify(rows); assert.ok(!json.includes(f.root)); assert.ok(!json.includes("PRIVATE_ORIGINAL_REPORT"));
  events.emit("subagent:async-complete", f.complete); await observer.drain(); assert.equal(observer.status().deliverable, 1);
  assert.equal(diagnostics, 0); assert.equal(observer.status().unavailable, 0);
}, true));

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
  f.producer.onTerminal(new Proxy({}, { get() { calls++; throw Error(); } }));
  await f.drain(); assert.equal(calls, 0); assert.equal(f.views.length, 0);
}));

test("bounded original file reader refuses symlink, directory and oversized content", () => fixture(async f => {
  const link = join(f.root, "link.md"); await symlink(f.output, link);
  await assert.rejects(readSubagentFile(link)); await assert.rejects(readSubagentFile(f.root));
  await assert.rejects(readSubagentFile(f.output, 3));
  assert.equal((await readSubagentFile(f.output)).toString(), "PRIVATE_ORIGINAL_REPORT");
  assert.equal((await readFile(f.output)).toString(), "PRIVATE_ORIGINAL_REPORT");
}));
