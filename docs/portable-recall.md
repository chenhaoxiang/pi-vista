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

# Portable signed experience: history, not current admission

`@pi-vista/learning` adds an opt-in source seam for inherited #16: safe signed
archives, explicit Hindsight **ports**, authentication after a process restart,
character-bounded historical script/step context and observed-only import.
It extends the existing library; it does not add another execution, safety or
model-routing system. There is no default FS/network/HTTP/MCP client, bank,
credential/environment lookup, Pi hook, execution, replay or context injection.

**The trust split is mandatory:**

| Data/capability | Meaning | Cannot establish |
| --- | --- | --- |
| Current `VerifiedEvidence` / learning handle | Exact in-process provenance, current owner receipt checks | Execution/merge permission or serialized authority |
| Archive-origin signature | Pinned issuer's exact safe historical claim | Claim correctness, exact real signing time, current receipt validity or current safety admission |
| `HistoricalExperience` | `historical-authenticated`, `signature_checked: true`, `current_verification: not-checked` | Live `verified` / `trusted`, a `VerifiedEvidence` or compatibility with other source/policy/environment bindings |
| Observed-only import | New ID/run/current context plus preserved safe origin reference | Old proof restoration or stored status selecting lifecycle state |
| Host ingest/readback | Exact observed round trip through trusted callbacks | Independent service durability, atomicity or owner authorization |

Every archive, historical view, selection, context, import and upload carries
**authorization: none**; portable views also carry **executable: false**.
A historical record can outlive its original receipts only as historical guidance.
Current verification still needs a genuinely new run, truthful actual conditions
and fresh gate/test/guard evidence through the unchanged evidence API. Neither an
old clock, a copied flag, an evidence authority key nor a memory tag restores it.

## Producer: exact current state, separate origin role

```ts
import { createLearningLibrary } from "@pi-vista/learning";

const library = createLearningLibrary({
  verifier, // exact createEvidenceVerifier() identity, unchanged live contract
  sink,     // optional existing explicit ingest + exact readback callbacks
  archive: {
    origin: {
      role: "archive-origin", issuer: "experience-producer", key_id: "origin-v1",
      repo: "repo-alias", bank: "bank-alias", public_key: pinnedEd25519PublicPem,
      not_before: historicalKeyStart, not_after: historicalKeyEnd,
      trust: "pinned-history",
    },
    now: trustedClock,
    sign: trustedNativePromiseSigner,
  },
  timeout_ms: 1000,
});
const archive = await library.prepareArchive(currentVerifiedOrTrusted, "bank-alias");
// Review archive.origin, archive.bank, exact document.title/content/tags,
// archive.archive_digest, preview_digest and idempotency_key.
const upload = await library.commitArchive(archive, {
  preview_digest: explicitlyConfirmedPreviewDigest,
});
// upload.persistence === "host-readback-matched"; authorization === "none".
// Archiving does NOT transition the source handle to trusted.
```

`prepareArchive` accepts only the exact library's current authentic fresh
`verified` or `trusted` handle. Raw/copy/serialized/foreign/status-only,
observed/candidate, obsolete/terminal and expired handles reject. It re-reads and
revalidates the **same signed owner receipt digests before signing**, then snapshots
only the private safe observation, script, steps, failure analysis and receipt
summaries. It checks lifecycle/proof freshness again after signing. No owner
receipt/log/artifact bodies, receipt signatures, model prose or raw session
content enter the archive. Imported historical references are retained on live
views, not recursively embedded in later archives; a later archive represents
that new run's independently checked claim.

The separate archive-origin pin is closed: `role`, `issuer`, `key_id`, `repo`,
`bank`, `public_key`, `not_before`, `not_after`, `trust`. Keys must be canonical
Ed25519 **public** PEMs; no private PEM or key-generation default is accepted.
Pins/callbacks/keys stay private and are detached from caller mutation. Bank/repo
must match the source observation and pin. Producer clocks must not go backward
in this instance; the archive time must be at least the freshly verified proof's
time, inside the pinned key interval and before every original receipt expiry.
This detects local inconsistencies, not a malicious host clock or actual wall time.

The signer receives only a frozen closed `ArchiveSignRequest`:
`role`, `issuer`, `key_id`, `repo`, `bank`, `message`, `content_digest`. It returns
a native promise resolving to exactly `{signature}` (canonical base64, 64-byte
Ed25519 signature). The library verifies that signature with the pinned key over
the **exact canonical message**, not a host success flag. The trusted host owns
key access and signing policy; runtime code never imports a production signing key.

### Exact portable document schema

The sorted-key canonical signing message is the following closed payload:

- `schema: 1`, `purpose: portable-experience-history`, `authorization: none`,
  `executable: false`;
- `origin`: `role: archive-origin`, `issuer`, `key_id`, `repo`, `bank`;
- `archived_at`: nonnegative safe integer (issuer claim, not timestamp proof);
- `source_status_at_archive`: `verified | trusted` (historical claim only);
- `experience`: the exact safe normalized observation, with no live status/proof
  or document ID. Failure analysis is rederived and checked with the same live
  failure/schema boundary;
- `evidence`: exactly ordered gate/test/guard safe summaries, each `kind`,
  `issuer`, `receipt_ref`, `content_digest`, `expires_at`.

SHA-256 of that message is `archive_digest`. Exact document content is canonical
`{payload, content_digest, signature}`. Its title is `Historical skill: <id>` or
`Historical failure: <id>` with one `knowledge:skill` / `knowledge:failure` tag.
The document's `content_digest` hashes this **whole exact envelope**, including
signature. `preview_digest` hashes canonical `{bank, document}`; the identity is
`archive-<preview_digest>`. All envelopes, hashes, titles and tags are checked;
generated knowledge-page prose/summary, reordered/noncanonical JSON, unknown
versions, extra fields and arbitrary status documents reject.

Preparation performs owner reads and the explicit signer callback, **no memory
write**. It is not a no-callback operation like ordinary `preparePromotion`.
Confirmation atomically consumes one archive-upload attempt per experience per
library before awaiting new owner revalidation, existing sink ingest and exact
readback. Copied/foreign plans, wrong confirmations, races and failed/uncertain
writes cannot retry via another preview. Bad confirmation does not consume the
attempt or cause reads. Successful archiving does not consume or replace the
separate live-promotion contract. Source lifecycle/freshness is checked after each
await; a withdrawn/expired source cannot complete even if a host write happened.
There is no rollback, hidden retry, durable lock or crash reconciliation.
Different timestamps/signatures can change the preview identity. Durable
cross-process deduplication and handling partial writes remain host responsibilities.

## Consumer: pinned public history in a new process

```ts
import { createPortableRecall } from "@pi-vista/learning";

const recall = createPortableRecall({
  origins: [explicitHistoricalPublicPin],
  now: trustedClock,
  max_age_ms: explicitHistoricalAgePolicy,
  port: { query: trustedQuery, read: trustedExactDocumentReader }, // optional
  lifecycle: trustedLifecyclePolicyReader, // optional, never a document flag
});
const selected = await recall.recall({
  bank: "bank-alias", repo: "repo-alias", source_sha: exactCurrentSource,
  policy_version: "policy-v1", env_fingerprint: "env-v1",
  task_type: "metadata-update", limit: 8,
});
const context = recall.compileContext(selected, { max_characters: 8192, max_items: 8 });
// Explicit application consumption only; no automatic model/session injection.
```

This factory needs no old library, old owner key or WeakMap. `authenticate(document,
{repo, bank})` independently validates an exact signed archive with the pinned
public key. `select(histories, query)` operates offline over views authenticated
by this exact recall instance. The public `select` wrapper accepts only these
two data inputs; extra JavaScript arguments are ignored and cannot seed internal
transport rejection counters, retain objects or invoke coercion. `compileContext` accepts only its private selection
identity. Copying/serializing **these views** does not restore capability either;
re-authenticate the original signed document after a restart.

At most 64 unique scoped origin pins are accepted. Unknown issuer/key/scope,
wrong key/role, payload/digest/signature/version mismatch and `trust: revoked`
reject. Pins must explicitly state key intervals and historical trust. A key's
interval can have ended **now** while a signature claimed inside that interval
remains acceptable under `pinned-history`; this is explicit historical acceptance,
not a current active key. Revocation rejects all archives under the pin. There is
no automatic PKI, network revocation discovery or silent grace policy. Rebuild
host configuration when pins/policies change; caller mutation does not redirect it.

`max_age_ms` is required, 1–31,536,000,000 (at most one year), independently of
original receipt expiry. Future archive times and overage reject. Per-instance
detected clock rollback rejects; a fresh process still depends on its truthful
host clock and pin history. A signature cannot prove an exact historical time or
that an issuer's original tests/guard coverage were truthful.

### Hindsight ports and lifecycle policy

A typed host adapter maps a real Hindsight API to these explicit native-promise
callbacks. No real client/config/service is provided:

- `query(HistoricalQuery, signal)` resolves to exactly `{documents}`: at most 64
  opaque `{document_id, bank}` refs. Query fields are bounded metadata bindings
  and a task label, not raw prompts/prose. Semantic search is the host's choice;
  result flags, tags and rankings are not proof.
- `read(ref, signal)` resolves to exactly `{document_id, bank, document}`. Identity
  must match the requested ref; `document` must be the original exact signed safe
  archive. A derived knowledge page, matching hash echo or Boolean does not qualify.
- Wrong-bank refs are excluded **before reads**; duplicate refs are read once.
  Any malformed/uncertain/failed read rejects the whole recall, without partial
  success. There is no ingest on recall and no hidden retry/poll.
- Optional `lifecycle(reference, signal)` is an **explicit trusted host policy**,
  not a memory flag. The reference binds role/issuer/key/repo/bank/archive digest.
  The closed return adds `state`, `checked_at`, `expires_at`, matches that reference,
  and must be current under `max_lifecycle_age_ms` (1–86,400,000, default 600,000).
  `deprecated`, `revoked`, `rejected`, `superseded` reject; `active` is projected
  only as **eligible-at-policy-check**, never current verified/trusted. Without
  coverage, the view explicitly says **lifecycle: not-checked**. Stale coverage
  invalidates selections/imports; re-authentication can obtain a new policy check.

A signed durable lifecycle bulletin/feed is not implemented. An immutable archive
only records its source status at archive time. The explicit host must observe
truthful subsequent withdrawals if needed; omission never implies current active.
This policy port, query/read adapters and durability still need separate real
service/owner integration and operational acceptance.

### Selection, context and observed-only import

Selection requires exact bank/repo/source/policy/environment, with exact task or
`script.applicable_to` matching. Cross-repo/bank/unknown source/policy/environment
differences are **excluded**, not silently compatible. Sorting is exact task
first, then ASCII experience ID and archive digest; host rank cannot become
current trust. Duplicate archive digests deduplicate; limit is 1–16 (default 8).

Context rechecks age/pin/policy currency, emits origin/run/binding/receipt-digest
provenance, original safe script/steps and optional observed failure analysis.
It always identifies historical authentication, current-verification-not-checked
and nonexecution. Model labels and raw bodies/signature/key material are excluded.
Budgets are 128–16,384 JavaScript **characters** and 1–16 whole items, not tokens;
whole entries that do not fit are omitted. No capability-lift claim is made.

`library.importHistorical(history, context)` requires an authentic still-acceptable
historical view plus exactly `experience_id`, `run_id`, `repo`, `source_sha`,
`policy_version`, `env_fingerprint`, `ts`. Both the experience ID and run ID
must differ from the historical identities; rejection occurs before reserving
an observation ID. The four non-run bindings must match; source/policy/environment
drift cannot become current checks. It creates only
**observed** safe script/step metadata with `historical_origin` retaining the old
ID/run/bindings, origin, timestamp and archive digest. Old failure/model measurements
stay in history, not relabelled as the new run's observations. Stored trust flags
cannot select state. Nomination and fresh current proof are still required through
`verifyCandidate`, then normal explicit confirmation/readback for live promotion.

## Safety, validation and residual boundaries

The same conservative learning label/script/step limits apply, including known
credential/path/URL/command exclusions. Ordinary/null-prototype own-data only;
Proxies/revoked Proxies, accessors, custom prototypes, symbols, unknown/undefined
fields and sparse/custom arrays reject without library traps/getters/coercion.
Normalized/private optional reads stay null-prototype. Outputs are detached and
deeply frozen. Document content is at most 65,536 ASCII characters. Filtering is
not a universal secret detector or a bound on reflection over gigantic hostile
inputs; producers must sanitize correctly.

All callbacks use the existing bounded native-promise/abort/late-rejection
mechanism. `timeout_ms` is per callback, 1–10,000 (default 1,000), not a total
service or CPU deadline. Callback errors are fixed value-free `LearningError`
codes; existing `sink-failed`, `sink-timeout`, `sink-mismatch` also describe signer,
query/read and lifecycle failures. Added archive/recall codes do not echo input.
Trusted callbacks, their native promise assimilation/abort listeners, keys,
clocks and persistence observation are not sandboxed, preempted or undoable.

Public-import tests preserve existing learning assertions and characterize live
provenance before private-state changes. Negative tests cover forged/copy/status
inputs, exact canonical cryptography/scope/key/age/expiry/revocation, own-data
hostility/mutation, lifecycle withdrawal, callback failures/timeouts/late results,
uncertain/concurrent writes and no live trust restoration. A self-contained fixture
executes producer and consumer in **two separate fresh Node processes**, with
synthetic generated ephemeral keys and test-owned file-backed mock Hindsight.
Only a public pin and safe document survive; history is authenticated after old
receipt/key intervals end, observed-only import refuses copied proof, and only
new consumer-run signed evidence can verify current state. Fixtures are excluded
from runtime packages, and only test-created directories are cleaned.

Initial pre-review feature snapshot: Node26.9.0 and Node20.20.2 executed **656 cases**
(567 inherited assertions unchanged + 89 additive); learning executes **222**.
Both actual installed-tarball consumers compile the self-contained portable fixture
with locked TypeScript **5.9.3** and run producer/consumer in distinct fresh
processes, asserting resolution to installed packages rather than workspace links.

The full review then found one new-run import P1 and one public counter-parameter
P2. Driver reproductions confirmed both on Node20/26. The corrected entrypoints
add three refusal/extra-argument regressions; current local source gates pass
**659 cases**, and new installed-package producer/consumer processes repeat the
restart proof. The original BLOCK is preserved; exact-head independent recheck
and hosted feature CI/remote source acceptance remain separate gates. See the
[entry correction snapshot](handoff/2026-10-07-portable-recall-entry-fixes.md).

These Node20/26 source and exact installed-tarball checks are engineering
evidence, not hosted feature CI, independent review, publication, source merge,
real Hindsight durability, production key/owner integration, default Pi activation,
executable replay or measured model improvement. See [learning](learning.md),
[evidence](authoritative-evidence.md), [architecture](architecture.md),
[phase plan](PHASES.md), [release contract](release-contract.md) and
[portable recall OpenSpec](../openspec/changes/portable-experience-recall/proposal.md).
