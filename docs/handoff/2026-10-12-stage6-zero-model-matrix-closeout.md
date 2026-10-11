---
doc_type: handoff
project: workspace
owner_repository: chenhaoxiang/pi-vista
product_line: pi-vista
release_scope: Stage6 model-free native matrix and fault harness candidate
status: active
truth_mode: snapshot
created: 2026-10-12
verified: 2026-10-12
ssot: false
---

# Stage6 零模型矩阵与故障宿主候选收口

## 交付与验证

[PR41](https://github.com/chenhaoxiang/pi-vista/pull/41) 已普通合入 main：
精确 head `c5c84e03207b6dcceea16750fbdb3e113e327931`，merge/main
`99658fc5769fb920074e1b60ddfabb7f39d23d5e`。精确 head CI
`38177305015` 与 main CI `38178192023` 的 Node20/22/26 source/packed-consumer
检查成功；GitGuardian 分开记录。Gate 仍保留原始 FAIL 与 Owner 授权覆盖，
没有把它改写为普通 PASS；strict readonly reconcile 绑定真实 merge SHA/base/head
和本仓真实 workflow 后确认 merge/post-CI。

本 handoff 的独立 docs PR 纳入在准备时仍 pending；PR41 不证明本文件此前已经
在 main。源码候选没有新增真实模型、bank、默认 Pi 或 permission 接线。

## 实际零模型矩阵

在实际安装 SDK `1.1.0-fork.1`／Node26.9.0 上，单一 coordinator window 运行
4 个固定 synthetic metadata case × baseline/guided，共 8 个 request-bearing
fresh agents、16 次 provider serialization 请求；第 9 个 agent 只做 zero-request
window-budget guard。所有请求由本地 synthetic SSE 拦截，native read implementation
执行一次，strict structured `stage6_decision` 由 reference truth 校验为
`decision-valid`，每行 2 次且 receipt `pretransport_attempts=16`。

Guided arm 是 synthetic context，明确 `synthetic-guided-arm-not-LOCAL-readback`；
其 digest 不代表真实历史、LOCAL 当前验证、ROI、权限或模型效果。结果仍是
`evaluation_status:not-evaluated`、`authorization:none`、`executable:false`。

## 实际故障窗口

11 个相互独立窗口、不借用主 16 次预算，覆盖：

- semantic mismatch、completed schema-invalid、provider-error；
- cancellation、explicit transport timeout、actual coordinator deadline、
  stream-disconnected；
- profile drift；
- local request-guard、session-budget、window-budget rejection。

本地 coordinator rejection 使用独立 `failure_origin` 与 outcome，不伪装为
provider-error；cancel/deadline 保留 AbortSignal 后注入合法 late SSE，确认无
decision execution；timeout、deadline 和断流分别保留技术类别；profile drift
receipt 为 unknown，deadline 窗口因 bounded window 过期为
`unknown/stage6-window-deadline`；除 drift/deadline 外，其余窗口确认
integrity unchanged、event counters 和 stream restoration；`finish()` 为幂等缓存，
失败不会被第二次 cleanup 覆盖。

## 证据边界

- 精确 release-contract **240/240**；source/consumer/实际 Node20 library gates
  通过；matrix/faults actual Node26 运行摘要保留在 test-owned ignored `tmp/`。
- 公开摘要 `docs/handoff/evidence/2026-10-11-stage6-zero-model/` 只保留 safe
  matrix/fault JSON projection 与 head/main CI JSON projection；不保留 raw
  prompt/model/credential/path。
- 这是 native SDK harness 的 zero-model candidate，不是 full paired quality、真实
  provider、billing、current permission、发布、默认 Pi 或 Stage6 ROI 证明。
- 原 16-call INVALID 窗口不重用；后续真实 `k=1` 仍需另立窗口、重新绑定 SDK/
  source/history/model/budget 并独立验收。
- 公开 matrix/fault projection 绑定精确 `c5c84e0`；design 的 `d525644` 是更早
  的准备期运行。父级已核验 `d33636c…d525644…c5c84e0` 原生 harness bytes
  相同，当前证据不会把更早运行改标为新的 HEAD。

## 未完成

- 本 handoff 的 docs PR 尚待独立复审、CI、普通合入与 main 回读。
- 更广 provider/request-envelope、跨进程 source/history、LOCAL history readback、
  full paired quality/cost/ROI 以及 release/account/channel/version/rollback 仍未完成。
