import type {
  GovernanceBusinessOutcome,
  GovernanceDeliveryOutcome,
  GovernancePermissionOutcome,
  GovernanceReceipt,
} from "@pi-vista/protocol";
import { projectGovernanceReceipt, type GovernanceReceiptProjection } from "./governance-projection.js";

export type GovernanceAttentionReason =
  | "permission_blocked"
  | "business_blocked"
  | "waiting_user"
  | "reconcile_required"
  | "handoff_required"
  | "close_available";

/**
 * A bounded, read-only item for a human-attention view.
 *
 * This projection is deliberately not a scheduler or router: it drops action,
 * evidence and resource payloads, and carries no permission or execution method.
 */
export interface GovernanceAttentionItem {
  readonly queueKey: string;
  readonly runId: string;
  readonly effectId?: string;
  readonly eventKind: GovernanceReceipt["event_kind"];
  readonly emittedAt: string;
  readonly source: GovernanceReceipt["source"];
  readonly reason: GovernanceAttentionReason;
  readonly nextAction: GovernanceReceiptProjection["nextAction"];
  readonly unknown: boolean;
  readonly businessOutcome: GovernanceBusinessOutcome;
  readonly deliveryOutcome: GovernanceDeliveryOutcome;
  readonly permissionOutcome: GovernancePermissionOutcome;
  readonly authorization: "none";
  readonly readOnly: true;
}

function attentionReason(projection: GovernanceReceiptProjection): GovernanceAttentionReason | undefined {
  if (["blocked", "revoked", "expired"].includes(projection.permissionOutcome)) {
    return "permission_blocked";
  }
  if (projection.businessOutcome === "blocked") {
    return "business_blocked";
  }
  if (projection.runState === "waiting" || projection.nextAction === "wait") {
    return "waiting_user";
  }
  if (projection.nextAction === "reconcile" || projection.unknown) {
    return "reconcile_required";
  }
  if (projection.nextAction === "handoff") {
    return "handoff_required";
  }
  if (projection.nextAction === "close") {
    return "close_available";
  }
  return undefined;
}

function attentionItem(projection: GovernanceReceiptProjection): GovernanceAttentionItem | undefined {
  const reason = attentionReason(projection);
  if (reason === undefined) return undefined;
  return {
    queueKey: `${projection.runId}:${projection.effectId ?? "run"}`,
    runId: projection.runId,
    ...(projection.effectId ? { effectId: projection.effectId } : {}),
    eventKind: projection.eventKind,
    emittedAt: projection.emittedAt,
    source: projection.source,
    reason,
    nextAction: projection.nextAction,
    unknown: projection.unknown,
    businessOutcome: projection.businessOutcome,
    deliveryOutcome: projection.deliveryOutcome,
    permissionOutcome: projection.permissionOutcome,
    authorization: "none",
    readOnly: true,
  };
}

/** Project one receipt when it requires human attention; healthy progress stays quiet. */
export function projectGovernanceAttention(value: unknown): GovernanceAttentionItem | undefined {
  return attentionItem(projectGovernanceReceipt(value));
}

/**
 * Project a receipt stream into a bounded queue. The last receipt for a run/effect
 * replaces earlier attention; a later healthy/closed receipt removes stale attention.
 */
export function projectGovernanceAttentionQueue(
  values: readonly unknown[],
  limit = 100,
): GovernanceAttentionItem[] {
  if (!Number.isSafeInteger(limit) || limit < 1) throw new Error("limit must be a positive integer");
  const latest = new Map<string, GovernanceAttentionItem>();
  for (const value of values) {
    const projection = projectGovernanceReceipt(value);
    const key = `${projection.runId}:${projection.effectId ?? "run"}`;
    const item = attentionItem(projection);
    if (item === undefined) latest.delete(key);
    else latest.set(key, item);
  }
  return [...latest.values()].slice(0, limit);
}
