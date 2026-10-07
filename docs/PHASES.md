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

This is a maintained source-scope roadmap. The current continuation locally
integrates **11 public packages**, not a live learning system or remote source
acceptance. Historical seven-package merge evidence remains in the
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

**Pending**: actual owner producers/keys/readers, revocation/durable provenance,
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

**Pending**: real Hindsight transport/durability, cross-process idempotency,
crash reconciliation, durable lifecycle storage, owner/operator integration and
CLI `vista promote`. The custom-pages export is data only, not a memory write.
See [learning.md](learning.md).

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

**Pending**: cross-run Hindsight recall/import across process lifetimes, durable
storage, semantic retrieval, automatic task-start Pi context injection, remote
revocation discovery and external model capability measurement. Serialized
status-labelled documents cannot become verified handles. Success on known offline
fixtures is not production adaptation or capability lift.

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
