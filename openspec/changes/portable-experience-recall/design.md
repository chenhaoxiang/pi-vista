---
doc_type: plan
project: workspace
owner_repository: chenhaoxiang/pi-vista
status: active
truth_mode: maintained
created: 2026-10-07
verified: 2026-10-07
---

# Trust split and implementation seam

## One tightly coupled learning seam
Serialization must start from a current authentic verified/trusted view in the existing private lifecycle/proof maps. Signed archive provenance, historical decoding and Hindsight transport projection must share that bounded schema; splitting the private capability seam would create an artificial unsafe raw-object bridge. One isolated writer owns the learning package and its direct contracts; doc-only closeout is an independent read-only lane.

## Historical authenticity is not current admission
An archive-origin signature authenticates a configured producer's immutable sanitized claim, not semantic correctness, remote durability or current execution permission. Histories may outlive original gate receipt expiry, but they cannot become live VerifiedEvidence/current verified/trusted handles. Every imported historical view/context explicitly says historical-authenticated, current-verification-not-checked and authorization none. Unknown/revoked issuers, bad canonical signatures/digests, bank/repo/scope mismatches and unsupported shapes reject. Current execution and promotion still require fresh checks/gate/test/guard provenance from existing APIs; no clock backdating or expiry relaxation.

## Explicit ports and safety
Signing callbacks/public-key pins, bank aliases and Hindsight query/read/ingest/readback ports are explicitly supplied by trusted host code; no default service/client/env/secret discovery. Only exact safe source documents, not generated knowledge-page narratives or status-labelled records, can import. Keep all own-data bounds, privacy, immutable snapshots, deadlines/abort/late rejection and fixed safe errors. Confirm exact preview before memory writes, bind idempotency/receipt/readback and preserve uncertain-write semantics.

Revocation/deprecation must come from pinned/signed producer state or explicit trusted host policy, never arbitrary stored flags. Missing/incomplete lifecycle coverage cannot be labelled current active. Durable indexing/transport truth and atomicity remain host responsibilities; expose them honestly and test file-backed synthetic ports across truly separate processes.

## Implemented API and conservative policy choices

- Optional `LearningConfig.archive` supplies a scoped archive-origin public pin,
  native-promise signer and trusted clock. `prepareArchive` re-reads unchanged
  current owner evidence before signing; `commitArchive` revalidates again and
  reuses the existing sink validators/deadline/confirmation/one-shot pattern.
  Upload returns host-readback-matched observation, never a live trust transition.
- Closed schema=1 payload/envelope share the existing observation/failure decoder.
  The exact whole signed document, bank, metadata and preview identity are bound.
  Private source snapshots are null-prototype; no raw-object producer bridge exists.
- `createPortableRecall` accepts explicit historical public pins/key intervals,
  revocation and required bounded age policy. An ended key interval can authenticate
  claims signed inside it only under explicit pinned-history trust; revoked pins
  reject all history. No distributed PKI or automatic discovery is introduced.
- Optional fresh lifecycle policy is explicit trusted host input, bound to the
  archive origin/scope/digest. Withdrawn states reject; absent coverage says
  not-checked, and active projects only eligible-at-policy-check. A signed durable
  lifecycle feed remains unimplemented; document flags cannot substitute for it.
- Query returns bounded opaque refs; exact read validates the original document.
  Wrong-bank/duplicate refs are excluded before reads; uncertain reads reject the
  entire recall. Deterministic selection excludes all four non-run binding drift,
  and whole-entry character context is non-executing/history-only.
- `importHistorical` requires private authenticated historical identity and explicit
  new ID/run/current same-binding context. Only observed script/step metadata and
  safe original-origin references survive; old-run failure/model measurements do
  not become measurements of the new run. Only fresh normal proof can verify it.

Public contract and residual host responsibilities: [portable recall guide](../../../docs/portable-recall.md).
These are source choices within the approved historical seam, not service activation,
semantic truth, current authorization, independent review or operational acceptance.
