---
doc_type: spec
project: workspace
owner_repository: chenhaoxiang/pi-vista
status: active
truth_mode: maintained
created: 2026-10-08
verified: 2026-10-08
---

# Stage3 amendment: single-owner local host evidence

## User decision and preserved history

Stage1 source/docs PR20/21 and Stage2 source/docs PR22/23 are delivered. Stage2 final main is a595b5991fb2a850e5de525a70067fd814d5bf80, tree49df5b77e93368f13d66c34750fd193fed06a416. The fresh Stage2 six-document review was same-model/read-only, OK with notes/0P0/P1/P2, SHA25603d03fdf6a87b385ffd7ceaa2070febbb086684c5c684ab8f9704007c734452b; head/main CI37801144194/37801638062 succeeded on Node20/22/26.

On2026-10-08 the user explicitly chose **local trusted-host mode** instead of establishing a new owner Ed25519 signer. The user is the sole human Owner; the coding assistant executes the authorized task but is not a separate human approver. This changes the operational trust scope, not the truth of earlier signature/producer MISSING findings. No previously unsigned record becomes a signed receipt.

Meta current source7bb511531e24b51514550f5fc56d9497c77f6196 and its owner session confirm PR536/537 policy/reader are not v1 producers or signing custody. Existing guard metrics omit unmatched allowances and swallow observation failures; App RS256 JWTs authenticate GitHub App calls, not these receipts. The existing signed evidence/archive/file paths remain unchanged and missing actual owner/key acceptance.

## Trust boundary

The host explicitly installs native collection callbacks; model output, JSON flags, UID, screen-unlocked state, arbitrary process-local callers and filesystem permissions are not independent Owner authentication or result truth. Current conversational authorization establishes this task's authority, not all future operations. Native macOS authentication may be used by a later host for a necessary fresh personal confirmation; this slice neither detects screen lock nor implements or claims a Touch ID/password broker. It never reads passwords or automatically queries Keychain.

The explicit `@pi-vista/evidence/host` addon produces **local-host-process** proof objects with authorization none and executable false. Factory/handle WeakMap identity is process-local. Copy/serialize/restart/other factory cannot restore proof. No key generation, signing, crypto receipt acceptance, disk/network discovery, environment/profile lookup, implicit producer or default Pi hook is installed. Existing signed factory identity stays distinct; original Learning still accepts only the original signed verifier. A later explicit local Learning factory belongs to Stage5, not a silent root acceptance change.

## Closed contract

Configuration pins mode=local-host, a safe scope label, unique subject/producer/kind callback identities, positive required gate checks/test suites, gate version/config digest, a trusted clock, bounded age and collection deadline. All source objects/options are own-data snapshotted before use; getters, proxies, unknown keys, duplicate/unsafe labels and unsupported versions refuse.

Every collection returns a closed schema1 observation with scope, kind, producer, exact run_id/repo/source_sha/policy_version/env_fingerprint, result_ref, observed_at/expires_at and kind-specific details. Existing canonical v1 payload validation is reused as a data validator only, not to construct receipts or sign messages. Successful gate evidence requires pass (never override), exact pins and every required check pass. Tests require positive reconciled native case totals, no failures/skips/cancellations and each required suite. Guard requires positive events, complete coverage of the **explicit declared host scope**, zero blocks. Incomplete/drop/unmatched/unsupported coverage cannot be repaired into complete.

Each proof is detached/deep-frozen, carries the scope and bounded safe summaries/digests, and never carries raw command/path/key/body/error/model prose. Digests identify immutable observations only; they are not signatures or tamper evidence outside this process. Verify re-collects all3 sources and checks all five bindings and freshness. Revalidate re-collects, requires identical observation digests, revokes the old handle, and cannot reuse failures or changed observations. Failed revalidation revokes the challenged proof. Expiry, monotonic elapsed age, clock rollback, shutdown and late collection results cannot revive proof. There is no cross-process time authentication.

## Actual bounded acceptance plan

An explicit local-only host command executes the existing unchanged offline source and packed-consumer gates, binds actual HEAD/clean tracked source before/after, consumes original native case records (not stdout totals or passed flags), and uses this new addon through its public export. No live model/SDK, owner policy, bank or real credential call is part of this test. Protocol's deliberate zero-case package is excluded rather than counted as positive test coverage; todo is not counted as success.

The acceptance guard covers the wrapper's **fixed host command admissions** only: declared processes are registered, admitted and settled exactly once; unknown, duplicate, incomplete or failed admissions refuse. It does not claim to inspect nested child processes, filesystem calls, arbitrary tools, Meta guard events, OS/native syscalls, NFS/ACL or all-day Pi. That scope is explicit in the config, observations, proof and report; a signature would not enlarge it either. Actual source counters/build/typecheck/consumer completion remain separate from semantic coverage, billing and operational product acceptance.

Gate and callback reads remain trusted host execution, not hostile-code containment. Timeouts are cooperative/bounded waits and cannot undo already performed host effects. Ordinary tests and CI use synthetic offline seams only; the effectful local acceptance command requires explicit opt-in and exact source SHA, creates test-owned output under tmp, uses fixed commands and no arbitrary shell/task input, and never changes the primary Pi task result.

## Stages4–6 and non-goals

Sequential order remains. Stage4 must establish the actual isolated Hindsight service/bank/permissions and exact guidance-document readback; persisted local results are **historical guidance, current verification not checked**. The existing signed archive/store interfaces are not weakened to accept unsigned data. Stage5 introduces an explicit local observe→candidate→fresh host verification→preview→confirmation→guidance persistence→recall workflow; restart/history requires fresh verification, not status restoration. Key rotation remains an unresolved optional signed-path responsibility, not a new requirement for the local path. Stage6 compares actual paired effectiveness/cost in the scoped mode, then obtains concrete distribution/release facts. Default activation, production-bank access, learned execution/bypass, model/routing/weights, Meta thresholds/approvals/RootG2/HOLD and SDK declaration repair are excluded.

## Validation and delivery

Preserve all original signed/learning/runtime/assertion blobs except the additive evidence export map and current docs/tasks. Add hostile-input, outcome/binding/pin/coverage/freshness, lifecycle/copy/restart/shutdown/late-result and original-signed-domain separation regressions. Use Node20/26 source + exact11-tarball public consumer checks/strict locked TS, installed behavior probes, the opt-in actual local host command, fresh same-model independent read-only full-diff review, normal PR/head+main hosted CI and remote inclusion/canonical readback. No source candidate is called a completed operational stage before these applicable facts are verified.
