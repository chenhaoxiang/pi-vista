---
doc_type: spec
project: workspace
owner_repository: chenhaoxiang/pi-vista
status: active
truth_mode: maintained
created: 2026-10-11
verified: 2026-10-11
---

# Stage6 trusted-host provenance and pilot window — source candidate

This continuation uses the existing Pi-Continuum / pi-operational-rollout Change.
It is an evaluation-only trusted-host seam, not a new execution gate, permission
system, SDK replacement or default Pi entry. Primary native tasks never import it.
No model, bank, service, profile writer or shell broker is started by this source
slice. The preserved 16-call INVALID pilot is neither re-executed nor promoted.

## Paired ownership and SDK identity

The `01a11fcc` lane owns the independent SDK/broker metadata collector; the
`01a120e4` lane owns the coordinator, common integration and this design. They
write separate worktrees before integration; neither modifies the other's live
files. SDK/broker DTOs are copyable metadata, not opaque LOCAL evidence handles.

The legacy frozen measurement/canary contract is **public 1.0.4**. Historical
`1.0.4-fork.1` and the installed `1.1.0-fork.1` have distinct manifest/version
contracts. The same public entry digest does not establish equivalent SDKs,
transitive dependency identity, a loaded-module identity or vendor authentication.
Nothing relabels a fork as public 1.0.4 or changes the ancestor measurement parser.
A later runtime using a new SDK needs an explicit measurement-contract update;
this source slice does not make that decision implicitly.

Only explicit public package metadata/entry bytes may be collected for SDK
identity. The coordinator reuses the paired collector's
`validateSdkContractMatch`/`validateReadonlyBrokerMetadata`/`validateStage6Provenance`
outputs; it does not duplicate SDK or broker schemas. SDK match metadata keeps the
observed version/digests separate from the host-pinned expected contract. Broker
observation accepts only a closed explicit readonly command-pin input, hashes that
command internally and stats its target; no credential bytes, command execution or
complete profile traversal is permitted. Output omits paths, commands, credential
contents, raw prompts, model outputs and reasoning.

## Closed bindings, distinct identities

The public provenance DTO is `stage6-provenance/1`, with independent SDK match
and broker metadata, `subject_source_sha`, `history_digest` and eight-key
`bindings`:

- the existing LOCAL/evidence five bindings: `run_id`, `repo`, `source_sha`,
  `policy_version`, `env_fingerprint`;
- separate `harness_source_sha`, `context_digest`, `artifact_digest`.

`source_sha` is the subject source, not the harness, history or context digest.
History remains separately bound at the top level. Baseline/guided contexts use
the existing admission arm/guidance contract; neither history metadata nor its
successful read restores current permission or a previous WeakMap handle.

## One window, one total pretransport budget

`openStage6Pilot` accepts an explicit context/expected context, expected provenance,
bindings, observed pre-admission call count and bounded request/deadline limits.
Nonzero observed calls or mismatched context refuse before any profile/source
collection. Invalid counts remain null, not a manufactured zero. Refusal affects
this evaluation window only, not the primary Pi task.

The caller supplies `collectProvenance` and an explicit profile collector (null
selects the existing readonly `captureStage6Profile`). The coordinator captures a
profile before collection, collects and compares fresh provenance, then captures
another profile after preparation. Protected and volatile changes both refuse
admission; unknown actor attribution is not guessed.

One private budget reuses the canary pretransport seam across all distinct
baseline/guided sessions: total requests at most 16, at most two per native
session, exact provider/model/thinking. The coordinator binds each native
`session.agent` at most once; a second session object around the same agent is
refused so wrappers cannot stack or leave a withdrawn wrapper installed. Rebinding
a session or copying admission cannot reset limits. This is a counter at the
selected `streamFunction` boundary, not a universal network interceptor,
financial decision or new primary-task gate.
All collection and final-read waits share the window's bounded deadline. Trusted
callbacks may outlive their wait; a JavaScript timeout is not an OS sandbox or
proof that arbitrary synchronous/native side effects were cancelled.

At `finalize`, bindings retire before any final read, and a single cached Promise
prevents duplicate concurrent finalization. Both profile and provenance are
collected again. SDK/broker/source/history drift, profile drift and unavailable
collection preserve non-positive outcomes; bounded deadline failures retain a
fixed deadline reason rather than being relabelled as missing profile data. A
retained old stream wrapper is revoked and the original primary stream is
restored in reverse binding order; restoring it does not authorize a new pilot.

The budget is deliberately per coordinator window. The eventual pilot host must
put every baseline/guided arm in one window; opening a fresh window per arm would
create another counter and is not a pilot-wide budget guarantee. No global ledger,
new execution lock or primary-task restriction is introduced to compensate for
that trusted-host responsibility.

The broker command/path/stat digests are unsalted metadata fingerprints, not
secrecy guarantees. They omit the raw string but can link a repeated target or
confirm a guessed target; this disclosed metadata property does not certify
credential contents or Owner identity. Per-window keyed identifiers, if needed,
are a separate consumer-contract change, not silently added here.

## Result truthfulness

The window receipt always has `evaluation_status: not-evaluated`,
`verification: metadata-only`, `authorization: none`, `executable: false`.
`integrity_status: unchanged` means only that the explicitly collected metadata
matched within this window. It is not valid parsed decisions, semantic quality,
measured task benefit, current proof, installed SDK runtime certification or a
completed paired pilot. `pretransport_attempts` is the observed wrapper counter,
not a fabricated count of successful model/HTTP calls.

The full host still owns source/history/artifact readback, actual loaded SDK
provenance, request-envelope guarding, fixture tools, decision collection,
semantic grading, cost accounting and resource disposal. This slice does not
wire the plan-only CLI or default Pi and does not call the old private runtime.

## Acceptance and pending work

- [x] Closed collector fixtures: distinct public/fork contracts, missing/changed
  public files, readonly broker pin/metadata, no credential/shell access. The
  paired SDK lane supplies initial 29/29 Node26 and 29/29 actual Node20 targeted
  cases; integrated label/version credential-boundary follow-ups add two cases
  (31 collector cases). Its 1.1.0 observer/native-read acceptance is separately
  scoped and not a full provenance/current-proof or model acceptance.
- [x] Coordinator fixtures: pre-admission zero forwarding, setup and final
  protected/volatile drift, provenance drift, copyable metadata vs genuine
  admission, per-session and whole-window budgets, shared-agent wrapper refusal,
  deadline diagnostics, concurrent finalization, import inertness, refusal without
  raw diagnostics and explicit lifecycle. The initial integrated release-contract
  was 219/219; credential-boundary follow-ups passed 223/223, and lifecycle
  follow-ups now pass 227/227, with 17 coordinator cases and source/consumer plus
  actual Node20 gates passing in this candidate worktree. The original source BLOCK,
  subsequent version-path BLOCK and old-source regressions (30 pass / 1 fail for
  version; 14 pass / 3 fail for lifecycle) are kept;
  those failures are not overwritten or reclassified as successful.
- [ ] Existing source/packed-consumer/actual Node20 gates, fresh independent
  review, exact head CI, ordinary PR and main readback for this source candidate.
- [ ] Actual loaded-SDK/session/source/history/decision/transport acceptance in a
  new bounded model-free host scope; no source test claims it automatically.
- [ ] Only after the repaired harness is accepted, define a fresh k=1 model window
  with concrete SDK/subject/history/model/budget facts. The previous 16-call
  window remains INVALID and exhausted; k=3 and release remain separate.
