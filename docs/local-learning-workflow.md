---
doc_type: guide
project: workspace
owner_repository: chenhaoxiang/pi-vista
product_line: pi-vista
release_scope: source packages 0.1.0 candidate; no default activation or publication
status: active
truth_mode: maintained
created: 2026-10-10
verified: 2026-10-10
---

# 单样本真实 LOCAL 工作流（显式操作入口候选）

LOCAL library 源码由 PR28/29 交付；用户已明确选择在现有 `pi-vista-local-test-01a114ab` 仅新增一个 namespace / 一份合成文档，进行 Stage5 实际闭环。已有资源风险告知包括现有 embedding/reranker 用量。**当前仅完成新 operator 候选和合成测试，尚未执行这个新真实样本**；不从源码或 mock PASS 推导实际验收。

## 显式命令和既有合同

```sh
node scripts/local-learning-workflow.mjs --phase=write \
  --source-sha=<exact-clean-committed-SHA> --namespace=<one-new-safe-label> \
  --credential-config=<existing-explicit-private-source> \
  --service-fingerprint=<accepted-private-five-file-baseline> \
  --deadline-ms=900000 --timeout-ms=120000 --allow-bank-write

# 另一个独立客户端进程；零 retain 权限，client-only 读故障选项不影响服务。
node scripts/local-learning-workflow.mjs --phase=read \
  --source-sha=<same-SHA> --namespace=<same-label> \
  --credential-config=<same-private-source> --service-fingerprint=<same-baseline> \
  --deadline-ms=900000 --timeout-ms=120000 --allow-bank-read --inject-read-fault
```

这些是 owner 显式操作入口，不是只读 `vista` CLI 命令、不注册 Pi 扩展、不自动调用或默认发现。目标固定 localhost8888/专用 bank、API0.10.2/被接受的部署文件指纹、chunks/observationsfalse/无 defaultstrategy。0.10.3 staged 资产不等于 active；版本/文件/配置不符时停止该试验，不升级或重启服务、不切配置。私有 credential/config 仅在宿主已有来源通过原 FD reader 读取，值不进入日志、Git或 reviewer。新 fixed alias 是独立 guidance target/tag域，避免查询旧 Stage4 originals；真实 bank 不变。

## 验收链路

1. 拒绝不完整/未知/accessor/Proxy/不匹配 phase 选项；核对精确 HEAD/clean source。复用 fresh Git archive+locked build/hash helper，仅显式 opt-in 加载同一 archive 的 LOCAL/verifier/固定 ledger。包含新加载脚本的 artifact bytes 校验；不在启动时加载忽略的 checkout dist。
2. 执行三个固定 trusted host 命令：原 source gate、使用原 native reporter 的正数 learning suite、原 packed-consumer gate。原 stdout PASS/总数字不是 native counters。guard只覆盖这些固定命令的 admit/settle（6events），不覆盖 Gitmetadata、嵌套子进程、FS/OS/Meta/日常Pi；bankroute audit是单独范围。
3. native 完成时固定 observation timestamp；每次 collection/revalidation 再核 source/artifact，但不重标旧结果时间或用历史flag续期。scope/五绑定、gate版本/config、全部必需checks/suite/完整声明覆盖精确绑定，current proof仅本进程。
4. 首个 bank preflight、跨阶段 immutable trial-policy 完成后才允许journal/retain。写阶段仅一次 LOCAL observe→candidate→fresh verify→preview→宿主精确内容确认→retain/readback；保留private reference/projection、体验当前context，并验证deprecate使旧selection失效。
5. 独立读阶段只读原文/对账/query。可显式注入“真实原文GET200后向客户端交503”的一次读故障，记录原失败，再只读恢复，不停止服务器或重发 retain。缺 reference时也只能用已有intent/deterministic ref只读恢复，缺/漂移policy不能重建baseline。
6. 历史以新run/experience identity导入observed，不能复用保存的handle/proof/plan；当前context需独立客户端重新执行固定host plan后采集fresh proof。query必须包含自己的ref并精确original；终态和shutdown不被晚回调或保存flags复活。

隐私/恢复边界不变：原library/root/signed/guidance/journal/schema/断言/锁/CI未改变；helpers仅additive explicit LOCAL加载和原私有reader命名导出，旧caller默认不加载/不增加返回字段。没有新的批准或第二学习账本；已有授权内的confirmation仅表示精确内容 API。新write不确定保留failed/unknown，拒绝第二retain；所有旧失败/journal不清理、不重处理。生命周期只在本进程，历史不证明原record仍active或恢复当前权限。

## 合成与完整门禁不混算

普通测试使用test-owned tmp、合成 service/config、拦截 fetch、真正编译的11包/真实tarballs和独立native进程，不连接真实bank/model。新全流程夹具使用**小的合成host compiler-contract + 两个实际原生LOCAL API用例**，避免在外层门禁内递归重跑全部旧套件；它不称全仓语义覆盖。原完整source/native/consumer门禁仍原样在外层Node20/26与 hosted CI执行，不能用夹具报告代替。

初次重型fixture三次尝试在旧Pi observer `checkpoints reject preserves synchronous notifications and consumes late failure` 短预算测试失败；日志和失败报告保留，未修改或放宽旧断言。新fixture仅收窄自身目的后通过，不宣称修复那项负载下失败。外层完整门禁仍必须真实通过；重复失败就保留具体技术阻塞，不继续无效重试或触发真实POST。

实际资源调用、API fingerprint/config/source admission、write/restart/recall/current vs history、故障对账和共享收口后另行记录。Stage6 paired成功率/返工/人工介入/耗时/token成本/发行账户与回滚仍待独立实际数据，不由此改模型/guard/gate或发布。

设计：[Stage5 operational](../openspec/changes/pi-operational-rollout/stage5-operational-design.md)；前置：[LOCAL library](local-learning.md)、[source closeout](handoff/2026-10-10-local-learning-source-closeout.md)、[guidance](hindsight-guidance.md)。
