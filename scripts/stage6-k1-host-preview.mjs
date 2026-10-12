import { types } from "node:util";
import { createSyntheticSdkHost } from "./stage6-synthetic-sdk-host.mjs";
import { PAIR_CASES, pairedOrder } from "./paired-evaluation-data.mjs";

const ADMISSION_KEYS = ["status", "reason_code", "model_calls", "started_model_calls", "verification", "authorization", "executable"];
const ROW_KEYS = ["case_id", "arm", "fault", "failure_origin", "outcome", "decision_outcome", "decision_parsed", "execution_stop", "pretransport_attempts", "intercepted_fetch", "inspector_executions", "decision_executions", "message_end_events", "tool_execution_end_events", "abort_signal_observed", "late_sse_body_sent", "task_digest", "guidance_scope", "guidance_digest", "k1_admission", "request_contract_checks"];
const RECEIPT_KEYS = ["schema", "status", "reason_code", "integrity_status", "evaluation_status", "observed_pre_admission_calls", "pretransport_attempts", "max_requests", "profile_before_digest", "profile_after_digest", "drift", "provenance_before_digest", "provenance_after_digest", "verification", "authorization", "executable"];
const SAFE_WINDOW_REASONS = [null, "stage6-window-deadline", "stage6-profile-unavailable", "stage6-provenance-unavailable", "protected-profile-drift", "volatile-profile-drift-unknown-attribution", "stage6-provenance-drift", "stage6-shutdown-failed"];
const HEX = /^[a-f0-9]{64}$/u;
const refuse = () => { throw Error("stage6-k1-preview-refused"); };
function own(input, keys) {
  if (input === null || typeof input !== "object" || Array.isArray(input) || types.isProxy(input) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(input)) || Reflect.ownKeys(input).length !== keys.length) refuse();
  const output = Object.create(null);
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(input, key);
    if (!descriptor || !Object.hasOwn(descriptor, "value") || descriptor.value === undefined) refuse();
    output[key] = descriptor.value;
  }
  return output;
}
function list(input, count) {
  if (!Array.isArray(input) || types.isProxy(input) || Object.getPrototypeOf(input) !== Array.prototype || input.length !== count || Reflect.ownKeys(input).length !== count + 1) refuse();
  const output = [];
  for (let index = 0; index < count; index++) {
    const descriptor = Object.getOwnPropertyDescriptor(input, String(index));
    if (!descriptor || !Object.hasOwn(descriptor, "value")) refuse();
    output.push(descriptor.value);
  }
  return output;
}
function count(value) { if (!Number.isSafeInteger(value) || value < 0 || value > 1_000_000) refuse(); return value; }
function digest(value, nullable = false) { if (nullable && value === null) return null; if (typeof value !== "string" || !HEX.test(value)) refuse(); return value; }
function source(value) { if (typeof value !== "string" || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u.test(value)) refuse(); return value; }
function safeAdmission(input) {
  const value = own(input, ADMISSION_KEYS);
  if (value.status !== "metadata-admitted" || value.reason_code !== null || value.model_calls !== 0 || value.started_model_calls !== 0 || value.verification !== "metadata-only" || value.authorization !== "none" || value.executable !== false) refuse();
  return Object.freeze({ ...value });
}
export function snapshotK1HostPreviewOptions(input) {
  const value = own(input, ["sdk", "source_sha", "max_requests", "deadline_ms", "prepareK1Plan"]);
  if (typeof value.sdk !== "string" || typeof value.source_sha !== "string" || !Number.isSafeInteger(value.max_requests) || value.max_requests < 1 || value.max_requests > 16 ||
      !Number.isSafeInteger(value.deadline_ms) || value.deadline_ms < 1_000 || value.deadline_ms > 120_000 ||
      typeof value.prepareK1Plan !== "function" || types.isProxy(value.prepareK1Plan)) refuse();
  return Object.freeze(value);
}
/** Project only bounded metadata; never return the callback/raw history/context. */
export function safeK1HostProjection(input) {
  const value = own(input, ["schema", "harness_source_sha", "host_sha256", "sdk_version", "node", "rows", "fresh_agents", "intercepted_fetch", "synthetic_responses", "credential_store_read_attempts", "receipt", "k1_plan", "evaluation_status", "declared_scope", "observation_scope", "authorization", "executable"]);
  if (value.schema !== "stage6-synthetic-sdk-host/1" || value.authorization !== "none" || value.executable !== false || value.evaluation_status !== "not-evaluated" || value.sdk_version !== "1.1.0-fork.1" || typeof value.node !== "string" || !/^v[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}$/u.test(value.node)) refuse();
  const rows = Object.freeze(list(value.rows, 8).map(item => {
    const row = own(item, ROW_KEYS);
    if (!PAIR_CASES.includes(row.case_id) || !["baseline", "guided"].includes(row.arm) || row.fault !== null || row.failure_origin !== null || row.outcome !== "decision-valid" || row.decision_outcome !== "decision-valid" || row.decision_parsed !== true || row.execution_stop !== "toolUse" || row.abort_signal_observed !== false || row.late_sse_body_sent !== false || row.guidance_scope !== (row.arm === "guided" ? "synthetic-LOCAL-fixture-not-actual-history" : "none")) refuse();
    for (const key of ["pretransport_attempts", "intercepted_fetch", "inspector_executions", "decision_executions", "message_end_events", "tool_execution_end_events", "request_contract_checks"]) count(row[key]);
    digest(row.task_digest); digest(row.guidance_digest, row.arm === "baseline");
    return Object.freeze({ case_id: row.case_id, arm: row.arm, outcome: row.outcome, decision_parsed: row.decision_parsed,
      pretransport_attempts: row.pretransport_attempts, intercepted_fetch: row.intercepted_fetch, inspector_executions: row.inspector_executions, decision_executions: row.decision_executions,
      task_digest: row.task_digest, guidance_scope: row.guidance_scope, guidance_digest: row.guidance_digest, request_contract_checks: row.request_contract_checks, k1_admission: safeAdmission(row.k1_admission) });
  }));
  if (new Set(rows.map(row => `${row.case_id}/${row.arm}`)).size !== 8) refuse();
  const receiptValue = own(value.receipt, RECEIPT_KEYS);
  if (receiptValue.schema !== "stage6-pilot-window/1" || receiptValue.status !== "closed" || !SAFE_WINDOW_REASONS.includes(receiptValue.reason_code) || !["unchanged", "unknown"].includes(receiptValue.integrity_status) || receiptValue.evaluation_status !== "not-evaluated" || receiptValue.observed_pre_admission_calls !== 0 || receiptValue.max_requests !== 16 || receiptValue.authorization !== "none" || receiptValue.executable !== false || receiptValue.verification !== "metadata-only") refuse();
  const receipt = Object.freeze({ schema: receiptValue.schema, status: receiptValue.status, reason_code: receiptValue.reason_code, integrity_status: receiptValue.integrity_status,
    pretransport_attempts: count(receiptValue.pretransport_attempts), max_requests: receiptValue.max_requests,
    profile_before_digest: digest(receiptValue.profile_before_digest), profile_after_digest: digest(receiptValue.profile_after_digest, true),
    provenance_before_digest: digest(receiptValue.provenance_before_digest), provenance_after_digest: digest(receiptValue.provenance_after_digest, true),
    evaluation_status: "not-evaluated", authorization: "none", executable: false });
  const k1Plan = Object.freeze(list(value.k1_plan, 8).map(item => {
    const row = own(item, ["case_id", "arm", "history_status", "history_digest", "context_digest", "admission"]);
    if (!PAIR_CASES.includes(row.case_id) || !["baseline", "guided"].includes(row.arm) || row.history_status !== (row.arm === "baseline" ? "none" : "historical-only")) refuse();
    if (row.arm === "baseline" && (row.history_digest !== null || row.context_digest !== null)) refuse();
    digest(row.history_digest, row.arm === "baseline"); digest(row.context_digest, row.arm === "baseline");
    return Object.freeze({ ...row, admission: safeAdmission(row.admission) });
  }));
  if (new Set(k1Plan.map(row => `${row.case_id}/${row.arm}`)).size !== 8) refuse();
  for (const row of rows) {
    const planned = k1Plan.find(item => item.case_id === row.case_id && item.arm === row.arm);
    if (!planned || planned.context_digest !== row.guidance_digest) refuse();
    for (const key of ADMISSION_KEYS) if (row.k1_admission[key] !== planned.admission[key]) refuse();
  }
  const scope = own(value.declared_scope, ["real_model_calls", "bank_calls", "credential_bytes_read"]);
  if (scope.real_model_calls !== 0 || scope.bank_calls !== 0 || scope.credential_bytes_read !== false) refuse();
  const passed = rows.every(row => row.inspector_executions === 1 && row.decision_executions === 1 && row.pretransport_attempts === 2 && row.intercepted_fetch === 2 && row.request_contract_checks === 2) && receipt.integrity_status === "unchanged" && receipt.reason_code === null && receipt.profile_before_digest === receipt.profile_after_digest && receipt.provenance_before_digest === receipt.provenance_after_digest && receipt.pretransport_attempts === 16 && value.fresh_agents === 8 && value.intercepted_fetch === 16 && value.synthetic_responses === 16;
  return Object.freeze({ schema: "stage6-k1-host-preview/1", status: passed ? "passed" : "unknown", rows, k1_plan: k1Plan, receipt,
    fresh_agents: count(value.fresh_agents), intercepted_fetch: count(value.intercepted_fetch), synthetic_responses: count(value.synthetic_responses),
    credential_store_read_attempts: count(value.credential_store_read_attempts), harness_source_sha: source(value.harness_source_sha), host_sha256: digest(value.host_sha256), sdk_version: value.sdk_version, node: value.node,
    declared_scope: Object.freeze({ ...scope }),
    observation_scope: value.observation_scope === "synthetic-transport-and-host-counters-not-callback-effects" ? value.observation_scope : refuse(),
    evaluation_status: "not-evaluated", authorization: "none", executable: false });
}
/** Explicit synthetic-only preview: one existing host/window, no second budget. */
export function safeK1RefusalProjection(error, source_sha = null) {
  if (error === null || typeof error !== "object" || types.isProxy(error)) refuse();
  const field = (name, fallback) => {
    const descriptor = Object.getOwnPropertyDescriptor(error, name);
    if (descriptor && !Object.hasOwn(descriptor, "value")) refuse();
    return descriptor ? descriptor.value : fallback;
  };
  const phase = field("k1_phase", null), reason = field("k1_reason_code", null);
  if (!["input", "metadata-admission"].includes(phase) || !["stage6-k1-options-refused", "stage6-k1-input-refused", "stage6-k1-subject-source-mismatch", "stage6-k1-subject-binding-mismatch", "stage6-k1-preparation-timeout", "stage6-k1-plan-capacity-mismatch", "history-mismatch", "provenance-mismatch", "invalid-input"].includes(reason)) refuse();
  const prepared = phase === "metadata-admission";
  if (field("profile_fixture_prepared", null) !== prepared || field("metadata_fixture_prepared", null) !== prepared || field("window_created", null) !== false || field("session_count", null) !== 0 || field("pretransport_attempts", null) !== 0 || field("fetch_count", null) !== 0) refuse();
  const sdk_version = field("sdk_version", null), node = field("node", process.version), admissionInput = field("admission", null);
  if (sdk_version !== null && sdk_version !== "1.1.0-fork.1" || typeof node !== "string" || !/^v[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}$/u.test(node)) refuse();
  let admission = null;
  if (admissionInput !== null) {
    const safe = own(admissionInput, ADMISSION_KEYS);
    if (safe.status !== "refused" || !["history-mismatch", "provenance-mismatch", "invalid-input"].includes(safe.reason_code) || ![0, null].includes(safe.model_calls) || safe.started_model_calls !== 0 || safe.verification !== "metadata-only" || safe.authorization !== "none" || safe.executable !== false) refuse();
    admission = Object.freeze({ ...safe });
  }
  const producingSource = field("harness_source_sha", source_sha), hostDigest = field("host_sha256", null);
  return Object.freeze({ schema: "stage6-k1-host-preview/1", status: "refused", phase, reason_code: reason,
    profile_fixture_prepared: prepared, metadata_fixture_prepared: prepared, broker_observed: prepared,
    window_created: false, session_count: 0, pretransport_attempts: 0, intercepted_fetch: 0,
    k1_admission: admission, harness_source_sha: producingSource === null ? null : source(producingSource), host_sha256: digest(hostDigest, true), sdk_version, node,
    observation_scope: "host-control-flow-not-callback-or-OS-effects", evaluation_status: "not-evaluated", authorization: "none", executable: false });
}
export async function runK1HostPreview(input) {
  const options = snapshotK1HostPreviewOptions(input);
  let host, finished = false;
  try {
    host = await createSyntheticSdkHost({ sdk: options.sdk, source_sha: options.source_sha, max_requests: options.max_requests, deadline_ms: options.deadline_ms }, { prepareK1Plan: options.prepareK1Plan });
    for (const { case_id, arm } of pairedOrder()) await host.runRow(case_id, arm);
    const report = await host.finish(); finished = true; return safeK1HostProjection(report);
  } catch (error) {
    if (!host) {
      const phase = error !== null && typeof error === "object" && !types.isProxy(error) ? Object.getOwnPropertyDescriptor(error, "k1_phase") : null;
      if (phase && Object.hasOwn(phase, "value") && ["input", "metadata-admission"].includes(phase.value)) return safeK1RefusalProjection(error, options.source_sha);
    }
    throw error;
  } finally { if (host && !finished) await host.finish().catch(() => undefined); }
}
