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
This implementation status does not claim registry publication or deployment;
Phase 3 replay/check-registry/promotion is not included.

---

## Phase 3: Experience layer (weeks 6-10, three parallel sub-tracks)

### Track A: Check Functions

Register and execute environment validation before replay:

```bash
vista check register worktree_create
vista check run worktree_create --repo <repo> --task <task>
```

Priority coverage:
- worktree creation
- branch existence
- SHA verification  
- gate receipt binding

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
