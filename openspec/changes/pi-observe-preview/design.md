---
doc_type: spec
project: workspace
owner_repository: chenhaoxiang/pi-vista
status: active
truth_mode: maintained
created: 2026-10-07
verified: 2026-10-07
---

# Runtime contracts

## Explicit wiring and privacy
A trusted host supplies sanitized task/repository aliases, exact SHA/policy/environment labels, safe tool classifications and explicit observation stores/callbacks. Paths exist only in private store configuration, never protocol data. Never infer a task from the prompt, tool args, output, messages, cwd, environment or saved sessions. Factory/import performs no external I/O or timer/process discovery. Use fixed value-free errors. No implicit current proof or signing/sink port.

## Observation is not coverage or authority
Use public Pi notification hooks: session start/shutdown, agent start/end/settled, turn metadata and actual tool execution start/end. Never register tool_call/tool_result/user_bash/input/context/provider transforms, model-callable tools, continuation or permission hooks. Synchronous notification handlers return undefined and dispatch bounded best-effort work outside the awaited Pi path. Parallel and nested executions receive unique generated step bindings, with raw native call identifiers retained only in bounded transient correlation state and not emitted. Low-level agent_end does not settle a run; retries/continuations stay within the active observation epoch until agent_settled. Missing/dropped/unmatched observation stays explicit and cannot establish complete guard coverage, task PASS or gate/test evidence. Late completions from replaced/closed epochs cannot publish into the new task.

## Preview and explicit selection
Create the existing portable recall from explicit pins/clock/ports. Bind query to exact bank/repo/SHA/policy/environment/task, show provenance and whole bounded safe Script/Step entries, historical-authenticated/current-not-checked/authorization-none/executable-false. No generated knowledge pages, raw model text, stored flags or structural lookalikes as proof. Task-start preview may be scheduled nonblocking only when explicitly configured; commands can request it explicitly. Host read ports are trusted and may read a real configured source later, but this delivery tests only fixtures and writes nothing.
An exact current-epoch preview digest may be explicitly selected. Selection is a local acknowledgement of guidance, NOT prompt/editor injection, execution, promotion, current verification or persistence. Invalidate selection after task/epoch/binding changes or stale history; copies/foreign plans and wrong digests reject.

## Status and current proof
Expose bounded frozen controller status and UI command output without model messages. MISSING is explicit when history pins/ports or owner evidence are absent. An optional exact evidence-factory verifier can serve an explicit verification command; only its private fresh bound proof can display current-verified. Its configuration/key provenance remains host responsibility. Historical authentication or a selected preview never supplies that proof; status expiry and changes clear it. There is no promote, archive, replay, check-repair, memory write or authority override command. CLI stays offline/read-only.

## Public host compatibility
Use a minimal structural subset of the PUBLIC ExtensionAPI and ExtensionContext, with no private imports or bundled Pi SDK. Verify assignability/loading/dispatch against an exact installed public SDK pin. Node20 remains library/fixture support, not a claim that current Pi runs on Node20 (installed Pi1.0.4 requires Node22.19+). Separate mock-host library tests from actual SDK dispatch acceptance; both use synthetic metadata and no providers/credentials.

## Bounded fault behavior
Cap pending observer work, tool correlations, preview counts and content characters. Handle native promise timeout/rejection/late results without leaks or unhandled rejection. Slow or failed observers/recall/UI must not block a primary tool or change its result. Trusted host callbacks execute in-process and are not sandboxed/preempted. No universal secret detector, distributed durable state or authorization claim.
