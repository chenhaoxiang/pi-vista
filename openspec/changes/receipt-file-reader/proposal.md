---
doc_type: plan
project: workspace
owner_repository: chenhaoxiang/pi-vista
status: active
truth_mode: maintained
created: 2026-10-07
verified: 2026-10-07
---

# Explicit receipt file consumer

## Why
The verifier requires fresh, complete, owner-signed v1 gate/test/guard receipts, but currently has only injected callbacks. Read-only owner-contract inspection confirms that legacy audit/observation output and synthetic transport tickets cannot satisfy that contract. A consumer must preserve this gap, not supply missing fields or re-sign owner claims.

## What changes
Add only an explicit @pi-vista/evidence/files addon providing bounded private local POSIX receipt-file EvidenceSource callbacks. The unchanged evidence verifier continues to own signature/key/freshness/details/five-binding checks and private proof identities. Add public v1-file encoding/compatibility requirements and negative legacy cases; no raw owner code/data is copied into this public repository.

## Scope
One additive source seam. Root verifier/API, original assertions, all other packages, dependencies/lock/gate/CI unchanged. One new export-map entry and test-fixture exclusion if needed. Native actual FS, separate processes and exact installed-consumer tests use synthetic keys/data only. Real producer/signing/key custody, IPC service, events/approvals, policy/threshold/model/approval/lock changes and default activation remain outside scope.
