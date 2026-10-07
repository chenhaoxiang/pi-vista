---
doc_type: guide
project: workspace
owner_repository: chenhaoxiang/pi-vista
status: active
truth_mode: maintained
created: 2026-10-07
verified: 2026-10-07
ssot: true
---

# Authoritative evidence: opt-in verification

The new @pi-vista/evidence package implements inherited Task #65 as an explicit
trusted-host API. It does not hook existing owner systems or turn legacy audit
records into authenticated receipts. Existing gate adapter flags, test log
summaries and shadow row proofs remain claims until their owner explicitly
produces this contract through an authorized provenance boundary.

## Trust roots and input

createEvidenceVerifier requires sources with unique symbolic subjects, pinned
issuer/kind and an Ed25519 **public** PEM, plus trusted native-promise read
callbacks. There is no default file resolver, HTTP client or signing API.
No private PEM is accepted. The separate opt-in
[`@pi-vista/evidence/files`](receipt-files.md) provides fixed private POSIX file
callbacks under an explicit canonical v1 encoding; the root API/verifier stays
unchanged. Actual compatible owner producers/public-key provenance remain
**MISSING / not accepted**; audit/observation/manifest/ticket/App flags cannot
upgrade to current evidence. The host also pins gate_version, gate_config_digest,
nonempty required gate_checks/test_suites, a trusted now clock, max_age_ms
(1–86,400,000, default 600,000) and timeout_ms (1–10,000, default 1,000).
The factory snapshots configuration; later caller mutation cannot redirect it.

Each receipt is a closed object: payload, content_digest and base64 signature.
The payload contains schema=1, kind, issuer, run_id, repo, source_sha,
policy_version, env_fingerprint, receipt_ref, issued_at, expires_at and details.
evidenceMessage(payload) returns the validated, sorted-key canonical signing
message. SHA-256 of that exact message is content_digest; Ed25519 signs those
same UTF-8 bytes. Both are verified. Source SHA is 40/64 hex, digest 64 hex.

Payload details:
- gate: verdict, gate_version, config_digest and unique name/outcome checks.
  Only pass and all checks pass are accepted; required checks and host version/
  config pins must match. Owner overrides are **not** reusable gate PASS.
- test: unique suites with name/total/passed/failed/skipped/cancelled. Every
  suite must have positive total and all counts reconcile; every test passes,
  zero skipped/cancelled/failed, and every required suite is present.
- guard: coverage complete, positive event_count and blocked=0. An empty or
  partial log cannot prove clean full-run coverage. The owner remains responsible
  for truthfully attesting coverage; a valid signature is not omniscience.

All five expected bindings must match. Unknown/mismatched aliases reject before
readers. Future issue times, expiry, stale age and overlong validity reject.
Producers must independently establish actual source/test/gate truth before
signing: a signature authenticates the pinned issuer and immutable claim, not
correctness of that issuer's tests, private-key security or operational admission.
Keys, freshness, requirements and source provenance remain host responsibilities.
No production keys or actual source receipts were accessed during validation.

## Opaque verification and probes

verify(expected, { gate, test, guard }) reads all three sources anew and returns
a frozen authority-bound handle with authorization=none, safe bindings and
receipt summaries. Private keys, signature bytes, errors, logs and source bodies
are never projected. A WeakMap records provenance inside the exact verifier:
copying/serializing a view, constructing one with flags, or using another verifier
cannot mint a valid handle. isCurrent checks both provenance/bindings and expiry.
revalidate re-reads all sources and requires the same receipt digests; it never
reuses a cached successful read.

createEvidenceCheckRegistry(verifier) returns a fresh base registry containing
receipt_present (gate), test_passed (test) and custom:evidence/guard-clean.
Each takes exactly subject plus the five binding keys as safe symbolic params.
Unknown source, wrong kind, wrong schema/signature/digest/binding, incomplete
proof, reader error/cancellation/timeout always fail hard, including WARN.
The returned CheckRegistry report remains predicate-only/authorization=none;
it is not an opaque verified handle or permission for promotion/execution.
Other base/local predicates are neither replaced nor changed.

## Closed safety boundary and limits

Ordinary/null-prototype own-data records only: accessors, Proxies (including
revoked), custom prototypes, symbols, unknown/undefined fields and sparse or
custom arrays reject without invoking their traps/getters/coercion hooks.
Sources <=64; required names/checks/suites <=32 each. Labels are <=128 ASCII
symbolic characters with conservative known-credential/path/shell exclusions.
Counts are safe integers <=1,000,000,000. Keys are host-private <=4,096 chars.
Schema v1 is explicit; unknown versions are rejected, not treated as trusted.

Reader promises are bounded with AbortSignal and consumed late rejection. This
is not a hard synchronous/CPU/process sandbox and cannot undo reader effects.
Readers and clock are explicitly trusted host code. Receipt reads are sequential
and point-in-time, not atomic owner snapshots, remote freshness, a revocation
service or universal secret detection. No background polling, hidden retry,
owner configuration change, merge, publication, release, repair or execution.

## Validation boundary

Synthetic generated Ed25519 keys and typed in-memory owner mocks exercise all
three success paths and signed/unsigned/forged/stale/incomplete/mismatched paths,
obsolete gate pins, hostile descriptors, mutation isolation, native transport
failures, probe schemas and safe errors. The existing eight package runtime
sources and assertions remain untouched. Baseline 292 tests and the initial
40 evidence tests pass on the recorded local Node toolchain. These are offline
source tests, not real owner integration or product Hindsight promotion.

Maintained dependencies: [checks](check-functions.md), [local probes](local-check-probes.md),
[architecture](architecture.md), [phase plan](PHASES.md). The full continuation
spec is [verified-learning](../openspec/changes/verified-learning/proposal.md).
