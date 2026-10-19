---
doc_type: spec
project: workspace
owner_repository: chenhaoxiang/pi-vista
status: active
truth_mode: maintained
created: 2026-10-10
verified: 2026-10-18
verification_scope: Existing delivery-status boundaries plus opt-in closed phase-counter source contract; runtime observations retain original scope and date
---

# Pi-Continuum implementation plan

The maintained architecture is `docs/pi-continuum.md`. This Change records the ordered
implementation gates without adding a service, permission system, model voting path or
second ledger.

## P0 / S0–S1

- [x] Define Policy / Execution / Evidence / Evaluation planes and one-way dependency; PR33 delivered the architecture to main `abdb0ef7`.
- [x] Define independent permission/execution/verification/experience state dimensions; included in the same PR33 source contract.
- [x] Preserve Meta `ai-gate-observations/1`, exact merge SHA reconciliation and Vista closed-row boundary; included in PR33, not permission restoration.
- [x] Deliver the default-entry delta: PR34 source wiring, then PR55 fixed notification-only installation and PR56 shared evidence/main `7faefc0b` cover local EventStore, fail-open faults, actual SDK discovery and missing-HEAD behavior.
- [x] Separate source/mock, actual installed-file readback and isolated fresh-session SDK loading in [the existing closeout](../../../docs/handoff/2026-10-14-local-observer-install-closeout.md). No forced reload or all-session/live-global-event claim; default LOCAL/history/guidance remains outside this delivery.

## P0 Stage6 admission (within the current user-authorized scope)

- [x] Deliver profile before/after, protected/volatile drift classification and exact subject/history/harness digests in PR35; PR37/38 delivered the trusted-host whole-window source and shared evidence.
- [x] Deliver reference/mock solver and strict fixed decision tool (`additionalProperties: false`) in PR35, distinguishing tool-not-called, schema-invalid, refusal, provider-error and semantic-mismatch.
- [x] Preserve the old 16-call INVALID artifact. The later accepted K1 window recorded by PR52 is separate; this reconciliation neither reuses the invalid run nor authorizes another model call.

## Existing safe measurement outlet (2026-10-20 successor)

Reuse public PiRunContext/ArtifactRef.stats for an opt-in closed host projection of
initialization, request-first-token, generation, tool, build-test, review-ci and
Subagents aggregate counters. Run/child/session identity stays distinct; no whole
raw metadata/status, model content, command or artifact body enters the adapter.
Missing phase data stays unknown, measured zeros stay zeros and zero SDK cost is
unpriced; timing/process exit is not task success, verification or permission.
Observer errors fail open. No collector, per-token persistence, new event schema,
ledger, default structured/guided contract, runtime installation or model trial.
Validation uses synthetic supplied counters, rejected input and existing public
EventStore/CLI/packed consumer gates; source, CI/main and active loading remain
separate. Detailed maintained contract: `docs/adapters/pi.md`.

## P1/P2

- [x] Validate the reference grader and deliver one bounded actual k=1 window; PR52/main `7b8ed451` records baseline/guided4/4, strict8/8, tokens6415→10251, elapsed observations and unpriced cost/null. This is not generalized effectiveness or billing evidence.
- [x] Deliver offline context ROI/candidate analysis via PR53/54; no observed semantic gain and +59.8% tokens yields `not-beneficial/do-not-inject`. The shorter symbolic candidate has not been model-evaluated.
- [ ] Establish broader effectiveness/long-term ROI before considering k=3, timeline/regression promotion, release and rollback scope; no automatic experiment, activation or publication follows from the bounded result.

Current status is reconciled as of2026-10-18 through the merged PRs linked in
[the maintained architecture](../../../docs/pi-continuum.md#7-已知事实和仍未完成)
and existing scoped handoffs. Preparation-time pending statements remain in their
historical snapshots, not as instructions to repeat completed work. Source tests,
review, CI/main, actual runtime and installation retain distinct evidence levels;
none restores current permission, default guidance, publication or financial authority.
