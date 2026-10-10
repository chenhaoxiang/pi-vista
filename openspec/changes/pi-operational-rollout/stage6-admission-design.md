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
not a copied/serialized boolean. It bounds future attempts to at most16, but
remains a counter, not an executor or a claim of network interception. A future
actual host must bind this budget BEFORE its selected transport call and collect
fresh profile/source/SDK/broker/history facts. That wiring is still pending.

## Structured decision and reference oracle

`scripts/stage6-decision-tool.mjs` exposes a fixed `stage6_decision` contract with
`case_id`, `decision` and `reason_code`, closed enums and
`additionalProperties: false`. The classifier accepts an actual structured tool
invocation; free-form text or JSON strings cannot be a decision. It keeps
`tool-not-called`, `schema-invalid`, `refusal`, `provider-error` and
`semantic-mismatch` separate from `decision-valid`.

The deterministic reference solver evaluates the existing synthetic metadata
fixture against its host-owned source/environment/required-metadata context.
The mock provider emits only this fixed tool call; it does not call a model or
judge. These outcomes are fixture correctness, not guard/gate/financial permission
or measured model capability. No default tool, prompt, model or thinking change
is made by importing this module.

## Current validation and remaining work

- [ ] Offline initial nine new contract/fixture cases pass locally; prior paired
  metric/planner cases also pass (25 combined). This is local candidate evidence,
  not independent review/CI/main delivery.
- [ ] Add adversarial copied-budget/getter/proxy/missing-fact/source drift cases
  and bind the actual trusted-host readonly collection/pretransport seam.
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
