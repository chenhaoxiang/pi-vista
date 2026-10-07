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

# Explicit Hindsight original-document store

`@pi-vista/learning/hindsight` exports opt-in `createHindsightStore`: one concrete
`LearningSink` / `HindsightRecallPort` seam, not a default memory client or a
current-proof database. Import/factory construction performs no FS/network I/O.
The 11-package inventory, CLI, protocol, evidence and live learning admission
remain unchanged. The root entrypoint never imports this I/O addon; only the
explicit `./hindsight` export map entry opts in. Original root boundary assertions
are preserved, plus a recursive root-import graph regression. There is no Pi hook,
automatic promotion, bank creation/deletion, upload, page ingestion, signing,
lifecycle feed, executable replay or environment lookup.

```ts
import { createLearningLibrary, createPortableRecall } from "@pi-vista/learning";
import { createHindsightStore } from "@pi-vista/learning/hindsight";
const store = createHindsightStore({
  endpoint: explicitHttpsOrigin,
  banks: { "reviewed-bank-alias": explicitActualBankId },
  journal_directory: existingHostPrivatePosixDirectory,
  bearer_token: explicitHostCredential, // optional; omit rather than undefined
  timeout_ms: 1000,                    // optional integer 1–10000
  max_response_bytes: 262144,           // optional integer 1–1048576
});
const library = createLearningLibrary({ verifier, sink: store.sink });
const recall = createPortableRecall({ origins, now, max_age_ms, port: store.port });
// Existing exact preview confirmation/current evidence checks are still required.
// Explicit recovery observes persistence only; it cannot recreate a live handle.
const observation = await store.reconcile(exactSafeRequest, hostAbortSignal);
// observation: { state: "matched" | "not-confirmed", authorization: "none", executable: false }
```

## Configuration and privacy

Endpoint is a canonical HTTPS **origin only** (optional trailing slash), not an
API-prefix URL. Userinfo, query, fragment, noncanonical URL spellings and redirects
reject. Explicit `allow_loopback_http: true` permits only literal `127.0.0.1` or
`[::1]` HTTP for synthetic fixtures, not DNS localhost or remote HTTP. Bank aliases
and actual IDs use the existing safe-label grammar, with 1–64 distinct mappings;
duplicate actual IDs reject. No default endpoint, bank, token, home/config lookup,
generic headers, cookies or untrusted URLs are accepted. Native fetch uses fixed
headers, `redirect: error`, `credentials: omit` and no referrer. Its host/runtime
implementation is trusted; this is not a network sandbox against a replaced fetch
or host dispatcher. Config and inputs are snapshotted before the first await;
Proxies/accessors/custom prototypes/unknown/undefined fields reject without hooks.
Returned APIs are frozen and do not expose config/endpoint/token/journal paths.

Errors are value-free `LearningError`: config/input errors use `invalid-config` /
`invalid-input`; operational failures use `sink-failed`, `sink-timeout` or
`sink-mismatch`. Original HTTP/FS/source errors, body, URL, credential and stack
are not returned. Reconciliation collapses operational uncertainty to
`not-confirmed`; invalid input still rejects. HTTP waits/streamed response bytes
are bounded and abortable, with no hidden retry. Synchronous validation, scheduler
delays and filesystem open/write/sync waits cannot be preempted; abort/deadline is
rechecked before subsequent effects, including immediately after awaited root
preflight and before exclusive intent/completion creation. A cancellation already
visible in that pre-create window does not consume an attempt. Cancellation
becoming visible after an issued open can still leave an uncertain claim; that
claim is never reset. An issued remote write cannot be undone.
[Cancelling before create: original finding and correction](handoff/2026-10-07-hindsight-store-cancellation-fix.md).

## Pinned API and exact original data

Contract: vectorize-io/hindsight `ea5ab3034ceb1fed601950ec8996c69363c0b0b6`, static
OpenAPI HTTP **0.10.2**. Its `DocumentResponse.original_text` is required for success;
service documentation about extracted facts is not a substitute for this field.

- Validate the whole closed `IngestRequest` before any effect: safe canonical v1
  learning/correction metadata or a safe portable archive envelope, exact
  title/tags/content hash and `learning-` / `archive-` canonical preview identity.
  Reuse the learning observation/failure/receipt/archive boundaries. Transporting
  historical claims does **not** authenticate signatures or current provenance.
- Store a closed canonical wrapper containing the **exact** original request,
  opaque target fingerprint and deterministic namespaced document ID (90 ASCII
  characters). Target binds canonical endpoint, alias and actual bank; token is
  excluded. Original signed archive content/title/tags remain byte-exact inside.
- `POST /v1/default/banks/{bank_id}/memories`: one item, exact wrapper content,
  explicit `document_id`, `timestamp: unset`, `update_mode: replace`, item-level
  original plus fixed scoped tags, `async: false`. No deprecated `document_tags`
  or `operation_id`; upstream synchronous retain offers no deduplication promise.
- Validate ack success/bank/items_count/async, then independently
  `GET /v1/default/banks/{bank_id}/documents/{document_id}` and match the decoded
  whole request. Null/missing/substituted original, wrong bank/ID/target or only a
  hash echo rejects. `sink.readback` always performs another fresh original GET.
- Recall posts only canonical safe task/binding labels with fixed scoped archive
  tags, `all_strict`, low budget, 4096 max_tokens, trace false and disabled extra
  inclusions. At most 64 result entries; project only own-target document refs,
  deduplicate and sort IDs. Fact text/rank/metadata/trace never becomes history.
  Missing/null or external-namespace refs are excluded; malformed/uncertain reads
  reject, not partial success. Port reads only original safe signed documents;
  unchanged portable recall independently authenticates origin/signature/scope.

## Local attempt protection, not distributed exactly-once

Host supplies an **existing** absolute private local POSIX directory: owner UID,
mode 0700, no symlink components. No ancestor/root creation occurs. Intent and
completion files must be regular single-link owner files, mode 0600, bounded and
exact; no-follow exclusive creation refuses symlinks and partial/corrupt records.
The filename binds request identity; the immutable intent contains the safe
wrapper, never raw target configuration or errors. File sync and directory sync
must finish **before any retain**. A separate immutable completion binds the intent
hash and is synced only after exact original readback; it is never remote proof.

Only the exclusive new intent creator may retain, and only after a definitive
original GET 404. Exact preexisting original means no POST; mismatched original
refuses. Any existing intent—even with no remote document, dead owner, lost ack,
clock/timeout expiry, failed or partial completion—permits **no second POST**.
Restart/duplicates only fresh-read and match, then may persist completion.
`reconcile` requires a valid existing intent and is always remote read-only; it
never retries failed writes, deletes/resets claims, takes over leases, restores
proofs or creates live trust. There is no TTL, cleanup, rollback or reset API.

Cooperating processes must share the root and target scope. A changed target
cannot reuse an intent. Host administrators/external namespace writers, honest
fetch/filesystem behavior and actual power-loss sync guarantees remain assumptions.
This is not CAS, a distributed transaction, NFS coordination or a hostile-filesystem
jail. Durable signed lifecycle, revocation/key custody, actual Hindsight service /
version/bank/credential acceptance and owner integration remain separate work.

## Engineering evidence boundaries

Additive tests use actual random-port loopback HTTP and invocation-created fresh
Node processes, including concurrent claim, claimed-unsent crash, remote-commit
crash/lost ack, partial/corrupt records and historical-only restart import. Original
assertion files are unchanged. Source/installed-tarball Node20/26 evidence and
retained early failures are recorded in the implementation handoff.
[PR #14](https://github.com/chenhaoxiang/pi-vista/pull/14) source full review plus
retained cancellation recheck, exact-head Ubuntu Node20/22/26 CI and normal
remote merge/readback are complete. [Source closeout](handoff/2026-10-07-hindsight-store-source-closeout.md)
binds actual748-case/11-tarball/17-export and installed HTTP/restart evidence.
Publication, actual live-service/durability/owner acceptance and default Pi
activation remain pending. Root lint is a no-op; cache-backed installation is
not fresh registry acceptance.

See [learning](learning.md), [portable recall](portable-recall.md),
[architecture](architecture.md) and [phase plan](PHASES.md).
