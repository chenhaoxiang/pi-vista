---
doc_type: handoff
project: workspace
owner_repository: chenhaoxiang/pi-vista
status: completed
truth_mode: snapshot
created: 2026-10-07
verified: 2026-10-07
ssot: false
verification_boundary: merged-consumer-source-synthetic-files-and-installed-proofs
---

# Receipt-file consumer source closeout — 2026-10-07

This closes the explicit file-consumer source slice, not actual owner production
receipts/public-key provenance, coverage truth, current permission, real service
activation, default Pi/CLI changes or publication/deployment.

## Exact source and ordinary merge

[PR #16](https://github.com/chenhaoxiang/pi-vista/pull/16) normally merged at
**2026-10-07 16:05:50 UTC**, matching the exact reviewed head, no admin bypass
or direct main push. Driver source/main readback checked:

| Pin | Value |
| --- | --- |
| Main baseline | `f70de84ba94f684cb0305af524f7fd8591b63e59` |
| Source reviewed head | `3dc259769dd11f877055ba9b93c56d0bb64b869f` |
| Reviewed/merged trees | `19c0f61e4bae689399736e1e1242b83d795e2617` |
| Actual source main merge | `910306dd2e6d6fedbb702ddf2a5a1e98ca6dc0c7` |
| Full20-path diff SHA256 | `db8738e695c5051da8fa2dd77d37966c604390104b97b4cfa0c9f78c58c05131` |

Normal merge parents are the baseline and reviewed head; ancestor and tree
equality were checked. Canonical main was target-only safely ff-synchronized
and read clean with zero ahead/behind. No other session/worktree was cleaned.
This later documentary candidate still needs its own reviewed PR/inclusion;
source-main acceptance does not claim this report already remotely merged.

## Implemented consumer and preserved trust boundary

- Only explicit `@pi-vista/evidence/files` factory/types; root verifier/data/API
  and all existing tests remain unchanged. Eleven packages,18 public exports.
- Private current-user POSIX root/file mapping and canonical public Ed25519 pins;
  import/construction has no I/O/default discovery or credential lookup.
- Fixed canonical UTF8 v1 envelope files, optional one LF, exact original fields;
  malformed/duplicate/BOM/unknown/trailing/partial/noncanonical data reject.
- Bounded no-follow/nonblocking read-only opens, owner/mode/link/size checks,
  held FD/path metadata samples, fresh reads and elapsed/abort checks; late
  acquired descriptors close even after cancellation. No writes/repair/locks.
- Transport never authenticates, signs, fills bindings/time/details, invents
  counts/coverage, normalizes signed fields or chooses PASS. Unchanged verifier
  owns actual signature/digest/pins/five bindings/freshness/details/private proof.

**Actual compatible owner producers and public-key provenance remain MISSING /
unaccepted.** Unsigned audit/observations, candidate assets, synthetic transport
tickets and App authentication/checkrun metadata do not satisfy v1 evidence.
Private owner source/formats/live records were not copied into the public code.
No real events/approvals/keys were read and no owner policy/lock/threshold changed.

## Native review recovery and exact full inspection

All actors used `codex-local/gpt-6.1-sol:max`: independent read-only same-model
engineering inspection, one unique model, not human/heterogeneous/App approval.

Original workflow `2c8c7615-e742-4f85-af5f-1da9597412a7` completed writer
`2658bd7d-12f2-441a-a05d-02bf38d66fe1`, then failed before reviewer launch: outer
walltimeout10800000ms conflicted with child idle1800000ms. No original reviewer
run/result exists. Original failed receipt/script/status and source diff are
preserved, not relabelled PASS. Source/branch/index were read back clean.

Same native-protocol recovery `c6505e9a-6b8b-4a9c-9fe3-9395930b5c7e` removed the
wrapper walltime fields and ran only fresh reviewer
`9b8922cf-364c-4f28-ade5-c333df9241d3`. Writer was not rerun, source/model/tool/global
configuration/CLI protocol unchanged. Real final full20-path report: **OK,
P0/P1/P2=0**, SHA256
`e3216346f65a3b091082b41afc592ee05ac97ed0660af8a21186a94a3f5d8c4f`.
[Full report/comment](https://github.com/chenhaoxiang/pi-vista/pull/16#issuecomment-6041794550)
records exact source and evidence. Reviewer executed no shell/Git/API/tests or
writes; writer and parent execution evidence was inspected. Report persistence
was read back before source delivery. This is fresh full review, not a recheck of
a nonexistent prior review.

## Actual source and installed acceptance

Both writer and parent actual Node26.9.0 / provided Node20.20.2 exact-commit source
gates pass **834 genuine cases=748 unchanged+86 new**, evidence126, learning314;
all fail/cancelled/skipped/todo counts0. Protocol is the explicit0 exception,
not coverage. Repeated runs are corroboration, not extra distinct cases.
Original54 test/spec/fixture blobs and166 protected boundaries match baseline.
Only one export-map entry and the narrow fixture build exclusion were added;
verifier/data/learning/other packages/root dependencies/lock/gates/CI unchanged.
Initial failed type/fixture evidence remains retained and separated from finalSHA.

Actual isolated consumers install11 exact tarballs/18 exports, consumer-installed
locked strictTS5.9.3, installed `vista`, and281 allowed packed files. No workspace
links or compiled synthetic helpers enter runtime tarballs. Parent fresh installed
producer/reader PIDs39608/39609 (Node26) and39724/39725 (Node20) independently
verify3 synthetic signed files, five bindings/current proof and predicate-only
probes; copied/serialized/foreign proof refusal, one explicit confirmed synthetic
ingest/readback, changed-file refusal/fresh publication and expiry all pass.

Actual GitHub Ubuntu Node20/22/26 source/consumer/advisory/whitespace jobs pass:

- [PR-head37648603934](https://github.com/chenhaoxiang/pi-vista/actions/runs/37648603934), exact3dc.
- [Source-main37649463353](https://github.com/chenhaoxiang/pi-vista/actions/runs/37649463353), actual910306d.

The Driver-posted `pi-vista-source-review` is a source record, not a trusted App
receipt or owner evidence. No repository protection/required-check policy changed.

## Isolated actual-main acceptance

A new worktree from fetched actual main910306d ran provided Node20 full source
and actual consumer gates with no preseeded dependencies. Ignored local reports:

- `tmp/release-contract/node20-G4Gbn8/report.json`: actual provided executable.
- `tmp/release-contract/source-LQoI3D/report.json`:834 actual native cases.
- `tmp/release-contract/consumer-zdCj6v/report.json`:11 tarballs/18 exports/strict/bin.
- Additional actual retained `consumer-EG25Db` and its
  `isolated consumer/receipt-proof-MMt8uq/report.json`: actual Node20.20.2
  fresh producer/reader PIDs**19587/19672**,3 synthetic receipts, current binding/
  proof/copy/expiry/publication checks, synthetic ingest/readback1 each.

Node20 executable SHA256
`38de4fc456c0c439bac48c727d378f749abb4e31f4116703bb1ee9a746fccbb6` matched.
Checksum/HTTPS provenance is not publisher signing; offline cache-backed installs
are not fresh-registry availability. Root lint remains a no-op, not coverage.

## Still unaccepted

Actual compatible owner producers/signing/key custody/provenance and truthful
coverage; durable revocation/key rotation; true IPC/foreign-owner isolation;
actual Hindsight bank/service durability; default Pi/CLI wiring; executable
repair/replay/model-quality trials; registry publication/deployment.

Cooperating-current-user native POSIX/realm/clock/filesystem is trusted. Metadata
samples are point-in-time, not hostile-host/ACL/NFS jail, atomic three-receipt
transaction or hard OS/CPU/scheduler preemption. Transient undetected changes and
key/host compromise remain owner responsibilities. File syntax/signature-shaped
bytes are not authentication; signature authentication is not claim correctness
or current safety/merge/release permission. Stored/copied flags restore no proof.

Contracts: [files](../receipt-files.md), [evidence](../authoritative-evidence.md),
[learning](../learning.md), [phase](../PHASES.md),
[owner change](../../openspec/changes/receipt-file-reader/proposal.md).
