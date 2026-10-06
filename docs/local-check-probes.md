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

# Local read-only Check Functions: explicit trusted-host addon

This guide is the maintained contract for **`@pi-vista/checks-local` only**.
The addon supplies actual local filesystem/Git observations through the existing
`@pi-vista/checks` runner. It does not change the protocol, base registry, Pi,
observation CLI, workspace-guard, ai-gate, models, or admission policy. The base
checks package remains a no-I/O runtime with opt-in metadata comparisons.

Reports remain `verification: "predicate-only"`, `authorization: "none"`.
A satisfied local predicate does not authenticate a receipt, a test result, a
source tree, an owner, or a gate; it grants no execution, replay, merge, release,
promotion or production permission. No automatic integration, repair, retry,
result cache, runtime storage, network request or Hindsight operation is added.

## Factory and private configuration

```ts
import { createLocalCheckRegistry } from "@pi-vista/checks-local";
import type { LocalCheckConfig } from "@pi-vista/checks-local";

// These variables come from trusted host setup, never a model/check description.
// canonicalPrivateRoot is an absolute, locally-controlled canonical directory.
// trustedGitExecutable is an absolute path to the host's approved Git binary.
const config: LocalCheckConfig = {
  roots: { area: canonicalPrivateRoot },
  repositories: { sample: { root: "area", relativePath: "repository" } },
  targets: { seed: { root: "area", relativePath: "repository/seed.txt" } },
  branches: { primary: { repo: "sample", ref: "refs/heads/primary" } },
  gitExecutable: trustedGitExecutable,
};
const checks = await createLocalCheckRegistry(config);
const report = await checks.run([
  { check_id: "local-seed", type: "path_exists", params: { subject: "seed" }, on_fail: "STOP" },
  { check_id: "local-head", type: "sha_matches", params: { repo: "sample", expected: "{sha}" }, on_fail: "STOP" },
  { check_id: "local-branch", type: "branch_exists", params: { repo: "sample", subject: "primary" }, on_fail: "WARN" },
  { check_id: "local-clean", type: "worktree_clean", params: { repo: "sample" }, on_fail: "STOP" },
], { sha: expectedSafeSha }, { timeoutMs: 1_000 });
```

The asynchronous factory takes a detached own-data snapshot **before its first
await**, validates aliases through public core utilities and the base runner's
unchanged safe-metadata grammar, and returns a **fresh `CheckRegistry`** with
exactly six handlers. Factory validation performs no filesystem reads or child
launches. Namespace validation occurs on each probe, not just at construction.
The factory never partially mutates another registry or overwrites a pure
`sha_matches`. Calling `registerBindingPredicates()` on the returned registry
fails duplicate registration; use a separate base registry for pure comparisons.
The usual explicit trusted callback registration remains available, but callbacks
added by the host are not constrained by this addon's read-only implementation.

All five config fields are required. `roots` has 1–16 entries; `repositories`
has 0–32; `targets` and `branches` each have 0–64. A repository and a target each
have exactly `{ root, relativePath }`; a branch has exactly `{ repo, ref }` and
must refer to a registered repository. Branch and target subject aliases occupy
separate maps. Branch params must select both its registered repo and subject;
a subject belonging to another repo cannot be reused across namespaces.

| Input | Boundary |
| --- | --- |
| Aliases and references to aliases | Base checks' closed 1–128 character opaque labels, including its command/credential exclusions |
| Root and Git executable | Private canonical-form absolute paths, at most 4,096 characters; filesystem root, controls and backslashes reject |
| Relative repository/target | `.` for the root itself, or 1–32 slash-separated ASCII components of letters/digits/`.`/`_`/`-`; at most 1,024 characters total and 128 per component |
| Relative exclusions | No empty, `.` or `..` components, absolute/drive/URI paths, backslashes or lexical traversal |
| Branch ref | Private full `refs/heads/...` only, bounded as above; components start with a letter/digit; no `..`, trailing `.` or `.lock` |

Inputs must be ordinary plain objects (including null-prototype, frozen and
non-enumerable own data). Arrays, Maps, custom prototypes, Node-detectable Proxies
(including revoked ones), accessors, symbols, unknown keys, missing required
fields and explicitly present `undefined` reject. No source getters, traps,
iterators or coercion hooks run. Nested alias maps and records are copied, not
retained; subsequent source mutation cannot redirect an ongoing or later probe.
These bounds do not bound reflection costs for arbitrarily huge hostile objects.

## Six schemas and observed scopes

Params have **exactly** the keys below, after the base runner resolves whole-value
placeholders. All values except `expected` are registered symbolic aliases.
There is no param for a path, ref, cwd, revision, shell, argv or executable.

| Type | Params | Predicate |
| --- | --- | --- |
| `path_exists` | `{ subject }` | The registered target is an existing regular file or directory |
| `path_not_exists` | `{ subject }` | A safe component walk encounters a genuine `lstat` ENOENT |
| `sha_matches` | `{ repo, expected }` | Actual `HEAD^{commit}` is a 40/64-hex SHA equal to expected, case-insensitively |
| `branch_exists` | `{ repo, subject }` | Git reports the exact configured full local branch ref |
| `branch_not_exists` | `{ repo, subject }` | The bounded successful ref listing lacks that exact ref |
| `worktree_clean` | `{ repo }` | Supported index has no assume-unchanged/skip-worktree flags and Git status has no staged, tracked-unstaged or untracked entries |

The SHA implementation reads Git; the base package's same-named optional binding
only compares `{ expected, actual }` metadata. Neither authenticates the source
of an expected SHA or proves a receipt/test/gate relation. The local handler
rejects an invalid expected SHA as a schema error before reads.

Path probes use metadata only, never `readFile`, artifact resolution or file
content matching. They require a canonical directory root and `lstat` each
relative component, refusing ancestor, leaf and dangling symlinks before further
traversal. Special files and a regular file used as an intermediate directory
fail closed. A missing target can yield a normal predicate, but a missing or
invalid root, EACCES, ELOOP, ENOTDIR or another I/O error cannot prove absence.

Repositories require a real directory and an **own non-symlink `.git`
directory** before Git can run. Git receives an explicit registered git-dir and
cwd, preventing parent discovery. Namespace validation does not mask
`core.bare`/`core.worktree` with an explicit work-tree: actual top-level must
exactly equal the registered repo, bare must be false and inside-work-tree true.
Subsequent commands also bind the explicit work-tree. Bare repositories,
`.git` files/linked worktrees and symlink repository namespaces are unsupported.
Branch lookup compares full refs, not prefixes; tags and descendant branches do
not establish the requested branch's existence.

Cleanliness uses index/tracked/untracked Git porcelain v1 with NUL records,
all untracked files, submodules not ignored and renames disabled. Ignored files
are excluded and normal Git ignore rules still apply. This is a conservative
**Git index/status cleanliness** predicate, not a hash of every filesystem body
or proof that tests ran. Assume-unchanged and skip-worktree flags can hide actual
tracked changes from an empty status, so any such entry is unsupported, including
both flags together and sparse-checkout skip entries. These are hard failures
even under WARN, not ordinary predicate warnings. Sparse/special layouts are not
otherwise attested. The probe never clears flags, refreshes or repairs the index.
Git may internally examine tracked file bodies, repository config and attributes;
these are not collected or returned as Vista data.

Before status, bounded effective config **names only** are inspected (including
local includes). Any `filter.*`, `submodule.*`, `diff.external`, or external
`diff.*.textconv`/`diff.*.command` configuration is conservatively unsupported,
even if unused. This avoids executing clean/process/smudge/textconv filters while
calling status read-only. Config names outside the accepted ASCII grammar reject.
A modes-only index listing refuses Gitlinks/submodules and unknown modes. A
separate fixed `ls-files -v -z` read checks NUL-framed tag/space/path records:
only ordinary cached `H` and unmerged `M` tags are supported; lowercase tags
(assume-unchanged), `S`/`s` (skip-worktree) and unknown/malformed records fail
closed before status. Private path bytes remain opaque, without UTF-8 or newline
decoding/logging, and the existing child buffer/deadline bounds still apply.
The addon neither launches filters nor rewrites config or index flags to
accommodate unsupported repositories. Ordinary tracked file and symlink modes,
including unmerged entries reported as dirty by status, remain supported.

## Child-process and read-only controls

Git launches use `execFile`, fixed argument arrays, **`shell: false`**, an
explicit private cwd/git-dir, no pager, and no optional locks. Only a configured
full branch ref contributes to an argument; no protocol value is a revision,
pathspec or flag. Commands are limited to namespace/HEAD `rev-parse`,
`for-each-ref`, config-name listing, index-mode/flag `ls-files`, and porcelain `status`.
There is no checkout, reset, clean, add, commit, fetch, shell or network command.

Each child has `GIT_TIMEOUT_MS = 2,000`, `GIT_MAX_BUFFER = 65,536` bytes,
`killSignal: "SIGKILL"` for timeout/buffer limits, and the runner's `AbortSignal`.
The runner's per-handler deadline remains 1–10,000 ms (default 1,000), so it can
abort earlier than a child timeout. On the tested Node runtime, AbortSignal
cancellation sends SIGTERM; native timeout kills with SIGKILL. Cancellation is
best effort, not a process-tree sandbox. Late callback rejection is consumed by
the unchanged runner and cannot revise a returned report. Filesystem operations
are checked for cancellation before/after waits but cannot be preempted.

The child environment is a fresh allowlist: fixed system PATH and C locale,
system/global config disabled through fixed null-device settings,
`GIT_ATTR_NOSYSTEM=1`, `GIT_OPTIONAL_LOCKS=0`, terminal prompts off and replacement
objects disabled. No inherited HOME/XDG, Git dir/work-tree/index/object settings,
config-count/parameters, trace, SSH overrides or credential state is forwarded.
Fixed settings disable fsmonitor, untracked cache, hooks, global attributes,
preloaded index reads, auto GC/maintenance and submodule summaries. No auth files,
`.env` files or private global config are explicitly inspected.

**Not a hostile-Git sandbox:** the host's approved Git executable, local repo
configuration (including its includes), Git internals/objects/attributes and
locally-controlled filesystem namespace remain trusted inputs. The conservative
filter/submodule checks are not a universal helper detector. Do not point this
factory at hostile repos or binaries and infer isolation. This first slice uses
POSIX null-device/PATH assumptions and Git features including `ls-files --format`;
only ordinary synthetic repositories on the recorded host Git version were
validated. Windows is unsupported in this first POSIX slice; other Git
layouts/versions are not validated.

**Not a race-proof filesystem jail:** validation and reads are separate,
point-in-time, non-atomic observations. Component swaps or concurrent repository
changes can race reads. No atomic snapshot, durability, remote freshness, owner
verification or source-tree attestation is claimed. There are no cached passes;
ordinary subsequent path, branch, HEAD and status mutations are observed anew.

## Fail-closed errors and privacy

Unknown aliases and invalid type-specific schemas throw **before that probe's
first filesystem read or Git spawn**. Earlier valid probes in a run may already
have read; this is not a whole-run alias preflight API. Unsafe whole-run inputs
still reject through the base runner with zero callbacks.

Namespace problems, child launch/error/timeout/abort, nonempty stderr, buffer
limits, malformed output and unsupported config/layouts are hard handler
failures, even with WARN; later checks are skipped. Boolean false is a normal
predicate (`warning` under WARN, `failed` under STOP), never a clean PASS.
The factory rejects with `LocalCheckError("invalid-config")`; internal failures
use `LocalCheckError("probe-failed")`. Both have fixed value-free messages and
stacks and retain no original error/cause. Runtime errors are projected by the
base runner as `handler-threw` or `timeout`, without raw details.

Root/repo paths, relative paths, actual refs, Git settings, stdout/stderr and
config values remain host-private. They are not generated as protocol metadata,
params/context, results, errors or logs. Reports retain only the base closed
projection (IDs/types/status/reason, predicate-only, authorization none). The
library emits no logs. Producers must still obey the safe metadata contract;
known-pattern label validation is not a universal secret detector.

## Validation and remaining work

Synthetic public-import tests exercise all six handlers, actual SHA-1/SHA-256
HEADs, branch/HEAD/filesystem mutation, dirty/index/untracked/ignored states,
actual assume-unchanged/skip-worktree/both/cleared flag states, sparse-checkout
skip entries, unmerged index entries, opaque path bytes and malformed flag output,
canonical/symlink/traversal/parent-discovery refusal, genuine missing versus
errors, hostile descriptors with zero traps/getters/coercion/I/O, detached
mutation isolation, exact alias schemas, fixed argv/environment, malformed output,
privacy, native and simulated timeouts/abort and consumed late rejection. Fixtures
are ordinary disposable Git-init repos under checkout `tmp/`; there is no test
`git worktree add`, real session, credential, production or owner resource.
Full before/after working and Git-directory inventories, file hashes and index
hashes remain equal during probes. Fsmonitor/hooks/filter/helper/trace markers
and new lock files are absent. Environment and mocks are restored; only each
test's own fixture is removed.

Root build/typecheck/tests and offline pack cover all eight packages while
preserving the original seven packages' runtime/manifests and 232 tests.
Offline extracted-tarball ESM/export/type-presence, CLI bin and addon fixture
smoke, plus cold tracked-source typecheck without preseeded dist, are separate
checks. They are **not** publication, deployment, a clean npm consumer install,
consumer TypeScript compilation or operational acceptance. Validation used Node
26.9.0 and host Git 2.50.1 with locked TypeScript 5.9.3. Node 20 runtime behavior
remains unverified despite the Node >=20 manifest.

Actual receipt/test-source authenticity, owner/gate integration and remaining
Task56 owner predicates, replay, Hindsight promotion and CLI check commands remain
out of scope. See [check-functions.md](check-functions.md) for the unchanged
runner and [PHASES.md](PHASES.md) for future work.
