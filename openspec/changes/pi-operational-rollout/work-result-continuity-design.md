---
doc_type: spec
project: workspace
owner_repository: chenhaoxiang/pi-vista
status: active
truth_mode: maintained
created: 2026-11-04
verified: 2026-11-04
verification_scope: Current continuity API and local source/package evidence; no independent-review, shared-delivery, installation or benefit acceptance
---

# Work result continuity: first explicit owner path

## Goal and scope

The approved v0.3 first path is quality-first WorkItem → existing run/result → owner verification → scoped delivery. WorkItem means an existing owner record, not a new store. The local Phase A/B source candidate reuses GovernanceReceipt and GovernanceHandoff. Implementation, retained local validation and shared delivery remain separate: the Pi adapter is an explicit read-only helper, not a published/installed/default path, and does not run workers, mutate tasks, grant permission, acknowledge business completion or install itself.

Hindsight, including its source/retention/index/query/refresh/configuration and surrounding directory/prompt processing, is out of scope and unchanged. Do not start or resume historical jobs, change providers/models, or introduce a central runner, task database, mandatory gate, periodic collector or signing system.

## Work reference and binding

A closed work reference identifies an owner repository, record kind and stable key. Document keys are opaque owner-local aliases, never private paths. The host resolves them using its existing owner record; the adapter never scans repositories or histories. Missing/ambiguous owner information stays unknown.

One binding identifies work reference, stage, run, session, revision and optional exact source head. Code claims require an exact head. Run replacement does not replace the work reference. References do not grant access or establish provenance by themselves.

## First-path API

The candidate exports opt-in work snapshots, pure consumption, an explicit owner reader and a handoff observer from `@pi-vista/adapter-pi`. `readPiOwnerResult({binding, resultRef}, {readOwner, timeoutMs?, now?})` reads a current owner snapshot through an explicitly injected read-only callback and returns a bounded non-authorizing observation. `consumePiOwnerResult(expectedBinding, ownerReadback, now?)` performs the same metadata check without I/O. The owner callback is trusted host code backed by original records, not model-supplied executable code. It supplies the current binding, acceptance disposition, applicable source kind/reference, required evidence declarations and native required-effect references/outcomes. No default reader, store, model, network, filesystem discovery or task writer is installed.

The source contract remains:

- snapshot closed own-data metadata without invoking input getters;
- bind the reported result and owner snapshot to work/run/session/revision/stage/head;
- distinguish pending/unknown/failed/cancelled/owner-confirmed delivery;
- require this stage's declared checks/effects, not global pending work;
- use matching fresh validated owner evidence for declared evidence IDs; a copied flag or worker claim is not an owner readback;
- preserve result references for superseded/unknown results; never mutate successor state or replay effects;
- return authorization:none and readOnly:true, never an execution/Gate/opaque-proof handle;
- bound optional observer reads and sink waits and fail open on observer failure, without cancelling underlying work;
- never call Hindsight or alter canonical Pi transcripts.

The callback is a trusted-host boundary, not hostile-code isolation or an independent signature verifier. Its returned metadata is an owner-reported readback, not a universal truth certificate. Hosts still use original Gate/business/artifact/report acceptance rules before their own delivery. The async read wait defaults to 250 ms and accepts integer 0–30,000 ms; timeout does not abort underlying work, late outcomes do not alter the returned observation, and synchronous callback execution cannot be preempted. Public signatures, exact accepted evidence kinds and a small trusted-host wiring example are maintained in the [Pi adapter guide](../../../docs/adapters/pi.md#explicit-work-result-continuity-local-source-candidate).

## Completion semantics

A run reaching a terminal state does not prove success. A stage can be reported as owner-confirmed only when the applicable owner reports acceptance, the current binding is unchanged, required evidence is current and matching, and required effects meet the stage's expected results. Unknown/failed/cancelled/pending required effects cannot be upgraded to successful delivery. A report/design task may satisfy its own original acceptance without a code Gate. Receiving/reading a result is not authority or a claim that the user has seen it.

The current public candidate makes the source/acceptance distinction explicit. `snapshotPiWorkRef` freezes an existing owner namespace/kind/stable key; `snapshotPiWorkBinding` adds stage, run, session, revision and optional exact head. `consumePiOwnerResult` only checks a supplied owner readback, while `readPiOwnerResult` asks an explicitly injected trusted host to resolve one existing result/receipt alias before applying that check. `observePiWorkHandoff` relates an existing packet to a fresh successor. None scans for work, authenticates an origin independently, writes a task, resumes execution, replays an effect, grants permission or turns metadata flags into a Gate.

The original owner supplies the complete required set for the stage: `sourceKind`/`sourceRef`, disposition, bounded observed/fresh-until timestamps, required evidence IDs with kind/source/claims, original evidence records, and native required-effect refs/outcomes/dispositions. The candidate accepts `code`, `artifact`, `business` and `report` source kinds with their closed applicable evidence sets. Code requires an exact head and matching evidence SHA; artifact/business/report use their own original artifact/provider/report/readback/reconcile sources rather than a universal CI substitute. A non-report stage with no required evidence is not complete; a report can satisfy its own original acceptance without CI if that is genuinely its declared contract. Every declared effect must match the full binding and be `settled` plus owner-`accepted`. Other work, advisory checks and later stages remain separate pending.

Owner `observedAt`/`freshUntil` and selected evidence `observed_at`/`fresh_until` use exact UTC millisecond ISO timestamps (`YYYY-MM-DDTHH:mm:ss.sssZ`) and finite expiry; validity is `observed <= now < expiry`, with evidence not newer than the owner snapshot. Future, expired, missing/unbounded evidence expiry, duplicate applicable IDs, counterevidence and current same-source/claim conflict remain unknown/reconcile-required. This finite-window check is applicability metadata, not source authentication. A copied `validated` flag, current timestamp, result packet or callback return cannot replace the original owner's authenticity, Gate, business, artifact or report acceptance.

Fresh handoff reuses the existing packet and an explicit successor binding. Separate a late result artifact, a late real effect and an obsolete state write. Keep original references; only obsolete updates are fenced. Existing native references suffice for reconciliation; no universal new effect ID is required. Questions and still-valid answers belong to the original work and are not invalidated solely by changing run.

### Controlled successor semantics

`observePiWorkHandoff` requires the same owner work/kind/key and stage, with a different run **and** session. The packet's original `run_id`/`run_revision` (and optional source session) must match the previous binding. Successor revision is local to that new run; the helper does not compare revisions across runs. It preserves packet accepted-fact, unresolved-effect and blocker references and its next action, but always returns `currentVerification: not_checked`, `sourceHeadRecheckRequired: true`, `authorization: none`, `executable: false` and `readOnly: true`. A packet flag does not prove that the successor read the current head.

The helper does not restore execution or discard an original run's real late effect. Old artifacts remain attached to their original result/run; native owner fencing must prevent obsolete writes from overwriting successor state, while owner reconciliation retains late effects and unresolved references. Intercom question semantics and Desk/Schedule successor wiring are later Todo #33, not a requirement to expand this first path.

## Validation order

A. Closed work/binding/source validation and normal result consumption, including missing/foreign/stale evidence, required versus unrelated pending and observer failure.

B. Controlled handoff using synthetic or frozen metadata: successor identity, unresolved effects, late results, stale source, unchanged original packets, and no extra execution or approval. Do not interrupt a real business task for a test.

Then public-import integration using the existing Pi context/receipt sink, actual source and packed-consumer gates, a bounded original-owner/native path where available, independent exact-candidate review and normal PR delivery. Source/fixture/host integration/pilot/installation remain separate claims. Use only synthetic logs in repository tests.

## Retained local validation and open delivery

The preceding worker's report and the parent's retained raw-tool-result projection support final Phase A targeted 30/30, adapter 73/73 and public owner-result integration 2/2. The 73/73 adapter run belongs to that Phase A window, not a combined post-Phase-B suite. The report also preserves an initial 26/30 reader attempt and late unhandled rejection, corrected before the final retained runs. The parent's supplied Phase B results are handoff unit 7/7 and public successor integration 2/2. This documentation continuation does not rerun these tests; they are local synthetic/source-host evidence, not formal independent review or business acceptance.

The parent's limited native owner readback of the actual preceding worker confirms execution ended and its report is readable (`implementation-report-received`, `deliverable`/`accepted`). The separate `source-shared-delivery` readback remains `reconcile_required`/`unknown` (`owner_outcome_unknown`), with formal source review still required; a foreign-work read is rejected as `binding_mismatch`. This accepts the report's own delivery scope, not its external source/business claims. The necessary fresh documentation continuation stays on the same WorkItem/source stage, preserves the prior run/report/failures and candidate source, and does not resume the old execution.

The combined candidate subsequently passed the actual Node20.20.2 source gate: all 11 workspace builds/typechecks/tests, public integration, release-script regressions and pack inventories. A real isolated consumer installed 11 exact local tarballs and checked 23 public entrypoints, including typed/runtime calls to the new result and handoff APIs. The local evidence is retained under this worktree's `tmp/release-contract/`; it is engineering evidence, not hosted CI or deployment.

Formal independent exact-head review, normal PR/CI/merge and post-merge state are separate delivery facts and must be read from their original sources. Installation/default runtime wiring and actual business/provider/quality-benefit acceptance are not implied. Candidate source/API presence and retained synthetic counts must not be described as published, installed or default-running. No Hindsight or surrounding memory path changed.

## Entry conditions and rollback

A host opts into the helper explicitly. If references, owner readback or observation fail, return unknown for the observation and leave the original execution/owner Gate unchanged. On actual regression disable the added wiring while retaining original runs, results and in-flight references. Do not clean history, replay old actions, weaken required checks or block independent tasks.
