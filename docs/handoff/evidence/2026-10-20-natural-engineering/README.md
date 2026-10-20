---
doc_type: reference
project: workspace
owner_repository: chenhaoxiang/pi-vista
status: completed
truth_mode: snapshot
created: 2026-10-20
verified: 2026-10-20
verified_by: manual
ssot: false
---

# Bounded natural engineering metric projection

`input.json` is a hand-prepared `ai-capability-evaluation-input/1` safe DTO consumed by
`node scripts/ai-capability-evaluation.mjs --summarize`. Field definitions, task aliases,
public PR pointers, correction-round grouping and human-intervention scope are maintained in
[the dated evaluation section](../../../ai-capability-evaluation.md#2026-10-20-接手修复的有限自然样本).

The file has four single-arm records, nine observed rework rounds and no additional required
human decisions within those bounded windows. Missing Usage, wall time, tool counts and
false-intercept denominators remain null. These are supplied, not source-authenticated metrics;
there is no comparable baseline/candidate, AI score, causal ROI, authorization or execution.
No raw session, model input/output, credential, private path or artifact body is included.
The partial Guard observation remains a dated snapshot even if its PR later merges.
