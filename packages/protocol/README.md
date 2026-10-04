# @pi-vista/protocol

Zero-dependency TypeScript interfaces and JSON schemas for pi-vista.

This package is the **only** dependency that adapters (workspace-guard, ai-gate, Laya, Kev) need.
It has no runtime dependencies and is safe to add to any project.

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
Use hashed `env_fingerprint` instead of raw environment values.
