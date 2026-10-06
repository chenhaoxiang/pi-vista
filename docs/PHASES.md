# pi-vista Implementation Phases

## Phase 1: Protocol layer (weeks 1-2)

**Goal**: unify events from Pi, workspace-guard, and ai-gate under a single `run_id`. No behavior changes.

**Deliverables**:
- `@pi-vista/protocol`: all TypeScript interfaces
- `emit.ts`: `emitVistaEvent()` utility
- `redact.ts`: redaction pipeline
- `run-id.ts`: `run_id` generation and injection

**Acceptance**:
```bash
cat ~/.pi/vista/runs/<run_id>/events.jsonl | jq .component | sort | uniq
# → pi, guard, gate  (all sharing the same run_id)
```

**Risk**: minimal. Emit failures are fail-open; task execution continues.

---

## Phase 2: Observation tools (weeks 3-5)

**Goal**: make a task's recorded evidence chain inspectable without changing
execution or safety authority.

**Implemented bounded slice in this checkout**: `@pi-vista/cli`, the offline,
read-only `vista` bin, and a testable public API:
```
vista history [run_id]
vista inspect <run_id> [--step <step_id>]
vista compare <run_id_a> <run_id_b>
vista receipts <run_id>
```

**Checked acceptance for this slice**:
- Sorted run inventory and deterministic recorded timelines/count differences
- Run/step-bound checkpoint inspection without resume or execution
- Deduplicated opaque receipt refs with explicit owner-claim provenance, not
  independently verified checks or merge authorization
- Strict parsing, fixed safe errors, closed privacy projection and bounded output
- Parser/API and spawned-bin JSON/text tests on disposable synthetic fixtures;
  before/after directory/file hashes and absent-store checks prove no writes

Core storage is best-effort: empty/omitted records do not prove an exhaustive
history, audit PASS, or successful run. Unknown safe versions remain untrusted
recorded labels. See [cli.md](cli.md) for exact limits and trust boundaries.
This implementation status does not claim registry publication or deployment.
Phase 3 replay/promotion is not included; the separate first programmatic
check-registry slice is described below.

---

## Phase 3: Experience layer (weeks 6-10, three parallel sub-tracks)

### Track A: Check Functions

**Implemented first bounded slice**: `@pi-vista/checks`, a programmatic trusted
callback registry and ordered predicate runner consuming existing
`VistaCheckFunction` descriptions. All inputs validate before callbacks and use
detached immutable own-data snapshots. STOP/WARN are supported; REPAIR is
unsupported and rejected before callbacks. Missing handlers, malformed verdicts,
exceptions and bounded async timeouts fail closed, even with WARN. Timeout cannot
preempt synchronous trusted code or undo side effects. No cached passes, hidden
retries, repairs, runtime persistence or safety-authority integration are added.

The base package's only supplied, **opt-in** implementations are `sha_matches` and `env_matches`,
pure expected/actual safe-metadata comparisons, not Git/environment collection
or independent owner verification. Reports always carry `verification:
predicate-only` and `authorization: none`; passing predicates grant no replay,
execution, merge, release or promotion permission. See
[check-functions.md](check-functions.md) for exact API, safety subset and limits.

**Implemented separate local-addon slice**: `@pi-vista/checks-local` creates a
fresh explicit trusted-host registry with actual local `path_exists`,
`path_not_exists`, HEAD `sha_matches`, full-ref `branch_exists`/
`branch_not_exists` and Git-status `worktree_clean`. Protocol params are symbolic
aliases/expected safe SHA; root/repo/relative-path/ref and Git executable selection
remain detached private host config. Namespace, subprocess, abort and unsupported
filter/submodule failures are hard even under WARN. Fixed read-only Git controls
and component walks do not make trusted local Git a hostile sandbox or reads an
atomic/race-proof jail. The base runtime stays no-I/O; all reports remain
predicate-only and authorization none. See [local-check-probes.md](local-check-probes.md).
No receipt/test-source authenticity, owner/gate integration, CLI check commands,
repair, Hindsight or replay is added.

**Future work, not implemented commands**:

```bash
vista check register worktree_create
vista check run worktree_create --repo <repo> --task <task>
```

Future trusted-owner coverage (not implemented by the local observations):
- worktree creation
- source/receipt/test authenticity beyond observing an actual local HEAD
- gate receipt binding and actual test results

Source/test/pack and offline tarball smoke do not establish publication, a clean
consumer install, Node 20 runtime behavior or operational acceptance. Replay and
experience reuse remain future work.

### Track B: Hindsight promotion (future CLI)

```bash
vista promote <run_id> [--dry-run]
```

This is a future command, not part of the implemented observation CLI. Dry-run
is intended to show exactly what will be written before committing.

### Track C: Failure analysis

```bash
vista failure analyze <run_id>
vista failure ingest <failure_id>   # writes Correction: to Hindsight
```

---

## Phase 4: Experience retrieval (after sufficient verified data)

On task start, Pi sessions receive:

```
Related experience: last successful run of this task type (run: a3f2b1c)
Steps: ...
Watch out: step 2 requires worktree path check
Known failure: if source_sha mismatches, gate fails at step 4

Hindsight skills: Skill: worktree creation flow (verified 2026-10-03)
```

---

## What is explicitly out of scope (permanently)

- Online model weight updates
- Automatic modification of guard rules
- Automatic modification of gate thresholds
- Any production auto-approval
- Training data pipelines (Phase 4+ only, with separate authorization)
