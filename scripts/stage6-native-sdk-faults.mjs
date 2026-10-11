import assert from "node:assert/strict";
import { createSyntheticSdkHost, SYNTHETIC_FAULTS } from "./stage6-synthetic-sdk-host.mjs";
import { parseStage6NativeAcceptanceOptions } from "./stage6-native-sdk-acceptance.mjs";
import { isMain } from "./release-utils.mjs";

/** Independent negative windows do not borrow/replay the main matrix's budget. */
export async function runNativeFaults(input) {
  const results = [];
  for (const fault of [...SYNTHETIC_FAULTS, "window-budget"]) {
    const host = await createSyntheticSdkHost({ ...input, max_requests: fault === "window-budget" ? 1 : 2 }); let finished = false;
    try {
      const row = await host.runRow("healthy-metadata", "baseline", fault);
      const report = await host.finish(); finished = true;
      assert.equal(report.fresh_agents, 1); assert.ok(report.receipt.pretransport_attempts <= 2);
      if (fault === "profile-drift") { assert.equal(report.receipt.integrity_status, "unknown"); assert.equal(report.receipt.reason_code, "protected-profile-drift"); }
      else { assert.notEqual(row.outcome, "decision-valid"); assert.equal(report.receipt.integrity_status, "unchanged"); assert.equal(report.receipt.reason_code, null); }
      if (fault === "request-guard") { assert.equal(row.pretransport_attempts, 1); assert.equal(row.intercepted_fetch, 0); }
      if (fault === "window-budget") { assert.equal(row.pretransport_attempts, 1); assert.equal(row.intercepted_fetch, 1); }
      if (["cancelled", "timeout", "deadline"].includes(fault)) { assert.equal(row.abort_signal_observed, true); assert.equal(row.late_sse_body_sent, true); assert.equal(row.decision_executions, 0); }
      results.push({ fault, row, receipt: report.receipt, intercepted_fetch: report.intercepted_fetch, synthetic_responses: report.synthetic_responses });
    } finally { if (!finished) await host.finish(); }
  }
  return { schema: "stage6-native-faults/1", status: "passed", scope: "independent-synthetic-negative-windows", results, evaluation_status: "not-evaluated", authorization: "none", executable: false };
}
if (isMain(import.meta.url)) {
  try { console.log(JSON.stringify(await runNativeFaults(parseStage6NativeAcceptanceOptions(process.argv.slice(2))), null, 2)); }
  catch { console.error("stage6-native-faults-failed"); process.exitCode = 1; }
}
