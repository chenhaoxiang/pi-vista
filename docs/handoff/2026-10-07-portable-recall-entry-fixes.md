---
doc_type: report
project: workspace
owner_repository: chenhaoxiang/pi-vista
status: completed
truth_mode: snapshot
created: 2026-10-07
verified: 2026-10-07
ssot: false
verification_boundary: local-entry-corrections-and-synthetic-runtime-proof
---

# Portable historical recall: entry correction snapshot

The independent fresh same-model full changed-source review bound to
`72a70cc17690d9364d58d1c0f22073fbe4425528` returned **BLOCK: 0 P0, 1 P1, 1 P2**.
Its unchanged report SHA-256 is
`c16fe014f8749ba9455d35899823d09acfb3f0536b884ec8b3d11c9054fcc41c`.
This is independent same-model Sol6.1:max engineering inspection, not human,
heterogeneous or platform approval. The original verdict remains historical;
local corrections below do not retroactively pass that SHA.

## Driver independently reproduced both findings

Actual Node26.9.0 and Node20.20.2 synthetic reproductions showed:

- A new library could import authenticated history with the **old run** and a
  different ID, then reuse an authentic, still-current original `VerifiedEvidence`
  without a new-run owner read. It could also reuse the archived ID with another
  run. This was a missing new-run/new-ID contract check, **not** a copied-proof,
  expired-proof or cryptographic bypass.
- Public `select` accepted extra JavaScript arguments as internal counter seeds:
  a mutable object survived at `rejected.bank`, NaN survived in duplicate counts,
  and wrong-bank rejection invoked caller `valueOf` once. No history/admission
  authority was forged, but the numeric detached/no-coercion public contract broke.

Only generated synthetic keys/documents and mock ports were used. No real
Hindsight/owner/signing-key/production inputs or model service was accessed.

## Minimal entry corrections

`importHistorical` now validates a safe incoming ID and rejects equality with
both the historical experience ID and historical run ID **before** observation
ID reservation. Four non-run bindings still must match. A distinct-run import
remains observed-only; the normal existing verifier still requires an exact
fresh matching current-run proof. No verifier/clock/expiry rule was changed.

The public historical `select` is a two-argument wrapper. Extra JavaScript args
are ignored without inspecting/freezing/retaining/coercing them. Private recall
may still supply its own bounded transport-derived bank/duplicate counts.
Existing valid selection/rejection and port semantics are unchanged.

Three additional public-import tests cover old-run reuse with a genuine current
old proof, archived-ID reuse in a fresh library, no ID reservation on refusal,
old-proof refusal after proper distinct-run import, and extra mutable/Proxy/
string/non-finite seeds with zero traps/coercion and numeric frozen counters.
All prior assertion files remain unchanged; existing positive fresh consumer-run
verification and all archive/transport/lifecycle/privacy tests still pass.

## Actual local measurements

Corrected working-tree source typecheck, learning tests **225**, full source
**659** (=567 inherited +89 feature +3 correction cases), and actual packed
consumer installation/import/bin/strict TypeScript gates pass on Node20.20.2 and
Node26.9.0. Every counted case has zero failed/cancelled/skipped/todo; protocol
continues its explicit no-test-files zero exception.

Source/consumer ignored reports relative to this checkout's `tmp/release-contract/`:

| Runtime | Full source | Packed consumer + installed restart |
| --- | --- | --- |
| Node26.9.0 | `source-k7nn0C/report.json` | `consumer-NNDfjq/report.json`, `portable-feature-report.json` |
| Node20.20.2 | `source-syvRle/report.json` | `consumer-kt9jqk/report.json`, `portable-feature-report.json` |

Node20 controller: `node20-HwDaO3/report.json`; actual executable SHA-256 remains
`38de4fc456c0c439bac48c727d378f749abb4e31f4116703bb1ee9a746fccbb6`.
These supplied-executable/offline-cache checks are not publisher signatures,
registry availability, hosted feature CI or operational acceptance.

Each installed restart proof compiles the consumer fixture using consumer-installed
TS5.9.3, asserts package resolution to exact installed tarballs, then launches
**two different fresh Node processes**. Node26 PIDs were 37695/37735; Node20 were
37806/37807. Only safe signed archive/public pin data survives between processes.
Consumer authenticates history, imports observed-only, refuses old/copy evidence,
and verifies only through new consumer-run owner receipts while preserving live
expiry. The test cleans only its own created restart fixture. This is actual
serialization/process separation, not two calls sharing a producer WeakMap.

These records were generated before the commit containing this snapshot;
postcommit/final review must bind their own exact SHA. The old 656-case evidence
remains pre-correction history and does not cover these new negative cases.

## Remaining delivery and trust limits

Independent exact-source targeted recheck of both fixes/blast radius, hosted
CI/source PR, normal main merge/readback and shared document closeout remain
parent gates. Real Hindsight API adapter/bank durability, production origin-key
custody, durable idempotency/crash reconciliation, default Pi context injection,
executable actions and model capability trials remain unaccepted/unimplemented.

Signed history authenticates the pinned issuer's historical claim, not semantic
truth, independent wall time or current permission. Current admission is always
separate; stored status cannot restore live factory provenance. Clocks, lifecycle
port coverage and backend persistence are explicitly trusted-host responsibilities;
callbacks/timeouts are not CPU/process sandboxes or rollback guarantees.

Contracts: [portable recall](../portable-recall.md), [learning](../learning.md),
[evidence](../authoritative-evidence.md),
[owner change](../../openspec/changes/portable-experience-recall/proposal.md).
