import { deepStrictEqual, strictEqual } from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { setImmediate as nextTurn } from "node:timers/promises";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  createPiRunContext, readPiOwnerResult,
  type PiOwnerReadback, type PiOwnerResultReadRequest, type PiResultConsumption, type PiWorkBinding,
} from "@pi-vista/adapter-pi";
import { EventStore } from "@pi-vista/core";
import type { GovernanceEvidenceRecord, GovernanceReceipt } from "@pi-vista/protocol";

const root = fileURLToPath(new URL("../", import.meta.url));
const now = Date.parse("2026-11-04T00:00:30.000Z");
const observedAt = "2026-11-04T00:00:20.000Z";
const freshUntil = "2026-11-04T00:01:00.000Z";
const binding: PiWorkBinding = {
  workRef: { owner: "example/maintenance", kind: "change", key: "source-change-1" },
  stageId: "source", runId: "run-owner-integration", sessionId: "session-owner-integration", revision: 1,
  headSha: "a".repeat(40),
};

function receipt(): GovernanceReceipt {
  return {
    receipt_schema: "pi-governance-receipt/1", receipt_id: "native-result-1", event_kind: "run.settled",
    emitted_at: observedAt, source: "subagents",
    identity: { run_id: binding.runId, session_id: binding.sessionId },
    provenance: { protocol_version: "pi-governance-receipt/1", source_sha: binding.headSha, head_sha: binding.headSha },
    status: { run: "settled", execution_outcome: "settled", business_outcome: "unknown", delivery_outcome: "available", permission_outcome: "not_checked" },
    evidence: [{ evidence_id: "ci-1", kind: "ci", ref: "ci-original-1", state: "validated", observed_at: observedAt, fresh_until: freshUntil }],
    redaction: { profile: "pi-governance-public/1", raw_content_included: false, credentials_included: false, private_path_included: false },
  };
}

function nativeEvidence(id: string, kind: "test" | "ci", ref: string, claim: string): GovernanceEvidenceRecord {
  return {
    evidence_id: id, run_id: binding.runId, kind, state: "validated", source_ref: ref, source_sha: binding.headSha,
    claims: [claim], observed_at: observedAt, fresh_until: freshUntil, counterevidence_refs: [], redaction_profile: "pi-governance-public/1",
  };
}

async function sandbox(): Promise<string> {
  await mkdir(join(root, "tmp"), { recursive: true });
  return mkdtemp(join(root, "tmp/work-result-consumption-"));
}

test("public Pi receipt sink explicitly re-reads native originals; a terminal receipt/validated flag cannot replace required CI", async () => {
  const base = await sandbox();
  const originalResult = receipt();
  const originalBytes = JSON.stringify(originalResult);
  const nativeResults = new Map<string, GovernanceReceipt>();
  const originals = new Map<string, GovernanceEvidenceRecord>([
    ["test-1", nativeEvidence("test-1", "test", "test-original-1", "unit-checks")],
    ["ci-1", nativeEvidence("ci-1", "ci", "ci-original-1", "required-checks")],
  ]);
  const observations: PiResultConsumption[] = [];
  const store = new EventStore(base);
  let reads = 0;
  const readOwner = (request: PiOwnerResultReadRequest): PiOwnerReadback => {
    reads += 1;
    const native = nativeResults.get(request.resultRef)!;
    strictEqual(native.receipt_id, originalResult.receipt_id);
    strictEqual(native.identity.run_id, request.binding.runId);
    strictEqual(native.identity.session_id, request.binding.sessionId);
    strictEqual(native.provenance.head_sha, request.binding.headSha);
    // The existing stage, not the worker receipt's self-reported evidence, selects both originals.
    return {
      binding, sourceKind: "code", sourceRef: "owner-pr-1", disposition: "accepted", observedAt, freshUntil,
      requiredEvidence: [
        { evidenceId: "test-1", kind: "test", sourceRef: "test-original-1", claims: ["unit-checks"] },
        { evidenceId: "ci-1", kind: "ci", sourceRef: "ci-original-1", claims: ["required-checks"] },
      ],
      evidence: [...originals.values()].map((record) => ({ binding, record })), requiredEffects: [],
    };
  };
  const context = createPiRunContext({
    runId: binding.runId, sessionId: binding.sessionId, store, now,
    emitGovernanceReceipt: async (value) => {
      nativeResults.set(value.receipt_id, value);
      observations.push(await readPiOwnerResult({ binding, resultRef: value.receipt_id }, { readOwner, now }));
    },
  });
  try {
    strictEqual((await context.emitToolResult({ tool: "native-build", result: "ok" }))?.result, "ok");
    strictEqual(await context.emitGovernanceReceipt(originalResult), originalResult);
    strictEqual(observations[0]?.decision, "deliverable");
    strictEqual(observations[0]?.resultRef, originalResult.receipt_id);
    strictEqual(observations[0]?.authorization, "none");
    strictEqual(observations[0]?.readOnly, true);
    originals.delete("ci-1");
    strictEqual(await context.emitGovernanceReceipt(originalResult), originalResult);
    strictEqual(observations[1]?.reasonCode, "required_evidence_not_validated");
    strictEqual(reads, 2);
    await context.end();
    strictEqual(JSON.stringify(originalResult), originalBytes);
    strictEqual((await store.readRun(binding.runId)).length, 1, "result observations do not write native task state or emit a new run");
    const persisted = await readFile(join(base, "runs", binding.runId, "events.jsonl"), "utf8");
    strictEqual(persisted.includes(base), false);
    strictEqual(persisted.includes("owner-pr-1"), false, "opt-in observations do not rewrite canonical Pi events");
  } finally { await rm(base, { recursive: true, force: true }); }
});

test("public Pi execution and receipt forwarding remain unchanged on reader error/timeout/late rejection", async () => {
  const base = await sandbox();
  const store = new EventStore(base);
  const original = receipt();
  const before = JSON.stringify(original);
  const observations: PiResultConsumption[] = [];
  let rejectRead: ((reason: Error) => void) | undefined;
  let mode: "failure" | "timeout" = "failure";
  const unhandled: unknown[] = [];
  const onUnhandled = (reason: unknown): void => { unhandled.push(reason); };
  process.on("unhandledRejection", onUnhandled);
  const context = createPiRunContext({
    runId: binding.runId, sessionId: binding.sessionId, store, now, persistTimeoutMs: 50,
    emitGovernanceReceipt: async (value) => {
      observations.push(await readPiOwnerResult({ binding, resultRef: value.receipt_id }, {
        readOwner: () => {
          if (mode === "failure") throw new Error("private-owner-reader-body");
          return new Promise((_resolve, reject) => { rejectRead = reject; });
        }, now, timeoutMs: 5,
      }));
    },
  });
  try {
    strictEqual(await context.emitGovernanceReceipt(original), original);
    mode = "timeout";
    strictEqual(await context.emitGovernanceReceipt(original), original);
    rejectRead!(new Error("private-late-reader-body"));
    strictEqual((await context.emitToolResult({ tool: "native-result", result: "ok" }))?.result, "ok");
    await context.end();
    await nextTurn();
    deepStrictEqual(observations.map((value) => value.reasonCode), ["owner_reader_failed", "owner_reader_timeout"]);
    deepStrictEqual(unhandled, []);
    strictEqual((await store.readRun(binding.runId))[0]?.result, "ok");
    strictEqual(JSON.stringify(original), before);
    for (const value of ["private-owner-reader-body", "private-late-reader-body", base]) {
      strictEqual(JSON.stringify(observations).includes(value), false);
    }
  } finally {
    process.off("unhandledRejection", onUnhandled);
    await rm(base, { recursive: true, force: true });
  }
});
