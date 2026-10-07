---
doc_type: guide
project: workspace
owner_repository: chenhaoxiang/pi-vista
status: active
truth_mode: maintained
created: 2026-10-07
verified: 2026-10-07
ssot: true
---

# Repeatable source and packed-consumer contract

These gates produce **source/package compatibility evidence, not release
permission**. They neither publish to npm nor enable owners, sign receipts,
activate learning/retrieval, promote experiences, merge, deploy, change platform
protections, or contact live memory/guard/gate services. Recorded passes do not
override workspace-guard, ai-gate or production safety authority. There is **no
automatic npm publish workflow**.

The initial evidence below applies to base
`12b7aef0ca8a3f5fc3d44168ace74e78e85c8b41` plus this focused release-contract
lane's scripts, CI, documentation and explicitly approved package metadata
changes. It covers the nine then-existing public workspaces, not subsequent
learning/shadow integration. Re-run the gates on the exact integrated source;
do not transfer these results to a different commit or tarball. Older documents'
Node20/consumer-unverified statements describe their earlier snapshots.

## Local commands and prerequisites

Use a trusted POSIX checkout, host Git and Node >=20. Windows is not supported;
`checks-local` retains its POSIX-only, trusted-host limitations described in
[local-check-probes.md](local-check-probes.md). These engineering scripts execute
source tests/build tools, unlike the strictly offline/read-only observation CLI.
Only synthetic source/test fixtures are used; never supply real sessions,
credentials, owner inputs or production stores.

```sh
# Locked npm ci, dependency-ordered builds, every workspace typecheck/test,
# integration typecheck/tests, release-script regressions and public pack dry-runs.
node scripts/source-gate.mjs

# Requires the installed locked source compiler; rebuilds every workspace,
# creates actual tarballs, then performs a fresh isolated npm consumer install.
node scripts/packed-consumer.mjs

# Explicit public download: pinned official Darwin-arm64 Node20, checksum first,
# then the complete source gate and packed-consumer gate on that actual runtime.
node scripts/node20-gate.mjs --download

# Or explicitly trust/provide an appropriate executable (no download/install).
node scripts/node20-gate.mjs --node=/absolute/path/to/node20
```

The default dependency mode is **offline**, using the caller's ordinary npm
cache (`npm_config_cache` / `NPM_CONFIG_CACHE`, otherwise npm's default cache).
A missing cached public tool/dependency is a failure, not a skipped install.
`--network` explicitly permits public npm registry dependency resolution for each
gate; the Node binary download is a separate `--download` opt-in. Imports of all
script modules are side-effect-free: importing does not download, install,
launch tests, or create artifacts. No global Node installation/config is changed.

The consumer's TypeScript and Node types versions come from `package-lock.json`,
not a floating latest compiler. External versions are constrained to the source
lock, and installed versions/integrities must match it; unexpected/nested lock
layouts fail explicitly. The recorded run used TS **5.9.3**, `@types/node`
**20.19.43**, and `undici-types` **6.21.0**. npm cache access is dependency-cache
usage, not an output artifact or a fresh-cache claim. User/global npm config is
bypassed with distinct empty config locations; arbitrary host environment,
credential variables, `NODE_OPTIONS` and runner context are not forwarded to
children. Public registry requests require no registry credentials.

Each invocation creates its own unique directory under the caller checkout's
`tmp/release-contract/`, containing step logs, reports, tarballs, install-lock
and consumer-source evidence. Child temporary files and npm diagnostic logs are
also directed there. Reports persist on success/failure for review. The consumer
installation alone is removed by default in a `finally` block; use
`node scripts/packed-consumer.mjs --keep-consumer` to retain that exact installation.
Cleanup targets only directories that invocation/test created, never checkout-wide
`tmp`, another worktree, or a caller-supplied cleanup path. The normal dependency
cache can be reused by npm and remains separate from these artifacts.

All process launches use executable/argument arrays and `shell: false`; paths
with spaces are tested (including the actual `isolated consumer` directory).
npm still runs explicitly selected repository build/test scripts using npm's
normal script machinery. This is ordinary trusted-source engineering, not a
hostile-source sandbox. Errors, missing tests/declarations, child nonzero exits,
timeouts, failed installation and integrity/content mismatches propagate as
nonzero gate exits, with failure logs retained.

## What the consumer gate actually checks

- Discover directory workspaces from the root manifest, order local dependencies,
  rebuild them, and pack **every non-private workspace**, without maintaining a
  fixed nine-package list. Synthetic discovery tests include future learning and
  shadow names. Actual integration still needs a new exact-source gate run.
- `npm pack --json --ignore-scripts` after explicit builds creates real tarballs.
  Compare npm inventory against the **actual tar archive inventory** and hash the
  tarball. No generated dist files are deleted/sanitized to obtain a pass.
- Create a new private npm project, install all exact tarballs with npm
  (`file:` dependencies, `--workspaces=false`, lifecycle hooks disabled), and
  reject link entries, wrong versions/resolved tarballs, packed-package/compiler
  integrity drift or missing installs. Public package directories/files cannot be symlinks.
- Compare installed manifest/file inventories with the source manifests and
  actual tarballs. Resolve each public specifier to its exact installed runtime
  target, dynamically import it, and exercise any declared require branch.
  Verify and execute each actual installed npm bin with side-effect-free `--help`.
- Compile real consumer TypeScript with the **consumer-installed locked compiler**,
  `strict: true`, `skipLibCheck: false`, and consumer-local Node type roots. It
  imports all public namespaces and uses typed `VistaCheckFunction`/`CheckRegistry`
  results; the compiled consumer runs a synthetic predicate and checks
  `verification: "predicate-only"`, `authorization: "none"`.
- Fail closed on unsupported export maps/conditions/wildcards rather than silently
  skipping them. The current public explicit subpaths and declarations are all
  covered; arbitrary future export layouts are not promised.

This is an **actual npm consumer installation and TypeScript compilation**, not
manual extraction or workspace-linked import smoke. Archive listing is an
additional inventory check, not a substitute for installation. The consumer has
its own package manifest, lock and node_modules; every public resolution is
checked against that installed tree, never the checkout's workspace links.

### Bounded package privacy/content gate

Allowed package content is `package.json`, `README.md`, `LICENSE`, and regular
compiled `dist` JavaScript/declarations and their maps. Source files, compiled
`.test.*`/`.spec.*`, fixture/test/source/key/internal/tmp directories, hidden
files, dotenv/key files, traversal and unknown file kinds are rejected. Installed
map bodies cannot carry nonempty embedded `sourcesContent`; normal source-map
**references** to source names remain allowed. A private-key PEM header marker
is rejected in actual packed/installed text. These are concrete bounded local
content checks, **not** a universal secret detector, source/owner attestation or
platform trust-root gate. No blanket credential regex scans synthetic credential
assertions or confuses their fake labels with real credentials. Producer privacy
obligations and [metadata-safety.md](metadata-safety.md) still apply.

The five legacy `dist` layout manifests (core, protocol and the three adapters)
now add only `"!dist/**/*.test.*"` to `files`. Actual baseline/after inventories:

| Package | Compiled test artifacts before | After |
| --- | ---: | ---: |
| core | 12 | 0 |
| protocol (no tests at baseline) | 0 | 0 |
| adapter-pi | 8 | 0 |
| adapter-workspace-guard | 8 | 0 |
| adapter-ai-gate | 4 | 0 |

Before/after packing used disposable copies of the **same generated dist bytes**
and original/current metadata; hashes remained unchanged. A regression creates
actual tarballs with/without the exclusion, proves the gate rejects the former,
and verifies test outputs remain on disk. Other four manifests' `files` fields,
all production TypeScript, assertions, exports, dependencies and engines are
unchanged. Their only edits are test-script portability.

## Node20 portability and precise test counts

Node20 v20.20.2 demonstrably rejects the literal quoted
`dist-test/*.test.js`, even when both matching compiled tests exist. All nine
workspace `test` scripts now invoke the deterministic recursive enumerator with
fixed directory/suffix arguments, preserving every existing compiler/build
prefix. No assertions or source tests changed:

- core and three adapters: `node ../../scripts/run-tests.mjs dist .test.js`;
- checks, checks-local, CLI, evidence: same runner with `dist-test .test.js`;
- protocol only: `node ../../scripts/run-tests.mjs dist .test.js --allow-empty`.

Protocol had **zero** assertions before this lane (the old Node26 command
silently reported zero). Its explicit exception accepts only this repository's
`@pi-vista/protocol` workspace, `dist` and `.test.js`; the directory and built
public runtime/declaration files must exist. It emits
`ZERO TESTS: explicit protocol-only exemption; ... no assertions counted`.
Every other workspace, integration and script-suite invocation fails on empty
or missing tests. After the full-range review, all eleven workspace scripts use
the guarded runner. It requires nonzero executed native test cases, not merely
matching filenames or child exit 0. A native-event reporter excludes suites and
implicit file wrappers, ignores user stdout/diagnostic count claims, writes one
closed per-invocation count artifact and refuses missing/malformed/zero-executed
evidence. Empty describe suites, comment-only modules, stdout count spoofs and
all-skipped modules fail on Node20/26. The guarded protocol exception still
applies only to the characterized no-test-files workspace with built exports.
An ambiguous file-named line-1/column-1 completion without entry-file metadata is
conservatively treated as an implicit wrapper; this is not an assertion-call or
hostile-test-code attestation system. Counts are Node test cases, not counts of
assert-library calls. Focused regressions cover default rejection, other-workspace
refusal, missing protocol public build files and the intentional built zero case.
Protocol build/typecheck, packed exports and consumer compilation are still
mandatory; this exception is not coverage.

| Source suite | Unchanged assertions passed on each recorded runtime |
| --- | ---: |
| protocol | **0 (explicit exception)** |
| core | 42 |
| adapter-pi | 35 |
| adapter-workspace-guard | 18 |
| adapter-ai-gate | 36 |
| CLI | 44 |
| checks | 42 |
| checks-local | 60 |
| evidence | 40 |
| public integration | 15 |
| **Existing total** | **332** |
| New release-script regressions (separate) | **17** |

## Recorded local evidence (2026-10-07)

Darwin arm64, host Git **2.50.1**, locked TS **5.9.3**. All three actual runtimes
passed npm ci (offline/cache-backed), all nine builds/typechecks/test entries,
integration typecheck/build/tests, the 17 script regressions, nine privacy-checked
pack dry-runs and a fresh real consumer install/compile/import/bin gate. Each
consumer passed all **14 public export specifiers** and the **`vista`** bin;
actual nine-tarball inventories contain **211 allowed files** in total, with no
compiled tests, original sources, keys/dotenv or embedded source-map bodies.

Paths in this historical nine-package section are relative to the focused
release component checkout's `tmp/release-contract/`, not the subsequently
integrated checkout. Ignored local logs are retained for that focused handoff,
not represented as registry or hosted-CI receipts.

| Actual runtime / npm | Source evidence | Consumer evidence |
| --- | --- | --- |
| Node **20.20.2** / npm **10.8.2** | `source-Sdf1yX/report.json` | `consumer-sYuw6U/report.json` |
| Node **22.23.2** / npm **10.9.8** | `source-0XhsDY/report.json` | `consumer-sLaG5R/report.json` |
| Node **26.9.0** / npm **11.19.1** | `source-1JZB8t/report.json` | `consumer-fhBivt/report.json` |

Minimum-runtime orchestration evidence: `node20-wpvla2/report.json`. The
controller's `node` field records Node26; **`runtime` and both child reports
record actual Node20**. It downloaded only into its own tmp directory from:

`https://nodejs.org/dist/v20.20.2/node-v20.20.2-darwin-arm64.tar.gz`

- Official archive SHA-256:
  `466e05f3477c20dfb723054dfebffe55bc74660ee77f612166fca121dacb65b6`
- Executable SHA-256:
  `38de4fc456c0c439bac48c727d378f749abb4e31f4116703bb1ee9a746fccbb6`

The version-specific official HTTPS `SHASUMS256.txt` must match the pinned hash,
and the downloaded bytes must match before extraction/execution. No unverified
archive is executed; a failed download/checksum fails the gate and must be
reported as blocked, not replaced with a manifest-only Node20 claim. This is
HTTPS/checksum provenance, not a Node release-signature/owner receipt verifier.
The runtime gate proves these specific versions/host behavior, not every Node20
patch, operating system/Git layout, deployment suitability or lifecycle support.

Additional retained evidence:

- `metadata-before-after-NJxkhe/report.json`: actual before/after tarballs and
  unchanged generated hashes for the five legacy manifests.
- `node20-existing-quoted-glob.log`, `node20-root-integration-glob-repro.log`:
  characterized literal-glob failures (exit 1), not ignored assertions.
- Node26 root `npm run typecheck`, `npm run build`, `npm test` (332), and
  `npm_config_offline=true npm run pack:dry-run`: `root-*-node26.log`.
- `audit-7UXY5v/report.json`: public `npm audit --audit-level=high` returned
  **0 advisories** on this lock at this time. It does not audit host Git/Node,
  the bundled npm distribution, action source, platform policy or owner state.
- `ci-*-pinned-ref.txt`, pinned action metadata, setup-node README and
  `ci-static-validation.log`: public ref/source and YAML/static workflow checks.
  Hosted GitHub jobs have **not** been run by this local lane.

Early implementation failures (npm's duplicate `/dev/null` config load and
nested runner context) were fixed and covered before the recorded passes. The
strict initial protocol-empty failure led to the explicitly approved narrow
exception above; no source assertion failure was suppressed.

## GitHub CI is ordinary source evidence

`.github/workflows/ci.yml` runs PRs and pushes to `main` on Ubuntu with Node
20/22/26, `contents: read` only, no deployment/publish environment, no repository
secrets, no owner input or live memory access. Checkout credentials are not
persisted; setup-node uses no supplied GitHub token and no dependency cache is
shared via Actions. setup-node's verified source documentation supports arbitrary
semver majors with official dist fallback, including the current Node26 major.

Action tags were resolved with public `git ls-remote` and their pinned source
metadata fetched successfully; full commit pins are:

- `actions/checkout@34e114876b0b11c390a56381ad16ebd13914f8d5` (v4.3.1)
- `actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020` (v4.4.0)

CI executes the generic source gate, actual packed-consumer privacy/type/import
checks, public dependency advisory check and whitespace check. PR source executes
only as ordinary untrusted source in that least-privilege job, never
`pull_request_target`, trusted owner verification or an activation step. The
normal read-scoped job token used for checkout is not persisted/passed to source
commands. No GitHub settings, required checks, credentials or protection rules
are modified here. A future CI pass is still not authorization to publish,
merge, release, replay, promote, trust an owner or change an admission policy.

## Root integration wiring

The focused release lane intentionally did not edit root `package.json`/lock.
The current integration now supplies these entries, preserves all original
suites, adds learning/shadow to dependency-ordered root build/typecheck/test/pack,
and runs release-script regressions as part of root `npm test`:

```json
{
  "gate:source": "node scripts/source-gate.mjs",
  "gate:consumer": "node scripts/packed-consumer.mjs",
  "gate:node20": "node scripts/node20-gate.mjs",
  "test:release-contract": "node scripts/run-tests.mjs scripts .test.mjs",
  "test:integration": "tsc -p tsconfig.integration.json && node scripts/run-tests.mjs dist-integration .test.mjs"
}
```

`npm run gate:node20 -- --download` selects the Darwin-arm64 download, or pass
`--node=/absolute/path`. Network dependency mode likewise uses an explicit
`-- --network`. At the historical focused release handoff, the old root
integration quoted glob failed on Node20; that snapshot did not establish
root-wrapper success. The
current root script uses the enumerator above, not literal quoted-glob expansion.
No existing assertion was removed or relaxed.

## Combined eleven-package local validation (2026-10-07)

The same-protocol integration recovery preserved and normally merged the exact
completed learning/shadow/release commits, rather than restarting component
writers. Root integration adds no external runtime dependency and regenerates
`package-lock.json` with `npm install --package-lock-only --offline --ignore-scripts`.
The generic source gate runs `npm ci` from the lock before rebuilding all 11.
Original eight runtime/test files remain unchanged; the approved manifest-only
portability/exclusion changes above are preserved.

Actual integrated source results:

| Suite | Assertions passed |
| --- | ---: |
| Original package suites plus evidence | 317 |
| Learning | 133 |
| Shadow | 60 |
| Original public integration | 15 |
| New verified-learning public integration | 9 |
| Release-script regressions | 17 |
| **Combined total** | **551** |

Protocol remains explicit zero, not additional coverage. All counted suites have
zero failures, cancelled, skipped or todo. The nine new public-import assertions
link generated signed receipts to candidate verification, exact read-only
preview, confirmed **in-memory synthetic** ingest/readback, verified/trusted
retrieval/context and non-executing replay. Negative seams cover unsigned/shadow
claims, copied provenance/plans, expiry, signed source/receipt-hash drift and
uncertain readback. A hermetic child gets no parent environment/session inputs,
installs denying network hooks before public imports, and confirms that no
injected sink means `sink-unavailable`, not default network. A real synthetic
shadow->core JSONL->unchanged observation CLI roundtrip proves non-positive
outcomes, opaque unverified receipt refs and unchanged recorded bytes.

Integrated pre-commit engineering evidence is under **this integration
checkout's** `tmp/release-contract/`:

- `source-mCZZ5J/report.json`: actual Node26.9.0, all 11 source gates and 551 tests.
- `node20-2DdOwl/report.json`: controller Node26.9.0, child runtime **v20.20.2**,
  provided retained official-checksummed executable SHA-256
  `38de4fc456c0c439bac48c727d378f749abb4e31f4116703bb1ee9a746fccbb6`.
- `source-bLDlJv/report.json`: actual Node20.20.2/npm10.8.2, all 11 builds/
  typechecks/test entries, 24 integration assertions, 17 script regressions and
  11 public pack dry-runs after offline npm ci.
- `consumer-sv398P/report.json`: actual Node20, fresh npm install of all 11 exact
  local tarballs, **16 public export specifiers**, installed `vista` bin, strict
  consumer-installed TS5.9.3/Node types20.19.43, and **249 allowed package files**.
  Versions/integrities/installed inventories are checked; tests/fixtures/key
  material/source bodies are not packaged. This is not workspace-linked smoke.

The final committed full-range source pin/diff and post-commit rechecks are
retained in local `tmp/review/` and the integration recovery handoff. The
pre-commit results above are accurately scoped, not fabricated hosted receipts.
Repeated exact-commit evidence is required before parent acceptance. All local
engineering/self-checks here are **same-model**, not independent review.

These local Darwin-arm64/offline-cache passes do not establish hosted Ubuntu CI,
fresh-cache registry availability, source PR/remote merge, publication, real owner
producers/keys, Hindsight durability/cross-process recall, automatic Pi injection,
executable replay, actual model capability, training or operational acceptance.
No activation, real memory write, model call or safety-authority change occurred.
