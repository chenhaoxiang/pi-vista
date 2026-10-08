---
doc_type: spec
project: workspace
owner_repository: chenhaoxiang/pi-vista
status: active
truth_mode: maintained
created: 2026-10-08
verified: 2026-10-08
---

# Stage2: safe bounded trace drafts

## One additive pure seam
Add explicit @pi-vista/learning/trace and draftTraceExperience(input), with types/value-free errors. No new I/O/network/callback/executor/signer/library/verifier/state-discovery/defaults. Root learning, existing Pi addon/CLI, original source/assertions/deps/gates remain unchanged; one export-map entry expected.

## Closed host input and exact provenance
A closed input supplies experience_id, expected full5binding, safe task template (task_type/description/preconditions/postconditions/applicable_to), explicit dropped_count and bounded own-data Pi notification event array. No raw prompt/command/path/args/output/model/credential/receipt/body fields. Proxies/getters/inherited/custom/symbol/unknown/sparse/huge inputs reject before interpretation/coercion. Reuse existing conservative learning validators.

Recognize only this Pi addon notification schema: component pi, agent-start/agent-end/agent-settled/tool-execution-start/tool-execution-end, exact all5binding per event, safe emitted step/class/time/version fields. A trace run has one start/one settlement, at least one low-level end and1–16 complete distinct tool pairs. No duplicate/rebound/ambiguous/unmatched end/start, nonzero dropped_count, mixedrun/SHAs/policy/env, unknownresult/protocol/action or missing binding is silently repaired, filled or normalized into success. Final settlement is not task PASS. Array/disk order is NOT semantic execution order: deterministically sort tool starts by observed ts then safe step ID; ends retain originalpair/interval; equal-time/parallel ordering is display-only. Never invent dependence from list order.

## Safe Script/Step output
Output a deeply frozen dry-run draft, authorization:none/executable:false/current_verification: not-checked and shape-only provenance/digest. Observation contains exactly the existing ExperienceObservation input shape (NOT a current handle or serialized lifecycle status), original run/source/policy/env, caller-supplied new experience ID, timestampfromsettlement, safe host template and paired originalStepIDs. Script steps are bounded generated symbolic labels; Step.tool is safe target_class (never native tool text), action_description is generated metadata, expected_result is observed classification, check_fn_ids empty/on_failure stop/depends_on empty. All labels go through existing observation validation beforereturn. No semantic root-cause claim or model attribution.

Any failed/blocked observed tool may yield a bounded FailureObservation with reason unknown/stageexecution, actualpairedstep/time and generatedsafeID; do not call it tests/gate/guard failure or verified cause. Do not return classifiedFailureAnalysis as if it were raw failure input: the original learning.observe decoder expects FailureObservation without extra derived fields. Shape completeness proves input consistency, not truthful task/guardcoverage or signing/keycustody.

The host MAY explicitly feed draft.observation to its already configured genuine LearningLibrary.observe, then nominate using normal opaque identity. The draft factory does not fabricate verifier/keys or library, does not nominate/promote automatically, and cannot set verified/trusted. Copy/status flags cannot restore currentproof, retrievable selection, execution orbank permission. All observed/candidate states remain in original library contract.

## Acceptance
Preserve main test/runtime blobs and root CLI/API. Add regressions for eachclosed/bounded/privacy/input/provenance/pair/lifecycle/time/order/failure/adoption boundary and actualpublic tarball imports/strictconsumer types. Generated offlinefixtures only, no liveSDK/operatorrecords as tests; optional explicit parent-only actualCanary metadata readback is separate observation evidence, not ownerverification. Real ownerreceipts/public-keyprovenance stillMISSING; Stage3 remains the next dependency, not solved by trace shape.
