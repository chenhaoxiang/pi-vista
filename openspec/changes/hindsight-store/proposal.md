---
doc_type: plan
project: workspace
owner_repository: chenhaoxiang/pi-vista
status: active
truth_mode: maintained
created: 2026-10-07
verified: 2026-10-07
---

# Explicit Hindsight store and durable attempt protection

## Why
PR12/13 delivered portable signed history, but learning sink and query/read ports still depend on injected callbacks. A real HTTP adapter and local cross-process attempt record must preserve exact original documents and refuse uncertain writes without restoring current authority.

## What changes
Add an opt-in existing-learning-package `@pi-vista/learning/hindsight` factory for explicit endpoint/bank mapping, private optional bearer authorization, Hindsight 0.10.2 synchronous retain, original-document readback and bounded recall-reference projection. Couple confirmed ingest to an immutable local POSIX journal claim established before any remote write; repeated/restarted attempts perform read-only reconciliation, never another retain. A successful transport round trip is not a live proof, server durability or execution permission.

## Scope
One vertical LearningSink/HindsightRecallPort seam. Keep all existing assertions, root learning import graph/API, CLI behavior, evidence/current learning factories, protocol, root dependencies, gate scripts and hosted workflows unchanged. The narrowly additive package `./hindsight` export map is the only manifest change; do not re-export I/O from root or relocate it merely to evade the inherited root scanner. Additive tests use actual local synthetic HTTP plus fresh Node processes only. No real bank/service/key access, default activation, publication, executable replay or durable signed lifecycle feed in this slice.

## Authority
Current user authorized continuation of the proposed source implementation, isolated verification and source delivery; previous explicit builtin-worker/same-model review authorization is retained. Public chenhaoxiang/pi-vista is not registered in the private organization autonomy/App registry: do not invent a safety rating, automatic-gate approval or trusted App receipt. All source merges still need actual exact-head CI, independent source review and normal PR/readback.
