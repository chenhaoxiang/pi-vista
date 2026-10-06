# pi-vista

**Pi VISTA** — Verified Interaction, State, Trajectory & Adaptation

A model-agnostic execution augmentation and experience system for Pi.

> Every model call produces experience. Every model call consumes experience.  
> No model is permanently "strong" or "weak" — the system grows regardless of which model runs.

---

## What it does

`pi-vista` gives any Pi session a persistent, verifiable execution memory:

- **Record** every tool call, guard decision, gate check, and test result as a unified event stream
- **Define** the evidence model for inspecting tasks and merges (Phase 2 tools are planned)
- **Prepare** replay validation with Check Functions (Phase 2/3 implementation is planned)
- **Specify** promotion of verified experiences into Hindsight (future Phase 3 work)
- **Adapt** — each verified run makes the next run better, regardless of which model executes it

---

## Architecture

```
┌─────────────────────────────────────────────────┐
│                  Pi Execution Chain              │
│  Pi → workspace-guard → execution → gate/CI     │
└──────────────┬──────────────────────┬───────────┘
               │                      │
               ▼                      ▼
┌─────────────────────────────────────────────────┐
│           pi-vista  (observe, fail-open)         │
│                                                  │
│  event store │ checkpoint │ artifact refs        │
│  check fn registry │ experience lifecycle        │
│                                                  │
│  Phase 2+ tools: inspect / history / compare    │
│  replay / promote (planned)                     │
└──────────────────────┬──────────────────────────┘
                       │  verified + redacted → promote
                       ▼
┌─────────────────────────────────────────────────┐
│              Hindsight  (long-term memory)       │
│  Verified Skills │ Failure Patterns │ Decisions  │
└─────────────────────────────────────────────────┘
```

pi-vista is **fail-open**: if it crashes or is unavailable, Pi continues executing normally. It is a pure observer — it never sits between a command and its execution.

---

## Packages

| Package | Description |
|---|---|
| `@pi-vista/protocol` | Zero-dependency TypeScript interfaces |
| `@pi-vista/core` | Event store, checkpoint store, artifact refs |

---

## Design principles

1. **Model-agnostic** — no "teacher" or "student". Any call produces and consumes experience.
2. **Verification-first** — unverified content never becomes experience. Promotion requires evidence.
3. **Safety boundaries are inviolable** — workspace-guard A-layer, gate final admission, and production hard gates are never controlled by pi-vista.
4. **Hindsight is the primary memory** — pi-vista maintains only a local short-term event buffer and executable policy files. Long-term semantic memory lives in Hindsight.
5. **Progressive adoption** — Phase 1 only observes. Experience promotion is an explicit action, never automatic.
6. **Redaction at source** — raw commands, paths, and credentials never enter Hindsight, never enter the experience store, and never reach any model.

---

## What makes pi-vista different

Most agent observability tools stop at "record and replay." pi-vista adds:

- **Check Functions** — each experience carries executable validation steps that verify the environment before replay proceeds (inspired by AgentRR, IPADS/SJTU 2025)
- **Two-level experience** — Script-level (task skeleton) and Step-level (specific tool calls) stored separately so partial reuse is possible (inspired by Mem^p 2025)
- **Failure loop closure** — failures are analysed and stored, not discarded. The system learns from what went wrong (inspired by EvolveR 2025)
- **Deterministic safety floor** — unlike other experience systems, promotion cannot override hard safety rules. workspace-guard A-layer blocks are never "learned away"

---

## Getting started

```bash
npm install @pi-vista/core
```

`@pi-vista/core` declares `@pi-vista/protocol` as its runtime dependency, so
npm installs the matching published protocol package automatically. Install
`@pi-vista/protocol` separately when importing its interfaces directly:

```bash
npm install @pi-vista/protocol
```

Phase 1 ships the protocol interfaces, redaction, event emission, and local
stores. The `vista` history/inspect/promote CLI is planned for Phase 2; it is
not included in this release. See [docs/getting-started.md](docs/getting-started.md)
for adapter setup.

### Artifact statistics

`ArtifactRef.stats` accepts finite numbers and short metadata strings. The core
redactor retains at most 32 entries with short labels and values (up to 64
characters), while credential-, path-, URL-, and shell-like names or values are
redacted or omitted. Stats never carry artifact content or secrets.

Custom components are structured `custom:<namespace>` identifiers, not shell
commands. A recognized command word is rejected when it is the complete suffix
(for example, `custom:pwd` and `custom:bash`), while command words inside a
namespace remain valid (for example, `custom:adapter/git/v2`). Emission and
EventStore writes validate before persistence, and readers discard invalid
records.

---

## Integration

- [workspace-guard adapter](docs/adapters/workspace-guard.md)
- [ai-gate adapter](docs/adapters/ai-gate.md)

Additional adapters are future work; the links above are the only adapter guides shipped in Phase 1.

---

## License

MIT
