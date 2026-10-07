---
doc_type: plan
project: workspace
owner_repository: chenhaoxiang/pi-vista
status: active
truth_mode: maintained
created: 2026-10-07
verified: 2026-10-07
---

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

## Implemented seams and roadmap limits

The locally integrated source includes 11 public packages. Evidence, learning and
shadow are additive; original eight runtime sources/test assertions are unchanged.
Approved existing-manifest changes only make scripts portable and exclude compiled
tests from tarballs. Root integration preserves all suites, builds dependencies
before consumers, uses deterministic Node20 integration file enumeration, and
regenerates the lock offline without new external runtime dependencies.

Learning lifecycle/proof/plan/selection identities and promotion deduplication are
bounded and **process-local**. `retrieve` selects only fresh minted handles, not
raw/serialized Hindsight documents, and performs no evidence/remote-memory reads.
Context is model-agnostic script/step metadata with provenance and whole-entry
character bounds, not token bounds. Offline fixture selection/coverage is not
external model capability. Cross-run Hindsight recall across process lifetimes,
durable storage/import, remote revocation and automatic Pi injection stay pending.
Recorded replay/comparison cannot execute tools or resolve repairs.

Shadow accepts only the explicit `shadow-observation/1` owner-normalized schema,
not raw owner wire objects. False human/training/promotion flags and non-positive
outcomes are preserved. Synthetic asset/isolation refs are not real-input proof;
no owner normalization/live activation or model selection is implemented.

All validation uses synthetic disposable keys, receipts and documents. The new
public-import integration covers signed evidence, candidate verification, offline
preview, confirmed in-memory ingest/readback, verified/trusted retrieval/context,
non-executing replay and shadow->core->unchanged CLI. Unsigned/copy/stale/binding/
receipt-hash drift/readback mismatch cases refuse trust. A hermetic child receives
no parent environment inputs and denies network APIs before public imports;
without an injected sink, confirmation is sink-unavailable, not a default write.

The generic source/actual packed-consumer gates cover all 11 packages and locked
strict consumer TypeScript on actual local Node20. CI is a pinned least-privilege
**definition**, not an executed hosted receipt. Independent exact full-range
review, normal remote source merge and release/operational acceptance remain
parent-controlled pending gates; same-model local checks cannot close them.
