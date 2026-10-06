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

## Integration boundary

The adapter imports only public `@pi-vista/core` APIs and has no dependency on
Pi's private `ExtensionAPI` or any Pi private package. A Pi private extension
only needs to call this adapter. The public package does **not** automatically
install, patch, or hook Pi, and it does not own Pi execution, fallback,
watchdog, permission, model-routing, or safety decisions.

`store`, `eventStore`, and `checkpointStore` are storage wiring options.
Configure filesystem locations on the core stores themselves; they are not
adapter event payload fields and raw storage paths are never emitted.
