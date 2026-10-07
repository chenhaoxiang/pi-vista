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

# Owner-normalized shadow observation adapter

`@pi-vista/adapter-shadow` is an additive, explicitly invoked observer for
sanitized metadata from the Laya, Kev, Intern and StartLux model families.
It is **not** a judge or a new authorization route. No current private system
is claimed to be wired to this adapter, and validation uses synthetic data only.

## API and normalization boundary

```ts
import {
  toVistaEventInput,
  emitShadowObservation,
  type ShadowObservation,
} from "@pi-vista/adapter-shadow";

const observation: ShadowObservation = {
  schema: "shadow-observation/1",
  shadow: true,
  model_family: "kev",
  model_id: "kev-4b",
  model_version: "synthetic-v1",
  verdict: "pass",
  status: "observed",
  context_status: "complete",
  correlation: {
    run_id: "synthetic-run",
    step_id: "synthetic-run_s0",
    source_sha: "0123456789abcdef0123456789abcdef01234567",
    pair_id: "pair-1",
    shared_input_hash: "a".repeat(64),
  },
  humanExpectationWritten: false,
  trainingEligible: false,
  promotionEligible: false,
};
const projected = toVistaEventInput(observation); // no I/O, deeply frozen
// projected.result === "unknown"
await emitShadowObservation(observation); // explicit best-effort core persistence
```

Owner request/vote, sidecar and row-proof concepts inform this normalized
contract, but they do not provide a stable public sanitized wire signature.
**Explicit owner normalization is required.** Raw authorization scopes,
requests/votes, guard event `detail` objects, sidecar packets, row proofs,
asset manifests and receipts, offline diagnostic/batch reports, arbitrary
legacy objects and model input/output are unsupported. The adapter neither
reads nor extracts safe metadata from them. Owners must preserve veto,
abstention, forced abstention, missing context and failure classifications
while removing raw content before calling this package. The version label
`shadow-observation/1` describes this adapter input, not owner compatibility,
provenance, receipt validity or safety approval.

### Closed input schema

All records are ordinary or null-prototype **own data**, including
non-enumerable own data fields. Each record is snapshotted from descriptors;
accessors, symbols, custom prototypes, arrays, Proxies (including revoked
ones), unknown keys and explicit `undefined` values reject without source
getters, Proxy traps or coercion. Nested records have the same boundary.
Validation completes before any configured callback or persistence. Projected
records, artifact arrays and stats are detached and recursively frozen.

Required `ShadowObservation` fields:

- `schema: "shadow-observation/1"`, `shadow: true`;
- `model_family: "laya" | "kev" | "intern" | "startlux"`;
- safe single-segment `model_id` and bounded `model_version` label;
  Intern requires `intern-decision-4b`, StartLux requires
  `startlux-decision-4b`. Known IDs `laya-421m`, `kev-4b` and those two
  additional IDs cannot be cross-labelled as another family. Other safe
  Laya/Kev IDs are statistical labels, not runtime selectors; their versions
  are not fixed here;
- `verdict: "allow" | "pass" | "deny" | "veto" | "abstain" | "uncertain" | "unknown"`;
- `status: "observed" | "timeout" | "unavailable" | "disagreement" | "missing-context" | "invalid-evidence" | "unknown"`;
- `context_status: "complete" | "missing" | "redacted" | "truncated" | "unknown"`;
- `correlation: ShadowCorrelation` (requires an explicit `run_id`);
- `humanExpectationWritten: false`, `trainingEligible: false`,
  `promotionEligible: false`. Missing, true or non-boolean flags reject;
  positive privileges are never silently relabelled as safe.

Optional fields are **only** `request`, `vote`, `vote_ref`, `reason_code`,
`confidence`, `row_evidence` (Laya only), and `asset_evidence`.
`confidence` is a primitive finite number in `[0, 1]`; it never changes a result.
Other privilege-like fields, including `verified`, `authorized`, `permission`,
`active`, `live`, `popup`, `humanExpectation`, `PASS` and `result`, are unknown
fields and reject. This adapter does not accept an owner truth/training or
promotion receipt, nor any gate/test signature.

Identifiers are at most 128 characters and use ASCII letters, digits, dots,
underscores and hyphens. Opaque refs are single segments of at most 256
characters with the same alphabet. Labels (`model_version`, `policy_version`,
`reason_code`) are at most 64 characters and additionally permit colon, at-sign
and plus. They must be labels, not prose. No field accepts paths or URLs,
including relative/encoded paths and URL queries/fragments. In particular a
slash-qualified owner policy version must first have an explicit owner-selected
safe revision label; it is not silently rewritten here. Source SHAs are exactly
40 or 64 hex characters, other digests exactly 64. Every retained text value
passes public core redaction **unchanged**, rejects credential labels and
`hasKnownCredential` signatures (including wrapped/case-variant GitHub
classic/fine-grained, SK, Slack and JWT values). Bare commands also reject.
This is a bounded known-signature/lexical boundary, **not** a universal secret
detector: producers remain responsible for not disguising content/secrets as
innocent-looking labels or hashes.

### Correlation

`ShadowCorrelation` requires `run_id` and permits only `step_id`, `source_sha`,
`request_id`, `pair_id`, `shared_input_hash`, `fingerprint`, `policy_version`.
`step_id`, when provided, must be bound as `<run_id>_<nonempty suffix>`.

Optional `request`/`vote` are explicit owner-normalized correlation projections,
not authorization callbacks. They each require `run_id`. Every supplied field
must exist on and agree with the canonical `correlation` record. Hash/SHA
comparison is case-insensitive; IDs and labels compare exactly. A missing
canonical field or run/step/source/request/pair/shared-input/fingerprint/policy
mismatch rejects the entire observation before emission. No side is selected
as truth, no mismatched source binding is persisted, and the adapter never
repairs or replaces an owner outcome. Omitted optional correlations are **not**
assumed to match, independently verified or filled from ambient state.

Shared wire-state hashes are opaque digests only. Row input, minimal packet,
map and model-specific effective-input digests represent different byte domains;
they are not required to equal the shared wire-state hash. The adapter does not
read packet content, hash bytes, verify model input closure, rederive row
verdicts, compare models or generate consensus.

### Row and asset metadata

`ShadowRowEvidence` is Laya-only and requires `sample_id`, `row_sha256`,
`ownerReviewCandidate` (boolean), `ownerAdjudicationRequired: true` and
`forcedAbstain` (boolean). Optional `input_sha256`, `packet_sha256`,
`contract_map_sha256` are digest metadata. A recorded review candidate is
**at most an owner-review candidate**, not human truth, training eligibility,
model ranking or an approval queue generated by Vista. Forced abstention is
retained; agreement or high confidence never produces a Vista success.

`ShadowAssetEvidence` requires `scope: "synthetic" | "offline" | "unknown"`,
`verified: false`, `realInputIsolationProven: false`, and at least one of
`asset_ref`, `receipt_ref`, `isolation_ref`. Optional corresponding
`asset_sha256`, `receipt_sha256`, `isolation_sha256` require their ref. Optional
`license_mode` is `local-shadow`, `non-commercial-research-shadow`, or `unknown`.
These are owner-selected labels only: receipt existence and synthetic Kev
isolation evidence do not prove real-input/OS isolation, authenticity,
license rights, or live admission. No artifact sets `verified`, even to false;
no positive verification or isolation claim is accepted. The adapter license
does not license model weights or imply commercial StartLux deployment.

## Projection and outcome semantics

Components are `laya`, `kev`, `custom:shadow/intern`, `custom:shadow/startlux`;
actions are `shadow:<model_family>:observe`. Model IDs remain protocol
statistical metadata. The canonical run/step/source/policy bindings are retained.
`trace_id` uses `pair_id` when supplied, otherwise `request_id`; both IDs remain
separately discoverable as typed refs. An owner `reason_code` is preserved.

Outcome precedence is deliberately non-authorizing:

| Owner observation | Vista result |
| --- | --- |
| `deny` or `veto`, regardless of context/status | `blocked` |
| `abstain`, row forced abstain, status disagreement/missing-context, or context missing/redacted/truncated (unless deny/veto above) | `abstain` |
| All remaining combinations, including allow/pass, uncertain/unknown, timeout/unavailable/invalid-evidence | `unknown` |

The adapter **never emits `ok`**, infers permission/PASS from allow,
agreement/confidence/receipt existence, or modifies a guard/gate outcome. The
original normalized verdict, status and context classification remain in
`shadow_metadata` stats as `owner_verdict`, `owner_status`, `context_status`.
Family/version become core-safe `family`/`revision` stats, with fixed
`safety_role: "observation-only"`, `shadow: 1` and three eligibility flags `0`.
Core reserves raw model/input/authorization keys in stats; this package does
not extend or relax that redaction contract.

Refs are typed `shadow_request`, `shadow_pair`, `shadow_vote`,
`shadow_shared_input`, `shadow_row_evidence` (sample ref and bounded
candidate/abstain/map/packet stats), `shadow_row_input` (sample ref),
`shadow_asset`, `shadow_receipt`, `shadow_isolation`. Each content digest uses
bounded `digest_sha256` stats on its corresponding typed ref, **not**
`ArtifactRef.sha` (which is a source binding). Only the explicit canonical
`source_sha` binds the event; artifact/source provenance is not inferred.
Asset/receipt/isolation stats retain `scope`, optional `license_mode` and fixed
`isolation_proof: "none"`. No artifact contains bytes, paths, URL locations,
receipt bodies or a `verified` field. An unchanged-redaction check covers the
entire projection before return or emission.

## Explicit emission and failure behavior

`toVistaEventInput` is pure. It never consults environment variables, owner
stores, session logs, asset manifests, private runtimes, model switches, or
thresholds. Importing this package does not install or activate an observer.

`emitShadowObservation` accepts only core option names `store`, `baseDir`,
`runId`, `stepId`, `seq`, `now`, `clock`, `persistTimeoutMs`. Option records use
the same closed descriptor boundary. A supplied `runId` must match the explicit
input run; a supplied `stepId` must be run-bound and match an input step when
present. Unsafe/conflicting options reject even if the observation has an ID.
No fallback reads `VISTA_RUN_ID`. Missing steps and shared sequence state remain
owned by core; no adapter counter is introduced.

`seq` must be a nonnegative safe integer, `now` a finite number or trusted
non-Proxy callback, `clock` a trusted non-Proxy callback, and `persistTimeoutMs`
a finite number from `0` to `2147483647`. `baseDir` is bounded trusted filesystem
configuration, not event metadata. An explicit `store` must be a plain/null
own-data record containing **only** a non-Proxy `append` callback. Wrap class
stores explicitly: `{ append: event => eventStore.append(event) }`. Store and
clock callbacks are trusted host code, not sandboxed by this adapter. They
cannot change the detached projection through source aliases, and an injected
store receives a frozen event, but their own side effects are not controlled.

Malformed data/options reject with the fixed, value-free `VistaProtocolError`
message `invalid normalized shadow observation or emission options`. Core
construction/redaction/I/O failures keep core's existing sanitized, fail-open
behavior; store exceptions/rejections/timeouts never affect owner guard/gate
execution. Core's default persistence timeout is 250 ms. It bounds asynchronous
waiting, not synchronous host blocking, cancellation or eventual storage
completion. A returned event is an observation, **not** proof of persistence or
admission. The host must not await optional observation validation on its safety
decision path without appropriate error isolation.

## Validation and unimplemented/live boundaries

Synthetic public-import tests separately exercise all four normalized model
families, negative/abstain/unknown/missing-context outcomes, disagreement,
correlation mismatch, row/asset metadata, privilege rejection, descriptor and
Proxy hostility, mutation, privacy, fixed errors and fail-open emission.
Fixtures are created only in this package's ignored `tmp/`; cleanup targets
only test-created directories. See the package README for focused commands.
The focused component originally left root scripts/lock untouched. The current
integration wires all 11 packages into root gates and adds a public shadow->core
JSONL->unchanged observation CLI roundtrip using only newly created synthetic
fixtures. Original runtimes/assertions remain unchanged; actual local Node20 and
packed-consumer evidence is recorded in the
[release contract](../release-contract.md), not an owner acceptance receipt.

There is no direct owner normalization implementation, actual model/receipt
inspection, live wiring, council/owner truth verification, real-input isolation
proof, model routing/selection, training, threshold modification, promotion,
Hindsight write, release, gate/test signature or authorization implementation.
P1/G2/HOLD/live restrictions and owner veto/abstain/missing-context behavior
remain untouched. Current guard and ai-gate safety authority is not overridden.
Build/tests/packing do not establish publication, actual-input validation,
owner activation, operational acceptance or historical Hindsight status.
