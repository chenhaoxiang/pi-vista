# workspace-guard adapter

## What pi-vista receives from workspace-guard

workspace-guard emits a `VistaEvent` at the end of each `guardCheck` call.
**No changes to guard's safety logic.** The emit is a side-effect only.

```typescript
// Add at end of logEvent() in workspace-guard.ts

import { emitVistaEvent, generateRunId } from "@pi-vista/core";

emitVistaEvent({
  run_id: process.env.VISTA_RUN_ID ?? generateRunId(),
  session_id: process.env.PI_SESSION_ID,
  component: "guard",
  repo: resolvedRepo,
  source_sha: currentSha,
  action: `guard:${decision.layer}:${decision.type}`,
  target_class: decision.targetClass,    // already-redacted classification
  policy_version: POLICY_VERSION,
  result: decision.result === "allow" ? "ok" : "blocked",
  layer: decision.layer,
  reason_code: decision.reasonCode,
});
```

## What pi-vista does NOT do to workspace-guard

- Does not change shell parsing
- Does not change path resolution
- Does not change A-layer blocking
- Does not change fail-closed logic
- Does not provide input to guard's decision
- Cannot override any guard decision

## Failure mode

`emitVistaEvent` rejects when the adapter supplies invalid protocol input (for
example an unknown `component` or `result`, a missing `action`, or an invalid
timestamp). Adapters should handle that rejected promise so it cannot become an
unhandled rejection. Store I/O failures and persistence timeouts are handled
internally and fail-open; they never block the guard decision. The default
persistence timeout is 250 ms and can be overridden with `persistTimeoutMs`.
