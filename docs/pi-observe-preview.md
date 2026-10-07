---
doc_type: guide
project: workspace
owner_repository: chenhaoxiang/pi-vista
status: active
truth_mode: maintained
created: 2026-10-07
verified: 2026-10-07
ssot: true
---

# Explicit Pi observation and historical guidance preview

`@pi-vista/learning/pi` is one optional run-epoch observation/preview seam. It
exports `createPiObservation(config)`, frozen programmatic controller/types and
fixed value-free `PiObservationError` codes (`invalid-config`, `refused`). The
learning root and `@pi-vista/adapter-pi` runtime are unchanged. No SDK dependency,
peer auto-install, `pi` manifest, `.pi` resource, settings or default activation
is added. This source candidate is **provisional pending independent source
review, hosted CI and parent-owned PR/merge**; local checks are not acceptance
of real owners, keys, banks, models or an interactive task.

Every status/preview/selection says **authorization: none, executable: false**.
Historical authentication is not current verification, and neither is execution,
merge or release permission. Actual compatible owner receipt producers and
public-key provenance remain **MISSING / separately unaccepted**.

## Explicit host wiring

```ts
import { createPiObservation } from "@pi-vista/learning/pi";
import type { ExtensionFactory } from "@earendil-works/pi-coding-agent";

const vista = createPiObservation({
  resolve_task: async () => safeHostTask, // no event/context arguments
  now: trustedHostClock,
  tools: [{ native_name: "read", classification: "metadata-reader" }],
  // Optional: closed ports wrapping explicitly configured actual stores.
  events: { append: async event => { await explicitEventStore.append(event); } },
  checkpoints: { save: async checkpoint => { await explicitCheckpointStore.save(checkpoint); } },
  // Optional existing PortableRecallConfig: pinned public origins, explicit clock,
  // age policy, exact query/read port and optional host lifecycle policy.
  history: explicitHistoricalConfig,
  preview_on_start: false,
  // Optional, supplied together: exact evidence-factory identity + safe subjects.
  verifier: exactEvidenceVerifier,
  subjects: { gate: "owner-gate", test: "owner-test", guard: "owner-guard" },
  timeout_ms: 250,
  max_pending_work: 16,
  max_correlations: 256,
  max_items: 8,
  max_characters: 8192,
});
const extension: ExtensionFactory = vista.extension;
// Supply extension through a host-owned inline resource loader, explicitly.
// No resource discovery, installation, createAgentSession or model call here.
const status = vista.controller.status(); // usable without UI/stdout
```

This example describes public API syntax, not registration/publication or owner
key authenticity. The SDK-only assignment check skips upstream dependency
declaration diagnostics as described below; do not infer full SDK type health.
A new extension runtime uses a new factory/controller instance; registration on
one instance is one-shot. Hosts must reserve the four command names and handle
Pi's normal conflict diagnostics, rather than using the addon to override an
existing command or owner decision.

### Closed configuration and task metadata

Required config fields are `resolve_task`, `now`, `tools`. All callbacks are
explicit trusted in-process code; async callbacks must return native promises.
Config and returned tasks are ordinary/null-prototype own data only: no getters,
Proxies/revoked Proxies, symbols, unknown/undefined fields, sparse/custom arrays
or custom prototypes. Configuration is snapshotted and validated **before host
callbacks**. Import/factory creates no timer, background task, socket or store,
and calls no host clock/resolver/port. Portable config validation uses a synthetic
internal clock, then real preview operations use the explicit host history clock.

`resolve_task()` returns exactly:

- `repo`, `source_sha` (40/64 hex), `policy_version`, `env_fingerprint`;
- `task_type`, `task_goal`, `bank`;
- optional safe `session_alias` (not a discovered native session ID).

Use safe symbolic aliases and the existing conservative learning label/metadata
grammar. Goal is 1–256 ASCII characters of single-space-separated safe labels;
labels are 1–128 characters. Known embedded credential signatures, paths, URLs,
shell words/syntax and raw prose reject. This is **not a universal secret
detector**; the host must sanitize and truthfully bind the task. Metadata is not
actual Git/environment/owner verification. Raw prompts/messages/history/cwd/home/
environment/model content/tool args/result bodies, receipt envelopes, auth and
private keys are never inputs. The resolver receives no raw event or context.
Tool native names are lookup-only bounded host keys (`read`/`bash` are allowed);
only safe classification values are emitted. Unknown names map to `unclassified`.

Omitted stores mean **no storage**, not core defaults. Wrap class store methods in
closed `{append}` / `{save}` callbacks, keeping private paths/config out of the
port. Only normalized safe core events/checkpoints cross these ports. Checkpoints
have empty completed/pending/check lists and `resumable: false`; they never imply
successful steps, a factual source check or resumption permission.

## Notification hooks and epochs

Exactly seven public registrations:

```text
session_start, session_shutdown
agent_start, agent_end, agent_settled
tool_execution_start, tool_execution_end
```

Every notification returns **undefined synchronously**, even when task/metadata/
storage/recall fails. Bounded detached native-promise work cannot transform a
primary tool input/result or delay Pi waiting on observer I/O. No actionable
`turn_end`/`agent_before_settle`, input/context/provider/permission hooks, tool_call/
tool_result, model-callable tools, messages, entries, editors, active tools/models,
continuation, execution, ingest/sign/promotion/archive/replay or repair is registered.
UI is requested only by explicit commands, never retained from notification ctx.

`agent_end` is low-level, **not final**. Retry/continuation `agent_start` retains
the active run until notification-only `agent_settled`. The latter records only
settlement, not task PASS. New/fork/resume/reload `session_start`, shutdown or an
explicit controller reset invalidate preview/selection/proof/correlations. The
next run gets a newly generated safe core run ID without environment-backed
`getOrCreateRunId`. Explicit preview/adoption/verification samples host task
bindings before and after awaited reads; detected task drift creates a fresh run
and refuses the old operation. Late replaced/shutdown generations cannot publish
into a new status/selection/UI. Reset/shutdown are idempotent.

Raw native call ID is only a bounded transient correlation key; it is never
emitted, hashed into metadata or saved. Each parallel/nested execution start gets
its own generated step. Out-of-order results keep that original binding; no
mutable shared Pi adapter step is used. Only own descriptors of `toolCallId`,
`toolName` on start and optional `isError` on end are inspected after Proxy
rejection; args/results/parent IDs/unknown body fields are not traversed. Missing,
unmatched, duplicate/reused/ambiguous IDs and overflow count as `dropped`, never
successful coverage. All distinct call identities count toward the per-epoch
quota, including ended calls and non-correlatable records for valid IDs first seen
on unmatched-end or lost-start-metadata paths. A valid ID is reserved before
inspecting start metadata; missing/accessor metadata cannot later make it fresh.
These loss records obey the same cap and are never emitted. At capacity, new
starts remain refused rather than evicting an old identity. Correlations are
cleared on settlement/invalidation. Execution hooks do **not** observe every
blocked attempt or establish complete workspace-guard coverage.

Observed `isError: false` maps to Vista `ok`, `true` to `failed`, otherwise
`unknown`, only for that tool execution. These are not test/gate PASS or whole
task success. Lifecycle observations always use `unknown`.

## Preview, adoption and current proof

`controller.preview()` (or `/vista-preview`) creates actual portable recall from
explicit config and authenticates **original signed safe documents**, not generated
knowledge pages/flags. Query binds exact bank/repo/source/policy/environment/task.
Context includes whole Script/Step entries and origin/run/binding/receipt-digest
provenance. Item and JavaScript character (not token) budgets omit whole entries,
never truncate guidance. Missing ports/empty results/no fitting whole item are
MISSING/refusal. Malformed/failed/forged/stale/mismatched/lifecycle-withdrawn reads
cannot publish partial positive preview. Task-start preview is nonblocking only
when `preview_on_start: true` and history port is explicitly configured.

History-clock high-water belongs to the **controller lifetime**, not one preview.
Each recall shares that monotonically observed clock; preview replacement,
reset/session/settlement/shutdown restart or task drift cannot erase it. A clock
value below the high-water refuses, so expired history cannot resurrect through
a fresh recall after a detected rollback. Construction still calls no host clock.
This is in-process rollback detection, not wall-clock authentication or durable
cross-process state; a new controller/process still relies on a truthful host.

`controller.adopt(exactPreviewObject, exactPreviewDigest)` accepts only this
controller's current private preview identity. Copies/foreign/stale views and
wrong digests refuse before reads. `/vista-adopt <exact digest>` uses that private
current view. Adoption re-reads original signed history and lifecycle policy and
requires the exact reviewed context unchanged. Currency/task/session changes
clear the selection. This is **local-guidance-acknowledgement only**, never prompt/
editor injection, execution, persistence, evidence promotion or a bank write.
`status()` rechecks stored selection age/pin/policy currency; it cannot discover
remote withdrawal without new reads (adoption performs them).

`controller.verifyCurrent()` (or `/vista-verify`) explicitly reuses
`exactEvidenceVerifier.verify(fullFiveRunBindings, subjects)`. Only its fresh
private genuine bound proof can display `current-verified`; copied flags/proofs
are never read or accepted. Missing verifier/subjects refuses and stays MISSING.
Expiry, detected task drift, reset/shutdown or superseding verification generation
clear/refuse proof. Verification does not sign receipts, claim actual owner key
provenance, change safety authority or promote experience.

`/vista-status` reports separate `observed`, `historical-authenticated`,
`current-verified` and `MISSING` meanings. Programmatic frozen status also gives
safe task/binding, phase, preview digest, local selection and loss/quota counters.
Explicit commands use public `ctx.hasUI`/`ctx.ui.notify` only. Non-UI modes use the
controller without sensitive stdout; UI exceptions/native late rejection are
handled with fixed value-free failure text, not backend paths/keys/errors.

## Bounds and source validation limits

Config bounds: timeout 1–10000 ms (default 250), pending work 1–64 (16), distinct
call correlations 1–1024 (256), whole items 1–16 (8), characters 128–16384 (8192),
and classification mappings at most 64. Scheduled work is capped; native direct
host callbacks separately retain a quota **until actual settlement**, even after
observer timeout. Hanging callbacks can exhaust observation capacity and produce
loss/MISSING rather than a growing retry queue. There is no poll/hidden retry.
Port signals/late results are handled best-effort. Already-issued store work cannot
be undone and can persist its old run-bound observation. The configured opaque
verifier retains its unchanged inherited callback/freshness limits. Host callbacks,
native promise assimilation, clocks, reflection costs, synchronous CPU blocking,
abort listeners and existing store durability are trusted, not sandboxed/preempted.

The original writer snapshot added 113 cases (learning 427; all-source 947) to
the original 834 cases without changing original source/test/fixture/gate blobs.
Independent full-range review at `02a4765` returned BLOCK (0 P0, 1 P1, 1 P2):
per-preview clock reset resurrected expired guidance, and valid IDs seen on loss
paths could be rebound. Parent reproductions confirm both on Node20/26; the
original report/negative logs are preserved, not retroactively passed. The bounded
correction adds 14 regressions (9 clock/epoch, 5 loss/cap/cross-run cases); all 14
fail on the original runtime and pass on the corrected runtime on both versions.
The first corrected full gate then exposed one branch-added hostile-name test's
obsolete zero-record expectation. Only that counter now expects one lost-ID record;
its zero-getter/privacy/drop assertions remain, with an added no-execution-event
assertion. No original main assertion is modified, and that failed gate is retained.
Full corrected source/installed validation and retained review disposition are
recorded separately before source delivery.
Actual Node26.9.0 and verified Node20.20.2 full source/offline local-tarball consumer
gates cover 11 packages and 19 exports; installed consumers use locked TS5.9.3,
`strict: true`, `skipLibCheck: false`, no workspace links/runtime fixtures.
Self-contained installed addon exercises include parallel steps, authentic preview,
copy refusal, local adoption and fresh private verification/expiry. Lint remains
the inherited no-op (no workspace lint implementations).

Public installed Pi **1.0.4 requires Node >=22.19.0**: Node20 is library/mock-host
support, not actual SDK support. Node26 actual SDK validation uses public
DefaultResourceLoader inline loading, ExtensionRunner notifications/commands,
in-memory SessionManager and a synthetic unusable model-registry dependency.
It proves registration/notification dispatch/result preservation with no provider,
credential, default session discovery or interactive model task.

**SDK declaration limitation:** full strict TS5.9.3 NodeNext `skipLibCheck:false`
against the installed host **FAILED**: 42 upstream pi-ai provider `.models.d.ts`
JSON import-attribute diagnostics and one @google/genai missing optional MCP type.
This is preserved, not re-labelled PASS. Separately approved SDK-only
`strict:true, skipLibCheck:true` checks our `ExtensionFactory`/`ExtensionAPI`
assignments without checking dependency declarations. Neither that result nor
actual runner dispatch proves full SDK declaration health/complete type compatibility
or real interactive task/model acceptance. The library/consumer strict gates are
unchanged. Local review artifacts live under `tmp/pi-proof/`; independent review,
hosted CI, source merge, owner producers/key custody, actual bank/service durability,
default installation, model evaluation, publication/deployment remain parent/owner
work. See [learning](learning.md), [portable recall](portable-recall.md),
[evidence](authoritative-evidence.md), [receipt files](receipt-files.md),
[Pi adapter](adapters/pi.md) and [OpenSpec](../openspec/changes/pi-observe-preview/proposal.md).
