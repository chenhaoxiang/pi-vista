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
This canary admits only the exercised `openai-responses` API; other adapters
require separate contracts rather than a generic config-controlled report label.

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
uses the operator-approved existing key-file source only when its pinned config
is exactly a single `cat /canonical/private/file` lookup under the designated profile, with
restricted path characters, current-user/private regular file and private parent.
The SHA is an explicit runtime pin, not a default capability. No shell controls,
expansion, arbitrary command, OAuth refresh or credential write/delete is allowed.
Never put actual broker command/file/key values into this document or a PR.

Only a closed snapshot of the selected provider/model is written to a private
trial-owned `selected-models.json`, with no API-key or broker-command field.
The public ModelRuntime loads that file at construction with initial refresh
disabled; dynamic `registerProvider()` is not used because SDK1.0.4 automatically
launches broad provider availability checks there. Built-in model metadata may
exist in the SDK, but this canary does not request its availability or credentials. Arbitrary sampling/per-thinking sampling,
headers, compat/model overrides, routing fields and environment interpolation
reject before runtime creation. Endpoint must be HTTPS or local HTTP, without
userinfo/query/fragment; private endpoint values never enter the report.

Only the chosen provider is requested from the readonly CredentialStore; list
returns no credential metadata, modify/delete reject, and resolved keys stay in
memory for privacy checks. In pinned mode the validated ordinary private file is
read directly into that memory store; no shell broker is executed or persisted.
Credential environment overlays are refused. Catalog/network refresh is disabled;
foreign CredentialStore read attempts are counted and must remain zero. Synthetic
public-SDK tests intercept filesystem access and fetch to verify no broad auth
availability scan occurs; they do not create an OS sandbox.
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
hang and reject late. The normal observer uses a bounded500ms timeout, independent from the injected
fault observer's80ms timeout. Late actual disk writes may still complete after a
timeout; eventual readback alone does not erase a dropped observation. The
original task/tool bodies stay intact; loss and held
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
The actual public provider `onPayload` hook validates the FINAL payload before
HTTP transport: exact model, `store:false`, streaming, fixed function tools/no
hosted tools or background/resume controls, mapped reasoning effort and unchanged
latest fixture prompt. A declared model label or response pin is not proof of the
actual request. For `reasoning:false` models, `off` must have no reasoning field;
reasoning models still require their exact mapped effort. Reports count
successfully validated payloads separately from
request attempts and set effective thinking from each actual session observation;
if none was constructed it is `not-captured`.

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

Profile metadata comparison preserves the full original `protectedFilesUnchanged`
result for auth/models/settings/shared-model-cache, and separately reports immutable
configuration (auth/models/settings) and shared catalog metadata. Configuration or
directory identity/owner/mode mutation fails. Directory size/times and the shared
model cache may drift during other live sessions; their actor attribution remains
unknown, never silently relabelled unchanged. This trial additionally wraps the
standard Node file mutation APIs it uses, refusing/counting writes outside the
private trial after SDK initialization begins. Any blocked operation fails; the
scope is trusted SDK standard APIs, **not an OS or hostile-native sandbox**. Raw
paths/data are excluded from the write counters. The broker target has a separate
metadata comparison. No attempt restores, locks or overwrites the operator profile.

The exact original `dd70226` full source review is BLOCK (1 P1/2 P2): arbitrary
sampling could override request safety, a credential-shaped API label was
projected, and effective thinking was copied rather than observed. Original
report/hash and offline zero-transport reproductions remain preserved. The first
correction at `fef037e` addresses those findings but its targeted review is also
BLOCK: dynamic registration triggered broad ambient availability scans, and a
non-reasoning/off payload was incorrectly rejected. The next bounded correction
uses closed private initial configuration, no dynamic registration, and proper
off payload semantics. Corrected-source review/gates/operational acceptance remain
separate pending evidence.

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
