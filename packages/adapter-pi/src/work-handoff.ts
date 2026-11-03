import { assertGovernanceHandoff } from "@pi-vista/core";
import type { GovernanceHandoff, GovernanceNextAction } from "@pi-vista/protocol";
import {
  readWorkArray, readWorkMetadata, samePiWorkRef, snapshotPiWorkBinding,
  type PiWorkBinding,
} from "./work-ref.js";

/** A successor relation over an existing packet, never a resume/execution request. */
export interface PiWorkHandoffReference {
  readonly previous: PiWorkBinding;
  readonly successor: PiWorkBinding;
  readonly handoff: GovernanceHandoff;
}

export interface PiWorkHandoffObservation {
  readonly previous: PiWorkBinding | null;
  readonly successor: PiWorkBinding | null;
  readonly decision: "handoff_observed" | "reconcile_required";
  readonly reasonCode: "handoff_observed" | "handoff_invalid" | "work_reference_mismatch"
    | "stage_mismatch" | "handoff_source_mismatch" | "successor_not_fresh";
  readonly acceptedFactRefs: readonly string[];
  readonly unresolvedEffectRefs: readonly string[];
  readonly blockerRefs: readonly string[];
  readonly nextAction: GovernanceNextAction;
  readonly sourceHeadRecheckRequired: true;
  readonly currentVerification: "not_checked";
  readonly authorization: "none";
  readonly executable: false;
  readonly readOnly: true;
}

function snapshotPacket(value: unknown): GovernanceHandoff {
  const data = readWorkMetadata(value, [
    "handoff_schema", "goal_id", "run_id", "run_revision", "source_session_id", "source_runtime",
    "accepted_facts", "unresolved_effects", "blockers", "next_action", "write_scope_digest",
    "stop_condition", "successor_constraints",
  ], "work handoff");
  const constraints = readWorkMetadata(data.successor_constraints, [
    "must_read_current_head", "must_not_replay_unknown_effect", "must_not_change_model_silently",
  ], "successor constraints");
  const packet = {
    ...data,
    accepted_facts: readWorkArray(data.accepted_facts, 64),
    unresolved_effects: readWorkArray(data.unresolved_effects, 64),
    blockers: readWorkArray(data.blockers, 64),
    successor_constraints: { ...constraints },
  };
  assertGovernanceHandoff(packet);
  return Object.freeze({ ...packet,
    accepted_facts: Object.freeze(packet.accepted_facts),
    unresolved_effects: Object.freeze(packet.unresolved_effects),
    blockers: Object.freeze(packet.blockers),
    successor_constraints: Object.freeze(packet.successor_constraints),
  });
}

function observation(
  previous: PiWorkBinding | null,
  successor: PiWorkBinding | null,
  reasonCode: PiWorkHandoffObservation["reasonCode"],
  packet?: GovernanceHandoff,
): PiWorkHandoffObservation {
  return Object.freeze({
    previous, successor,
    decision: reasonCode === "handoff_observed" ? "handoff_observed" : "reconcile_required",
    reasonCode,
    acceptedFactRefs: packet?.accepted_facts ?? Object.freeze([]),
    unresolvedEffectRefs: packet?.unresolved_effects ?? Object.freeze([]),
    blockerRefs: packet?.blockers ?? Object.freeze([]),
    nextAction: packet?.next_action ?? "reconcile",
    sourceHeadRecheckRequired: true,
    currentVerification: "not_checked",
    authorization: "none",
    executable: false,
    readOnly: true,
  });
}

/**
 * Bind a fresh successor to the same owner work/stage and the original handoff.
 * Packet flags/facts never verify a new head, change native run ownership, close
 * unresolved effects, discard late results or authorize a resumed tool call.
 */
export function observePiWorkHandoff(value: unknown): PiWorkHandoffObservation {
  let previous: PiWorkBinding | null = null;
  let successor: PiWorkBinding | null = null;
  let packet: GovernanceHandoff;
  try {
    const data = readWorkMetadata(value, ["previous", "successor", "handoff"], "work successor relation");
    previous = snapshotPiWorkBinding(data.previous);
    successor = snapshotPiWorkBinding(data.successor);
    packet = snapshotPacket(data.handoff);
  } catch { return observation(previous, successor, "handoff_invalid"); }

  if (!samePiWorkRef(previous.workRef, successor.workRef)) return observation(previous, successor, "work_reference_mismatch");
  if (previous.stageId !== successor.stageId) return observation(previous, successor, "stage_mismatch");
  if (packet.run_id !== previous.runId || packet.run_revision !== previous.revision
    || (packet.source_session_id !== undefined && packet.source_session_id !== previous.sessionId)) {
    return observation(previous, successor, "handoff_source_mismatch");
  }
  if (previous.runId === successor.runId || previous.sessionId === successor.sessionId) {
    return observation(previous, successor, "successor_not_fresh");
  }
  // A new run has its own revision; do not invent a cross-run monotonic counter.
  // Its head may have legitimately changed and still needs original-owner readback.
  return observation(previous, successor, "handoff_observed", packet);
}
