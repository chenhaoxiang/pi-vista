import { redactAll } from "@pi-vista/core";
import type { ArtifactRef, VistaCheckpoint, VistaEvent } from "@pi-vista/protocol";
import { compareText, NESTED_LIMIT, page, STATS_LIMIT, type CheckpointView, type EventView, type ReceiptObservation, type StatView } from "./contract.js";
import { containsKnownCredential, displayIdentifier, displayLabel, isBoundStep, isCliIdentifier, safeStatKey, WITHHELD } from "./safety.js";

export function projectEvent(event: VistaEvent): EventView | undefined {
  if (!isCliIdentifier(event.run_id) || !isBoundStep(event.run_id, event.step_id)) return undefined;
  return {
    run_id: event.run_id,
    step_id: event.step_id,
    ts: event.ts,
    component: displayLabel(event.component, "component"),
    action: displayLabel(event.action, "action"),
    result: displayLabel(event.result, "result"),
    ...(event.reason_code !== undefined ? { reason_code: displayLabel(event.reason_code, "reason_code") } : {}),
    ...(event.source_sha !== undefined ? { source_sha: displayIdentifier(event.source_sha) } : {}),
    ...(event.vista_version !== undefined ? { vista_version: displayLabel(event.vista_version, "vista_version") } : {}),
  };
}

export function compareEvents(a: EventView, b: EventView): number {
  return (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0) || compareText(JSON.stringify(a), JSON.stringify(b));
}

export function projectCheckpoint(checkpoint: VistaCheckpoint): CheckpointView {
  const stepList = (values: readonly string[]) => page(values.map((value) => isBoundStep(checkpoint.run_id, value) ? value : WITHHELD).sort(compareText), NESTED_LIMIT);
  const identifiers = (values: readonly string[]) => page(values.map(displayIdentifier).sort(compareText), NESTED_LIMIT);
  return {
    run_id: checkpoint.run_id,
    step_id: checkpoint.step_id,
    ts: checkpoint.ts,
    source_sha: displayIdentifier(checkpoint.source_sha),
    env_fingerprint: displayIdentifier(checkpoint.env_fingerprint),
    policy_version: displayLabel(checkpoint.policy_version, "policy_version"),
    completed_steps: stepList(checkpoint.completed_steps),
    pending_steps: stepList(checkpoint.pending_steps),
    check_fn_ids: identifiers(checkpoint.check_fn_ids),
    resume_requires: identifiers(checkpoint.resume_requires ?? []),
    owner_claimed_resumable: checkpoint.resumable,
  };
}

function projectStats(artifact: ArtifactRef): { stats: StatView[]; withheld: number } {
  const entries = Object.entries(artifact.stats ?? {});
  const stats: StatView[] = [];
  for (const [label, value] of entries) {
    if (!safeStatKey(label)) continue;
    if (typeof value === "number" && Number.isFinite(value)) {
      stats.push({ label, value });
    } else if (typeof value === "string") {
      let safeValue = WITHHELD;
      if (value.length <= 64 && /^[\p{L}\p{M}\p{N}._:@+-]{1,64}$/u.test(value) && !containsKnownCredential(value)) {
        try {
          const redacted = redactAll({ artifact_refs: [{ type: "opaque", ref: "opaque", stats: { [label]: value } }] });
          if (redacted.artifact_refs[0]?.stats[label] === value) safeValue = value;
        } catch {
          // Retain only the fixed marker when public core redaction fails.
        }
      }
      stats.push({ label, value: safeValue });
    }
  }
  stats.sort((a, b) => compareText(a.label, b.label));
  return { stats, withheld: entries.length - stats.length };
}

export function projectReceiptObservation(event: EventView, artifact: ArtifactRef): ReceiptObservation {
  const { stats, withheld } = projectStats(artifact);
  return {
    event,
    owner_claimed_verified: artifact.verified ?? null,
    owner_claimed_stats: page(stats, STATS_LIMIT),
    withheld_stats: withheld,
  };
}
