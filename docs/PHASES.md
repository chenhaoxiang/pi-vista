---
doc_type: plan
project: workspace
owner_repository: chenhaoxiang/pi-vista
status: active
truth_mode: maintained
created: 2026-10-05
verified: 2026-10-07
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

Stage1 [canary](pi-agent-canary.md) adds an opt-in public-SDK script with fixed
fixture tools and private/in-memory resources. Parent actual-model lifecycle
trials are recorded independently from deterministic offline/source tests;
source review/CI/merge remain pending for this new script. No daily session
activation, live bank, production receipt, quality improvement or distribution
is inferred. SDK full declaration health stays a separate unresolved item.

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
