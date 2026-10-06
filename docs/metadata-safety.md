---
doc_type: guide
project: workspace
owner_repository: chenhaoxiang/pi-vista
status: active
truth_mode: maintained
created: 2026-10-06
verified: 2026-10-06
ssot: true
verification_boundary: synthetic-offline-candidate
---

# Shared credential metadata safety

The merged source repairs the **known embedded credential-signature gap** in
core, Pi and workspace-guard, including safe default-ID generation. Reviewed
source `68b382ce20da47c6c43c6a271e645724c262056b` entered `main` through PR #7;
isolated post-merge validation passed 232 tests. See the [merge closeout](handoff/2026-10-06-source-merge-closeout.md)
for commits and evidence boundaries. The completed [integration snapshot](infrastructure-integration.md)
records the old `64c110e9403634600ccbd8ba16d943f083facdf2` candidate and its four
actual-EventStore reproductions; it remains historical evidence, not a claim
that the defect never existed. Source review does not establish live-use,
registry publication, universal secret recognition or release readiness.

## One bounded detector

```ts
import { hasKnownCredential, isSafeSegment } from "@pi-vista/core";

hasKnownCredential("run_ghp_12345678_s0"); // true (synthetic signature)
isSafeSegment("run_ghp_12345678_s0");     // true (lexical shape only)
```

`hasKnownCredential(unknown)` is a stateless primitive-string predicate shared
by core redaction/safe fields and both adapters. It does not coerce objects,
inspect properties, invoke getters or Proxy traps, mutate input, or rely on
mutable regular-expression `lastIndex` state. Its case-insensitive signatures
are:

- `ghp_`, `gho_`, `ghu_`, `ghs_`, `ghr_` and `github_pat_`, followed by at least
  eight ASCII letters, digits or underscores;
- `sk-` followed by at least eight ASCII letters, digits, underscores or hyphens;
- Slack `xoxb-`, `xoxa-`, `xoxp-`, `xoxr-`, `xoxs-`, followed by at least eight
  ASCII letters, digits or hyphens;
- three-part JWT-shaped text: `eyJ` plus at least ten ASCII letters, digits,
  underscores or hyphens, then two dot-separated segments of at least ten of
  those characters each.

These match anywhere, including bare values, underscore/hyphen namespaces,
concatenated prefixes/suffixes and case variants. Conservative false positives
are possible: a matching label is not proof of a real credential. Conversely,
a non-match is **not** proof of safe text. This is not an entropy test, arbitrary
encoding decoder, configurable secret scanner, authentication check or trust
judgment. Producers must still sanitize unknown secrets and raw content.

`isSafeSegment` and `assertSafeSegment` retain their separate lexical/path
contract; a path-safe name may still contain a credential signature. Trusted
storage configuration such as an absolute `baseDir`, stores, clocks and host
callbacks is not recorded metadata. This fix does not sandbox callbacks or
reinterpret valid storage configuration as event input.

## Write and read boundaries

- **Core:** known signatures are removed from retained values and property
  names, artifact refs/stats, custom components, version labels and URL origins.
  Existing URL path/query/fragment redaction remains in place. Optional text
  uses fixed redaction markers; invalid event/checkpoint identities and
  post-redaction identifier arrays reject with value-free `VistaProtocolError`
  before persistence. Store I/O and bounded observation failures remain
  fail-open, not authorization.
- **Core readers:** synthetic legacy JSONL/checkpoints are validated and
  redacted again. Invalid credential-bearing run/step/component/version records
  are omitted; optional retained text is sanitized. `EventStore.listRuns()`
  also filters known-signature directory names, without deleting or rewriting
  historical files. Best-effort readers are not exhaustive corruption audits.
- **Pi:** explicit run/session aliases, current run/step/session identity, tool
  labels, action/reason/target aliases, artifact refs/SHA/stats and checkpoint
  summaries/identifiers are checked before custom `emit`, `append` or `save`
  callbacks. Unsafe explicit metadata rejects rather than relying on a default
  backend to redact it. Class receiver binding, own-data snapshots, branded
  contexts, step sequencing and timeout/late-rejection behavior are unchanged.
- **workspace-guard:** retained observation text and own-data emission-option
  run/step IDs are checked before core emission, including options whose run ID
  is overridden by an explicit observation. Inherited option identities and
  accessors cannot supply data; Proxy option objects are rejected without
  inspecting traps. Verdict/result exclusivity, rule priority, shadow actions
  and opaque shared-input hashes do not influence any guard decision.

Without an explicit run ID, core and these adapters ignore a known-signature
own `VISTA_RUN_ID`, generate a safe replacement and best-effort store that safe
ID in the environment. Pi omits unsafe own `PI_SESSION_ID` without propagating
its original value. Safe explicit IDs still take precedence and safe own
environment IDs remain usable. Inherited/accessor environment values cannot
supply identities; hostile environment proxies are not inspected.

A generation-only follow-up addresses the candidate's base-36 timestamp collision:
normal timestamp suffixes `ghp`/`gho`/`ghu`/`ghs`/`ghr`, followed by `_` and the
eight random hex digits, formerly matched the detector and rejected implicit
observation. New IDs use a 14-digit zero-padded hexadecimal timestamp. Its alphabet
cannot synthesize those known prefixes; fixed clocks complete without retries or
relaxing credential detection. Padding retains lexical time order for non-negative
safe-integer milliseconds, and the random suffix and base-36 step sequence are
unchanged. Run IDs remain opaque: safe historical base-36 IDs are still readable
and reusable, without rewriting files or requiring a timestamp decoder. This
follow-up does not itself establish independent acceptance or live readiness.

## Scope and evidence limits

The fix changes core/Pi/guard, not protocol interfaces, package versions or
runtime dependencies. Ai-gate, CLI and checks runtime sources keep their
separate stronger policies; they are not replaced with this bounded predicate.
Three CLI test fixtures formerly required the old core gap to survive into CLI
projections. Their prerequisites now assert earlier filtering, with counts
explicitly measured **after core**. A separate synthetic legacy-reader mock
continues to test CLI defense in depth, not whole-system storage safety.

Committed source-named regressions cover the four baseline Pi/guard actual
EventStore cases, zero observer calls/no filesystem changes, matcher variants
and repeatability, source/options/environment/checkpoint/ref boundaries,
read-side legacy metadata, and safe namespace/hash/stat compatibility. All
fixtures are synthetic; no real credentials, owner probes, replay/repair,
production configuration, deployment or publication are part of this evidence.

Recorded `ok`, `verified` and resumable flags remain owner claims. No result
here permits execution, merge, release or overrides workspace-guard, ai-gate or
production safety authority. Node 20, a clean consumer install, consumer
TypeScript compilation and operational acceptance are not established by local
Node 26 builds, tests or manually extracted offline tarballs.
