---
doc_type: spec
project: workspace
owner_repository: chenhaoxiang/pi-vista
status: active
truth_mode: maintained
created: 2026-10-12
verified: 2026-10-12
---

# Stage6 K1：只读历史上下文桥接

## 目标与实施范围

本片把 trusted-host 已取得的公共 `GuidanceReadback` 和公共
`LocalCompiledContext` 转成现有 `stage6-history-context/1`，直接交给
`admitK1`。不新增 summary 协议、存储库、预算计数器、审批链或 Pi 主任务门槛。
转换器不读取 store、bank、文件或凭据，不调用模型；失败只表示这份 K1 评测
数据不可用，不能取消或改变正常 native Pi 任务。

桥接源码已通过 PR44 普通合入 main `dc8fbe02`，reviewed head 为 `a0409b3`。
父级在集成 worktree 已实际跑过 16 个定向方法、264 个 release-script cases、
source/packed-consumer、实际 Node20/typecheck/OpenSpec/diff-check；精确 head CI
`38192928031` 与 main CI `38193866155` 三 Node source/consumer 均成功，
head 另有 GitGuardian 成功。这里的 positive 使用真实公共 LOCAL factory 的
合成 read/import/fresh verify/compile 链，不是实际 bank 或历史来源验收。
桥接 source/mock、独审、CI/main 与真实历史读取、实际 K1 模型窗口分别验收；
本页不声称后两项已完成。仍沿用同一
`openspec/changes/pi-operational-rollout/`，不启动竞争性 Change。

## 单向数据流

```text
trusted-host read/import/fresh verify/compile（既有 LOCAL 库）
  → GuidanceReadback + LocalCompiledContext
  → buildK1HistoryContext({history, context})
  → snapshotHistoryContext 校验的 stage6-history-context/1
  → admitK1 的 metadata-only 评测输入
```

桥接只回验公开数据结构与内容关系，不恢复 LOCAL 的私有 WeakMap handle 或
verifier 证明。复制/JSON roundtrip 可以携带 metadata，不能带回当前验证能力。
转换成功不表示后端 read、fresh verify、模型评测、权限或发布已经成功。

## 输入与绑定

- 历史 readback 必须是 `not-checked / none / false`。通过公开
  `prepareHistoricalGuidance` 回验其 document 原文、title、tags、经验与摘要；
  顶层与 document 的 `content_digest` 必须一致。
- 本片只转换一份历史与一个 compiled item。多来源不能由单个 history digest
  代为背书，不截断或伪关联；调用宿主应先把 `retrieve` 结果收敛到一个
  verified handle，再使用既有 `compileContext(..., { max_items: 1 })` 编译。
  `max_items: 1` 不是对多来源选择的替代；若仍有多个 selected handles，编译
  会产生 `omitted_ids`，桥接会拒绝。
- compiled item 的 repo/source/policy/environment 必须与历史经验一致，script
  与 steps 必须对应同一历史内容。compiled 计数、预算、selection/provenance
  结构必须与实际内容一致，不能只复制一个 digest 或 `verified` 标签。
- 三层 run identity 有意分离：历史经验的旧 `run_id`；LOCAL observed import
  后新 handle 的 compiled provenance `run_id`；未来 K1 coordinator 的 window
  `bindings.run_id`。既有 LOCAL `importGuidance` 拒绝复用旧 run/experience ID，
  因此桥接不能强制历史与 compiled run 相等。新 run/experience 标签只接受
  安全 metadata；桥接显式拒绝 compiled run/experience 与历史旧 ID 重用，但不
  输出这些 ID，也不作为权限认证。
- 来源与当前性仍由 trusted-host 的既有 read/import/verifier/compile 流程负责；
  此纯转换器不证明外部回调真的执行过，也不认证复制对象的来源。bridge 的
  label 校验保持结构和已知凭据签名边界，故意不复制 learning 的完整 label 黑名单
  （命令词、保留字及 AKIA/ASIA 前缀规则）；
  这些标签不进入输出，只参与输入一致性检查，不能作为权限或来源认证。

## 输出与摘要职责

输出直接复用 `stage6-history-context/1`，不增加字段：

- `schema / purpose / current_verification / authorization / executable` 固定为
  既有 historical-only 合同；
- `content_digest`：历史文档摘要；
- `subject_source_sha`：历史经验的 subject source；
- `context_digest`：实际 compiled content 的 SHA-256；
- `character_count`：实际 compiled content 长度；
- `provenance_digests`：编译 item 中的 bounded observation 摘要。

不输出 raw content、document、guidance、路径、selected/omitted IDs、handle、
proof、permission 或 budget。历史原文和当前编译文本在显式宿主边界内用于
回验/哈希，不搬入 Vista 观察协议或报告。编译 `status=verified` 只是输入
描述符，不会使输出变为当前证明；输出仍是 `not-checked / none / false`。

K1 的 8192 字符上界、每 session 两请求、全窗口最多 16 请求等既有声明不变。
桥接不建立 budget；实际请求总数仍由一个 `openStage6Pilot` window 管理。

当前源码入口为 `scripts/stage6-k1-history-context.mjs`，只在显式函数调用时
转换输入；公开 script/task 默认入口均未接线。源码测试使用合成 store/readback，
并包含 known-credential、非法 bank/schema/purpose 等输入拒绝回归；`retain` 不执行；报告中的计数不被用来认证外部 source 或 current proof。

## PR43 已交付与未完成边界

PR43 的 source-only K1 admission 已普通合入：

- reviewed head：`d285922725860fe89d74b4313bbc5fbbe6701229`；
- merge/main：`37a1e4f2783b0551585f78c1848fcc05b76a8e82`；
- head CI `38184873984`，main CI `38185441575`：Node20/22/26 source 与
  packed-consumer 均成功；head 另有 GitGuardian 成功，不称 main 另有该 App；
- 父级本地 8 K1 方法、248 release-script cases、source/consumer/实际 Node20、
  typecheck/OpenSpec/diff-check通过；lint 命令成功不代表存在完整 lint 实现；
- 独立异模型只读源审及保留的窄修复审查无 P0/P1；最终两条 P2 为日志归属和
  UTC 日期措辞备注。审查者没有 shell，未独立运行测试。

默认 Meta Gate 的 S0、CI 名称与 App review 403 原始失败保留。按既有用户授权
使用限定 Owner override 普通合入，不伪造 App check。merge CLI 因默认要求不存在
的 `CI` workflow 返回 exit 3；随后使用仓内真实 workflow
`Source and packed-consumer contract`、精确 head/base/merge 做严格只读 reconcile
得到 merge `ok/already-merged` 与 postCI `ok/ci-success`，gate 行保持
`unknown/not-evaluated`。没有重放 merge 或把 reconcile 变成新授权。

上述 PR43 事实本身不证明 bridge；PR44 源码交付与精确 CI/main 独立记录在本页
开头。两项 source delivery 均不证明 actual history/K1、通用能力提升、ROI、费用、
默认 Pi 安装或发行。旧 16-call `INVALID` 草稿与原失败继续保留。
