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

**Goal**: make any task's evidence chain inspectable.

**Planned deliverables (the Phase 1 release does not ship this CLI)**:
```
vista history <run_id>
vista inspect <run_id> [--step <step_id>]
vista compare <run_id_a> <run_id_b>
vista receipts <run_id>
```

**Acceptance**:
- Can answer "which checks did this merge pass?"
- Can identify "which step failed and why?"
- Can diff two runs that had different outcomes

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

This is a future command; no `vista` CLI is shipped in Phase 1. Dry-run is
intended to show exactly what will be written before committing.

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
