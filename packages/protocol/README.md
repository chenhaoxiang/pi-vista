# @pi-vista/protocol

Zero-dependency TypeScript interfaces for pi-vista.

This package contains the zero-dependency TypeScript interfaces used by
adapters. Runtime integrations use `@pi-vista/core` for emission and
redaction; runtime validation is provided by `@pi-vista/core` in Phase 1.

## Install

```bash
npm install @pi-vista/protocol
```

## Usage

```typescript
import type { VistaEvent, VistaCheckpoint, VistaExperience } from "@pi-vista/protocol";
import { VISTA_PROTOCOL_VERSION } from "@pi-vista/protocol";
```

## Exported types

| Type | Description |
|---|---|
| `VistaEvent` | Atomic observation unit — one action from one component |
| `VistaCheckpoint` | Verifiable task state snapshot |
| `VistaExperience` | Reusable verified execution knowledge |
| `VistaScript` | High-level task skeleton (Script-level) |
| `VistaStep` | Fine-grained executable step (Step-level) |
| `VistaCheckFunction` | Environment assertion for replay validation |
| `VistaFailure` | Structured failure analysis |
| `ArtifactRef` | Pointer to external artifact (never stores content) |
| `ExperienceVerification` | Gate + test + guard evidence |
| `ExperienceStatus` | Experience lifecycle state |
| `VistaComponent` | Component identifier union |
| `VistaResult` | Outcome classification union |

## Redaction contract

Every type in this package carries a redaction contract:

- **Never** include raw shell commands
- **Never** include absolute filesystem paths
- **Never** include usernames, credentials, or tokens
- **Never** include model inputs or outputs verbatim
- Unknown property names that look like paths, credentials, tokens, or shell syntax are dropped or replaced before persistence

Use `target_class` and `reason_code` for machine-readable classification.
Use hashed `env_fingerprint` instead of raw environment values. Custom
components use the `custom:<name>` form; the core runtime permits namespace
slashes, Unicode, and dots in a non-empty, non-whitespace name while rejecting
control, credential, path-like, and shell-like payloads. A bare recognized shell
command word is not a component namespace: `custom:pwd`, `custom:whoami`,
`custom:rm`, `custom:cat`, `custom:git`, `custom:curl`, and `custom:bash` are
invalid. This boundary applies only to the complete suffix, so namespaced
identifiers such as `custom:adapter/git/v2` remain valid.

`ArtifactRef.stats` may contain finite numbers and short metadata labels/values.
The core redactor retains at most 32 entries whose string values are at most 64
characters and safe metadata; credential-, path-, URL-, and shell-like values
are redacted or omitted. Stats are never an escape hatch for artifact content.

### Check-function repair actions

`VistaCheckFunction.repair_action_id` is an opaque policy-registry key, not a
shell command, command template, or executable text. The protocol carries only
that identifier. A trusted policy registry is the only component allowed to
resolve the identifier to an approved repair action and execute it; unregistered
or unauthorized action keys must not be interpreted as commands.

## Protocol versions

Phase 1 is a 0.x protocol. `vista_version` may be omitted for legacy records,
but when present it must be a non-empty, control-free, safe version label. Safe
unknown versions may use namespace slashes (for example, `future/1`) but must
not contain credentials, paths, URLs, or shell payloads. Readers retain unknown
versions for inspection rather than treating them as the current protocol. In
Phase 1, `@pi-vista/core` is the only runtime validation contract.
