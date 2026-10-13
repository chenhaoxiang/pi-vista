---
doc_type: handoff
project: workspace
owner_repository: chenhaoxiang/pi-vista
status: completed
truth_mode: snapshot
created: 2026-10-13
verified: 2026-10-13
---

# K1 supplied-facts source/main 交付

[PR #47](https://github.com/chenhaoxiang/pi-vista/pull/47) reviewed head
`e8eb64b282d5ba5820856f8eaf20e8d5ecda3fad`，普通 merge/main
`547ad391862537ba97dc37cbc78f384371015f7e`，6 个文件、343 changed lines。
本 handoff 自身仍需独立文档 PR 纳入，不以 PR47 当作本文件的提前交付证据。

## 源码交付

- 新的 `assessK1Readiness` / `validateK1Readiness` 仅组合传入 SDK/broker/history/
  subject/current-verifier/model/budget/metrics 的闭合 metadata，复用已有 validator
  和 frozen paired pins，不读 actual 来源、不执行 SDK/model/bank、不创建预算或 window。
- ready/not-ready 恒 metadata-only / authorization none / executable false。
  fresh/accepted/usage_complete 是未被本函数认证的调用方声明；copied ready 不恢复
  proof/isCurrent，不是实际 K1准入或任何普通 Pi执行前置。
- 现有 metrics adapter 仅新增同值 `K1_METRICS_ADAPTER_ID` 导出，行为/schema不改。
  这次没有修改 default Pi、模型/thinking/tools、11包公共签名或真实bank。

## 验证与平台结果

- 12 facts + 14既有metrics targeted26通过；release-script300/300、0fail/cancel/skip/todo。
  完整 Node26 source/packed-consumer、实际 Node20.20.2 source/packed-consumer、
  typecheck、OpenSpec/diffcheck通过。`npm run lint --workspaces --if-present` exit0
  只是现有入口结果，没有实际workspace lint脚本，不称独立静态lint覆盖。
- 初审 `34be3bda`（DeepSeek-high）无P0/P1，3report-only P2；最小4file修正后
  retained `2ac1091d` exact-head OK with notes。其时看到的 Node26 source尚在运行
  是时序提示；父级待最终 source/consumer/Node20完整结束后才合并，原日志保留。
- head CI [38455065818](https://github.com/chenhaoxiang/pi-vista/actions/runs/38455065818)
  三Node source/consumer SUCCESS，head另有GitGuardian SUCCESS。
- 已合 Meta PR560 的可信 Gate 正式匹配 Vista alias，CI要求包含原
  test/gitleaks/deps/build/typecheck全部语义。Gate `PASS_ESCALATED`，Owneroverride=false；
  S1 P1和缺 primary App5001705 check-run的原tier2条目保留，由既有Driver+一独立模型
  升级路径通过。这不等于App安装恢复或独立App凭证齐备，不新增门槛/伪造check。
- 普通 merge CLI exit0：真实 postmerge workflow为 `Source and packed-consumer contract`，
  [main CI38458803844](https://github.com/chenhaoxiang/pi-vista/actions/runs/38458803844)
  精确mergeSHA三Node SUCCESS，不再等待不存在的全局CI。严格readonly reconcile后
  merge/CI分别ok，gateunknown/not-evaluated，未重merge。canonical安全ff-only，0-0clean。

## 真实 K1 仍未完成

retained public1.0.4 manifest/entry两文件已只读匹配原pin，但这不认证完整依赖或vendor。
实际accepted history readback、新run import、fresh verifier/isCurrent、真实provider/
broker与完整Usage指标采集仍独立 pending。0真实模型请求、0bank调用、不复用旧INVALID，
不宣称quality/ROI/发布/default activation。

源码、完整源审、final gated logs、原bootstrap错误、readonly publicSDK摘要和head/main
平台回读保留在 source worktree `stage6-k1-readiness-next-01a120e4/tmp/k1-preflight/`；
所有摘要不包含 raw prompt/model/credential/path，私有输出不当发布资料。
