# workspace-guard public observation adapter

`@pi-vista/adapter-workspace-guard` is the public, low-coupling boundary for
workspace-guard observations. It accepts only observations that are already
desensitized and structured; it does not inspect or transform the source
operation.

```bash
npm install @pi-vista/adapter-workspace-guard
```

## Public contract

```typescript
import {
  emitWorkspaceGuardObservation,
} from "@pi-vista/adapter-workspace-guard";

await emitWorkspaceGuardObservation({
  run_id: process.env.VISTA_RUN_ID ?? "run-opaque-id",
  trace_id: "pair-opaque-id",
  repo: "pi-vista",
  branch: "feat/adapter",
  event: "decision.trio",
  verdict: "allow",
  rule: "trio-policy",
  layer: "governance",
  policy_version: "guard-v1",
  model_id: "trio-v2",
  target_class: "tracked-file",
  shadow: true,
});
```

The observation fields are stable IDs/labels only:

- optional `run_id`, `session_id`, `trace_id`, `source_sha`, `repo`, and
  `branch`;
- required registry-safe `event` (for example `decision.trio`,
  `decision.kev-shadow`, `decision.intern-shadow`, `decision.startlux-shadow`,
  `blocked`, `allowed`, or `policy-divergence`);
- optional `rule`, `layer`, `policy_version`, `model_id`, `target_class`,
  `reason_code`, `shadow`, and `shared_input_hash`;
- exactly one of `result` or `verdict` is required. `result` is a protocol
  `VistaResult`; `verdict` maps `allow` → `ok`, `deny` → `blocked`, `abstain`
  → `abstain`, and `timeout`/`unavailable` → `unknown`.

The adapter emits `component: "guard"` and maps `event` to
`action: "guard:<event>"`. Shadow observations use the structured action
`guard:<event>:shadow`; no `detail` field is added to the public protocol.
When `rule` is present it becomes `reason_code`. `model_id` is statistical
metadata only and never participates in trust decisions. Event names remain
registry-friendly strings, so adding a model name does not require a core
branch.

`shared_input_hash` is accepted only as a 64-hex opaque digest. It is never
expanded or treated as event content. When supplied, the adapter adds the
artifact reference `shadow-input-<64hex>` (artifact type `shadow_input`).
Invalid hashes, empty/unsafe IDs, unknown fields, and raw `command`, `cwd`,
`path`, `stderr`, credential, token, or similar fields are rejected before the
core emitter is called. The adapter never writes raw commands, cwd, paths,
stderr, credentials, approvals, or free text into a VistaEvent.

## Ownership and safety boundary

The public adapter consumes only sanitized observations from an owner
integration. It does **not**:

- parse shell commands or resolve paths;
- read raw events, approvals, stderr, or credentials;
- call a real model or route models;
- change any guard verdict or fail-closed behavior;
- override workspace-guard A-layer hard blocks.

workspace-guard's hard enforcement, model shadow switches, and owner contracts
remain in the internal owner repository. The internal Meta adapter is a
separate implementation and is intentionally not part of this public package
contract.

## Failure mode

`toVistaEventInput` and `emitWorkspaceGuardObservation` reject malformed
adapter input with `VistaProtocolError`; protocol mistakes are not disguised as
store failures. After validation, `emitWorkspaceGuardObservation` delegates to
`@pi-vista/core`'s `emitVistaEvent`. Core store I/O failures and persistence
timeouts retain the existing fail-open behavior and never block the guard
operation. The default persistence timeout is 250 ms and can be overridden
with core `persistTimeoutMs` options.
