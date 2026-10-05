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

Use `target_class` and `reason_code` for machine-readable classification.
Use hashed `env_fingerprint` instead of raw environment values. Custom
components use the `custom:<name>` form; the core runtime permits namespace
slashes, Unicode, and dots in a non-empty, non-whitespace name while rejecting
control, credential, and path-like payloads.

`ArtifactRef.stats` may contain finite numbers and short metadata labels/values.
The core redactor retains at most 32 entries whose string values are at most 64
characters and safe metadata; credential-, path-, URL-, and shell-like values
are redacted or omitted. Stats are never an escape hatch for artifact content.

## Protocol versions

Phase 1 is a 0.x protocol. `vista_version` may be omitted for legacy records,
but when present it must be a non-empty string. Readers retain unknown versions
for inspection; the core validator enforces record shape and safety constraints
without pretending an unknown version is the current protocol. In Phase 1,
`@pi-vista/core` is the only runtime validation contract.
