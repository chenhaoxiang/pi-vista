# ai-gate adapter

`@pi-vista/adapter-ai-gate` is a public, low-coupling observer for
owner-side, already-sanitized ai-gate evidence. It maps one structured record
to a `VistaEventInput` and delegates best-effort persistence to
`@pi-vista/core`.

```bash
npm install @pi-vista/adapter-ai-gate
```

## Public contract

The adapter accepts a closed allowlist only:

- identity: `run_id`, `session_id`, `trace_id`, `repo`, `source_sha`;
- exactly one of `action` or `check_type`;
- exactly one of protocol `result` or `status`;
- optional short `decision`, `verdict`, and `reason_code` codes;
- optional `source_sha`/`head_sha` with exactly 40 or 64 hexadecimal characters;
- safe opaque single-segment `review_hash`, `escalation_hash`, `receipt_ref`,
  and `artifact_ref` references;
- safe metadata: `lane` (`P0` through `P5`), `tier` (`tier2` or `tier3`),
  `reviewer_id`, `model_id`, `passed`, and `required`.

Owner-side code must remove raw data before calling the adapter. The adapter
never accepts or stores pull-request bodies, review comments, CI logs, model
prompts/responses, shell commands, filesystem paths, tokens, cookies, or
credentials. All URL references, including query/fragment data, are rejected;
callers should pass an opaque receipt or artifact ID instead.

The runtime boundary accepts ordinary or null-prototype data records and
snapshots own data descriptors once. Custom prototypes, accessors, symbols,
all Proxy values (including revoked Proxies), and unknown property names are
rejected before core emission without invoking getters or Proxy traps. The
adapter does not use `gh`, an HTTP/API client, gate configuration, or any
pull-request/CI/review reader.

Identity/model identifiers are at most 128 characters, actions 128, codes 64,
and opaque refs 256. References are single-segment IDs containing only ASCII
letters, numbers, dots, underscores, and hyphens; paths and URLs are rejected.
Every retained-string input also rejects embedded token signatures, including
safe-looking wrappers such as `receipt_ghp_…`, `review_sk-…`, or wrapped Slack/JWT
values. The same check covers IDs, actions/check types, codes, and model/reviewer
metadata; it is not limited to refs. Credential labels such as `token`, `bearer`,
`cookie`, `private-key`, `api-key`, and `secret` are rejected too. All retained
text also has to pass the existing public core redaction contract.

## Mapping

```typescript
import {
  emitAiGateEvidence,
  type AiGateEvidence,
} from "@pi-vista/adapter-ai-gate";

const evidence: AiGateEvidence = {
  run_id: "run-123",
  repo: "pi-vista",
  source_sha: "0123456789abcdef0123456789abcdef01234567",
  check_type: "ci_check",
  status: "success",
  receipt_ref: "receipt-123",
  lane: "P2",
  tier: "tier2",
  reviewer_id: "reviewer-1",
  model_id: "provider/model-v1",
  passed: true,
  required: true,
};

await emitAiGateEvidence(evidence);
```

`action` and `check_type` are aliases, not two events. The mapped action is
always `gate:<action-or-check_type>`. The adapter does not inspect the text of
an action, check name, decision, or verdict to choose a result.

An explicit protocol `result` is retained as-is. `status` maps as follows:

| status | Vista result |
| --- | --- |
| `success` | `ok` |
| `failure`, `cancelled` | `failed` |
| `pending`, `neutral`, `skipped` | `unknown` |

`decision` and `verdict` are optional registry-safe codes only; they cannot
replace `result`/`status` and are not prose. `passed` and `required` are
retained as numeric metadata flags; `required: false` is never treated as a
success signal. `lane`, `tier`, and `reviewer_id` are retained as gate
metadata. `model_id` is exposed through the protocol's generic `model_id`
field. The projection uses observational `gate_metadata` artifact stats only;
it does not set `ArtifactRef.verified` or create a PASS/authorization claim.
A safe `reviewer_id` is omitted when the existing core stats contract cannot
retain it unchanged (for example a slash-qualified ID or one longer than 64
characters). No model count or current dual-model rule is fixed here, and no
core/protocol field is added or relaxed.

## SHA binding

When supplied, `head_sha` requires `source_sha` so the adapter can make an
explicit comparison. A matching pair retains `source_sha` on the event and
both safe summaries in a metadata artifact. A mismatch is not silently
corrected or used to overwrite either SHA: the adapter omits the conflicting
`source_sha` event binding, retains both summaries plus
`sha_relation: "mismatch"` in metadata, maps a non-failed result to `unknown`
(an explicit `failed` remains `failed`), and uses `sha_mismatch` only when no
owner-provided `reason_code` is present. The original owner outcome is preserved
on mismatch as exactly one output-only metadata stat: `owner_result` accepts
only `ok`, `blocked`, `failed`, `unknown`, or `abstain`; `owner_status` accepts
only the status enum in the mapping table above. These stats are derived from
the validated `result`/`status` input, not additional accepted input fields,
free text, or PASS/verification/authorization claims. Neither SHA is selected
as the event binding on mismatch.

The core protocol intentionally is not extended with a `head_sha` property.
The adapter uses a metadata artifact reference for the second SHA.

## What pi-vista does **not** do to ai-gate

- does not affect gate admission decisions;
- does not infer a gate result from free text or create a fake success;
- does not read PR, CI, review, or gate configuration data;
- does not replace independent tests, builds, or typechecks;
- does not merge, deploy, or bypass production, credential, or billing gates;
- does not choose models or fix the current model-count policy.

`ai-gate` remains the final admission owner. The adapter observes only the
owner-side evidence already selected and redacted by ai-gate.

## Failure mode

`toVistaEventInput` and `emitAiGateEvidence` reject malformed evidence before
calling the store. Store I/O failures and persistence timeouts are fail-open
through `@pi-vista/core`; they never block gate execution. The default
persistence timeout is 250 ms and can be overridden with the core
`persistTimeoutMs` option.
