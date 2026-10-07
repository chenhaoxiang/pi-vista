import { deepStrictEqual, ok, strictEqual, throws } from "node:assert/strict";
import { test } from "node:test";
import { redactAll } from "@pi-vista/core";
import { toVistaEventInput } from "@pi-vista/adapter-shadow";
import { asset, binding, FAMILIES, HASH, mutable, observation, OTHER_HASH, row, SOURCE, fixedError } from "./fixtures.mjs";

for (const [model_family, model_id, component] of FAMILIES) {
  test(`public mapping: ${model_family} allow/pass and confidence are never success or authorization`, () => {
    for (const verdict of ["allow", "pass", "uncertain", "unknown"]) {
      const mapped = toVistaEventInput(observation({ model_family, model_id, verdict, confidence: 1, asset_evidence: asset() }));
      strictEqual(mapped.component, component);
      strictEqual(mapped.action, `shadow:${model_family}:observe`);
      strictEqual(mapped.model_id, model_id);
      strictEqual(mapped.result, "unknown");
      const stats = mapped.artifact_refs?.find((ref) => ref.type === "shadow_metadata")?.stats;
      strictEqual(stats?.owner_verdict, verdict);
      strictEqual(stats?.owner_status, "observed");
      strictEqual(stats?.confidence, 1);
      strictEqual(stats?.safety_role, "observation-only");
      for (const key of ["humanExpectationWritten", "trainingEligible", "promotionEligible"]) strictEqual(stats?.[key], 0);
      ok(mapped.artifact_refs?.every((ref) => !Object.hasOwn(ref, "verified")));
      deepStrictEqual(redactAll(mapped), mapped);
    }
  });

  test(`public mapping: ${model_family} preserves veto/deny across every owner status and context`, () => {
    for (const verdict of ["deny", "veto"]) {
      for (const status of ["observed", "timeout", "unavailable", "disagreement", "missing-context", "invalid-evidence", "unknown"]) {
        for (const context_status of ["complete", "missing", "redacted", "truncated", "unknown"]) {
          const mapped = toVistaEventInput(observation({ model_family, model_id, verdict, status, context_status }));
          strictEqual(mapped.result, "blocked");
          strictEqual(mapped.artifact_refs?.[0]?.stats?.owner_verdict, verdict);
          strictEqual(mapped.artifact_refs?.[0]?.stats?.owner_status, status);
          strictEqual(mapped.artifact_refs?.[0]?.stats?.context_status, context_status);
        }
      }
    }
  });

  test(`public mapping: ${model_family} abstain/disagreement/missing context never becomes allow`, () => {
    strictEqual(toVistaEventInput(observation({ model_family, model_id, verdict: "abstain" })).result, "abstain");
    for (const status of ["disagreement", "missing-context"]) {
      strictEqual(toVistaEventInput(observation({ model_family, model_id, status })).result, "abstain");
    }
    for (const context_status of ["missing", "redacted", "truncated"]) {
      strictEqual(toVistaEventInput(observation({ model_family, model_id, context_status })).result, "abstain");
    }
    for (const status of ["timeout", "unavailable", "invalid-evidence", "unknown"]) {
      strictEqual(toVistaEventInput(observation({ model_family, model_id, status })).result, "unknown");
    }
    strictEqual(toVistaEventInput(observation({ model_family, model_id, context_status: "unknown" })).result, "unknown");
  });
}

test("projection retains run/step/source/request/vote/pair/shared input identities without packet bodies", () => {
  const mapped = toVistaEventInput(observation({ reason_code: "owner-review-only" }));
  strictEqual(mapped.run_id, "shadow-run");
  strictEqual(mapped.step_id, "shadow-run_0");
  strictEqual(mapped.source_sha, SOURCE);
  strictEqual(mapped.trace_id, "pair-1");
  strictEqual(mapped.policy_version, "synthetic-policy-v1");
  strictEqual(mapped.reason_code, "owner-review-only");
  deepStrictEqual(mapped.artifact_refs?.slice(1), [
    { type: "shadow_request", ref: "request-1" },
    { type: "shadow_pair", ref: "pair-1" },
    { type: "shadow_vote", ref: "vote-1" },
    { type: "shadow_shared_input", ref: "shadow-shared-input", stats: { digest_sha256: HASH } },
  ]);
  strictEqual(mapped.artifact_refs?.[0]?.stats?.fingerprint, OTHER_HASH);
  // ArtifactRef.sha is a source binding, never an artifact/input digest.
  ok(mapped.artifact_refs?.every((ref) => !Object.hasOwn(ref, "sha")));
  for (const key of ["request", "vote", "correlation", "command", "context", "prompt", "packet"]) strictEqual(Object.hasOwn(mapped, key), false);
});

test("normalized correlation can omit optional fields and mapping never generates core identity", () => {
  const data = mutable(observation({ correlation: { run_id: "minimal-run" } }));
  delete data.request;
  delete data.vote;
  delete data.vote_ref;
  const mapped = toVistaEventInput(data as unknown as Parameters<typeof toVistaEventInput>[0]);
  strictEqual(mapped.run_id, "minimal-run");
  for (const key of ["step_id", "ts", "source_sha", "trace_id", "vista_version"]) strictEqual(Object.hasOwn(mapped, key), false);
});

test("Laya row hashes and owner-review candidate are metadata, not human truth or a verifier", () => {
  const mapped = toVistaEventInput(observation({ row_evidence: row(), confidence: 1 }));
  strictEqual(mapped.result, "unknown");
  deepStrictEqual(mapped.artifact_refs?.find((ref) => ref.type === "shadow_row_evidence"), {
    type: "shadow_row_evidence", ref: "sample-1",
    stats: { digest_sha256: HASH, ownerReviewCandidate: 1, ownerAdjudicationRequired: 1, forcedAbstain: 0,
      packet_sha256: OTHER_HASH, contract_map_sha256: "c".repeat(64) },
  });
  deepStrictEqual(mapped.artifact_refs?.find((ref) => ref.type === "shadow_row_input"), {
    type: "shadow_row_input", ref: "sample-1", stats: { digest_sha256: HASH },
  });
  // Raw sample/packet digests are not required to equal the shared normalized
  // wire-state digest, nor the different architectures' effective input IDs.
  deepStrictEqual(redactAll(mapped), mapped);
  strictEqual(toVistaEventInput(observation({ row_evidence: row({ forcedAbstain: true, ownerReviewCandidate: false }) })).result, "abstain");
  strictEqual(toVistaEventInput(observation({ verdict: "veto", row_evidence: row({ forcedAbstain: true }) })).result, "blocked");
  for (const [model_family, model_id] of FAMILIES.slice(1)) {
    throws(() => toVistaEventInput(observation({ model_family, model_id, row_evidence: row() })), fixedError);
  }
});

test("Kev synthetic assets/receipts/isolation metadata never prove real-input isolation", () => {
  for (const scope of ["synthetic", "offline", "unknown"]) {
    const mapped = toVistaEventInput(observation({ model_family: "kev", model_id: "kev-4b", asset_evidence: asset({ scope }) }));
    strictEqual(mapped.result, "unknown");
    for (const type of ["shadow_asset", "shadow_receipt", "shadow_isolation"]) {
      const ref = mapped.artifact_refs?.find((item) => item.type === type);
      ok(ref);
      strictEqual(ref.stats?.scope, scope);
      strictEqual(ref.stats?.isolation_proof, "none");
      strictEqual(Object.hasOwn(ref, "verified"), false);
      strictEqual(Object.hasOwn(ref, "sha"), false);
      strictEqual(typeof ref.stats?.digest_sha256, "string");
    }
  }
});

test("mapping is detached and recursively frozen across every output record", () => {
  const input = observation({ row_evidence: row(), asset_evidence: asset() });
  const mapped = toVistaEventInput(input);
  const before = JSON.stringify(mapped);
  mutable(input).verdict = "deny";
  mutable(input.correlation).run_id = "changed-run";
  mutable(input.request).shared_input_hash = OTHER_HASH;
  mutable(input.row_evidence).sample_id = "changed-sample";
  mutable(input.asset_evidence).receipt_ref = "changed-receipt";
  strictEqual(JSON.stringify(mapped), before);
  ok(Object.isFrozen(mapped));
  ok(Object.isFrozen(mapped.artifact_refs));
  for (const ref of mapped.artifact_refs ?? []) {
    ok(Object.isFrozen(ref));
    if (ref.stats !== undefined) {
      ok(Object.isFrozen(ref.stats));
      throws(() => { mutable(ref.stats).authorization = "allow"; }, TypeError);
    }
    throws(() => { mutable(ref).verified = true; }, TypeError);
  }
  throws(() => { mutable(mapped).result = "ok"; }, TypeError);
});

test("case-insensitive SHA matches preserve the recorded source, not trust or compatibility", () => {
  const mapped = toVistaEventInput(observation({
    model_version: "future-v9", correlation: binding({ source_sha: "d".repeat(64) }),
    request: binding({ source_sha: "D".repeat(64), shared_input_hash: HASH.toUpperCase() }),
    vote: binding({ source_sha: "D".repeat(64), fingerprint: OTHER_HASH.toUpperCase() }),
  }));
  strictEqual(mapped.source_sha, "d".repeat(64));
  strictEqual(mapped.artifact_refs?.[0]?.stats?.revision, "future-v9");
  strictEqual(mapped.result, "unknown");
});
