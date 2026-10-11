---
doc_type: handoff
project: workspace
owner_repository: chenhaoxiang/pi-vista
product_line: pi-vista
status: active
truth_mode: snapshot
created: 2026-10-11
verified: 2026-10-11
ssot: false
---

# Stage6 native SDK candidate evidence

This directory contains bounded, public summaries only. It is not vendor
authentication, current permission, model quality, billing, bank or release proof.
The raw synthetic runtime log remains in the test-owned ignored worktree `tmp/`.

- `head-ci-48f4.json`: exact PR39 head CI run `38133601025`, head
  `48f4c90a7d5f38893f95b455e1ff9c2be40a915b`, Node20/22/26 source/consumer success.
- `main-ci-05fe.json`: exact merge/main CI run `38134183188`, head
  `05fe4c5f59b91ea1f702304d8d083b5e17ed45dc`, Node20/22/26 source/consumer success.
- `native-runtime-48f4.json`: sanitized Node26 synthetic runner report: SDK
  `1.1.0-fork.1`, two intercepted synthetic requests, strict decision-valid,
  pretransport receipt 2, metadata-only/non-authorizing result. It does not contain
  raw prompt/model/credential/path content.

No actual model request, bank write, default Pi activation or real provider call is
represented here. The runner's fetch interception covers only its exercised
transport seam, not universal network enforcement.
