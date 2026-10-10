import { createHash } from "node:crypto";
import { types } from "node:util";

// Offline metadata contract only. A future trusted host must collect these facts;
// this module neither reads profiles nor starts a model or grants permission.
export const STAGE6_ADMISSION_SCHEMA = 1;
const HEX64 = /^[a-f0-9]{64}$/u;
const SOURCE_SHA = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u;
const LABEL = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const CONTEXT_KEYS = ["provider", "model", "thinking", "sdk", "harness_source_sha", "subject_source_sha", "subject_history_digest", "broker_digest"];
const INPUT_KEYS = [...CONTEXT_KEYS, "profile_before", "profile_after", "model_calls"];
const issued = new WeakSet();
const refuse = () => { throw new Error("stage6-admission-refused"); };
function own(value, keys) {
  if (value === null || typeof value !== "object" || Array.isArray(value) || types.isProxy(value) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(value)) || Reflect.ownKeys(value).length !== keys.length) refuse();
  const result = Object.create(null);
  for (const key of keys) {
    const p = Object.getOwnPropertyDescriptor(value, key);
    if (!p || !Object.hasOwn(p, "value") || p.value === undefined) refuse();
    result[key] = p.value;
  }
  return result;
}
function context(input) {
  const value = own(input, CONTEXT_KEYS);
  for (const key of ["provider", "model", "sdk"]) if (typeof value[key] !== "string" || !LABEL.test(value[key])) refuse();
  if (!["off", "minimal", "low", "medium", "high", "xhigh", "max"].includes(value.thinking)) refuse();
  for (const key of ["harness_source_sha", "subject_source_sha"]) if (typeof value[key] !== "string" || !SOURCE_SHA.test(value[key])) refuse();
  if (typeof value.subject_history_digest !== "string" || !HEX64.test(value.subject_history_digest)) refuse();
  if (value.broker_digest !== null && (typeof value.broker_digest !== "string" || !HEX64.test(value.broker_digest))) refuse();
  return Object.freeze(value);
}
export function profileSnapshot(input) {
  const value = own(input, ["protected", "volatile"]);
  const result = {};
  for (const key of ["protected", "volatile"]) {
    const map = value[key];
    if (!map || typeof map !== "object" || Array.isArray(map) || types.isProxy(map) ||
        ![Object.prototype, null].includes(Object.getPrototypeOf(map))) refuse();
    const names = Object.keys(map).sort();
    if (Reflect.ownKeys(map).length !== names.length || names.length > 32 || key === "protected" && names.length === 0) refuse();
    const entries = names.map(name => {
      if (!LABEL.test(name)) refuse();
      const p = Object.getOwnPropertyDescriptor(map, name);
      if (!p || !Object.hasOwn(p, "value") || (p.value !== null && (typeof p.value !== "string" || !HEX64.test(p.value)))) refuse();
      return [name, p.value];
    });
    result[key] = Object.freeze(Object.fromEntries(entries));
  }
  return Object.freeze(result);
}
export function profileDigest(snapshot) {
  return createHash("sha256").update(JSON.stringify(profileSnapshot(snapshot))).digest("hex");
}
export function classifyProfileDrift(beforeInput, afterInput) {
  const before = profileSnapshot(beforeInput), after = profileSnapshot(afterInput);
  const changed = key => Object.freeze([...new Set([...Object.keys(before[key]), ...Object.keys(after[key])])].sort()
    .filter(name => Object.hasOwn(before[key], name) !== Object.hasOwn(after[key], name) || before[key][name] !== after[key][name]));
  const protectedChanged = changed("protected"), volatileChanged = changed("volatile");
  const classification = protectedChanged.length ? "protected-profile-drift" :
    volatileChanged.length ? "volatile-profile-drift-unknown-attribution" : "unchanged";
  return Object.freeze({ classification, protected_changed: protectedChanged, volatile_changed: volatileChanged,
    attribution: classification === "unchanged" ? "not-observed" : "unknown" });
}
function result(reason_code, model_calls, details = {}) {
  const value = Object.freeze({ schema: STAGE6_ADMISSION_SCHEMA, status: reason_code === null ? "admitted" : "refused",
    admitted: reason_code === null, reason_code, model_calls, started_model_calls: 0,
    verification: "metadata-only", authorization: "none", executable: false, ...details });
  if (reason_code === null) issued.add(value);
  return value;
}
export function admitStage6Run(input, expectedInput) {
  let value, observed, expected, before, after;
  try {
    value = own(input, INPUT_KEYS);
    observed = context(Object.fromEntries(CONTEXT_KEYS.map(key => [key, value[key]])));
    expected = context(expectedInput);
    if (!Number.isSafeInteger(value.model_calls) || value.model_calls < 0) refuse();
    before = profileSnapshot(value.profile_before); after = profileSnapshot(value.profile_after);
  } catch { return result("invalid-input", null); }
  const drift = classifyProfileDrift(before, after);
  const mismatch = CONTEXT_KEYS.find(key => observed[key] !== expected[key]);
  let reason = value.model_calls !== 0 ? "model-calls-before-admission" :
    mismatch ? `${mismatch.replaceAll("_", "-")}-mismatch` : drift.classification !== "unchanged" ? drift.classification : null;
  return result(reason, value.model_calls, { ...observed, profile_before_digest: profileDigest(before), profile_after_digest: profileDigest(after), drift });
}
export function createAdmissionRequestBudget(admission, maxRequests = 16) {
  if (!issued.has(admission) || !Number.isSafeInteger(maxRequests) || maxRequests < 1 || maxRequests > 16) throw new Error("admission-required");
  let requests = 0;
  return Object.freeze({ get requests() { return requests; }, max_requests: maxRequests,
    take() { if (requests >= maxRequests) throw new Error("request-budget-exhausted"); return ++requests; },
    status() { return Object.freeze({ verification: "metadata-only", authorization: "none", model_calls: requests, max_requests: maxRequests }); } });
}
