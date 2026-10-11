---
doc_type: spec
project: workspace
owner_repository: chenhaoxiang/pi-vista
status: active
truth_mode: maintained
created: 2026-10-11
verified: 2026-10-11
---

# Stage6 P0 admission and strict decision — source candidate

This slice is an offline metadata/fixture contract, not a default Pi entry, model
runtime, current proof, permission system, or a completed Stage6 pilot. It reuses
the existing paired fixtures and metric groundwork rather than the private draft
runtime. The original 16-call/8-session/0-bank INVALID assessment remains unchanged.

## Admission boundary

`scripts/stage6-admission.mjs` accepts only a closed trusted-host metadata DTO:
selected provider/model/thinking/SDK, harness and subject source identities,
history/broker digests, protected/volatile profile digest maps and the observed
pre-admission request count. Observed context must match an explicit expected
context; drift is classified separately as protected or volatile with unknown
actor attribution. A changed profile or mismatched context cannot become admitted.

This module does not read profiles, establish independent origin authenticity,
execute a provider, collect a current LOCAL proof, or claim that a metadata match
is real runtime evidence. Its status is `verification: metadata-only`,
`authorization: none`, `executable: false`. Invalid/unavailable input is refused
for this evaluation slice only; it does not block the user's primary task.

The budget accepts only a genuine in-process admitted object from this module,
not a copied/serialized boolean. Repeated requests for the same admitted object
return the same counter, so a second wrapper cannot reset its maximum. The limit
is per admitted object; a future host/planner must bind one object to the entire
pilot window and the existing aggregate parser separately rejects a total above
16. The counter remains non-executing and is not network interception. A future
actual host must bind it BEFORE the selected transport call and collect fresh
profile/source/SDK/broker/history facts; this is pending.

Admission carries `arm`/`guidance_mode`: baseline is explicitly `none` with null
`guidance_digest`, guided is `historical-observed` with a compiled-context digest.
`subject_history_digest` is the separate fixed subject/history anchor shared by
both arms, not the per-arm guidance digest. The future host owns protected-map
membership (stable SDK/broker/harness/subject/task/config identity) and volatile-map
membership (concurrent root/cache/session metadata). Both are explicit; any
changed member refuses this evaluation with a distinct classification. This
module supplies no implicit member selection or actor attribution.

## Structured decision and reference oracle

`scripts/stage6-decision-tool.mjs` exposes a fixed `stage6_decision` contract with
`case_id`, `decision` and `reason_code`, closed enums and
`additionalProperties: false`. The classifier accepts an actual structured tool
invocation; free-form text or JSON strings cannot be a decision. It keeps
`tool-not-called`, `schema-invalid`, `refusal`, `provider-error` and
`semantic-mismatch` separate from `decision-valid`.

The deterministic reference solver evaluates the existing synthetic metadata
fixture against its caller-pinned source/environment/required-metadata context;
validated `required_fields` drive missing/invalid metadata detection (including an
unexpected format version). Tests independently compare all four results with
the ancestor fixture truth table. The mock emits only the fixed tool call; it
never calls a model/judge. Outcomes are fixture correctness, not guard/gate/
financial permission or measured capability; importing changes no default tools,
prompt, model or thinking.

The structured `stage6_decision.arguments` object is the canonical new decision
source. The ancestor `strictPairedDecision` JSON-text helper is retained for old
metric/source compatibility, not as a way to satisfy the new decision contract.
The envelope is exactly `case_id/status/call/metadata/expected`; completed/refusal/
provider-error and cancellation/timeout/deadline/stream-disconnected preserve
separate non-success outcomes. An unsupported status grades schema-invalid.
Malformed envelope/case/pin raises a fixed contract error before grading and
remains the future host's invalid-trial path, not a primary-task failure.

## Trusted-host seam (source candidate only)

`scripts/stage6-host-admission.mjs` is an explicit caller-owned seam. It can
read only bounded file metadata through the already audited readonly canary
helpers, hash the metadata, collect two snapshots and pass them to the offline
admission contract. It does not read credential bytes, write profile files,
start a model, select a provider or install a Pi hook. Its stream binding wraps
the existing pretransport `streamFunction` boundary only when the caller supplies
a genuine admitted object and a single pilot-wide budget; it refuses copied
admissions, model/thinking drift, per-session over-budget calls and shutdown.
No current Stage6 planner or default Pi path imports this seam. Actual SDK,
broker, source-subject and history collection remain a separate acceptance task.

## Current validation and remaining work

- [ ] Offline fifteen new admission/decision/host cases pass locally; prior paired
  metric/planner cases also pass (31 combined). This is local candidate evidence,
  not independent review/CI/main delivery.
- [ ] Bind actual SDK/broker/source-subject/history collection and the shared
  pretransport seam. The current `invalid-input` reason is intentionally coarse
  for this source slice; later host diagnostics may split field-level reasons
  without changing refusal.
- [ ] Full source/consumer/Node20 gates, independent review, exact-head CI and
  ordinary PR/main delivery of this slice.
- [ ] Only after offline admission/reference/harness acceptance, define a fresh
  bounded actual pilot; no new model calls in this source slice.

## Research reuse

The design follows the existing Pi-Continuum plan. Public references are
[Do Eval](https://github.com/kreek/pi-do-eval),
[pi-evalset-lab](https://github.com/tryingET/pi-evalset-lab), and
[Anthropic's agent-evaluation guidance](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents):
fixed comparable tasks, separate harness/variant identities, deterministic
reference verification, and distinction between pass@k and pass^k. These are
ideas, not installed dependencies. No community SDK, LLM judge/voting path,
secondary ledger, service or approval chain is introduced.
