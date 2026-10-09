---
doc_type: guide
project: workspace
owner_repository: chenhaoxiang/pi-vista
status: active
truth_mode: maintained
created: 2026-10-06
verified: 2026-10-09
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

- [docs/handoff/2026-10-09-stage4-guidance-source-and-operational-block.md](docs/handoff/2026-10-09-stage4-guidance-source-and-operational-block.md): source candidate/1181-case/layered review/exact CI pins, retained zero-fact and actual-timeout recovery trials; Stage4 semantic recall BLOCK, no main/operational closure or further reseeding
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
- [docs/architecture.md](docs/architecture.md): storage and safety boundaries
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
