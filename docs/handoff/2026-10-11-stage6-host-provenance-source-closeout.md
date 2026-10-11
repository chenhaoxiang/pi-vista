---
doc_type: handoff
project: workspace
owner_repository: chenhaoxiang/pi-vista
product_line: pi-vista
release_scope: Stage6 trusted-host provenance source; no actual model or default activation
status: active
truth_mode: snapshot
created: 2026-10-11
verified: 2026-10-11
ssot: false
---

# Stage6 宿主 provenance 与整轮预算源码交付

## 已交付结果

[PR37](https://github.com/chenhaoxiang/pi-vista/pull/37) 已于
2026-10-11T08:35:36Z 普通合入。精确 reviewed head 为
`849ebe37305caceaa475f04fe63316d92b4bd6f9`，merge/main 为
`93c3825236ad9daa1d8bb79c46196e7751a1a501`。source、设计与文档地图共
11 个变更文件已随 PR37 交付；限定 ff-only 同步后 canonical/main/远端一致且
工作树干净，逐文件 head/main 回读无差异。

本补充 handoff 的独立 docs PR 纳入在准备时仍 pending；PR37 不被用来证明
本新文件此前已经在 main。源码交付不是实际 host/model/pilot/default-Pi 完成。

## 结队分工与实现边界

- `01a11fcc` 在独立 worktree 提交 SDK/broker 两文件 `e1ce93b`；集成为 `e533b28`。
- `01a120e4` 实现宿主 coordinator、公共设计/集成与修复。两方不并发写同一 worktree。
- Collector 只读显式 SDK 的 public manifest/entry；SDK 匹配覆盖
  `manifest-and-public-entry`，依赖闭包 `not-observed`。public `1.0.4`、历史
  `1.0.4-fork.1` 和 installed `1.1.0-fork.1` 合同不改标；同 entry hash
  不等于同 SDK、依赖、当前加载实例或 vendor 认证。
- Broker 仅校验显式 command pin，并 open/stat/close；不读 credential bytes、
  不执行 shell、不输出 raw command/path。其 unsalted metadata fingerprint 可
  链接目标或验证猜测，不能写成保密或 Owner 身份证明。
- Coordinator 复用 collector validator，围绕 preparation/window/finalization
  采集 profile/provenance；共享一个 window 内的总 pretransport budget。
  同一 native agent 不允许被重叠 window 堆叠 wrapper，finalize 撤销并释放
  本模块的临时 identity reservation。它不是全局执行锁、审批或学习账本。
- 结果始终 `metadata-only / authorization:none / executable:false`；
  `integrity_status:unchanged` 不等于 semantic decision、measured quality、
  current proof 或有效 Stage6 pilot。默认 Pi、guard/gate、模型/思考/工具/prompt
  与 bank/service 配置均未改变。

## 验证与独审证据

- 最终 release-contract **228/228**，0 fail/cancel/skip/todo；collector 31、
  coordinator 18、admission 7 个 scoped native 用例。
- Node26 source gate、实际 packed-consumer 和实际 Node20.20.2 source/consumer
  通过；既有 11 包构建/类型检查/消费者合同由现有 gates 覆盖，没有新增 SDK 依赖。
- 精确 head CI **38123716001**：Node20/22/26 source/consumer 全成功；head
  另有 GitGuardian success。精确 main CI **38125352527** 三 Node 全成功，
  不声称 main 另有 GitGuardian。两次 CI 的精确 SHA/job/conclusion 公开读回
  已保存到 [public evidence readback](evidence/2026-10-11-stage6-host-provenance/README.md)。
- 独审为分层覆盖：fresh `c83d94a` 源审 `d3ece8c4`，retained `2532a86`
  lifecycle 复审 `25f7e39b`，最终 `849ebe3` cross-window 复审 `4d1d119d`；
  父级逐 run runtime readback 记录为 `codex-local/deepseek-flash:high`，投影见
  [public evidence readback](evidence/2026-10-11-stage6-host-provenance/README.md)。最终范围无 P0/P1/P2，
  但这不是一次新的 fresh 全量 849 审查，审查者未执行测试或 Git committed diff。
- 最终源审 artifact SHA-256：
  `264ec4f8d6274149212d271313358688a73aabfcd58361aafc480e0966d7751c`；
  [review record](https://github.com/chenhaoxiang/pi-vista/pull/37#issuecomment-6107067568)。
- 早期同模型窄复审曾错误标注为 DeepSeek，已追加
  [runtime identity correction](https://github.com/chenhaoxiang/pi-vista/pull/37#issuecomment-6106692158)，
  原记录保留，未用错标签满足异模型门禁。原 source BLOCK、version BLOCK 与
  真红回归（30/1；14/3；17/1）均保留，未删除断言或重写原件。

## Gate／合并／CI 三层真实结果

通用 Meta Gate 初次为 `FAIL_HARD`：Vista default S0、OpenSpec path、测试
`execFile` 夹具、通用检查名称与 Vista 三 Node/GitGuardian 不一致；GitHub App
review-check publisher 还返回 HTTP403。真实异审文本和普通 commit status 已上链，
**不称 App check 已创建或来源认证已完成**。

按用户本轮已明确的自动化实施/合入授权，仅对上述已核验项使用
`autonomy,path,ci,review,danger` 别名覆盖，记录 **PASS_OWNER_AUTHORIZED**，
保留原始失败。未覆盖 head/base、SHA、作者、spec、依赖、Owner policy 或
平台拒绝，不修改 Meta 配置、不伪造 check。

普通 merge 实际成功，但原 CLI **exit3**：默认 postmerge workflow `CI`
在该仓不存在，窗口结束仍 `ci-pending`。该原件保留，不写成 exit0、不重放 merge。
随后严格只读 `--reconcile` 使用本仓已在 Git 中声明的真实 workflow
`Source and packed-consumer contract`、精确 head/base/merge tuple，结果 exit0：

- `gate-evaluate: unknown / not-evaluated`；
- `actual-merge: ok / already-merged`；
- `post-merge-ci: ok / ci-success`。

这是后继当前只读对账，不是改写原 CLI 收据、当前许可或新增 merge 请求。
原件位于集成 worktree `tmp/stage6-provenance/`，含 `gate-ready.json`、
`gate-owner-scope-retry.json`、`gate-merge.json/.stderr`、
`reconciled-terminal.json`、main CI 和历史 2532 head 快照、回归日志；精确
849 head/main CI 及逐 run 模型 readback 的共享投影见上述 evidence 文档，原始
CI JSON 另保留于 closeout worktree `tmp/stage6-closeout/evidence/`。

## 下一步

1. 当前实际 loaded-SDK/session/source/history/request-envelope/decision/transport
   仍待新的模型零调用宿主验收；既有 S1 observer 3/3 synthetic/native-read 只证明
   它自己的 scope，不升级为本 coordinator/LOCAL/current proof。
2. 完成上述验收后，明确新的 `k=1` window 的 SDK/subject/history/model/budget。
   原 16-call INVALID window 保持 exhausted，不重用为质量/ROI/成本证据。
3. Context ROI、k=3、发布 account/channel/version/rollback 仍后继；不新增
   人工闸、模型投票、账户/broker 架构或主任务执行前置。
