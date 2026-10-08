---
doc_type: runbook
project: workspace
owner_repository: chenhaoxiang/pi-vista
status: active
truth_mode: maintained
created: 2026-10-08
verified: 2026-10-08
---

# Explicit actual AgentSession canary

This opt-in stage1 harness exercises actual public Pi1.0.4 AgentSession and an
operator-approved model, not manually dispatched SDK events or a simulated
provider. It creates private invocation-owned fixture workspace/agentDir/store
paths under checkout `tmp/pi-agent-canary`; settings, sessions and model catalog
are in memory. Source/strict tests, actual model acceptance, independent review,
GitHub CI and merged-source delivery are separate evidence. The implementation
is still provisional until those final source-delivery checks complete.

It does not install/activate resources in a daily Pi session, change tools/models/
safety rules, access a real Hindsight bank, create owner evidence, promote a
candidate or publish packages. Every observation says authorization none. The
exact approved model is pinned, with no channel/model/thinking fallback.

## Explicit invocation and limits

After building the existing packages, use an explicit operator invocation:

```sh
node scripts/pi-agent-canary.mjs --allow-live \
  --sdk=/absolute/pinned-public-sdk \
  --profile-dir=/absolute/approved-private-model-profile \
  --provider=approved-provider --model=approved-model --thinking=max \
  --output-root="$PWD/tmp/pi-agent-canary" --test-namespace=pi-agent-canary \
  --source-sha=<exact-source-commit> --max-model-rounds=16 --deadline-ms=1200000
```

This is actual paid/quota-consuming provider work; source CI NEVER invokes it.
Missing `--allow-live`, unknown/duplicate/missing options, wrong namespace/root,
unsafe metadata or budgets reject before SDK/profile use. Only Node>=22.19 with
exact public SDK1.0.4 is admitted; Node20 supports offline script/library tests,
not live SDK acceptance. Supplied source SHA is an operator binding, not a Git
attestation; script and public runtime digests identify bytes actually run.

Static mode requires the selected existing API-key credential and refuses
command-based config. Optional `--readonly-broker-pin=<sha256-of-command-after-!>`
uses the operator-approved existing SDK broker path only when it is exactly a
single `cat /canonical/private/file` lookup under the designated profile, with
restricted path characters, current-user/private regular file and private parent.
The SHA is an explicit runtime pin, not a default capability. No shell controls,
expansion, arbitrary command, OAuth refresh or credential write/delete is allowed.
Never put actual broker command/file/key values into this document or a PR.

Only the chosen provider is requested from the readonly CredentialStore; list
returns no credential metadata, modify/delete reject, and resolved keys stay in
memory for privacy checks. ModelRuntime's catalog/network refresh is disabled.
The SDK still runs as the current OS user: this is controlled-resource isolation,
**not** a hostile-host sandbox or a guarantee about untrusted provider code.

## Actual trial and acceptance

The primary real session runs fixed read-only fixture tasks:

1. Model-issued read tool and exact fixed completion marker.
2. Model-issued parent tool using public `ctx.executeTool` for two genuinely
   overlapping fixture reads, with distinct nested IDs and out-of-order completion.
3. Model-issued waiting fixture tool, then actual `session.abort()` after it starts.
4. Another successful prompt on the same session after cancellation/settlement.
5. Public `session.reload()` with a newly constructed addon instance, then a
   successful model/tool task under the new observer generation.
6. Awaited public AgentSessionRuntime.dispose shutdown with no observer revival.

A second real session repeats parallel tasks while observer callbacks reject,
hang and reject late. The original task/tool bodies stay intact; loss and held
callback quota are reported, never called complete coverage or task/gate PASS.
The model can access only the four fixed fixture tools, not arbitrary read/bash/
write, codemode, MCP or another host tool. Inputs use enums; paths/traversal/
symlinks/body replacement and cancellations reject. Toolkit annotations are hints;
fixed handlers and the actual allowlist enforce the test's narrow behavior.

A prompt resolving alone is insufficient: validate final stop/marker, actual
model-issued calls, parameters/results, session/provider/thinking identity,
settlement, unique runs/steps and exact redacted core store readback. Core event
values form an unordered multiset; concurrent append order is not asserted.
Checkpoints remain nonresumable observed metadata with empty completion/check lists.

The cancelled task is **not success**. Pi can return `stopReason:error` on its
aborted follow-up; accept that cancellation scenario only when the fixture tool
signal released AND the original request AbortSignal is aborted. Preserve raw
stop as a label and a closed error category, never the provider error body. Any
ordinary task error, wrong marker, changed model/tool data, budget excess or
unsettled cancellation fails. Automatic retries and compaction are disabled.

## Privacy and report interpretation

Raw prompts, model reasoning/response text and tool bodies exist only in SDK
memory. Vista events/checkpoints/report exclude raw bodies, native call IDs,
private profile/store paths, API keys/headers/base URLs and foreign error stacks.
A CLI-owned diagnostic quarantine counts/discards provider stdout/stderr; it
never relabels diagnostics as passing validation. Own Canary failures expose
only closed codes and owned script basename/line, not absolute/raw stack values.
Late rejections are consumed and unhandled-rejection count must be zero.

The private report records phase assertions, safe run/step/classification labels,
requested/effective model/thinking, real request count, artifact hashes and SDK
session usage. SDK cost zero is **not independent billing or zero real spend**;
configured pricing may be absent. Temporary files are kept as evidence, not
removed or mixed with application/project memory.

Profile metadata comparison reports auth/models/settings/models-store changes
separately from directory-only drift. Protected file mutation or directory
identity/owner/mode change fails. Directory size/times may change through other
active sessions; report that drift as unknown concurrent-host attribution, not
an absolute no-write proof. The broker target has a separate metadata comparison.
No attempt is made to restore, lock or overwrite the operator profile.

Earlier failed child streams, rejected command mode, pre-fix offline failures,
upstream response errors and SDK cancellation representations remain retained
in `tmp/canary-proof/`. Repeating a changed-source or corrected-contract trial is
new evidence, not a retroactive PASS for earlier attempts.

## Offline/source and remaining work

`node --test scripts/pi-agent-canary.test.mjs` uses only synthetic SDK-shaped
hosts, temporary fixtures and dummy credentials. Source/Node20/packed-consumer
strict gates stay unchanged; no dependency/SDK install or base assertion edit.
Actual model calls are explicit parent-operated tests after source inspection.
The prior full SDK dependency declaration failure (42 TS1543 +1 TS2307) is not
repaired or reclassified by real runtime success.

Sequential plan: [operational rollout](../openspec/changes/pi-operational-rollout/tasks.md).
Stage2 experience candidates, real owner producers/public-key provenance,
real isolated Hindsight bank, explicit learning/lifecycle workflow, controlled
paired effectiveness evaluation and confirmed release remain separate stages.
Observation/cancellation/fixture results cannot fill those missing trust roots.
See [Pi addon](pi-observe-preview.md), [source closeout](handoff/2026-10-07-pi-observe-preview-source-closeout.md)
and [phase map](PHASES.md).
