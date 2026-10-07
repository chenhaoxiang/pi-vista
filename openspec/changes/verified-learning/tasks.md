---
doc_type: plan
project: workspace
owner_repository: chenhaoxiang/pi-vista
status: active
truth_mode: maintained
created: 2026-10-07
verified: 2026-10-07
---

## 1. Evidence foundation (inherited #65)
- [x] Pin current owner contracts and record unsigned-source limitations
- [x] Implement authoritative receipts and CheckRegistry probes
- [x] Verify signature, digest, freshness, full bindings, completeness and hostile inputs
- [ ] Implement/accept actual owner receipt producers, production keys/readers and operational provenance

## 2. Learning (inherited #12 and #14)
- [x] Implement exact dry-run and digest-confirmed host-injected ingest/readback with opaque evidence provenance; validate a synthetic in-memory sink only
- [x] Implement process-local lifecycle, failure hypotheses and non-executing recorded replay/comparison
- [x] Verify stale/forged/copied evidence, unsafe content, transport failure and refusal to execute replay
- [ ] Integrate real Hindsight transport/durability, durable cross-process lifecycle/idempotency and crash reconciliation
- [ ] Implement/accept any CLI failure/promotion workflow or executable replay as separately controlled scope

## 3. Shadow and retrieval (inherited #15 and #16)
- [x] Preserve false owner shadow eligibility and non-positive verdict/isolation boundaries in an explicitly invoked normalized adapter
- [x] Implement bounded fresh verified/trusted same-library handle retrieval, model-agnostic script/step character context and offline fixture evaluation
- [x] Validate public shadow->core->unchanged observation CLI and signed evidence->learning->synthetic sink->retrieval seams
- [ ] Implement/accept actual owner normalization/live inputs and real-input isolation; do not activate models or change eligibility
- [ ] Implement/accept cross-run Hindsight recall across process lifetimes, durable import/semantic retrieval and automatic Pi context injection
- [ ] Measure real external model capability; synthetic selection coverage is not capability lift

## 4. Delivery (inherited #17)
- [x] Add pinned least-privilege CI definition, actual local tarball install/strict consumer TypeScript, actual minimum Node20 and bounded non-release gates
- [x] Merge the three preserved local handoffs normally, preserve their ancestry, wire all 11 packages into root scripts/lock and deterministic integration enumeration
- [x] Run combined offline source, full tests/script tests, pack and actual Node20/packed-consumer gates; retain exact evidence
- [x] Run actual hosted Node20/22/26 GitHub source/consumer CI before and after PR10 source merge
- [ ] Establish any separately configured platform required-check policy; no protection settings changed
- [x] Complete independent same-model full-range inspection plus retained correction recheck; preserve original BLOCK/delivery failures and final exact-head OK
- [x] Merge source PR10 normally, verify reviewed/merged tree equality/ancestry, reread remote main and safely synchronize canonical main
- [ ] Merge this source-closeout documentation through its own normal reviewed PR

All implemented checks are source/package evidence, not publication, deployment,
owner activation, live memory writes, model calls, training, execution or release
permission. The CLI remains offline/read-only. Exact committed-source pin, local
full-range diff and post-commit evidence are prepared for independent parent review;
no remote merge/publication/operational acceptance is claimed here.
