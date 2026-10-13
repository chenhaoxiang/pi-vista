---
doc_type: reference
project: workspace
owner_repository: chenhaoxiang/pi-vista
status: completed
truth_mode: snapshot
created: 2026-10-13
verified: 2026-10-13
---

# Actual K1 sanitized evidence

`actual-pilot.json` is a value-preserving safe subset of the one operator
report, SHA256 `3e9e3bce634e39c3b450f560c5700af87d39bb2acf76d9f6b60427b1600c43c8`.
Bank counters are renamed from `*_calls` to `*_requests`; the projection omits
raw runner failure/phase and nested pilot status fields. Service fingerprint is a projection with no host filesystem paths; it retains only distribution-relative file names and digests. It contains strict outcome rows, Usage aggregates, profile/provenance digests and
counters, not raw prompts/model responses, credentials, command strings, paths,
portable proof, permission or executable guidance. Source/harness identity,
metadata-only receipt and measured quality aggregation are separate fields.

The original is preserved privately at the owned actual-run worktree
`stage6-k1-actual-run-20261013-01a120e4/tmp/actual/actual-k1.json` and the runner's
own `tmp/k1-actual/run-*/report.json`; no replay or second model window occurred.
The actual fixture task scope is four metadata cases, one runtime window. This
is not a vendor-authenticated trace, independent billing or generalized ROI.
