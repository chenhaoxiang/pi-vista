---
doc_type: spec
project: workspace
owner_repository: chenhaoxiang/pi-vista
status: active
truth_mode: maintained
created: 2026-10-12
verified: 2026-10-12
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
Its history digest is checked against the Stage6 context anchor; it does not read
LOCAL/Hindsight, restore old permission or establish ROI.

The K1 budget is a closed declaration: `k=1`, total max requests <=16, max per
session=2 and bounded deadline. Observed pre-admission model calls must be zero;
nonzero counts are preserved as `model-calls-before-admission`, not rewritten to
zero. `started_model_calls` stays zero because this module never starts a model.

## Provenance and refusal semantics

SDK/broker provenance is validated through the delivered
`validateStage6Provenance` collector contract; source, harness, context, artifact,
history and broker bindings remain distinct. Any mismatch, malformed history,
invalid budget, unexpected baseline history or prior model call returns a fixed
non-authorizing refusal. This affects only the future K1 evaluation window and
never blocks the primary Pi task.

This slice is intentionally source-only and no default entry imports it. Actual
K1 host wiring must still collect current source/history facts, bind one explicit
coordinator window, validate the final request envelope and preserve all
cancel/provider/drift/cleanup observations. The prior 16-call INVALID run is
exhausted and not reused.

## Acceptance status

- [x] Closed source DTO and synthetic admission tests: baseline/guided history
  boundary, exact subject/context/provenance relation, nonzero prior call,
  invalid budget, getters/proxies and non-authorizing outputs.
- [ ] Integrate with a fresh real SDK host window after matrix PR41/main and
  independent review; no model call is authorized by this source candidate.
- [ ] A future real K1 window requires concrete provider/model/SDK/source/history/
  budget facts and a separate current evidence chain. K3, ROI and release remain
  later decisions.
