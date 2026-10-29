import type { GovernanceReceipt } from "@pi-vista/protocol";
import { assertGovernanceReceipt } from "./governance.js";

/**
 * Bounded, read-only projection for Pi Desk/Vista consumers.
 *
 * This view intentionally drops action payloads, provenance details, evidence
 * references and resource metadata. Consumers can show lifecycle truth and a
 * next read-only action without gaining an execution or authorization surface.
 */
export interface GovernanceReceiptProjection {
  readonly receiptId: string;
  readonly eventKind: GovernanceReceipt["event_kind"];
  readonly emittedAt: string;
  readonly source: GovernanceReceipt["source"];
  readonly runId: string;
  readonly effectId?: string;
  readonly runState: GovernanceReceipt["status"]["run"];
  readonly effectState?: GovernanceReceipt["status"]["effect"];
  readonly executionOutcome: GovernanceReceipt["status"]["execution_outcome"];
  readonly businessOutcome: GovernanceReceipt["status"]["business_outcome"];
  readonly deliveryOutcome: GovernanceReceipt["status"]["delivery_outcome"];
  readonly permissionOutcome: GovernanceReceipt["status"]["permission_outcome"];
  readonly reasonCode?: string;
  readonly unknown: boolean;
  readonly nextAction: NonNullable<GovernanceReceipt["next"]>["action"] | "none";
  readonly evidenceCount: number;
  readonly validatedEvidenceCount: number;
  readonly authorization: "none";
  readonly readOnly: true;
}

/** Project one validated receipt without dereferencing any evidence or artifact. */
export function projectGovernanceReceipt(value: unknown): GovernanceReceiptProjection {
  assertGovernanceReceipt(value);
  const receipt = value as GovernanceReceipt;
  const evidence = receipt.evidence ?? [];
  return {
    receiptId: receipt.receipt_id,
    eventKind: receipt.event_kind,
    emittedAt: receipt.emitted_at,
    source: receipt.source,
    runId: receipt.identity.run_id,
    ...(receipt.identity.effect_id ? { effectId: receipt.identity.effect_id } : {}),
    runState: receipt.status.run,
    ...(receipt.status.effect ? { effectState: receipt.status.effect } : {}),
    executionOutcome: receipt.status.execution_outcome,
    businessOutcome: receipt.status.business_outcome,
    deliveryOutcome: receipt.status.delivery_outcome,
    permissionOutcome: receipt.status.permission_outcome,
    ...(receipt.status.reason_code ? { reasonCode: receipt.status.reason_code } : {}),
    unknown: receipt.status.run === "unknown"
      || receipt.status.effect === "unknown"
      || receipt.status.execution_outcome === "unknown"
      || receipt.status.business_outcome === "unknown"
      || receipt.status.delivery_outcome === "unknown"
      || receipt.status.permission_outcome === "unknown",
    nextAction: receipt.next?.action ?? "none",
    evidenceCount: evidence.length,
    validatedEvidenceCount: evidence.filter((item) => item.state === "validated").length,
    authorization: "none",
    readOnly: true,
  };
}

/** Project a bounded receipt collection while preserving append-only order. */
export function projectGovernanceReceipts(values: readonly unknown[], limit = 100): GovernanceReceiptProjection[] {
  if (!Number.isSafeInteger(limit) || limit < 1) throw new Error("limit must be a positive integer");
  return values.slice(0, limit).map(projectGovernanceReceipt);
}
