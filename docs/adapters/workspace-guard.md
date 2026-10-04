# workspace-guard adapter

## What pi-vista receives from workspace-guard

workspace-guard emits a `VistaEvent` at the end of each `guardCheck` call.
**No changes to guard's safety logic.** The emit is a side-effect only.

```typescript
// Add at end of logEvent() in workspace-guard.ts

import { emitVistaEvent } from "@pi-vista/core/emit";

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

If `emitVistaEvent` throws, it is caught and logged to stderr. The guard
decision has already been made and executed; the Vista event is best-effort.
