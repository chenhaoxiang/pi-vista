# @pi-vista/core

Runtime support for pi-vista Phase 1: event emission, redaction, run IDs, and
local event/checkpoint stores.

## Install

```bash
npm install @pi-vista/core
```

The matching `@pi-vista/protocol` package is installed automatically as a
runtime dependency.

## Custom components

Custom components use the structured `custom:<namespace>` form. The runtime
validator and redactor share the safe-fields grammar: names must be non-empty,
non-whitespace, control-free identifiers and may contain namespace slashes,
Unicode, and dots. Paths, URLs, credentials, shell syntax, and tokens are not
component names.

A bare recognized shell command word is also rejected as a complete suffix.
For example, `custom:pwd`, `custom:whoami`, `custom:rm`, `custom:cat`,
`custom:git`, `custom:curl`, and `custom:bash` are invalid. This is an explicit
boundary rather than a substring filter: `custom:adapter/git/v2` remains valid
because `git` is a namespace segment, not the whole component name.

`emitVistaEvent` and `EventStore.append` validate before persistence. Event
readers apply the same validator and discard malformed records, so rejected
components are neither written nor returned as valid events. Redaction maps an
invalid bare command component to `custom:[REDACTED_COMMAND]` when handling an
untrusted object outside those validated write paths.

## Usage

```ts
import { emitVistaEvent } from "@pi-vista/core";

await emitVistaEvent({
  component: "custom:adapter/v2",
  action: "adapter:observe",
  result: "ok",
});
```

The package is fail-open for store I/O and redaction failures: observer
failures do not block the operation being observed. Caller/protocol mistakes
are rejected with `VistaProtocolError` before a write is attempted.
