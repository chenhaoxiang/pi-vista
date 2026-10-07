---
doc_type: guide
project: workspace
owner_repository: chenhaoxiang/pi-vista
status: active
truth_mode: maintained
created: 2026-10-06
verified: 2026-10-06
ssot: true
---

# Programmatic Check Functions: Phase 3A first slice

`@pi-vista/checks` supplies a trusted callback registry and an ordered, bounded
predicate runner. It consumes existing `VistaCheckFunction` descriptions but
implements a **strict subset** of that protocol. It is not a replay engine,
owner verifier, environment collector, policy loader, gate, or promotion tool.
The observation CLI has **no check/register commands**.

Core event/checkpoint observation remains **fail-open**. This separate opt-in
predicate API is **fail-closed**: false, missing, malformed, exceptional and
timed-out checks cannot yield a satisfied report. Nothing in either API grants
execution, replay, merge, release or promotion permission or overrides
workspace-guard, ai-gate, platform authorization, or production safety authority.
Every report carries `verification: "predicate-only"` and
`authorization: "none"`, even when `satisfied` is true.

## API and explicit trust

```ts
import { CheckRegistry, CheckError } from "@pi-vista/checks";
import type { VistaCheckFunction } from "@pi-vista/protocol";

const checks = new CheckRegistry(); // empty: no default handlers
checks.registerBindingPredicates(); // explicit opt-in to two pure comparisons

const definitions: VistaCheckFunction[] = [
  {
    check_id: "sha-binding",
    type: "sha_matches",
    params: { expected: "a".repeat(40), actual: "{sha}" },
    on_fail: "STOP",
  },
  {
    check_id: "env-binding",
    type: "env_matches",
    params: { expected: "sandbox-1", actual: "sandbox-1" },
    on_fail: "WARN",
  },
];

const report = await checks.run(
  definitions,
  { repo: "repo-synthetic", task: "job-1", branch: "branch-1", sha: "a".repeat(40) },
  { timeoutMs: 1000 },
);
// { verification: "predicate-only", authorization: "none", satisfied: true,
//   results: [{ check_id, type, status: "passed", reason: "predicate-true" }, ...] }
```

Only **trusted host code** can register an in-process callback:

```ts
checks.register("custom:host/comparison", ({ definition, context, signal }) => {
  // definition/params/context are detached immutable safe-data snapshots.
  // signal is a best-effort AbortSignal, not permission or a hard sandbox.
  const { expected, actual } = definition.params;
  return typeof expected === "string" && typeof actual === "string" && expected === actual;
});
```

`register(type, handler)` accepts existing built-in `CheckFunctionType` names or
safe `custom:<namespace>` types. Duplicate registration throws and preserves the
original handler; nothing silently overwrites or auto-loads code. Custom
namespace segments use ASCII letters/digits followed by letters/digits/`.`/`_`/
`-`, with `/` only as a namespace separator (not a path resolver). Empty segments,
prototype-related names, recognized credential encodings, and a complete bare
shell-command suffix such as `custom:git` are rejected. Namespaced labels such as
`custom:host/git` are identifiers, not executable commands. There are at most
**64** handlers. No unregister, dynamic import, shell, eval, serialized callback,
model selection, hidden retry, or general plugin framework is provided.

`registerBindingPredicates()` atomically registers `sha_matches` and
`env_matches`. If either name already exists, capacity is insufficient, or a run
is active, neither is added. An active run blocks **all** registration with
`registry-busy`; concurrent runs evaluate independently. Once a run returns,
registration is possible again, including after timeout; a still-running timed-out
callback remains the host's responsibility. Registry state is private and each
run uses a handler snapshot. There is **no result cache** across runs or contexts.

## Useful comparisons, not owner verification

Both opt-in predicates require **exactly** the safe string params `expected` and
`actual`:

| Predicate | Passing condition | What it does not do |
| --- | --- | --- |
| `sha_matches` | Both values are 40- or 64-character hexadecimal SHAs and equal case-insensitively | Does not read Git, bind a receipt, verify a source tree, or prove the host's claimed SHA |
| `env_matches` | Both values are safe opaque labels and equal exactly, including case | Does not collect or attest the environment |

Missing/extra comparison params or invalid SHA labels yield a false predicate,
not a passing flag. Structurally unsafe params fail input validation first.
A trusted host supplies both values; equal claims are **not independent evidence**.
No `receipt_present`, `test_passed`, path, branch, worktree, file-content or other
owner probe is registered by default. A future trusted owner may explicitly
install a handler for a supported type; stored `ok`/`verified` flags and claimed
booleans do not install one or manufacture a pass. A syntactically unknown type
is invalid input; a valid type with no handler fails preflight.

## Closed own-data boundary and exact bounds

All definitions, params, context and options validate **before any callback**.
The runner copies own data descriptors once, then reads only detached, frozen
snapshots. It accepts plain objects with `Object.prototype` or `null` as their
prototype, including frozen and non-enumerable own data. Inherited fields are
never read. Definition, params and context snapshots have null prototypes, so
optional fields cannot fall through to polluted prototype getters.

Node-detectable Proxies (including revoked Proxies), accessors, symbols, custom
prototypes, unknown fields, explicitly present `undefined`, non-string scalar
metadata, and nested param objects/arrays are rejected without calling source
getters, traps, iterators, coercion hooks or handlers. Optional fields must be
**omitted**, not supplied as `undefined`, despite the wider protocol interface.
Definitions must be an ordinary dense array, with only own indexed data and
`length`; holes, extra properties, element/method accessors and symbols reject.
An invalid definition anywhere, a duplicate `check_id`, an invalid binding or
REPAIR rejects the whole call, with **zero handler calls**. No empty-list PASS:
there must be **1–64** definitions.

| Data | Accepted bounds/subset |
| --- | --- |
| Definition keys | Only `check_id`, `type`, `params`, `on_fail`, optional `description`, optional `repair_action_id`; required fields must be own data |
| Safe opaque label | **1–128** ASCII characters: first letter/digit, then letters/digits/`.`/`_`/`-`; no prototype names, complete recognized shell words or recognized wrapped credentials |
| Params | **0–16** own string entries; keys **1–32** ASCII characters, first letter then letters/digits/`_`; no prototype, command, credential, path, shell, code, URL or authorization-like keys |
| Description | At most **256** characters, nonempty single-space-separated safe metadata words; not arbitrary narrative; never returned in a report |
| Repair ID | Safe opaque label only; never resolved or executed, even on STOP/WARN |
| Context | Only optional `repo`, `task`, `branch`, `sha`; safe opaque labels, with SHA additionally restricted to 40/64 hex |
| Options | Only optional integer `timeoutMs`, **1–10,000 ms**, default **1,000 ms**, per callback |

The package exports `MAX_CHECKS`, `MAX_HANDLERS`, `MAX_PARAMS`,
`MAX_LABEL_LENGTH`, `MAX_PARAM_KEY_LENGTH`, `MAX_DESCRIPTION_LENGTH`,
`DEFAULT_TIMEOUT_MS` and `MAX_TIMEOUT_MS`. Lengths are JavaScript UTF-16 code
units; accepted labels are ASCII. Labels are symbolic data, **not raw paths,
URLs, shell/code, credential values, model text, artifact bodies or permission**.
For example a branch containing `/` is not an opaque context label in this
slice. Host-private paths and collection details stay outside definitions,
params, context and reports. The conservative credential/command filter can
reject innocent lookalike labels; it is not a proof that every conceivable
secret encoding can be detected. Producers must obey the privacy contract.
Bounds constrain retained metadata and callback waits, not reflection costs for
arbitrarily huge hostile JavaScript objects or all host memory/CPU use.

### Whole-value placeholders only

Only a param value exactly equal to `{repo}`, `{task}`, `{branch}` or `{sha}`
resolves from the explicit structured host context. The context itself contains
safe concrete labels, never templates. Missing/unknown placeholders, partial
interpolation (`prefix-{repo}`), repeated placeholders, or unsafe resolved values
reject before callbacks. Values are checked again after resolution. No shell,
path, filesystem, environment-variable or template interpolation occurs. The
original inputs are neither frozen nor modified by the package; later source
mutation cannot affect the run's immutable snapshots.

## Ordering and fail-closed results

After structural prevalidation, missing handlers **anywhere** reject preflight
without invoking even earlier registered callbacks. Missing checks report
`failed/missing-handler`; all other checks report `skipped/preflight-rejected`.
Otherwise callbacks run once, in definition order, awaiting each result before
the next callback. All result entries retain input order:

| Outcome | Status / reason | Next callback |
| --- | --- | --- |
| Literal boolean true | `passed / predicate-true` | Continue |
| Boolean false with STOP | `failed / predicate-false` | Skip remaining: `skipped / stopped` |
| Boolean false with WARN | `warning / predicate-false` | Continue, but report remains unsatisfied |
| Throw/reject | `failed / handler-threw` | Skip remaining, even with WARN |
| Malformed verdict | `failed / invalid-verdict` | Skip remaining, even with WARN |
| Timeout/deadline exceeded | `failed / timeout` | Skip remaining, even with WARN |

A callback must return a boolean or a native `Promise<boolean>` from trusted
host code. Truthy strings, numbers, objects, free-form result shapes, arbitrary
thenables and Proxy values are not verdicts. Native promise transport still
requires a boolean eventual value; the runner uses intrinsic promise handling,
not a returned object's `.then` getter. Callback and native-promise behavior are
trusted host code, not a security sandbox.

Reports and result records are frozen null-prototype, closed projections:
`verification`, `authorization`,
`satisfied`, and `results` with only `check_id`, `type`, `status`, `reason` enums.
They contain no params, context, descriptions, repair IDs, errors, stack traces,
handler source, timings or private paths. `satisfied` is true only when every
requested registered predicate returned true; it is never a trust-promotion or
safety-admission decision. Input/registration errors reject with `CheckError`
and one of the fixed codes `invalid-input`, `unsupported-repair`,
`invalid-registration`, `duplicate-registration`, `registry-busy`; error messages
and stacks contain no source input, original handler error or machine paths.

### Time bounds and repair limitations

An asynchronous wait is bounded per callback. Timeout aborts its best-effort
`AbortSignal`; the runner consumes late promise rejection and ignores late
results, with no retry or change to the returned report. An over-deadline
synchronous return also reports timeout. **A timer cannot preempt synchronous
blocking code, terminate a callback, undo side effects, or force abort listeners
to be safe.** An indefinitely blocking trusted callback can block the process
indefinitely. Scheduler delays can extend wall-clock wait; for ordinary
nonblocking callbacks, the maximum sequential budget is check count times
`timeoutMs`, not a hard process deadline. Host code owns callback/promise safety,
side effects, cancellation and cleanup. The package does not launch workers or
processes to isolate handlers.

`on_fail: "REPAIR"` is **strictly unsupported**, rejected before all callbacks.
`repair_action_id` is never resolved or executed, including on STOP/WARN. The
original protocol describes a future trusted repair policy, not permission for
this slice. No automatic repairs, hidden retries or rechecks occur.

## Separate explicit local addon

`@pi-vista/checks-local` supplies actual registered local filesystem/Git
observations in a fresh trusted-host registry: path presence/absence, actual HEAD
SHA comparison, exact local branch presence/absence and Git status cleanliness.
It does not change this base package's no-I/O runtime, input grammar or reports.
Its same-named `sha_matches` reads HEAD with `{ repo, expected }`, unlike the pure
base `{ expected, actual }` binding; no handler is silently overwritten.

Private roots/repos/relative targets/full refs and the Git binary belong to
detached host configuration, not definitions/context/reports. Params use aliases
and an expected safe SHA. Fixed read-only subprocess settings, conservative
filter/submodule refusals and namespace walks do not provide a hostile Git
sandbox, atomic snapshot, receipt/test/owner authenticity or authorization.
See [local-check-probes.md](local-check-probes.md) for the exact six schemas,
config/API, fail-closed privacy controls and remaining limits. The observation
CLI still has no check commands; REPAIR, replay and promotion remain unsupported.

## Validation and remaining scope

Synthetic public-API tests cover genuine true/false predicates, STOP/WARN/skips,
unknown/missing handlers, duplicate/capacity semantics, strict REPAIR refusal,
pure binding pass/mismatch, placeholders and post-binding safety, hostile
own-data inputs with zero traps/getters/handler calls, immutable mutation
isolation, no cached pass, exceptions/malformed returns/timeouts/late rejection,
closed reports and fixed safe errors. A build-product boundary test checks that
runtime imports are local or `node:util` and contain no filesystem/network/
execution/persistence operations. Trusted host callbacks are not constrained
by that static package check.

Repository typecheck/build/tests and offline workspace pack dry-runs are
separate checks. An offline extracted-tarball ESM/exports/type-presence smoke is
**not** an npm consumer install or consumer TypeScript compilation. Validation
used Node **26.9.0** with the existing locked toolchain; Node 20 runtime behavior
and clean installation remain **unverified**. The manifest requires Node >=20;
source, test and pack availability do not claim registry publication,
deployment or operational acceptance.

The base `@pi-vista/checks` runtime adds no filesystem/network/process execution,
runtime persistence, Hindsight, artifact resolution, CLI check commands, real
gate/guard/owner integration, replay, experience promotion, publication, or
production configuration. The separate local addon does not change that contract.
See [PHASES.md](PHASES.md) and [architecture.md](architecture.md) for the remaining
tracks and safety authority separation.
