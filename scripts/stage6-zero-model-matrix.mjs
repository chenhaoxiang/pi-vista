import { createHash } from "node:crypto";
import { types } from "node:util";
import { classifyDecisionOutcome, createReferenceMockProvider } from "./stage6-decision-tool.mjs";
import { caseTruth, expectedFixtureContract, pairedFixture, PAIR_CASES, PAIR_HISTORY_DIGEST, PAIR_SOURCE_SHA } from "./paired-evaluation-data.mjs";
import { isMain } from "./release-utils.mjs";

const MATRIX_SCHEMA = "stage6-zero-model-matrix/1";
const DIAGNOSTIC_STATUSES = Object.freeze(["tool-not-called", "schema-invalid", "refusal", "provider-error", "cancelled", "timeout", "deadline", "stream-disconnected"]);
const digest = value => createHash("sha256").update(value).digest("hex");
const own = (value, keys) => {
  if (value === null || typeof value !== "object" || Array.isArray(value) || types.isProxy(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value)) || Reflect.ownKeys(value).length !== keys.length) throw new Error("stage6-matrix-refused");
  const result = {};
  for (const key of keys) { const descriptor = Object.getOwnPropertyDescriptor(value, key); if (!descriptor || !Object.hasOwn(descriptor, "value")) throw new Error("stage6-matrix-refused"); result[key] = descriptor.value; }
  return result;
};

export function runReferenceMatrix() {
  const environment = digest("stage6-zero-model-environment");
  const rows = [], calls = [];
  for (const case_id of PAIR_CASES) {
    const metadata = pairedFixture(case_id, PAIR_SOURCE_SHA, environment);
    const expected = expectedFixtureContract(PAIR_SOURCE_SHA, environment);
    for (const arm of ["baseline", "guided"]) {
      const provider = createReferenceMockProvider();
      const call = provider.decide(case_id, metadata, expected);
      const outcome = classifyDecisionOutcome({ case_id, status: "completed", call, metadata, expected });
      calls.push(provider.calls);
      rows.push(Object.freeze({ case_id, arm, guidance_mode: arm === "baseline" ? "none" : "historical-observed", history_digest: arm === "baseline" ? null : PAIR_HISTORY_DIGEST, ...outcome }));
    }
  }
  const result = Object.freeze({ schema: MATRIX_SCHEMA, status: "reference-only", evaluation_status: "not-evaluated", pair_count: PAIR_CASES.length,
    rows: Object.freeze(rows), reference_calls: calls.reduce((sum, value) => sum + value, 0), model_calls: 0, bank_writes: 0,
    all_decisions_valid: rows.every(row => row.outcome === "decision-valid"), authorization: "none", executable: false,
    scope: "four-synthetic-cases-baseline-guided-reference-only-not-a-model-evaluation" });
  return result;
}

export function runFailureDiagnostics() {
  const environment = digest("stage6-zero-model-environment"), case_id = PAIR_CASES[0];
  const metadata = pairedFixture(case_id, PAIR_SOURCE_SHA, environment), expected = expectedFixtureContract(PAIR_SOURCE_SHA, environment);
  return Object.freeze(DIAGNOSTIC_STATUSES.map(status => {
    const call = status === "tool-not-called" ? null : status === "schema-invalid" ? { name: "stage6_decision", arguments: "free text" } : { name: "stage6_decision", arguments: {} };
    return classifyDecisionOutcome({ case_id, status: ["tool-not-called", "schema-invalid"].includes(status) ? "completed" : status, call, metadata, expected });
  }));
}

export function validateZeroModelMatrix(input) {
  const value = own(input, ["schema", "status", "evaluation_status", "pair_count", "rows", "reference_calls", "model_calls", "bank_writes", "all_decisions_valid", "authorization", "executable", "scope"]);
  if (value.schema !== MATRIX_SCHEMA || value.status !== "reference-only" || value.evaluation_status !== "not-evaluated" || value.pair_count !== 4 ||
      !Array.isArray(value.rows) || types.isProxy(value.rows) || Object.getPrototypeOf(value.rows) !== Array.prototype || value.rows.length !== 8 || Reflect.ownKeys(value.rows).length !== 9 ||
      value.reference_calls !== 8 || value.model_calls !== 0 || value.bank_writes !== 0 || value.all_decisions_valid !== true ||
      value.authorization !== "none" || value.executable !== false || value.scope !== "four-synthetic-cases-baseline-guided-reference-only-not-a-model-evaluation") throw new Error("stage6-matrix-refused");
  const seen = new Set(), rows = [];
  for (let i = 0; i < value.rows.length; i++) {
    const p = Object.getOwnPropertyDescriptor(value.rows, String(i)); if (!p || !Object.hasOwn(p, "value")) throw new Error("stage6-matrix-refused");
    const row = own(p.value, ["case_id", "arm", "guidance_mode", "history_digest", "outcome", "decision_parsed", "decision", "reason_code", "authorization", "executable"]);
    if (!PAIR_CASES.includes(row.case_id) || !["baseline", "guided"].includes(row.arm) || row.outcome !== "decision-valid" || row.decision_parsed !== true || row.authorization !== "none" || row.executable !== false) throw new Error("stage6-matrix-refused");
    const truth = caseTruth(row.case_id), key = `${row.case_id}/${row.arm}`;
    if (seen.has(key) || row.decision !== truth.decision || row.reason_code !== truth.reason_code ||
        row.guidance_mode !== (row.arm === "baseline" ? "none" : "historical-observed") || row.history_digest !== (row.arm === "baseline" ? null : PAIR_HISTORY_DIGEST)) throw new Error("stage6-matrix-refused");
    seen.add(key); rows.push(Object.freeze(row));
  }
  return Object.freeze({ ...value, rows: Object.freeze(rows) });
}

if (isMain(import.meta.url)) console.log(JSON.stringify(runReferenceMatrix(), null, 2));
