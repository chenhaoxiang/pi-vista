import { types } from "node:util";
import { hasKnownCredential } from "@pi-vista/core";
import { snapshotHistoryContext } from "./stage6-k1-admission.mjs";
import { K1_METRICS_ADAPTER_ID } from "./stage6-k1-metrics-adapter.mjs";
import {
  PUBLIC_1_0_4_CONTRACT,
  validateReadonlyBrokerMetadata,
  validateSdkContractMatch,
} from "./stage6-sdk-provenance.mjs";
import {
  PAIR_HISTORY_DIGEST,
  PAIR_ROUND_BUDGET,
  PAIR_SOURCE_SHA,
  PAIR_TIMEOUT_MS,
} from "./paired-evaluation-data.mjs";

export const K1_READINESS_SCHEMA = "stage6-k1-readiness/1";
export const K1_READINESS_REASON_CODES = Object.freeze([
  "invalid-input",
  "sdk-contract-mismatch",
  "broker-mismatch",
  "subject-mismatch",
  "history-mismatch",
  "current-verifier-not-fresh",
  "model-mismatch",
  "budget-mismatch",
  "metrics-mismatch",
]);
const SHA = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u;
const HEX = /^[a-f0-9]{64}$/u;
const LABEL = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;
const INPUT_KEYS = ["sdk", "broker", "subject", "history", "current_verifier", "model", "budget", "metrics"];
const SUBJECT_KEYS = ["repo", "source_sha", "policy_version", "env_fingerprint"];
const VERIFIER_KEYS = ["fresh", "accepted", "source_sha", "history_digest", "verification", "authorization", "executable"];
const MODEL_KEYS = ["provider", "model", "thinking", "sdk", "tool", "retry_count"];
const BUDGET_KEYS = ["cases", "arms", "fresh_sessions", "max_requests", "max_per_session", "deadline_ms", "retry_count"];
const METRICS_KEYS = ["rows", "source_sha", "adapter", "aggregate", "usage_complete"];
// Copyable trusted-host metadata consistency only: fresh/accepted declarations
// here never restore a verifier handle, authenticate an SDK, grant permission,
// open a window, or constitute measured evaluation. Importing performs no I/O.
const OUTPUT_KEYS = ["schema", "status", "reason_code", "sdk_contract", "subject_source_sha", "history_digest", "context_digest", "provider", "model", "thinking", "budget", "metric_rows", "verification", "authorization", "executable"];
const refuse = reason_code => Object.freeze({
  schema: K1_READINESS_SCHEMA,
  status: "not-ready",
  reason_code,
  sdk_contract: "unknown",
  subject_source_sha: null,
  history_digest: null,
  context_digest: null,
  provider: null,
  model: null,
  thinking: null,
  budget: null,
  metric_rows: null,
  verification: "metadata-only",
  authorization: "none",
  executable: false,
});
function own(value, keys) {
  if (types.isProxy(value) || value === null || typeof value !== "object" || Array.isArray(value) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(value)) || Reflect.ownKeys(value).length !== keys.length) {
    throw Error("invalid-input");
  }
  const result = Object.create(null);
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !Object.hasOwn(descriptor, "value") || descriptor.value === undefined) throw Error("invalid-input");
    result[key] = descriptor.value;
  }
  return result;
}
function label(value) {
  if (typeof value !== "string" || !LABEL.test(value) || hasKnownCredential(value)) throw Error("invalid-input");
  return value;
}
function source(value) {
  if (typeof value !== "string" || !SHA.test(value)) throw Error("invalid-input");
  return value;
}
function digest(value) {
  if (typeof value !== "string" || !HEX.test(value)) throw Error("invalid-input");
  return value;
}
function exactInteger(value, min = 0) {
  if (!Number.isSafeInteger(value) || value < min) throw Error("invalid-input");
  return value;
}
function subjectSnapshot(value) {
  const subject = own(value, SUBJECT_KEYS);
  return Object.freeze({ repo: label(subject.repo), source_sha: source(subject.source_sha),
    policy_version: label(subject.policy_version), env_fingerprint: label(subject.env_fingerprint) });
}
function verifierSnapshot(value) {
  const verifier = own(value, VERIFIER_KEYS);
  if (verifier.fresh !== true || verifier.accepted !== true || verifier.verification !== "metadata-only" ||
      verifier.authorization !== "none" || verifier.executable !== false) throw Error("current-verifier-not-fresh");
  return Object.freeze({ ...verifier, source_sha: source(verifier.source_sha), history_digest: digest(verifier.history_digest) });
}
function modelSnapshot(value) {
  const model = own(value, MODEL_KEYS);
  for (const key of ["provider", "model", "tool"]) label(model[key]);
  label(model.thinking);
  if (model.provider !== "codex-local-8319" || model.model !== "gpt-6.1-sol" || model.thinking !== "max" ||
      model.sdk !== "1.0.4" || model.tool !== "paired_inspect_metadata" || model.retry_count !== 0) throw Error("model-mismatch");
  return Object.freeze(model);
}
function budgetSnapshot(value) {
  const budget = own(value, BUDGET_KEYS);
  for (const key of ["cases", "arms", "fresh_sessions", "max_requests", "max_per_session", "deadline_ms", "retry_count"]) exactInteger(budget[key]);
  if (budget.cases !== 4 || budget.arms !== 2 || budget.fresh_sessions !== 8 || budget.max_requests !== 16 ||
      budget.max_per_session !== PAIR_ROUND_BUDGET || budget.deadline_ms !== PAIR_TIMEOUT_MS || budget.retry_count !== 0) throw Error("budget-mismatch");
  return Object.freeze(budget);
}
function metricsSnapshot(value) {
  const metrics = own(value, METRICS_KEYS);
  if (metrics.rows !== 8 || metrics.source_sha !== PAIR_SOURCE_SHA || metrics.adapter !== K1_METRICS_ADAPTER_ID ||
      metrics.aggregate !== true || metrics.usage_complete !== true) throw Error("metrics-mismatch");
  return Object.freeze({ ...metrics, source_sha: source(metrics.source_sha) });
}
function sdkReady(value) {
  let match;
  try { match = validateSdkContractMatch(value); } catch { throw Error("sdk-contract-mismatch"); }
  const expected = match.expected;
  if (!match.matched || expected.contract_id !== PUBLIC_1_0_4_CONTRACT.contract_id || expected.package_name !== PUBLIC_1_0_4_CONTRACT.package_name ||
      expected.version !== PUBLIC_1_0_4_CONTRACT.version || expected.export_entry !== PUBLIC_1_0_4_CONTRACT.export_entry ||
      expected.node_engine !== PUBLIC_1_0_4_CONTRACT.node_engine || expected.manifest_sha256 !== PUBLIC_1_0_4_CONTRACT.manifest_sha256 ||
      expected.entry_sha256 !== PUBLIC_1_0_4_CONTRACT.entry_sha256) throw Error("sdk-contract-mismatch");
  return Object.freeze({ status: "public-1.0.4", observed_digest: match.observed_digest, expected_digest: match.expected_digest });
}
export function assessK1Readiness(input) {
  try {
    const value = own(input, INPUT_KEYS);
    const subject = subjectSnapshot(value.subject);
    if (subject.source_sha !== PAIR_SOURCE_SHA) return refuse("subject-mismatch");
    const sdk = sdkReady(value.sdk);
    let broker;
    try { broker = validateReadonlyBrokerMetadata(value.broker); } catch { throw Error("invalid-input"); }
    const model = modelSnapshot(value.model);
    if (!broker.matched || broker.provider !== model.provider) return refuse("broker-mismatch");
    const history = snapshotHistoryContext(value.history);
    if (history === null || history.subject_source_sha !== subject.source_sha || history.content_digest !== PAIR_HISTORY_DIGEST) return refuse("history-mismatch");
    const verifier = verifierSnapshot(value.current_verifier);
    if (verifier.source_sha !== subject.source_sha || verifier.history_digest !== history.content_digest) return refuse("current-verifier-not-fresh");
    const budget = budgetSnapshot(value.budget);
    const metrics = metricsSnapshot(value.metrics);
    return Object.freeze({
      schema: K1_READINESS_SCHEMA,
      status: "ready",
      reason_code: null,
      sdk_contract: sdk.status,
      subject_source_sha: subject.source_sha,
      history_digest: history.content_digest,
      context_digest: history.context_digest,
      provider: model.provider,
      model: model.model,
      thinking: model.thinking,
      budget: Object.freeze({ cases: budget.cases, arms: budget.arms, fresh_sessions: budget.fresh_sessions,
        max_requests: budget.max_requests, max_per_session: budget.max_per_session, deadline_ms: budget.deadline_ms, retry_count: budget.retry_count }),
      metric_rows: metrics.rows,
      verification: "metadata-only",
      authorization: "none",
      executable: false,
    });
  } catch (error) {
    const reason_code = K1_READINESS_REASON_CODES.includes(error?.message) ? error.message : "invalid-input";
    return refuse(reason_code);
  }
}
export function validateK1Readiness(input) {
  try {
    const value = own(input, OUTPUT_KEYS);
    if (value.schema !== K1_READINESS_SCHEMA || !["ready", "not-ready"].includes(value.status) ||
        value.verification !== "metadata-only" || value.authorization !== "none" || value.executable !== false) throw Error("invalid-input");
    if (value.status === "not-ready") {
      if (!K1_READINESS_REASON_CODES.includes(value.reason_code) || value.sdk_contract !== "unknown" ||
          value.subject_source_sha !== null || value.history_digest !== null || value.context_digest !== null ||
          value.provider !== null || value.model !== null || value.thinking !== null || value.budget !== null || value.metric_rows !== null) throw Error("invalid-input");
      return refuse(value.reason_code);
    }
    source(value.subject_source_sha); digest(value.history_digest); digest(value.context_digest);
    label(value.provider); label(value.model);
    if (value.reason_code !== null || value.sdk_contract !== "public-1.0.4" ||
        value.subject_source_sha !== PAIR_SOURCE_SHA || value.history_digest !== PAIR_HISTORY_DIGEST ||
        value.provider !== "codex-local-8319" || value.model !== "gpt-6.1-sol" || value.thinking !== "max" || value.metric_rows !== 8) throw Error("invalid-input");
    const budget = own(value.budget, BUDGET_KEYS);
    if (budget.cases !== 4 || budget.arms !== 2 || budget.fresh_sessions !== 8 || budget.max_requests !== 16 ||
        budget.max_per_session !== 2 || budget.deadline_ms !== PAIR_TIMEOUT_MS || budget.retry_count !== 0) throw Error("invalid-input");
    return Object.freeze({ ...value, budget: Object.freeze({ ...budget }) });
  } catch { throw Error("stage6-k1-readiness-refused"); }
}
