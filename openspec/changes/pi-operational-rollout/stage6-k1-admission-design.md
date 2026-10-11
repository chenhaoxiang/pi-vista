---
doc_type: spec
project: workspace
owner_repository: chenhaoxiang/pi-vista
status: active
truth_mode: maintained
created: 2026-10-11
verified: 2026-10-11
---

# Stage6 K1 admission — source candidate

This source slice defines a metadata-only K1 admission envelope after the
model-free native matrix. It does not execute a provider, read a bank, read
credential bytes, inject Pi guidance or grant permission. It reuses the existing
Stage6 context/provenance contracts and keeps the old public1.0.4 paired metric
schema unchanged.

## Baseline and guided history boundary

Baseline requires `arm=baseline`, `guidance_mode=none`, null guidance digest and
no history DTO. Guided requires `arm=guided`, `guidance_mode=historical-observed`,
a matching synthetic context digest and a historical-only DTO with
`current_verification=not-checked`, `authorization=none`, `executable=false`,
subject source binding, content digest, bounded character count and provenance
digests. The DTO is detached metadata, not a verifier handle or current proof.
`content_digest` is compared with the accepted subject-history anchor
`context.subject_history_digest`; it is not evidence of a current LOCAL/Hindsight
readback. `context_digest` binds the guided block separately. The retained
`provenance_digests` are validated only as bounded digest labels, not authenticated
sources. The future K1 host wiring, as the caller of `openStage6Pilot`, remains responsible
for selecting the accepted subject-history anchor and assigning the window-common
versus arm-specific labels; this source slice checks equality and shape only. It does not require those two
context labels to differ. This module does not read LOCAL/Hindsight, restore old
permission or establish ROI.

The K1 budget is a closed declaration: `k=1`, total max requests <=16, max per
session=2 and a deliberate `deadline_ms` range of 1000–1,200,000ms. Historical
context is deliberately bounded to 8192 characters, even though the lower-level
coordinator/learning seams accept some broader ranges. These are K1 data-contract
bounds, not a new primary-task gate. The declaration creates no counter and
enforces no transport limit; the delivered whole-window coordinator remains the
one pilot budget owner.
Observed pre-admission model calls must be zero. After closed-input and count
validation, a nonzero count is returned immediately as `model-calls-before-admission`
before any nested context/provenance/history/budget inspection; it is not rewritten
to zero. Malformed outer, count or nested DTO data returns `invalid-input` with
`model_calls: null` rather
than claiming a count was observed. `started_model_calls` stays zero because this
module never starts a model.

## Provenance and refusal semantics

SDK/broker provenance is validated through the delivered
`validateStage6Provenance` collector contract and cross-checked for SDK match/version,
broker match/provider/command digest, subject source, history and harness source.
The remaining run/repo/policy/environment/artifact binding labels are validated by
that existing DTO validator, not authenticated or compared with a separate host
snapshot here. `bindings.context_digest` is the common provenance context label;
the arm-specific compiled guidance remains `history.context_digest`. Neither
label is silently substituted for source/history/artifact. Any mismatch, malformed history,
invalid budget, unexpected baseline history or prior model call returns a fixed
non-authorizing refusal. This affects only the future K1 evaluation window and
never blocks the primary Pi task.

This slice is intentionally source-only and no default entry imports it. Actual
K1 host wiring must still collect current source/history facts, bind one explicit
coordinator window, validate the final request envelope and preserve all
cancel/provider/drift/cleanup observations. The prior 16-call INVALID run is
exhausted and not reused.

## Acceptance status

- [x] Closed source DTO and synthetic admission tests in this candidate:
  baseline/guided history boundary, subject/context/provenance cross-checks,
  nonzero prior call, invalid budget, getters/proxies and non-authorizing outputs.
  A broker/provider/harness mismatch regression was reproduced red before the
  source correction, then green after it. The local self-reported logs are retained
  at `tmp/k1-admission/provenance-before.log` and
  `tmp/k1-admission/provenance-after.log`; they are not independent review or CI
  evidence. The retained initial `9fd67af` source received independent
  `OK with notes` (0 P0/P1, four report-only P2s). This follow-up documents K1
  bounds and host responsibility, prioritizes prior calls, and adds a non-token
  assertion. `tmp/k1-admission/priority-before.log` records 7/8 against the original
  `9fd67af` source; `priority-after.log` is 8/8 on the corrected source. The
  sequence is `9c96564` initial mismatch red → `9fd67af` prior reviewed head →
  `ea0b3f0` this follow-up. These ignored local snapshots are not hash-bound
  deliverables or independent reviewer/CI evidence; they are parent-executed
  local regressions only.
- [ ] Fresh independent source review, exact-head source/consumer/Node20 CI,
  ordinary PR43/main inclusion and readback remain pending at preparation.
- [ ] Integrate with a fresh real SDK host window after source delivery. The
  metadata DTO supplies no execution authorization; existing user authorization
  is separate and is not renewed per implementation step.
- [ ] A future real K1 window requires concrete provider/model/SDK/source/history/
  budget facts and a separate current evidence chain. K3, ROI and release remain
  later decisions.
