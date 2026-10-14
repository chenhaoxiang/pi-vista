---
doc_type: report
project: workspace
owner_repository: chenhaoxiang/pi-vista
status: completed
truth_mode: snapshot
created: 2026-10-14
verified: 2026-10-14
---

# Notification-only observer source and local installation closeout

## Delivered facts

Owner selected fixed default installation and fresh-session loading on2026-10-14.
[PR55](https://github.com/chenhaoxiang/pi-vista/pull/55) ordinary merge delivered
reviewed head `1022748fa6401bdb11830303d6a9e2092c232a44` to main
`011b3812e982680f76996a21408fe9d7bb9ec04d` at03:39:56Z.
Head CI38506383812/main CI38507420246 each completed successfully with Node20/22/26
source/packed-consumer jobs; head also has a separately projected GitGuardian check.
The workflow is `Source and packed-consumer contract`. Safe records are in
[evidence](evidence/2026-10-14-local-observer/README.md).

This handoff/evidence directory itself still needs its own docs PR/main inclusion
at preparation; PR55 does not prove these later files were already merged.

## Implementation and review

The observer entry/packages/public ABI are unchanged. The source-bound builder
archives exact clean HEAD, builds offline with locked dependencies and installs
only eleven local tarballs, without a host Pi SDK. A fixed fail-open loader pins
manifest, entry and86runtime file hashes before factory invocation. Installation
uses exclusive shim creation; no `settings.json`, other extension or model update.
The maintained [installation contract](../pi-local-observer-install.md) gives
scope, generator/write details, preservation of partial preparations and rollback.

Initial independent full review and same-reviewer final follow-up were read-only.
Four P2 items were closed: imported entry is explicitly manifest-bound; exact shim
write is documented; failed destinations are preserved and retried at new paths;
operator builder success is distinguished from CI coverage. One report-only test
coverage note remains: wrong entry-hash with a present entry row lacks a separate
discriminating variant. No P0/P1 blocker remained. Parent ran the actual checks;
the reviewer did not independently execute or recompute hashes.

Parent final targeted19/release343/source/consumer/actualNode20.20.2 passed.
The entry-binding regression genuinely fails on original8afe9e4 source (factory
invoked1instead of0), then passes on corrected source. Original local Node20 LOCAL
10ms timeout failure and earlier hosted Node22 core tests-7 failure are retained,
not first-pass success. One failed-job-only hosted retry was requested; final-head
CI is independently bound to1022748. No unrelated test/timeout assertion was changed.

Gate ready/merge returned `PASS_ESCALATED`, preserving S1/P1, missing review-App
and fixed `execFile` call pattern upgrade rows. No Owner override was used and no
App credential was invented. Actual merge succeeded, while the first bounded
postmerge wait returned exit3/`ci-pending`. Subsequent exact-SHA readonly reconcile
returned exit0/`already-merged`/`ci-success`; it did not rerun merge or re-evaluate
and retroactively green the original audit. Canonical main sync had one fetch
error, then safe ff-only retry and matching clean main readback.

## Actual local installation versus isolated new loading

Installed a new private0600 user autoload shim at
`~/.pi/agent/extensions/pi-vista-local.ts`. It references the fixed release under
`~/.pi/vista/runtime/releases/1022748fa6401bdb11830303d6a9e2092c232a44/`.
Private installation/loading receipts retain the hashes. Public projections record:

- observer entry SHA256 `02a6f2d79b19e8455d1efdc29369364d9b1917e3d8b84526d34e5225ce1ad145`;
- global shim SHA256 `b9ba45a93982a9c66ea55e4323a2b69ae617b37430c95f13a28655be0526d048`;
- manifest SHA256 `5dc4f08311b93544b8214c3f7a597276d34e129bd400457e1b3707416435426b`;
- eleven installed packages/86verified runtime files, source1022748.

Readback verifies actual global file presence/mode and all manifest files. It is
integrity, not Owner authentication, signed proof or immutable OS isolation.
The installed shim's exact bytes were then copied into owned isolated agent dirs
and discovered without an extra extension path by real Pi1.2.0-fork.1
`DefaultResourceLoader`, followed by fresh AgentSession on Node26.9.0.
Normal/storage-fault/missing-head each passed; normal persisted5safe events,
fault cases persisted0. Four `/vista-*` commands were present, native read returned
the original sentinel, selected model/thinking/tools/prompt stayed unchanged.
Each scenario used2synthetic responses and observed0intercepted ModelRuntime
transport calls. No real model/bank/credential-byte work was part of this scope;
these are not independent OS-wide egress/billing counters.

The acceptance report correctly keeps `actual_default_installation:false` because
its event HOME/agentDir is isolated. The separate installation readback proves
the global shim, not by rewriting that flag. No existing busy session was reloaded;
no claim that all user sessions/plugins are active or that real global events have
already been recorded. Extension-disabled or nonstandard agent directories remain
outside conventional defaults. The source can lose observations on HEAD/store or
registration faults without changing native execution.

## Remaining boundaries

No LOCAL/history/guidance default activation, model tools, extra real model calls,
production-bank writes, permission/policy change, release publication, universal
SDK dependency declaration health or broad ROI claim. Existing observation data
is preserved. Rollback removes only our exact matching shim; it never deletes
`~/.pi/vista` events or another writer's changed entry. Old loaded sessions are not
retroactively withdrawn.

Original local records: implementation worktree
`local-observer-install-20261014-01a120e4/tmp/observer-install/` (review diffs/logs,
head/main/check-run readbacks, original gate/merge/reconcile, actual install log,
final readback and installed-sdk12-discovery stdout); the native report original
is `tmp/release-contract/local-observer-sdk-8ESA3d/report.json`. Prior source and
fixture reports keep their own producing entry/source digests.
