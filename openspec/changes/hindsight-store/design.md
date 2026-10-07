---
doc_type: plan
project: workspace
owner_repository: chenhaoxiang/pi-vista
status: active
truth_mode: maintained
created: 2026-10-07
verified: 2026-10-07
---

# Design and invariants

## Upstream source
Pin vectorize-io/hindsight at ea5ab3034ceb1fed601950ec8996c69363c0b0b6. Its hindsight-docs/static/openapi.json declares HTTP API 0.10.2; local exact source manifests and selected schemas are retained in tmp/hindsight-api/. Public original-document documentation: hindsight-docs/docs/developer/api/documents.mdx at that same pin. Retain is POST /v1/default/banks/{bank_id}/memories, original read is GET /documents/{document_id}, candidate recall is POST /memories/recall. Synchronous operation_id does not provide deduplication; repeated document_id retain replaces content and may repeat extraction/spend.

## Private host configuration
Require explicit endpoint, safe bank-alias to actual-bank-ID mapping and an existing private local journal root. HTTPS only except explicitly permitted exact loopback HTTP for local fixtures. No environment/config/credential discovery, generic header passthrough, cookies, redirects, bank creation or network on module import. Optional bearer credential stays in private closure and never enters protocols, archives, journal, errors or reports. Source input is own-data snapshotted with fixed errors; timeouts, aborts and response bytes are bounded.

## Exact document envelope
Use a closed canonical adapter envelope containing the exact bounded original safe learning/archive request. Validate schema/canonical content, title/tag/hash and request preview/idempotency relationship before any side effect; refuse arbitrary content. Preserve original signed archive bytes. The deterministic namespaced document ID is derived from the validated request identity; alias/actual bank/endpoint scope cannot be silently redirected. Retain uses one explicit item, async:false, item-level scoped tags, timestamp:unset and replace (never append). Ack alone is not success: GET original_text must independently decode and exactly match the whole reviewed request. Generated fact text, pages, trace, score and flags are candidate metadata only and never imported as original history.

## Durable local attempt invariant
Existing host-supplied private POSIX directory; exclusive no-follow intent file creation and file/directory sync precede any POST. Store only safe bounded request and target fingerprint, never bearer/endpoint/raw failures. Existing claims (including an uncertain owner/crash) never authorize another POST. A duplicate can only re-read the deterministic original document; exact match permits transport receipt, absent/mismatched/partial/invalid state stays refused. An immutable completion record is written after exact original readback. Reconciliation is explicitly read-only and cannot mint live handles or owner proofs. No TTL-based lock stealing, lease reset, overwrite, hidden retry or journal deletion API.

A claim creation failure/partial write remains fail-closed. Parallel cooperating processes share one journal root and target scope. This is not a distributed transaction, NFS lock, universal malicious-filesystem sandbox or server compare-and-swap; administrator/external namespace writers and power-loss/filesystem guarantees remain host assumptions. No remote write is rolled back or promised exactly-once by the service. Durable lifecycle storage/revocation discovery remains a separate future contract.

## Acceptance
Actual synthetic HTTP requests conform to pinned API; producer/consumer run in separate Node processes, with no inherited WeakMaps. Verify exact upload/readback and historical-only recall; scope/bank/tampering/privacy rejection; concurrent single writer, lost ack, killed writer after intent/after remote commit, corrupt/partial marker, readonly reconciliation, symlink refusal, abort/oversize/redirect/auth failure handling. Retain all 659 prior genuine cases, Node20/26 source and installed tarball consumer gates. Fresh full same-model review must inspect exact final committed range and actual retained artifacts; reviewers without execution tools do not claim independent test execution.
