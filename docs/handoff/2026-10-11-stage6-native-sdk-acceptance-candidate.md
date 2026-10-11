---
doc_type: handoff
project: workspace
owner_repository: chenhaoxiang/pi-vista
product_line: pi-vista
release_scope: Stage6 model-free native SDK acceptance candidate
status: active
truth_mode: snapshot
created: 2026-10-11
verified: 2026-10-11
ssot: false
---

# Stage6 model-free native SDK acceptance candidate

## 交付与验证边界

[PR39](https://github.com/chenhaoxiang/pi-vista/pull/39) 已普通合入 main：
reviewed head `48f4c90a7d5f38893f95b455e1ff9c2be40a915b`，merge/main
`05fe4c5f59b91ea1f702304d8d083b5e17ed45dc`。该合入使用了已记录的
`PASS_OWNER_AUTHORIZED` Gate 覆盖；原始失败与缺少 Meta App check 的 HTTP403
均保留，后继严格只读 reconcile 才按真实 workflow 确认 merge/post-CI，不能把
它写成普通 Gate PASS。精确 head CI
`38133601025` 与 main CI `38134183188` 的 Node20/22/26 source/packed-consumer
检查成功；GitGuardian 作为独立 head check 保持分开。PR39 是源码候选合入，
不是默认 Pi、生产模型、paired quality、current permission、发布或 bank 接线。

该 handoff 自身在准备时仍需独立文档 PR 纳入；PR39 不证明本文件已提前进入 main。

## 实际 Node26 零模型窗口

显式运行入口 `scripts/stage6-native-sdk-acceptance.mjs` 只接受 `sdk` 与
`source_sha` 两个参数，要求 Node `>=22.19.0`、绝对归一化 SDK 目录、精确
checkout HEAD、clean tracked/untracked 状态和 runner 字节摘要；Node20 在 SDK
导入前拒绝。它不是默认入口，不读取日常 Pi profile，也不自动扫描 HOME。

在实际安装的 `1.1.0-fork.1` SDK、Node `v26.9.0` 上，精确 source
`48f4c90a7d5f38893f95b455e1ff9c2be40a915b` 的一次 synthetic healthy-metadata
窗口通过：

- SDK 的实际 provider serialization 发出 2 次请求，全部由本地 global-fetch
  seam 截获并返回 synthetic SSE；不宣称 universal network sandbox。
- 实际 SDK session 执行 native read implementation（由 custom inspector 内部
  调用，**不宣称 registry `read` tool dispatch**），读取一个合成 metadata 文件。
- 结构化 `stage6_decision` 经过 deterministic reference oracle 判定
  `decision-valid`，并以 `terminate:true` 结束，不触发第三轮。
- Coordinator receipt：`pretransport_attempts=2`、`max_requests=2`、
  profile/provenance `unchanged`、`evaluation_status=not-evaluated`、
  `verification=metadata-only`、`authorization=none`、`executable=false`。
- injected credential store 的 read attempts 被单独计数；真实模型调用、bank
  写入和 credential bytes 读取属于 runner 的 declared synthetic scope，不能推导
  真实计费、全局 egress 或 vendor authentication。

安全原件：集成 worktree 的 `tmp/stage6-native/acceptance-48f4.log` 与
`tmp/release-contract/stage6-native-sdk-iBalns/report.json` 均为 test-owned
ignored artifacts；其余历史 runner 原件按各自 `harness_source_sha` 保留。公开
摘要 `docs/handoff/evidence/2026-10-11-stage6-native-sdk/` 只保留精确 CI 与
受限 runtime 摘要，不写入真实凭据、raw prompt/output 或路径。

Node20 actual SDK import 的失败原件保持保全于集成 worktree
`tmp/stage6-native/run-node20.log`（prototype）及
`tmp/stage6-native/acceptance-node20-d908.log`（正式 runner）：SDK
`1.1.0-fork.1` 在 Node20 触发 `node:fs.globSync` export 缺失，因此 runner 在
engine gate 之前拒绝；这不推翻 Node20 source/consumer contract，也不把 Node20
SDK runtime 称为兼容。

## 未完成边界

- 当前仅一个 synthetic healthy-metadata window，不是四 case × baseline/guided
  的有效 paired evaluation，不提供 pass@1、ROI、成本、泛化、发布或质量结论。
- `HOME/TMPDIR` 继承宿主环境；runner 用显式 agentDir、in-memory managers、
  in-memory credential/catalog、empty resource loader 降低范围，但不是完整 hermetic
  或 OS egress 审计。
- SDK public manifest/entry identity 不是 full dependency closure、vendor
  authentication 或当前加载模块的独立证明。
- 仍未接入默认 Pi、workspace-guard、ai-gate、LOCAL memory、bank、真实 provider
  或任何新的模型请求；旧 16-call INVALID window 不重用。
- 下一步需先独立审查/主线文档收口，再决定是否在明确的新窗口中执行有界 k=1；
  真实模型和账户/渠道/版本/rollback 事实仍需单独核验。
