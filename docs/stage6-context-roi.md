---
doc_type: spec
project: workspace
owner_repository: chenhaoxiang/pi-vista
status: active
truth_mode: maintained
created: 2026-10-14
verified: 2026-10-14
---

# Stage6 context ROI offline analyzer

`stage6-context-roi.mjs` is a pure comparison seam over already-safe baseline/guided
aggregate summaries and context character counts. It does not read model/bank/profile
state, call a provider, inject guidance, change permissions, or alter `paired-data`
schema. Its result is `metadata-only / authorization:none / executable:false`.

## Decision rules

- Unknown evaluation, profile drift, mismatched denominators or unknown runs produce
  `status=insufficient/recommendation=collect-more`; no optimism or zero filling.
- Semantic/trace regression produces `do-not-inject`; token savings cannot hide quality
  regression. Semantic gain may produce only `inject-candidate`, never default activation.
- Equal success/trace with positive token or context overhead produces
  `not-beneficial/do-not-inject`. A single elapsed improvement is not enough to call
  positive ROI.
- `sdk_cost` remains `unpriced` unless both arms carry an explicitly priced SDK
  estimate; null is not free and no independent billing is inferred.
- The output is a recommendation projection, not an Owner policy, guard/gate result,
  proof, permission or model-routing decision. A host must separately choose whether
  to apply a candidate; this module never does so.

## First actual-window observation

The first bounded actual window had baseline/guided success 4/4 each and no trace,
request or human-intervention delta. Guided total tokens were 10251 versus baseline
6415 (+59.8%), while the ordered row elapsed sum was 22711.6ms versus 26814.3ms
(-15.3%). SDK cost was null/unpriced. The offline analyzer therefore recommends
`do-not-inject` for this observation: no semantic gain and positive token/context
cost. This is a single-window diagnostic, not generalized ROI or a release decision.
