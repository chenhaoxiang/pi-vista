---
doc_type: guide
project: workspace
owner_repository: chenhaoxiang/pi-vista
status: active
truth_mode: maintained
created: 2026-10-06
verified: 2026-10-18
verification_scope: Current Pi-Continuum delivery-status pointers only; package and runtime contracts unchanged
---

# Repository-local contributor contract

pi-vista observes; it does not override workspace-guard, ai-gate, or production
safety authority. Keep runtime changes within the relevant package's public
contract. Protocol data must not carry raw commands, paths, credentials, model
input/output, or artifact content. Unknown recorded versions are labels, not
compatibility or trust decisions.

The observation CLI is strictly offline/read-only. Do not turn recorded
`ok`/`verified` flags or checkpoint metadata into execution or merge permission.
Tests must use synthetic data, never real session logs; CLI fixtures belong in
`tmp/`, and cleanup must target only test-created directories.

## Source package inventory

The merged infrastructure includes `@pi-vista/protocol`, `@pi-vista/core`,
`@pi-vista/adapter-pi`, `@pi-vista/adapter-workspace-guard`,
`@pi-vista/adapter-ai-gate`, `@pi-vista/cli`, and `@pi-vista/checks`.
The explicit trusted-host `@pi-vista/checks-local` addon adds bounded actual local
FS/Git observations without changing the seven packages or safety authority.
The current locally integrated continuation adds `@pi-vista/evidence`,
`@pi-vista/learning` and `@pi-vista/adapter-shadow`: 11 public source packages,
not a publication or remote-merge claim. Build protocol/core first, checks before
evidence, evidence before learning; shadow depends only on protocol/core.
Root typecheck/build/test/offline pack cover all 11, preserve original assertions,
and include public-import synthetic integration plus release-script regressions.
Source integration through PR #7 is recorded in the merge closeout; it does not
imply registry publication, deployment or operational acceptance. The integration
snapshot preserves the old core/Pi/guard credential defect as historical evidence.
The bounded metadata/generation repair passed exact-source review and isolated
post-merge tests; docs/metadata-safety.md describes its limits. Do not treat that
review as a universal secret detector, owner verification or live/release authority.

Signed evidence requires explicit host-pinned public keys/readers and freshness;
local gate scripts, predicate reports, copied flags and shadow observations cannot
mint opaque proof. Live learning handles/selections remain process-local; opt-in
portable archive signatures authenticate history only, never serialized current
proof. Historical views say current-verification-not-checked, authorization none
and executable false; observed-only import still needs new current evidence.
Confirmed promotion/archive upload use only an explicitly injected sink.
Recorded replay is executable=false/authorization=none. Shadow requires explicit
owner normalization, preserves non-positive outcomes and cannot activate models,
prove isolation or change eligibility. No CLI check/promote/replay command is added.

## Public document map

Current Pi-Continuum stage status is maintained in [docs/pi-continuum.md §7](docs/pi-continuum.md#7-已知事实和仍未完成)
and the [existing rollout tasks](openspec/changes/pi-operational-rollout/tasks.md).
Handoff snapshot descriptions below retain their preparation-time boundaries;
use those maintained entries for later K1/ROI/installation delivery, not a repeat run.

- [docs/handoff/2026-10-14-local-observer-install-closeout.md](docs/handoff/2026-10-14-local-observer-install-closeout.md): PR55 source/head/main CI, exclusive actual local shim/readback and isolated fresh conventional SDK1.2 discovery; no old-session/model/bank/guidance activation claim
- [docs/handoff/evidence/2026-10-14-local-observer/README.md](docs/handoff/evidence/2026-10-14-local-observer/README.md): safe CI/App/installation/SDK fixture projections, each evidence level retained separately
- [docs/pi-local-observer-install.md](docs/pi-local-observer-install.md): Owner-selected fixed offline observer release, exclusive default shim installation and fresh conventional SDK discovery; no model/bank/guidance/permission activation
- [scripts/pi-local-observer-release.mjs](scripts/pi-local-observer-release.mjs): exact clean-source offline runtime builder and manifest-pinned fail-open loader; no host SDK bundle or settings change
- [docs/stage6-k1-readiness.md](docs/stage6-k1-readiness.md): supplied-facts metadata consistency and Usage-backed paired metrics boundaries; ready labels do not authorize execution
- [docs/handoff/2026-10-14-offline-context-cost-source-closeout.md](docs/handoff/2026-10-14-offline-context-cost-source-closeout.md): PR53 offline ROI/candidate source delivery, exact CI/main and no-injection boundary; one-window observation not generalized benefit
- [docs/handoff/2026-10-13-k1-actual-window-closeout.md](docs/handoff/2026-10-13-k1-actual-window-closeout.md): first actual8session/16request paired window, strict8/8, unchanged profile/provenance and context cost observation; not default guidance/ROI/release
- [docs/stage6-context-roi.md](docs/stage6-context-roi.md): pure offline cost/non-degradation recommendation; elapsed alone is not ROI, unpriced stays unknown, no default injection
- [scripts/stage6-context-roi.mjs](scripts/stage6-context-roi.mjs): closed baseline/guided metadata analyzer; no model/bank/profile read or runtime mutation
- [docs/stage6-guidance-candidate.md](docs/stage6-guidance-candidate.md): offline whole-script/steps cost proposal, no content/partial instructions/current proof or runtime injection
- [scripts/stage6-guidance-candidate.mjs](scripts/stage6-guidance-candidate.mjs): exact bridge-associated candidate lengths/digests only; non-candidates have null length/delta
- [docs/handoff/evidence/2026-10-13-k1-actual/README.md](docs/handoff/evidence/2026-10-13-k1-actual/README.md): sanitized actual K1 report projection, original SHA and scope limits
- [docs/handoff/2026-10-13-k1-actual-runner-source-closeout.md](docs/handoff/2026-10-13-k1-actual-runner-source-closeout.md): PR49 actual-runner source/main/CI delivery, retained review layers and live 0.10.3-vs-0.10.2 history preflight block; no real model/bank quality claim
- [docs/hindsight-k1-read-compat.md](docs/hindsight-k1-read-compat.md): Owner-selected current API1.0.0/distribution1.0.0 read compatibility, old0.10.2/0.10.3 evidence retained, actual original-read scope and no write/model/default activation
- [scripts/stage6-k1-service-compat.mjs](scripts/stage6-k1-service-compat.mjs): explicit fixed current-service public-file fingerprint/API reader; old0.10.2 default unchanged and no service/bank writes
- [docs/handoff/2026-10-13-k1-facts-source-closeout.md](docs/handoff/2026-10-13-k1-facts-source-closeout.md): PR47 source/main/CI and readonly reconcile snapshot; supplied-facts readiness remains non-authorizing and actual K1 facts remain pending
- [scripts/stage6-k1-facts.mjs](scripts/stage6-k1-facts.mjs): closed supplied-metadata consistency using existing SDK/broker/history validators and paired pins; no source IO, proof, budget, window or default-Pi admission
- [scripts/stage6-k1-history-host.mjs](scripts/stage6-k1-history-host.mjs): explicit host-only re-read/import/fresh local verification/one-item compile bridge; injected read and verifier are required, old proof/handle/plan copies are rejected
- [scripts/stage6-k1-pilot.mjs](scripts/stage6-k1-pilot.mjs): explicit single-coordinator bounded K1 runner seam; all admissions are prepared before transport and Usage is sent through the existing paired adapter
- [docs/stage6-k1-actual.md](docs/stage6-k1-actual.md): explicit actual-runner candidate, scoped native history evidence, fixed source/public SDK/model/broker and library/CI/runtime boundaries; no default activation
- [scripts/stage6-k1-actual.mjs](scripts/stage6-k1-actual.mjs), [scripts/stage6-k1-native.mjs](scripts/stage6-k1-native.mjs): opt-in operator/native session factory; accepted test-bank GET only, readonly selected credential source, no fallback or budget duplication
- [docs/stage6-k1-host-preview.md](docs/stage6-k1-host-preview.md): PR45 delivered opt-in single-window K1 synthetic SDK preview, staged input/metadata refusal and existing issued admission/budget ownership; not real model/history/current-proof or default activation
- [scripts/stage6-k1-host-preview.mjs](scripts/stage6-k1-host-preview.mjs): explicit synthetic-only runner and safe plan/row/refusal projection; callback remains trusted and source pin is not permission
- [docs/stage6-k1-history-context.md](docs/stage6-k1-history-context.md): trusted-host public history/context to existing K1 DTO, single-source/identity/non-authorizing boundary and PR43 source/main delivery; delivered PR44 bridge is not actual history or model acceptance
- [openspec/changes/pi-operational-rollout/stage6-k1-admission-design.md](openspec/changes/pi-operational-rollout/stage6-k1-admission-design.md): source-only metadata K1 envelope, historical-guidance/non-authorizing boundary and pending actual host facts; no model or bank call
- [scripts/stage6-k1-admission.mjs](scripts/stage6-k1-admission.mjs): closed baseline/guided metadata admission and K1 budget declarations; not a current-proof or default Pi gate
- [docs/handoff/2026-10-12-stage6-zero-model-matrix-closeout.md](docs/handoff/2026-10-12-stage6-zero-model-matrix-closeout.md): PR41 one-window 4-case×2-arm native matrix, 11 independent fault windows, exact CI/main and non-authorizing boundaries; full paired quality/current proof pending
- [docs/handoff/evidence/2026-10-11-stage6-zero-model/README.md](docs/handoff/evidence/2026-10-11-stage6-zero-model/README.md): sanitized matrix/fault/head/main CI projections; no model quality, bank, current permission or release claim
- [openspec/changes/pi-operational-rollout/stage6-zero-model-matrix-design.md](openspec/changes/pi-operational-rollout/stage6-zero-model-matrix-design.md): one-window four-case×two-arm model-free matrix plus real SDK negative windows; current candidate not model quality or LOCAL history proof
- [scripts/stage6-synthetic-sdk-host.mjs](scripts/stage6-synthetic-sdk-host.mjs): explicit synthetic SDK host for matrix and independent negative windows; no real model/bank/default Pi
- [scripts/stage6-native-sdk-matrix.mjs](scripts/stage6-native-sdk-matrix.mjs), [scripts/stage6-native-sdk-faults.mjs](scripts/stage6-native-sdk-faults.mjs): opt-in one-window matrix/budget guard and independent synthetic faults with trace/counter/cleanup assertions
- [docs/handoff/2026-10-11-stage6-native-sdk-acceptance-candidate.md](docs/handoff/2026-10-11-stage6-native-sdk-acceptance-candidate.md): PR39 source/main/CI and Node26 model-free native SDK candidate; strict decision/read/provenance receipt, Node20 SDK refusal and actual model/default activation boundaries
- [docs/handoff/evidence/2026-10-11-stage6-native-sdk/README.md](docs/handoff/evidence/2026-10-11-stage6-native-sdk/README.md): exact PR39 head/main CI and sanitized synthetic runtime summary; no vendor/current-proof/model quality claim
- [openspec/changes/pi-operational-rollout/stage6-native-sdk-acceptance-design.md](openspec/changes/pi-operational-rollout/stage6-native-sdk-acceptance-design.md): explicit installed-SDK model-free candidate, native read/strict terminating decision, bounded synthetic HTTP interception; not paired quality, real model, default Pi or current-proof acceptance
- [scripts/stage6-native-sdk-acceptance.mjs](scripts/stage6-native-sdk-acceptance.mjs): opt-in source-bound SDK1.1.0-fork.1 acceptance runner; Node>=22.19 runtime only, source/consumer Node20 remains separate
- [docs/handoff/2026-10-11-stage6-host-provenance-source-closeout.md](docs/handoff/2026-10-11-stage6-host-provenance-source-closeout.md): PR37 trusted-host provenance/window source, layered review and exact head/main CI, retained Owner-authorized gate/App403/exit3 then readonly reconcile; actual model/default activation still pending
- [docs/handoff/evidence/2026-10-11-stage6-host-provenance/README.md](docs/handoff/evidence/2026-10-11-stage6-host-provenance/README.md): public head/main CI and parent per-run reviewer runtime readback projection; not vendor/current-proof authentication
- [docs/handoff/2026-10-11-stage6-admission-source-closeout.md](docs/handoff/2026-10-11-stage6-admission-source-closeout.md): PR35 source/main/CI delivery, PR32 ancestry inclusion, preserved INVALID pilot and remaining actual-host/model/release boundaries
- [openspec/changes/pi-operational-rollout/stage6-paired-evaluation-design.md](openspec/changes/pi-operational-rollout/stage6-paired-evaluation-design.md): four-pair pilot design/closed non-authorizing metrics; initial eight-path BLOCK/parent red fixes and private16-call INVALID draft trial preserved; accepted runtime/quality measures and release remain pending, no automatic/ROI claim
- [openspec/changes/pi-operational-rollout/stage6-admission-design.md](openspec/changes/pi-operational-rollout/stage6-admission-design.md): delivered P0 offline source contract; actual SDK/broker/source/history and pilot still pending, no default activation
- [openspec/changes/pi-operational-rollout/stage6-host-provenance-design.md](openspec/changes/pi-operational-rollout/stage6-host-provenance-design.md): PR37 delivered trusted-host provenance/window source, explicit whole-run profile bracket and per-window budget; actual loaded SDK/source/history/model acceptance remains separate
- [scripts/stage6-host-admission.mjs](scripts/stage6-host-admission.mjs): delivered explicit readonly profile/pretransport source seam; not planner/default Pi/model wiring
- [docs/handoff/2026-10-10-local-workflow-main-closeout.md](docs/handoff/2026-10-10-local-workflow-main-closeout.md): PR30/mainb245d7f scoped runtime+source/shared delivery, exacthead/mainCI/canonical/postmain evidence, preserved layered BLOCK/red/runtime limits; Stage6 still separate
- [docs/handoff/2026-10-10-local-workflow-scoped-runtime.md](docs/handoff/2026-10-10-local-workflow-scoped-runtime.md): one approved actual LOCAL sample/write14348/read52511/retain1→0/ownref1/read503-only recovery and exact artifact/policy/config/source evidence; PR30/main delivery and Stage6 remain separately proved; this runtime snapshot retains preparation-time pending
- [docs/local-learning-workflow.md](docs/local-learning-workflow.md): explicitly approved Stage5 operator, fixed host scope/fresh source/current proof/read-only recovery; bounded runtime/source delivered PR30 and main-closeout included PR31; not default activation
- [openspec/changes/pi-operational-rollout/stage5-operational-design.md](openspec/changes/pi-operational-rollout/stage5-operational-design.md): same dedicated bank/one namespace/one synthetic document scope, independent read/client-only fault/counter/source/policy acceptance plan
- [docs/handoff/2026-10-10-local-learning-source-closeout.md](docs/handoff/2026-10-10-local-learning-source-closeout.md): PR28/main022afd6 source/CI/canonical/post-main delivery, preserved full15 BLOCK and complete6 F1/F2 closure,1265-case/23-export pins; larger actual Stage5/Stage6 remain separate
- [docs/local-learning.md](docs/local-learning.md): Stage5 opt-in LOCAL source delivered, exact host proof/preview/confirmation/guidance/recall/lifecycle; original signed/root APIs unchanged, no default activation or new real-bank sample
- [openspec/changes/pi-operational-rollout/stage5-local-learning-design.md](openspec/changes/pi-operational-rollout/stage5-local-learning-design.md): bounded LOCAL workflow/API/cancellation/restart plan; source and larger operational acceptance remain distinct
- [docs/handoff/2026-10-09-stage4-shared-main-closeout.md](docs/handoff/2026-10-09-stage4-shared-main-closeout.md): merged PR26/75a2741, exact main CI/post-main Node20 verification, scoped chunks runtime PASS and remaining Stage5/6 boundaries
- [docs/handoff/2026-10-09-stage4-extraction-diagnosis-and-chunks-trial.md](docs/handoff/2026-10-09-stage4-extraction-diagnosis-and-chunks-trial.md): exact readonly Qwen empty-facts/256s diagnosis, explicitly approved one-bank chunks mode change, no reprocessing of old failures, operator mode/digest admission, scoped new chunks runtime PASS/1worldunit, PR26 source/main and PR27 supplementary documentary closure
- [docs/handoff/2026-10-09-stage4-guidance-source-and-operational-block.md](docs/handoff/2026-10-09-stage4-guidance-source-and-operational-block.md): historical completed/snapshot source candidate/1181-case/layered review/exact CI pins and retained zero-fact/timeout trials; original concise Stage4 BLOCK remains history, newer authorized chunks scope routed above, no retroactive PASS
- [docs/hindsight-guidance.md](docs/hindsight-guidance.md): Stage4 explicit guidance-only candidate; approved isolated bank/actual0.10.2 deployment fingerprint, no signed/root Learning fallback or current-proof restoration
- [openspec/changes/pi-operational-rollout/stage4-guidance-design.md](openspec/changes/pi-operational-rollout/stage4-guidance-design.md): dedicated bank scope, actual-source differences, byte-exact readback, immutable uncertainty journal and client-restart acceptance plan

- [docs/handoff/2026-10-08-local-host-evidence-source-closeout.md](docs/handoff/2026-10-08-local-host-evidence-source-closeout.md): PR24 local-host source/scoped runtime/1127-case/21-export pins, retained BLOCK/red regressions, targeted fix review and still-separate Mac/signed/bank authority
- [docs/local-host-evidence.md](docs/local-host-evidence.md): delivered single-owner explicit local-host source; distinct process-only proof/scoped actual acceptance, no signing fallback, Mac broker or original Learning admission
- [openspec/changes/pi-operational-rollout/stage3-local-host-design.md](openspec/changes/pi-operational-rollout/stage3-local-host-design.md): Stage3 scope amendment and Stage4–6 history/current-verification boundaries

- [docs/handoff/2026-10-08-trace-candidates-source-closeout.md](docs/handoff/2026-10-08-trace-candidates-source-closeout.md): PR22 safe draft source/main/review/1059-case/20-export pins, original base36 refusal and Stage3 MISSING owner boundary
- [docs/trace-candidates.md](docs/trace-candidates.md): pure Stage2 safe trace observation drafts, shape-only provenance, explicit observe/nominate and no current-proof/memory write

- [docs/handoff/2026-10-08-pi-agent-canary-source-closeout.md](docs/handoff/2026-10-08-pi-agent-canary-source-closeout.md): PR20 actual reviewed-source model canary/1009-case/mainCI pins, preserved BLOCKs and sequential Stage2 boundary
- [docs/pi-agent-canary.md](docs/pi-agent-canary.md): explicit actual AgentSession/model canary, private fixture lifecycle/fault tests, credential/privacy boundaries and separate sequential operational acceptance

- [README.md](README.md): package overview and implementation status
- [docs/pi-continuum.md](docs/pi-continuum.md): Pi-Continuum four-plane/native-first contract and current bounded K1/ROI/notification-only delivery status; broader effectiveness, default guidance and release remain separate
- [openspec/changes/pi-operational-rollout/pi-continuum-architecture.md](openspec/changes/pi-operational-rollout/pi-continuum-architecture.md): existing S0/S1/P0 source and bounded K1/ROI completion versus broader P1/P2 work; no new execution gate or repeat installation
- [docs/handoff/2026-10-06-source-merge-closeout.md](docs/handoff/2026-10-06-source-merge-closeout.md): merged-source evidence, source PR reconciliation and remaining boundaries
- [docs/getting-started.md](docs/getting-started.md): source/package usage
- [docs/infrastructure-integration.md](docs/infrastructure-integration.md): candidate inventory, public source pins, functional validation snapshot and open blockers
- [docs/metadata-safety.md](docs/metadata-safety.md): shared known-credential metadata boundaries, historical defect and source review limits
- [docs/cli.md](docs/cli.md): maintained observation CLI/API, privacy and limits
- [docs/check-functions.md](docs/check-functions.md): programmatic predicate registry/runner, fail-closed limits and no authorization
- [docs/local-check-probes.md](docs/local-check-probes.md): explicit trusted-host local FS/Git addon, private config, read-only controls and limitations
- [docs/handoff/2026-10-07-verified-learning-source-closeout.md](docs/handoff/2026-10-07-verified-learning-source-closeout.md): PR10/source-main pins, actual hosted/post-merge evidence and remaining durable/live scope
- [docs/handoff/2026-10-07-verified-learning-p1-fixes.md](docs/handoff/2026-10-07-verified-learning-p1-fixes.md): preserved full-review BLOCK, own-only/native-case corrections and bounded local evidence
- [docs/authoritative-evidence.md](docs/authoritative-evidence.md): opt-in signed owner receipts, opaque provenance and non-authorizing probes
- [docs/handoff/2026-10-07-receipt-file-source-closeout.md](docs/handoff/2026-10-07-receipt-file-source-closeout.md): PR16 source/readback/CI pins, actual-main834-case/18-export/installed proof and still-MISSING owner producers/keys
- [docs/receipt-files.md](docs/receipt-files.md): explicit private read-only v1 file consumer; actual owner producers/key provenance MISSING, no authority upgrade
- [docs/learning.md](docs/learning.md): process-local verified learning, exact confirmed sink/readback, failure/replay and character-bounded retrieval
- [docs/handoff/2026-10-07-pi-observe-preview-source-closeout.md](docs/handoff/2026-10-07-pi-observe-preview-source-closeout.md): PR18 source/main/CI pins, preserved BLOCK and corrected961-case/19-export/SDK-dispatch evidence; no default/live/full-SDK-health acceptance
- [docs/pi-observe-preview.md](docs/pi-observe-preview.md): optional explicit Pi notification/preview/controller candidate, local-only selection, SDK declaration limitation and no authority/default activation
- [scripts/pi-local-observer.mjs](scripts/pi-local-observer.mjs): explicit host wiring for notification-only local observation; default local EventStore metadata/fail-open, no bank/history/verifier/model/permission port
- [scripts/pi-local-observer-sdk.mjs](scripts/pi-local-observer-sdk.mjs): explicit installed-SDK acceptance with isolated HOME, synthetic provider streams, native read and no global/default activation
- [docs/handoff/2026-10-07-portable-recall-source-closeout.md](docs/handoff/2026-10-07-portable-recall-source-closeout.md): PR12 pins/CI/current-main restart proofs, historical-vs-current trust and remaining host/live scope
- [docs/handoff/2026-10-07-portable-recall-entry-fixes.md](docs/handoff/2026-10-07-portable-recall-entry-fixes.md): original portable review BLOCK, new-identity/public-counter corrections and bounded local proof
- [docs/portable-recall.md](docs/portable-recall.md): explicit signed historical archives/Hindsight ports, restart authentication and observed-only import without current authority
- [docs/handoff/2026-10-07-hindsight-store-cancellation-fix.md](docs/handoff/2026-10-07-hindsight-store-cancellation-fix.md): preserved original P2, installed abort/deadline reproductions and additive pre-create cancellation correction
- [docs/handoff/2026-10-07-hindsight-store-source-closeout.md](docs/handoff/2026-10-07-hindsight-store-source-closeout.md): PR14 source/CI/readback pins, actual-main748-case/17-export/HTTP-restart acceptance and remaining operational limits
- [docs/hindsight-store.md](docs/hindsight-store.md): opt-in exact original HTTP store, cooperative local attempt journal and read-only reconciliation; no live proof restoration
- [docs/adapters/shadow.md](docs/adapters/shadow.md): explicit owner-normalized non-authorizing shadow observer
- [docs/release-contract.md](docs/release-contract.md): repeatable source/Node20/actual packed-consumer evidence and non-release boundaries
- [openspec/changes/verified-learning/proposal.md](openspec/changes/verified-learning/proposal.md): inherited evidence/learning/shadow/retrieval/release continuation
- [docs/PHASES.md](docs/PHASES.md): implemented slice versus future phases
- [docs/architecture.md](docs/architecture.md): storage, safety and Pi-Continuum integration boundary
- [packages/core/README.md](packages/core/README.md): public core runtime contract
- [packages/protocol/README.md](packages/protocol/README.md): protocol interfaces
- [docs/adapters/pi.md](docs/adapters/pi.md),
  [docs/adapters/workspace-guard.md](docs/adapters/workspace-guard.md) and
  [docs/adapters/ai-gate.md](docs/adapters/ai-gate.md): adapter guides

Validation: `npm ci --offline --ignore-scripts`, `npm run typecheck`,
`npm run build`, `npm test`, `npm run lint`, `git diff --check`, offline
`npm run pack:dry-run`, `npm run gate:source`, `npm run gate:consumer`, and
`npm run gate:node20 -- --node=/absolute/path/to/verified-node20`.
The integrated test runner enumerates deterministic files on actual Node20.
Consumer gates install exact local tarballs and compile with the locked consumer
TypeScript; they do not prove fresh-cache/registry installs, hosted CI,
publication, deployment, owner authenticity/activation or operational acceptance.
