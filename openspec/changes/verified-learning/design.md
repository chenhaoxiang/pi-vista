# Design

The authoritative verifier uses host-pinned Ed25519 public keys, per-source kinds,
required gate checks/test suites, closed canonical payloads, content digests,
run/repo/source/policy/environment bindings and bounded freshness. Missing,
failed, override, incomplete, malformed, wrong-key, stale or mismatched receipts
fail closed. No private key or arbitrary artifact reader is supplied.

Verified evidence is an opaque in-process capability registered in a WeakMap;
copying a report or setting a Boolean cannot mint it. Promotion snapshots safe
symbolic plans, renders a dry-run document, and confirms the exact preview digest
before re-reading all evidence and invoking an explicitly injected sink. Transport
failures/timeouts cannot mark an experience trusted. No default network client.

Failure/replay and retrieval are deterministic offline views, not executable
shell plans. Every output says authorization none. Shadow models keep their
owner-defined eligibility false and cannot become a learning-verification source.

All validation uses synthetic disposable fixtures. CI runs the same source gates
and fresh packed-consumer compilation; release remains a separate owner action.
