import assert from "node:assert/strict";
import { createSyntheticSdkHost } from "./stage6-synthetic-sdk-host.mjs";
import { PAIR_CASES } from "./paired-evaluation-data.mjs";
import { parseStage6NativeAcceptanceOptions } from "./stage6-native-sdk-acceptance.mjs";
import { isMain } from "./release-utils.mjs";

export const parseStage6NativeMatrixOptions = parseStage6NativeAcceptanceOptions;

/** One window, eight fresh agents, sixteen synthetic requests; not model quality. */
export async function runNativeMatrix(input) {
  const host = await createSyntheticSdkHost({ ...input, max_requests: 16 });
  let finished = false;
  try {
    for (const case_id of PAIR_CASES) for (const arm of ["baseline", "guided"]) await host.runRow(case_id, arm);
    const report = await host.finish(); finished = true;
    assert.equal(report.rows.length, 8); assert.equal(report.fresh_agents, 8);
    assert.equal(report.intercepted_fetch, 16); assert.equal(report.synthetic_responses, 16);
    assert.equal(report.receipt.pretransport_attempts, 16); assert.equal(report.receipt.max_requests, 16);
    assert.equal(report.receipt.integrity_status, "unchanged"); assert.ok(report.rows.every(row => row.outcome === "decision-valid" && row.decision_executions === 1));
    return { report: { ...report, scope: "four-cases-two-arms-one-native-sdk-window", status: "passed" }, evidence: host.output };
  } finally { if (!finished) await host.finish(); }
}

if (isMain(import.meta.url)) {
  try { console.log(JSON.stringify(await runNativeMatrix(parseStage6NativeMatrixOptions(process.argv.slice(2))), null, 2)); }
  catch { console.error("stage6-native-matrix-failed"); process.exitCode = 1; }
}
