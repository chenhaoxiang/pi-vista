# ai-gate adapter

## What pi-vista receives from ai-gate

ai-gate emits a `VistaEvent` for each check attempt.

```typescript
emitVistaEvent({
  run_id: process.env.VISTA_RUN_ID,
  component: "gate",
  repo: repoName,
  source_sha: prHeadSha,
  action: `gate:${checkType}`,  // "gate:ci_check", "gate:review_check", etc.
  result: passed ? "ok" : "failed",
  reason_code: failReason,         // machine-readable, no raw data
  artifact_refs: [{
    type: "gate_receipt",
    ref: receiptRelativePath,
    sha: prHeadSha,
    verified: passed,
  }],
});
```

## What pi-vista does NOT do to ai-gate

- Does not affect gate admission decisions
- Does not generate fake SUCCESS outcomes
- Does not replace independent test/build/typecheck
- Cannot bypass production, credential, or billing hard gates
- Does not participate in merge decisions

Gate is the final authority. pi-vista indexes and explains; gate decides.
