---
doc_type: guide
project: workspace
owner_repository: chenhaoxiang/pi-vista
status: active
truth_mode: maintained
created: 2026-10-08
verified: 2026-10-08
---

# Safe execution trace drafts — Stage2

`draftTraceExperience` from the explicit `@pi-vista/learning/trace` subpath is a
pure bounded projection of host-supplied safe Pi metadata into an existing
ExperienceObservation input. It performs no I/O, callbacks, discovery, signing,
verifier/library construction, execution, nomination or memory writes. Root
learning, Pi addon and readonly CLI behavior remain unchanged. This is a source
delivered through normal [PR #22](https://github.com/chenhaoxiang/pi-vista/pull/22),
with fresh complete independent source review, exact head/main CI and actual
source/consumer evidence. The [Stage2 closeout](handoff/2026-10-08-trace-candidates-source-closeout.md)
records those pins; no real owner or persistence acceptance is inferred.

## Input and refusal

Closed input: experience_id, expected full run/repo/SHA/policy/environment binding,
safe task template (task_type/description/preconditions/postconditions/applicable_to),
explicit dropped_count and5–64 event records. Conservative original learning
own-data/array/label/metadata decoders reject proxies, accessors, custom/inherited
objects, holes, symbols, unknown keys and unsafe/beyond-limit values without
coercing or traversing model/tool bodies. This is not a universal secret detector.

Only the Pi observation addon's five notification actions are accepted, exact
component pi/version0.1.0, all five bindings, generated run-scoped step IDs,
nonnegative safe timestamps, classified tool target and optional safe session
alias. Unsupported metadata fields (artifact/model/raw args/results/commands/
paths/receipts/status flags) reject. Every event must be same binding/session.
The trace requires exactly one agent start and settlement, at least one low-level
agent end and1–16 complete distinct start/end tool pairs inside that interval.
Duplicate/reused/unmatched IDs, class drift, chronology conflict, mixed binding,
unknown result, missing lifecycle and nonzero declared observation loss refuse.
No field/count/binding/time is fabricated to repair incomplete data.

Array/disk storage order is not execution order. Pairs display in observed start
timestamp then ASCII source step ID order; original completion pairing survives
out-of-order or overlapping operations. `depends_on` stays empty: a display sort
does not establish dependency. Final settlement and an `ok` tool are observations,
not whole-task PASS, complete guard coverage or verified fact.

## Draft and explicit lifecycle use

```ts
import { draftTraceExperience } from "@pi-vista/learning/trace";

const draft = draftTraceExperience({
  experience_id: "experience-new", expected: fullSafeBinding,
  task: safeHostTemplate, dropped_count: 0, events: safeBoundNotifications,
});
// authorization:none, executable:false, current_verification:not-checked
// basis:untrusted-input-shape-only, dependency_basis:not-inferred
const observed = explicitlyConfiguredLibrary.observe(draft.observation);
const candidate = explicitlyConfiguredLibrary.nominate(observed);
// Still only observed/candidate; no owner calls or bank writes are made here.
```

The deeply frozen detached observation has the original run/source binding,
explicit experience ID, settlement timestamp, validated safe template and paired
source steps. Native tool names never enter the Step: `tool` is target_class,
action text is generated metadata, `expected_result` is `observed-result-*`,
check IDs/dependencies are empty and on_failure is stop. It does not recommend
executing a logged action or authorize a retry.

Failed/blocked pairs may produce one bounded **raw FailureObservation** for the
first failure in deterministic display order, with the actual step/end timestamp,
stage execution and reason unknown. All outcomes remain in the pair list; later
failures are not claimed absent. No test/guard/gate cause, fix or verified root
cause is inferred. The original library derives only its observed hypotheses;
no derived analysis fields are smuggled back as raw observation input.

The draft is **not** an ExperienceHandle, serialized verified/trusted status or
private proof. Explicit library observe then nominate uses original opaque
lifecycle identities. Copy/draft/status inputs cannot pass current verification,
prepare promotion or recover a retrieval selection. Any higher state still needs
truthful fresh owner evidence; actual producer/key provenance is MISSING. This
module creates no dummy verifier to hide that gap.

`trace_digest` covers normalized safe observation/events as deterministic shape
provenance, not a signature or owner identity. Caller-supplied dropped_count0 is
not an attestation of true exhaustive coverage. Fully fabricated structurally
consistent metadata can produce only a non-authorizing draft; nobody treats it
as actual performance/safety truth. Inputs may be host observations, not receipts.

## Validation and stage boundary

Additive source tests cover original pair/time/binding preservation, parallel
reordering, raw failure/schema compatibility, explicit observed/candidate use,
no owner callbacks/higher-trust recovery, incomplete/lossy/hostile/sensitive input
refusal and deeply frozen outputs. Ordinary tests use synthetic fixtures only;
no actual operator session/model/profile/bank is input. Exact tarball consumers
and strict installed TypeScript are separate acceptance evidence.

Stage1 [actual canary closeout](handoff/2026-10-08-pi-agent-canary-source-closeout.md)
is delivered. Stage2 constructs only safe observations/candidates. Stage3 actual
owner producers/key provenance and Stage4 isolated real Hindsight are still
required before a usable verified persistence chain; copying this draft into a
bank cannot establish current proof. See [learning](learning.md),
[Pi observations](pi-observe-preview.md), [evidence](authoritative-evidence.md)
and [Stage2 design](../openspec/changes/pi-operational-rollout/stage2-trace-design.md).
