---
doc_type: spec
project: workspace
owner_repository: chenhaoxiang/pi-vista
status: active
truth_mode: maintained
created: 2026-10-12
verified: 2026-10-12
---

# Stage6 K1 合成 SDK 宿主预演

## 目标与现有能力

本片把 PR43 的 K1 metadata admission 与 PR44 的 history-context bridge 接入
已有合成 SDK host。它是评测线路的只读事实/fixture 预演，不是给正常 Pi 加新
执行前置。没有真实模型、真实 bank、凭据字节或日常 profile 修改，也不改变
primary provider/model/thinking/tools/prompt。

当前候选已在集成 worktree 合并 peer 三个 source commits，脚本集成 HEAD 为
`2b22cc9e7598af11098e686c912a169fa519c8fc`；后续仅文档提交
`d14ba2ec30c71ea6d3d5aadaed2159475a68b08f`、测试/文档收口提交
`2811d6fe4d0449eef2621bf6df1cb3ede60e6339` 是此前的测试/CI证据提交。
本页自身还有后继 docs-only 收口提交，不在正文自引用“当前 PR head”；交付时
由 PR/Git 的精确 head/main 回读绑定。本片脚本未因这些测试/文档提交改变。
父级集成树已实际跑过 host targeted、旧 native matrix、274 release-script cases、
source/consumer、实际 Node20、typecheck/OpenSpec/diff-check；source/consumer/Node20
仍是本地事实，
不借 peer candidate clean 或旧 main CI 当新 HEAD/main 证据。这里的 positive 使用
真实公共 LOCAL factory 的合成 read/import/fresh verify/compile 链，不是实际 bank
或历史来源验收。源码、mock、实际 SDK 的合成响应、独审、CI/main 与后续真实历史/
模型窗口分别验收；本页没有把未来窗口写成完成。

已有能力分别是：

- `createSyntheticSdkHost`：一个 `openStage6Pilot` window、全窗口共享预算、
  原生 SDK session、固定 synthetic fetch/SSE 与安全报告；
- `buildK1HistoryContext`：trusted-host public GuidanceReadback 与
  LocalCompiledContext 的纯转换，输出现有 `stage6-history-context/1`；
- `admitK1`：copyable metadata 检查，不建立执行期预算；
- `admitStage6Run`、`bindSession`：保留实际 profile snapshot 与模块私有 issued
  admission 身份。K1 metadata 不替代它们。

不外包第二 coordinator，不加第二预算、ledger、validator 或审批链。

## 接线顺序

`createSyntheticSdkHost(existingOptions, { prepareK1Plan })` 是显式 opt-in。
未提供第二参数时，旧 matrix/fault 路径保持原行为。trusted callback 只返回
`{ historyReadback, localCompiledContext }`；不能自行返回 window、budget 或权限。

1. **输入/历史准备**：校验 callback 的 closed own-data shape，取得合成公共
   history/context，经 bridge 回验，并要求固定 `PAIR_SOURCE_SHA`，以及该 host
   的 repo/policy/environment 标签与历史 stable binding 一致。此类输入拒绝
   在 source/SDK/test-profile/session/fetch 前发生，不截断、换 subject 或把不同
   policy/environment 的历史默认套入本轮；这些相等检查不是来源认证。
2. **真实 metadata 匹配**：沿用现有 source pin、只读 SDK manifest/public entry、
   test-owned synthetic profile/target 与只读 broker metadata 采集。不能为绕过
   I/O 假造 `sdk.matched` 或 `broker.matched`。
3. **一次性准备完整 K1 plan**：在唯一 `openStage6Pilot` 之前，以当前实际
   pretransport 计数为零准备四 case × 两 arm 的八份 `admitK1` metadata。
   所有 row 共享固定 source/history anchor 和窗口预算声明；guided 的 arm digest
   来自 compiled content，baseline `history=null`。不能在已发生请求后重新硬填零。
   本 host 的固定八行、每行两请求要求容量为 16；若 metadata 均 admitted 但
   容量不足，则在开窗前报告 `stage6-k1-plan-capacity-mismatch`。这不是新计数器，
   也不改变通用 `admitK1(max_requests<=16)` 或旧 host 小预算行为。
4. **开唯一窗口与执行合成 session**：通过 plan 后才开 coordinator window。
   既有 `profile snapshot → admitStage6Run → bindSession` 链不变；不得把
   copyable K1 admission 直接当 issued token。全窗口最多 16 请求、每 session
   最多两请求仍只有现有预算所有者。
5. **终态与 cleanup**：按既有 finalize 复验 source/profile/provenance、撤销绑定
   并恢复 stream。未知、取消、漂移、未完成不写成成功。

`subject_source_sha`、`subject_history_digest` 属于 window common context。
历史 anchor 必须在开窗前同时进入 base context 和 expected provenance；不能
在 guided row 开始时更改共同字段。`bindings.context_digest` 仍是 window-common
label，不用它冒充 guided 编译文本摘要。

## 失败与计数分层

- 输入拒绝：未准备测试 profile，未开 window/session，无 pretransport/fetch；此时
  `harness_source_sha` 如由 runner 回填，仅为调用方声明标签，尚未由 `sourceBinding`
  核验。metadata-admission 阶段的 producing SHA 来自 source pin 已完成后的事实。
- metadata admission 拒绝：可能已经准备自己的 synthetic fixture 并完成只读
  SDK/broker 观察，但未开 window/session，也无 pretransport/fetch。固定计划
  的容量不匹配也属于这个阶段，不能称为 provider 故障。必须如实保留这一部分
  效果，不能将其称为零 I/O 或日常 profile 修改。
- 合成有效路径：独立记录 pretransport attempts、intercepted fetch、synthetic
  SSE responses、native inspector、decision execution 与 credential-store stub
  attempts。这些计数不能互推为真实模型请求、费用或 current proof。
  拒绝异常上的 window/profile/zero 标记是该宿主控制流的结构性状态，不是全 OS
  或任意 trusted callback 的副作用监测；callback 外部工作不得借这些标记认证。
  `real_model_calls/bank_calls/credential_bytes_read` 的声明范围与该 seam 实测
  counters 分开报告，不能把 in-memory credential stub 的尝试次数写成零。

报告只投影 K1 status/reason、摘要、枚举、计数及既有 native row/window receipt。
raw history/context、prompt、工具 body、路径、ID、handle、proof 或权限不进入报告。
输出继续保持 `authorization=none`、`executable=false`、
`evaluation_status=not-evaluated`。

trusted callback 不是 OS sandbox。JavaScript 等待截止不证明同步/native 外部
副作用已被取消；源/mock 只能验证这一显式宿主路径，不能认证任意 callback。

## 验收与边界

- 保留旧无 callback 行为的 characterization 与既有 matrix/fault 断言。
- 新增 canonical/binding mismatch、多 item/omitted、旧 run/experience 复用等
  负例；验证拒绝发生在对应阶段，并分别记录零 window/session/fetch 和测试
  fixture 准备状态。
- Node26 与显式安装 SDK 使用 dummy fetch/SSE；Node20 只验证 source/consumer，
  不把不支持的 SDK runtime 判绿。
- 集成脚本 HEAD `2b22cc9`、docs-only HEAD `d14ba2e` 与测试修正 HEAD
  `3b4da38` 分别重跑并保留的实际 SDK1.1.0-fork.1/Node26 合成证据：8 rows/16
  pretransport/fetch、8 agents、request-contract checks=16；stub credential
  attempts=1696；capacity refusal 与 policy/env mismatch 早拒绝。safe reports
  位于 `tmp/k1-host-proof/`，harness/source SHA 绑定当前集成 HEAD；scope 是
  synthetic host control-flow/counters，不是任意 callback/OS 副作用证明。
  旧无 callback matrix、旧 678/3bde 原件各自保留，不混入新证据。
- source/mock、独审、精确 head/main CI、普通合入及 canonical 回读完成后才
  声明本片源码交付。后续真实 K1/质量/ROI/费用与发行仍需各自事实链，不把旧
  16-call `INVALID` 或历史相容记录改标成当前成功。

此预演不会自动注入历史、重试真实模型、写 bank、修改 gate/guard、创建账号/
服务或改变默认 Pi。已有用户授权不逐步骤重复索取；真实范围变化或必要技术
条件失败只停相关动作，其余独立工作继续。
