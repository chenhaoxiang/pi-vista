---
doc_type: handoff
project: workspace
owner_repository: chenhaoxiang/pi-vista
status: completed
truth_mode: snapshot
created: 2026-10-07
verified: 2026-10-07
ssot: false
verification_boundary: local-synthetic-cancellation-source-correction-not-merged
---

# Hindsight journal cancellation correction

## Original review and verified defect

Fresh independent same-model read-only engineering review inspected all 23
committed paths from main `f53fb1bd8d7eaf6902a17e0c39e28159d5573cf5` to
`e10eddef868ac33ba5c6f7a4cf6930f990f821e9`, tree
`6bb7f60b9db31862bf079feee0929a0e937ac577`. Original result: **OK with notes,
0 P0 / 0 P1 / 1 P2**. Retained exact report SHA-256:
`daa1d8e973f2465bb5a20b4748d7f0f94c91abd9f5e7882d2152a056a36456b0`.
The original finding remains a fact at that head; a later correction does not
retroactively turn it into a clean full review. Reviewer inspected Driver
reproductions, not independently executed commands.

`create()` awaited root lstat/stat checks, then opened an exclusive intent before
rechecking a visible cancellation/deadline. Driver reproduced on the actual
installed public addon from exact original tarballs in four isolated processes:
Node26.9.0 abort/timeout PIDs38518/38519 and Node20.20.2 PIDs38520/38533. Abort was
visible before open; timeout open occurred at303/302ms against200ms. Each left
a regular0600 **zero-byte intent**, then rejected a fresh retry and returned
not-confirmed on reconciliation. GET/retain/other counts were all0. This is a
local availability/documented-cancellation contract issue, not duplicate retain,
remote authorization, current-proof bypass or measured native filesystem delay.

Process-confined fs/promises interception controlled the pre-create scheduling
point and was restored before retry. Only synthetic loopback and invocation-owned
private tmp directories were used. Driver retained original artifacts under
`tmp/hindsight-proof/cancellation-e10/` plus `cancellation-repro.mjs`.

## Minimal correction and additive regressions

`create()` now checks immediately after its awaited root preflight and before
O_CREAT/O_EXCL dispatch. The same gate covers intent and completion creation.
No existing intent is deleted, reset, overwritten or reopened for remote retry.
Cancellation becoming visible **after** a dispatched open can still leave an
uncertain claim; OS/filesystem waits are not preemptible or rolled back.

Four new cases cover abort/deadline during either awaited lstat or held-directory
stat. Each uses a fresh child, unchanged public addon, actual synthetic HTTP and
private journal; the parent never patches native FS. They assert no intent/no
creation before retry, fixed error, successful legitimate fresh retry with one
retain and exact read-only reconciliation. All four first failed on unmodified
e10 runtime on both actual runtimes, then passed after the one-line correction.
All 41 original assertion/fixture blobs and the previous85 new cases are retained;
new cases raise the expected source total from744 to**748**, learning314.

Parent focused red/green logs live under `tmp/hindsight-proof/cancellation-fix/`.
Full final committed-source/consumer gates, retained independent correction
recheck, hosted CI and ordinary source PR inclusion must be verified separately;
focused passes are not those gates or a claim that this snapshot is merged.

## Boundary

No real Hindsight service, bank, credentials, origin key, default Pi activation,
release/deployment or owner policy change. Shared-root cooperative local POSIX
protection remains non-distributed and assumes truthful host FS/fetch and sync
guarantees. Historical authenticity never restores current authority. Contract:
[store](../hindsight-store.md), [learning](../learning.md),
[owner change](../../openspec/changes/hindsight-store/proposal.md).
