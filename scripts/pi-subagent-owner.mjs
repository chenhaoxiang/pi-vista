import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { createHash } from "node:crypto";
import { basename, isAbsolute, join, normalize } from "node:path";
import { types } from "node:util";
import { snapshotPiWorkBinding } from "@pi-vista/adapter-pi";

const OWNER = "chenhaoxiang/pi-subagents";
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const fail = () => { throw Error("subagent-original-unavailable"); };
function field(value, key) {
  if (!value || typeof value !== "object" || types.isProxy(value)) return;
  const d = Object.getOwnPropertyDescriptor(value, key);
  return d && Object.hasOwn(d, "value") ? d.value : undefined;
}
function array(value, cap = 64) {
  if (!Array.isArray(value) || types.isProxy(value) || Object.getPrototypeOf(value) !== Array.prototype) return;
  const size = field(value, "length");
  if (!Number.isSafeInteger(size) || size < 0 || size > cap || Reflect.ownKeys(value).length !== size + 1) return;
  const result = [];
  for (let i = 0; i < size; i++) { const d = Object.getOwnPropertyDescriptor(value, String(i)); if (!d || !Object.hasOwn(d, "value")) return; result.push(d.value); }
  return result;
}
function id(value) { if (typeof value !== "string" || !/^[A-Za-z0-9_-]{1,128}$/u.test(value)) fail(); return value; }
function path(value) { if (typeof value !== "string" || value.length > 4096 || !isAbsolute(value) || normalize(value) !== value || /[\x00-\x1f\x7f]/u.test(value)) fail(); return value; }

/** Read one owner-selected regular original, not a directory or session transcript.
 * Paths stay inside the host; only digests/opaque references leave this reader.
 */
export async function readSubagentFile(file, maxBytes = 2 * 1024 * 1024) {
  path(file);
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > 8 * 1024 * 1024) fail();
  // Native macOS paths may use the system /var alias. O_NOFOLLOW rejects
  // the file itself; trusted owner-selected ancestor paths are not a sandbox.
  const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const first = await handle.stat();
    if (!first.isFile() || first.size > maxBytes || first.uid !== process.getuid?.()) fail();
    const bytes = Buffer.alloc(first.size + 1);
    let offset = 0;
    while (offset < bytes.length) { const r = await handle.read(bytes, offset, bytes.length - offset, offset); if (!r.bytesRead) break; offset += r.bytesRead; }
    const last = await handle.stat();
    if (offset !== first.size || last.size !== first.size || last.mtimeMs !== first.mtimeMs || last.ctimeMs !== first.ctimeMs) fail();
    return bytes.subarray(0, offset);
  } finally { await handle.close(); }
}
function admission(details, hostSessionId, nativeOwnerId) {
  const runId = id(field(details, "runId") ?? field(details, "asyncId"));
  const missionId = id(field(details, "missionId"));
  if (field(details, "mode") !== "single") fail();
  const missionPath = path(field(details, "missionPath")), asyncDir = path(field(details, "asyncDir"));
  if (basename(missionPath) !== `${missionId}.json` || basename(asyncDir) !== runId) fail();
  const binding = snapshotPiWorkBinding({ workRef: { owner: OWNER, kind: "task", key: missionId },
    stageId: "subagent-output-available", runId, sessionId: id(hostSessionId), revision: 0 });
  if (typeof nativeOwnerId !== "string" || !nativeOwnerId || nativeOwnerId.length > 4096) fail();
  return Object.freeze({ binding, missionPath, asyncDir, nativeOwnerId });
}
function outputFrom(event) {
  const results = array(field(event, "results"));
  if (!results || results.length !== 1) return;
  const child = results[0];
  const value = field(child, "savedOutputPath") ?? field(field(child, "artifactPaths"), "outputPath") ?? field(child, "artifactPath");
  try { return { outputPath: path(value), metadataPath: path(field(field(child, "artifactPaths"), "metadataPath")) }; } catch { return; }
}

/** Current native mission/run originals prove only output availability. They never
 * stand in for task acceptance, code CI, parent review or business settlement.
 */
export async function readSubagentOutputOriginal(record, outputPath, readFile = readSubagentFile) {
  const { binding, missionPath, asyncDir, nativeOwnerId } = record;
  const [missionBytes, statusBytes] = await Promise.all([readFile(missionPath), readFile(join(asyncDir, "status.json"))]);
  const mission = JSON.parse(missionBytes.toString("utf8")), status = JSON.parse(statusBytes.toString("utf8"));
  if (mission.schemaVersion !== 1 || mission.id !== binding.workRef.key || mission.ownerSessionId !== nativeOwnerId
    || status.lifecycleArtifactVersion !== 3 || status.runId !== binding.runId || status.sessionId !== nativeOwnerId || status.mode !== "single") fail();
  const runs = array(mission.runs, 4096), matching = runs?.filter(run => field(run, "runId") === binding.runId);
  if (!matching || matching.length !== 1 || field(matching[0], "asyncDir") !== asyncDir) fail();
  const timestamp = Date.now(), observedAt = new Date(timestamp).toISOString(), freshUntil = new Date(timestamp + 30_000).toISOString();
  const sourceRef = `subagent-run-${binding.runId}`;
  const snapshot = { binding, sourceKind: "artifact", sourceRef, disposition: "unknown", observedAt, freshUntil,
    requiredEvidence: [{ evidenceId: "native-original", kind: "readback", sourceRef, claims: ["native-artifact-available"] }], evidence: [], requiredEffects: [] };
  if (["failed", "rejected", "stopped"].includes(status.state)) return { ...snapshot, disposition: "rejected" };
  if (status.state !== "complete") return snapshot;
  if (status.processTerminal?.state !== "observed" || status.processTerminal.runId !== binding.runId) return snapshot;
  const steps = array(status.steps);
  if (!steps || steps.length !== 1 || !["complete", "completed"].includes(field(steps[0], "status")) || field(steps[0], "exitCode") !== 0) return snapshot;
  // Mission supplies stable work/run membership, not execution truth: its status
  // projection can lag native completion. The exact native artifact metadata
  // binds the selected output to this run/parent, never to a prior mission run.
  if (!outputPath || !record.metadataPath) return snapshot;
  const metadataBytes = await readFile(record.metadataPath), metadata = JSON.parse(metadataBytes.toString("utf8"));
  if (metadata.runId !== binding.runId || metadata.parentSessionId !== binding.sessionId || metadata.index !== 0 || metadata.exitCode !== 0
    || metadata.artifactPaths?.metadataPath !== record.metadataPath
    || ![metadata.savedOutputPath, metadata.artifactPaths?.outputPath].includes(outputPath)) fail();
  const output = await readFile(outputPath, 8 * 1024 * 1024);
  if (!output.length) return snapshot;
  const digest = hash(JSON.stringify([hash(missionBytes), hash(statusBytes), hash(metadataBytes), hash(output)]));
  return { ...snapshot, disposition: "accepted", evidence: [{ binding, record: {
    evidence_id: "native-original", run_id: binding.runId, kind: "readback", state: "validated", source_ref: sourceRef,
    content_digest: digest, claims: ["native-artifact-available"], observed_at: observedAt, fresh_until: freshUntil,
    counterevidence_refs: [], redaction_profile: "metadata-only",
  } }] };
}

/** Native live events + exact owner files, no history traversal, polling or RPC
 * status side effects. Native Subagents remains execution/result authority.
 */
export function createSubagentOwnerProducer({ hostSessionId, nativeOwnerId = hostSessionId, publish, diagnose = () => {}, readFile = readSubagentFile }) {
  const records = new Map(), early = new Map(); let generation = 0;
  const counts = { associated: 0, signals: 0, originals: 0, duplicate: 0, unsupported: 0, unavailable: 0 };
  const unavailable = () => { counts.unavailable++; try { diagnose(); } catch {} };
  function inspect(record) {
    const version = generation;
    if (record.busy) { record.dirty = true; return; }
    record.busy = true;
    let accepted;
    try { accepted = publish({ hostSessionId: record.binding.sessionId,
      reference: { binding: record.binding, resultRef: `subagent-output-${record.binding.runId}` },
      readOwner: async () => { const value = await readSubagentOutputOriginal(record, record.outputPath, readFile); if (version === generation) counts.originals++; return value; },
      onObservation: view => {
        record.busy = false;
        if (version !== generation || hostSessionId() !== record.binding.sessionId) return;
        record.lastObservation = view;
        if (record.dirty) { record.dirty = false; inspect(record); }
      } }); } catch { accepted = false; }
    if (accepted === false) { record.busy = false; unavailable(); }
  }
  function onTool(event) {
    if (!hostSessionId()) return;
    const details = field(field(event, "result"), "details");
    if (field(event, "toolName") === "bg_wait") {
      for (const completion of array(field(details, "completions")) ?? []) {
        const runId = field(completion, "runId"), record = records.get(runId);
        if (!record) continue;
        // A completed native wait is an original hint too (non-interactive
        // parents may have no later async-complete notification).
        onCompletion({ runId, sessionId: nativeOwnerId(), asyncDir: record.asyncDir,
          state: field(completion, "state"), results: field(completion, "results") });
      }
      return;
    }
    if (field(event, "toolName") !== "subagent") return;
    if (field(details, "asyncDir") === undefined || field(details, "missionId") === undefined) return;
    try {
      const next = admission(details, hostSessionId(), nativeOwnerId());
      const key = next.binding.runId, existing = records.get(key);
      if (existing) {
        if (existing.missionPath !== next.missionPath || existing.asyncDir !== next.asyncDir || existing.binding.workRef.key !== next.binding.workRef.key) { unavailable(); return; }
        inspect(existing); return;
      }
      if (records.size >= 256) { unavailable(); return; }
      const record = { ...next, busy: false, dirty: false, signals: new Set(), outputPath: undefined };
      records.set(key, record); counts.associated++;
      const completion = early.get(key); early.delete(key);
      if (completion) onCompletion(completion); else inspect(record);
    } catch { counts.unsupported++; }
  }
  function onCompletion(event) {
    try {
      const runId = id(field(event, "runId") ?? field(event, "id")), record = records.get(runId);
      if (!record) {
        const sessionId = field(event, "sessionId");
        if (!hostSessionId() || sessionId !== nativeOwnerId()) return;
        if (early.size >= 64) { unavailable(); return; }
        const output = outputFrom(event);
        early.set(runId, { runId, sessionId, asyncDir: field(event, "asyncDir"), state: field(event, "state"), timestamp: field(event, "timestamp"),
          results: output ? [{ savedOutputPath: output.outputPath, artifactPaths: { metadataPath: output.metadataPath } }] : [] });
        return;
      }
      if (hostSessionId() !== record.binding.sessionId) return;
      if (field(event, "sessionId") !== record.nativeOwnerId || (field(event, "asyncDir") !== undefined && field(event, "asyncDir") !== record.asyncDir)) { unavailable(); return; }
      const output = outputFrom(event), state = field(event, "state");
      const fingerprint = hash(JSON.stringify([state, output]));
      if (record.signals.has(fingerprint)) { counts.duplicate++; return; }
      if (record.signals.size >= 32) { unavailable(); return; }
      record.signals.add(fingerprint); counts.signals++;
      if (output) {
        if (record.outputPath && (output.outputPath !== record.outputPath || output.metadataPath !== record.metadataPath)) { unavailable(); return; }
        record.outputPath = output.outputPath; record.metadataPath = output.metadataPath;
      }
      inspect(record);
    } catch { unavailable(); }
  }
  function onTerminal(event) { const record = records.get(field(event, "runId")); if (record && hostSessionId() === record.binding.sessionId) inspect(record); }
  function reset() { generation++; records.clear(); early.clear(); for (const key of Object.keys(counts)) counts[key] = 0; }
  return Object.freeze({ onTool, onCompletion, onTerminal, reset,
    status: () => Object.freeze({ ...counts, scope: "native-single-async-output-availability", taskAcceptance: "not-checked" }) });
}
