# @pi-vista/checks

The bounded Phase 3A programmatic Check Function foundation. Trusted host code
explicitly registers in-process boolean predicates for existing
`VistaCheckFunction` descriptions; the package does not load behavior from
protocol data, JSON, models, shell text, or module paths.

```ts
import { CheckRegistry } from "@pi-vista/checks";

const checks = new CheckRegistry(); // no handlers by default
checks.registerBindingPredicates(); // opt-in sha_matches and env_matches only
const report = await checks.run([
  {
    check_id: "env-binding",
    type: "env_matches",
    params: { expected: "sandbox-1", actual: "sandbox-1" },
    on_fail: "STOP",
  },
]);
// report.satisfied === true: metadata matched, NOT environment verification
// report.verification === "predicate-only"; report.authorization === "none"
```

All definitions, params, host context and options are validated and detached
before any callback. Reports omit params/context/descriptions/errors. STOP
halts on false; WARN continues but remains unsatisfied. Missing implementations,
invalid verdicts, errors and timeouts fail closed regardless of WARN. REPAIR is
unsupported and rejected before callbacks; repair IDs are never resolved.

The runtime has no filesystem, network, execution, persistence, CLI, Hindsight,
owner-probe or authorization integration. Predicates cannot grant replay, merge,
release or promotion permission. Asynchronous waits are bounded; timeout cannot
preempt synchronous trusted code or undo side effects, and AbortSignal is
best-effort only. The host owns callback and native-promise safety.

See [the maintained Check Functions guide](https://github.com/chenhaoxiang/pi-vista/blob/main/docs/check-functions.md) in the
source repository for the public API, strict safe-data subset, exact bounds,
ordering and validation limits. Source/build/pack availability is not a registry
publication, clean install, Node 20 runtime or production acceptance claim.
