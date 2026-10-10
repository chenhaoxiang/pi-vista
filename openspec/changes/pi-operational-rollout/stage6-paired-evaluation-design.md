---
doc_type: spec
project: workspace
owner_repository: chenhaoxiang/pi-vista
product_line: pi-vista
release_scope: source/actual evaluation candidate; release account/channel/version undecided
status: active
truth_mode: maintained
created: 2026-10-10
verified: 2026-10-10
---

# Stage6 paired effectiveness/cost evaluation

Stage1 actual AgentSession canary, Stage2 candidate construction, Stage3 local host, Stage4 dedicated-bank guidance and Stage5 source plus one scoped LOCAL workflow are delivered separately. Stage6 now starts with a **bounded offline-source plus actual-runtime pilot**: the same fixed synthetic tasks are run in fresh in-memory sessions with and without an explicit historical guidance context. The pilot is evidence for the selected task set only; it is not a general capability, product release, default activation or permission change.

## Paired contract

Each pair uses the same exact source SHA, SDK/runtime, provider/model/thinking level, system prompt, tool definitions, task prompt, timeout and round budget. Only the explicit context block differs:

- **baseline**: no experience context;
- **guided**: a bounded context from the already accepted synthetic Stage5 history, explicitly re-imported as observed with a NEW run/identity and then freshly verified by the opt-in LOCAL library before current selection/compilation. The persisted history stays `current_verification=not-checked`, `authorization=none`, `executable=false`; no saved proof or status is restored.

The context is inserted into the user prompt by the evaluation host. Its safe canonical history is read from the existing protected local Stage5 reference/preview, matched to the accepted document digest and validated as historical only through an explicitly trusted local read port; there are no new real-bank calls. The subject source remains exact846 with its matching policy/environment bindings. A separate current fixed host source/native/consumer plan and fresh source/byte checks collect proof in the same factory domain; fixed timestamps/finite freshness cannot be reset by old history or reused JSON. The harness's own source/SDK identity is reported separately from that subject source. This is not a claim that native repo tests prove semantic instruction quality; paired task predicates measure that. It is not loaded from the real Hindsight bank, not automatically injected by Pi, not treated as an executable plan, and not allowed to alter tools, model, system prompt, gate, guard or safety rules. Each run has a new in-memory `SessionManager`, explicit owner ResourceLoader, fixed custom tools and a fresh runtime; no persistent session files or default resource discovery.

The pilot contains four deterministic synthetic metadata-validation cases (healthy, stale compiled artifact, environment mismatch, missing required metadata) with fixed success predicates: actual fixed inspector tool-name/argument traces and strict bounded final decision JSON matched to host-owned fixture truth. Truth/answer labels are not placed in the guidance. Four pairs use eight fresh sessions, a maximum16actual model requests/two per session, balanced baseline-first/guided-first case order, common max thinking and generation/deadline bounds. The tool handlers only return synthetic fixture metadata and never read arbitrary files, network, credentials or a real bank. A run is `success` only when the model completes the marker and the trace predicate; cancellation, provider error, malformed call, wrong arguments, timeout or extra action is a non-success observation, not a retry. Do not silently retry a failed pair; preserve the first result and classify the failure.

## Measurements

For every run record only bounded metadata: pair/case/arm, run/session identity digest, source/runtime/model/thinking labels, success predicate, failure category, wall duration, model request attempts, `Usage` input/output/cache/reasoning/total tokens and SDK-reported cost, tool-call count, retry/cancellation flags and safe output digest. Never store prompt text, model prose/reasoning, tool bodies, credential values, endpoints or raw traces. Compare paired deltas by case and aggregate only when all cases have valid measurements.

Use the retained public SDK1.0.4 admitted by the unchanged sdkPin helper; the similarly numbered fork1.0.4-fork.1 is NOT relabelled as it. The selected provider/model is current codex-local-8319/gpt-6.1-sol:max; the existing single-file broker is readonly and SHA-pinned, never executed as a shell command. Catalog/availability refresh, retries, compaction, resource/HOME/ancestor discovery and daily configuration are disabled through existing explicit canary boundaries. Missing/unsupported SDK/model/broker is a real technical refusal, not an excuse for model/channel fallback. SDK pricing defaults may be zero/unconfigured; report zero-as-unpriced/unknown, not free spend or independently billed cost.

Report:

- paired success/trace accuracy and disagreement counts;
- completion time and model request/token/cost deltas (`guided - baseline`);
- extra tool calls/failed attempts and failure categories;
- missing/unavailable provider, timeout or resource errors as `UNKNOWN`, never as success;
- confidence/limitations: four synthetic cases and one model/runtime window cannot prove model capability improvement, business ROI, generalization or cost reduction.

The evaluation itself is fail-open with respect to the host task: observer/store/report failures do not change model prompts or execute fallback actions. No automatic model selection, weighting, prompt policy, guard/gate threshold or learned bypass is allowed. A missing guidance context produces a labelled baseline/unknown result, not an invented guided success.

## Acceptance and release boundary

First run closed parser/metric/aggregation tests and the full existing source/consumer/Node20 gates. Then run the explicit actual pilot using the existing approved readonly credential broker and current selected model, with a hard global request/elapsed budget. Save sanitized aggregate evidence under test-owned `tmp/`; preserve failed runs and raw only when they are already sanitized and explicitly allowed, otherwise keep only safe digests/counters. No real Hindsight writes occur. Any future expansion in cases, model/provider, bank, deployment, account/channel/version or release/rollback is a new scope decision and evidence chain.
