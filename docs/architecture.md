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

### Layer 2: Hindsight (primary long-term memory)

Hindsight provides the semantic memory layer. pi-vista writes to it only when an experience passes promotion criteria:

- gate receipt present and verified
- tests passed
- guard events clean (no A-layer blocks)
- content redacted (no raw commands, paths, credentials)
- source SHA bound

Two custom knowledge pages are added to each repo's Hindsight bank:

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

## Core data flow

```
execution event
    │
    ▼ redact()
VistaEvent written to runs/<run_id>/events.jsonl
    │
    │ on task complete
    ▼
promotion check:
  sha_bound? gate_passed? tests_passed? guard_clean? redactable?
    │
    │ pass
    ▼
generate VistaExperience (script + steps + failure_analysis)
    │
    ▼
hindsight_ingest_document(title, redacted_summary)
experience.status = "trusted"
```

---

## Component responsibilities

| Component | Owns | Does NOT own |
|---|---|---|
| pi-vista | event recording, checkpoint, experience lifecycle, promotion | safety decisions, gate admission, model routing |
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

pi-vista is **fail-open**: its unavailability never blocks task execution.

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
