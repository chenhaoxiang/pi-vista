# @pi-vista/adapter-ai-gate

Low-coupling, model-agnostic observation adapter for owner-side `ai-gate`
evidence. It converts a closed, structured evidence record into a
`VistaEventInput`; it does not run `gh` or any API, read pull requests, read CI
or review text, decide admission, merge, or deploy.

## Install

```bash
npm install @pi-vista/adapter-ai-gate
```

## Usage

The owner-side integration passes only evidence that has already been
sanitized. Exactly one action alias and exactly one outcome alias are required:

```typescript
import {
  emitAiGateEvidence,
  type AiGateEvidence,
} from "@pi-vista/adapter-ai-gate";

const evidence: AiGateEvidence = {
  run_id: "run-123",
  repo: "pi-vista",
  source_sha: "0123456789abcdef0123456789abcdef01234567",
  action: "ci_check",
  status: "success",
  receipt_ref: "receipt-123",
  lane: "P2",
  tier: "tier2",
  reviewer_id: "reviewer-1",
  model_id: "provider/model-v1",
  required: true,
  passed: true,
};

await emitAiGateEvidence(evidence);
```

`status` maps to the protocol result as follows:

| status | Vista result |
| --- | --- |
| `success` | `ok` |
| `failure`, `cancelled` | `failed` |
| `pending`, `neutral`, `skipped` | `unknown` |

A supplied protocol `result` is retained as-is. `decision`, `verdict`,
`passed`, and `required` never replace an explicit `result` or `status`; in
particular, `required: false` is not a success signal. `decision` and
`verdict` are retained only as short registry-safe metadata codes, not
interpreted as prose or used to derive a reason/outcome. `reason_code` is an
independent optional owner-provided code.

## Public evidence contract

Accepted fields are only:

- identity: `run_id`, `session_id`, `trace_id`, `repo`, `source_sha`;
- exactly one of `action` or `check_type`;
- exactly one of protocol `result` or ai-gate `status`;
- optional short `decision`, `verdict`, and `reason_code` codes;
- optional safe 40/64-character hexadecimal `source_sha`/`head_sha`;
- opaque single-segment references: `review_hash`, `escalation_hash`,
  `receipt_ref`, and `artifact_ref`;
- metadata: `lane` (`P0`–`P5`), `tier` (`tier2`/`tier3`), `reviewer_id`,
  `model_id`, `passed`, and `required`.

A `head_sha` requires `source_sha`. Matching SHA values are retained in the
normal `source_sha` event field and as safe metadata; a mismatch is never
silently corrected. The adapter emits `unknown` for a non-failed mismatch
(an explicit `failed` remains `failed`), keeps both safe SHA summaries and
`sha_relation: "mismatch"` in metadata, and uses `sha_mismatch` only when the
owner did not provide a `reason_code`. On mismatch, metadata also retains the
original outcome alias as exactly one of `owner_result` (a protocol result enum)
or `owner_status` (an ai-gate status enum). These output-only stats are evidence,
not a PASS/verification/authorization signal or an additional accepted input.
The core protocol has no `head_sha` field and is not extended by this package.

The adapter rejects unknown fields, custom prototypes, accessors, all Proxy
values (including revoked Proxies), raw PR/CI/review text, paths, shell
commands, credentials, tokens/cookies, URL references, and unsafe metadata.
It accepts ordinary or null-prototype data records, takes a single own-data
snapshot without invoking getters or Proxy traps, and performs no network or
gate operation.

Identifiers are bounded (identity/model IDs: 128 characters, action: 128,
codes: 64, opaque single-segment refs: 256). Refs allow only ASCII letters,
numbers, dots, underscores, and hyphens; paths and URLs are not opaque IDs.
Token signatures are rejected even when embedded behind a safe-looking prefix,
for example `receipt_ghp_…`, `review_sk-…`, `github_pat_…` (fine-grained
GitHub PATs), or wrapped Slack/JWT values. Bare, wrapped, concatenated-prefix,
and case variants are rejected. This check applies to every retained-string
input, including IDs, actions, codes, and model/reviewer metadata, not just
references. Credential labels such as
`token`, `bearer`, `cookie`, `private-key`, `api-key`, and `secret` are also
rejected. All retained text must pass the existing core redaction contract.

`lane`, `tier`, `decision`, `verdict`, `passed`, `required`, and SHA summaries
are projected as observational `gate_metadata` artifact stats, not as PASS,
verification, or authorization claims. The generic `model_id` event field is
preferred for model identity. `reviewer_id` is retained in stats only if core
can retain it unchanged; otherwise it is omitted (for example a slash-qualified
reviewer ID or one longer than 64 characters). Core/protocol are not widened.

`emitAiGateEvidence` delegates persistence to `@pi-vista/core`. Core store
failures and persistence timeouts are fail-open; malformed evidence is rejected
before the store is called. Use `toVistaEventInput` when a registry wants to
inspect the mapped event without emitting it.

## Emission identity and options

`emitAiGateEvidence` snapshots only own data fields from ordinary or
null-prototype `AiGateEmitOptions` records. The public core keys are `store`,
`baseDir`, `runId`, `stepId`, `seq`, `now`, `clock`, and `persistTimeoutMs`;
custom prototypes, inherited option fields, accessors, symbols, Proxies, and
unknown keys reject without invoking getters or Proxy traps. Explicit `runId` and
`stepId` must be short (at most 128 characters), path-safe, credential-free IDs,
using the same embedded-token checks as evidence. Unsafe explicit IDs reject
with a fixed `VistaProtocolError` before any store call, even if an evidence
run would otherwise take precedence; no unsafe value appears in the error.
An explicit step must belong to the effective run (`<run_id>_<suffix>`).

Run precedence remains `evidence.run_id` > `options.runId` > implicit identity.
For implicit identity, the adapter reads only own data descriptors for
`process.env` and `VISTA_RUN_ID`. A safe environment ID is reused. A missing,
unsafe, token-like, inaccessible, or hostile environment value uses one cached,
safely generated adapter run ID instead; the original environment value is not
rewritten, forwarded to core, stored, or included in errors. Explicit evidence
or option identities do not consult an unrelated environment value.

The checked run (and explicit step, when supplied) is passed to core explicitly.
Default steps remain generated by core from that safe run and its sequence,
so consecutive adapter emissions share an implicit run and direct core/adapter
emissions on the same run share core's sequence. The adapter does not maintain
a separate step counter. Trusted `store`, `clock`, and `now` callbacks retain
their behavior; `baseDir` is configuration only, never persisted event text.
Invalid protocol values still reject, while store I/O failures and timeouts
remain fail-open. `toVistaEventInput` does not resolve emission options or
implicit identity.

## Ownership boundary

`ai-gate` remains the final admission owner. This package is an observation
adapter only. It does not fix the current gate's model count, choose models,
read gate configuration, infer a verdict from text, or change merge/deploy
behavior.
