---
doc_type: spec
project: workspace
owner_repository: chenhaoxiang/pi-vista
status: active
truth_mode: maintained
created: 2026-10-11
verified: 2026-10-11
---

# Stage6 zero-model matrix and failure diagnostics — source candidate

This slice follows the delivered model-free native SDK acceptance runner. It keeps
one coordinator window and eight fresh native agents: four fixed synthetic cases ×
baseline/guided arms, two pretransport attempts per row, total 16. It does not
open one window per row, reuse the old healthy runner as eight pilots, call a real
model, write a bank or change default Pi.

The guided arm is explicitly a synthetic context string with a matching digest. It
is not a LOCAL readback, verified history, current proof, ROI result or permission.
The SDK fixture remains installed `1.1.0-fork.1` with `high` thinking in the
isolated host; it does not change the primary session's model/thinking/tools.

## Actual synthetic matrix boundary

The runner uses the actual installed SDK's provider serialization and local
synthetic SSE responses. For each row it dispatches the native read implementation
inside the custom inspector and then a strict terminating `stage6_decision` tool.
The deterministic `referenceDecision` supplies the synthetic response, while
`caseTruth` independently checks the final parsed decision/reason pair. Each row
records synthetic request count, native-read implementation use, arm scope and
safe task/guidance digests. The one window's coordinator receipt must report 16
pretransport attempts and unchanged profile/provenance.

The report remains `evaluation_status: not-evaluated`, `authorization:none`,
`executable:false`; all model-quality, cost, billing, current-permission and
publication conclusions remain out of scope. Credential-store attempts are counted
from the injected in-memory stub; real model/bank/credential-byte effects are
fixture scope statements, not universal egress or billing measurements.

## Failure and malformed-decision contract

The offline failure table keeps `tool-not-called`, `schema-invalid`, `refusal`,
`provider-error`, `cancelled`, `timeout`, `deadline` and `stream-disconnected`
separate. Malformed decisions must be actual completed calls with invalid argument
shapes/enums or wrong case, not an unsupported status shortcut; semantic mismatch
uses a valid structured call with an intentionally wrong decision/reason and an
independent case truth table. A late valid callback cannot convert a cancelled or
expired row into `decision-valid`.

Budget exhaustion, copied admissions, duplicate agents, finalization, profile drift,
provenance drift and cleanup are tested as separate windows/counters where needed;
they do not borrow or replay the main 16-attempt window. The matrix does not add a
new global ledger or execution lock.

## Current preparation evidence and pending boundary

At preparation HEAD `5e24e8e`, the actual SDK/Node26 matrix completed one native
window with 16 intercepted synthetic responses, all eight `decision-valid`, native
read implementation use, unchanged profile/provenance and 1,696 injected
credential-store read attempts with no credential-byte reads. This is candidate
worktree evidence only; source/consumer/Node20 library gates remain separate and
no model/bank/default-Pi claim follows.

- [x] Reference matrix: 8 rows, exact four-case × two-arm coverage, deterministic
  oracle and distinct non-success diagnostics with no model calls.
- [ ] Actual SDK matrix failure injection: cancellation/timeout barriers,
  malformed completed calls, semantic mismatch, drift, request-guard rejection and
  cleanup/late-callback lifecycle must be run in a fresh bounded window.
- [ ] Fresh independent review, exact head/main CI, ordinary PR/main readback and
  a sanitized evidence closeout for this matrix candidate.
- [ ] Only after these harness gates, decide whether a new model `k=1` window is
  worth running. The old 16-call INVALID window remains exhausted and is not used.
