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

## Optional measured phase counters

`context.emitMeasurements({stage:"subagent", runId:context.runId, durationMs:42, toolCount:3, sdkCost:0})`
projects already-measured host counters through existing safe `ArtifactRef.stats`.
The method is fail-open, does not install a collector or infer timing from raw
content, and keeps missing phases unknown/zero SDK pricing unpriced. Explicit
initialization, request-first-token, generation, tool, build-test, review-ci and
subagent phases must not be added as overlapping wall-clock totals. See the
[phase measurement contract](../../docs/adapters/pi.md#optional-phase-measurements-from-existing-host-counters).

## Governance receipts

An extension may supply `emitGovernanceReceipt` to receive a bounded,
non-authorizing `pi-governance-receipt/1` sink. `context.emitGovernanceReceipt()`
validates the receipt, binds its `run_id` and optional `session_id` to the
context, and invokes the sink with the existing fail-open timeout policy.
There is no default receipt store, retry, scheduler, permission change, or
business-result inference. Invalid receipts fail before the sink is called;
sink failure or timeout returns `undefined` without changing Pi execution.

## Explicit owner result consumption (local source candidate)

These opt-in public exports are implemented locally, not published, installed
or wired into Pi by default:

- `snapshotPiWorkRef(value)` freezes a closed `{owner, kind, key}` reference to
  an existing owner record. `snapshotPiWorkBinding(value)` adds
  `stageId/runId/sessionId/revision/headSha?`. References are safe aliases, not
  private paths, discovery instructions, provenance or permission.
- `consumePiOwnerResult(expectedBinding, ownerReadback, now?)` is a pure
  metadata consistency/applicability check; it does not read or authenticate
  originals. `now` is epoch milliseconds, defaulting to the current time.
- `readPiOwnerResult({binding, resultRef}, {readOwner, timeoutMs?, now?})` uses
  an explicitly injected trusted-host reader of the existing result/receipt,
  original owner acceptance and required evidence/effects. No default reader,
  task store, network/session scan or Hindsight call is added.

The original owner declares the complete required set for this stage. The
helper checks all declared items' exact work/stage/run/session/revision/head,
ID, kind, original source alias and claims. `sourceKind` is `code`, `artifact`,
`business` or `report`, using that kind's applicable originals; code requires
an exact lowercase 40- or 64-character head and matching evidence SHA. Owner
and selected evidence timestamps use exact UTC millisecond ISO strings, with
finite validity satisfying `observed <= now < expiry`; selected evidence cannot
postdate the owner snapshot. Non-report stages require evidence; reports/designs
can satisfy their own original acceptance without code CI, while still meeting
any evidence requirements they declare.

Every required effect must match this stage and be `settled` and owner
`accepted`. Pending/unknown/failed/cancelled cannot become successful delivery;
unrelated work, advisory checks and later-stage pending are not global barriers.
Returned `deliverable`, `reportable_terminal` or `reconcile_required` observations
always have `authorization: "none"` and `readOnly: true`; they do not write task
or delivery state, acknowledge user receipt, replay effects or grant execution.
A copied `validated` flag, timestamp or well-formed callback response does not
independently authenticate its source. Correct original resolution, required
sets and native acceptance remain the host's trust responsibility.

Reader failure/timeout affects only the observation, not native execution or
its Gate. The async wait defaults to 250 ms (integer 0–30,000 ms); there is no
cancellation, and late outcomes do not rewrite the result. It is not a sandbox
for synchronous host code or a callback that violates its read-only contract.

`observePiWorkHandoff({previous, successor, handoff})` relates an existing
`GovernanceHandoff` to the same owner work/stage with a different run **and**
session. The packet must match the original run/revision and optional source
session; revisions are run-local, not ordered across runs. A valid relation
preserves accepted-fact, unresolved-effect and blocker refs, but always marks
`sourceHeadRecheckRequired: true`, `currentVerification: "not_checked"` and
`executable: false`. Packet flags do not prove a new head was independently
read. The helper neither resumes execution nor changes native claims/fencing.
Old artifacts and real late effects retain their original ownership for
read-only reconciliation, not automatic replay or successor settlement.

See the [API, trusted-host example and boundaries](../../docs/adapters/pi.md#explicit-work-result-continuity-local-source-candidate)
and [retained local validation/open delivery](../../openspec/changes/pi-operational-rollout/work-result-continuity-design.md#retained-local-validation-and-open-delivery).
Local source/package checks are engineering evidence only, not independent
review, current PR/CI/merge state, installation/default wiring, actual business
or overall benefit. Read current shared-delivery state from its original
Git/CI/owner sources. Intercom question semantics and Desk/Schedule successor
gaps remain later owner-specific work, not an implicit first-phase scope.

## Boundaries

- `run_id` is selected from an explicit option, a safe `VISTA_RUN_ID`, or
  `@pi-vista/core`'s generated ID. Unsafe environment values are never copied.
- `session_id` is selected from an explicit option or a safe `PI_SESSION_ID`;
  unsafe own environment session values are omitted.
- All retained identities, tool/ref/stat and checkpoint metadata use core's
  shared known-credential predicate before custom `emit`/`append`/`save` paths.
  Explicit known-signature values reject with value-free `VistaProtocolError`;
  a path-safe shape alone does not establish safe metadata. See the
  [metadata safety guide](../../docs/metadata-safety.md) for exact pattern limits
  and the candidate's pending independent review.
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
