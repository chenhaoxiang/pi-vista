# pi-vista

**Pi VISTA** — Verified Interaction, State, Trajectory & Adaptation

A model-agnostic execution augmentation and experience system for Pi.

> Every model call produces experience. Every model call consumes experience.  
> No model is permanently "strong" or "weak" — the system grows regardless of which model runs.

**Merged source, not a published or live system:** [PR #7](https://github.com/chenhaoxiang/pi-vista/pull/7)
integrated the seven public packages and bounded metadata/generation repairs into
`main`. Exact-source review passed, and isolated post-merge validation passed
**232 tests** on Node 26.9.0. These checks do not establish release or operational
acceptance. The [merge closeout](docs/handoff/2026-10-06-source-merge-closeout.md)
records source commits, verification and remaining work. The [integration snapshot](docs/infrastructure-integration.md)
preserves the old source pins' credential defect as historical evidence; the
[shared metadata guide](docs/metadata-safety.md) describes the repaired contract
and its limits. Producer sanitization remains required.

---

## What it does

`pi-vista` gives any Pi session a persistent, verifiable execution memory:

- **Record** every tool call, guard decision, gate check, and test result as a unified event stream
- **Inspect** recorded histories, checkpoints, count differences, and opaque receipt refs with the offline, read-only Phase 2 CLI
- **Prepare** validation with a bounded, opt-in programmatic Check Function registry (Phase 3A predicate-only foundation, not replay or owner verification)
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
│  Phase 2: history / inspect / compare / receipts │
│  replay / promote (planned)                      │
└──────────────────────┬──────────────────────────┘
                       │  verified + redacted → promote
                       ▼
┌─────────────────────────────────────────────────┐
│              Hindsight  (long-term memory)       │
│  Verified Skills │ Failure Patterns │ Decisions  │
└─────────────────────────────────────────────────┘
```

Core observation is **fail-open**: if it crashes or is unavailable, Pi continues
executing normally. It never sits between a command and its execution. The
separate opt-in Check Function API is **fail-closed** for predicate satisfaction,
not a source of execution, merge, release or promotion authorization.

---

## Packages

| Package | Description |
|---|---|
| `@pi-vista/protocol` | Zero-dependency TypeScript interfaces |
| `@pi-vista/core` | Event store, checkpoint store, artifact refs |
| `@pi-vista/adapter-pi` | Low-coupling Pi session/run context and safe tool summaries |
| `@pi-vista/adapter-workspace-guard` | Public adapter for sanitized workspace-guard observations |
| `@pi-vista/adapter-ai-gate` | Read-only mapping of sanitized owner-side gate evidence |
| `@pi-vista/cli` | Offline, read-only history/inspect/compare/receipts and public observation API |
| `@pi-vista/checks` | Trusted programmatic registry and bounded predicate-only runner; no owner probes, repair or authorization |
| `@pi-vista/checks-local` | Explicit trusted-host actual local FS/Git predicates; private aliases/config, read-only and no authority |

---

## Design principles

1. **Model-agnostic** — no "teacher" or "student". Any call produces and consumes experience.
2. **Verification-first** — unverified content never becomes experience. Promotion requires evidence.
3. **Safety boundaries are inviolable** — workspace-guard A-layer, gate final admission, and production hard gates are never controlled by pi-vista.
4. **Hindsight is the primary memory** — pi-vista maintains only a local short-term event buffer and executable policy files. Long-term semantic memory lives in Hindsight.
5. **Progressive adoption** — Phase 1 only observes. Experience promotion is an explicit action, never automatic.
6. **Redaction at source** — producers must keep raw commands, paths, and credentials out of Hindsight, the experience store, and model inputs. The bounded known-pattern candidate fix does not recognize arbitrary secret encodings or replace producer sanitization.

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
# Optional explicit observation helpers:
npm install @pi-vista/adapter-pi @pi-vista/adapter-workspace-guard @pi-vista/adapter-ai-gate
```

These are package-consumer usage examples, not evidence of registry availability.
`@pi-vista/core` declares `@pi-vista/protocol` as its runtime dependency, so a
consumer install requires the matching protocol package too. Install
`@pi-vista/protocol` separately when importing its interfaces directly:

```bash
npm install @pi-vista/protocol
```

Phase 1 provides protocol interfaces, redaction, event emission, and local
stores. This checkout also implements the bounded Phase 2 `@pi-vista/cli`
observation slice; this is not a registry-publication or deployment claim.
This checkout also includes the first Phase 3A programmatic Check Function
foundation. Trusted host code explicitly registers boolean predicates; opt-in
`sha_matches`/`env_matches` compare safe host-supplied metadata, not actual Git
or environment observations. STOP/WARN are supported, REPAIR is refused before
callbacks, and missing/exceptional/malformed/timed-out checks fail closed. Reports
always say `verification: predicate-only` and `authorization: none`.
The separate `@pi-vista/checks-local` addon explicitly observes registered local
paths, actual HEAD/full branch refs and Git status through private host config;
its protocol params contain aliases and safe expected SHAs, never paths or
commands. It does not replace the base no-I/O runtime or grant authority. See
[docs/local-check-probes.md](docs/local-check-probes.md) for its six handlers,
read-only controls, trusted-Git assumptions and non-atomic filesystem limits.
Experience promotion, replay, receipt/test owner verification and CLI check
commands remain future work. See [docs/check-functions.md](docs/check-functions.md)
for the strict safe input subset, snapshots, ordering and non-preemptive timeout
limits.

```bash
npm run build
node packages/cli/dist/bin.js history --base-dir ./synthetic-store
node packages/cli/dist/bin.js inspect run-example --base-dir ./synthetic-store --json
node packages/cli/dist/bin.js compare run-example run-other --base-dir ./synthetic-store
node packages/cli/dist/bin.js receipts run-example --base-dir ./synthetic-store
```

An installed CLI package exposes the same entrypoint as `vista`. All views are
recorded-only and core-best-effort, not exhaustive audits. Receipt `verified`
flags and `ok` results are owner claims, not independent verification or
execution/merge authorization. The CLI never resolves artifact content or writes
storage. See [docs/cli.md](docs/cli.md) for privacy, limits and exit semantics,
and [docs/getting-started.md](docs/getting-started.md) for adapter setup.

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

- [Merged source closeout and remaining work](docs/handoff/2026-10-06-source-merge-closeout.md)
- [Historical infrastructure candidate, source pins and validation](docs/infrastructure-integration.md)
- [Shared credential metadata safety contract and limits](docs/metadata-safety.md)
- [workspace-guard public observation adapter](docs/adapters/workspace-guard.md)
- [ai-gate adapter](docs/adapters/ai-gate.md)
- [Pi run-context adapter](docs/adapters/pi.md)

The Pi adapter is a public helper only: Pi private extensions call it explicitly;
pi-vista does not install, patch, or hook Pi automatically. It does not own Pi
execution, fallback, watchdog, permission, or model-routing decisions.

`@pi-vista/adapter-ai-gate` consumes only owner-side, already-sanitized and
structured evidence. It is model-agnostic and read-only: it does not run
`gh`/API calls, read PR/CI/review content or gate configuration, infer a gate
result, or change ai-gate admission, merge, or deployment behavior.

Additional adapters are future work; the links above are the adapter guides shipped in Phase 1.

---

## License

MIT
