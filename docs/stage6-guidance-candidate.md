---
doc_type: spec
project: workspace
owner_repository: chenhaoxiang/pi-vista
status: active
truth_mode: maintained
created: 2026-10-14
verified: 2026-10-14
---

# Offline guidance candidate proposal

`stage6-guidance-candidate.mjs` is a pure, non-executable proposal over an already
validated public history/context pair. It delegates exact association to the existing
history bridge, then considers complete `script` and `steps` sections only. It never
returns raw guidance content: output contains section/content digests and lengths,
not instructions, paths, IDs, proof, permission or model output.

`status` is `candidate` only when task association matches and every complete section
fits the character budget. If any section would be omitted, status is
`budget-exhausted`, candidate length/delta are null, and no partial instruction bundle
is proposed. An unrelated task is `not-applicable`. `token_count` remains null and
`economic_roi` remains `not-established`; character reduction is not token or quality
proof. The proposal is not injected into Pi and does not change guidance, Owner policy,
permissions or default activation.
