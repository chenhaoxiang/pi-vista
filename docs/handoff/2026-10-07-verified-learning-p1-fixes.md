---
doc_type: report
project: workspace
owner_repository: chenhaoxiang/pi-vista
status: completed
truth_mode: snapshot
created: 2026-10-07
verified: 2026-10-07
ssot: false
verification_boundary: local-source-fixes-and-synthetic-validation
---

# Verified-learning full-review P1 corrections

This snapshot records local corrections, not independent-review PASS, remote
merge, publication, owner activation or operational acceptance.

## Preserved full-range BLOCK

The independent fresh-context reviewer inspected the full 75-path range from
`dd73a9849f22c8c2f31746dcb38dc59d998eb6c1` to
`40fd928431d14fee4bf7b54ecf04826f513f1567` and returned **0 P0, 2 P1, 0 P2: BLOCK**.
Review model was `codex-local/gpt-6.1-sol:max`, the same model as the Driver;
this was independent same-model engineering review, not heterogeneous or human
approval. The exact structured report was recovered from the native run's
actual structured-output artifact. Its SHA-256 is
`7534275bace15febe11e770d1a52f2e16bdd37e26e17ac98e9f2996b5b77c268`.

The requested file-only report path was not produced, so the child and workflow
remain recorded failed. Recovering the real structured report does not relabel
that transport as success. The earlier workflow's undefined JSON-reference
failure is likewise retained. No global Pi/subagent runtime was changed.

## Independent Driver reproductions

Both defects reproduced on actual Node20.20.2 and Node26.9.0 with disposable
synthetic inputs:

- An omitted canonical step became an own projected step through writable
  `Object.prototype.step_id`. An inherited getter was read twice; a throwing
  getter escaped as its original Error instead of the fixed protocol error.
- A matching compiled module containing only an empty `describe()` suite
  reported zero cases but the wrapper exited 0. A comment-only module's implicit
  file wrapper likewise was not an actual explicit test case.

No real owner/session/credential/production inputs were used. Temporary
prototype changes were restored in `finally` in isolated test processes.

## Minimal root corrections

Shadow's private correlation/observation/row/asset/options records now remain
null-prototype through optional reads. Public-field assignment is own-data;
freezing checks ownership before reading optional stats. Core handoff shadows
its known omitted optional reads with own undefined data, then strips bridge-only
undefined fields before callbacks/public return, retaining event identity and
persisted JSON shape. Public boundary errors remain fixed and value-free.
Unchanged core redaction can reject globally unusable getter-only destinations;
that is a fixed rejection/fail-open observation, not an invocation of source
getters or a universal hostile-JS realm sandbox. Original eight package runtimes
and their assertions are unchanged.

The test entrypoint now consumes native completion events, not stdout or user
diagnostics, through a separate controller reporter. It excludes suites and
implicit file wrappers; requires a closed, file-bound, nonzero executed-case
report in addition to child exit 0; preserves failures/cancellation; and removes
only its own temporary count directory. Empty suites, comment-only modules,
stdout-count spoofs and all-skipped modules reject. The characterized built
protocol-only no-test-files exception remains explicit and contributes zero.
Ambiguous file-named line-1/column-1 completions without entry-file metadata fail
conservatively; this is a case guard, not a semantic assertion-call or hostile
test-code attestation system.

All eleven package test entries, integration and script tests use the guard.
One assertion in the **newly added learning package** deliberately changed from
requiring a fixed shell glob to requiring the exact stronger guarded invocation.
The original failure at that old manifest assertion was retained; no behavioral
learning assertion or original eight-package assertion was removed or relaxed.

## Actual local validation

Both complete source runs pass **567 Node test cases**, zero failures/cancelled/
skipped/todo. These are case counts, not counts of assertion-library calls:

- Original eight packages: 277; protocol explicitly 0.
- Evidence: 40; learning: 133; shadow: **74** (60 preserved + 14 new regressions).
- Root public integration: 24 (15 preserved + 9 new).
- Release-script regressions: **19** (17 preserved + 2 new).

Recorded actual runtime/gate evidence remains locally under checkout `tmp/`:

| Runtime | Source | Actual packed consumer |
| --- | --- | --- |
| Node26.9.0 | `source-OgK4Q2/report.json` | `consumer-AzQla4/report.json` |
| Node20.20.2 | `source-2YBQSq/report.json` | `consumer-FZPJLg/report.json` |

These entries are relative to `tmp/release-contract/`; Node20 controller evidence
is `node20-Uk5yOm/report.json`. Both consumer gates perform real isolated npm
installation of all eleven exact tarballs, public import/bin and strict locked
TypeScript compilation, not mere extraction or workspace-link smoke. Installs
are offline/cache-backed; registry availability and hosted CI are not claimed.
The provided actual Node20 executable hash remains
`38de4fc456c0c439bac48c727d378f749abb4e31f4116703bb1ee9a746fccbb6`.

These measurements were made on the corrected working-tree source before the
commit containing this report; the next exact-source review/post-commit gates
must bind their own committed SHA. The old 551-case evidence remains historical
and is not retroactively represented as covering these new negative cases.

## Remaining delivery boundary

The original BLOCK remains attached to its original SHA. Targeted independent
recheck of both fixes and their blast radius, actual report delivery, source PR,
hosted CI, normal remote merge, remote-main readback and documentation closeout
remain parent gates. Real signed owner producers, actual Hindsight durability/
cross-process recall, owner normalization/live isolation, executable replay,
model capability trials and publication remain outside these local proofs.

Maintained contracts: [shadow](../adapters/shadow.md),
[release](../release-contract.md), [learning](../learning.md),
[continuation](../../openspec/changes/verified-learning/proposal.md).
