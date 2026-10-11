import { createHash } from "node:crypto";
import { types } from "node:util";
import { hasKnownCredential } from "@pi-vista/core";
import { snapshotStage6Context } from "./stage6-admission.mjs";
import { validateStage6Provenance } from "./stage6-sdk-provenance.mjs";

const SCHEMA = "stage6-k1-admission/1";
const SHA = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u;
const HEX = /^[a-f0-9]{64}$/u;
const KEYS = ["context", "expected", "provenance", "history", "budget", "model_calls"];
const HISTORY_KEYS = ["schema", "purpose", "current_verification", "authorization", "executable", "content_digest", "subject_source_sha", "context_digest", "character_count", "provenance_digests"];
const BUDGET_KEYS = ["max_requests", "max_per_session", "deadline_ms", "k"];
const digest = value => createHash("sha256").update(value).digest("hex");
const refuse = () => { throw new Error("stage6-k1-refused"); };
function own(input, keys) {
  if (!input || typeof input !== "object" || Array.isArray(input) || types.isProxy(input) || ![Object.prototype, null].includes(Object.getPrototypeOf(input)) || Reflect.ownKeys(input).length !== keys.length) refuse();
  const result = Object.create(null);
  for (const key of keys) { const p = Object.getOwnPropertyDescriptor(input, key); if (!p || !Object.hasOwn(p, "value") || p.value === undefined) refuse(); result[key] = p.value; }
  return result;
}
function historical(input) {
  if (input === null) return null;
  const value = own(input, HISTORY_KEYS);
  if (value.schema !== "stage6-history-context/1" || value.purpose !== "historical-guidance" || value.current_verification !== "not-checked" || value.authorization !== "none" || value.executable !== false) refuse();
  for (const key of ["content_digest", "context_digest"]) if (typeof value[key] !== "string" || !HEX.test(value[key])) refuse();
  if (typeof value.subject_source_sha !== "string" || !SHA.test(value.subject_source_sha) || !Number.isSafeInteger(value.character_count) || value.character_count < 1 || value.character_count > 8192) refuse();
  if (!Array.isArray(value.provenance_digests) || types.isProxy(value.provenance_digests) || value.provenance_digests.length < 1 || value.provenance_digests.length > 16 || Reflect.ownKeys(value.provenance_digests).length !== value.provenance_digests.length + 1) refuse();
  const digests = [];
  for (let i = 0; i < value.provenance_digests.length; i++) { const p = Object.getOwnPropertyDescriptor(value.provenance_digests, String(i)); if (!p || !Object.hasOwn(p, "value") || typeof p.value !== "string" || !HEX.test(p.value)) refuse(); digests.push(p.value); }
  return Object.freeze({ ...value, provenance_digests: Object.freeze(digests) });
}
function budget(input) {
  const value = own(input, BUDGET_KEYS);
  if (value.k !== 1 || !Number.isSafeInteger(value.max_requests) || value.max_requests < 1 || value.max_requests > 16 || value.max_per_session !== 2 || !Number.isSafeInteger(value.deadline_ms) || value.deadline_ms < 1000 || value.deadline_ms > 1_200_000) refuse();
  return Object.freeze(value);
}
export function snapshotHistoryContext(input) { return historical(input); }
export function admitK1(input) {
  let value, context, expected, provenance, history, max;
  try {
    value = own(input, KEYS); context = snapshotStage6Context(value.context); expected = snapshotStage6Context(value.expected);
    provenance = validateStage6Provenance(value.provenance); history = historical(value.history); max = budget(value.budget);
    if (!Number.isSafeInteger(value.model_calls) || value.model_calls < 0) refuse();
    if (Object.keys(context).some(key => context[key] !== expected[key])) return result("context-mismatch", value.model_calls);
    if (!provenance.sdk.matched || !provenance.broker.matched || provenance.subject_source_sha !== context.subject_source_sha || provenance.history_digest !== context.subject_history_digest || provenance.sdk.observed.version !== context.sdk) return result("provenance-mismatch", value.model_calls);
    if (context.arm === "guided" && (!history || history.subject_source_sha !== context.subject_source_sha || history.content_digest !== context.subject_history_digest || history.context_digest !== context.guidance_digest)) return result("history-mismatch", value.model_calls);
    if (context.arm === "baseline" && history !== null) return result("baseline-history-unexpected", value.model_calls);
    if (value.model_calls !== 0) return result("model-calls-before-admission", value.model_calls);
    return Object.freeze({ ...result(null, value.model_calls), context, provenance, history, budget: max, history_status: history === null ? "none" : "historical-only", context_digest: history?.context_digest ?? null });
  } catch { return result("invalid-input", null); }
}
function result(reason_code, model_calls) { return Object.freeze({ schema: SCHEMA, status: reason_code === null ? "metadata-admitted" : "refused", reason_code, model_calls, started_model_calls: 0, verification: "metadata-only", authorization: "none", executable: false }); }
