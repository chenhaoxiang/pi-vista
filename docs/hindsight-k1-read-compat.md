---
doc_type: spec
project: workspace
owner_repository: chenhaoxiang/pi-vista
status: active
truth_mode: maintained
created: 2026-10-13
verified: 2026-10-13
---

# Explicit current Hindsight read compatibility for K1

Owner selected a current-service READ compatibility scope after the accepted
0.10.2 reader refused. First live metadata observation0.10.3 was preserved; later
consecutive live API reads reported1.0.0, matching the installed
`hindsight-api` distribution1.0.0. Owner then explicitly selected API1.0.0 /
distribution1.0.0. Old0.10.2 source/runtime evidence and original0.10.3/failed
observations remain historical; none is relabelled as current1.0.0.

## Contract

`stage6-k1-service-compat.mjs` is an explicit opt-in read contract
`api-1.0.0-dist-1.0.0`, not a new default/library compatibility guess.
The actual runner CLI may select it with `--service-contract=...`; absent selection
still uses the unchanged accepted0.10.2 checks. Unknown selection/version refuses.

The private fingerprint fixes endpoint/bank, independent API metadata version,
distribution name/version/METADATA SHA256, and five public source files with exact
Git blob hashes. The reader rehashes bounded FD bytes, rejects file drift/symlinks,
refuses malformed/unsafe/private fingerprint files, and projects only relative
file hashes—not paths or credentials. File fingerprinting does not attest loaded
process bytes, vendor authenticity, Owner identity or execution permission.

READ API shape matches existing public guidance-store requirements. The unchanged
store has actually GET-read the one accepted original document on API1.0.0,
canonical content digest `ead26d1b...49d55`, subject source `846b9a0...8216f3`,
repo/policy/env and historical flags exact. The test bank config still reported
chunks/observationsfalse. No retain/recall/write/service restart/config change,
no old sample reprocessing, and no model calls were made by this compatibility
check. It is not fresh current proof or K1 quality; LOCAL still imports new
identities and obtains fresh process-local verifier evidence before compiled use.

## Candidate verification

Fixture tests cover distinct API/distribution labels, fixed file rehashing,
wrong pin/bank/file/authority refusal, private file boundaries and old0.10.2
reader rejecting the newAPI. Real source-bound field/hash/API/original-read
projections remain test-owned under this worktree tmp/compat.
Source/review/CI/main, actual K1/window and release are separate acceptance layers.
