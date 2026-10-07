# Getting started with pi-vista

## Merged source checkout

The seven-package infrastructure and bounded metadata/generation repairs were
merged into `main` through [PR #7](https://github.com/chenhaoxiang/pi-vista/pull/7).
Exact-source review and isolated post-merge validation passed, including 232
tests. Registry publication, Node 20 validation, clean consumer installation,
consumer TypeScript compilation and real owner/live integration remain
unverified. Package-consumer syntax below does not establish publication.
See the [merge closeout](handoff/2026-10-06-source-merge-closeout.md) for commits
and boundaries. The [integration snapshot](infrastructure-integration.md)
records the old known defect; the [metadata guide](metadata-safety.md) documents
the repaired, bounded contract. Do not use real sessions, credentials or owner
services as fixtures.

| Source package | Contract |
| --- | --- |
| `@pi-vista/protocol` | Shared interfaces and recorded version label |
| `@pi-vista/core` | Fail-open event and checkpoint storage/redaction |
| `@pi-vista/adapter-pi` | Explicit run/step context and summarized tool observations |
| `@pi-vista/adapter-workspace-guard` | Already-sanitized guard observations, shadow/hash references |
| `@pi-vista/adapter-ai-gate` | Already-sanitized owner evidence, explicit SHA relation and original mismatch outcome |
| `@pi-vista/cli` | Offline/read-only recorded views and `vista` bin |
| `@pi-vista/checks` | Trusted, opt-in metadata predicates; fail-closed, authorization none |
| `@pi-vista/checks-local` | Separate explicit trusted-host actual local FS/Git predicates; private config, no authority |

With the checkout's existing locked developer tools and local workspace links:

```bash
npm run typecheck
npm run build
npm test
npm_config_offline=true npm run pack:dry-run
```

The fixed root build order compiles protocol/core before all three adapters,
CLI and checks, followed by the checks-local addon. Root typecheck covers all
eight packages and the integration test source; root tests preserve every
original package test and add the addon and synthetic cross-package
suite. No integration test contacts a real owner, model or network service.
Offline pack/extraction smoke is not an npm clean install or consumer TSC check.

## 1. Package-consumer usage syntax

```bash
npm install @pi-vista/core @pi-vista/adapter-pi
# Optional owner-side ai-gate evidence observer:
npm install @pi-vista/adapter-ai-gate
```

`@pi-vista/core` declares the matching `@pi-vista/protocol` package
as a runtime dependency; a consumer installation requires both. For an adapter that
uses only the TypeScript interfaces, install the protocol package directly:

```bash
npm install @pi-vista/protocol
```

The package manifests include compiled `dist` entry points in tarballs. A
published consumer package would not require a checkout build after installation;
source build/pack evidence alone does not establish that publication.

## 2. Set VISTA_RUN_ID in your Pi session

pi-vista uses a `run_id` to tie all events from one task together.
The Pi adapter sets this automatically. For manual use:

```bash
export VISTA_RUN_ID=$(node -e "console.log(crypto.randomUUID())")
```

## 3. Add emit calls to your adapters

A Pi private extension calls `@pi-vista/adapter-pi` explicitly. The public
package does not install or patch Pi, and it does not own execution, fallback,
watchdog, permission, or model-routing decisions.

For ai-gate, pass only owner-side evidence that has already been structured
and redacted. The public adapter does not run `gh` or APIs, read PR/CI/review
text, inspect gate configuration, make gate decisions, merge, or deploy.

For public workspace-guard observation integration:

```bash
npm install @pi-vista/adapter-workspace-guard
```

- [Pi run context](adapters/pi.md)
- [workspace-guard public adapter](adapters/workspace-guard.md)
- [ai-gate](adapters/ai-gate.md)

## 4. Offline Phase 2 observation

This checkout implements `@pi-vista/cli` with the `vista` bin and a public
read-only API. Build a checkout and run its entrypoint directly:

```bash
npm run build
node packages/cli/dist/bin.js history --base-dir ./synthetic-store
node packages/cli/dist/bin.js history run-example --base-dir ./synthetic-store --json
node packages/cli/dist/bin.js inspect run-example --step run-example_s0 --base-dir ./synthetic-store
node packages/cli/dist/bin.js compare run-example run-other --base-dir ./synthetic-store
node packages/cli/dist/bin.js receipts run-example --base-dir ./synthetic-store --json
```

The installed package's bin name is `vista`. Source availability does not claim
registry publication, clean consumer installation, or deployment. Use a local
synthetic store for tests; omitting `--base-dir` reads core's default store.

These commands observe recorded data only. Core readers can silently omit
missing, unreadable, corrupt or invalid records; empty output is not a PASS.
Receipts are opaque refs with owner-claimed metadata, never fetched content,
independent verification, or merge/execution permission. See the maintained
[CLI guide](cli.md) for strict parsing, closed privacy projection, deterministic
ordering, exact bounds, API and exit codes.

## 5. Programmatic Phase 3A predicates

This checkout provides `@pi-vista/checks`, separate from the observation CLI:

```ts
import { CheckRegistry } from "@pi-vista/checks";

const checks = new CheckRegistry(); // no default handlers
checks.registerBindingPredicates(); // opt-in metadata comparison only
const report = await checks.run([{
  check_id: "env-binding",
  type: "env_matches",
  params: { expected: "sandbox-1", actual: "sandbox-1" },
  on_fail: "STOP",
}]);
// report.verification === "predicate-only"; report.authorization === "none"
```

A satisfied report means registered predicates returned true, not an independently
collected environment, Git, receipt or test verification. Input prevalidation,
immutable snapshots, ordered STOP/WARN and fail-closed timeout/error handling are
implemented; REPAIR is refused before callbacks. No owner probes, shell/dynamic
code, runtime storage, CLI check commands, replay or promotion are included.
Timeout cannot preempt synchronous trusted callbacks or undo side effects. See
[the Check Functions guide](check-functions.md) for exact limits and trust
boundaries. Node 20, a clean npm consumer install and consumer TypeScript
compilation remain unverified; source/build/pack smoke is not publication or
operational acceptance.

### Optional actual local observations

`@pi-vista/checks-local` is a separate, explicit host opt-in. Its async
`createLocalCheckRegistry(config)` snapshots private root/repository/target/branch
alias maps and returns a fresh registry with `path_exists`, `path_not_exists`,
actual-HEAD `sha_matches`, `branch_exists`, `branch_not_exists` and
`worktree_clean`. Config paths/refs and the trusted Git binary stay host-private;
definition params contain only aliases and a safe expected SHA. No registry is
silently overwritten and the base checks runtime remains no-I/O.

See [the local probe guide](local-check-probes.md) for the exact API/config,
component-walk/symlink and parent-discovery refusals, fixed Git argv/environment,
read-only/filter/submodule controls and validation limits. Actual reads remain
predicate-only, not receipt/test/gate or production authorization. Trusted local
Git/config is not a hostile-repository sandbox; reads are non-atomic, not a
race-proof filesystem jail. Node 20 and clean consumer install/TSC remain
unverified. The observation CLI still has no check commands.

## 6. Planned Phase 3 promotion

Promotion to Hindsight is future work. These commands are design notes,
not implemented by the observation CLI:

```bash
vista promote <run_id> --dry-run   # planned preview
vista promote <run_id> --confirm   # planned Hindsight write
```
