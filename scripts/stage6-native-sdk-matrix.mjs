import assert from "node:assert/strict";
import { types } from "node:util";
import { createSyntheticSdkHost } from "./stage6-synthetic-sdk-host.mjs";
import { PAIR_CASES } from "./paired-evaluation-data.mjs";
import { parseStage6NativeAcceptanceOptions } from "./stage6-native-sdk-acceptance.mjs";
import { isMain } from "./release-utils.mjs";

export const parseStage6NativeMatrixOptions = parseStage6NativeAcceptanceOptions;

/** One window, eight fresh agents, sixteen synthetic requests; not model quality. */
export function snapshotNativeRunOptions(input) {
  if (!input || typeof input !== "object" || Array.isArray(input) || types.isProxy(input) || ![Object.prototype, null].includes(Object.getPrototypeOf(input)) || Reflect.ownKeys(input).length !== 2) throw Error("stage6-native-matrix-refused");
  const value = {};
  for (const key of ["sdk", "source_sha"]) { const p = Object.getOwnPropertyDescriptor(input, key); if (!p || !Object.hasOwn(p, "value") || typeof p.value !== "string") throw Error("stage6-native-matrix-refused"); value[key] = p.value; }
  return Object.freeze(value);
}
export async function runNativeMatrix(input) {
  const value = snapshotNativeRunOptions(input);
  const host = await createSyntheticSdkHost({ ...value, max_requests: 16 });
  let finished = false;
  try {
    for (const case_id of PAIR_CASES) for (const arm of ["baseline", "guided"]) await host.runRow(case_id, arm);
    const guardRow = await host.runRow("healthy-metadata", "baseline", "window-budget");
    assert.equal(guardRow.pretransport_attempts, 0); assert.equal(guardRow.intercepted_fetch, 0);
    const report = await host.finish(); finished = true;
    assert.equal(report.rows.length, 9); assert.equal(report.fresh_agents, 9);
    assert.equal(report.intercepted_fetch, 16); assert.equal(report.synthetic_responses, 16);
    assert.equal(report.receipt.pretransport_attempts, 16); assert.equal(report.receipt.max_requests, 16);
    assert.equal(report.receipt.integrity_status, "unchanged"); assert.ok(report.rows.slice(0, 8).every(row => row.outcome === "decision-valid" && row.decision_executions === 1));
    return { report: { ...report, rows: report.rows.slice(0, 8), budget_guard: guardRow, scope: "four-cases-two-arms-one-native-sdk-window-plus-budget-guard", status: "passed" }, evidence: host.output };
  } finally { if (!finished) await host.finish(); }
}

if (isMain(import.meta.url)) {
  try { console.log(JSON.stringify(await runNativeMatrix(parseStage6NativeMatrixOptions(process.argv.slice(2))), null, 2)); }
  catch { console.error("stage6-native-matrix-failed"); process.exitCode = 1; }
}
