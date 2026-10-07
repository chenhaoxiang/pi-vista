---
doc_type: guide
project: workspace
owner_repository: chenhaoxiang/pi-vista
status: active
truth_mode: maintained
created: 2026-10-05
verified: 2026-10-07
---

# pi-vista

**Pi VISTA** — Verified Interaction, State, Trajectory & Adaptation

A model-agnostic execution augmentation and experience system for Pi.

> Every model call produces experience. Every model call consumes experience.  
> No model is permanently "strong" or "weak" — the system grows regardless of which model runs.

This is the design goal. Current APIs are explicit and offline/synthetic-validated,
not automatic model-call instrumentation or demonstrated capability improvement.

**Merged source, not a published or live system:** [PR #7](https://github.com/chenhaoxiang/pi-vista/pull/7)
integrated the seven public packages and bounded metadata/generation repairs into
`main`. Exact-source review passed, and isolated post-merge validation passed
**232 tests** on Node 26.9.0. These checks do not establish release or operational
acceptance. The [merge closeout](docs/handoff/2026-10-06-source-merge-closeout.md)
records source commits, verification and remaining work. The [integration snapshot](docs/infrastructure-integration.md)
preserves the old source pins' credential defect as historical evidence; the
[shared metadata guide](docs/metadata-safety.md) describes the repaired contract
and its limits. Producer sanitization remains required.

**Merged continuation: 11 public source packages.** [PR #10](https://github.com/chenhaoxiang/pi-vista/pull/10)
normally merged the additive `evidence`, `learning`, `adapter-shadow` APIs and
repeatable source/packed-consumer gates into remote `main` on 2026-10-07.
Exact-source review was independent same-model full inspection plus retained
P1-fix recheck, not heterogeneous/human approval. Actual Node20/22/26 hosted
source/consumer CI passed before and after source merge; isolated post-merge
Node20 validation passed **567 test cases** and real eleven-tarball consumer
checks. See the [continuation closeout](docs/handoff/2026-10-07-verified-learning-source-closeout.md).

**Portable continuation:** live learning/retrieval remains process-local. This
additive seam supplies explicit signed **historical** recall/ports and observed-only
import across process lifetimes, not serialized current authority or live activation.
[PR #12](https://github.com/chenhaoxiang/pi-vista/pull/12) normally merged this
portable source on 2026-10-07. Independent same-model full inspection plus
retained entry-fix recheck, actual Ubuntu Node20/22/26 source/consumer CI and
isolated post-merge Node20 **659-case**/installed-process restart proofs passed.
See its [source closeout](docs/handoff/2026-10-07-portable-recall-source-closeout.md).
This acceptance is independently pinned, not transferred from PR10.
Real durable Hindsight storage and owner/live wiring remain pending. Shadow
observation requires explicit owner normalization. The observation CLI is unchanged.
See [learning](docs/learning.md), [portable recall](docs/portable-recall.md),
[shadow](docs/adapters/shadow.md),
[evidence](docs/authoritative-evidence.md), and the
[release contract](docs/release-contract.md) for checked scope and remaining limits.

---

## What it does

`pi-vista` provides explicit source APIs, not automatic session instrumentation:

- **Record** sanitized tool/guard/gate and owner-normalized shadow observations as a best-effort event stream
- **Inspect** recorded histories, checkpoints, count differences, and opaque receipt refs with the offline, read-only Phase 2 CLI
- **Prepare** validation with opt-in predicate registries and separately verify host-pinned signed gate/test/guard receipts
- **Preview and confirm** exact safe learning documents through an explicitly injected ingest/readback sink; no default Hindsight transport
- **Reuse offline** fresh verified/trusted handles as bounded script/step context and non-executing replay views
- **Authenticate historical recall** from exact signed safe archives through explicit public-key pins and Hindsight query/read ports after restart; observed-only import never restores current trust, and there is no real service integration, live context injection or demonstrated model capability lift

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
│  programmatic recorded replay / confirmed sink   │
└──────────────────────┬──────────────────────────┘
                       │  explicit digest confirmation + host sink
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
| `@pi-vista/evidence` | Opt-in pinned Ed25519 gate/test/guard receipts and opaque, non-authorizing proofs |
| `@pi-vista/learning` | Process-local lifecycle, exact confirmed sink/readback, verified-only and portable signed historical context, observed-only import and non-executing replay |
| `@pi-vista/adapter-shadow` | Explicit owner-normalized Laya/Kev/Intern/StartLux observations; never verification or permission |

---

## Design principles

1. **Model-agnostic** — no "teacher" or "student". Any call produces and consumes experience.
2. **Verification-first** — observations may become candidates, but verified/trusted learning requires fresh opaque owner evidence; trusted promotion additionally requires exact confirmation and successful readback.
3. **Safety boundaries are inviolable** — workspace-guard A-layer, gate final admission, and production hard gates are never controlled by pi-vista.
4. **Hindsight is the intended long-term memory** — this checkout has local observation stores and process-local live handles, plus explicit portable signed-history verification/ports. Real durable memory, semantic adapters, lifecycle reconciliation and policy loading require separate host implementation.
5. **Progressive adoption** — Phase 1 only observes. Experience promotion is an explicit action, never automatic.
6. **Redaction at source** — producers must keep raw commands, paths, and credentials out of Hindsight, the experience store, and model inputs. The bounded known-pattern candidate fix does not recognize arbitrary secret encodings or replace producer sanitization.

---

## What makes pi-vista different

Most agent observability tools stop at "record and replay." pi-vista adds:

- **Check Functions** — symbolic check definitions use explicit trusted predicates; repair/executable replay is refused (inspired by AgentRR, IPADS/SJTU 2025)
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
The additive evidence/learning APIs implement opt-in signed receipt verification,
dry-run/confirmed synthetic sink promotion and recorded-only replay. They do not
wire live owners or provide CLI check/promote/replay commands. See
[docs/check-functions.md](docs/check-functions.md) for the strict predicate subset
and [docs/learning.md](docs/learning.md) for process-local provenance, freshness,
character budgets and trusted-host limitations.

Source validation uses the locked offline toolchain:

```bash
npm ci --offline --ignore-scripts
npm run typecheck
npm run build
npm test
npm run lint
npm_config_offline=true npm run pack:dry-run
npm run gate:source
npm run gate:consumer
npm run gate:node20 -- --node=/absolute/path/to/verified-node20
```

These scripts cover all 11 public packages; root tests include original assertions,
new synthetic integration and release-script regressions. Actual local Node20 and
packed-consumer results are recorded in the [release contract](docs/release-contract.md).
They do not establish hosted GitHub CI, registry availability, live integration,
publication or operational acceptance.

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
- [Owner-normalized shadow adapter](docs/adapters/shadow.md)
- [Authority-bound evidence](docs/authoritative-evidence.md)
- [Verified learning and offline retrieval](docs/learning.md)
- [Portable signed historical recall and observed-only import](docs/portable-recall.md)
- [Repeatable source and packed-consumer gates](docs/release-contract.md)

The Pi adapter is a public helper only: Pi private extensions call it explicitly;
pi-vista does not install, patch, or hook Pi automatically. It does not own Pi
execution, fallback, watchdog, permission, or model-routing decisions.

`@pi-vista/adapter-ai-gate` consumes only owner-side, already-sanitized and
structured evidence. It is model-agnostic and read-only: it does not run
`gh`/API calls, read PR/CI/review content or gate configuration, infer a gate
result, or change ai-gate admission, merge, or deployment behavior.

The shadow adapter is also explicit and observational: allow/pass/confidence or
synthetic receipt existence never produces Vista `ok`, owner truth, isolation
proof, training/promotion eligibility or execution permission. No private owner
hook, model activation or normalization implementation is installed.

---

## License

MIT
