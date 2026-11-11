---
doc_type: spec
project: workspace
owner_repository: chenhaoxiang/pi-vista
status: active
truth_mode: maintained
created: 2026-11-04
verified: 2026-11-04
verification_scope: Continuity APIs and fresh-session host local-pilot contract; host-increment review, installation and business benefit remain separate
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

## Selected fresh-session host continuation

After PR67, the user selected self-run low-risk pilot validation followed by default loading for **new** Pi sessions, without reloading active sessions or changing Hindsight. `scripts/pi-work-observer.mjs` is the bounded host increment, separate from the already installed notification-only shim. It uses the existing EventStore and public continuity APIs, not another task database or execution owner.

The fixed loader receives `fresh_sessions_since` in exact UTC milliseconds. The host reads only native session header metadata and ID. Pre-cohort/resumed-old sessions are excluded; native event processing never reads a branch, prompt, tool body, transcript, user question or Hindsight path. Current Todo structured snapshots provide numeric ID/status changes only. Subjects, descriptions, owners and metadata are not copied. Session-local hashed traces are observational aliases (clear/reload may create a new scope), not a replacement stable WorkItem. `completed` is always `native_todo_completed_unverified`/unknown, never a code/business acceptance declaration.

Trusted same-process owners can emit `pi-vista:owner-result` with `{hostSessionId,reference,readOwner,onObservation?}`. The explicit original-record callback uses `readPiOwnerResult`; matching a host session only routes the request, not authentication. A reader may inspect a child's binding distinct from the current host. `pi-vista:work-handoff` accepts `{hostSessionId,reference,onObservation?}` and delegates to the existing observation API. No native owner producer is silently installed: a missing producer yields no acceptance claim. `/vista-work-status` exposes coverage counts, unresolved results, unavailable observations and this limitation without adding a model tool or prompt instruction.

Notification handlers never await the read/storage path. Owner reads use the maintained 250ms observation deadline, with at most32 pending requests per current session; asynchronous EventStore appends have at most64 pending writes. Saturation loses an observation with bounded diagnostics, never native work. Diagnostics are fixed and emitted at most once per session. Underlying trusted synchronous callbacks cannot be preempted, just as in the public API. A late read writes safe metadata under the old observer identity but cannot callback into a replacement session. Raw artifacts/effects stay with the native owner; observing a handoff does not implement native takeover/fencing or successor verification.

Installation is a separate fixed runtime/shim using the existing offline builder with `entry_name: pi-work-observer.mjs`. It does not overwrite or update the notification-only shim, its pinned old runtime or existing observations. A current exact default-entry/SDK discovery check and the selected real report/Todo trial must pass before this additional loader is installed. Rollback removes/restores only this exact added entry for future loads; active sessions and original metadata remain untouched. Source, isolated SDK dispatch, actual report-original readback, local installation and broad natural-task benefit remain separate evidence levels. The SDK harness uses synthetic provider streams and zero model transport, not real provider acceptance or general task ROI.

## Native Subagents owner producer (long-term work package48)

PR68's fresh-host receiver is extended with an owner-specific adapter over native `subagent` launch results, exact `bg_wait.details.completions` originals and `subagent:async-complete` / `subagent:process-terminal` notifications. The producer does not install a new runner or RPC method, call status reconciliation, read session transcripts, enumerate mission stores or rewrite native state. Subagents remains the mission/run/artifact authority. The first supported path is a single asynchronous native child with an attached mission, not arbitrary workflows or external agents.

A launch result must provide the native mission ID/path, run ID and exact async directory. The work reference is the existing `chenhaoxiang/pi-subagents` task/mission ID, not a new Vista task. `sessionId` is the native header ID. Subagents currently uses `getSessionFile() ?? getSessionId()` as its owner identity, so the adapter retains that exact host-supplied private reference separately for comparing mission/status/event ownership; it neither reads the transcript nor exports the path. Revision0 identifies this run's adapter projection, not a claimed native revision counter. On completion the adapter re-reads that exact mission and `status.json`, checks parent/run/mode and native lifecycle version3, unique mission run membership, observed process terminal and successful sole step. The completion selects one explicit native artifact metadata file and output; metadata must match the exact run, header parent ID, child index0, successful exit and output/metadata paths before output bytes are read. Mission status/artifact projections can lag native completion and are not substituted for the native runtime or artifact original. A mission remains active if its task acceptance is not settled; observing a readable output does not rewrite it. Reads accept same-user regular files, reject a symlink at the selected file, bound size and detect file changes. Trusted owner-selected ancestor paths may include the native macOS `/var` system alias; this is not hostile-filesystem or OS sandboxing. Same-user file checks currently target POSIX; where `process.getuid` is unavailable, observation stays unknown rather than bypassing the check. No private path/content becomes protocol metadata.

### Explicit mission reuse from another parent

A normal native single launch may explicitly reuse an existing mission via `missionId` (flat legacy input) or `options.missionId`. Native `prepareMissionLaunch` retains the mission's creation-time `ownerSessionId`; the new run's status owner and artifact metadata parent identify its actual current parent. This is not resume, takeover, old-run adoption or a new recovery service. The same work reference can therefore have new runs with different real session bindings; old artifacts and task acceptance stay with the original owner.

The host snapshots only descriptor-checked ordinary-single shape, explicit mission ID and native launch identity from SDK `tool_result.input`/`details`. It does not read or retain task/model/cwd values, result bodies or mutable event objects, return a middleware patch, invoke getters, perform IO or start a wait in that handler. SDK1.5 `tool_execution_end` has no input/args; the existing end notification confirms the same call and launch identity with no error/mission warning before the first original read. This final check matters because `tool_result` handlers run in load order and later handlers can replace details or error state. The pending snapshot uses the existing bounded run record, not a start/end cache or another map. Identical result/end notifications do not add reads, and a late result cannot upgrade an earlier end-only association. Tree navigation invalidates unfinalized explicit intent; session start/shutdown resets it. Completed observations retain the existing display-epoch and late-read fencing.

Only the cross-creation-owner branch additionally reads the current run's `asyncDir/mission.json`: schemaVersion1, exact missionId, `autoCreated:false` and `missionDir/<missionId>.json` equal to the selected missionPath. A unique ledger link must match runId/mode=single/asyncDir. Native status version3 must match current owner, run and toolCallId, with no resume/nested/workflow-parent marker; the existing process/step and exact metadata run/current header parent/index/exit/output checks still apply. The sidecar digest joins the readback evidence. `autoCreated:false` alone is insufficient because explicit mission creation uses it too. Missing/malformed/automatic/foreign originals or absent explicit request evidence stay unknown. The same-owner original path adds no file IO or sidecar requirement; `bg_wait` and Todo paths are unchanged.

These are trusted-host, same-user original observations, not hostile-extension isolation or origin authentication. Another trusted extension can mutate inputs before execution or before this observer; the captured request is the SDK input at this handler, not proof of untouched model output. Later input mutation does not rebind the captured run. Final result contradiction or any native-original mismatch refuses the cross-owner observation without changing native execution, permissions, lease, capability or business acceptance. The public completed-observation DTO/version and reporting stage remain unchanged.

The resulting stage is narrowly named `subagent-output-available`: accepted means an existing native result artifact was read and bound, **not** that the original engineering/business/report objective passed. `taskAcceptance:not-checked` remains visible; an independent review-required run can still have an available artifact. Failed/stopped native originals remain failed/reportable, pending/unknown/missing/foreign/substituted originals remain unresolved. Parent notifications and result text remain unchanged. `/vista-work-status` shows the bounded recent work/run/stage observations so artifact receipt is not confused with code/business delivery; saved events carry the stage alias and hashed work reference. Aggregate `deliverable` counts accepted observations across stages, not accepted business tasks; consumers must retain the stage dimension.

Repeated identical state+artifact-reference completion signals are deduplicated within the live observer, including duplicate native notification/wait return for the same output. A native wait is only observed when a caller already used it; this adapter never starts waits or new model turns. Early completion before the launch return is buffered only as bounded identity/reference metadata and is read only after association. There are at most256 bounded associated records, including result snapshots awaiting finalized end,64 early signals and32 unique completion fingerprints per run; overflow is a coverage diagnostic, not a task gate. No exactly-once across process restart is claimed. After session replacement the old read may retain its original observation, but it cannot call the replacement consumer; real native artifacts/effects stay with their owner. Host publication refusal clears the local pending flag rather than falsely calling the read successful.

This producer is an additive host seam in the source-bound work runtime; the release manifest pins its helper alongside the existing entry. It does not alter `packages/learning`, Hindsight source/configuration/query/archive/prompt/directory paths, old notification-only entry, model/tool policy or Subagents source. Git/CI/Gate original acceptance belongs to the separate work package49, and cross-session/native recovery belongs to50; neither is declared complete by an available artifact. Tests use synthetic owner files and native events; any real task pilot is retained separately under local tmp and never enters repository test fixtures.

## Explicit source-owner acceptance (long-term work package49)

`scripts/pi-code-owner.mjs` is an opt-in trusted-host original reader, not the offline public Vista CLI or a new model tool/default network observer. The operator supplies one private contract with an existing binding (`stageId:source-shared-delivery`, exact head), repository/PR/base, complete original required head-check names and App IDs (plus review-record hash when applicable), merge-workflow names and exact original Gate report file. The caller remains responsible for the complete requirements and genuine Gate artifact provenance; arbitrary JSON is not an authenticated owner signature.

The default host path uses existing `gh` authentication for bounded fixed GitHub GET routes only: PR identity, exact-head checks, exact-merge push workflows, base ancestry and one final PR-binding re-read followed by a single required-check/workflow fingerprint re-read. This is a finite snapshot bracket, not polling or a guarantee against changes after the final read. Check summaries are projected only to matching declared review hashes before returning from `gh`; arbitrary long CI summaries are not loaded. It reads a bounded same-user regular Gate original, allowing its existing human-log prefix, without executing or reconciling Gate. Collections above100 entries, incomplete pagination, missing required evidence, new matching pending/failed checks, wrong App/review hash, different repo/head/base/merge or changed final PR binding stay unknown. Unrelated advisory pending is not a new barrier. There is no retry loop, polling, merge/write request, history scan, credential export or raw GitHub/error/Gate contents in the returned DTO.

The existing Gate's `evidence_readiness.binding` and execution observations must match source/head/base/merge, with original admitted evaluation, actual merge-observed and postmerge-ci success. Its evaluation time must precede the actual merge. A later evaluation, already-merged result or reconcile-only record cannot establish that historical premerge evidence. This is a fact check, not a new requirement to rerun Gate or obtain a new approval. Missing originals mean this observation is incomplete even when the source is genuinely merged; they do not retroactively declare business execution failed.

The reader creates scoped evidence/effect metadata and delegates acceptance to `consumePiOwnerResult`. The accepted observation has authorization:none and readOnly:true, only source-shared-delivery scope; it proves neither installation, deployment, business/provider acceptance nor ROI. `observeCodeOwner(contract,{readGitHub,readGate,now})` exposes trusted I/O seams for synthetic tests and existing host producers. The standalone `node scripts/pi-code-owner.mjs --contract=<private owner contract>` requires explicit invocation; it is not wired onto arbitrary Bash output or every task, and does not change the public `vista` CLI's offline contract. Optional `--record` appends only safe stage/work/head metadata to the existing EventStore and confirms the exact new event by readback; append returning without error is not treated as persistence proof. Observer storage failure does not alter original-source acceptance or become a task gate.

Local verification retains one actual PR68 original-read positive and a PR69 postmerge-evaluation negative, with no new merge/CI/model effect. The PR69 Gate command was accidentally invoked again after already-confirmed delivery and overwrote the same log; the later file is kept as postmerge-only, not upgraded to the original evaluation. The original native merge is still confirmed. Tests use synthetic GitHub/Gate records only; real readback files remain local tmp. Cross-owner requirement policies and daily default source-producer wiring remain further adoption work, not claimed by this explicit reader.

## Independent code-owner adoption: Pi Desk (batch83)

The existing explicit host contract may select `repositoryReview:{commentId,author,bodySha256}` instead of `gateReportFile` only for the already-independent `chenhaoxiang/pi-desk` owner. This is not a universal policy registry, missing-Gate fallback or permission/merge gate. The original Meta-Gate path is unchanged, and a new-mode contract for another repository or one containing both acceptance sources is rejected before IO.

The host supplies the complete original CI/App and postmerge workflow requirements and pins a review comment it has genuinely inspected and accepted after resolving findings. A body hash is content identity, not review authority or a classifier: the reader never parses review prose into a verdict, derives reviewer identity/model provenance, or supplies the owner’s missing acceptance decision. Exact returned comment ID/author/PR URL/head reference/body digest and premerge creation/update dates are checked; the comment is re-read and must remain identical. Review bodies and host-private paths do not enter outgoing DTOs. The normal bracket still checks exact PR/head/base/merge, applicable checks/workflows and containment. This merged path adds two fixed review GETs, bounded to10 total and256KiB review body, without changing the60s host observation deadline or allowing background polling. Missing/edited/postmerge/wrong originals stay unknown; the reader neither creates a fake Gate nor replays a completed PR.

No wire/UI expansion is needed: the existing source-only progress/terminal lanes remain separate, original time and binding/reporting identities are preserved, and `work.refresh` is still one immutable memory query with zero owner reads. Compatibility tests cover the unchanged strict Gate path and independent positive/negative originals; operational current-source readback is separately retained under local tmp. Installation/default selection/loaded/GUI and business delivery remain distinct.

## Completed-observation client export (long-term work package52 / slice60)

The host adds only an in-memory, same-process request/reply and completion/reset notification over the already-produced PiResultConsumption and PiWorkHandoffObservation. The [v1 transport contract](../../../docs/adapters/pi.md#same-process-completed-observation-export-v1-host-candidate) is the event/payload SSOT. It preserves reporting host versus result binding identities, fixed completed-observation timestamps, per-instance/scope epochs and monotonic observation sequence, a16-entry window and explicit coverage/omissions. It is not another work/task schema, authenticated authority, native task revision or new storage.

Queries never run readOwner, source IO, verification, models, persistence or task effects, and never refresh observedAt or synthesize freshUntil. Session/tree resets fence late completions from the new display scope without cancelling the owner operation or discarding original metadata. Shutdown publishes unavailable, clears memory and stops replies. Consumer/listener failure cannot upgrade acceptance or block native execution. All source/install/consumer adoption remains separately evidenced; the already installed older work runtime gains no endpoint until explicitly upgraded. Hindsight, notification-only entry, cohort cutoff and original source/business acceptance remain unchanged.

## Pi LobeHub independent-owner adoption (2026-11-11)

The existing repository-review reader now additionally accepts the exact `chenhaoxiang/pi-lobehub` repository. Its owner has explicitly selected Web and authorised scoped work/engineering consumption through the same reader; its independent PR/check/review contract does not use Meta Gate. No prefix matching, caller-defined repository policy, missing-Gate fallback or relaxation for Meta-Gate repositories is added.

All batch83 original-review constraints remain: trusted owner selection and resolved findings, exact pinned review body/author/PR/head and premerge timestamps, two original reads, exact CI/App requirements, postmerge workflows, base containment and at most10 fixed public GETs. The progress/readback shapes remain unchanged, source-only and non-authorising. This is source support for the existing reader, not Web Task binding, daily observer installation/reload, a new model tool or P5 business acceptance. The previous Desk-only batch83 scope remains its historical adoption record; this paragraph states the additional current adoption.

## Explicit code-stage progress (batch81 frozen producer/Desk contract)

The selected real object is this ordinary Vista engineering PR, using its actual
Meta Gate/required-check contract. The existing result DTO is terminal and a
handoff needs a different run and session; neither represents daily progress.
An independent optional **`snapshot.codeProgress`** sidecar therefore extends the
existing work-observation v1 reply/changed envelope. It does not add a query,
change the old observations array/kinds, or advance the old seq/coverage/omitted
when only progress changes. Old clients that project the existing top-level
fields keep their original result/handoff view. A new consumer validates and
compares each lane separately; missing/invalid progress is local unknown, never
a reason to discard an otherwise valid old result. Retained progress must be
marked last-known/stale rather than current when its source is unavailable.

```ts
type CodeProgress = {
  version: 1; source: "explicit-code-owner";
  seq: number; coverage: "not-observed" | "observed" | "not-applicable" | "unavailable";
  observations: readonly CodeProgressRow[]; omitted: number;
};
type CodeProgressRow = {
  seq: number; binding: PiWorkBinding; // exact headSha required
  repository: string; pullRequest: number; observedAt: number;
  phase: string; waitReason: string; nextAction: string; // only table combinations below
  authorization: "none"; readOnly: true; executable: false;
};
```

The sidecar shares the envelope's exact hostSessionId/observerEpoch. Its own seq
increments for completed progress observations and explicit unavailable/closure
notifications; each row retains its original seq and read-completion UTC
millisecond timestamp. When the selected contract/public source cannot be
confirmed, publish no invented row or repository identity: advance only this
lane to unavailable, retaining bounded old rows as explicitly last-known. A
failed read never refreshes those old row timestamps. Query cannot change
any timestamp/sequence, renew evidence, or read files/network/owner state.
Session/tree resets create a new outer epoch and empty seq0 progress; late reads
cannot publish into the new epoch. Shutdown clears it and reports unavailable.
The complete sidecar JSON UTF-8 encoding is at most **5400 bytes**, with at most16
whole rows. Evict oldest complete rows and increment omitted; never truncate a
binding. This is a bounded display window, not a task/PR-state database.

Only these phase / waitReason / nextAction triples are legal:

| phase | waitReason | nextAction |
| --- | --- | --- |
| pull-request | pr_not_ready | follow_owner_work |
| head-checks | required_checks_pending | wait_required_checks |
| head-checks | required_checks_failed | inspect_required_checks |
| head-checks | required_checks_missing | inspect_required_evidence |
| owner-gate | owner_delivery_pending | follow_owner_delivery |
| postmerge-checks | postmerge_workflows_pending | wait_postmerge_checks |
| postmerge-checks | postmerge_workflows_failed | inspect_postmerge_checks |
| postmerge-checks | postmerge_workflows_missing | inspect_required_evidence |
| owner-gate | owner_gate_unavailable | inspect_owner_evidence |
| source-delivery | none | inspect_result |
| unknown | source_binding_mismatch | inspect_binding |
| unknown | source_original_unavailable | inspect_originals |

No progress row has accepted, ready, permission, task title, check prose or an
executable next-action command. `source-delivery/none/inspect_result` is emitted
only when the strict original CodeOwner reader also establishes its terminal
result; it does not replace that result or claim installation/production.
Different heads, newer unknowns and historical accepted results remain distinct
bindings/observations, not one overall green task. Public PR navigation is built
only from the verified safe repository and pullRequest, never a parsed work key.
Native task titles/other delivery stages are explicitly not provided here.

One explicit read-only host tool, **`vista_code_observe({contractFile})`**, lets the
normal Pi owner select the existing private code-owner contract. It accepts no
phase, accepted flag, arbitrary command/URL, requirement override or model report.
Import/startup/query never runs it automatically. Invocation reads one bounded
same-user regular contract, verifies the selected public GitHub repository/PR/
exact head, and uses the complete original required checks/App IDs/review hash,
merge workflows and Gate path. The source reader uses fixed bounded GETs only,
no retries or polling: at most two PR/check rounds, necessary merged workflow/
ancestry reads, and at most8 GitHub calls for the original Gate path. The batch83 explicit Desk adoption above adds two pinned review-original reads (at most10), preserving the overall60s deadline. Changed/incomplete/malformed sources
stay unknown; unrelated checks do not change the declared requirement set.
Private/unconfirmed repository visibility is not exported as public work.

The slow original read happens **before** entering the existing 250ms consumer
port. A minimal shared internal reader preserves the actual PiOwnerReadback
constructed from this invocation's GitHub/Gate originals, then a trusted callback
returns that prepared snapshot. Never reconstruct evidence from an accepted DTO,
model statement, Todo, review text, arbitrary Bash output or copied flags.
The original CLI/observeCodeOwner contract and strict Gate validation remain;
premerge historical admission cannot be synthesized by postmerge re-evaluation.
An independent fork without the applicable Gate is not given a fake Gate file.

Only safe progress and consumed result metadata are returned/published. Contract
and Gate paths, original bodies, credentials and commands remain host-local.
The new tool runs no Gate/merge/CI rerun/deploy and changes no native permission,
model or existing tool. It is an explicit trusted-host observation boundary,
not a new signature/authorization system. Observer failure remains fail-open.
Fixed-source runtime building includes only the required helper modules; source,
review/CI/Gate, installation, actual loaded tooling and real Desk GUI acceptance
remain separate evidence. No old session is force-reloaded and no original
engineering task is replayed for display.

## Entry conditions and rollback

A host opts into the helper explicitly. If references, owner readback or observation fail, return unknown for the observation and leave the original execution/owner Gate unchanged. On actual regression disable the added wiring while retaining original runs, results and in-flight references. Do not clean history, replay old actions, weaken required checks or block independent tasks.
