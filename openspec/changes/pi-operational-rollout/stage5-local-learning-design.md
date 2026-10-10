---
doc_type: spec
project: workspace
owner_repository: chenhaoxiang/pi-vista
status: active
truth_mode: maintained
created: 2026-10-10
verified: 2026-10-10
---

# Stage5: explicit LOCAL guidance lifecycle

Stage4 source/scoped chunks acceptance is delivered through PR26/27, main22e06da. The original concise failures/journals and signed producer/key MISSING remain unchanged. Continue the user's approved sequence with a separate opt-in `@pi-vista/learning/local` factory, not a root Learning signature fallback or second gate/approval ledger.

## Contract

The host explicitly injects mode=local-learning, a safe scope, the exact `createLocalEvidenceVerifier` identity, and an optional guidance store with trusted native-Promise callbacks. No discovery/config/file/HTTP/client construction, Pi hook, model selection or effect occurs at factory creation. Unknown own-data fields, accessors/proxies and unsupported configuration refuse before callbacks. Root/signed Learning and its current assertions, exports and default behavior remain untouched.

`observe` snapshots an existing safe raw `ExperienceObservation`; `nominate` produces a candidate. `verifyCandidate` accepts only a current opaque local-verifier proof with the exact five bindings and configured scope. It can explicitly refresh a verified/persisted current record with a newly collected proof, never revive a rejected/deprecated/superseded record. Handles/plans/selections are factory-local exact identities, not JSON capabilities. Public status/verification projections have authorization=none/executable=false and are not result truth on their own.

`prepareGuidance` creates an immutable preview from the exact raw observation using the existing canonical guidance schema. Derived root causes, local proof/verification flags, signed receipts and current status are not persisted. The preview binds scope, bank, experience and exact document bytes. `commitGuidance` requires the exact plan object and matching preview digest, refreshes/rotates the held proof before any store effect, then performs a single retain and exact canonical readback within one overall deadline. Proof, lifecycle and current generation are checked before/after awaits. Invalid confirmation has zero store effects and does not consume a plan; once a valid attempt starts, all plans for that record are write-consumed even after failure/timeout. Late callbacks and concurrent lifecycle changes cannot raise persistence or revive handles. Programmatic host confirmation acknowledges already-authorized exact content; no human prompt, broker or approval record is added.

The existing guidance store owns the cooperative durable intent journal and cross-process no-repeat behavior; this library only adds process-local one-shot orchestration. Errors remain fixed failure codes, not false success or raw exceptions. `reconcileGuidance(bank, document)` delegates only the read-only existing-intent reconciliation path and returns matched/not-confirmed with historical not-checked/none/false. It cannot reset intents, reissue retain, mint proof or automatically restore a record. Abort cannot undo an already performed trusted callback effect; uncertain results require this read-only reconciliation, not blind retry.

`readGuidance`/`recallGuidance` accept only closed historical references and validate exact canonical documents, content/idempotency digests, non-authorizing flags and the expected reference/bank. Recall reads bounded references within one deadline, deduplicates, and filters exact repo/source/policy/environment/task bindings. Arbitrary fact prose is not a context source. A library-minted historical view can be imported only as a new observed identity/run with explicit current bindings matching the history; old failure/model measurements are not relabelled as current measurements. Restart/copies/new factories cannot import old live handles/proofs/plans/selections; fresh evidence is mandatory.

Verified local retrieval/context compilation is separate from history: only exact live handles with current proof and matching bindings are eligible. Context has explicit none/false/local labels and a character budget; it is returned to the host, never injected into Pi automatically. Reject/deprecate/supersede invalidate prepared plans and selections. `shutdown` retires the library and aborts its own outstanding store waits without retiring an injected verifier shared by another host. No saved view or late callback can revive the library.

## Validation and bounds

Keep all existing source/assertions/gates/locks/dependencies unchanged except one additive public export map entry. Add hostile own-data, proof-domain/scope/five-binding, state transition, byte/digest/readback, invalid confirmation, one-shot uncertainty, late callback/timeout/shutdown, concurrent state, bounded reference/filter/context, copied/cross-factory/restart and signed-root separation tests. Validate actual Node20/26, exact eleven tarballs/new public subpath, strict locked consumer TypeScript, independent read-only exact-diff audit, normal PR/head/main CI and canonical readback.

This slice's ordinary tests use synthetic trusted callbacks/loopback fixtures and test-owned tmp only. It does not append another real bank sample or consume another model request, change any bank/model/embedding/service/daily Pi setting, claim live Meta/OS completeness, implement a Mac authentication broker or publish packages. Stage5 actual larger workflow acceptance and Stage6 paired usefulness/cost/release remain separately evidenced; no source candidate is called that completion.
