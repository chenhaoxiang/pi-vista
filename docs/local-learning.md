---
doc_type: guide
project: workspace
owner_repository: chenhaoxiang/pi-vista
status: active
truth_mode: maintained
created: 2026-10-10
verified: 2026-10-10
---

# 显式 LOCAL 经验闭环（源码候选）

`@pi-vista/learning/local` 是独立、按需启用的本机入口，串起候选、当前验证、精确预览、确认、guidance 持久化、检索和进程内生命周期。原 `@pi-vista/learning` 继续只接受原签名 verifier；新入口不修改签名 API、Pi 观察器、CLI、gate/guard、模型、日常配置或默认路径。当前是源码/合成验收切片，不是实际产品记忆接线或 Stage5 全部运营验收。

## 宿主显式接线

```ts
import { createLocalLearningLibrary } from "@pi-vista/learning/local";

// verifier = createLocalEvidenceVerifier(hostConfig) 的真实对象。
// store = createHindsightGuidanceStore(explicitPrivateConfig) 或可信的合成端口。
// scope 必须与 verifier 产生的 proof 完全一致；没有默认配置或自动发现。
const library = createLocalLearningLibrary({
  mode: "local-learning", scope: explicitScope, verifier, store,
  timeout_ms: 5000,
});
const candidate = library.nominate(library.observe(safeObservation));
const proof = await verifier.verify(expectedBindings, explicitSubjects);
const verified = library.verifyCandidate(candidate, proof);
const preview = library.prepareGuidance(verified, explicitBankAlias); // 无 I/O
// 受信宿主在既有授权范围内确认这份精确内容，不新增人工审批或认证循环。
const persisted = await library.commitGuidance(preview, {
  preview_digest: preview.preview_digest,
});
const context = library.compileContext(library.retrieve([persisted], safeQuery));
// context.authorization === "none"; executable === false; budget_unit === "characters"。
// context 仅返回给宿主，不自动写入 Pi prompt 或执行其中动作。
```

配置、输入和返回值均采用封闭 own-data 快照。Proxy/accessor、未知字段、假 verifier、危险标签和超限列表拒绝；不运行输入 getter，不投影原异常/模型正文/命令/路径/凭据。受信回调须返回 native Promise；带自定义 `.then` 的原始返回 DTO 在验证前不会被重新当成 thenable 执行。回调是宿主代码，不是恶意代码沙箱。

## 当前证据与持久化

- `observe`/`nominate` 只形成草稿/候选，不能自报通过。`verifyCandidate` 只接受注入 verifier 本进程的确切有效对象、同 scope 与 run/repo/source/policy/environment 五绑定。
- 当前句柄/计划/选择均由本 library 私有身份关联；复制、JSON、其他 factory/进程和历史 status 无法恢复。需要刷新时，宿主重新采集 proof，再显式调用 `verifyCandidate`，旧 generation 的预览/选择随即失效。
- `prepareGuidance` 复用现有 canonical schema：只保存原始安全观察，不保存当前 proof、status、签名或派生根因。预览摘要绑定 scope/bank/experience/document。
- `commitGuidance` 先核对精确计划/摘要，再重新采集并旋转证据，然后执行一次 retain 和精确原文回读。一个总 deadline 包含证据重采集、retain、read；每个 await 后核对 generation、proof 和退休状态。只有全链路成功才标记 `persisted`，这个词表示本进程确认过回读，不代表执行权限或跨进程当前证明。
- 一旦有效尝试开始，该 record 的所有计划都被写入消费，包括失败/超时后；不会通过另一个 bank 预览、刷新 proof 或换同一 plan 重发。无效确认零效果且不消费计划；没有 store 时预览仍可用。
- 底层 `guidance` store 继续负责原有 cooperative durable journal；本 library 不新增第二份批准/学习/重试账本。失败与超时保持明确固定错误，不伪成功，也不能撤回已经发生的宿主效果。

## 历史检索与只读恢复

`reconcileGuidance(bank, document)` 仅委派原 existing-intent/original-read 只读对账，返回 `matched`/`not-confirmed`，始终 `current_verification=not-checked`、`authorization=none`、`executable=false`。它不 retain、不重置 journal、不自动提升句柄；新 factory 可用保存的安全 canonical 文档对账，但不能恢复旧计划/current proof。

`readGuidance(reference)` 核对封闭 ref、bank/document_id、文档 canonical 字节/摘要/idempotency 与指导数据的一致性。`recallGuidance(bank, query)` 在一个总 deadline 内查询限量 refs、去重、读取原文并筛选 repo/source/policy/environment/task，不接受任意 fact prose、rank、flags 或“摘要回显”替代原文。结果是历史指导，不是当前可执行状态。

`importGuidance(history, explicitNewContext)` 只接受本 factory 从原文重新读取的历史 view，以不同 experience_id/run_id 建立 `observed` 记录。其余四绑定必须一致；旧 model/failure 测量不重命名成新 run 的测量。之后仍需 nominate 与新的当前 proof。复制的历史 view 可通过明确原文读取重新建立指导 view，但不能直接恢复权限。

## 生命周期和边界

`reject`、`deprecate`、`supersede` 让旧 generation 的计划/选择失效；验证刷新也不能复活这些 terminal records。`retrieve`/`compileContext` 只选择本 factory 当前 verified/persisted 句柄，并再次检查当前 proof；character budget 省略完整条目，不截断安全标签/来源，不冒称 token 预算。

`shutdown` 永久退休本 library 并 abort 它自己的 store 等待；晚到成功/拒绝不能复活。共享 verifier 由宿主独立管理，不自动关闭。当前生命周期只在进程内；**没有 durable withdrawal feed、跨机真实性、OS/Meta 全量 coverage、Mac 认证 broker、自动经验执行、生产 bank 接线或默认 Pi 激活**。历史 recall 不声称原 record 仍 active；实际继续使用必须重新验证。当前 chunks bank/旧失败/journal 不由本切片重写。

设计：[Stage5 local design](../openspec/changes/pi-operational-rollout/stage5-local-learning-design.md)。前置：[local host](local-host-evidence.md)、[guidance](hindsight-guidance.md)、[Stage4 main](handoff/2026-10-09-stage4-shared-main-closeout.md)。验收状态和后续 actual workflow / Stage6 paired effectiveness 分别跟踪在 [sequential tasks](../openspec/changes/pi-operational-rollout/tasks.md)。
