# @pi-vista/adapter-pi

Generic Pi session/run context helpers for `pi-vista`.

This package has no dependency on Pi's private `ExtensionAPI` or any Pi
private package. A Pi extension creates a context and calls the adapter with
already summarized, protocol-safe values:

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
  task_goal: "inspect the repository",
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

## Boundaries

- `run_id` is selected from an explicit option, a safe `VISTA_RUN_ID`, or
  `@pi-vista/core`'s generated ID. Unsafe environment values are never copied.
- `session_id` is selected from an explicit option or a safe `PI_SESSION_ID`.
- Tool calls and results use a closed allowlist of summary fields. Raw args,
  commands, paths, prompts, model input/output, stdout, stderr, cwd, and
  credentials are rejected before core redaction. Options, tool inputs,
  artifacts, and checkpoints use only own data properties; inherited values
  and getters are ignored.
- Tool results require an explicit `VistaResult`; the adapter never infers
  success from prose.
- Checkpoints are validated against the existing protocol and bound to the
  context's run and current step. Store failures are fail-open.
- Custom `emit` and `checkpointStore.save` promises are bounded by
  `persistTimeoutMs` (default 250 ms). On timeout, tool emission returns
  `undefined` and checkpoint calls resolve. Work is not cancelled; late
  rejections are handled. The default core emitter retains its existing
  append-timeout behavior, including returning the constructed event.
- `flush()`/`end()` wait only a bounded best-effort period for pending observer
  writes. They do not control Pi execution, fallback, watchdogs, permissions,
  or model routing.
- `store`/`eventStore` and `checkpointStore` require an own data function or a
  data method on a class prototype (`append` or `save` respectively). The
  adapter resolves methods from descriptors without invoking getters and calls
  them with their original instance as `this`; `Object.prototype` methods and
  hostile descriptor/prototype proxies are rejected. A custom `emit` must be a
  callable data value and is subject to the same safe descriptor inspection.
- `withRunContext` recognizes only contexts created by this module. It does
  not accept structural lookalikes, accessor contexts, or proxy-wrapped
  contexts as explicit contexts.

`withRunContext` is a convenience for passing an explicitly created context
through extension code. It does not patch Pi, install hooks, or automatically
load an extension. A Pi private extension only needs to call this public
adapter; it remains responsible for its own Pi integration.

`store`, `eventStore`, and `checkpointStore` are storage wiring options.
They are never emitted as event data. Configure filesystem locations on the
core stores themselves; raw path values are not adapter event inputs.
