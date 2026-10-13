---
doc_type: spec
project: workspace
owner_repository: chenhaoxiang/pi-vista
status: active
truth_mode: maintained
created: 2026-10-12
verified: 2026-10-13
---

# Stage6 K1 真实窗口事实链与指标兼容性

## 当前交付复核

PR43 K1 admission、PR44 history-context bridge 和 PR45 synthetic SDK host preview
已合入 main，分别提供 metadata admission、历史上下文只读转换、单一 coordinator
window/issued admission/分层拒绝与安全 projection。它们都不构成真实模型质量、
current proof、默认 Pi、bank 写入或发布授权。

PR45 使用 SDK1.1.0-fork.1/Node26 的 synthetic transport；credential store 是
内存 stub，实测 attempts 可为非零（已记录 1696），不能写成零尝试或真实 credential
读取。之前 16-call `INVALID` pilot 不重用。

## #19 当前事实缺口

真实 K1 paired evaluation 仍未 ready，缺口必须分别核验：

1. **SDK**：paired metric 合同固定 retained public SDK1.0.4。当前 SDK1.1 fork 的
   model-free host 事实不能改标为 public1.0.4；historical fork 也不等同。当前物理
   public1.0.4 manifest/entry 已只读回验与现有 pin 一致。其 core loop 的
   `terminate` 是 tool-batch hint：单一 terminating batch 可停止，混合普通 tool、
   follow-up 或 after-hook 撤回会继续。父级对公共 core exported API 的四个
   synthetic-stream 分支实际探针与源码相符，fetch=0；这不是完整 SDK session、
   实际 provider/model、完整依赖闭包或 vendor 认证。
2. **Subject/history**：必须有 trusted-host 实际 `GuidanceReadback`、canonical
   document/title/tags/content digest、accepted subject source、四绑定一致性；
   LOCAL import 必须生成新 run/experience，并由真实 trusted verifier fresh verify
   后再 compile 单 item。bridge metadata 不替代 proof/current verifier。
3. **Model/provider**：固定 `codex-local-8319/gpt-6.1-sol:max`，baseline/guided
   共享 provider/model/thinking/tools/system/task/budget；不 fallback、不 silent
   retry、不换 SDK/channel。
4. **Broker**：必须有选定 provider 的 explicit readonly broker metadata match，
   target/profile/source 绑定和 credential bytes unread；metadata 不等于 provider
   authentication。
5. **Window/budget**：4 cases × 2 arms、8 fresh sessions、全局最多16、每 session
   最多2、retry=0、固定 timeout/deadline；同一 coordinator window 负责真实计数。
6. **Metrics**：必须直接生成完整 `snapshotPairMeasurement` 行并调用现有
   `aggregatePairedMeasurements`，不能从 PR45 lifecycle rows 补 Usage、elapsed、
   identity、decision 或 cost。

缺少任一必要事实时，结果是 `not-ready/unknown`，不是失败重试、模型 fallback 或
人工审批请求。

## Source/mock #19 slice

当前已在集成候选中加入一个纯函数 Usage→paired-metric 适配边界：
`scripts/stage6-k1-metrics-adapter.mjs` 的 `adaptK1SDKMeasurement` 接受
一份 `{measurement, usage}`；`aggregateK1SDKMeasurements` 接受八份完整记录。
它拒绝 proxy/accessor/extra/missing/malformed；`measurement` 必须已提供旧 paired
row 除 `tokens/sdk_cost/cost_priced` 三个派生字段之外的完整字段，且禁止调用者
提供这三个字段。adapter 不填零、不推断 decision/identity/elapsed；`usage`
闭合要求 public SDK Usage 的 required keys `input/output/cacheRead/cacheWrite/
totalTokens/cost`，允许 `cacheWrite1h` 与 `reasoning` optional。`reasoning` 缺失
转为 null，显式 0 保留；reasoning 属于 output subset，不另加 total；cacheWrite1h
属于 cacheWrite subset，旧 paired schema 不新增该拆分字段。`cost.total==0` 转为
`sdk_cost:null/cost_priced:false`，
正数只是 SDK configured estimate，不是独立 billing。

适配后直接复用 `snapshotPairMeasurement` 与 `aggregatePairedMeasurements`，不复制
schema，也不产生 readiness proof、budget、permission 或 ledger。旧 aggregator 的
`evaluation_status:measured` 只表示所供数据可聚合，不证明外部 SDK/model/采集真的
发生；合成 reference tests 的 measured 输出不能用作实际模型质量。PR45 host rows
缺少完整 Usage/metric fields，禁止送入该 adapter 伪造 measured 结果。

这片 source/mock 不调用 SDK、provider、bank、broker 或模型；父级当前 targeted
14/14、release 288、source/consumer/Node20、typecheck/lint/OpenSpec/diff-check
均通过（首次未bootstrap全仓的失败原件保留，后续正确 npm ci/build 后重跑通过）。
它只能验证输入契约与聚合状态分类。真实 k=1 仍需上述事实链、独立审查、CI/main/
readback，并且不能把可聚合或 synthetic 标签升级为 current permission、ROI 或
release。

## #20 supplied-facts metadata consistency（source/mock 候选）

`scripts/stage6-k1-facts.mjs` 显式复用 `validateSdkContractMatch`、
`validateReadonlyBrokerMetadata`、`snapshotHistoryContext` 和原 paired pins，检查
闭合的 SDK/broker/subject/history/current-verifier/model/budget/metrics metadata。
输出 `ready/not-ready` 只表示传入 metadata 的完整性与一致性；它不读取任何实际来源，
也不认证 `fresh/accepted/usage_complete/aggregate` 等调用方声明。synthetic 正例可以
返回 ready，不能凭该结果启动模型、恢复 opaque proof 或宣称 actual K1 ready。

输入是 closed own-data DTO，拒绝 proxy/accessor/extra/missing、错误 public SDK pin、
fork 改标、history/source 漂移、verifier关联不一致、模型/thinking/tool/retry 变化、
窗口预算变化、缺 Usage/metrics。拒绝为固定 reason code，不回显 raw/credential/path。
输出是 copyable metadata，恒 `verification=metadata-only / authorization=none /
executable=false`，不创建预算、ledger、执行 window 或默认 Pi 前置要求。

subject 的 repo/policy/env 是安全标签，不由该摘要函数与 history 再造关联；真实 host
仍须通过已交付 public history/context bridge、actual provenance 和 fresh verifier
建立实际来源、四绑定、当前 evidence/expiry，再用一个 coordinator 管真实请求。
本函数对 current-verifier 的 fresh/accepted 声明仅做形状/关联判定；不能替代 isCurrent
检查或证明读取发生。metrics 完整性声明不生成 Usage、decision、elapsed 或 aggregate。

12 项 synthetic 定向和 release-script 300/300 已通过，0 skip/cancel/todo；首次未完成
worktree bootstrap 的 ERR_MODULE_NOT_FOUND 保留，正确 offline npm-ci/build 后重跑通过。
源码独审、完整 source/consumer、Node20、CI/main 与 actual K1 的事实验收分别 pending。
同时只读复核 retained public SDK root 的 manifest/entry 与 frozen public1.0.4 pin 一致，
这一双文件事实仍不是完整 SDK依赖、history/verifier/broker/provider或 actual质量证明。
