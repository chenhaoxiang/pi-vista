---
doc_type: guide
project: workspace
owner_repository: chenhaoxiang/pi-vista
status: active
truth_mode: maintained
created: 2026-10-05
verified: 2026-10-07
ssot: true
---

# pi-vista Architecture

## Overview

pi-vista is built around a single principle: **every model call, regardless of which model, should both produce and consume verified execution experience.**

The system deliberately avoids distinguishing "strong" from "weak" models. The runtime capability of any session is:

```
effective_capability =
  model_itself
  + available_tools
  + verified_skill_library       ← pi-vista provides
  + execution_state_memory       ← pi-vista provides
  + failure_pattern_library      ← pi-vista provides
  + environment_validation       ← pi-vista provides (Check Functions)
  + long_term_semantic_memory    ← Hindsight provides
  + deterministic_safety_floor   ← workspace-guard / ai-gate provide
```

---

This capability equation is a design goal, not measured model capability or
automatic Pi integration. The current 11-package continuation implements explicit
observation/evidence/learning/shadow APIs and offline synthetic evaluation.
No model calls, owner activation or executable replay are installed.

## Storage layers

### Layer 1: Local event buffer (high-frequency, never enters Hindsight)

```
~/.pi/vista/
├── runs/<run_id>/
│   ├── events.jsonl          # append-only event stream
│   ├── checkpoints/<step>.json
│   └── meta.json
├── policy/
│   ├── scripts/<task_type>.json   # Script-level (high-level task skeleton)
│   ├── steps/<step_id>.json       # Step-level (specific tool calls)
│   └── checks/<check_id>.json     # Check Function definitions
└── index/
    └── experience.jsonl           # experience promotion log (append-only)
```

Only the event/checkpoint stores above are implemented persistence. The
`policy/`, `meta.json` and `index/experience.jsonl` layout is a roadmap, not an
installed policy loader or durable learning store. Learning identities, lifecycle,
selection and idempotency are bounded and process-local. Serialized live views
cannot restore their provenance. The opt-in portable learning seam can authenticate
signed safe **history** in a new process using explicit public pins and query/read
ports, without restoring current proof. Durable storage/reconciliation remains host work.

Checkpoint storage is fail-open for storage I/O and redacts before writing through a same-directory temporary file plus atomic rename. Invalid checkpoint protocol input is rejected; `CheckpointStore.load(runId, stepId)` returns the checkpoint only when its contents match both requested IDs, bind to the requested run, and pass runtime validation, otherwise `null`. `listCheckpoints(runId)` returns only parsed, redacted, run-bound checkpoint step IDs in stable lexicographic order (not numeric or timestamp order). A same-step concurrent save has no locking or compare-and-swap: the last atomic rename to the step's destination wins (last-writer-wins). A failed save cleans up its temporary file when possible; a process crash can leave a temporary file for later manual cleanup.

Check-function repair is an opaque contract: `VistaCheckFunction` may carry only a
`repair_action_id`, never a shell command, command template, or executable text.
A trusted policy registry must validate and resolve that identifier to an
allowlisted repair action before execution. Unregistered or untrusted protocol
input cannot select arbitrary shell behavior. This registry boundary is
separate from fail-open event/checkpoint observation and does not change the
safety authority of workspace-guard or ai-gate.

The implemented Phase 3A first slice, `@pi-vista/checks`, is separate from core
storage: trusted host code explicitly registers in-process predicates for
`VistaCheckFunction` descriptions. It validates all own-data definitions,
params, safe structured context and bounded options before callbacks, then uses
detached immutable snapshots. STOP/WARN are supported; REPAIR is refused before
any callback and repair IDs are never resolved, including on STOP/WARN. Missing
handlers, exceptions, invalid verdicts and timeouts fail closed for predicate
satisfaction, unlike fail-open observation. Timeouts bound asynchronous waits,
not synchronous blocking code or host side effects.

Its opt-in `sha_matches`/`env_matches` are pure safe expected/actual metadata
comparisons, not independent Git/environment/owner probes. There are no default
path/branch/worktree/receipt/test implementations, policy-file loading, shell or
dynamic code, filesystem/network/process operations, runtime persistence,
Hindsight, CLI check commands, replay or promotion. Reports carry
`verification: predicate-only` and `authorization: none` and exclude raw params,
context, descriptions and errors. Predicate passes never override safety
admission or infer permission from recorded flags. See
[check-functions.md](check-functions.md) for the maintained API and limits.

`ArtifactRef.stats` is limited to finite numbers and short metadata strings.
The core redactor retains at most 32 entries and at most 64 characters per
string, and applies credential/path/URL/shell redaction before retaining text;
stats do not contain artifact content. Unknown object property names that look
like paths, credentials, tokens, or shell syntax are dropped before persistence;
protocol fields, legal metadata, and safe stats keys remain discoverable.

Custom components are structured identifiers, not shell command fields. The
runtime grammar rejects a recognized shell command word when it is the complete
custom suffix (for example, `custom:pwd`, `custom:whoami`, `custom:rm`,
`custom:cat`, `custom:git`, `custom:curl`, and `custom:bash`). The boundary is
anchored to the complete suffix: command words inside a namespace remain valid,
so `custom:adapter/git/v2` is retained. Validation happens before emission or
EventStore writes; readers discard records that fail the same grammar, so an
invalid component is never persisted or returned as a valid event.

### Layer 2: Hindsight (primary long-term memory)

Hindsight is the intended semantic memory layer. The new programmatic
`@pi-vista/learning` library has **no default transport or bank integration**.
It accepts only an exact `@pi-vista/evidence` verifier identity: pinned Ed25519
issuer/kind public keys, required successful gate checks/test suites, complete
clean guard coverage, content hashes, freshness and all five
run/repo/source/policy/environment bindings. Unsigned owner logs, CLI flags,
predicate reports and shadow votes cannot mint opaque proof.

A safe observation is nominated, verified with that proof, and rendered as an
exact read-only dry-run. Only explicit preview-digest confirmation triggers fresh
receipt revalidation and an injected host sink's ingest **and exact readback**.
Failures/uncertain writes never mint trusted state; callbacks must truthfully
observe persistence. No actual Hindsight durability is validated here.

The additive [portable recall seam](portable-recall.md) exports safe historical
archives only from current authentic fresh library state, after re-reading owner
evidence and an explicitly injected archive-origin signature. Exact confirmed
upload reuses the sink/readback boundary but does not raise live trust. A new
process can authenticate original documents under scoped historical public pins,
age/revocation policy and optional fresh explicit host lifecycle policy; generated
knowledge pages/flags cannot qualify. Query/read ports install no client or bank.
Historical context is executable=false/current-verification-not-checked; import
creates observed-only new-run records requiring fresh current proof later.

The exported `HINDSIGHT_CUSTOM_PAGES` is configuration data only; these pages
are **not automatically added** to any real bank:

```json
{
  "customPages": {
    "Verified skills": {
      "source_query": "What task patterns have been successfully completed, verified by tests and gate receipts, and are safe to reuse?",
      "tags": ["knowledge:skill"]
    },
    "Failure patterns": {
      "source_query": "What has failed repeatedly? What was the root cause and the verified fix?",
      "tags": ["knowledge:failure"]
    }
  }
}
```

### Layer 3: Artifact references (pointers only)

pi-vista stores references to artifacts (receipts, diffs, test results), never the content itself. Content stays in gate / CI / artifact stores at its original location.

---

## Explicit data flows

```text
sanitized observation -> fail-open core event/checkpoint stores
                      -> unchanged offline/read-only CLI views

safe synthetic script/steps -> observed -> candidate
pinned signed gate/test/guard receipts -> opaque fresh evidence -> verified
verified -> exact dry-run preview (no reads/writes)
explicit digest confirmation -> re-read unchanged receipts
                             -> host-injected ingest + exact readback -> trusted
```

These are independent opt-in flows, not a task-complete hook. All evidence,
learning, replay, retrieval and predicate views say `authorization: none`.
`retrieve` accepts only current minted verified/trusted handles and truthful
repo/source/policy/environment/task query bindings. It performs no receipt or
Hindsight reads; subsequent revocation/owner changes are not discovered offline.
`compileContext` carries receipt-digest provenance and whole-entry **character**
budgets, not token limits. Fixture evaluation is selection coverage, not capability
lift. No automatic Pi context injection is implemented. Explicit portable signed
historical recall can cross process lifetimes; it is separate from live retrieval
and never restores a serialized handle or current owner check.

`planReplay`/`compareRecorded` are same-run symbolic metadata views with
`executable: false`. They invoke no tools or repairs. The additive shadow adapter
requires explicit owner normalization, maps pass/allow to unknown, preserves
veto/abstention/missing context, and never emits ok or grants truth, isolation,
training/promotion eligibility. Digests are metadata, not source/authority proof.
See [evidence](authoritative-evidence.md), [learning](learning.md), and
[shadow](adapters/shadow.md) for bounded contracts and trusted-host limits.

---

## Component responsibilities

| Component | Owns | Does NOT own |
|---|---|---|
| pi-vista | explicit observation stores, process-local lifecycle, signed-proof checking, confirmed injected sink, bounded offline/historical context and explicit portable verification/ports | safety decisions, gate admission, model routing, live producer wiring, real Hindsight transport/durability or current trust restoration |
| workspace-guard | shell parsing, path resolution, A-layer blocking | experience storage, model input |
| ai-gate | CI, review, SHA binding, merge admission | experience indexing, model input |
| Laya | semantic shadow judgment, council | raw event storage, experience promotion |
| Kev | isolation, offline assets, venv | experience storage, safety rules |
| Hindsight | long-term semantic memory, knowledge pages | real-time event streaming, check execution |

---

## Safety invariants

The following can **never** be overridden by pi-vista, regardless of what experiences are stored:

1. workspace-guard A-layer hard blocks
2. ai-gate final admission decision
3. production, credential, and billing hard gates
4. Kev G2/D2 isolation boundaries

Core observation is **fail-open**: its unavailability never blocks task
execution. The optional programmatic checks API is **fail-closed** only for its
own predicate satisfaction report. It neither intercepts execution nor grants
replay, merge, release or promotion permission. Actual safety decisions remain
with the owners listed above.

## Source/package validation boundary

Root gates cover 11 source packages and synthetic public-import integration.
Repeatable scripts perform offline locked npm ci, actual local tarball installation,
all public exports/bin checks and strict consumer TypeScript on actual Node20.
Local content/advisory checks are bounded, not an App-trusted owner receipt,
universal secret detector or release authority. The PR10 foundation's completed
source review, hosted Node20/22/26 CI and isolated post-merge validation are recorded
in the [source closeout](handoff/2026-10-07-verified-learning-source-closeout.md).
[PR #12](https://github.com/chenhaoxiang/pi-vista/pull/12) normally merged the
portable source after its own same-model full inspection/retained entry recheck
and actual hosted Node20/22/26 CI. Its [source closeout](handoff/2026-10-07-portable-recall-source-closeout.md)
records reviewed/merged pins and isolated actual-main 659-case/installed-process
proofs; no publication, deployment or live/durable operational acceptance is implied. See [release-contract.md](release-contract.md)
for exact evidence and limitations.

## Protocol versions

Phase 1 is currently a 0.x protocol. `vista_version` may be omitted for legacy records, but when present it must be a non-empty, control-free, safe version label. Safe unknown versions may use namespace slashes (for example, `future/1`) but must not contain credentials, paths, URLs, or shell payloads. Readers retain unknown version strings for inspection; validation checks the record shape and safety constraints only and must not treat an unknown version as the current protocol. A future compatibility decision will be explicit rather than inferred.

---

## Research foundations

| Design decision | Source |
|---|---|
| Check Functions | AgentRR (IPADS/SJTU, 2025) |
| Two-level experience (Script + Step) | Mem^p (2025) |
| Failure analysis closure | EvolveR (2025) |
| Hierarchical experience retrieval | MetaFlow (NeurIPS 2025) |
| Privacy-aware replay | AgentRR (2025) |
| Deterministic safety floor | pi-vista original (workspace-guard integration) |
