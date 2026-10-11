import { types } from "node:util";
import { PAIR_CASES } from "./paired-evaluation-data.mjs";

const DECISIONS = Object.freeze(["accept", "reject"]);
const TECHNICAL_FAILURES = Object.freeze(["cancelled", "timeout", "deadline", "stream-disconnected"]);
const REASONS = Object.freeze(["metadata-current", "source-mismatch", "environment-mismatch", "metadata-missing"]);
const SHA = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u;
const SHA64 = /^[a-f0-9]{64}$/u;
export const STRICT_DECISION_SCHEMA = Object.freeze({ type: "object", additionalProperties: false,
  properties: Object.freeze({
    case_id: Object.freeze({ type: "string", enum: PAIR_CASES }),
    decision: Object.freeze({ type: "string", enum: DECISIONS }),
    reason_code: Object.freeze({ type: "string", enum: REASONS }),
  }), required: Object.freeze(["case_id", "decision", "reason_code"]) });
function own(input, keys) {
  if (input === null || typeof input !== "object" || Array.isArray(input) || types.isProxy(input) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(input)) || Reflect.ownKeys(input).length !== keys.length) throw new Error("decision-schema-invalid");
  const value = Object.create(null);
  for (const key of keys) {
    const p = Object.getOwnPropertyDescriptor(input, key);
    if (!p || !Object.hasOwn(p, "value") || p.value === undefined) throw new Error("decision-schema-invalid");
    value[key] = p.value;
  }
  return value;
}
export function decisionToolContract(case_id) {
  if (!PAIR_CASES.includes(case_id)) throw new Error("decision-schema-invalid");
  return Object.freeze({ name: "stage6_decision", parameters: STRICT_DECISION_SCHEMA, case_id });
}
function fixture(input) {
  if (!input || typeof input !== "object" || Array.isArray(input) || types.isProxy(input) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(input))) throw new Error("decision-schema-invalid");
  const keys = Reflect.ownKeys(input);
  const allowed = ["case_id", "source_sha", "env_fingerprint", "title", "format_version"];
  if (keys.some(key => !allowed.includes(key)) || !["case_id", "source_sha", "env_fingerprint"].every(key => keys.includes(key))) throw new Error("decision-schema-invalid");
  return own(input, keys);
}
/** Host-owned fixed-fixture oracle, never a model judge or permission decision. */
export function referenceDecision(case_id, metadata, expected) {
  decisionToolContract(case_id);
  const observed = fixture(metadata);
  const pin = own(expected, ["source_sha", "env_fingerprint", "required_fields", "format_version"]);
  if (!Array.isArray(pin.required_fields) || types.isProxy(pin.required_fields) || Object.getPrototypeOf(pin.required_fields) !== Array.prototype ||
      pin.required_fields.length < 1 || pin.required_fields.length > 2 || Reflect.ownKeys(pin.required_fields).length !== pin.required_fields.length + 1) throw new Error("decision-schema-invalid");
  const required = [];
  for (let index = 0; index < pin.required_fields.length; index++) {
    const p = Object.getOwnPropertyDescriptor(pin.required_fields, String(index));
    if (!p || !Object.hasOwn(p, "value") || !["title", "format_version"].includes(p.value) || required.includes(p.value)) throw new Error("decision-schema-invalid");
    required.push(p.value);
  }
  if (observed.case_id !== case_id || typeof observed.source_sha !== "string" || !SHA.test(observed.source_sha) ||
      typeof observed.env_fingerprint !== "string" || !SHA64.test(observed.env_fingerprint) || typeof pin.source_sha !== "string" ||
      !SHA.test(pin.source_sha) || typeof pin.env_fingerprint !== "string" || !SHA64.test(pin.env_fingerprint) || !Number.isSafeInteger(pin.format_version)) throw new Error("decision-schema-invalid");
  // These are explicitly trusted synthetic fixture records, not raw tool/model bodies.
  const reason_code = observed.source_sha !== pin.source_sha ? "source-mismatch" :
    observed.env_fingerprint !== pin.env_fingerprint ? "environment-mismatch" :
    required.some(field => field === "title" ? typeof observed.title !== "string" || observed.title.length === 0 : observed.format_version !== pin.format_version) ? "metadata-missing" : "metadata-current";
  return Object.freeze({ case_id, decision: reason_code === "metadata-current" ? "accept" : "reject", reason_code });
}
export function createReferenceMockProvider() {
  let calls = 0;
  return Object.freeze({ decide(case_id, metadata, expected) {
    calls++; return Object.freeze({ name: "stage6_decision", arguments: referenceDecision(case_id, metadata, expected) });
  }, get calls() { return calls; } });
}
function result(outcome, case_id, parsed) {
  return Object.freeze({ outcome, case_id, decision_parsed: parsed !== undefined,
    ...(parsed === undefined ? {} : { decision: parsed.decision, reason_code: parsed.reason_code }),
    authorization: "none", executable: false });
}
/** Grade an actual structured tool call; free-form text/JSON is never a decision. */
export function classifyDecisionOutcome(input) {
  const value = own(input, ["case_id", "status", "call", "metadata", "expected"]);
  const { case_id, status, call, metadata, expected } = value;
  decisionToolContract(case_id);
  if (status === "provider-error") return result("provider-error", case_id);
  if (status === "refusal") return result("refusal", case_id);
  if (TECHNICAL_FAILURES.includes(status)) return result(status, case_id);
  if (status !== "completed") return result("schema-invalid", case_id);
  if (call === null) return result("tool-not-called", case_id);
  let parsed;
  try {
    const invocation = own(call, ["name", "arguments"]);
    if (invocation.name !== "stage6_decision") throw new Error("decision-schema-invalid");
    parsed = own(invocation.arguments, ["case_id", "decision", "reason_code"]);
    if (parsed.case_id !== case_id || !DECISIONS.includes(parsed.decision) || !REASONS.includes(parsed.reason_code)) throw new Error("decision-schema-invalid");
  } catch { return result("schema-invalid", case_id); }
  const truth = referenceDecision(case_id, metadata, expected);
  return result(parsed.decision === truth.decision && parsed.reason_code === truth.reason_code ? "decision-valid" : "semantic-mismatch", case_id, parsed);
}
