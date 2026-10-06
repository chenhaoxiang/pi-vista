# @pi-vista/adapter-workspace-guard

A low-coupling public adapter for emitting **already-sanitized** structured
workspace-guard observations as `@pi-vista/core` events.

```bash
npm install @pi-vista/adapter-workspace-guard
```

The adapter does not parse shell input, read raw events or approvals, call a
model, or make/alter a guard decision. Hard blocks, model shadow switches, and
owner contracts remain in the internal workspace-guard owner repository.

## Usage

```typescript
import {
  emitWorkspaceGuardObservation,
} from "@pi-vista/adapter-workspace-guard";

await emitWorkspaceGuardObservation({
  run_id: "run-123",
  trace_id: "pair-456",
  repo: "pi-vista",
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

`run_id`, `session_id`, and `trace_id` are safe opaque identifiers. A pair ID
may be carried in `trace_id`, but the adapter does not expose or derive raw
pair data. `model_id` is retained for statistics only and never participates
in trust or guard decisions.

Before validation, the adapter takes one own-data snapshot from property
`descriptor.value`. Both enumerable and non-enumerable own string data
properties are accepted. Accessors and symbol keys are rejected, and
prototype/inherited properties are never read; an inherited-only `event`,
`result`, or `verdict` therefore does not satisfy the contract.

Known embedded credential signatures use core's shared primitive-string
predicate at both the observation and effective emission-identity boundaries.
Explicit run/step emission options are checked even when an observation's run
ID takes precedence. Options use own data fields, not inherited values or
getters; Proxy option objects are rejected without inspecting traps. Unsafe
own `VISTA_RUN_ID` uses core's generated safe fallback. Trusted `baseDir`, store
and clock plumbing remains valid configuration, not persisted metadata. See the
[metadata safety guide](../../docs/metadata-safety.md) for exact pattern limits
and pending independent candidate review; this is not a general secret scanner
or guard authorization.

## Mapping contract

- `component` is always `guard`.
- `action` is `guard:<event>`; a shadow observation uses
  `guard:<event>:shadow`.
- `rule` maps to `reason_code` when present. A supplied `reason_code` is used
  only when `rule` is absent.
- `layer`, `policy_version`, `model_id`, and `target_class` are copied only as
  stable metadata identifiers.
- Exactly one outcome is required. `result` uses the protocol's
  `VistaResult`; `verdict` maps `allow` to `ok`, `deny` to `blocked`,
  `abstain` to `abstain`, and `timeout`/`unavailable` to `unknown`.
- A `shared_input_hash` must be exactly 64 hexadecimal characters. It is never
  put in an event detail or interpreted as content. It is referenced as the
  opaque artifact ref `shadow-input-<64hex>` with artifact type
  `shadow_input`.

The adapter rejects empty or unsafe identifiers, unsupported fields, raw
command/cwd/path/credential fields, invalid outcomes, and unsafe hashes with a
`VistaProtocolError` before calling core. It intentionally has no `detail`
field and does not add fields to the public protocol. Core store failures keep
its existing fail-open behavior; protocol errors remain caller-visible.

The internal Meta adapter is a separate implementation and is not part of this
public package contract.
