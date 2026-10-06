# Repository-local contributor contract

pi-vista observes; it does not override workspace-guard, ai-gate, or production
safety authority. Keep runtime changes within the relevant package's public
contract. Protocol data must not carry raw commands, paths, credentials, model
input/output, or artifact content. Unknown recorded versions are labels, not
compatibility or trust decisions.

The observation CLI is strictly offline/read-only. Do not turn recorded
`ok`/`verified` flags or checkpoint metadata into execution or merge permission.
Tests must use synthetic data, never real session logs; CLI fixtures belong in
`tmp/`, and cleanup must target only test-created directories.

## Source package inventory

The merged infrastructure includes `@pi-vista/protocol`, `@pi-vista/core`,
`@pi-vista/adapter-pi`, `@pi-vista/adapter-workspace-guard`,
`@pi-vista/adapter-ai-gate`, `@pi-vista/cli`, and `@pi-vista/checks`.
Build protocol/core first, then the other public packages. Root tests include
all existing package tests plus public-import synthetic integration tests.
Source integration through PR #7 is recorded in the merge closeout; it does not
imply registry publication, deployment or operational acceptance. The integration
snapshot preserves the old core/Pi/guard credential defect as historical evidence.
The bounded metadata/generation repair passed exact-source review and isolated
post-merge tests; docs/metadata-safety.md describes its limits. Do not treat that
review as a universal secret detector, owner verification or live/release authority.

## Public document map

- [README.md](README.md): package overview and implementation status
- [docs/handoff/2026-10-06-source-merge-closeout.md](docs/handoff/2026-10-06-source-merge-closeout.md): merged-source evidence, source PR reconciliation and remaining boundaries
- [docs/getting-started.md](docs/getting-started.md): source/package usage
- [docs/infrastructure-integration.md](docs/infrastructure-integration.md): candidate inventory, public source pins, functional validation snapshot and open blockers
- [docs/metadata-safety.md](docs/metadata-safety.md): shared known-credential metadata boundaries, historical defect and source review limits
- [docs/cli.md](docs/cli.md): maintained observation CLI/API, privacy and limits
- [docs/check-functions.md](docs/check-functions.md): programmatic predicate registry/runner, fail-closed limits and no authorization
- [docs/PHASES.md](docs/PHASES.md): implemented slice versus future phases
- [docs/architecture.md](docs/architecture.md): storage and safety boundaries
- [packages/core/README.md](packages/core/README.md): public core runtime contract
- [packages/protocol/README.md](packages/protocol/README.md): protocol interfaces
- [docs/adapters/pi.md](docs/adapters/pi.md),
  [docs/adapters/workspace-guard.md](docs/adapters/workspace-guard.md) and
  [docs/adapters/ai-gate.md](docs/adapters/ai-gate.md): adapter guides

Validation: `npm run typecheck`, `npm run build`, `npm test`,
`git diff --check`, and `npm run pack:dry-run`. Build/pack tests do not establish
registry publication, a clean install, deployment, or operational acceptance.
