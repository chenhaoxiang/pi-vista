---
doc_type: handoff
project: workspace
owner_repository: chenhaoxiang/pi-vista
product_line: pi-vista
release_scope: source-only Stage6 P0 admission candidate; actual pilot/release undecided
status: completed
truth_mode: snapshot
created: 2026-10-11
verified: 2026-10-11
ssot: false
---

# Stage6 P0 准入与严格决策源码收口

## 交付事实

PR35 已普通合入 `main`，合并提交：
`d2abf0c1ee5546aa27c3be1c082e3f3c149736d0`。
它同时带入此前 PR32/a42ff57 的 source-only paired metrics/planner 祖先；PR32
此前保持 Draft 的状态不被借用为真实运行证据，现仅表示其源码已随本次普通合入进入
main。PR35 head：`50509e7a9dce454f54fa1adb3245e54569941950`。本文自身仍待
独立 docs PR/main 包含，不用 PR35 反向证明这份补充文档已经交付。

精确 head CI：`38098891376`，Node20/22/26 source/packed-consumer SUCCESS；
head 提交另有 GitGuardian SUCCESS。精确 main CI：`38099439850`，三 Node source/consumer
均 SUCCESS（不称另有 main GitGuardian）。主线回读为 `d2abf0c1`，本地主 checkout
通过 scoped ff-only 同步回读一致。

本切片新增：

- `scripts/stage6-admission.mjs`：闭合 provider/model/thinking/SDK/harness/
  subject/history/broker/context DTO；protected/volatile profile drift 分类；真实
  admitted 对象的弱身份与单对象请求预算；metadata-only、authorization none、
  executable false。
- `scripts/stage6-decision-tool.mjs`：结构化 `stage6_decision.arguments` 合同，
  `additionalProperties:false`，固定枚举；reference/mock fixture oracle；
  `tool-not-called`、`schema-invalid`、`refusal`、`provider-error`、取消/超时等非成功
  分类，以及 `semantic-mismatch`。
- `scripts/stage6-host-admission.mjs`：显式调用时才执行只读 profile `lstat` 摘要，
  不读凭据字节；将 admission 与既有 pretransport `streamFunction` 绑定，拒绝复制
  admission、model/thinking 漂移、session/共享预算超限和 shutdown。

源测试计数：新增 15 个、既有 paired/planner 16 个，合计 31 个切片测试；release
script 全套 178/178。实际 Node20 source/packed-consumer、OpenSpec、whitespace 与
hosted CI 均已通过。该证据是源码/合成/隔离验收，不是模型效果、当前权限或发布证明。

## 明确未完成

- 未读取真实 profile、凭据、broker 或 Stage5 私有 bank；host seam 只是显式调用的
  source candidate，未接入 Stage6 planner、默认 Pi、workspace-guard、ai-gate 或主任务。
- 未执行真实模型调用；旧 16-call/8-session/0-bank 试验仍为 INVALID，严格决定 0/8、
  profile drift 未归因的原件保留，不重放、不追加调用。
- 未形成真实 SDK/source-subject/history 的完整当前 provenance；未形成 k=1 有效 paired
  quality/cost 结果。release、account/channel/version、rollback 与默认 activation 仍未定。
- host seam 的相邻 before/after profile snapshot 仅是 admission 时刻样本；全 pilot 的
  跨 transport budget、SDK/broker/source/history 真实性绑定仍属后继接线。
- 现阶段 source review 的 report-only 备注：收集错误码命名空间、budget/status 字段
  命名、options accessor hardening、inert-import 覆盖面等，留到实际 host binding 切片；
  不因此新增人工闸或阻塞主链。

## 后继顺序

1. 先对当前 source/main 做一次独立只读回读与运行证据归档；
2. 在不追加真实模型调用的前提下，补齐实际 host collector 的 SDK/broker/source/
   history 只读 provenance 与 pilot-wide budget；
3. 再做 bounded k=1 pilot，先验证 reference/grader 与 strict decision，再决定是否
   有授权、有预算地运行新窗口；任何 INVALID/unknown 继续保留，不能转写成成功。
