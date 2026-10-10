---
doc_type: plan
project: workspace
owner_repository: chenhaoxiang/pi-vista
status: active
truth_mode: maintained
created: 2026-10-05
verified: 2026-10-10
ssot: true
---

# pi-vista Implementation Phases

This is a maintained source-scope roadmap. PR #10 normally merged the current
**11 public source packages** into remote main; actual source/consumer acceptance
is recorded below. This is still not a live or complete durable learning system. Historical seven-package merge evidence remains in the
[merge closeout](handoff/2026-10-06-source-merge-closeout.md); it is not rewritten
as eleven-package evidence.

## Phase 1: Protocol and observation

**Implemented source**: protocol interfaces, bounded metadata redaction,
fail-open event/checkpoint stores, safe run identity and explicitly invoked
Pi/workspace-guard/ai-gate adapters. Public helpers do not install private hooks,
intercept commands, select models or control owner safety decisions. Core
best-effort storage cannot establish exhaustive coverage or a successful run.

**Remaining owner work**: actual producer normalization/wiring, truthful source
attestations and operational integration. No real sessions/owner inputs are test
fixtures. Safe recorded versions are labels, not compatibility/trust decisions.

## Phase 2: Offline observation tools

**Implemented bounded slice**: `@pi-vista/cli`, the offline/read-only `vista` bin
and public observation API:

```text
vista history [run_id]
vista inspect <run_id> [--step <step_id>]
vista compare <run_id_a> <run_id_b>
vista receipts <run_id>
```

Synthetic tests check deterministic views, run/step-bound checkpoint inspection,
opaque receipt refs, fixed errors, privacy limits and unchanged fixture file hashes.
Receipt/ok/resumable metadata remain owner claims, not independently verified
checks or permission. Readers may omit corrupt/missing records. The CLI has no
check, failure, promote, recall or executable replay commands; the programmatic
APIs below do not change this. See [cli.md](cli.md).

## Phase 3: Explicit experience and evidence APIs

### Track A: Check Functions and signed evidence (#65)

**Implemented**: `@pi-vista/checks` uses detached own-data definitions and explicit
trusted predicates, ordered STOP/WARN and fail-closed satisfaction. REPAIR is
refused before callbacks. Pure opt-in sha/env comparisons do not independently
collect evidence. The separate `@pi-vista/checks-local` addon observes registered
local FS/Git aliases through trusted private host configuration, read-only fixed
Git controls and non-atomic component walks. Both remain
`verification: predicate-only`, `authorization: none`.

**Implemented additive foundation**: `@pi-vista/evidence` verifies host-pinned
Ed25519 gate/test/guard receipts, hashes, required successful checks/suites,
complete clean coverage, freshness and all five bindings. Opaque proof identities
are in-process: copies/flags/reports cannot restore provenance. Local script
PASS/privacy/audit checks are not an App-trusted owner receipt.

**Implemented additive consumer seam**: opt-in
[`@pi-vista/evidence/files`](receipt-files.md) freshly reads bounded canonical v1
files from explicit private POSIX mappings, without changing the root verifier.
It cannot upgrade unsigned/legacy material or produce signed owner truth.
[PR #16](https://github.com/chenhaoxiang/pi-vista/pull/16) fresh full source review,
hosted head/main CI and normal source merge/readback are complete;
[closeout](handoff/2026-10-07-receipt-file-source-closeout.md) records actual834-case/
18-export evidence and the still-MISSING owner producer/public-key provenance.

**Pending**: actual compatible owner producers/key provenance (**MISSING**),
actual owner integration/readers, revocation/durable provenance,
CLI check commands and repair implementation. Synchronous trusted callbacks are
not sandboxed or preempted. See [checks](check-functions.md),
[local probes](local-check-probes.md), and [evidence](authoritative-evidence.md).

### Track B: Confirmed promotion (#12)

**Implemented programmatic slice**: `@pi-vista/learning` nominates safe observations,
verifies candidates with the exact fresh evidence factory, prepares exact bounded
dry-run documents, and accepts explicit preview-digest confirmation. It re-reads
unchanged signed receipts before a host-injected native-promise ingest plus exact
readback. Failure/timeout/uncertain persistence never yields trusted state. There
is no default network client, real bank configuration or automatic promotion.

**Implemented additive source seam**: [explicit Hindsight store](hindsight-store.md)
maps pinned 0.10.2 HTTP retain/original GET to the existing sink. A synced exclusive
private local POSIX intent protects cooperating cross-process attempts; existing
claims never POST again, and explicit reconciliation is remote read-only. No
proof/lifecycle is restored by completion metadata. [PR #14](https://github.com/chenhaoxiang/pi-vista/pull/14)
source review, hosted CI and normal merge/readback are complete;
[store closeout](handoff/2026-10-07-hindsight-store-source-closeout.md) records the
exact current source and its remaining operational limits.

**Pending**: actual Hindsight service/durability acceptance, distributed coordination,
durable lifecycle storage, owner/operator integration and CLI `vista promote`.
The custom-pages export is data only, not a memory write. See [learning.md](learning.md).

### Track C: Failure and recorded replay (#14)

**Implemented programmatic slice**: lifecycle withdrawal/supersession, bounded
observed failure classification/root-cause hypotheses, resolved-fix correction
previews, and same-run recorded script/step replay/comparison. Every replay view
is `executable: false`, `authorization: none`; logged actions and repairs are not
executed. Deterministic hypotheses are not verified causes or actual fix evidence.

**Pending**: CLI failure workflows, live/durable corrections and executable replay.
No training or guard/gate modification is inferred from any lifecycle state.

### Track D: Owner-normalized shadow (#15)

**Implemented additive observer**: `@pi-vista/adapter-shadow` explicitly projects
closed normalized Laya/Kev/Intern/StartLux metadata and emits through core.
Allow/pass/confidence never becomes ok; veto, abstention, missing context and
false human/training/promotion eligibility remain non-authorizing. Synthetic
asset receipt refs do not prove real-input isolation or owner truth.

**Pending**: owner normalization implementation, actual inputs, live wiring,
model quality/council verification and isolation acceptance. No model/threshold/
selection/activation/training action occurred. See [adapters/shadow.md](adapters/shadow.md).

## Phase 4: Bounded offline retrieval versus live recall (#16)

**Implemented programmatic slice**: learning retrieves only fresh same-library
verified/trusted handles matching explicit repo/source/policy/environment/task
bindings. Context uses script/step structure, full provenance and whole-entry
character budgets (not token budgets). Synthetic fixture selection/coverage/
context-size evaluation carries `capability_claim: none`. Models are observational
labels, never routing preferences. No sink or receipt I/O happens during selection.

**Implemented additive portable source seam**: eligible current handles can export
canonical signed safe history through a separate explicit archive-origin role.
Confirmed upload reuses sink/readback without raising live trust. Explicit scoped
public pins, historical key intervals/age/revocation policy and optional fresh host
lifecycle policy authenticate history in a separate process; bounded query/read
ports select original signed documents, not generated pages/status flags. Context
says historical-authenticated/current-verification-not-checked, authorization none
and executable false. Import creates only observed new-run same-binding records;
current verification still requires fresh normal owner proof. A synthetic file-backed
producer/consumer test executes in two genuinely separate fresh Node processes.
See [portable recall](portable-recall.md).

**Implemented additive source seam**: the opt-in store projects bounded scoped
recall references and reads exact original signed archives, with actual synthetic
HTTP/separate-process tests. Portable signature/origin/scope checks remain independent.

**Pending**: actual Hindsight durable-service acceptance, distributed persistence,
durable signed lifecycle feeds, actual owner integration,
automatic task-start Pi context injection, remote revocation discovery and external
model capability measurement. Serialized status-labelled documents cannot become
verified handles. [PR #12](https://github.com/chenhaoxiang/pi-vista/pull/12) portable
source review (full same-model plus retained entry recheck), actual hosted
Node20/22/26 source/consumer CI and normal remote merge/readback are complete;
[closeout](handoff/2026-10-07-portable-recall-source-closeout.md) binds the actual
659-case/installed fresh-process proof. This is not operational adaptation,
live-service durability or capability lift.

## Explicit optional Pi observation and preview: source delivered

**Completed bounded source acceptance through [PR #18](https://github.com/chenhaoxiang/pi-vista/pull/18)**:
[`@pi-vista/learning/pi`](pi-observe-preview.md) explicitly loads seven public
notification-only observations with bounded run/correlation epochs, original
parallel tool-step binding and fail-open metadata stores. Optional original signed
portable history yields character-bounded Script/Step preview. Exact explicit
adoption is local acknowledgement only; optional fresh exact evidence verifier
proof is separate and never permission. No default settings/resources, context/
editor injection, model/tool changes, memory write or owner activation is added.

Actual library/source/installed consumers pass on Node20/26 (11 packages, 19
exports, 961 cases). Public Pi1.0.4 Node26 resource loading/runner dispatch is a
no-provider synthetic proof, not an interactive task. Full SDK declaration
checking failed on upstream JSON/MCP types; only assignment checking with skipped
dependency diagnostics is separately approved. Original gate/assertion blobs
are unchanged; one branch-added loss-counter expectation was aligned and strengthened.
Original full BLOCK and both root-cause fixes, retained same-model recheck, actual
head/main CI and postmerge evidence are in [the closeout](handoff/2026-10-07-pi-observe-preview-source-closeout.md).
**Pending**: full host declaration health, actual owner producer/key provenance (MISSING), default
installation, service/interactive/model evaluation, publication and operational
acceptance. Existing automatic context injection and live/durable roadmap stays
pending, not satisfied by local guidance selection.

## Sequential operational rollout: acceptance in progress

User approved six stages in order: isolated actual AgentSession/model canary,
safe trace candidates, truthful owner receipt producers, real isolated Hindsight
bank, explicit usable learning/lifecycle workflow, then paired effectiveness
evaluation and confirmed release/rollback. See the
[operational change](../openspec/changes/pi-operational-rollout/tasks.md).

Stage1 [canary](pi-agent-canary.md) source is delivered through normal PR20: fixed
fixture tools, private/in-memory resources, closed final payload and no resource
discovery. Exact reviewed c24 actual-model trial passes14requests/13validated
payloads; source Node20/26 each1009 cases,11tarballs/19exports and exacthead/main
Node20/22/26 hostedCI pass. Original complete BLOCKs and retained correction
closure are recorded in the [Stage1 closeout](handoff/2026-10-08-pi-agent-canary-source-closeout.md).
Stage2 [trace drafts](trace-candidates.md) source is delivered through normal PR22:
explicit pure notification pairing/closed task templates build only existing
ExperienceObservation input; structural consistency is not owner truth. Explicit
library observe/nominate is unchanged and cannot create verified/trusted state.
Fresh complete same-model review0P0/P1/P2, exacthead/mainCI, actual1059-case/
20-export/strictconsumer evidence and normal merge/readback are recorded in the
[Stage2 closeout](handoff/2026-10-08-trace-candidates-source-closeout.md).
Stage2 documentary PR23 is also included in maina595b59 with fresh six-document
review and exact head/mainCI37801144194/37801638062; source delivery and documentary
inclusion are separately verified.

On2026-10-08 the user explicitly amended Stage3 to [single-owner local host mode](local-host-evidence.md),
not establishing a new signer/key system. The separate evidence/host source is delivered
through normal PR24/main001a4fc, exact head/mainCI37848869274/37849179258, actual Node20/26
1127 native cases/11tarballs21exports and strict installedTS5.9.3. Original full14path
BLOCK0/1/1 and four red→green regressions precede the targeted five-path correction
OKnotes0/0/0; this is not a fresh full15path review. Exact984 and clean postmerge001a4fc
actual fixed-plan acceptance separately repeats177 evidence cases and six declared
command admit/settle events, not OS/Meta/nested/Gitmetadata coverage. See the
[Stage3 closeout](handoff/2026-10-08-local-host-evidence-source-closeout.md).
Local proof is non-portable and non-authorizing; original signed API/Learning/archive
admission is unchanged. Mac screen-unlocked/UID is not result truth, and no native
personal-authentication broker is implemented. This later documentary inclusion remains
pending at preparation; original signed owner producer/key acceptance stays MISSING.
Later actual isolated bank/guidance and explicit
local learning workflow require new current verification after restart, not history
status restoration. No daily session activation, live bank, production receipt,
quality improvement or distribution is inferred. SDK full declaration health stays
a separate unresolved item.

Stage3 documentary PR25 is now included in finalmain90add4e with fresh6docreview0/0/0
and exactCI37850779740/37851081825. Stage4 [guidance-only candidate](hindsight-guidance.md)
has an explicit user-approved localhost8888 testbankpi-vista-local-test-01a114ab;
bank creation/config readback is complete. Historical pre-chunks source snapshot `a8d9c76`
had1181cases and the original two concise trials failed with0facts/0ownrefs; those pins
remain in the completed/snapshot [historical handoff](handoff/2026-10-09-stage4-guidance-source-and-operational-block.md).
The current corrected source candidate is `a08b159` with1203cases,11tarballs22exports,
layered same-model reviews and exact head Node20/22/26 CI. PR26 normally merged into
main75a2741 with exact mainCI38002400266/Node20/22/26 and canonical0/0clean readback;
post-main actualNode20 source/consumer1203cases/22exports also passed. The later
supplementary [main closeout](handoff/2026-10-09-stage4-shared-main-closeout.md) is itself
now included by ordinaryPR27/main22e06da with exacthead/mainCI and clean canonical
readback; preparation-time pending wording is historical, not missing delivery.
Source/runtime delivery is not product authority.
Later exact readonly
document trace identifies actualQwen27B normalvalidemptyfacts and256s call, notparse/auth
failure. User then explicitly authorizes only the dedicated bank chunks mode and one new
namespace synthetictrial; singlePATCH/readback/otherfield-oldDoc equality passed. New
operator mode/digest admission plus exact-byte policy corrections have1203cases,
11tarballs22exports/actualNode20/exactheadCI passing. One approved new namespace
`guidance-01a11fcc-chunks` then passed one retain/lost-ack readonly reconcile,
independent restart/original read and own-reference recall; readonly DB count1worldunit.
This is synthetic/chunks-scoped operational evidence, not product authority or main
inclusion. Old failures remain preserved/unprocessed. Stage5's separate source slice
is delivered below; its larger operational acceptance and Stage6 remain pending. See
[chunks amendment](handoff/2026-10-09-stage4-extraction-diagnosis-and-chunks-trial.md).
Actual installed0.10.2
HTTP/engine/config/main file fingerprints differ from originalea5 source; user
accepted this concrete deployment fingerprint while preserving the fixed API0.10.2
client contract, not an in-memory/whole-service/source-equivalence claim. No main-bank
acceptance data or shared service/global/model settings are changed, no bank deletion
or original signed-store/rootLearning downgrade is introduced. Stage5/6 still later.

## Stage5 explicit LOCAL lifecycle: source delivered

The separate [`@pi-vista/learning/local`](local-learning.md) factory composes the
existing local-host verifier and canonical guidance store: explicit safe observation,
candidate/current proof, exact preview/confirmation, one-shot retain+exact readback,
readonly reconciliation, history-only recall/import and process-local terminal/context
lifecycle. Native promise/one-total-deadline/retirement checks do not undo host effects;
uncertain writes are not retried. History and saved flags cannot restore live handles.
Root/signed APIs, observer/CLI/gates/locks/dependencies/original assertions are unchanged.
Additive synthetic/native process and public HTTP/journal tests plus full source/
packed-consumer passed1265nativecases/11tarballs23exports/actualNode20+26. Freshfull15
BLOCK0/2/0 was corrected via fourredregressions/minimalF1F2fix; retainedcomplete6review
closesboth0/0/0 (notfreshfull16). OrdinaryPR28/main022afd6, exactheadCI38016756178/
mainCI38017408152, canonical0/0clean and isolatedpostmainNode20 passed. The later
[source closeout](handoff/2026-10-10-local-learning-source-closeout.md) has its own
pending documentary inclusion; it does not supply actualbank/currentauthority.
No actual bank sample, daily activation, model or owner policy change occurs. The larger
Stage5 operational workflow and Stage6 paired effectiveness/cost/release remain pending.
[Design](../openspec/changes/pi-operational-rollout/stage5-local-learning-design.md).

The later [explicit single-sample operator](local-learning-workflow.md) is now a
corrected source candidate846b9a0 (1282nativecases/23exports/actualNode20+26/exacthead
CI38054215512 PASS; originalfull9BLOCK0/2/0 + parentred + retainedcomplete7closure
preserved, notfreshfull11). The one explicitly approved namespace/doc actualtrial
passed PID14348writeONEretain200/currentcontext/deprecate and independentPID52511
readretain0/read503→readonlyrecovery/ownref1/importobserved/freshproof/context/reject,
matching source/artifact/policy/config/docdigests. Guardscope only6fixedhostcommand
events perphase; historicalnone/notchecked/false andno defaultactivation remains.
[Scoped runtime handoff](handoff/2026-10-10-local-workflow-scoped-runtime.md) records
parentactualevidence. PR30/source/runtimedocs nowordinarymergedmainb245d7f,
exactdocheadCI38055998963/mainCI38056567710PASS, canonical0-0clean andisolated
postmainNode20source/consumer1282cases/23exportsPASS. Later [main closeout](handoff/2026-10-10-local-workflow-main-closeout.md)
has its own pendinginclusion; Stage6pairedquality/cost/release is notcompleted. Earlier larger-operator-pending statements
above are the source-library closeout's boundary, not a denial of this later scopedtrial.

## Delivery: Repeatable engineering gates (#17)

**Implemented source**: dependency-ordered root gates for all 11 packages,
deterministic Node20-compatible integration enumeration, original assertions plus
new synthetic integration and release-script tests, offline locked clean npm ci,
actual tarballs and fresh isolated consumer install/strict locked TypeScript,
all public imports/bin checks, bounded package-content checks and pinned
least-privilege GitHub workflow. Actual local Node20 validation is recorded in
[release-contract.md](release-contract.md).

**Completed source acceptance (2026-10-07)**: [PR #10](https://github.com/chenhaoxiang/pi-vista/pull/10)
normal merge/readback, independent same-model full inspection plus retained
P1-fix recheck, actual Ubuntu Node20/22/26 source/consumer CI before and after
source merge, and isolated post-merge Node20 **567** test cases/eleven-tarball
consumer validation. [Closeout](handoff/2026-10-07-verified-learning-source-closeout.md)
records the exact pins, initial BLOCK and later recheck provenance.

**Completed store-source acceptance (PR14)**: independent same-model full review
plus retained cancellation correction, exact-head/main Ubuntu Node20/22/26
source/consumer CI, normal remote merge/tree equality/ancestry/readback, isolated
actual-main Node20 **748 cases**,11 tarballs/17 exports and installed actual
synthetic HTTP/fresh-process proof. [Store closeout](handoff/2026-10-07-hindsight-store-source-closeout.md)
preserves the original P2 and explicit trust/durability boundary.

**Completed file-consumer source acceptance (PR16)**: fresh full independent
same-model review after preserved native startup-parameter failure (no original
review launched), actual Ubuntu Node20/22/26 head/main CI, normal merge/ancestry/
tree/readback and isolated actual-main Node20 **834 cases**,11 tarballs/18 exports
and installed independent signed-file producer/reader proof.
[Consumer closeout](handoff/2026-10-07-receipt-file-source-closeout.md) retains exact
pins, infrastructure recovery and missing real-owner/operational boundaries.

**Pending**: platform required-check policy configuration, fresh-cache/registry
availability, publication/deployment and operational acceptance. Local passes do not authorize any of these. The root lint command
is present but there are currently no workspace lint implementations.

## Permanently excluded authority changes

- Online model weight updates or automatic model selection
- Automatic guard-rule or gate-threshold changes
- Production auto-approval or learned bypass of hard safety gates
- Training pipelines without separate owner authorization
- Treating recorded flags, shadow agreement, signed claim correctness or source
  test success as execution/merge/release permission
