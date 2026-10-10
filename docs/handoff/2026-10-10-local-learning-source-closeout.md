---
doc_type: handoff
project: workspace
owner_repository: chenhaoxiang/pi-vista
product_line: pi-vista
release_scope: source packages 0.1.0 candidate; publication version/channel undecided
status: completed
truth_mode: snapshot
created: 2026-10-10
verified: 2026-10-10
---

# Stage5 LOCAL 源码交付与未完成运行边界

## 实时结论（2026-10-10）

独立 opt-in `@pi-vista/learning/local` 的源码、设计、使用说明和合成回归已随 [PR28](https://github.com/chenhaoxiang/pi-vista/pull/28) 普通合入主线；精确 head/main CI、canonical 和隔离 post-main Node20 回读通过。**这是 Stage5 源码交付，不是完整实际工作流、默认 Pi 激活或 Stage6 效益/发行完成**。本后继交接文档自身仍待独立文档 PR 纳入，不用 PR28 证明本新文件已经在 main。

- base：`22e06daf6d7c919770582318b4618f919631f232`
- 初始源码：`8850f3de9532b6df34e64caba26817d5acc30d76`
- 修正/最终被审源码：`93f29375f7a70051317c7ec0de35e3061aa1e204`
- 普通合并/main：`022afd6256b6fbf5553c9ba1436395ca131cb93e`，2026-10-10T02:33:33Z
- 精确 head CI：[38016756178](https://github.com/chenhaoxiang/pi-vista/actions/runs/38016756178)，Node20/22/26 source/packed-consumer 与 GitGuardian SUCCESS
- 精确 main CI：[38017408152](https://github.com/chenhaoxiang/pi-vista/actions/runs/38017408152)，三项 Node source/consumer SUCCESS；不伪称 main 另有 GitGuardian
- Git 远端回读确认 reviewed head 已为 main 祖先、source tree 相同；canonical `github-public/pi-vista` 由官方 scoped sync 脚本安全 ff-only 到022afd6、clean、ahead/behind0/0
- 合并后独立 worktree 精确022afd6、未写文档前实际 Node20 全 source/consumer 再验：`tmp/release-contract/node20-a0dK5A`，runtime v20.20.2，执行文件 SHA256 `38de4fc456c0c439bac48c727d378f749abb4e31f4116703bb1ee9a746fccbb6`

第一次普通 merge 请求遭遇 TLS handshake timeout；REST PR 和远端 Git 只读回读证明仍 OPEN/未合并、head93/base22e不变，随后才进行一次有依据的合并尝试并确认上述 MERGED 事实。失败与回读记录保留，不把 unknown 直接当未发生或盲重发。

## 独立审查、红回归与最小修复

初始 fresh-context 同模型只读全15路径审查 run `81e08315-dbd8-4922-aeba-f256f579bc37` 返回 **BLOCK / 0P0、2P1、0P2**，输出 SHA256 `4794cef00622c99e727c03a05fbe967fc81e7df86872be41ddf6b757145f852d`。全文已保留并贴在 PR28：

1. F1：reconcile 输入文档可通过 digest 检查但 JSON 非法，原 SyntaxError/stack 漏出公共边界。
2. F2：相互一致的 retain/readback 可携带错误的 canonical document-ID 后缀；未校验 suffix=SHA256(idempotency_key)。

父级在旧8850执行四个新增红回归（0pass/4fail），再仅修两处新 LOCAL 源码：输入文档解析失败转换成新的固定 `LearningError("invalid-input")`、零 store；有 key 的 receipt/input/original 验证既有可推导 suffix。ref-only 输入在原文回读有 key 后校验。没有 endpoint/target 配置，因此 target-prefix/Owner 真实性仍交给显式可信 store，不增加签名/密钥/审批或 discovery。

保留审查者的完整6路径纠正复审 run `1e21faa4-de89-462d-839c-7825f6991773` 明确 **F1/F2 CLOSED / 0P0、0P1、0P2 / OK with notes**，输出 SHA256 `55cca15d59fad13ed080a0d04f6cf894e3a5e508843f38e04f4cf6d0b3dfe10e`。这是 prior full15 + complete6 correction coverage，不是 fresh full16、异模型或第二自然人批准。原 BLOCK 不反写成 PASS。

## 实际源码/包验证与边界

精确修正 head 在 actual Node26.9.0 和 Node20.20.2 通过 **1265 个原生用例**，0failed/cancelled/skipped/todo；learning590、public integration30、release-script117。protocol 原 zero-test exception 不算正覆盖。全部11真实 tarballs/23公开入口、安装消费者 strict locked TypeScript5.9.3/import/bin checks通过；新 LOCAL 安装后合成工作流也在 Node20/26独立通过、0network/realbank。scoped metadata/contained links、OpenSpec strict 和 whitespace通过；root lint仍 no-op-if-present，不宣称修复独立 SDK declaration 债务。

原 source WT `local-learning-01a11fcc` 的证据：`tmp/stage5-proof/` 保留原审查/红绿/精确 CI/合并超时回读/安装后行为；`tmp/release-contract/source-74ZUij`、`consumer-ao6niq`、`node20-Ggp76p` 为精确93证据。post-main source/consumer在本交接 worktree 的 `node20-a0dK5A`。公开 Git文档保留安全事实/摘要，不提交原 tmp body、配置或凭据。

正常源码之外未改 root/signed Learning、evidence、guidance schema/store/journal/helpers、observer/CLI、gate/guard、依赖/锁或 CI；旧断言未删除/修改。LOCAL通过私有factory身份和fresh scope/五绑定验证，确认是宿主精确内容 API，不新增人工批准或第二账本。存储不确定仅只读对账，历史不恢复 live proof；shutdown/terminal失效不能被晚到回调复活。

## Meta 相容性是候选证据，不是 producer 交付

Meta peer 当时的候选 e222eaa、synthetic sample SHA256 `694bf32567912b9c7c57511f8c2665fdc61991a099b6d7f63b94dbe6e67d103f` 在 Vista 精确93安装消费者 Node20/26通过6case/18row既有 `toVistaEventInput`/`emitAiGateObservation` 相容性。gate-evaluate、actual-merge、post-merge-ci结果独立保留（pending/skipped/unknown不推ok，failed仍failed），whole CLI拒绝，store故障fail-open、0network/realbank、无当前proof/权限。后继Meta23b1候选报告shape未改，但本试验不证明其新源码或真实main/live；后续以 Meta owner 精确实际结果为准。本方不改其 worktree、Producer 或运行时，不自产 signed receipt/完整 guard coverage。

## 下一步与未完成项

1. 将本后继交接文档独立纳入 Git；它的 pending 是本文件准备时事实，不回退已完成的PR28源码交付。
2. Stage5 较大实际 LOCAL candidate→fresh collection→preview/confirmation→guidance→recall/restart/lifecycle验收仍未执行；本切片没有新增真实bank样本/更改bank或模型/共享服务/日常Pi。
3. Stage6 actual paired usefulness/cost及明确发布账户/渠道/版本/rollback未完成。默认激活、生产记忆、权重/路由/规则修改、历史动作自动执行均不由此批准。
4. 原两concise失败、唯一chunks试验和journals保留；不重发不确定请求、不重处理或删除它们。签名producer/key、Mac broker、跨机/敌对宿主/持久withdrawal也不由本source补造。

现行入口：[LOCAL guide](../local-learning.md)、[design](../../openspec/changes/pi-operational-rollout/stage5-local-learning-design.md)、[tasks](../../openspec/changes/pi-operational-rollout/tasks.md)、[Stage4 main](2026-10-09-stage4-shared-main-closeout.md)。
