---
doc_type: guide
project: workspace
owner_repository: chenhaoxiang/pi-vista
status: active
truth_mode: maintained
created: 2026-10-06
verified: 2026-10-20
verification_scope: Closed phase-counter source/public-consumer synthetic checks; no actual latency, ROI or resident activation claim
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
