---
doc_type: spec
project: workspace
owner_repository: chenhaoxiang/pi-vista
status: active
truth_mode: maintained
created: 2026-10-10
verified: 2026-10-18
verification_scope: Maintained delivery status reconciled with merged PRs and existing scoped evidence; no new runtime or model acceptance
ssot: true
---

# Pi-Continuum · Pi 执行闭环

Pi-Continuum 是 ai-gate、workspace-guard、Pi native host 与 pi-vista 的内部统称，**不是新增服务、框架、审批链或学习账本**。目标是减少人工、提高自动完成和恢复能力，同时保持结果、资金、实际用户规则与平台权限真实性。

## 1. Native-first 非退化合同

- 默认保留 Pi 原生执行、provider/model、thinking、工具集和提示；不自动串联新的 LLM judge、投票或强制 memory。
- guard/gate 与 native host 执行当前授权和真实规则；Vista 只能观察、检查事实和提供历史指导，不能写 Owner policy 或取得执行权。
- observer、memory、建议收集或评测故障不能阻塞主任务；unknown、pending、skipped、历史成功不升级为 ok/current permission。
- 建议仅通过 trusted-host 显式安全 DTO 和本地 sink 保存，不搬入 raw output/reasoning/命令/路径/凭据，不默认新增模型请求或模型工具。
- 不承诺所有模型绝对零负面。每个增强必须有同模型、同任务和明确可比预算条件的 native baseline 对照；记录 overhead、schema failure、latency、semantic/task outcome、context和token cost。Owner 2026-10-20明确质量/稳定/少等待返工人工优先，合理成本上升可接受；实际成本仍如实记录，不能为正收益无限追加调用。
- 质量退化、无已证实业务收益的负 context ROI 或 profile drift 时关闭该增强并保留诊断；成本上升本身不能否决已证实的质量/稳定/人工改善。原窗口无semantic/parse/human收益的失败结论保留，不关闭 guard/gate，不改变硬规则，也不悄悄换模型/渠道/思考档。

## 2. 四平面与单向依赖

| 平面 | Owner/现有组件 | 职责 | 不具有的权力 |
|---|---|---|---|
| Policy | Meta OwnerPolicy / workspace-guard | 当前用户规则、实际工具目标预检、直接文件与治理/OS边界 | 模型建议不能自改硬规则 |
| Execution | Pi native host / ai-gate | 真实工具闭包、gate、普通merge、head-CAS/target复验、post-CI | 不从观察成功恢复许可 |
| Evidence | Vista adapters/checks/evidence-host/LOCAL + Meta readonly reconcile | 安全观察、当前事实、明确scope/freshness、只读对账 | 不生成merge/付款/policy写入授权 |
| Evaluation | Vista paired contract / reference/mock / ROI reports | 测量任务效益、诊断、成本与回归 | 不用指标投票覆盖规则或当前失败 |

依赖方向：`guard/gate/native → safe observations → Vista`。禁止反向 `Vista/history/success → permission/merge/policy writer`。重用既有 11 包、CheckRegistry、LOCAL verifier、guidance store 与一次性 journal；不另建并行实现。

## 3. 分离状态，而不是一个 success

以下是职责模型，不是新增 wire schema，也不是许可推断：

| 维度 | 状态示例 | 证据边界 |
|---|---|---|
| permission | auto / deny / require-human / resolve / recover / blocked | 当前授权、Owner规则、资金与外部约束 |
| execution | not-started / in-flight / ok / failed / unknown / cancelled | 实际执行器结果与可能部分效果 |
| verification | not-checked / verified / stale / drift / unknown | 当前工厂、明确scope、绑定、freshness和原件 |
| experience | none / observed / candidate / verified / persisted | 历史与当前对象分开；持久化不是当前许可 |

任何两个维度都不能互推。工具 notification 的 `isError=false` 只表示该通知下的工具状态，不是任务、CI、完整guard覆盖或资金效果证明。

## 4. 复用公共合同

- OperationContext 的 run/operation/trace/repo/source/target/policy/host-scope/financial effect 属 trusted-host 事实；复用已有 Operation/EffectRequest/五绑定，不先新增一套协议。
- GuardObservation 只投影当前现有事件中的安全枚举、rule/policy/target/reason/source标签。未知、丢事件或只覆盖部分scope不补造完整coverage。
- Meta `ai-gate-observations/1` 独立记录 `gate-evaluate`、`actual-merge`、`post-merge-ci`；`execution_merge_sha` 与判定 PR head 分开。
- Vista `emitAiGateObservation`/`emitAiGateEvidence` 与 `toVistaEventInput` 只接受 closed rows；whole CLI、URL、commands、raw review/log不能送入协议。
- financial unknown 不能由模型自报 none。实际 none/money 来自自持闭包和现状复验，不把 tool name/annotations/schema当来源认证。
- LOCAL 历史必须重新采集当前事实后才能消费为当前指导；不恢复旧 WeakMap handle/proof、签名或权限。

## 5. 运行模式与增强开关

| 模式 | 用途 | 默认行为 |
|---|---|---|
| Lite | 普通 native task | 保留原生能力；安全观察不增加执行前置 |
| Structured | 必要的封闭任务/评测决定 | 只在该任务需要时配置严格schema/decision工具 |
| Guided | 可核验历史确有收益 | 先量化 context ROI；无收益不注入 |
| Exploratory | 研究与方案探索 | 旁路保留建议；不自行改规则/配置/模型/执行权限 |

模式不代表不同模型等级或新的批准类别。增强可关闭，硬规则不因此关闭。

## 6. 实施顺序和验收

### S0 / S1 当前切片

S0/S1 这里是切片代号，**不是 Meta 自治注册表的仓安全评级**。

- S0：本架构、现有owner路由、职责/状态/合同与事实边界；不修改运行时。
- S1：本地通知观察宿主接线已交付，复用 `createPiObservation` 和 `EventStore`。PR34 交付源/mock，PR55/56 交付 Owner 选定的 notification-only 固定本机安装、文件回读及隔离新会话 SDK 加载证据（见第7节）。默认只记录安全本地agent/tool metadata，不写bank/history/模型/权限、不修改工具输入结果或触发continuation；缺cwd/HEAD、宿主注册调用失败和存储故障固定诊断/fail-open；加载期命令表预检仅 best-effort，不覆盖 Pi 自身冲突处理。源码、实际安装、隔离加载与所有既有会话/live事件仍分别判断。
- 会话source只声明采样的session-cwd scope，不假装知道实际受影响仓库。同步host callback必须轻量；Promise timeout不能 sandbox 同步CPU/副作用。

### P0：先修 harness，再调用模型

1. Runtime admission/provenance：profile before/after、protected/volatile drift分类、SDK/broker/harness/subject/history摘要、明确工具/模型/思考配置和mock/reference solver。admitted 时不得已有模型调用；拒绝结果如实保留观测到的 `model_calls`（invalid-input 为 null），由本模块自身启动的 `started_model_calls` 恒为 0。漂移原件不反写，无法归因不猜测。Stage6 P0 admission/decision/planner source 已通过 PR35 合入 main `d2abf0c1`（包含 PR32 `a42ff57` 的 source-only 祖先）；旧16-call draft仍 INVALID。另有只读 host seam（`scripts/stage6-host-admission.mjs`），只摘要 profile metadata、不读凭据字节、不启动模型，也未接 planner/default Pi。当前 `scripts/stage6-pilot-coordinator.mjs` 与 PR43 K1 admission、PR44 history bridge、PR45 synthetic host preview 已进入 main：由受信宿主显式提供 SDK/broker/source/history metadata，围绕整轮 profile/provenance bracket 和共享 pretransport budget 生成 `metadata-only`、`authorization:none`、`executable:false` 结果；PR45仅用SDK1.1 fork与合成LOCAL/截获SSE，未满足paired metric冻结的public1.0.4/真实history/model/broker事实，不代表实际质量、默认Pi或有效pilot。
2. Strict decision：使用固定 decision tool（case_id、decision、reason enum，additionalProperties=false），区分 tool-not-called/schema-invalid/refusal/provider-error/semantic-mismatch；不把自由文本JSON或 aggregation-completed当有效semantic结果。当前 source candidate 通过固定 synthetic reference/mock，不代表实际模型决策。

### P1：逐步测效益

3. Reference solver/mock provider先证明grader、失败、零请求、成本unknown与诊断行为。
4. 先明确范围的k=1；valid后才讨论新k=3预算，报告pass@1/pass@3/pass^3，不能把一次试验当稳定性。
5. Context ROI：chars/tokens、compile time、输入增量、latency/tool delta、semantic gain、token cost。guidance无收益不注入，不强制memory。

### P2：有数据再扩展

Timeline/trace assertions、run→regression promotion、pass^k、observability、发行与回滚。每阶段source/mock/fresh独审/CI/普通merge/remote-main分别验真；源码、合成和历史相容不推导live。

## 7. 已知事实和仍未完成

- Meta 已交付 PR548正常执行减阻、PR549分层producer、PR551严格只读reconcile、PR552有效目标分支完整门禁、PR553共享handoff；当前Meta owner入口见其 `owner-configurable-automation-policy` Change 和 `docs/handoff/2026-10-10-reconcile-target-base-current-handoff.md`。
- Vista Stage1–5源码/明确scoped运行已交付；不是默认日常Pi或生产bank验收。
- Stage6 source-only P0 admission/decision/planner 已由 PR35 合入 main `d2abf0c1`，并包含 PR32/a42ff57 的 source-only 祖先；旧私有runtime草稿16调用/8session/0bank为 **INVALID**：严格决定未满足、profile drift未归因。原报告和INVALID assessment都保留，不借为质量、ROI、成本、current proof或发布。
- Meta PR551样本Node20/26 closed-row相容只证明样本消费，gate仍unknown/not-evaluated；不是Stage6/default activation/current permission。
- 截至2026-10-18，PR37/38已交付trusted-host provenance/window source；PR43–51交付K1 admission、history bridge、synthetic preview、Usage metrics及明确的actual runner/READ compatibility。这些源切片不再是待实施项，也不各自代表真实运行成功。
- [PR52](https://github.com/chenhaoxiang/pi-vista/pull/52) 已将[首个有效actual K1窗口](handoff/2026-10-13-k1-actual-window-closeout.md)纳入main `7b8ed451`：固定harness `eec33523`、publicSDK1.0.4与选定模型，8fresh sessions/16requests/strict8of8，baseline/guided各4/4，profile/provenance不变、bank写入0。它与旧INVALID草稿分开；当次scoped current verifier不是可恢复的当前proof，也不是通用producer认证。
- [PR53/54](https://github.com/chenhaoxiang/pi-vista/pull/54) 已交付[离线上下文成本分析与候选](handoff/2026-10-14-offline-context-cost-source-closeout.md)。既有窗口无semantic gain、tokens6415→10251（+59.8%）、cost为null，结论为`not-beneficial/do-not-inject`；804字符候选只是离线长度比较，尚无新模型质量或长期ROI证据。不为补状态重跑该窗口或默认注入Guided。
- [PR55/56](https://github.com/chenhaoxiang/pi-vista/pull/56) 已交付[notification-only固定本机安装及独立加载证据](handoff/2026-10-14-local-observer-install-closeout.md)：11包/86runtime文件、私有shim回读与隔离SDK1.2新会话3场景通过。没有强制旧会话reload，也未证明所有用户会话或live全局事件已启用。
- Meta默认构建/策略链的限定独立build/typecheck已由PR603–605交付；不再把该scope报为未实施，也不外推为全仓语义覆盖、模型或安装资格。当前精确范围看Meta的`docs/architecture/2026-10-17-default-core-typecheck.md`。原signed route/key来源、完整SDK declaration health与Mac个人认证broker仍在相应路线使用时独立核验，不变成LOCAL当前前置。
- 发布须落定account/channel/version/启用与rollback范围，并遵循真实授权、资金/平台/生产边界；本架构不自行发布。

## 8. 研究候选，不是新依赖

优先核验和借鉴 `kreek/pi-do-eval`（harness/trial/profile/verifier/cost）、`tryingET/pi-evalset-lab`（dataset/variant摘要/compare）、`kreek/pi-tdd`/`pi-proof`（reference oracle）、`tryingET/pi-server`（idempotency/terminal timeout/replay）。仓可用性、license、隐私和本机fork兼容性要逐项核验；此处只是研究候选，不代表已安装或已证明适用。

agentmemory仅作为memory benchmark对照，不替换当前Hindsight/LOCAL。不要为了复用而另装社区SDK、改primary model/thinking/tools、引入更重的agent framework或新的审批。

## 9. Owner落位

S1 notification-only入口已完成上述固定本机安装与隔离新加载，不再安排重复安装/验收。默认LOCAL/history/guidance、所有既有session加载、长期收益与发布仍未由这些证据证明；准备时快照里的pending不覆盖后继交付，后继交付也不回写旧失败。

Vista主架构维护本页与 `docs/architecture.md`，实施计划维护同一 `openspec/changes/pi-operational-rollout/`。Meta保留自己的policy/guard/gate/execution/reconcile实现与文档，只链接共同边界，不复制Vista实现。当前用户已授权按顺序连续实施；只有真实scope变化、必要技术条件失败、资金或实际用户规则才停相关动作并请求必要输入，不重新索要每一步批准。
