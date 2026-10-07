---
doc_type: guide
project: workspace
owner_repository: chenhaoxiang/pi-vista
status: active
truth_mode: maintained
created: 2026-10-05
verified: 2026-10-07
ssot: true
---

# Getting started with pi-vista

## Source checkout and evidence boundaries

The seven-package infrastructure and bounded metadata/generation repairs were
merged into `main` through [PR #7](https://github.com/chenhaoxiang/pi-vista/pull/7).
Exact-source review and isolated post-merge validation passed, including 232
tests in that historical snapshot. [PR #10](https://github.com/chenhaoxiang/pi-vista/pull/10)
subsequently merged all 11 public packages and explicit evidence/learning/shadow
APIs, source/Node20/actual packed-consumer gates. Independent same-model full
review plus retained P1-fix recheck, actual hosted Node20/22/26 CI and isolated
post-merge Node20 source/consumer checks passed. The current source closeout is
[here](handoff/2026-10-07-verified-learning-source-closeout.md); local compatibility
evidence is recorded in [release-contract.md](release-contract.md), not transferred
from the old snapshot. Registry publication, real owner/live integration and
actual durable Hindsight transport remain pending. [PR #12](https://github.com/chenhaoxiang/pi-vista/pull/12)
merged the additive portable signed historical source after its own same-model
full inspection/fix recheck and actual hosted Node20/22/26 CI. Isolated actual
main Node20 source/consumer and installed separate-process archive proofs passed
at **659 cases**; see [portable closeout](handoff/2026-10-07-portable-recall-source-closeout.md).
These are separate pins from completed PR10 acceptance, not live-service acceptance.
Package-consumer syntax below does not establish publication.
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
| `@pi-vista/evidence` | Host-pinned signed gate/test/guard receipts and opaque non-authorizing proofs |
| `@pi-vista/learning` | Process-local lifecycle, exact confirmed sink/readback, offline and portable signed historical context, observed-only import and recorded-only replay |
| `@pi-vista/adapter-shadow` | Explicit owner-normalized shadow metadata; no positive authority/eligibility |

With the checkout's existing locked developer tools and local workspace links:

```bash
npm ci --offline --ignore-scripts
npm run typecheck
npm run build
npm test
npm run lint
npm_config_offline=true npm run pack:dry-run
npm run gate:source
npm run gate:consumer
npm run gate:node20 -- --node=/absolute/path/to/verified-node20
```

Root builds compile protocol/core before the adapters/CLI, checks before
evidence, and evidence before learning. All 11 packages participate in root
build/typecheck/test/offline pack; tests preserve original assertions and add
public-import synthetic integration plus release-script regressions. Deterministic
file enumeration works on actual Node20, without Node22+ quoted-glob expansion.
No integration test contacts real owner/model/memory services or uses parent
sessions. The consumer gate makes an actual fresh npm install of exact local
tarballs and compiles with consumer-installed locked TypeScript, not extraction
smoke or workspace-linked imports. Installs are offline/cache-backed, not
fresh-cache or registry-availability evidence. Root lint is a no-op until workspace
lint scripts exist. See the release contract for evidence paths and host limits.

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
An explicitly created Pi run context manages its identity; no private Pi hook is
installed by this package. For manual use:

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
registry publication or deployment. Actual local-tarball consumer installation
is separately checked by the release-contract gate, not by this CLI example.
Use a local synthetic store for tests; omitting `--base-dir` reads core's default store.

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
boundaries. Combined local Node20/packed-consumer evidence is separately recorded
in the release contract; it is not publication or operational acceptance.

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
race-proof filesystem jail. Local Node20 and consumer checks do not remove these
trusted-host limits. The observation CLI still has no check commands.

## 6. Explicit evidence, learning and shadow APIs

[Authority-bound evidence](authoritative-evidence.md) requires an explicitly
configured `createEvidenceVerifier` with pinned public keys, required checks/
suites, trusted synthetic receipt readers and a clock. Legacy audit flags,
predicate reports and shadow votes are not verified evidence.

[Learning](learning.md) is programmatic and process-local:

```ts
import { createLearningLibrary } from "@pi-vista/learning";

// verifier is an exact createEvidenceVerifier() identity configured by the host.
// No sink means preparation/retrieval only; confirmation fails sink-unavailable.
const library = createLearningLibrary({ verifier });
const candidate = library.nominate(library.observe(safeSyntheticObservation));
const proof = await verifier.verify(expectedBindings, syntheticOwnerSubjects);
const verified = library.verifyCandidate(candidate, proof);
const preview = library.preparePromotion(verified, "synthetic-bank-alias");
// No write, network client or real bank is selected by this example.
const selection = library.retrieve([verified], explicitRetrievalQuery);
const context = library.compileContext(selection, { max_characters: 8192 });
const recorded = library.planReplay(verified, expectedBindings); // executable=false
```

Confirmation requires the exact reviewed digest, fresh unchanged signed receipts
and explicit trusted native-promise ingest/readback callbacks. Live learning tests
use synthetic sinks only. The additive [portable recall](portable-recall.md) APIs
support explicit signed historical archives/query-read ports and observed-only
import across separate process lifetimes, with a test-owned file-backed mock.
They never restore current trust from old proof/status. No real Hindsight writes,
automatic Pi context injection or executable replay are implemented. Context
bounds are characters, not tokens; fixture evaluation is not model lift.

[The shadow adapter](adapters/shadow.md) accepts only owner-normalized closed
metadata. `toVistaEventInput` is pure; `emitShadowObservation` is an explicit
best-effort core call. Wrap an EventStore as `{ append: event => store.append(event) }`.
Allow/pass never produces ok; eligibility stays false, veto/abstention/missing
context remains non-positive. No owner normalization or activation is installed.

Future CLI check/failure/promote/replay commands remain roadmap items, not
aliases for these APIs. Signed claims, trusted memory status and all local
engineering passes still grant **authorization: none**.
