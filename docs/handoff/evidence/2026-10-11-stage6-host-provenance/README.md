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

# Stage6 host provenance · public evidence readback

This point-in-time record contains only public GitHub CI and safe parent runtime
readback metadata. It is not a test rerun, model/vendor authentication, actual host
or current permission proof. The original JSON readbacks remain test-owned under
`stage6-provenance-closeout-01a120e4/tmp/stage6-closeout/evidence/`; the authoritative
GitHub run pages allow independent public verification.

## Exact source head CI

- Run: [38123716001](https://github.com/chenhaoxiang/pi-vista/actions/runs/38123716001)
- `headSha`: `849ebe37305caceaa475f04fe63316d92b4bd6f9`
- Workflow: `Source and packed-consumer contract`
- `status: completed`, `conclusion: success`

| Check | Status | Conclusion |
|---|---|---|
| Node 20 / POSIX source evidence | completed | success |
| Node 22 / POSIX source evidence | completed | success |
| Node 26 / POSIX source evidence | completed | success |

GitGuardian was separately read as a successful App check on the same head, not
as a job in this workflow. The ordinary `ai-pair-review` commit status is separate
from the unavailable configured GitHub App review check (HTTP403).

## Exact main CI

- Run: [38125352527](https://github.com/chenhaoxiang/pi-vista/actions/runs/38125352527)
- `headSha`: `93c3825236ad9daa1d8bb79c46196e7751a1a501`
- Workflow: `Source and packed-consumer contract`
- `event: push`, `status: completed`, `conclusion: success`

| Check | Status | Conclusion |
|---|---|---|
| Node 20 / POSIX source evidence | completed | success |
| Node 22 / POSIX source evidence | completed | success |
| Node 26 / POSIX source evidence | completed | success |

No separate main GitGuardian success is asserted.

## Parent reviewer runtime readback

The parent checked `subagent status` before using the reviewer identities. The
following is an exact safe projection of the runtime fields, not the reviewers'
self-assertion and not independent provider authentication:

| Run | Source scope | Runtime provider/model | Thinking | State |
|---|---|---|---|---|
| `d3ece8c4-8824-45d4-87a9-78f0e801ebe4` | fresh c83 source review | `codex-local/deepseek-flash` | high | complete |
| `25f7e39b-5c25-4e66-8d57-207593bff821` | retained 2532 lifecycle review | `codex-local/deepseek-flash` | high | complete |
| `4d1d119d-6a2e-44b1-91c1-1a41c0ad22d2` | final 849 cross-window check | `codex-local/deepseek-flash` | high | complete |

This is layered coverage, not a new full fresh 849 review. The earlier wrong
DeepSeek label on same-model run `9e5c5d6b` is retained with its public correction;
that run is not one of these three and was not used to satisfy the heterogeneous
review identity. The final review text/hash is publicly retained in
[PR37 review record](https://github.com/chenhaoxiang/pi-vista/pull/37#issuecomment-6107067568).
