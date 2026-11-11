---
doc_type: guide
project: workspace
owner_repository: chenhaoxiang/pi-vista
status: active
truth_mode: maintained
created: 2026-10-06
verified: 2026-11-04
verification_scope: Work-result continuity source/API and local source/package evidence; phase-counter checks retain their 2026-10-20 scope; no installation or benefit acceptance
---

# Pi run-context adapter

`@pi-vista/adapter-pi` is the public, low-coupling bridge for Pi extensions
that need a shared `run_id`, session binding, step IDs, checkpoints, and
redacted tool summaries.

```ts
import { createPiRunContext } from "@pi-vista/adapter-pi";

const vista = createPiRunContext();
const stepId = vista.nextStep();

await vista.emitToolCall({
  tool: "read",
  target_class: "tracked_file",
});
await vista.emitToolResult({
  tool: "read",
  result: "ok",
  target_class: "tracked_file",
});
await vista.checkpoint({
  step_id: stepId,
  task_goal: "inspect repository",
  completed_steps: [stepId],
  current_state: "inspection complete",
  pending_steps: [],
  source_sha: "0123456789abcdef0123456789abcdef01234567",
  env_fingerprint: "env-hash",
  policy_version: "policy-1",
  check_fn_ids: [],
  resumable: true,
});
await vista.end();
```

## Identity and step binding

- An explicit `runId`/`run_id` wins when it is a safe path-segment ID.
- Without one, the adapter uses `@pi-vista/core`'s `getOrCreateRunId()`.
  A valid `VISTA_RUN_ID` is preserved; an invalid environment value is never
  copied and is replaced by a generated safe ID.
- `sessionId`/`session_id` or a safe `PI_SESSION_ID` is exposed as
  `sessionId`/`session_id` and attached to emitted events. Unsafe session
  values are rejected when explicit and ignored when read from the environment.
- `nextStep()` uses core `generateStepId(runId, seq)`, beginning at sequence 0.
  Tool events and checkpoints bind to the current context step. No Pi hook is
  installed implicitly.

Path-safe IDs are not automatically private. The adapter uses core's shared
`hasKnownCredential` predicate for all retained identities, tool/artifact/stat
metadata and checkpoint summaries/identifiers, including custom observer paths.
Known-signature explicit values reject with value-free `VistaProtocolError`
before callbacks. Unsafe own run environment values generate a safe replacement;
unsafe own session environment values are omitted. The
[metadata safety guide](../metadata-safety.md) documents exact signatures,
unknown-encoding limits and pending independent candidate review.

## Safe summaries only

Tool input is a closed allowlist. It accepts a short tool label, optional safe
action, target class, reason code, and opaque artifact references. It has no
raw argument, command, path, prompt, model input/output, stdout, stderr, cwd,
or credential field. Unknown own keys are rejected before calling core.
Options, tool inputs, artifacts, and checkpoints are read from own data
properties only; inherited values and getters cannot supply input fields.

`emitToolCall()` maps to `component: "pi"` and uses `result: "unknown"`.
`emitToolResult()` requires one of the protocol `VistaResult` values (`ok`,
`blocked`, `failed`, `unknown`, or `abstain`); it never interprets a success
sentence or another status as success.

Checkpoint values are validated before `CheckpointStore.save`. The checkpoint
is bound to the context `run_id` and current `step_id`; storage failures are
best effort and fail-open. The adapter accepts protocol-safe summaries only,
not raw model/task payloads. Custom `emit` and `checkpointStore.save` promises
are bounded by `persistTimeoutMs`, defaulting to 250 ms. A timeout is fail-open:
tool emission returns `undefined` and checkpoint calls resolve. The underlying
work is not cancelled, and late rejections are handled without an unhandled
rejection. The default core emitter keeps its own append-timeout semantics
and still returns the constructed event after a persistence timeout.
`flush()` and `end()` provide bounded best-effort waiting for observer writes.

Observer wiring is descriptor-based: `store`/`eventStore` must expose an own
`append` data function or a data method on a class prototype, and
`checkpointStore` follows the same contract for `save`. The adapter never
invokes an accessor while validating these options, rejects inherited
`Object.prototype` methods and unsafe descriptor/prototype proxies, and calls
accepted class methods with their original instance as `this`. A custom
`emit` must be a callable data value. `withRunContext` accepts only an exact
context created by `createPiRunContext`; structural lookalikes and
accessor/proxy contexts are rejected.

## Optional phase measurements from existing host counters

`context.emitMeasurements()` reuses this context's `run_id`/session/step and the
existing `ArtifactRef.stats` outlet. It installs no hooks, watcher, raw-session
reader, collector or alternate event protocol. A trusted caller projects only
already-measured numeric fields; never pass a whole Subagents status/metadata
object containing task, error, session, prompt or artifact-path content.

```ts
await vista.emitMeasurements({
  stage: "subagent", runId: vista.runId, childIndex: 0,
  durationMs: 42, toolCount: 3, inputCount: 10, outputCount: 4,
  cacheReadCount: 0, cacheWriteCount: 0, sdkCost: 0, exitCode: 0,
});
```

The closed phases are `initialization`, `request-first-token`, `generation`,
`tool`, `build-test`, `review-ci`, and `subagent`. They are explicit host labels,
not classifications inferred from raw tool commands or reviewer prose. Missing
phases/times remain unknown; Subagents aggregate duration does not reveal
first-token or model-generation latency. Emit at a phase boundary, not per token.
`runId`, when supplied, must match this context; child index is not a mission or
session ID. Counters must be safe nonnegative integers; duration/SDK cost finite
nonnegative numbers; an exit code is an integer observation, not task success.

Stats contain closed numeric summaries (`usage_in_count`/`usage_out_count` are SDK
token counts, not raw input/output). Absent values are explicit `unknown`, zero
measured tool calls stay zero, and zero SDK cost is `unpriced`, never free or a
reconciled invoice. Result stays `unknown`, artifact verification is not asserted,
and ordinary CLI views remain recorded-only/non-authorizing. Raw/invalid/foreign
run input and observer failure return `undefined` without blocking execution.
Existing source, package, installation and resident-session boundaries remain
separate; this method does not enable a structured contract or new model trial.

## Explicit work-result continuity (local source candidate)

These opt-in exports are implemented in the current local source candidate, not
published, installed or connected to Pi by default. They reuse an existing owner
record and result/receipt or `GovernanceHandoff`; they add no task database,
execution/resume port, discovery scan or Hindsight integration.

| Public API | Explicit input and purpose |
| --- | --- |
| `snapshotPiWorkRef(value)` | Freeze a closed `{owner, kind, key}` reference to an existing owner record; `kind` is `issue`, `change`, `task` or `document`. |
| `snapshotPiWorkBinding(value)` | Freeze `{workRef, stageId, runId, sessionId, revision, headSha?}` for one stage/attempt. |
| `consumePiOwnerResult(expectedBinding, ownerReadback, now?)` | Pure consistency/applicability check of supplied owner metadata; `now` is epoch milliseconds, defaulting to `Date.now()`. It does not read or authenticate a source. |
| `readPiOwnerResult({binding, resultRef}, {readOwner, timeoutMs?, now?})` | Resolve one safe existing result/receipt alias through an explicitly injected trusted-host reader, then consume its readback. |
| `observePiWorkHandoff({previous, successor, handoff})` | Observe a same-work/stage fresh-successor relation over an existing `GovernanceHandoff`, not resume the old run. |

The owner namespace includes the full repository identity when applicable.
Keys/result/effect/source references are bounded safe aliases, never private
paths or artifact content. The host resolves those aliases privately from the
explicit work/result reference, without searching all sessions. A snapshot or
`samePiWorkRef`/`samePiWorkBinding` equality is only metadata equality, not source
provenance or authorization. Snapshots reject unsupported fields, accessors and
proxies without executing input getters. Revision is a nonnegative safe integer;
`headSha`, if present, is an exact lowercase 40- or 64-character digest.

### Trusted owner readback and scoped acceptance

The original owner, not a worker receipt or this adapter, determines the stage's
acceptance. `readOwner` resolves the original result and applicable evidence and
returns `PiOwnerReadback`: binding, `sourceKind`/`sourceRef`, disposition,
`observedAt`/`freshUntil`, `requiredEvidence`, `evidence` and `requiredEffects`.
A copied `validated` flag, current timestamp, JSON shape or callback return value
is not independent authentication, a signature, opaque proof or permission.
The trusted host must apply the original Gate/artifact/business/report rules;
the adapter cannot detect a host that invents acceptance or omits requirements.

The closed source kinds admit these required evidence kinds, not a universal CI
oracle:

| `sourceKind` | Applicable required evidence kinds |
| --- | --- |
| `code` | `test`, `ci`, `merge`, `readback` |
| `artifact` | `artifact`, `readback` |
| `business` | `provider_receipt`, `readback`, `reconcile` |
| `report` | `artifact`, `readback` |

Every declared required evidence item must match its ID, kind, original source
alias and all scoped claims. Its record and wrapper must match the complete
work/stage/run/session/revision/head binding, including `record.run_id` and
`record.source_sha`. Code requires an exact head; missing head cannot pass.
No one green test substitutes for other required CI/Gate originals. Non-report
stages need a nonempty required-evidence set; a report/design may complete under
its own original acceptance without CI or evidence items it never required.
Any items it does require must still pass.

Owner `observedAt`/`freshUntil` and evidence `observed_at`/`fresh_until` use exact
UTC millisecond ISO strings (`YYYY-MM-DDTHH:mm:ss.sssZ`). A selected record must
have a finite expiry and satisfy `observed <= now < expiry`; it cannot be newer
than the owner snapshot. Missing/null expiry on selected evidence, future or
expired observations cannot establish delivery. Applicable duplicate IDs,
counterevidence or current same-source/claim conflicts require reconciliation;
historical/foreign/advisory observations do not form a global barrier.

`requiredEffects` comes from this stage's original acceptance, with native
`effectRef`, exact stage binding, outcome and owner disposition. Every required
effect must be `settled` **and** `accepted`. Pending/unknown cannot be promoted;
failed/cancelled cannot count as success. Other work, advisory checks and later
stages do not block an independently complete stage. A host must not omit an
actually required effect merely to obtain `deliverable`.

Results are frozen `PiResultConsumption` observations:

- `deliverable` / `accepted`: the supplied owner readback supports this stage's
  acceptance, not a delivery write, user-read acknowledgement or execution permit.
- `reportable_terminal` / `failed`: owner rejection or known unsuccessful required
  effects can be reported, but not as successful delivery.
- `reconcile_required` / `unknown`: missing, stale, mismatched or unresolved facts
  stay unknown; an invalid expected binding yields `binding: null`, not an
  invented work identity.

All carry `authorization: "none"` and `readOnly: true`. The explicit reader retains
a valid `resultRef` even when superseded/unresolved. Reader throw, rejection or
async timeout changes only this observation, not the native task or Gate. The
wait defaults to 250 ms (configurable integer 0–30,000 ms), sends no cancellation
and handles late rejection/success without rewriting its returned result. It is
not a sandbox: it cannot preempt synchronous host code or prevent a trusted
callback from violating its read-only contract. Async readers use native
Promises, not arbitrary custom thenables.

A small host-wiring example, with synthetic aliases and an **existing trusted**
owner reader supplied by the caller (no reader is installed by this function):

```ts
import {
  readPiOwnerResult, snapshotPiWorkBinding, snapshotPiWorkRef,
  type PiOwnerReadback, type PiOwnerResultReadRequest,
} from "@pi-vista/adapter-pi";

async function observeExistingReport(
  readOriginalOwner: (request: PiOwnerResultReadRequest) => Promise<PiOwnerReadback>,
) {
  const workRef = snapshotPiWorkRef({
    owner: "example/maintenance", kind: "change", key: "existing-work",
  });
  const binding = snapshotPiWorkBinding({
    workRef, stageId: "report", runId: "run-1", sessionId: "session-1", revision: 0,
  });
  return readPiOwnerResult({ binding, resultRef: "existing-report" }, {
    readOwner: readOriginalOwner, timeoutMs: 250,
  });
}
```

The supplied reader must actually resolve that owner/result, read its originals,
and return the current original requirements; substituting worker flags is not
an implementation of this trust contract. The example itself neither reads a
real report nor demonstrates business/source-delivery acceptance.

### Controlled fresh handoff, not execution recovery

`observePiWorkHandoff` requires the same owner/kind/key and stage, with **both** a
different run and a different session. The packet's `run_id` and `run_revision`
must match `previous`; its optional `source_session_id` must also match. A new
run has its own revision: there is no cross-run revision ordering requirement.
Its head may change, but neither a changed nor an unchanged head is verified by
the packet's flags.

A valid relation preserves the packet's accepted-fact, unresolved-effect and
blocker references plus next action. The observation always says
`sourceHeadRecheckRequired: true`, `currentVerification: "not_checked"`,
`executable: false`, `authorization: "none"`, `readOnly: true`. The successor
must get applicable current owner/head readback; `must_read_current_head: true`
is a constraint, not evidence that anyone has performed it.

This helper does not change native run/claim ownership or implement an external
state writer/fence. The native owner remains responsible for refusing obsolete
state writes. Current-owner binding checks prevent treating an old result as a
successor result; they do not delete it. Late artifacts keep their original
run/result references, and real late effects remain available to the original
owner's read-only reconciliation. No replay, effect settlement or execution
permission is created. Still-valid questions/answers remain with the work;
Intercom question execution semantics and Desk/Schedule successor wiring are
later Todo #33 work, not implemented by this observation API.

Retained local checks and the limited original-worker report readback are
recorded in the [continuity design/status](../../openspec/changes/pi-operational-rollout/work-result-continuity-design.md#retained-local-validation-and-open-delivery).
Local source/consumer/Node20 checks establish engineering compatibility only;
current independent review and shared-delivery state must be read from the
original PR/CI/owner sources. Installation/default wiring, actual business and
overall benefit are not implied. No prior phase-counter or notification-only
installation evidence is upgraded by these exports.

## Explicit source-owner original readback

The opt-in host operator [`scripts/pi-code-owner.mjs`](../../scripts/pi-code-owner.mjs)
provides a concrete GitHub/Gate reader for an explicitly selected engineering
stage. It is separate from the offline public `vista` CLI and the notification
observer; import does not trigger network activity. Supply existing work/binding,
exact repository/PR/head/base, complete required checks with App IDs (review hash
when applicable), merge workflows and the exact original Gate report path. The
host uses fixed bounded GitHub GETs and the selected file, then delegates to
`consumePiOwnerResult`; it never calls Gate, merge, CI rerun or deploy.

```sh
node scripts/pi-code-owner.mjs --contract=/private/task/owner-contract.json
# Optional: also append safe stage metadata to the existing local EventStore.
node scripts/pi-code-owner.mjs --contract=/private/task/owner-contract.json --record
```

This example is a host-selected private contract, not a discovered environment or
new task store. Requirement completeness and the original Gate artifact's actual
provenance remain the trusted host/owner's responsibility. Unknown or malformed
originals return a non-authorizing unresolved observation with fixed reason codes.
Postmerge re-evaluation/reconcile cannot be relabeled as historical premerge Gate
acceptance; an unrelated pending check cannot block a satisfied declared stage.
The output is source delivery only, not installed/running/business success.
`--record` is an explicit local observation write, not a source/owner write; it
confirms the exact event through EventStore readback before claiming recorded.
Storage failure leaves the source observation unchanged and recorded false. See
[the maintained source-owner contract](../../openspec/changes/pi-operational-rollout/work-result-continuity-design.md#explicit-source-owner-acceptance-long-term-work-package49).

### Explicit independent-repository adoption: Pi Desk and Pi LobeHub

The same host reader also accepts `repositoryReview` **only for `chenhaoxiang/pi-desk` and `chenhaoxiang/pi-lobehub`**, whose existing owner contracts use independent review, exact CI, ordinary PR merge and postmerge CI rather than Meta Gate. This is a bounded owner adoption, not a generic policy switch or a fallback when a Gate is missing. Other repositories cannot select it. Existing contracts without this field still require the original `gateReportFile`; both fields together are invalid.

```ts
// Trusted host contract fragment, after the owner has actually accepted review.
repository: "chenhaoxiang/pi-desk",
repositoryReview: {
  commentId: 123,
  author: "selected-original-author",
  bodySha256: "<SHA-256 of the complete accepted original GitHub comment body>"
}
// Omit gateReportFile. Complete original headChecks/mergeWorkflows remain required.
```

The owning host must first inspect the genuine review/report, resolve its findings, and pin its exact original. The reader does **not** interpret verdict prose, authenticate a reviewer model, discover repository policy or infer approval from a comment/hash. These trusted-owner responsibilities are the same completeness/provenance boundary as the original Gate contract; substituting an unaccepted comment violates it. Hashes bind content, not authority.

It checks the returned comment ID, exact author, selected PR/repository URL, full UTF-8 body digest (at most256KiB), exact head reference, and original creation/update times no later than merge. A postmerge or subsequently edited review cannot fabricate premerge review. The complete review is read twice and must stay unchanged. Bodies/private paths never enter progress/result metadata. Exact-head checks and their App IDs, merge workflows, base containment and PR/evidence rereads remain mandatory. No new Gate, approval, replay, write or source execution is performed. The independent merged path uses at most10 fixed GETs instead of8 (two original-comment reads); memory refresh still performs zero source IO. Missing independent review yields the existing unknown-source progress, not a fictitious missing Meta Gate. Existing sidecar/result DTOs and Desk clients need no new field. Old host readers reject unsupported opt-in contracts; use a verified fixed reader before using the corresponding adoption. Pi LobeHub Web may consume this existing read-only source boundary through an explicitly configured trusted local host; this source change alone does not install it, connect a Task, reload daily Pi or prove business acceptance.

## Same-process completed-observation export (v1 host candidate)

The separate `scripts/pi-work-observer.mjs` host exposes already-completed
`PiResultConsumption` / `PiWorkHandoffObservation` values to display clients.
This is not `PiOwnerReadback`, an owner reader, a task database or a public
`vista` network command. Source delivery and fixed-runtime installation must be
verified separately; an older installed observer has no such port.

| Same-process event | Payload |
| --- | --- |
| `pi-vista:work-observation:query:v1` | `{version:1, requestId, hostSessionId}` |
| `pi-vista:work-observation:reply:v1:<requestId>` | `{version:1, requestId, snapshot}` |
| `pi-vista:work-observation:changed:v1` | `{version:1, snapshot}` |

Requests are closed own-data plain objects. `requestId` is a caller-generated
1–128 character ASCII alphanumeric/underscore/hyphen token without a known
credential signature, not an arbitrary reply event or callback. Register the
reply handler before emitting, match request and exact host identity, and remove
the handler after response/timeout. Invalid or foreign requests are silent.
A missing response is unavailable/not-observed, never empty authoritative work.

```ts
// Transport envelope, not another work/acceptance schema.
type Snapshot = {
  version: 1; hostSessionId: string | null; observerEpoch: string; seq: number;
  scope: "session-recent-observations";
  coverage: "not-observed" | "observed" | "not-applicable" | "unavailable";
  observations: readonly ({ seq: number; observedAt: number } & (
    { kind: "result"; observation: PiResultConsumption } |
    { kind: "handoff"; observation: PiWorkHandoffObservation }
  ))[];
  omitted: number; authorization: "none"; readOnly: true; executable: false;
};
```

- `hostSessionId` routes the actual native header identity, validated with core
  `isSafeSegment` (ASCII alphanumeric, dot, underscore or hyphen; not `.`/`..`),
  at most256 characters and no known credential signature. It is **not** required
  to equal a result binding or either handoff session: those are kept unchanged.
  A host without a verified safe identity does not answer or notify clients.
- Each session start/reload or tree-scope reset starts a new opaque epoch, seq0
  and empty window. Epoch is not ordered or a native task revision. Clients bind
  the current runtime/session, discard retired epochs and reject duplicate/older
  seq within the selected epoch; never jump to another runtime just because a
  session ID matches. A late prior-epoch result cannot populate the new window.
- Completed observations increment sequence; the newest16 are retained. `omitted`
  counts evicted observations in this epoch, not missing or completed tasks.
  Query does not increment sequence, update coverage or change any timestamp.
- `observedAt` is UTC epoch milliseconds when the observer finished consumption,
  **not** the original evidence time/expiry or renewed verification. The original
  DTO has no freshness deadline to export; no `freshUntil` is fabricated. Treat
  old observations as last-known history, not fresh permission or live proof.
- `not-observed` means no completed observation in this eligible scope,
  `not-applicable` means an old excluded cohort, and `observed` includes unknown
  and failed outcomes. It does not claim exhaustive work coverage. Shutdown
  clears the window, emits an incremented-seq `unavailable`, then stops replies.
  A live host with valid identity but unusable header time also reports unavailable.
- Original stage IDs/bindings and non-authorizing DTO fields remain intact.
  `subagent-output-available` is not business acceptance; source-only delivery
  is not installation/deployment. Native broad wait/unknown is not an action
  required of the user. No source/business producer is invented by this port.

Query is a synchronous immutable memory snapshot: no file/owner read, verifier,
model call, EventStore read/write, transcript scan, timer, cancellation or task
execution. Notifications occur on completed consumption and scope lifecycle,
not polling. Listener errors remain fail-open; trusted same-process listeners
are not sandboxed, and a blocking synchronous listener cannot be preempted.
The host event bus owns listener isolation; on a bus that stops at a throwing
listener, later listeners may miss that notification and can query the snapshot.
The existing owner callback/effect path and late original metadata are retained.

## Optional explicit code-progress sidecar

The work observer optionally includes `snapshot.codeProgress` (version1, source
`explicit-code-owner`) in the existing reply/changed envelope. It has its own
seq/coverage/omitted and at most16 whole rows / 5400 UTF-8 bytes. Original v1
result/handoff fields and their sequence/timestamps do not change when only
progress changes. Old clients may ignore the optional top-level sidecar; new
clients compare the two lanes independently and keep invalid/missing progress
local to that lane. `work.refresh` still makes one existing in-memory query, with
zero source reads or renewed owner verification.

The exact closed fields, twelve phase/waitReason/nextAction combinations, scope
fencing and last-known/unavailable behavior are maintained in the
[batch81 producer/Desk contract](../../openspec/changes/pi-operational-rollout/work-result-continuity-design.md#explicit-code-stage-progress-batch81-frozen-producerdesk-contract).
Progress is never accepted or permission; source-only terminal delivery still
requires the applicable original CodeOwner result, not a progress label (the strict Gate path or the explicit Desk adoption above).

A normal Pi owner can explicitly call the codemode-exposed host tool:

```js
await tools.vista_code_observe({ contractFile: "/private/task/code-owner-contract.json" });
```

The input is one existing private `snapshotCodeOwnerContract` file, not phase or
accepted declarations. The Gate path does at most8 fixed public GitHub GETs; the explicit Desk review-original adoption does at most10, each
bounded to15s with an overall60s observation deadline, and reads the selected
original Gate only when needed. No startup, query, retry or background polling
starts those reads. The actual resulting `PiOwnerReadback` is kept inside this
call and supplied to the existing250ms consumer as an IO-free trusted callback;
accepted result flags are never converted back into evidence. Tool output and
client metadata contain no private paths, raw source bodies, commands or secrets.
The optional tool is not a Desk button and performs no Gate/merge/CI/deployment.
Source, fixed runtime installation, actual loaded tool and real GUI acceptance
are separate; no existing session is automatically reloaded.

## Integration boundary

The adapter imports only public `@pi-vista/core` APIs and has no dependency on
Pi's private `ExtensionAPI` or any Pi private package. A Pi private extension
only needs to call this adapter. The public package does **not** automatically
install, patch, or hook Pi, and it does not own Pi execution, fallback,
watchdog, permission, model-routing, or safety decisions.

`store`, `eventStore`, and `checkpointStore` are storage wiring options.
Configure filesystem locations on the core stores themselves; they are not
adapter event payload fields and raw storage paths are never emitted.

## Separate optional notification/preview seam

The additive [`@pi-vista/learning/pi`](../pi-observe-preview.md) source provides
explicit public-Pi-compatible notification loading and a frozen programmatic
observation/historical-preview controller. It does not modify this adapter or
reuse its mutable current step for parallel tool correlation. No default store,
environment/session discovery, settings activation, prompt injection or current
authority is inherited. Local-only exact preview selection and optional fresh
owner evidence verification remain separate. Original independent full source
review plus retained correction disposition, exact head/main CI and normal PR18
source merge/readback are complete; see the
[source closeout](../handoff/2026-10-07-pi-observe-preview-source-closeout.md).
Actual SDK runner proof remains bounded synthetic dispatch; full SDK declaration
health, default activation and real owner/service/interactive acceptance remain
unresolved/separate, as described in the guide.
