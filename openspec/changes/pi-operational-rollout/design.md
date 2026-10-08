---
doc_type: spec
project: workspace
owner_repository: chenhaoxiang/pi-vista
status: active
truth_mode: maintained
created: 2026-10-07
verified: 2026-10-07
---

# Contracts and stage gates

## Stage1 isolated actual session
Use public pinned Pi SDK1.0.4 on actual Node26 (SDK requires>=22.19); create real AgentSession with explicit model/runtime, in-memory settings/session, independently private agentDir, no resource/context/MCP/default extension discovery. Supply only explicitly allowlisted fixture tools, no general shell/write/host access. Fixed synthetic tasks run on actual approved model; raw prompt/output/history/tool bodies remain in-memory SDK data, never Vista events/checkpoints/reports. Observe metadata only.
Actual phases: startup/normal task, nested parallel fixture calls, abort during a waiting tool, subsequent run, public reload with newly constructed addon, and awaited public runtime teardown/shutdown. All observer ports are explicitly private test stores or controlled failure ports. Cross-epoch late results, dropped coverage and nonfinal agent_end remain non-authorizing. Core append/readback compares exact redacted event values as an unordered multiset, since concurrent file append order is not a total-order contract. Intentional cancellation may end with SDK error stop only if both the waiting tool signal released and the original model request signal is actually aborted; preserve original stop reason/error category and never count it as task success. Historical previews use explicitly labelled synthetic archives in this stage, not real owner history or bank.

## Readonly approved model access
No private SDK import or global SDK/profile patch. The host snapshots and closes the explicitly designated selected provider/model configuration, then registers that snapshot in public ModelRuntime with modelsPath:null; arbitrary sampling/header/compat/routing controls and environment expansion reject. Only the exercised openai-responses API is supported. The actual provider onPayload checks final store:false/model/fixed-tools/mapped-effort/latest-task fields before HTTP transport, and effective thinking is observed from session.thinkingLevel or remains not-captured; an app-owned CredentialStore returns only the designated provider's existing API-key credential in memory and refuses writes/delete/OAuth refresh. Model catalog storage is in-memory and network refresh off. No dump of provider config/auth/key/header/endpoints; sanitized reports retain provider/model/API/effective thinking, counters, identity digests and failures without raw diagnostics. Static credential mode defaults to refusing commands. The explicitly enabled SHA-pinned broker mode accepts only the designated provider's single canonical private-file cat lookup with restricted path characters; no arbitrary commands/expansion/pipe or write are accepted. It keeps SDK key resolution in process and compares private broker-target metadata separately. Before/after protected-file metadata must remain unchanged; volatile directory drift is separately reported with unknown concurrent-host attribution rather than hidden or attributed to this trial. These checks do not prove OS sandboxing. Nothing restores exposed/unproven credentials.

## Evidence and remaining stages
Stage2 candidate construction is constrained host semantics/templates, not direct model prose ingestion or status promotion. Stage3 requires truthful original owner results, all5bindings, required checks/suite totals/complete coverage, signer custody/public provenance and all3receipt kinds; missing roles remainMISSING. Do not sign old observations as owner truth or use Driver/GitHubApp records as v1 authority.
Stage4 targets a confirmed separate real test bank/service/version/permission, read-first then explicitly confirmed synthetic writes/original readback/restart/failure acceptance; project/production banks excluded. Stage5 reuses verified learning/portable/store APIs and adds scoped operator/lifecycle/key-rotation/reconciliation behavior, preserving old readonlyvista. Stage6 measures paired same-binding representative tasks and actual cost/time/intervention/rework before scoped distribution; account/version/channel/rollout facts must be known. No claims from synthetic coverage alone.

SDK full dependency declaration health remains a separate unresolved43-diagnostic item. Actual public runtime/AgentSession evidence is not full SDK type-health acceptance; root/library/consumer strict gates must never be weakened. Keep actual-model/service trials opt-in and out of ordinary CI. Preserve existing assertions, ordinary PR/source review and remote-main readback.
