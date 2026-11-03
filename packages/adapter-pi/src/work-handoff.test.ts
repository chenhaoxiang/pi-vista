import { deepStrictEqual, strictEqual } from "node:assert/strict";
import { test } from "node:test";
import { observePiWorkHandoff, type PiWorkBinding, type PiWorkHandoffReference } from "./index.js";
import type { GovernanceHandoff } from "@pi-vista/protocol";

const previous: PiWorkBinding = {
  workRef: { owner: "example/maintenance", kind: "change", key: "existing-work" },
  stageId: "source", runId: "old-run", sessionId: "old-session", revision: 4, headSha: "a".repeat(40),
};
const successor: PiWorkBinding = { ...previous, runId: "new-run", sessionId: "new-session", revision: 0, headSha: "b".repeat(40) };
const handoff: GovernanceHandoff = {
  handoff_schema: "pi-governance-handoff/1", run_id: previous.runId, run_revision: previous.revision,
  source_session_id: previous.sessionId, accepted_facts: ["artifact-1", "checks-observed"],
  unresolved_effects: ["native-effect-reference"], blockers: ["owner-readback-needed"], next_action: "reconcile",
  successor_constraints: { must_read_current_head: true, must_not_replay_unknown_effect: true, must_not_change_model_silently: true },
};
const input: PiWorkHandoffReference = { previous, successor, handoff };

test("fresh successor preserves original facts and unresolved native references without granting execution", () => {
  const before = JSON.stringify(input);
  const result = observePiWorkHandoff(input);
  strictEqual(result.decision, "handoff_observed");
  deepStrictEqual(result.previous, previous);
  deepStrictEqual(result.successor, successor);
  deepStrictEqual(result.acceptedFactRefs, handoff.accepted_facts);
  deepStrictEqual(result.unresolvedEffectRefs, handoff.unresolved_effects);
  deepStrictEqual(result.blockerRefs, handoff.blockers);
  strictEqual(result.nextAction, "reconcile");
  strictEqual(result.currentVerification, "not_checked");
  strictEqual(result.sourceHeadRecheckRequired, true);
  strictEqual(result.authorization, "none");
  strictEqual(result.executable, false);
  strictEqual(result.readOnly, true);
  strictEqual(Object.isFrozen(result.acceptedFactRefs), true);
  strictEqual(JSON.stringify(input), before);
});

test("run revision is local to its run and changed source is not automatically accepted or rejected", () => {
  const result = observePiWorkHandoff(input);
  strictEqual(result.reasonCode, "handoff_observed");
  strictEqual(result.successor?.revision, 0);
  strictEqual(result.successor?.headSha, "b".repeat(40));
  strictEqual(result.currentVerification, "not_checked");
});

test("same work and stage are required; an original packet cannot bind a different source run", () => {
  for (const next of [
    { ...successor, workRef: { ...successor.workRef, owner: "other/maintenance" } },
    { ...successor, workRef: { ...successor.workRef, key: "other-work" } },
  ]) strictEqual(observePiWorkHandoff({ ...input, successor: next }).reasonCode, "work_reference_mismatch");
  strictEqual(observePiWorkHandoff({ ...input, successor: { ...successor, stageId: "production" } }).reasonCode, "stage_mismatch");
  for (const packet of [
    { ...handoff, run_id: "foreign-run" }, { ...handoff, run_revision: 3 },
    { ...handoff, source_session_id: "foreign-session" },
  ]) strictEqual(observePiWorkHandoff({ ...input, handoff: packet }).reasonCode, "handoff_source_mismatch");
});

test("a fresh relation cannot merely relabel the same run or session", () => {
  for (const next of [{ ...successor, runId: previous.runId }, { ...successor, sessionId: previous.sessionId }]) {
    strictEqual(observePiWorkHandoff({ ...input, successor: next }).reasonCode, "successor_not_fresh");
  }
});

test("existing minimal handoff stays compatible without requiring a new goal ID or source session field", () => {
  const { source_session_id: _source, ...minimal } = handoff;
  const result = observePiWorkHandoff({ ...input, handoff: { ...minimal, accepted_facts: [], unresolved_effects: [], blockers: [], next_action: "none" } });
  strictEqual(result.reasonCode, "handoff_observed");
  strictEqual(result.nextAction, "none");
  deepStrictEqual(result.unresolvedEffectRefs, []);
});

test("invalid packet identities and unsafe metadata never invent a work or leak raw content", () => {
  const bad = observePiWorkHandoff(null);
  strictEqual(bad.previous, null);
  strictEqual(bad.successor, null);
  strictEqual(bad.reasonCode, "handoff_invalid");
  const secret = "/private/task-content command && raw-data";
  for (const value of [
    { ...input, raw: secret }, { ...input, previous: null },
    { ...input, handoff: { ...handoff, accepted_facts: [secret] } },
    { ...input, handoff: { ...handoff, successor_constraints: { ...handoff.successor_constraints, must_read_current_head: false } } },
  ]) {
    const result = observePiWorkHandoff(value);
    strictEqual(result.reasonCode, "handoff_invalid");
    strictEqual(JSON.stringify(result).includes(secret), false);
  }
});

test("handoff fields and arrays are read without executing getters or proxy traps", () => {
  let reads = 0;
  const get = (): never => { reads += 1; throw new Error("private-getter-body"); };
  const facts = Object.defineProperty(["artifact-1"], "0", { get });
  const invalid: unknown[] = [
    { ...input, get previous() { return get(); } },
    { ...input, handoff: { ...handoff, accepted_facts: facts } },
    { ...input, handoff: { ...handoff, blockers: new Array(1) } },
    { ...input, handoff: { ...handoff, successor_constraints: { get must_read_current_head() { return get(); } } } },
    new Proxy(input, { ownKeys() { reads += 1; return []; } }),
  ];
  for (const value of invalid) strictEqual(observePiWorkHandoff(value).reasonCode, "handoff_invalid");
  strictEqual(reads, 0);
});
