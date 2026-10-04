# pi-vista

**Pi VISTA** — Verified Interaction, State, Trajectory & Adaptation

A model-agnostic execution augmentation and experience system for Pi.

> Every model call produces experience. Every model call consumes experience.  
> No model is permanently "strong" or "weak" — the system grows regardless of which model runs.

---

## What it does

`pi-vista` gives any Pi session a persistent, verifiable execution memory:

- **Record** every tool call, guard decision, gate check, and test result as a unified event stream
- **Inspect** the full evidence chain behind any task or merge
- **Replay** past execution paths with environment validation (Check Functions)
- **Promote** verified experiences into long-term memory via Hindsight
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
│  inspect / history / compare / replay / promote  │
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
| `@pi-vista/protocol` | Zero-dependency TypeScript interfaces and schemas |
| `@pi-vista/core` | Event store, checkpoint store, artifact refs |
| `@pi-vista/check` | Check Function engine for replay validation |
| `@pi-vista/replay` | Replay manifests and dry-run execution |
| `@pi-vista/inspect` | `vista history`, `vista inspect`, `vista compare` CLI |
| `@pi-vista/promote` | Experience promotion pipeline to Hindsight |
| `@pi-vista/adapter-pi` | Pi extension adapter |
| `@pi-vista/adapter-test` | Test framework adapter |
| `@pi-vista/adapter-browser` | Browser automation adapter |

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
npm install @pi-vista/protocol @pi-vista/core
```

See [docs/getting-started.md](docs/getting-started.md) for adapter setup.

---

## Integration

- [Pi adapter](docs/adapters/pi.md)
- [workspace-guard adapter](docs/adapters/workspace-guard.md)
- [ai-gate adapter](docs/adapters/ai-gate.md)
- [Laya adapter](docs/adapters/laya.md)
- [Kev adapter](docs/adapters/kev.md)

---

## License

MIT
