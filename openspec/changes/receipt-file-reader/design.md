---
doc_type: plan
project: workspace
owner_repository: chenhaoxiang/pi-vista
status: active
truth_mode: maintained
created: 2026-10-07
verified: 2026-10-07
---

# Reader invariants and owner gaps

## No normalization into authority
Accept only the existing complete v1 {payload,content_digest,signature} envelope. Transport does not add run/repo/source/policy/environment/time/details, convert owner overrides to PASS, synthesize guard coverage/test totals or re-sign. Legacy audit flags, observational adapters, candidate asset envelopes and synthetic IPC responses are unsupported as current receipts. Actual compatible producers and public-key provenance remain MISSING until separately evidenced; source/fixture acceptance is not live owner integration.

## Explicit separate addon
Expose factory/types only at @pi-vista/evidence/files, not root eager exports. Construct frozen EvidenceSource[] with private host-root/file mapping and original public pins; no default directory/environment/config/credential discovery, home events/approvals search, publisher/writer, network/IPC or signing. Preserve unchanged source key/freshness/check/suite requirements and opaque verifier/learning handles.

## Narrow local file contract
An existing canonical absolute private POSIX root owned by the current uid (0700), configured distinct safe subjects/file IDs and issuer/kind/public pins. Fixed file names <file_id>.receipt.json, no caller/runtime path parameters. Canonical UTF-8 v1 JSON envelope, optionally one terminal LF, with no BOM/duplicate/noncanonical/unknown/trailing/multiple records. This explicit encoding constraint is a file contract, not a claim that arbitrary owner output already conforms. Require the payload already equal to evidenceMessage normalization; do not change signed fields. Bytes/hash/signature structure are bounded and snapshotted; cryptographic trust/current truth still requires unchanged createEvidenceVerifier.

Before reads, reject malformed/private/mixed public pins and unsafe config. Use no-follow/nonblocking read-only opens, private current-owner regular single-link files, bounded bytes and total elapsed deadline/abort checks after waits and before subsequent I/O. Root/file FD/stat and path samples must detect observed substitution/size/mtime/ctime/mode changes; allow a new valid published file on a later independent read, but reject an observed in-flight replacement/mutation. No locks/chmod/marker removal/repair/touch/create/cleanup by runtime. This is point-in-time/cooperative local POSIX observation, not atomic three-receipt transaction, distributed freshness/revocation or hostile-host sandbox.

## Errors and output
Fixed value-free EvidenceError codes; no source bodies/paths/keys/original errors in report/stack. Native promise callback receives native AbortSignal; arbitrary proxy/getter/thenable config rejected. Factory/module import causes no I/O. Returned callback supplies only detached exact envelope to the existing verifier, not a signed-owner success flag or proof. Fresh verify/revalidate always reopens; copied/serialized/foreign proof identity and expiry remain unchanged.

## Acceptance
Retain all748 original cases/assertions; add native file/signature/five-binding/expiry/check/coverage failures, legacy rejection, noncanonical/duplicate/BOM/oversized/truncated/mutation/symlink/FIFO/hardlink/permission/abort/timeout checks, publication replacement and independent process/installed public-subpath validation. Show valid synthetic signed sources -> current proof -> explicit confirmed safe learning sink path, no real producer/live bank. Public package inventory stays11; export count18. Original helpers/tests/gates do not become weaker. Independent same-model source review, Node20/26 real consumers and exact-head/main hostedCI/normalmerge/doc-loop required.
