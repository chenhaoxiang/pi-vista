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

# Verified learning: explicit transport, offline views

`@pi-vista/learning` implements the additive experience-library seam of inherited
#12 (promotion), #14 (failure/lifecycle/recorded replay) and #16 (verified-only
retrieval/context evaluation). It neither configures nor contacts Hindsight by
default. No existing Pi, CLI, core, guard, gate, checks or evidence runtime is
changed by the learning component. The current integration wires all 11 packages
into root scripts/lock and adds new synthetic public-import seam tests; original
runtime sources/assertions remain unchanged. Local engineering integration is not
independent source acceptance, remote merge or live activation.

All lifecycle, promotion-preview, failure, replay, comparison, selection,
context, evaluation and model-statistics views carry **authorization: none**.
Verified learning is not permission to execute a step, resolve a repair ID,
autoapprove tools, choose a model, merge, publish or release. workspace-guard,
ai-gate, isolation and production/credential/billing authorities remain intact.

## Factory and opaque provenance

```ts
import { createLearningLibrary } from "@pi-vista/learning";

const library = createLearningLibrary({
  verifier,                 // exact createEvidenceVerifier() identity
  sink,                     // optional explicit ingest + readback callbacks
  timeout_ms: 1000,         // optional, integer 1–10000, per sink callback
});
```

The factory requires `isEvidenceVerifier(verifier)` from `@pi-vista/evidence`.
An arbitrary `isCurrent: () => true` object, a copied verifier, predicate report,
Boolean or status-labelled document is not authority. Host public-key pins,
required owner checks/suites, trusted clock, receipt readers and freshness are
configured through the [evidence contract](authoritative-evidence.md), not this
package. There is no default HTTP, MCP, filesystem, signing or model client.

Each library privately records experience, plan and selection identities in
WeakMaps. Views are deeply frozen own-data projections. Copying, serializing or
reconstructing them does not restore their provenance. Different libraries do
not accept each other's handles/plans/selections even if they share a verifier.
In particular, retrieving arbitrary Hindsight documents with a `status` field is
unsupported. This is an in-process library, not a durable experience database or
cross-session capability import API.

## Observation and safe two-level metadata

`observe(input)` accepts **only** the following required fields:

- `experience_id`, `run_id`, `repo`, `source_sha`, `policy_version`,
  `env_fingerprint`, `task_type`, `ts`, `script`, `steps`.
- Optional fields: `model_id`, `failure_analysis` (a `FailureObservation`).

`status`, `verification`, trusted/verified flags, receipt bodies, document IDs,
`superseded_by`, raw artifacts and unknown fields reject. There are at most 64
unique experiences per library; duplicate experience IDs reject without replacing
an existing record. `ts` is an observational nonnegative safe integer, not owner
freshness evidence.

The readonly safe subset preserves `VistaScript`/`VistaStep` field spellings:

| Object | Closed fields and constraints |
| --- | --- |
| Script | `task_type` (must equal observation task), `description`, `preconditions`, `steps` (1–16 labels), `postconditions`, `known_failures` (0–16 `{symptom, mitigation}` label records), `applicable_to` |
| Step | `step_id`, `tool`, `action_description`, `check_fn_ids`, `expected_result`, `on_failure`, `depends_on` |
| Step ordering | 1–16 unique step IDs; dependencies must refer to earlier recorded steps, never forward/self/missing IDs |
| Failure handling label | `stop`, `retry_once`, `skip`, `escalate` are recorded metadata only; none schedules behavior |

Other metadata lists have 0–16 unique labels. Descriptions/action descriptions
are 1–256 ASCII characters of single-space-separated safe metadata labels; they
are not arbitrary model narrative. Labels are 1–128 ASCII characters, first a
letter/digit, then letters/digits/`.`/`_`/`-`. Prototype-related names, recognized
complete shell words, and known embedded GitHub/SK/Slack/JWT/AWS credential
signatures reject. SHAs are 40/64 hex and digests 64 hex, normalized lowercase.
Paths, URLs, shell syntax, templates, raw commands and bodies are not allowed.
The filter is conservative and may reject innocent labels; it is **not a
universal secret detector**. Producers must obey the privacy contract rather
than relying on unknown encodings being detected.

Ordinary/null-prototype own-data records (including nonenumerable own data) are
snapshotted before use. Node-detectable Proxies/revoked Proxies, getters/setters,
custom prototypes, symbols, unknown keys and explicit `undefined` reject without
calling source traps/getters/coercion hooks. Optional fields must be omitted.
Arrays must be ordinary, dense and contain only own indexed data and `length`;
sparse/custom arrays, extra methods/properties, accessors, symbols and undefined
elements reject. Later input/config mutation cannot redirect callbacks or change
an experience/preview. Bounds constrain retained metadata, not the cost of
reflection over arbitrarily huge hostile objects or all host CPU/memory use.

## Lifecycle

```text
observe(input) -> observed
nominate(observed) -> candidate
verifyCandidate(candidate, opaqueProof) -> verified
confirmed commit + exact successful ingest/readback -> trusted

observed/candidate/verified -> rejected
trusted -> deprecated
verified/trusted -> superseded (fresh verified/trusted replacement)
```

`verifyCandidate` requires a proof minted by the exact configured verifier,
currently fresh and matching **all five** run/repo/source/policy/environment
bindings. Caller flags and copied/foreign proofs fail closed. Only a successfully
confirmed sink round trip can raise `verified` to `trusted`. Every transition
returns a new handle and invalidates the prior handle for further operations;
a previous frozen view remains historical, not a current status capability.
Terminal states cannot be resurrected.

`supersede(old, replacement)` requires a different active, fresh verified/trusted
replacement with the same task and repo/source/policy/environment binding (run
may differ). It records `superseded_by` and the package-local terminal status
`superseded`; the existing protocol's status union is unchanged. To withdraw
older source/policy/environment knowledge across bindings, deprecate the trusted
record instead. Deprecated/superseded views do not retain `hindsight_doc_id` as a
current trusted-document claim; no remote document is deleted or edited.

`model_id` is retained as an observational label only. `modelStatistics(handles)`
reports sorted counts with `use: observational-only`; no strength ranking,
stronger/weaker routing, tool invocation or model preference is provided.

## Exact dry-run and digest-confirmed sink

```ts
const candidate = library.nominate(library.observe(safeObservation));
const proof = await verifier.verify(expectedBindings, ownerSubjects);
const verified = library.verifyCandidate(candidate, proof);
const plan = library.preparePromotion(verified, "repo-bank-alias");
// Review plan.bank and the exact plan.document.title/content/tags.
// Obtain an explicit host/operator confirmation of plan.preview_digest.
const trusted = await library.commitPromotion(plan, {
  preview_digest: explicitlyConfirmedDigest,
});
```

A bank is a safe **host alias**, not a path or a default Hindsight bank name.
Mapping it to a real bank is the injected transport's explicit responsibility.
Preparation is offline: it checks current opaque provenance and renders a
bounded safe document without reading receipts or calling any sink. The content
is sorted-key canonical JSON of schema=1, authorization=none, the snapshotted
experience, projected receipt summaries and, for corrections, safe correction
labels. Receipt signatures, owner bodies, logs, private keys, errors and arbitrary
model content are never rendered. Content is at most 65,536 characters.

`content_digest` is SHA-256 of the exact UTF-8 content. `preview_digest` is SHA-256
of canonical `{bank, document}`, so it binds title, content, tags, content digest
and bank. The stable `idempotency_key` is `learning-<preview_digest>`; re-preparing
the same content/receipts/bank yields the same identity without including a
changing verification timestamp. The plan's candidate/proof/bank/request binding
is private; flags, a copied plan, a foreign plan or a changed digest cannot
redirect it. Bad confirmation does not consume the valid plan or cause reads.

On a valid confirmation, the library atomically consumes the plan/experience's
one permitted promotion attempt **before the first await**, then calls
`verifier.revalidate(proof)`. That re-fetches signed gate/test/guard receipts,
rechecks their authenticity, completeness, bindings and freshness and compares
all hashes with the reviewed proof. Changed/stale/failed receipts reject before
ingestion. Active lifecycle/proof freshness is also rechecked after refresh,
after ingestion and after readback. A concurrent lifecycle withdrawal/expiry
can never mint trusted state, though a host write already made cannot be undone.

The optional sink must contain both trusted native-promise callbacks:

```ts
interface LearningSink {
  ingest(request: IngestRequest, signal: AbortSignal): Promise<unknown>;
  readback(receipt: SinkReceipt, signal: AbortSignal): Promise<unknown>;
}
// IngestRequest: bank, title, content, tags, content_digest, idempotency_key
// SinkReceipt: document_id, bank, content_digest, idempotency_key
// SinkReadback: the receipt fields plus title, content, tags
```

Both responses are closed ordinary/null-prototype own-data objects. The ingest
receipt must return a safe document ID and the exact requested bank/content
digest/idempotency identity. Readback must match that document ID and receipt,
and return exactly the previewed title/content/tags; its content hash is checked
independently. A truthy ack or matching hash echo **alone** is insufficient.
The library depends on the trusted host truthfully observing persistence;
callbacks that simply fabricate matching readback cannot prove remote durability.

Rejection, exception, malformed response, wrong ID/bank/hash/identity/content,
timeout, expired proof, readback mismatch or uncertain write cannot create
trusted state. Error names/messages/stacks contain only fixed `LearningError`
codes, never source values or original callback errors. The codes are exported
in `LearningErrorCode`; no diagnostic body or machine path is included.

Each asynchronous sink wait is bounded by `timeout_ms`, with best-effort abort,
intrinsic native-promise handling and consumed late rejection. Arbitrary
thenables/Proxy promises are refused without reading their `.then`. A
synchronous over-deadline return also cannot succeed. There is no hidden retry,
background poll or cancellation API. The timer cannot preempt synchronous
blocking callbacks, sandbox native-promise behavior/abort listeners, undo writes
or bound scheduler delays. Callbacks, their own promise assimilation and abort
behavior are explicitly trusted host code.

One confirmed attempt per experience per library also prevents racing competing
bank/correction previews or retrying an uncertain write through a fresh plan.
Failure leaves the experience untrusted (`verified` unless explicitly withdrawn)
and the attempt consumed. Offline verified-only retrieval remains possible while
its original receipt proof is fresh. Recovery/reconciliation is an explicit host
responsibility, not an automatic second write. Deduplication is process-local,
not a durable lock, atomic evidence snapshot or cross-process transaction. The
host must honor idempotency durably across processes, handle crash/partial-write
reconciliation and define its own receipt/readback durability contract.

## Failure classification and corrections

`classifyFailure` accepts a `FailureObservation` with `failure_id`, `run_id`,
`step_id`, `ts`, `stage` (`precondition|execution|validation|promotion`) and one
observed `reason_code`:

| Observed reason | Classification | Deterministic root-cause hypothesis |
| --- | --- | --- |
| `guard_block` | safety | `safety_block` |
| `test_failed` | validation | `test_regression` |
| `gate_blocked` | validation | `gate_rejection` |
| `sha_mismatch` | binding | `source_drift` |
| `env_mismatch` | binding | `environment_drift` |
| `policy_mismatch` | binding | `policy_drift` |
| `path_conflict` | workspace | `workspace_conflict` |
| `transport_timeout` | transport | `transport_wait` |
| `unknown` | unknown | `unclassified` |

Optional `hypotheses` is a unique bounded list of these root-cause codes.
`fix_applied` (safe label) and `fix_outcome` (`resolved|partial|failed`) must be
supplied together. No raw root-cause prose, arbitrary code or repair identifiers
are accepted. The result always has `verification: observed-only`,
`root_cause_basis: hypothesis` and authorization none. Observed reasons are
claims, and a deterministic classification is not proof of a cause, fix or
recoverability. An experience's failure must match its run and a recorded step.

`prepareCorrection(verified, bank, {failure_id, prior_claim, correction_code})`
requires the new verified experience to contain that exact failure ID and a
recorded resolved fix. The labels are closed safe symbolic data; no artifact or
model text is quoted. It returns a `Correction: <experience_id>` preview tagged
`knowledge:failure`. Its confirmation, revalidation, ingest and readback boundary
is identical to ordinary promotion. An observed resolved fix cannot bypass
independent owner evidence. To correct an already trusted record, create a new
safe experience and independently verify it; no automatic memory writes or
in-place remote corrections occur.

## Recorded replay/comparison: no execution

`planReplay(handle, expectedBindings)` returns the same-run script and recorded
step-order timeline with `mode: recorded-only`, `executable: false` and
authorization none. Active nonterminal observed/candidate/verified/trusted
handles are allowed because this is a historical view, not executable replay or
a new freshness attestation. All five expected bindings must match; mismatched
run/source/policy/environment/repo fails closed.

`compareRecorded(left, right, expectedBindings)` requires both records to match
that same run/binding and deterministically compares script, steps and observed
failure reason, returning safe step IDs and booleans. It does not execute logged
shell/actions, invoke tools, resolve arbitrary repair IDs or infer a repair from
`on_failure`. Actual executable replay is **not implemented or authorized**.

## Verified-only retrieval and character-bounded context

`retrieve(handles, query)` operates offline over at most 64 supplied handles.
Query fields are exactly `repo`, `source_sha`, `policy_version`,
`env_fingerprint`, `task_type`, optional `limit` (1–16; default 8). Run is retained
in provenance rather than required equal, enabling cross-run reuse only within
the four other bindings. Unknown/copy/foreign/raw/status-labelled inputs,
observed/candidate records, expired proofs, stale lifecycle versions, terminal
states and repo/source/policy/environment/task mismatches are excluded. Rejection
counts distinguish `unverified`, `stale`, `lifecycle`, `mismatch`, `task`, `limit`.
Duplicate valid handles do not duplicate retrieval results.

Matching is deterministic: exact task first, then `script.applicable_to`; within
each group trusted before verified, then ASCII experience ID order. It is not a
semantic model search, Hindsight query, arbitrary-content import or model rank.
`isCurrent` checks opaque receipt provenance/freshness without receipt I/O.
Offline selection cannot discover subsequent owner changes, key compromise,
remote revocation or an incorrect host-supplied expected source/environment;
the host must supply truthful query bindings. Promotion alone performs a fresh
owner read. Stored verification projections/flags are not independently valid.

`compileContext(selection, options?)` accepts only a selection minted by the same
library, rechecks current handles/proofs and fails `stale-selection` if any
selected record expired or transitioned. Options are only `max_characters`
(128–16384; default 8192) and `max_items` (1–16; default 16). The compiler emits
an explicit authorization-none header and canonical script+step entries with
run/repo/source/policy/environment/status and receipt-digest provenance. Model
IDs and raw receipt/document/artifact bodies are not context inputs. Full entries
that do not fit are omitted, never partially truncated. The result reports
actual character count, included/omitted IDs and bounded provenance. Empty
selection still emits the non-authorizing header.

These are **JavaScript character (UTF-16 code-unit) bounds, not token bounds**.
Accepted metadata/generated content is ASCII. No tokenizer, model routing,
context injection into Pi, model call or tool invocation is installed.

`evaluateRetrieval(handles, cases)` is a deterministic offline fixture comparison
with 1–16 unique safe case IDs. Each closed case has `case_id`, `query`,
`expected_ids` (0–16 unique labels) and optional `context` options. It reports
exact expected-set selection success, matched/expected selection coverage,
stale/unverified/etc. rejection counts, compiled context items/steps/characters
and totals. Empty expected sets have coverage 1 only as the denominator
convention; unwanted selections still fail exact-selection success. Coverage is
selection coverage, not capability lift or guaranteed compiled-context coverage.
The output says `evaluation: offline-fixtures`, `capability_claim: none` and
authorization none. Caller expected IDs cannot cause an unverified handle to
select. Known synthetic fixture success is **not real model capability evidence**.

## Hindsight custom pages: configuration data only

`HINDSIGHT_CUSTOM_PAGES` exports a deeply frozen, JSON-serializable compatible
snippet. The keys/`source_query`/`tags` match the coding-agent plugin's documented
`customPages` contract:

```json
{
  "customPages": {
    "Verified skills": {
      "source_query": "What task patterns have been successfully completed, verified by tests and gate receipts, and are safe to reuse?",
      "tags": ["knowledge:skill"]
    },
    "Failure patterns": {
      "source_query": "What has failed repeatedly? What was the root cause and the verified fix?",
      "tags": ["knowledge:failure"]
    }
  }
}
```

No real plugin configuration, bank, page, host hook or memory service is edited
by importing this value. A knowledge page is not proof of fresh opaque learning
provenance and does not gain permission from its name/tags. Host configuration
and owner wiring require their own explicit integration and acceptance.

## Source validation and remaining boundaries

The package has generated ESM/types, an MIT license, its own test tsconfig and a
fixed unquoted `dist-test/*.test.js` shell glob compatible with Node 20 scripts.
Synthetic generated Ed25519 owner keys and in-memory native-promise sinks are
excluded from runtime build products. Public-import tests exercise confirmed
promotion and context end to end; negative assertions cover copied authority,
bindings, malformed own data, wrapped credentials, lifecycle transitions,
corrections, source changes/expiry, transport errors/timeouts/readback mismatch,
duplicate/concurrent writes, nonexecuting replay, verified-only retrieval and
known-fixture context metrics. Existing package sources/assertions are untouched.

Build/typecheck/test commands:

```sh
npm ci --offline --ignore-scripts
npm run build --workspace=@pi-vista/protocol
npm run build --workspace=@pi-vista/core
npm run build --workspace=@pi-vista/checks
npm run build --workspace=@pi-vista/evidence
npm run build --workspace=@pi-vista/learning
npm run typecheck --workspace=@pi-vista/learning
npm run test --workspace=@pi-vista/learning
npm pack --dry-run --workspace=@pi-vista/learning
git diff --check
```

The focused component lane originally validated 133 tests on Node 26.9.0 /
npm 11.19.1. The combined integration now uses the repeatable
[release contract](release-contract.md) for all 11 packages, actual local Node20
and actual isolated packed-consumer installation/strict TypeScript. These checks
are distinct from manifest/script compatibility claims and do not establish
registry availability, hosted CI, publication, deployment or operational acceptance. Actual gate/test/guard producer wiring, actual
Hindsight durability/readback, durable lifecycle/idempotency storage, production
configuration, default Pi integration, external model evaluation, executable
replay and release/publication remain separate owner work.

Maintained dependencies: [architecture](architecture.md),
[evidence](authoritative-evidence.md), [checks](check-functions.md), and
[verified-learning continuation](../openspec/changes/verified-learning/proposal.md).
