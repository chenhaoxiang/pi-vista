import { deepStrictEqual, strictEqual } from "node:assert/strict";
import { test } from "node:test";
import {
  consumePiOwnerResult,
  type PiOwnerEvidence,
  type PiOwnerReadback,
  type PiRequiredEvidence,
  type PiResultReasonCode,
  type PiWorkBinding,
} from "./index.js";
import type { GovernanceEvidenceRecord } from "@pi-vista/protocol";

const now = Date.parse("2026-11-04T00:00:30.000Z");
const observedAt = "2026-11-04T00:00:20.000Z";
const freshUntil = "2026-11-04T00:01:00.000Z";
const binding: PiWorkBinding = {
  workRef: { owner: "example/maintenance", kind: "change", key: "existing-change" },
  stageId: "source", runId: "run-1", sessionId: "session-1", revision: 1, headSha: "a".repeat(40),
};
const requirements: readonly PiRequiredEvidence[] = [
  { evidenceId: "test-1", kind: "test", sourceRef: "local-checks-1", claims: ["unit-checks"] },
  { evidenceId: "ci-1", kind: "ci", sourceRef: "ci-original-1", claims: ["required-checks"] },
];

function evidence(requirement = requirements[0]!, overrides: Partial<GovernanceEvidenceRecord> = {}, scope = binding): PiOwnerEvidence {
  return { binding: scope, record: {
    evidence_id: requirement.evidenceId, run_id: binding.runId, kind: requirement.kind, state: "validated",
    source_ref: requirement.sourceRef, source_sha: binding.headSha, claims: requirement.claims,
    observed_at: "2026-11-04T00:00:10.000Z", fresh_until: freshUntil, counterevidence_refs: [],
    redaction_profile: "pi-governance-public/1", ...overrides,
  } };
}

function readback(overrides: Partial<PiOwnerReadback> = {}): PiOwnerReadback {
  return {
    binding, sourceKind: "code", sourceRef: "pr-1", disposition: "accepted", observedAt, freshUntil,
    requiredEvidence: requirements, evidence: requirements.map((requirement) => evidence(requirement)),
    requiredEffects: [{ binding, effectRef: "effect-1", outcome: "settled", disposition: "accepted" }], ...overrides,
  };
}

function unknown(input: unknown, reasonCode: PiResultReasonCode, expected: unknown = binding): void {
  const result = consumePiOwnerResult(expected, input, now);
  strictEqual(result.decision, "reconcile_required");
  strictEqual(result.outcome, "unknown");
  strictEqual(result.reasonCode, reasonCode);
  strictEqual(result.authorization, "none");
  strictEqual(result.readOnly, true);
}

test("normal code delivery requires every original check and accepted settled effects", () => {
  const result = consumePiOwnerResult(binding, readback(), now);
  strictEqual(result.decision, "deliverable");
  strictEqual(result.outcome, "accepted");
  strictEqual(result.reasonCode, "owner_acceptance_confirmed");
  strictEqual(result.authorization, "none");
  strictEqual(result.readOnly, true);
  deepStrictEqual(result.binding, binding);
  strictEqual(Object.isFrozen(result), true);
  strictEqual(Object.isFrozen(result.binding), true);
  strictEqual(Object.isFrozen(result.binding?.workRef), true);
});

test("owner work, stage, run, session, revision and exact head must all match", () => {
  const foreignBindings: PiWorkBinding[] = [
    { ...binding, workRef: { ...binding.workRef, owner: "other/maintenance" } },
    { ...binding, workRef: { ...binding.workRef, kind: "issue" } },
    { ...binding, workRef: { ...binding.workRef, key: "another-change" } },
    { ...binding, stageId: "release" }, { ...binding, runId: "run-2" }, { ...binding, sessionId: "session-2" },
    { ...binding, revision: 2 }, { ...binding, headSha: "b".repeat(40) },
  ];
  for (const foreign of foreignBindings) {
    unknown(readback({ binding: foreign }), "binding_mismatch");
    deepStrictEqual(consumePiOwnerResult(binding, readback({ binding: foreign }), now).binding, binding);
  }
});

test("one green test cannot replace missing declared CI or an absent required set", () => {
  unknown(readback({ evidence: [evidence()] }), "required_evidence_not_validated");
  unknown(readback({ evidence: [] }), "required_evidence_not_validated");
  unknown(readback({ requiredEvidence: [] }), "required_evidence_not_validated");
  unknown({ ...readback(), requiredEvidence: undefined }, "owner_readback_invalid");
  unknown(readback({ requiredEvidence: [requirements[0]!, requirements[0]!] }), "owner_readback_invalid");
});

test("evidence must match declared kind, original reference and all claims", () => {
  for (const overrides of [
    { kind: "artifact" }, { source_ref: "different-original" }, { claims: ["unrelated-check"] },
  ] as Partial<GovernanceEvidenceRecord>[]) {
    unknown(readback({ evidence: [evidence(requirements[0], overrides), evidence(requirements[1])] }), "required_evidence_not_validated");
  }
  const wrongKind = { evidenceId: "provider-1", kind: "provider_receipt", sourceRef: "provider-original", claims: ["business-result"] } as const;
  unknown(readback({ requiredEvidence: [wrongKind], evidence: [evidence(wrongKind)] }), "owner_readback_invalid");
});

test("all evidence attempt/scope components and evidence run/head must match, not only validated state", () => {
  for (const scope of [
    { ...binding, workRef: { ...binding.workRef, owner: "foreign/owner" } },
    { ...binding, stageId: "later-stage" }, { ...binding, runId: "run-2" },
    { ...binding, sessionId: "session-2" }, { ...binding, revision: 2 }, { ...binding, headSha: "b".repeat(40) },
  ]) unknown(readback({ evidence: [evidence(requirements[0], {}, scope), evidence(requirements[1])] }), "required_evidence_not_validated");
  for (const overrides of [{ run_id: "other-run" }, { source_sha: "b".repeat(40) }, { source_sha: undefined }]) {
    unknown(readback({ evidence: [evidence(requirements[0], overrides), evidence(requirements[1])] }), "required_evidence_not_validated");
  }
  const { headSha: _head, ...noHead } = binding;
  unknown(readback({ binding: noHead, requiredEffects: [] }), "source_head_missing", noHead);
});

test("unvalidated, stale, expired, future and unbounded-age evidence do not confirm delivery", () => {
  for (const state of ["missing", "received", "bound", "stale", "rejected"] as const) {
    unknown(readback({ evidence: [evidence(requirements[0], { state }), evidence(requirements[1])] }), "required_evidence_not_validated");
  }
  for (const overrides of [
    { fresh_until: "2026-11-04T00:00:30.000Z" }, { fresh_until: "2026-11-04T00:00:05.000Z" },
    { fresh_until: undefined }, { fresh_until: null }, { observed_at: "2026-11-04T00:00:31.000Z" },
    { observed_at: "2026-11-04T00:00:21.000Z" },
  ]) unknown(readback({ evidence: [evidence(requirements[0], overrides), evidence(requirements[1])] }), "required_evidence_not_validated");
});

test("expired or future owner snapshots and invalid observation times cannot claim current acceptance", () => {
  for (const overrides of [{ freshUntil: "2026-11-04T00:00:30.000Z" }, { observedAt: "2026-11-04T00:00:31.000Z" }]) {
    unknown(readback(overrides), "owner_readback_not_current");
  }
  for (const time of [NaN, Infinity, -1, 8.64e15 + 1]) {
    strictEqual(consumePiOwnerResult(binding, readback(), time).reasonCode, "observation_time_invalid");
  }
});

test("required counterevidence, duplicate identities and current same-fact contradictions require reconciliation", () => {
  for (const overrides of [{ state: "conflicting" }, { counterevidence_refs: ["counter-1"] }] as Partial<GovernanceEvidenceRecord>[]) {
    unknown(readback({ evidence: [evidence(requirements[0], overrides), evidence(requirements[1])] }), "required_evidence_conflict");
  }
  for (const extra of [
    evidence(), evidence(requirements[0], { evidence_id: "counter-1", state: "rejected" }),
    evidence(requirements[0], { evidence_id: "counter-1", counterevidence_refs: ["test-1"] }),
  ]) unknown(readback({ evidence: [...readback().evidence, extra] }), "required_evidence_conflict");
});

test("historical and other-scope conflicts and independent/advisory pending do not create a global barrier", () => {
  const otherBinding = { ...binding, runId: "other-run", workRef: { ...binding.workRef, key: "independent-work" } };
  const extras = [
    evidence(requirements[0], { evidence_id: "foreign-counter", state: "conflicting", run_id: otherBinding.runId }, otherBinding),
    evidence(requirements[0], { evidence_id: "old-counter", state: "conflicting", fresh_until: "2026-11-04T00:00:25.000Z" }),
    evidence(requirements[0], { evidence_id: "advisory", state: "received", source_ref: "advisory-source", claims: ["advisory-only"] }),
    evidence(requirements[0], { evidence_id: "next-stage-counter", state: "rejected" }, { ...binding, stageId: "later-stage" }),
  ];
  strictEqual(consumePiOwnerResult(binding, readback({ evidence: [...readback().evidence, ...extras] }), now).decision, "deliverable");
  unknown(readback({ requiredEffects: [{ binding, effectRef: "effect-1", outcome: "pending", disposition: "unknown" }] }), "required_effect_pending");
  strictEqual(consumePiOwnerResult(binding, readback(), now).decision, "deliverable");
});

test("terminal failure or cancellation is reportable but never successful delivery", () => {
  for (const outcome of ["failed", "cancelled"] as const) {
    const result = consumePiOwnerResult(binding, readback({ requiredEffects: [{ binding, effectRef: "effect-1", outcome, disposition: "accepted" }] }), now);
    strictEqual(result.decision, "reportable_terminal");
    strictEqual(result.outcome, "failed");
    strictEqual(result.reasonCode, "required_effect_not_successful");
  }
  strictEqual(consumePiOwnerResult(binding, readback({ disposition: "rejected" }), now).reasonCode, "owner_rejected");
  unknown(readback({ disposition: "unknown" }), "owner_outcome_unknown");
});

test("pending/unknown required effects and merely settled unaccepted effects cannot succeed", () => {
  for (const outcome of ["pending", "unknown"] as const) {
    unknown(readback({ requiredEffects: [{ binding, effectRef: "effect-1", outcome, disposition: "accepted" }] }),
      outcome === "pending" ? "required_effect_pending" : "required_effect_unknown");
  }
  unknown(readback({ requiredEffects: [{ binding, effectRef: "effect-1", outcome: "settled", disposition: "unknown" }] }), "required_effect_unknown");
  const rejected = consumePiOwnerResult(binding, readback({ requiredEffects: [{ binding, effectRef: "effect-1", outcome: "settled", disposition: "rejected" }] }), now);
  strictEqual(rejected.outcome, "failed");
  unknown(readback({ requiredEffects: [{ binding: { ...binding, runId: "old-run" }, effectRef: "effect-1", outcome: "settled", disposition: "accepted" }] }), "required_effect_binding_mismatch");
});

test("report-only owner acceptance can finish its own report stage without imposing CI", () => {
  const { headSha: _head, ...reportBinding } = { ...binding, stageId: "report" };
  const report = readback({ binding: reportBinding, sourceKind: "report", sourceRef: "report-1", requiredEvidence: [], evidence: [], requiredEffects: [] });
  const result = consumePiOwnerResult(reportBinding, report, now);
  strictEqual(result.decision, "deliverable");
  strictEqual(result.outcome, "accepted");
  const declared = { evidenceId: "report-readback", kind: "readback", sourceRef: "report-original", claims: ["report-format"] } as const;
  unknown({ ...report, requiredEvidence: [declared] }, "required_evidence_not_validated", reportBinding);
  const reportEvidence = evidence(declared, { source_sha: undefined }, reportBinding);
  strictEqual(consumePiOwnerResult(reportBinding, { ...report, requiredEvidence: [declared], evidence: [reportEvidence] }, now).decision, "deliverable");
});

test("artifact and business stages use their own originals, not code CI as a universal oracle", () => {
  for (const [sourceKind, kind] of [["artifact", "artifact"], ["business", "provider_receipt"]] as const) {
    const declared = { evidenceId: "native-original", kind, sourceRef: "native-receipt-1", claims: ["stage-acceptance"] };
    const native = readback({ sourceKind, requiredEvidence: [declared], evidence: [evidence(declared)] });
    strictEqual(consumePiOwnerResult(binding, native, now).decision, "deliverable");
    unknown({ ...native, requiredEvidence: requirements }, "owner_readback_invalid");
  }
});

test("malformed bindings return value-independent unknown with null identity, never invented work", () => {
  const expected = consumePiOwnerResult(null, null, now);
  for (const invalid of [null, {}, { ...binding, runId: "/private/worker-result" }, { ...binding, revision: -1 }, new Proxy({}, {})]) {
    deepStrictEqual(consumePiOwnerResult(invalid, readback(), now), expected);
  }
  strictEqual(expected.binding, null);
  strictEqual(expected.reasonCode, "binding_invalid");
});

test("getters, proxies, sparse arrays, array-method overrides and unknown nested fields are rejected without executing them", () => {
  let reads = 0;
  const accessor = (value: object, key: string): object => Object.defineProperty(value, key, { enumerable: true, configurable: true,
    get() { reads += 1; throw new Error("private-getter-content"); } });
  const arrayGetter = Object.defineProperty([evidence()], "0", { get() { reads += 1; return evidence(); } });
  const claimsGetter = Object.defineProperty(["unit-checks"], "0", { get() { reads += 1; return "unit-checks"; } });
  const counterGetter = Object.defineProperty(["counter-1"], "0", { get() { reads += 1; return "counter-1"; } });
  const overridden = Object.defineProperty([evidence()], "every", { get() { reads += 1; return () => true; } });
  const proxy = new Proxy([evidence()], { getPrototypeOf() { reads += 1; throw new Error("private-proxy-content"); } });
  const record = evidence().record;
  const invalid: unknown[] = [
    accessor({ ...readback() }, "evidence"), accessor({ ...readback() }, "requiredEffects"),
    { ...readback(), evidence: arrayGetter }, { ...readback(), evidence: overridden }, { ...readback(), evidence: proxy },
    { ...readback(), evidence: new Array(2) }, { ...readback(), requiredEvidence: new Array(1) }, { ...readback(), requiredEffects: new Array(1) },
    { ...readback(), evidence: [{ binding, record: accessor({ ...record }, "state") }] },
    { ...readback(), evidence: [{ binding, record: { ...record, claims: claimsGetter } }] },
    { ...readback(), evidence: [{ binding, record: { ...record, counterevidence_refs: counterGetter } }] },
    { ...readback(), evidence: [{ binding, record: { ...record, raw: "private-content" } }] },
    { ...readback(), requiredEffects: [accessor({ ...readback().requiredEffects[0] }, "outcome")] },
    { ...readback(), requiredEvidence: [accessor({ ...requirements[0] }, "claims")] },
    { ...readback(), requiredEffects: "not-an-array" },
  ];
  for (const input of invalid) unknown(input, "owner_readback_invalid");
  strictEqual(reads, 0);
});

test("private content, paths, commands and credentials are never copied into observation or refusal diagnostics", () => {
  const privateValue = "/private/owner-notes command && raw-body";
  const invalid = [
    { ...readback(), sourceRef: privateValue }, { ...readback(), raw: privateValue },
    { ...readback(), evidence: [evidence(requirements[0], { source_ref: privateValue })] },
    { ...readback(), evidence: [evidence(requirements[0], { claims: [privateValue] })] },
    { ...readback(), evidence: [evidence(requirements[0], { authority: privateValue })] },
    { ...readback(), evidence: [evidence(requirements[0], { content_digest: "sk-1234567890abcdefghijklmnopqrstuv" })] },
  ];
  for (const input of invalid) {
    const output = consumePiOwnerResult(binding, input, now);
    strictEqual(output.outcome, "unknown");
    strictEqual(output.reasonCode, "owner_readback_invalid");
    strictEqual(JSON.stringify(output).includes(privateValue), false);
    strictEqual(JSON.stringify(output).includes("sk-1234567890abcdefghijklmnopqrstuv"), false);
  }
});
