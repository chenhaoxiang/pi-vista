# @pi-vista/core

Runtime support for pi-vista Phase 1: event emission, redaction, run IDs, and
local event/checkpoint stores.

## Install

```bash
npm install @pi-vista/core
```

The matching `@pi-vista/protocol` package is installed automatically as a
runtime dependency.

## Known credential metadata

`hasKnownCredential(unknown)` is a public, stateless primitive-string predicate
for known embedded GitHub classic/fine-grained, SK, Slack and three-part JWT
signatures, including namespace-wrapped and case variants. It never coerces or
inspects objects. `isSafeSegment` stays lexical: path-safe does not mean private.

Core redacts these signatures from retained values/keys, stats, refs and URL
origins. Unsafe run/step identities and invalid post-redaction checkpoint IDs
reject before writes; readers sanitize legacy metadata and `listRuns()` omits
known-signature directory names without altering historical files. Unsafe own
`VISTA_RUN_ID` uses a generated safe fallback. See the maintained
[metadata safety guide](../../docs/metadata-safety.md) for exact signature limits,
producer responsibilities and candidate review boundaries; non-matches are not
proof of safety or authorization.

## Generated run IDs

New run IDs keep the opaque `vr_<alphanumeric timestamp>_<8 hex random>` shape.
The timestamp now uses 14-digit zero-padded hexadecimal rather than base 36:
hex cannot form a known credential prefix next to the random suffix, even at
fixed clock boundaries that previously ended in `ghp`/`gho`/`ghu`/`ghs`/`ghr`.
Padding preserves lexical creation-time order for non-negative safe-integer
milliseconds; the eight random hex digits and base-36 step sequence are unchanged.
Safe historical base-36 IDs remain reusable/readable opaque IDs, with no decoder
contract or file migration. This candidate follow-up still requires review.

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
