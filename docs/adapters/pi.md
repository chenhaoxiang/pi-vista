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
