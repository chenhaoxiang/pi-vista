import { rejects, strictEqual } from "node:assert/strict";
import { test } from "node:test";
import { createPiRunContext, VistaProtocolError } from "./index.js";
import type { GovernanceReceipt } from "@pi-vista/protocol";

function receipt(runId: string, sessionId?: string): GovernanceReceipt {
  return {
    receipt_schema: "pi-governance-receipt/1",
    receipt_id: "receipt_effect_1",
    event_kind: "effect.observed",
    emitted_at: "2026-10-29T00:00:00.000Z",
    source: "pi",
    identity: {
      run_id: runId,
      effect_id: "effect_1",
      ...(sessionId === undefined ? {} : { session_id: sessionId }),
    },
    provenance: {
      protocol_version: "pi-governance-receipt/1",
      runtime_id: "pi@fixture",
    },
    action: {
      kind: "provider_call",
      target_kind: "fixture_task",
      effect_key: "effect-key-1",
    },
    status: {
      run: "running",
      effect: "observed",
      execution_outcome: "settled",
      business_outcome: "unknown",
      delivery_outcome: "not_requested",
      permission_outcome: "admitted",
      reason_code: "fixture_observed",
    },
    redaction: {
      profile: "pi-governance-public/1",
      raw_content_included: false,
      credentials_included: false,
      private_path_included: false,
    },
  };
}

test("Pi context forwards a valid governance receipt to the explicit non-authorizing sink", async () => {
  const received: GovernanceReceipt[] = [];
  const context = createPiRunContext({
    runId: "run-governance",
    sessionId: "session-governance",
    emitGovernanceReceipt: (value) => { received.push(value); },
  });

  const result = await context.emitGovernanceReceipt(receipt("run-governance", "session-governance"));

  strictEqual(result?.receipt_id, "receipt_effect_1");
  strictEqual(received.length, 1);
  strictEqual(received[0]?.identity.run_id, "run-governance");
});

test("Pi context rejects governance receipts bound to another run or session", async () => {
  const context = createPiRunContext({ runId: "run-governance", sessionId: "session-governance" });

  await rejects(
    () => context.emitGovernanceReceipt(receipt("other-run", "session-governance")),
    VistaProtocolError,
  );
  await rejects(
    () => context.emitGovernanceReceipt(receipt("run-governance", "other-session")),
    VistaProtocolError,
  );
});

test("Pi context keeps governance sink failures fail-open", async () => {
  const context = createPiRunContext({
    runId: "run-governance",
    emitGovernanceReceipt: () => { throw new Error("synthetic sink failure"); },
  });

  strictEqual(await context.emitGovernanceReceipt(receipt("run-governance")), undefined);
});

test("Pi context does not invoke a governance sink for malformed receipts", async () => {
  let calls = 0;
  const context = createPiRunContext({
    runId: "run-governance",
    emitGovernanceReceipt: () => { calls += 1; },
  });
  const invalid = { ...receipt("run-governance"), redaction: { ...receipt("run-governance").redaction, raw_content_included: true } } as unknown as GovernanceReceipt;

  await rejects(() => context.emitGovernanceReceipt(invalid), VistaProtocolError);
  strictEqual(calls, 0);
});
