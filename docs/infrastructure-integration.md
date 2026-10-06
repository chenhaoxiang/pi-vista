---
doc_type: report
project: workspace
owner_repository: chenhaoxiang/pi-vista
status: completed
truth_mode: snapshot
created: 2026-10-06
verified: 2026-10-06
ssot: false
verification_boundary: functional-compatibility-only
---

# Infrastructure integration candidate

This snapshot records a completed **engineering integration slice**, not security
acceptance, owner verification, a main merge, registry publication or deployment.
The candidate branch is `feat/infrastructure-integration-20261006`, starting from
`81263a973525fcf3b4d3651c3ca27b18ad40477b` (core + observation CLI + checks).
Ordinary feature merges add the three pinned adapter candidates. Root workspace
scripts, lock metadata and document inventories use the union of reviewed
contents; protected package directories and their existing tests are unchanged
from the pins below. Core includes the reviewed Pi-branch own-environment lookup
and its 26th test. No dependency upgrade or reinstall is part of this slice.

**Open security blocker:** core/Pi/guard do not uniformly reject known embedded
`ghp_` and `github_pat_` credential patterns in identities. Four synthetic
source-pin reproductions (Pi and guard, each with both patterns) confirmed that
these identities can be retained and persisted through the actual EventStore.
This is a known defect, not an unknown-encoding caveat or approved behavior.
The protected source pins remain unchanged here; a separately reviewed security
fix and updated pins are required **before live use or publication**. Functional
build/test/pack results below do not clear this blocker or constitute a system-wide
privacy PASS. The new tests do not characterize credential persistence as correct.

## Public source pins and dependency map

GitHub source PR state was read on 2026-10-06 at 15:37 UTC: all six were **OPEN,
unmerged**, with these exact heads. Main remained at
`10ab8d7cb80fe34ef970500f2d3ffd566c2bedc5`; this candidate is not in main.
This is a snapshot, not a promise that remote refs cannot subsequently change.

| Public source | Pinned head | Candidate directory / dependency |
| --- | --- | --- |
| [Core/protocol PR #1](https://github.com/chenhaoxiang/pi-vista/pull/1) | `75f43e2e42df493c61f7999f0b13c390e98c3c37` | `packages/protocol`; initial core contract; PR base main |
| [Guard PR #2](https://github.com/chenhaoxiang/pi-vista/pull/2) | `d50703d5b693cbba8eb54030a4b9958142c0fe4b` | `packages/adapter-workspace-guard`; based on core candidate |
| [Pi PR #3](https://github.com/chenhaoxiang/pi-vista/pull/3) | `3fae1ea18e3536ff3a36db5843926997a11ccc6d` | `packages/adapter-pi` and final `packages/core`; based on core candidate |
| [Ai-gate PR #4](https://github.com/chenhaoxiang/pi-vista/pull/4) | `b3ec9feb189fdb20a61467ab8f3531f96c6e3249` | `packages/adapter-ai-gate`; based on core candidate |
| [CLI PR #5](https://github.com/chenhaoxiang/pi-vista/pull/5) | `a736380d7275dd89d706aa8225cfd4ae4ff235ac` | `packages/cli`; based on core candidate |
| [Checks PR #6](https://github.com/chenhaoxiang/pi-vista/pull/6) | `81263a973525fcf3b4d3651c3ca27b18ad40477b` | `packages/checks`; based on CLI candidate |

All seven public packages declare version `0.1.0`. Protocol is the shared
interface/version foundation; core supplies storage and emission. The adapters
and CLI use core, and checks consumes protocol descriptions without runtime
storage. Build order is fixed: protocol, core, Pi, guard, ai-gate, CLI, checks.
No new runtime framework or private owner implementation is copied into this
checkout. Pi is explicitly called by a host, not automatically installed or
hooked. Guard decisions and ai-gate admission remain outside pi-vista.

## Synthetic cross-package contract chain

`tests/infrastructure-integration.test.mts` uses only public package imports.
Every filesystem fixture is generated under the checkout's disposable `tmp/`
area and cleaned up by the test that created it. No real logs, credentials,
owner probes, model calls, network, repair, replay, promotion, Hindsight writes,
production configuration or deployment are involved.

The five additional tests cover:

1. **Common identity and persistence:** an explicit safe Pi run advances two
   steps; Pi calls/results, a guard shadow observation and opaque 64-hex shared
   input hash reference, matching gate evidence and three mismatching owner
   outcomes share the same core EventStore. A checkpoint binds the run/current
   step and completed steps. Stored JSONL is checked after actual core redaction.
2. **Recorded-only read chain:** all four CLI commands, inventory and step
   filtering run through both public API and the actual built bin in JSON/text.
   Repeated output is deterministic. Receipt provenance retains mismatch
   `owner_result`/`owner_status`; no conflicting source SHA becomes an event
   binding, and no gate reference gains a `verified` claim. An explicit Pi
   receipt `verified: true` is displayed only as an owner claim. Safe unknown
   `future/1` remains a label with compatibility not assessed. File inventories,
   sizes and SHA-256 hashes are identical before/after; absent stores stay absent.
3. **Metadata-only predicates:** checkpoint-supplied SHA/environment comparisons
   pass only after opt-in registration; a changed SHA fails STOP and skips later
   checks, a changed environment produces WARN without satisfaction, and no
   result is cached. Reports remain `predicate-only` and `authorization: none`;
   equal host claims are not actual Git/environment or owner verification.
4. **Relevant closed boundaries:** Pi/guard/gate reject raw fields and supported
   cross-run/step bindings before writes. The stricter ai-gate, CLI and checks
   boundaries reject wrapped classic/fine-grained token IDs or metadata without
   store writes or predicate callbacks. This does **not** claim equivalent
   credential-pattern rejection in the known-defective core/Pi/guard paths.
5. **Opposite failure semantics:** synthetic non-directory storage, rejecting
   observers and pending observer promises fail open in core/adapters/checkpoint
   observation. Exceptional, malformed and timed-out predicates remain
   unsatisfied and skip subsequent callbacks, even with WARN. No failure grants
   execution or other authorization.

The CLI is core-best-effort, not an exhaustive audit. Recorded `ok`, resumable
checkpoint metadata and receipt flags never authorize execution, merge, release
or promotion; mismatched owner success is not a verified pass.

## Validation snapshot

Using Node **26.9.0**, npm **11.19.1** and the existing exact locked developer
tools (TypeScript **5.9.3**, `@types/node` **20.19.43**, `undici-types` **6.21.0**):

| Check | Observed result |
| --- | --- |
| `npm run typecheck` | All seven public packages plus root integration test source passed |
| `npm run build` | All seven packages passed in dependency order |
| `npm test` | **192 passed**, zero failures/skips/cancellations: 187 existing + 5 integration |
| `git diff --check` | Passed |
| `npm_config_offline=true npm run pack:dry-run` | All seven `0.1.0` public package manifests packed in dry-run |
| Offline actual tarballs, manually extracted | Seven bare package imports, all declared export subpaths and declaration-file presence checked; dependency versions consistent |
| Extracted `vista` bin | Version/help/history/receipts matched API; isolated synthetic Pi/guard/gate/checkpoint/checks smoke passed; storage hashes unchanged |

Declared source test counts agree with the executed counts:

| Source suite | Existing tests |
| --- | ---: |
| Core (`core.test.ts`, including reviewed own-environment regression) | 26 |
| Protocol | 0 |
| Pi (`context.test.ts`) | 27 |
| Guard (`adapter.test.ts`) | 13 |
| Ai-gate (`adapter.test.ts`) | 36 |
| CLI (`observation.test.ts`: 22 direct + 4 parameterized; `parse.test.ts`: 17) | 43 |
| Checks (`check-functions.test.ts`, `runtime-boundary.test.ts`) | 42 |
| **Existing subtotal** | **187** |
| Root (`infrastructure-integration.test.mts`) | **5 new** |

There are 183 direct existing top-level `test(...)` calls plus four cases from
`observation.test.ts`'s unchanged `empty`/`missing`/`corrupt`/`unreadable` loop
(lines 329–330 at the CLI pin). Counting only unindented calls would incorrectly
omit those four; declared materialized cases and executed totals both equal 187.

The unified CLI fixture's three files retained these SHA-256 hashes across all
API/bin reads (relative synthetic storage labels only):

| Synthetic file | Bytes | Before = after SHA-256 |
| --- | ---: | --- |
| Run A checkpoint | 528 | `409cc326090a6b018a247bc0ba3a7b7b2a52b013027b85545aaeca541fdcf533` |
| Run A event JSONL | 3465 | `6fb7ad9f0e1721b4cdb2dd41008114149f130f7643d4824d9e4052b0b7a3d944` |
| Run B event JSONL | 423 | `75db03bc0c99d87a092a5060434981deb1f0f8362c2a9ae45d8132449392e58e` |

## Outstanding boundaries

- The confirmed core/Pi/guard credential-pattern defect is open. Producer
  sanitization remains mandatory; these integration checks do not establish
  comprehensive privacy or security safety. Reviewed fixes/new pins and an
  independent review are required before live/release use.
- No source PR or candidate PR is merged by this work. Feature merges do not
  authorize main changes, release, deployment or admission. Independent candidate
  review remains required.
- The declared Node >=20 floor was **not** exercised on Node 20. No runtime
  matrix, clean npm consumer install, consumer TypeScript compilation or registry
  availability was established.
- Actual tarballs were packed offline from built local workspaces with lifecycle
  scripts skipped for extraction, after separate build and prepack dry-run checks.
  Manual extraction and local bin wiring are not a clean install. Existing
  protected packaging hygiene (including compiled test/source-map inventory)
  remains unchanged and is not a publication acceptance claim.
- Predicate timeout is non-preemptive for synchronous trusted callbacks and does
  not undo side effects. CLI best-effort reads are not an atomic cross-store
  snapshot or a corruption inventory.
- Real owner integrations, automatic Pi loading, owner probes, repair, replay,
  promotion, Hindsight, network/model services and production configuration remain
  outside this candidate's validation boundary.

See [getting started](getting-started.md), [CLI](cli.md),
[Check Functions](check-functions.md), [architecture](architecture.md) and
[phases](PHASES.md) for the maintained contracts and deferred work.
