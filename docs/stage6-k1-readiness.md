---
doc_type: spec
project: workspace
owner_repository: chenhaoxiang/pi-vista
status: active
truth_mode: maintained
created: 2026-10-12
verified: 2026-10-12
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
   model-free host 事实不能改标为 public1.0.4；historical fork 也不等同。
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

当前只推进一个纯函数 Usage→paired-metric 适配边界：
`scripts/stage6-k1-metrics-adapter.mjs`（候选）接受 `{measurement, usage}` 八行，
拒绝 proxy/accessor/extra/missing/malformed；`measurement` 必须已提供旧
paired row 的完整字段，adapter 不填零、不推断 decision/identity/elapsed；`usage`
闭合要求 public SDK Usage 的 required keys `input/output/cacheRead/cacheWrite/
 totalTokens/cost`，允许 `cacheWrite1h` 与 `reasoning` optional。`reasoning` 缺失
转为 null，显式 0 保留；`cost.total==0` 转为 `sdk_cost:null/cost_priced:false`，
正数只是 SDK configured estimate，不是独立 billing。

适配后直接复用 `snapshotPairMeasurement` 与 `aggregatePairedMeasurements`，不复制
schema，也不产生 readiness proof、budget、permission 或 ledger。PR45 host rows
缺少完整 Usage/metric fields，禁止送入该 adapter 伪造 measured 结果。

这片 source/mock 不调用 SDK、provider、bank、broker 或模型；它只能验证输入契约
与聚合状态分类。真实 k=1 仍需上述事实链、独立审查、CI/main/readback，并且不能
把 `ready` 标签升级为 current permission、ROI 或 release。
