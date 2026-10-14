---
doc_type: guide
project: workspace
owner_repository: chenhaoxiang/pi-vista
status: active
truth_mode: maintained
created: 2026-10-14
verified: 2026-10-14
---

# Fixed local notification observer installation

## Scope and status

The Owner explicitly selected installation and fresh-session loading acceptance
on 2026-10-14. This is the notification-only S1 entry, not LOCAL/history/guidance
activation, an extra model tool, an execution permission, bank access or publication.
The source tooling is delivered by PR55 (reviewed1022748/main011b381). The
[closeout](handoff/2026-10-14-local-observer-install-closeout.md) records exclusive
local installation and isolated fresh discovery with separate receipts. This page
does not self-reference a changing PR head or claim installation from source tests;
that later closeout's own docs/main inclusion remains separate.

The existing `scripts/pi-local-observer.mjs` remains unchanged: seven notification
hooks, four user-only `/vista-*` commands, symbolic `session-cwd` binding and safe
local `EventStore` metadata. It does not modify native prompt/provider/model/thinking,
active tools, guard/gate or tool results. Observation failure stays fail-open. A
missing Git HEAD or storage fault can lose observations; it is not task failure.
See [notification/preview contracts](pi-observe-preview.md).

## Source-bound local runtime

`buildPiLocalObserverRelease({source_sha,destination})` requires exact clean HEAD
and a fresh absolute destination with a real, same-owner, non-group/world-writable
parent. It reserves the destination without overwrite, archives that commit, builds
with the locked offline dependencies and installs all eleven exact local tarballs.
Runtime dependencies must be within the source `@pi-vista/*` package inventory.
Host Pi SDK packages are neither installed nor bundled. Existing ignored build
outputs in the worktree are not the release source.

The runtime retains its source archive, eleven package archives and a hash manifest.
The manifest covers the observer entry, runtime root package manifest and installed
package manifests/JavaScript runtime files. It is integrity against the explicit
source/manifest pin, not signing, Owner identity, full host SDK health or OS isolation.
Hash checking is check-before-load; it is not immutable filesystem or kernel attestation.
Failed preparation keeps the owned partial directory for diagnosis; no old release
or observation data is removed. Reusing a partial destination returns EEXIST;
preserve it and choose a new explicit `<source_sha>-retry-<label>` destination for
a bounded retry, never overwrite the original. Only the fresh archived build tree
is removed on successful preparation. All npm commands are offline, ignore install scripts and
use explicit empty user/global configuration.

`piLocalObserverLoader({entry,manifest_sha256})` generates a fixed asynchronous
factory. It requires the chosen entry to be a listed file bound to the manifest's
entry hash and verifies all pinned runtime files before importing/invoking the observer. Missing files, drift or factory rejection emit
only `[pi-vista] local observer entry unavailable`, without original paths/errors,
and return without installing the observer. The loader starts no process, network,
watcher or timer. It is bounded by the fixed local artifact, not a general sandbox.

## Explicit installation and fresh discovery

The local operator chooses a private fixed release directory beneath
`~/.pi/vista/runtime/releases/<source_sha>/`, then writes a new
`~/.pi/agent/extensions/pi-vista-local.ts` using exclusive creation. It is not a
settings package replacement. The shim bytes are exactly
`piLocalObserverLoader({entry:release.entry,manifest_sha256:release.manifest_sha256})`;
write them with `writeFile(shim,bytes,{flag:"wx",mode:0o600})` and hash/read back the
result. Its default async factory is the loader, not a new observer implementation.
`settings.json`, other extensions and default models
are not modified. Existing entry names must be treated as a conflict, not overwritten.
The conventional extension discovery contract loads direct `.ts`/`.js` files; a
standalone `.mjs` runtime is referenced by that fixed shim, not assumed auto-discovered.

`scripts/pi-local-observer-sdk.mjs` retains its original direct-entry acceptance
and adds explicit `--entry=/absolute/shim.ts` and `--discovery=conventional`.
Conventional acceptance copies exactly that shim into an isolated agent directory,
uses real `DefaultResourceLoader` discovery without an additional extension path,
then binds a fresh native AgentSession. The three scenarios are normal, storage-fault
and missing-head. They assert native read, two synthetic responses, zero calls to
the intercepted ModelRuntime transport methods, unchanged selected model/thinking/
tools/prompt, four registered commands, and five safe events only in the normal case.
CI covers input/loader/parser regressions, not a complete nested offline release
build or installed SDK test. The operator's separate full archive/build/install fixture
exercises the builder success path and actual discovery; do not claim CI reproduced it.
The synthetic provider has no real credential store; this is not actual model quality
or independently monitored OS/network/billing egress. Node20 supports library tests;
actual installed SDK loading requires the SDK's supported Node runtime.

Installation requires readback of the real global shim/release hashes and private
local receipt in addition to isolated loading. A conventional-discovery fixture proves
that fresh SDK sessions can discover and use these exact bytes, not that every old
busy session has loaded them. Existing sessions are not forcibly reloaded. User
settings can explicitly disable extensions; such sessions are outside the default
conventional path. No ordinary model request is made to create a loading claim.

## Rollback

To stop future default loading, remove only the installed shim after its bytes match
the installation receipt. If they differ, preserve the file and diagnose rather than
remove another writer's entry. Do not delete `~/.pi/vista` observation data or an old
release. Already loaded sessions retain their own runtime until normal shutdown or
an explicitly chosen reload; disabling the default path does not retroactively
withdraw events. Guard/gate and the native execution path remain independent.
