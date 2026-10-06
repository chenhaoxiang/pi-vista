import { deepStrictEqual, doesNotReject, rejects, strictEqual, throws } from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import process from "node:process";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { emitVistaEvent, EventStore, isVistaEvent, redactAll, VistaProtocolError, type VistaEvent } from "@pi-vista/core";
import {
  emitAiGateEvidence,
  emitAiGateObservation,
  toVistaEventInput,
  type AiGateEmitOptions,
  type AiGateEvidence,
} from "./index.js";

const SOURCE_SHA = "0123456789abcdef0123456789abcdef01234567";
const OTHER_SHA = "fedcba9876543210fedcba9876543210fedcba98";
const MISMATCH_OUTCOMES = [
  ["result", "ok", "unknown"],
  ["result", "blocked", "unknown"],
  ["result", "failed", "failed"],
  ["result", "unknown", "unknown"],
  ["result", "abstain", "unknown"],
  ["status", "pending", "unknown"],
  ["status", "success", "unknown"],
  ["status", "failure", "failed"],
  ["status", "cancelled", "failed"],
  ["status", "skipped", "unknown"],
  ["status", "neutral", "unknown"],
] as const;
const REF_FIELDS = ["review_hash", "escalation_hash", "receipt_ref", "artifact_ref"] as const;
const FINE_GRAINED_PAT_TEXT = [16, 82].flatMap((length) => {
  const token = `github_pat_${"A".repeat(length)}`;
  return [token, `receipt_${token}`, `review_${token}`, `artifact-${token}`, `safe${token}-ref`, `RECEIPT_${token.toUpperCase()}`];
});
const TOKEN_LIKE_TEXT = [
  ...FINE_GRAINED_PAT_TEXT,
  ...[
    `ghp_${"A".repeat(36)}`,
    `sk-${"A".repeat(36)}`,
    `xoxb-${"A".repeat(24)}`,
    `eyJ${"A".repeat(12)}.${"B".repeat(12)}.${"C".repeat(12)}`,
  ].flatMap((token) => [token, `receipt_${token}`, `review_${token}`, `artifact-${token}`, `safe${token}-ref`]),
  `artifact_token-${"A".repeat(36)}`,
  `RECEIPT_GHP_${"A".repeat(36)}`,
];
const UNSAFE_REFS = [
  ...TOKEN_LIKE_TEXT,
  "https://example.test/receipt?token=secret",
  "https://example.test/receipt?%61ccess_token=secret",
  `https://example.test/receipt?ref=receipt_%67%68%70_${"A".repeat(36)}`,
  "https://example.test/receipt?%2561ccess%255Ftoken=secret",
  "receipt?%61pi%5Fkey=private-value", "receipt%3Ftoken%3Dprivate-value",
  "https://user:pass@example.test/receipt",
  "https://example.test/receipt#secret",
  "PR body with untrusted text", "CI log: failure at line 1",
  "receipt_credential-123", "receipt_bearer-123", "receipt_cookie-123",
  "review_private-key-123", "artifact_API_key-123", "artifact_secret-123",
  "ghp_1234567890abcdef", "sk-1234567890abcdef", "session_cookie", "token-123",
  "/private/artifact.json", "C:\\private\\artifact.json", "./artifact.json", "../receipt",
  "git status", "rm -rf /private", "pwd", "$(whoami)", "receipt\nraw", "receipt%2Fprivate", "",
];

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

const UNSAFE_IDENTITY_TEXT = [
  ...TOKEN_LIKE_TEXT,
  ...["credential", "token", "bearer", "cookie", "private-key", "API-key", "secret"].flatMap((label) => [
    `${label}-123`, `receipt_${label}-123`,
  ]),
];

function implicitEvidence(): AiGateEvidence {
  const value = evidence();
  delete value.run_id;
  return value;
}

async function withRunEnvironment(value: string | undefined, callback: () => Promise<void>): Promise<void> {
  const environment = process.env;
  const original = Object.getOwnPropertyDescriptor(environment, "VISTA_RUN_ID");
  if (value === undefined) delete environment.VISTA_RUN_ID;
  else environment.VISTA_RUN_ID = value;
  try {
    await callback();
  } finally {
    if (original === undefined) delete environment.VISTA_RUN_ID;
    else Object.defineProperty(environment, "VISTA_RUN_ID", original);
  }
  deepStrictEqual(Object.getOwnPropertyDescriptor(environment, "VISTA_RUN_ID"), original);
}

async function withEnvironmentDescriptor(descriptor: PropertyDescriptor, callback: () => Promise<void>): Promise<void> {
  const original = Object.getOwnPropertyDescriptor(process, "env");
  if (original === undefined) throw new Error("expected process environment descriptor");
  Object.defineProperty(process, "env", { configurable: true, ...descriptor });
  try {
    await callback();
  } finally {
    Object.defineProperty(process, "env", original);
  }
}

async function adapterFixtureDirectory(): Promise<string> {
  const baseDir = fileURLToPath(new URL("../../../tmp/", import.meta.url));
  await mkdir(baseDir, { recursive: true });
  return mkdtemp(join(baseDir, "ai-gate-adapter-tests-"));
}

async function directorySnapshot(baseDir: string): Promise<Record<string, string>> {
  const snapshot: Record<string, string> = {};
  async function visit(directory: string, prefix: string): Promise<void> {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const key = `${prefix}${entry.name}`;
      if (entry.isDirectory()) {
        snapshot[`${key}/`] = "directory";
        await visit(join(directory, entry.name), `${key}/`);
      } else {
        snapshot[key] = (await readFile(join(directory, entry.name))).toString("hex");
      }
    }
  }
  await visit(baseDir, "");
  return snapshot;
}

function valueFreeProtocolError(value: string): (error: unknown) => boolean {
  return (error: unknown) => error instanceof VistaProtocolError && error.code === "VISTA_PROTOCOL_ERROR" && !error.message.includes(value);
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
  deepStrictEqual(gateStats(mapped), { head_sha: OTHER_SHA, source_sha: SOURCE_SHA, sha_relation: "mismatch", owner_result: "ok" });
  strictEqual(toVistaEventInput(evidence({ head_sha: OTHER_SHA })).reason_code, "sha_mismatch");
  strictEqual(toVistaEventInput(evidence({ head_sha: OTHER_SHA, result: "failed" })).result, "failed");
  strictEqual(toVistaEventInput(evidence({ head_sha: "b".repeat(64), status: "success" })).result, "unknown");
});

test("SHA mismatch retains every owner result/status enum through core redaction without authorization", () => {
  for (const [field, ownerValue, result] of MISMATCH_OUTCOMES) {
    for (const [source_sha, head_sha] of [[SOURCE_SHA, OTHER_SHA], ["a".repeat(64), "b".repeat(64)]]) {
      const mapped = toVistaEventInput(evidence({ [field]: ownerValue, source_sha, head_sha, passed: true, required: false }));
      strictEqual(mapped.result, result, `${field}:${ownerValue}`);
      strictEqual(Object.hasOwn(mapped, "source_sha"), false);
      strictEqual(Object.hasOwn(mapped, "head_sha"), false);
      deepStrictEqual(gateStats(mapped), {
        passed: 1, required: 0, head_sha, source_sha, sha_relation: "mismatch", [`owner_${field}`]: ownerValue,
      });
      deepStrictEqual(redactAll(mapped), mapped);
      strictEqual(mapped.artifact_refs?.some((artifact) => Object.hasOwn(artifact, "verified")), false);
    }
  }
});

test("SHA mismatch rejects free-text outcomes and caller-supplied owner metadata before the store", async () => {
  let appendCalls = 0;
  const store = { async append(): Promise<void> { appendCalls += 1; } };
  for (const field of ["result", "status", "owner_result", "owner_status"]) {
    const invalidEvidence = evidence({ head_sha: OTHER_SHA, [field]: "raw-private-content PASS authorized" });
    expectProtocolError(() => toVistaEventInput(invalidEvidence), /VistaResult|status must be|unsupported field/u);
    await rejects(() => emitAiGateEvidence(invalidEvidence, { store }), VistaProtocolError);
  }
  strictEqual(appendCalls, 0);
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

test("rejects wrapped tokens/credentials, encoded URL query secrets, paths, commands, and content in refs", () => {
  for (const field of REF_FIELDS) {
    for (const value of UNSAFE_REFS) {
      expectProtocolError(() => toVistaEventInput(evidence({ [field]: value })), /safe opaque|sanitized metadata/u);
    }
  }
});

test("embedded token signatures reject at every retained-string entry before any mock store call", async () => {
  let appendCalls = 0;
  const store = { async append(): Promise<void> { appendCalls += 1; } };
  const fields = [
    ...REF_FIELDS, "action", "check_type", "run_id", "session_id", "trace_id", "repo",
    "reason_code", "decision", "verdict", "model_id", "reviewer_id",
  ];
  for (const field of fields) {
    for (const value of TOKEN_LIKE_TEXT) {
      const invalidEvidence = evidence({ [field]: value });
      throws(() => toVistaEventInput(invalidEvidence), (error: unknown) =>
        error instanceof VistaProtocolError && !error.message.includes(value));
      await rejects(() => emitAiGateEvidence(invalidEvidence, { store }), (error: unknown) =>
        error instanceof VistaProtocolError && !error.message.includes(value));
    }
  }
  strictEqual(appendCalls, 0);
});

test("fine-grained PAT signatures reject even when compact variants fit every short-field grammar", () => {
  for (const field of ["repo", "reason_code", "decision", "verdict", ...REF_FIELDS, "action", "check_type", "run_id", "session_id", "trace_id", "model_id", "reviewer_id"]) {
    for (const value of FINE_GRAINED_PAT_TEXT.filter((token) => token.length <= 64)) {
      expectProtocolError(() => toVistaEventInput(evidence({ [field]: value })), /sanitized metadata/u);
    }
  }
});

test("preserves safe opaque IDs and hexadecimal hashes across ref fields", () => {
  for (const field of REF_FIELDS) {
    for (const value of ["receipt-123", "review_abc123", "artifact.release-42", "task-123", SOURCE_SHA, "e".repeat(64)]) {
      const mapped = toVistaEventInput(evidence({ [field]: value }));
      strictEqual(mapped.artifact_refs?.[0]?.ref, value);
      deepStrictEqual(redactAll(mapped), mapped);
    }
  }
});

test("wrapped token and credential refs never reach or persist in EventStore", async () => {
  const baseDir = await adapterFixtureDirectory();
  try {
    const store = new EventStore({ baseDir });
    const safeEvent = await emitAiGateEvidence(evidence({ receipt_ref: "receipt-safe-1" }), { store, seq: 0, now: 123 });
    const eventsPath = join(baseDir, "runs", "run-ai-gate", "events.jsonl");
    const before = await readFile(eventsPath, "utf8");
    const beforeDirectory = await directorySnapshot(baseDir);
    for (const field of REF_FIELDS) {
      for (const value of UNSAFE_REFS) {
        await rejects(() => emitAiGateEvidence(evidence({ [field]: value }), { store }), VistaProtocolError);
      }
    }
    strictEqual(await readFile(eventsPath, "utf8"), before);
    deepStrictEqual(await directorySnapshot(baseDir), beforeDirectory);
    deepStrictEqual(await store.readRun("run-ai-gate"), [safeEvent]);
    deepStrictEqual(await store.listRuns(), ["run-ai-gate"]);
  } finally {
    await rm(baseDir, { recursive: true, force: true });
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

test("emission and EventStore round-trip preserve every mismatch owner outcome without raw data", async () => {
  const baseDir = await adapterFixtureDirectory();
  try {
    const store = new EventStore({ baseDir });
    const events: VistaEvent[] = [];
    for (const [field, ownerValue, result] of MISMATCH_OUTCOMES) {
      const event = await emitAiGateEvidence(evidence({
        [field]: ownerValue, head_sha: OTHER_SHA, reason_code: "ci_observed", review_hash: "review-1", passed: true, required: false,
      }), { store, seq: events.length, now: 123 });
      strictEqual(isVistaEvent(event), true);
      if (event === undefined) throw new Error("expected emitted event");
      strictEqual(event.result, result);
      strictEqual(Object.hasOwn(event, "source_sha"), false);
      strictEqual(event.reason_code, "ci_observed");
      deepStrictEqual(gateStats(event), {
        passed: 1, required: 0, head_sha: OTHER_SHA, source_sha: SOURCE_SHA, sha_relation: "mismatch", [`owner_${field}`]: ownerValue,
      });
      strictEqual(event.artifact_refs?.some((artifact) => Object.hasOwn(artifact, "verified")), false);
      deepStrictEqual(redactAll(event), event);
      events.push(event);
    }
    deepStrictEqual(await store.readRun("run-ai-gate"), events);
    const eventsPath = join(baseDir, "runs", "run-ai-gate", "events.jsonl");
    const jsonl = await readFile(eventsPath, "utf8");
    deepStrictEqual(jsonl.trim().split("\n").map((line) => JSON.parse(line) as unknown), events);
    for (const field of ["result", "status", "owner_result", "owner_status"]) {
      await rejects(() => emitAiGateEvidence(evidence({
        head_sha: OTHER_SHA, [field]: "raw-private-content PASS authorized",
      }), { store }), VistaProtocolError);
    }
    strictEqual(await readFile(eventsPath, "utf8"), jsonl);
    strictEqual(jsonl.includes(OTHER_SHA), true);
    strictEqual(jsonl.includes(SOURCE_SHA), true);
    strictEqual(jsonl.includes("raw-private-content"), false);
    strictEqual(jsonl.includes("PASS"), false);
    strictEqual(jsonl.includes("verified"), false);
    strictEqual(jsonl.includes("authorized"), false);
  } finally {
    await rm(baseDir, { recursive: true, force: true });
  }
});

test("explicit option identities reject bare/wrapped tokens and credential labels before the mock store", async () => {
  let appendCalls = 0;
  const store = { async append(): Promise<void> { appendCalls += 1; } };
  for (const value of UNSAFE_IDENTITY_TEXT) {
    await rejects(() => emitAiGateEvidence(implicitEvidence(), { runId: value, store }), {
      name: "VistaProtocolError", code: "VISTA_PROTOCOL_ERROR", message: "ai-gate evidence options.runId must contain only sanitized metadata",
    });
    for (const stepId of [value, `run-ai-gate_${value}`]) {
      await rejects(() => emitAiGateEvidence(evidence(), { stepId, store }), {
        name: "VistaProtocolError", code: "VISTA_PROTOCOL_ERROR", message: "ai-gate evidence options.stepId must contain only sanitized metadata",
      });
    }
  }
  for (const field of ["runId", "stepId"]) {
    for (const value of [undefined, null, 1, "", ".", "..", "/private/run", "a".repeat(129)]) {
      await rejects(() => emitAiGateEvidence(implicitEvidence(), { [field]: value, store } as AiGateEmitOptions), VistaProtocolError);
    }
  }
  await rejects(() => emitAiGateEvidence(evidence(), { runId: "receipt_token-123", store }), VistaProtocolError);
  strictEqual(appendCalls, 0);
});

test("explicit unsafe option identities leave real EventStore directories and file bytes unchanged", async () => {
  const baseDir = await adapterFixtureDirectory();
  try {
    const eventStore = new EventStore({ baseDir });
    let appendCalls = 0;
    const store = { async append(event: VistaEvent): Promise<void> { appendCalls += 1; await eventStore.append(event); } };
    for (const value of UNSAFE_IDENTITY_TEXT) {
      await rejects(() => emitAiGateEvidence(implicitEvidence(), { runId: value, store }), valueFreeProtocolError(value));
      await rejects(() => emitAiGateEvidence(evidence(), { stepId: `run-ai-gate_${value}`, store }), valueFreeProtocolError(value));
    }
    deepStrictEqual(await directorySnapshot(baseDir), {});
    strictEqual(appendCalls, 0);
    const baseline = await emitAiGateEvidence(evidence(), { store, seq: 0, now: 123 });
    const before = await directorySnapshot(baseDir);
    for (const value of UNSAFE_IDENTITY_TEXT) {
      await rejects(() => emitAiGateEvidence(implicitEvidence(), { runId: value, store }), valueFreeProtocolError(value));
      await rejects(() => emitAiGateEvidence(evidence(), { stepId: `run-ai-gate_${value}`, store }), valueFreeProtocolError(value));
    }
    strictEqual(appendCalls, 1);
    deepStrictEqual(await directorySnapshot(baseDir), before);
    deepStrictEqual(await eventStore.readRun("run-ai-gate"), [baseline]);
  } finally {
    await rm(baseDir, { recursive: true, force: true });
  }
});

test("unsafe VISTA_RUN_ID values use a shared safe fallback without retaining or rewriting the environment", async () => {
  const baseDir = await adapterFixtureDirectory();
  try {
    const store = new EventStore({ baseDir });
    let sharedRunId: string | undefined;
    for (const value of [...UNSAFE_IDENTITY_TEXT, "", "/private/run", "a".repeat(129)]) {
      await withRunEnvironment(value, async () => {
        const first = await emitAiGateEvidence(implicitEvidence(), { store, now: 123 });
        const second = await emitAiGateEvidence(implicitEvidence(), { store, now: 123 });
        strictEqual(isVistaEvent(first), true);
        strictEqual(isVistaEvent(second), true);
        if (first === undefined || second === undefined) throw new Error("expected fallback events");
        strictEqual(/^vr_[a-z0-9]+_[0-9a-f]{8}$/u.test(first.run_id), true);
        if (sharedRunId === undefined) sharedRunId = first.run_id;
        strictEqual(first.run_id, sharedRunId);
        strictEqual(second.run_id, first.run_id);
        const firstSequence = Number.parseInt(first.step_id.slice(`${first.run_id}_s`.length), 36);
        strictEqual(second.step_id, `${first.run_id}_s${(firstSequence + 1).toString(36)}`);
        strictEqual(Object.getOwnPropertyDescriptor(process.env, "VISTA_RUN_ID")?.value, value);
        const jsonl = await readFile(join(baseDir, "runs", first.run_id, "events.jsonl"), "utf8");
        if (value.length > 0) strictEqual(jsonl.includes(value), false);
      });
    }
    deepStrictEqual(await store.listRuns(), [sharedRunId]);
  } finally {
    await rm(baseDir, { recursive: true, force: true });
  }
});

test("safe evidence/options/environment priority and explicit step binding are preserved", async () => {
  const store = { async append(): Promise<void> {} };
  await withRunEnvironment("run-priority-env", async () => {
    const fromEvidence = await emitAiGateEvidence(evidence({ run_id: "run-priority-evidence" }), {
      runId: "run-priority-option", stepId: "run-priority-evidence_s2", seq: 2, now: 123, store,
    });
    strictEqual(fromEvidence?.run_id, "run-priority-evidence");
    strictEqual(fromEvidence?.step_id, "run-priority-evidence_s2");
    const fromOption = await emitAiGateEvidence(implicitEvidence(), { runId: "run-priority-option", store, seq: 3, now: 123 });
    strictEqual(fromOption?.run_id, "run-priority-option");
    strictEqual(fromOption?.step_id, "run-priority-option_s3");
    const fromEnvironment = await emitAiGateEvidence(implicitEvidence(), { store, seq: 4, now: 123 });
    strictEqual(fromEnvironment?.run_id, "run-priority-env");
    strictEqual(fromEnvironment?.step_id, "run-priority-env_s4");
    await rejects(() => emitAiGateEvidence(evidence({ run_id: "run-priority-evidence" }), {
      runId: "run-priority-option", stepId: "run-priority-option_s2", store,
    }), VistaProtocolError);
    await rejects(() => emitAiGateEvidence(evidence(), { stepId: "run-ai-gate_", store }), VistaProtocolError);
  });
  await withRunEnvironment("receipt_token-123", async () => {
    strictEqual((await emitAiGateEvidence(evidence(), { store }))?.run_id, "run-ai-gate");
    strictEqual((await emitAiGateEvidence(implicitEvidence(), { runId: "run-safe-option", store }))?.run_id, "run-safe-option");
  });
});

test("absent environment keeps one generated implicit run and contiguous core-owned default steps", async () => {
  const store = { async append(): Promise<void> {} };
  await withRunEnvironment(undefined, async () => {
    const first = await emitAiGateEvidence(implicitEvidence(), { store, now: 123 });
    const second = await emitAiGateEvidence(implicitEvidence(), { store, now: 123 });
    strictEqual(isVistaEvent(first), true);
    strictEqual(isVistaEvent(second), true);
    if (first === undefined || second === undefined) throw new Error("expected generated events");
    strictEqual(first.run_id, second.run_id);
    const sequence = Number.parseInt(first.step_id.slice(`${first.run_id}_s`.length), 36);
    strictEqual(second.step_id, `${first.run_id}_s${(sequence + 1).toString(36)}`);
    strictEqual(Object.hasOwn(process.env, "VISTA_RUN_ID"), false);
  });
  await withRunEnvironment("run-core-shared-sequence", async () => {
    const fromCore = { run_id: "run-core-shared-sequence", component: "gate", action: "gate:ci_check", result: "ok" } as const;
    strictEqual((await emitVistaEvent(fromCore, { store, seq: 40, now: 123 }))?.step_id, "run-core-shared-sequence_s14");
    strictEqual((await emitAiGateEvidence(implicitEvidence(), { store, now: 123 }))?.step_id, "run-core-shared-sequence_s15");
    strictEqual((await emitVistaEvent(fromCore, { store, now: 123 }))?.step_id, "run-core-shared-sequence_s16");
    strictEqual((await emitAiGateEvidence(implicitEvidence(), { store, now: 123 }))?.step_id, "run-core-shared-sequence_s17");
  });
});

test("options reject accessors, custom/inherited prototypes, and Proxies without reads or append calls", async () => {
  let reads = 0;
  let appendCalls = 0;
  const hostile = (): never => { reads += 1; throw new Error("raw-private-content"); };
  const store = { async append(): Promise<void> { appendCalls += 1; } };
  for (const field of ["runId", "stepId", "baseDir", "clock", "store", "seq", "now", "persistTimeoutMs"]) {
    const options = { store } as AiGateEmitOptions;
    Object.defineProperty(options, field, { get: hostile, enumerable: true });
    await rejects(() => emitAiGateEvidence(implicitEvidence(), options), valueFreeProtocolError("raw-private-content"));
  }
  const inherited = Object.assign(Object.create(Object.defineProperty({}, "runId", { get: hostile })) as object, { store });
  await rejects(() => emitAiGateEvidence(implicitEvidence(), inherited), VistaProtocolError);
  const proxy = new Proxy({ store }, { get: hostile, ownKeys: hostile, getOwnPropertyDescriptor: hostile, getPrototypeOf: hostile, has: hostile });
  await rejects(() => emitAiGateEvidence(implicitEvidence(), proxy), VistaProtocolError);
  const revoked = Proxy.revocable({ store }, {});
  revoked.revoke();
  await rejects(() => emitAiGateEvidence(implicitEvidence(), revoked.proxy), VistaProtocolError);
  const nested = new Proxy({}, { get: hostile });
  await rejects(() => emitAiGateEvidence(implicitEvidence(), { runId: nested, store } as unknown as AiGateEmitOptions), VistaProtocolError);
  for (const key of ["runId", "stepId", "baseDir", "clock", "seq", "now", "persistTimeoutMs"]) {
    const original = Object.getOwnPropertyDescriptor(Object.prototype, key);
    Object.defineProperty(Object.prototype, key, { configurable: true, get: hostile });
    try {
      await rejects(() => emitAiGateEvidence(implicitEvidence(), { store }), VistaProtocolError);
    } finally {
      if (original === undefined) Reflect.deleteProperty(Object.prototype, key);
      else Object.defineProperty(Object.prototype, key, original);
    }
  }
  for (const options of [null, [], 1, "raw-private-content", new Date(), { store, run_id: "run-other" }, { store, unknown: 1 }, { store, [Symbol("raw-private-content")]: 1 }]) {
    await rejects(() => emitAiGateEvidence(implicitEvidence(), options as AiGateEmitOptions), valueFreeProtocolError("raw-private-content"));
  }
  strictEqual(reads, 0);
  strictEqual(appendCalls, 0);
});

test("hostile environment descriptors and Proxies fall back without getters or traps", async () => {
  let reads = 0;
  const hostile = (): never => { reads += 1; throw new Error("raw-private-content"); };
  const store = { async append(): Promise<void> {} };
  const proxy = new Proxy({}, { get: hostile, getOwnPropertyDescriptor: hostile });
  const revoked = Proxy.revocable({}, {});
  revoked.revoke();
  const environments = [
    Object.defineProperty({}, "VISTA_RUN_ID", { get: hostile }),
    Object.create(Object.defineProperty({}, "VISTA_RUN_ID", { get: hostile })) as object,
    proxy, revoked.proxy,
  ];
  for (const value of environments) {
    await withEnvironmentDescriptor({ value }, async () => {
      const event = await emitAiGateEvidence(implicitEvidence(), { store, now: 123 });
      strictEqual(/^vr_[a-z0-9]+_[0-9a-f]{8}$/u.test(event?.run_id ?? ""), true);
      strictEqual(isVistaEvent(event), true);
    });
  }
  await withEnvironmentDescriptor({ get: hostile }, async () => {
    strictEqual(isVistaEvent(await emitAiGateEvidence(implicitEvidence(), { store, now: 123 })), true);
    strictEqual((await emitAiGateEvidence(evidence(), { store }))?.run_id, "run-ai-gate");
    strictEqual((await emitAiGateEvidence(implicitEvidence(), { runId: "run-own-option", store }))?.run_id, "run-own-option");
  });
  const safeEnvironment = Object.freeze(Object.defineProperty(Object.create(null) as object, "VISTA_RUN_ID", {
    value: "run-own-data-environment", enumerable: false,
  }));
  await withEnvironmentDescriptor({ value: safeEnvironment }, async () => {
    strictEqual((await emitAiGateEvidence(implicitEvidence(), { store }))?.run_id, "run-own-data-environment");
  });
  strictEqual(reads, 0);
});

test("options own-data snapshot retains legitimate store/clock/now callbacks and does not persist baseDir", async () => {
  const baseDir = await adapterFixtureDirectory();
  try {
    let clockCalls = 0;
    const options = Object.assign(Object.create(null) as AiGateEmitOptions, {
      baseDir, clock: () => { clockCalls += 1; return 123; }, seq: 0,
    });
    Object.defineProperty(options, "runId", { value: "run-safe-options", enumerable: false });
    Object.defineProperty(options, "stepId", { value: "run-safe-options_s0", enumerable: false });
    const first = await emitAiGateEvidence(implicitEvidence(), Object.freeze(options));
    strictEqual(first?.ts, 123);
    strictEqual(clockCalls, 1);
    strictEqual(first?.step_id, "run-safe-options_s0");
    const jsonl = await readFile(join(baseDir, "runs", "run-safe-options", "events.jsonl"), "utf8");
    strictEqual(jsonl.includes(baseDir), false);
    strictEqual(jsonl.includes("baseDir"), false);
    strictEqual(jsonl.includes("clock"), false);
    deepStrictEqual(await new EventStore({ baseDir }).readRun("run-safe-options"), [first]);
    await withRunEnvironment("run-safe-clock-env", async () => {
      let appendCalls = 0;
      const mutable: AiGateEmitOptions = {
        runId: "run-snapshot", stepId: "run-snapshot_s5", seq: 5,
        store: { async append(): Promise<void> { appendCalls += 1; } },
        now: () => {
          mutable.runId = "receipt_token-123";
          mutable.stepId = "receipt_token-123_s5";
          process.env.VISTA_RUN_ID = "receipt_token-123";
          return 124;
        },
      };
      const event = await emitAiGateEvidence(implicitEvidence(), mutable);
      strictEqual(event?.run_id, "run-snapshot");
      strictEqual(event?.step_id, "run-snapshot_s5");
      strictEqual(event?.ts, 124);
      strictEqual(appendCalls, 1);
    });
    for (const seq of [-1, NaN, 1.5]) {
      await rejects(() => emitAiGateEvidence(implicitEvidence(), { runId: "run-safe-options", baseDir, seq }), VistaProtocolError);
    }
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
