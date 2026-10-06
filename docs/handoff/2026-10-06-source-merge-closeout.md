---
doc_type: handoff
project: workspace
owner_repository: chenhaoxiang/pi-vista
status: completed
truth_mode: snapshot
created: 2026-10-06
verified: 2026-10-06
ssot: false
verification_boundary: merged-source-and-synthetic-local-validation
---

# Source merge closeout — 2026-10-06

This snapshot closes the infrastructure **source integration** task. It is not
registry publication, deployment, operational acceptance or completion of the
entire learning-system roadmap. Future changes must reverify their own source.

## Reviewed and merged source

The operator explicitly authorized merging the validated PR and finishing the
source task. [PR #7](https://github.com/chenhaoxiang/pi-vista/pull/7) was changed
from Draft to Ready and merged normally, without admin bypass or a direct main
push, at **2026-10-06 18:33:39 UTC**.

- Reviewed source: `68b382ce20da47c6c43c6a271e645724c262056b`.
- Main source merge: `e2d94c5f7035641ac4fe373a2f9722dc65289ee1`.
- Both source trees: `96406fe7a45aa47dc83797015d4d8e5162260e67`.
- The reviewed source and all six source-candidate heads are ancestors of the
  main merge. Ordinary merge preserved the integration ancestry.
- Actual platform checks at source merge were GitGuardian and the explicitly
  same-model local-review status. No automated build/test/typecheck CI or trusted
  App review check was represented as passed.

The full security/integration review initially found a generator regression on
`a38887f0540eef4ac25bd7aad64d977ed89d524a`. Its BLOCK verdict remains history.
The five-file generation follow-up passed targeted recheck at `68b382c`, with
P0/P1/P2 all zero. The initial review used fresh context; the follow-up resumed
that same read-only reviewer. Both used `codex-local/gpt-6.1-sol:max`, the same
model as the Driver, not heterogeneous review. Compensations were adversarial
inspection, explicit checklists, committed failing-capable regressions and
independent Driver baseline/fixed runtime proofs.

The latest hash-bound review is attached to [PR #7's review comment](https://github.com/chenhaoxiang/pi-vista/pull/7#issuecomment-6022710052):
`e869a7408de07d69b74a241cc0c252f838ec4d194424b94144cf37124d347d0a`.
Its provenance clarification distinguishes fresh initial review from retained
follow-up and does not retroactively clear unsafe earlier SHAs.

## Source PR reconciliation

Platform states were reread after PR #7 merged:

| Source PR | Final platform state | Handling |
| --- | --- | --- |
| [#1](https://github.com/chenhaoxiang/pi-vista/pull/1) | MERGED | GitHub automatically recognized main ancestry at 18:33:41 UTC; not a separate deployment of the old snapshot |
| [#2](https://github.com/chenhaoxiang/pi-vista/pull/2) | CLOSED | Superseded by #7; guard source is included in corrected main |
| [#3](https://github.com/chenhaoxiang/pi-vista/pull/3) | CLOSED | Superseded by #7; Pi/core source is included with later repairs |
| [#4](https://github.com/chenhaoxiang/pi-vista/pull/4) | CLOSED | Superseded by #7; gate adapter source is included |
| [#5](https://github.com/chenhaoxiang/pi-vista/pull/5) | CLOSED | Superseded by #7; observation CLI source is included |
| [#6](https://github.com/chenhaoxiang/pi-vista/pull/6) | CLOSED | Superseded by #7; checks source is included |
| [#7](https://github.com/chenhaoxiang/pi-vista/pull/7) | MERGED | Unified, reviewed and corrected source entered main |

Each source head was mechanically verified as an ancestor of main before
closing residual duplicate candidates. CLOSED is not claimed as a separate PR
merge. No old base/tree was merged again; branches, worktrees, historical
review hashes and failure records were preserved. Old unsafe SHA statuses were
not turned green merely because a corrected descendant merged.

## Isolated post-merge validation

After fetching the actual main merge, validation ran in a separate worktree of
`e2d94c5`, not in the canonical source-reading directory. The merged tree matched
the reviewed source exactly. Toolchain was Node **26.9.0**, npm **11.19.1** and the
existing exact-lock local TypeScript **5.9.3**, `@types/node` **20.19.43** and
`undici-types` **6.21.0**. Local dependency links are not clean-install proof.

| Post-merge command | Result |
| --- | --- |
| `npm run typecheck` | All seven packages and root integration source passed |
| `npm run build` | All seven packages passed in dependency order |
| `npm test` | **232 passed**, zero failures/skips/cancellations/todos |
| `npm_config_offline=true npm run pack:dry-run` | All seven manifests/prepack checks passed |
| `git diff --check` | Passed; source tree stayed clean |

Suite accounting: core **42**, protocol **0**, Pi **35**, guard **18**, gate **36**,
CLI **44**, checks **42**, root integration **15**. The protocol suite's zero tests
is stated explicitly, not counted as added coverage.

Premerge exact-source evidence additionally included seven manually extracted
tarballs, twelve export/declaration paths, CLI bin/API and synthetic cross-package
smoke with unchanged storage hashes; a 56-source-file Git archive cold typecheck
without preseeded dist/declarations; old/fixed credential-store reproductions;
and all five natural clock boundaries. These were actual Driver checks, not
reviewer-executed commands or clean consumer installation/compilation.

The canonical local main was safely fast-forwarded after verifying it was clean
and had no in-progress/index flags or observed concurrent user. Readback matched
remote main with zero ahead/behind. No reset, clean, stash, branch deletion or
batch restoration was used. Machine logs remain local and are not published as
project documents.

## What is now available in source

Seven packages coexist under one root workspace: protocol, core, the Pi,
workspace-guard and ai-gate adapters, the offline observation CLI, and the
trusted programmatic predicate registry/runner. The public host must call the
adapters explicitly; merging does not install or hook Pi automatically.

Known embedded credential signatures are handled by the bounded shared
core/Pi/guard protection; the timestamp generator cannot create those supported
signatures. Safe historical base-36 IDs remain opaque readable IDs. The
[metadata guide](../metadata-safety.md) specifies exact limits; the old
[integration snapshot](../infrastructure-integration.md) remains unchanged.

## Remaining boundaries and roadmap

- **Not validated:** Node 20 runtime, clean npm consumer installation, consumer
  TypeScript compilation, registry availability, automated CI trust-root and
  actual owner/live integration. No release or production readiness claim.
- **Not executed:** npm publication, deployment, real Pi/guard/gate activation,
  production changes, replay/repair, or product Hindsight experience promotion.
- Real path/branch/worktree/Git/test/receipt owner probes remain follow-up work.
  Current checks compare host metadata or trusted callback predicates, not
  independently verified gate admission or source facts.
- Hindsight promotion/retrieval, failure analysis/replay, shadow observer
  integration and capability evaluations remain later roadmap items. This task
  does not mark those features completed.
- Known-pattern detection is conservative and bounded; non-matches do not prove
  safe text. Producers must sanitize unknown secrets and raw content.
- CLI/core reads remain best-effort and non-atomic. Trusted callbacks are not
  sandboxed; timeouts do not cancel all late work or undo side effects.

Follow the maintained [phase plan](../PHASES.md), [CLI guide](../cli.md),
[checks contract](../check-functions.md) and [architecture](../architecture.md)
when continuing. A source merge and this snapshot never grant execution,
merge, release or production authorization to recorded evidence or memories.
