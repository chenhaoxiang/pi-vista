---
doc_type: spec
project: workspace
owner_repository: chenhaoxiang/pi-vista
status: active
truth_mode: maintained
created: 2026-10-11
verified: 2026-10-11
---

# Stage6 native SDK acceptance — model-free candidate

This slice reuses the delivered SDK/broker provenance collector, pilot coordinator,
strict decision tool and deterministic reference oracle. It is a single
`healthy-metadata` synthetic SDK/tool-lifecycle check, not the eight-session paired
pilot, quality measurement, current LOCAL proof, publication or default activation.

The explicit runner accepts only `sdk` and `source_sha`; unsupported options,
getters/proxies, missing source identity and Node below the SDK's `>=22.19.0`
engine refuse before SDK import or provider transport. Before and after the run it
checks the actual checkout HEAD, clean tracked/untracked state and runner bytes.
This is a runner/checkout binding, not a full fresh-build/dependency graph or
independent vendor authenticity claim. SDK identity is the existing public
manifest/entry contract for installed `1.1.0-fork.1`; the old public `1.0.4`
measurement contract is unchanged.

The runner creates only test-owned private fixtures under repo `tmp/`: empty
synthetic auth/models/settings and a fake broker target. Its SDK ModelRuntime uses
in-memory catalog/credential ports and explicit resources, no bank/history or
real credentials. It does not load the daily Pi extension/profile configuration.
The fixture provider/model and `high` thinking are explicit synthetic test
settings; the primary session's provider/model/max thinking/tools/prompt are not
changed or silently downgraded.

The SDK's actual `openai-completions` serialization is exercised, but every fetch
for the fixed dummy endpoint is intercepted locally and answered by synthetic
SSE. There is no network fall-through. The observed payload checks cover the fixed
fixture model and two tool names; they do not claim to validate every final real
provider field, real auth/header source, financial effect or live request contract.
A native SDK read tool reads the one synthetic metadata file; the strict
`stage6_decision` returns `terminate:true`, so no third provider round is required.
The reference oracle supplies this synthetic response; it is not an LLM judge or
an actual model decision.

One coordinator window owns exactly two synthetic pretransport attempts. Profile
and provenance are bracketed, the selected fixture model/thinking/tools/prompt
are compared before/after, and the original stream is restored before session
disposal. The receipt remains `metadata-only`, `evaluation_status:not-evaluated`,
`authorization:none`, `executable:false`; no source/mock result is promoted to a
valid paired evaluation or current permission.

## Candidate validation boundary

- Local prototype and explicit runner exercised SDK `1.1.0-fork.1` on Node26.9.0:
  two intercepted synthetic responses, native read and terminating strict
  decision, unchanged profile/provenance. These are preparation-time candidate
  artifacts, not independent review/CI/main delivery.
- Node20 SDK loading genuinely failed on the SDK's `node:fs.globSync` import in the
  prototype. The runner now refuses below Node22.19 before SDK import; the original
  failure is retained. Node20 source/consumer gates remain supported and are not
  claimed as SDK runtime acceptance.
- Invalid source/dirty candidate runs remain refused; no old source hash is used
  as a current runner acceptance claim.
- The four source regressions cover explicit options, hostile DTOs, source mismatch
  and inert import without a model or SDK start. Full source/consumer/Node20,
  independent review, exact CI/main and final source-bound runtime acceptance are
  still pending for this candidate.

The complete four-case baseline/guided matrix, error/cancel/drift runtime scenarios,
real final request envelope, source/history readback and a new bounded k=1 model
window remain separate following work. The old 16-call INVALID pilot is neither
executed nor re-used here.
