import { deepStrictEqual, doesNotReject, rejects, strictEqual, throws } from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { EventStore, isVistaEvent, VistaProtocolError, type VistaEvent } from "@pi-vista/core";
import {
  emitAiGateEvidence,
  emitAiGateObservation,
  toVistaEventInput,
  type AiGateEvidence,
} from "./index.js";

const SOURCE_SHA = "0123456789abcdef0123456789abcdef01234567";
const OTHER_SHA = "fedcba9876543210fedcba9876543210fedcba98";

function evidence(overrides: Record<string, unknown> = {}): AiGateEvidence {
  const value: Record<string, unknown> = {
    run_id: "run-ai-gate",
    session_id: "session-ai-gate",
    trace_id: "trace-ai-gate",
    repo: "pi-vista",
    source_sha: SOURCE_SHA,
    action: "ci_check",
    result: "ok",
    ...overrides,
  };
  if (Object.hasOwn(overrides, "check_type")) delete value.action;
  if (Object.hasOwn(overrides, "status")) delete value.result;
  return value as unknown as AiGateEvidence;
}

function expectProtocolError(callback: () => unknown, pattern: RegExp): void {
  throws(callback, (error: unknown) => error instanceof VistaProtocolError && pattern.test(error.message));
}

function gateStats(value: ReturnType<typeof toVistaEventInput>): Record<string, number | string> | undefined {
  return value.artifact_refs?.find((artifact) => artifact.type === "gate_metadata")?.stats;
}

test("maps CI success/failure and every supported status exactly", () => {
  const expected = {
    pending: "unknown",
    success: "ok",
    failure: "failed",
    cancelled: "failed",
    skipped: "unknown",
    neutral: "unknown",
  } as const;
  for (const [status, result] of Object.entries(expected)) {
    const mapped = toVistaEventInput(evidence({ status }));
    strictEqual(mapped.component, "gate");
    strictEqual(mapped.action, "gate:ci_check");
    strictEqual(mapped.result, result, status);
  }
  for (const result of ["ok", "blocked", "failed", "unknown", "abstain"] as const) {
    strictEqual(toVistaEventInput(evidence({ result })).result, result);
  }
  expectProtocolError(() => toVistaEventInput(evidence({ result: "success" })), /VistaResult/u);
  for (const status of ["SUCCESS", "ok", "passed", "", "toString"]) {
    expectProtocolError(() => toVistaEventInput(evidence({ status })), /status must be/u);
  }
});

test("requires exactly one action/check_type alias, even when both values agree", () => {
  strictEqual(toVistaEventInput(evidence()).action, "gate:ci_check");
  strictEqual(toVistaEventInput(evidence({ check_type: "review_check" })).action, "gate:review_check");
  for (const check_type of ["ci_check", "review_check", undefined]) {
    expectProtocolError(
      () => toVistaEventInput({ ...evidence(), check_type } as unknown as AiGateEvidence),
      /exactly one of action or check_type/u,
    );
  }
  const missing = evidence() as unknown as Record<string, unknown>;
  delete missing.action;
  expectProtocolError(() => toVistaEventInput(missing as unknown as AiGateEvidence), /exactly one of action or check_type/u);
  for (const action of ["", "git status", "/tmp/check", "ci?token=secret", "ci\ncheck", "a".repeat(129)]) {
    expectProtocolError(() => toVistaEventInput(evidence({ action })), /registry-safe/u);
  }
});

test("requires exactly one result/status alias and rejects explicit undefined fields", () => {
  for (const status of ["success", "failure", undefined]) {
    expectProtocolError(
      () => toVistaEventInput({ ...evidence(), status } as unknown as AiGateEvidence),
      /exactly one of result or status/u,
    );
  }
  const missing = evidence() as unknown as Record<string, unknown>;
  delete missing.result;
  expectProtocolError(() => toVistaEventInput(missing as unknown as AiGateEvidence), /exactly one of result or status/u);
  expectProtocolError(() => toVistaEventInput(evidence({ result: undefined })), /result must be a string/u);
  expectProtocolError(() => toVistaEventInput(evidence({ status: undefined })), /status must be a string/u);
});

test("decision/verdict and passed/required never infer or replace an outcome", () => {
  for (const status of ["failure", "skipped", "pending"] as const) {
    const mapped = toVistaEventInput(evidence({ status, decision: "allow", verdict: "success", required: false, passed: true }));
    strictEqual(mapped.result, status === "failure" ? "failed" : "unknown");
    strictEqual(mapped.reason_code, undefined);
    deepStrictEqual(gateStats(mapped), { decision: "allow", verdict: "success", passed: 1, required: 0 });
  }
  const withoutOutcome = { action: "admission", decision: "allow", passed: true, required: false };
  expectProtocolError(() => toVistaEventInput(withoutOutcome as unknown as AiGateEvidence), /exactly one of result or status/u);
  for (const key of ["passed", "required"]) {
    for (const value of [0, 1, "false", null, undefined]) {
      expectProtocolError(() => toVistaEventInput(evidence({ [key]: value })), /must be a boolean/u);
    }
  }
});

test("preserves identity and binds matching 40/64-character SHA pairs case-insensitively", () => {
  for (const source_sha of [SOURCE_SHA, "a".repeat(64)]) {
    const head_sha = source_sha.toUpperCase();
    const mapped = toVistaEventInput(evidence({ source_sha, head_sha }));
    strictEqual(mapped.run_id, "run-ai-gate");
    strictEqual(mapped.session_id, "session-ai-gate");
    strictEqual(mapped.trace_id, "trace-ai-gate");
    strictEqual(mapped.repo, "pi-vista");
    strictEqual(mapped.source_sha, source_sha);
    deepStrictEqual(gateStats(mapped), { head_sha, source_sha, sha_relation: "match" });
    strictEqual(Object.hasOwn(mapped, "head_sha"), false);
  }
});

test("SHA mismatch retains both safe summaries, explicit relation, and owner reason", () => {
  const mapped = toVistaEventInput(evidence({ head_sha: OTHER_SHA, reason_code: "ci_observed" }));
  strictEqual(mapped.source_sha, undefined);
  strictEqual(mapped.result, "unknown");
  strictEqual(mapped.reason_code, "ci_observed");
  deepStrictEqual(gateStats(mapped), { head_sha: OTHER_SHA, source_sha: SOURCE_SHA, sha_relation: "mismatch" });
  strictEqual(toVistaEventInput(evidence({ head_sha: OTHER_SHA })).reason_code, "sha_mismatch");
  strictEqual(toVistaEventInput(evidence({ head_sha: OTHER_SHA, result: "failed" })).result, "failed");
  strictEqual(toVistaEventInput(evidence({ head_sha: "b".repeat(64), status: "success" })).result, "unknown");
});

test("rejects illegal SHA summaries and a head SHA without source", () => {
  for (const key of ["source_sha", "head_sha"]) {
    for (const value of ["source-id", "a".repeat(39), "a".repeat(41), "a".repeat(63), "a".repeat(65), "g".repeat(40), "/tmp/sha", null]) {
      expectProtocolError(() => toVistaEventInput(evidence({ [key]: value })), /must be exactly|must be a string/u);
    }
  }
  const missingSource = evidence() as unknown as Record<string, unknown>;
  delete missingSource.source_sha;
  missingSource.head_sha = SOURCE_SHA;
  expectProtocolError(() => toVistaEventInput(missingSource as unknown as AiGateEvidence), /head_sha requires source_sha/u);
});

test("maps opaque review, escalation, receipt, and artifact refs without content or verification claims", () => {
  deepStrictEqual(toVistaEventInput(evidence({
    review_hash: "review_abc123",
    escalation_hash: "e".repeat(64),
    receipt_ref: "receipt-abc123",
    artifact_ref: "artifact-abc123",
    passed: true,
  })).artifact_refs, [
    { type: "review_evidence", ref: "review_abc123" },
    { type: "gate_escalation", ref: "e".repeat(64) },
    { type: "gate_receipt", ref: "receipt-abc123" },
    { type: "gate_artifact", ref: "artifact-abc123" },
    { type: "gate_metadata", ref: "gate-metadata", stats: { passed: 1 } },
  ]);
});

test("rejects URL query secrets, tokens/cookies, paths, raw commands, and content in refs", () => {
  const unsafe = [
    "https://example.test/receipt?token=secret",
    "https://example.test/receipt?%61ccess_token=secret",
    "https://user:pass@example.test/receipt",
    "https://example.test/receipt#secret",
    "PR body with untrusted text", "CI log: failure at line 1",
    "ghp_1234567890abcdef", "sk-1234567890abcdef", "session_cookie", "token-123",
    "/private/artifact.json", "C:\\private\\artifact.json", "./artifact.json", "../receipt",
    "git status", "rm -rf /private", "pwd", "$(whoami)", "receipt\nraw", "receipt%2Fprivate", "",
  ];
  for (const field of ["review_hash", "escalation_hash", "receipt_ref", "artifact_ref"]) {
    for (const value of unsafe) {
      expectProtocolError(() => toVistaEventInput(evidence({ [field]: value })), /safe opaque|sanitized metadata/u);
    }
  }
});

test("closed fields reject raw PR/CI/review content, commands, paths, credentials, symbols, and hidden fields", () => {
  for (const field of ["pr_body", "comment_body", "review_text", "ci_log", "token", "cookie", "command", "path", "gate_config", "/private/secret", "unexpected"]) {
    expectProtocolError(() => toVistaEventInput(evidence({ [field]: "raw-private-content" })), /unsupported field/u);
  }
  const hidden = evidence();
  Object.defineProperty(hidden, "pr_body", { value: "raw-private-content", enumerable: false });
  expectProtocolError(() => toVistaEventInput(hidden), /unsupported field/u);
  const symbolic = evidence();
  Object.defineProperty(symbolic, Symbol("raw-private-content"), { value: "raw-private-content" });
  expectProtocolError(() => toVistaEventInput(symbolic), /unsupported field/u);
  const polluted = JSON.parse('{"action":"ci_check","result":"ok","__proto__":{"token":"secret"}}') as AiGateEvidence;
  expectProtocolError(() => toVistaEventInput(polluted), /unsupported field/u);
});

test("retains lane/tier and generic model metadata without fixing providers or model counts", () => {
  for (const lane of ["P0", "P1", "P2", "P3", "P4", "P5"]) {
    for (const tier of ["tier2", "tier3"]) {
      const mapped = toVistaEventInput(evidence({ lane, tier, reviewer_id: "reviewer-42", model_id: "any-provider/custom-model-v9" }));
      strictEqual(mapped.model_id, "any-provider/custom-model-v9");
      deepStrictEqual(gateStats(mapped), { lane, tier, reviewer_id: "reviewer-42" });
    }
  }
  for (const lane of ["P6", "p1", "lane-P1"]) {
    expectProtocolError(() => toVistaEventInput(evidence({ lane })), /lane must be/u);
  }
  expectProtocolError(() => toVistaEventInput(evidence({ tier: "tier1" })), /tier must be/u);
});

test("omits reviewer stats that core cannot retain rather than widening the protocol", () => {
  const mapped = toVistaEventInput(evidence({ lane: "P2", reviewer_id: "provider/reviewer", model_id: "provider/model" }));
  strictEqual(mapped.model_id, "provider/model");
  deepStrictEqual(gateStats(mapped), { lane: "P2" });
  strictEqual(gateStats(toVistaEventInput(evidence({ reviewer_id: "r".repeat(65) }))), undefined);
});

test("rejects unsafe metadata and free-text reason/decision codes", () => {
  for (const field of ["run_id", "session_id", "trace_id", "repo", "model_id", "reviewer_id", "reason_code", "decision", "verdict"]) {
    for (const value of ["/Users/private", "git status", "token-secret", "ghp_1234567890abcdef", "raw text\nmore", "https://example.test/?token=secret"]) {
      expectProtocolError(() => toVistaEventInput(evidence({ [field]: value })), /path-safe|registry-safe|sanitized metadata/u);
    }
  }
  expectProtocolError(() => toVistaEventInput(evidence({ reason_code: "a".repeat(65) })), /short registry-safe code/u);
});

test("accepts frozen/null-prototype own data and non-enumerable allowed fields", () => {
  const value = Object.assign(Object.create(null) as object, evidence()) as AiGateEvidence;
  Object.defineProperty(value, "action", { value: "review_check", enumerable: false });
  strictEqual(toVistaEventInput(Object.freeze(value)).action, "gate:review_check");
});

test("rejects custom/hostile prototypes and own accessors without invoking them", () => {
  let getterCalls = 0;
  const prototype = Object.defineProperty({}, "action", { get(): never { getterCalls += 1; throw new Error("secret"); } });
  const inherited = Object.assign(Object.create(prototype) as object, { result: "ok" }) as AiGateEvidence;
  expectProtocolError(() => toVistaEventInput(inherited), /custom prototype/u);
  strictEqual(getterCalls, 0);
  const customOwn = evidence();
  Object.setPrototypeOf(customOwn, prototype);
  expectProtocolError(() => toVistaEventInput(customOwn), /custom prototype/u);
  const accessor = evidence();
  Object.defineProperty(accessor, "action", { get(): never { getterCalls += 1; throw new Error("secret"); }, enumerable: true });
  expectProtocolError(() => toVistaEventInput(accessor), /data fields/u);
  strictEqual(getterCalls, 0);
});

test("rejects all Proxy values before any trap can execute", () => {
  let trapCalls = 0;
  const hostile = (): never => { trapCalls += 1; throw new Error("private-trap-error"); };
  const proxy = new Proxy(evidence(), {
    get: hostile,
    ownKeys: hostile,
    getOwnPropertyDescriptor: hostile,
    getPrototypeOf: hostile,
  });
  expectProtocolError(() => toVistaEventInput(proxy), /plain data object/u);
  strictEqual(trapCalls, 0);
  const revoked = Proxy.revocable(evidence(), {});
  revoked.revoke();
  expectProtocolError(() => toVistaEventInput(revoked.proxy), /plain data object/u);
  const nested = new Proxy({}, { get: hostile });
  expectProtocolError(() => toVistaEventInput(evidence({ receipt_ref: nested })), /must be a string/u);
  strictEqual(trapCalls, 0);
});

test("rejects other non-data inputs and emits fixed errors without exposing their values", () => {
  for (const value of [null, [], new Date(), 123, "raw-private-content", () => undefined]) {
    expectProtocolError(() => toVistaEventInput(value as unknown as AiGateEvidence), /plain data object|custom prototype/u);
  }
  throws(
    () => toVistaEventInput(evidence({ "raw-private-property": "raw-private-content" })),
    (error: unknown) => error instanceof VistaProtocolError && !error.message.includes("raw-private"),
  );
});

test("boundary rejection never calls the emitter store", async () => {
  let appendCalls = 0;
  const store = { async append(): Promise<void> { appendCalls += 1; } };
  await rejects(() => emitAiGateEvidence(evidence({ pr_body: "raw-private-content" }), { store }), VistaProtocolError);
  strictEqual(appendCalls, 0);
});

test("mock emission retains safe metadata, refs, and core-added identity", async () => {
  let persisted: VistaEvent | undefined;
  const store = { async append(event: VistaEvent): Promise<void> { persisted = event; } };
  const event = await emitAiGateEvidence(evidence({ status: "success", receipt_ref: "receipt-1", lane: "P1", head_sha: SOURCE_SHA }), { store, seq: 0, now: 123 });
  strictEqual(event?.step_id, "run-ai-gate_s0");
  strictEqual(event?.ts, 123);
  strictEqual(event?.vista_version, "0.1.0");
  strictEqual(isVistaEvent(event), true);
  deepStrictEqual(persisted, event);
  deepStrictEqual(gateStats(event ?? {}), { lane: "P1", head_sha: SOURCE_SHA, source_sha: SOURCE_SHA, sha_relation: "match" });
  strictEqual(emitAiGateObservation, emitAiGateEvidence);
});

test("emission and EventStore round-trip preserve an explicit mismatch without raw data", async () => {
  const baseDir = await mkdtemp(join(tmpdir(), "pi-vista-ai-gate-"));
  try {
    const store = new EventStore({ baseDir });
    const event = await emitAiGateEvidence(evidence({ status: "success", head_sha: OTHER_SHA, reason_code: "ci_observed", review_hash: "review-1", required: false }), { store, seq: 0, now: 123 });
    deepStrictEqual(await store.readRun("run-ai-gate"), [event]);
    strictEqual(event?.result, "unknown");
    strictEqual(event?.source_sha, undefined);
    strictEqual(gateStats(event ?? {})?.sha_relation, "mismatch");
    const jsonl = await readFile(join(baseDir, "runs", "run-ai-gate", "events.jsonl"), "utf8");
    strictEqual(jsonl.includes(OTHER_SHA), true);
    strictEqual(jsonl.includes(SOURCE_SHA), true);
    strictEqual(jsonl.includes("raw-private-content"), false);
  } finally {
    await rm(baseDir, { recursive: true, force: true });
  }
});

test("store failures are fail-open without changing the observed result", async () => {
  const failingStore = { async append(): Promise<void> { throw new Error("private-store-error"); } };
  let event: VistaEvent | undefined;
  await doesNotReject(async () => {
    event = await emitAiGateEvidence(evidence({ status: "failure" }), { store: failingStore, seq: 1, now: 124 });
  });
  strictEqual(event?.result, "failed");
});

test("a hanging store is bounded by the core fail-open persistence timeout", async () => {
  const hangingStore = { append(): Promise<void> { return new Promise(() => undefined); } };
  const event = await emitAiGateEvidence(evidence({ status: "success" }), { store: hangingStore, persistTimeoutMs: 5, seq: 2, now: 125 });
  strictEqual(event?.result, "ok");
});
