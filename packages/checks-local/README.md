# @pi-vista/checks-local

Explicit trusted-host, read-only local filesystem/Git predicates for the existing
`@pi-vista/checks` runner. Version 0.1.0; Node >=20. No CLI, plugin loader,
network, persistence, repair, replay, gate integration or authorization.

```ts
import { createLocalCheckRegistry } from "@pi-vista/checks-local";

// Host-private variables: canonical directory and approved absolute Git binary.
const checks = await createLocalCheckRegistry({
  roots: { area: canonicalPrivateRoot },
  repositories: { sample: { root: "area", relativePath: "repository" } },
  targets: { seed: { root: "area", relativePath: "repository/seed.txt" } },
  branches: { primary: { repo: "sample", ref: "refs/heads/primary" } },
  gitExecutable: trustedGitExecutable,
});
const report = await checks.run([{
  check_id: "local-clean", type: "worktree_clean", params: { repo: "sample" }, on_fail: "STOP",
}]);
// verification: "predicate-only", authorization: "none"
```

| Handler | Exact symbolic params |
| --- | --- |
| `path_exists`, `path_not_exists` | `{ subject }` (target alias) |
| `sha_matches` | `{ repo, expected }` (repository alias and 40/64-hex SHA) |
| `branch_exists`, `branch_not_exists` | `{ repo, subject }` (repository and branch aliases) |
| `worktree_clean` | `{ repo }` |

The fresh factory snapshots closed own-data config before awaiting validation;
no source getters, proxies, symbols or coercion are accepted. Factory validation
has no I/O. Each probe validates aliases/schema before its first read, validates
its namespace anew and observes actual state without a result cache. Private
paths/refs/binary settings never become protocol metadata or error/report values.
`LocalCheckError` has fixed `invalid-config`/`probe-failed` codes and safe stacks.

Path probes inspect metadata, refusing symlinks and traversal; only genuine safe
ENOENT proves absence. Ordinary repositories require their own `.git` directory;
bare repositories, linked worktrees/git-files and parent discovery are refused.
SHA reads actual HEAD (unlike the base metadata comparator); branch lookup uses
exact full local refs. Cleanliness means Git porcelain status including staged,
tracked-unstaged and untracked dirt, excluding ignored files and honoring Git's
normal assume-unchanged/skip-worktree semantics. Filters/textconv/external diff
config and submodules are conservatively refused before status.

Git uses fixed `execFile` arguments, shell false, explicit cwd/git-dir/work-tree,
2,000 ms child timeout, 65,536 byte buffers, runner AbortSignal and an allowlisted
environment. Global/system config, inherited Git/trace/SSH state, optional locks,
fsmonitor, untracked cache, hooks and auto maintenance are disabled. Namespace,
subprocess and unsupported/malformed-output failures are hard even under WARN;
false is a normal predicate. No stdout/stderr or file bodies are reported/logged.

The host Git binary, local repo config/includes and locally-controlled filesystem
are trusted; this is **not a hostile Git sandbox or a race-proof filesystem
jail**. Observations are non-atomic and predicate-only, not receipt/test/source
attestation or execution/merge/production permission. First-slice validation uses
POSIX assumptions, Node 26.9.0 and Git 2.50.1; Node 20, Windows, a clean consumer
install and consumer TypeScript compilation remain unverified. Source/pack smoke
is not registry publication or operational acceptance.

See the maintained [local probe guide](https://github.com/chenhaoxiang/pi-vista/blob/main/docs/local-check-probes.md)
for the exact config bounds, six scopes, privacy, read-only controls and limits,
and the [base checks guide](https://github.com/chenhaoxiang/pi-vista/blob/main/docs/check-functions.md)
for runner behavior.
