---
doc_type: spec
project: workspace
owner_repository: chenhaoxiang/pi-vista
status: active
truth_mode: maintained
created: 2026-10-10
verified: 2026-10-10
---

# Pi-Continuum implementation plan

The maintained architecture is `docs/pi-continuum.md`. This Change records the ordered
implementation gates without adding a service, permission system, model voting path or
second ledger.

## P0 / S0–S1

- [x] Define Policy / Execution / Evidence / Evaluation planes and one-way dependency (candidate in this worktree; pending independent PR/main readback).
- [x] Define independent permission/execution/verification/experience state dimensions (candidate in this worktree; pending independent PR/main readback).
- [x] Preserve Meta `ai-gate-observations/1`, exact merge SHA reconciliation and Vista closed-row boundary (candidate in this worktree; pending independent PR/main readback).
- [ ] Finish the new default-entry delta (not a repeat of delivered PR18/20): local EventStore wiring, fail-open storage, fixed diagnostics, actual SDK default-entry dispatch and missing-cwd/HEAD evidence.
- [ ] Record source, mock, installed SDK and actual selected-session runtime separately; do not call source compatibility default activation.

## P0 Stage6 admission (within the current user-authorized scope)

- [ ] Add profile before/after and protected/volatile drift classification with exact subject/history/harness digests.
- [ ] Add reference/mock solver and strict fixed decision tool (`additionalProperties: false`), distinguishing tool-not-called, schema-invalid, refusal, provider-error and semantic-mismatch.
- [ ] Preserve the existing 16-call INVALID artifact; no new model calls until admission/harness tests are green.

## P1/P2

- [ ] Validate reference grader offline, then k=1 paired evaluation with pass@1 and cost/latency accounting.
- [ ] Add context ROI and native-first non-degradation comparison before any guided context injection.
- [ ] Only after measured benefit, evaluate k=3, timeline/regression promotion, release and rollback scope.

Every checked task requires source tests where applicable, fresh review, exact CI and main readback. This Change is currently a docs/spec candidate pending its independent PR/main closeout; no result from synthetic, historical or sample compatibility evidence promotes itself to current permission, default activation, publication or financial authority.
