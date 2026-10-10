---
doc_type: handoff
project: workspace
owner_repository: chenhaoxiang/pi-vista
product_line: pi-vista
release_scope: source packages 0.1.0 candidate; publication channel/version still undecided
status: completed
truth_mode: snapshot
created: 2026-10-10
verified: 2026-10-10
---

# Stage5 限定 LOCAL 运行与源码主线收口

## 已完成（2026-10-10 实时回读）

[PR30](https://github.com/chenhaoxiang/pi-vista/pull/30) 已普通 merge，源码、运行安全摘要和应用文档一起进入 main。Stage5 在**明确合成单样本／本机 LOCAL／固定宿主命令 scope**内实现、运行和共享交付；Stage6 paired效益、成本和发行仍未完成。不启用日常Pi/生产memory、不恢复历史或签名权限。本补充文档自身尚待独立PR纳入，PR30不证明它已在main。

- base：`1b925096b6fa37f5ab6ff09bf6217499f77735a6`
- 原源码：`e4a7b489e989ba031f37d63a169b00eaf5e49896`
- 最终source-reviewed/actual-trial：`846b9a0b135dd88a3311c16ba23c24e61d8216f3`
- 最终runtime-document-reviewed head：`66d72ba4d44408c6407665136cf8730955a2e05b`
- 普通merge/main：`b245d7f069085a19d18edcdc5d53ad809e21b858`
- 精确dochead CI：[38055998963](https://github.com/chenhaoxiang/pi-vista/actions/runs/38055998963)，Node20/22/26 source/packed-consumer和GitGuardian SUCCESS
- 精确main CI：[38056567710](https://github.com/chenhaoxiang/pi-vista/actions/runs/38056567710)，三Node source/consumer SUCCESS；不称另有main GitGuardian
- Git/API核验main包含reviewedhead、tree相同；canonical `github-public/pi-vista` 由官方scoped sync安全ff-only至b245d7f、clean、0/0
- 未写补充docs前，隔离worktree精确b245d7f实际Node20.20.2 full source/consumer再验通过：`tmp/release-contract/node20-gyHGAs`；native1282/11tarball23exports/strictTS5.9.3，与实际bank运行分开

## 分层审查与失败保全

原e4 fresh full9 readonly review `9dd8d45f-95c9-4ff3-894e-7df62c61fd07` BLOCK0/2/0，hash `51d404be76b5f23ad1cca9b86ee13cb67b9804f69ae6981ef5de0d24f23f1f8f`。父级artifact4red、missing-ref/readfault native1red先于最小修复；政策第四optional artifact SHA保留旧生成字节，fault晚armed保证组合不重retain。完整7纠正 `5985e424-49cc-4414-bcc7-593a9ad42bcd` F1/F2CLOSED0/0/0，hash `3e1cb2e60330dd1041814a1b89bf172890a88ed02d0017a5cae42714655b861b`。后继5doc运行记录审查 `117c4ac1-4c4c-4c73-8b11-005fb93497ba`0/0/0，hash `5d619bf6f016debd2a5412d410f1c40158193b3a90c0dcc7db871ba696809af1`。

这都是同模型独立工程审计：originalfull9+complete7 correction+5doc，不是freshfull13、异模型、人类批准或新执行门槛。原e4 hostedCI38051152230红、冷cache ENOTCACHED、旧observer15ms nested失败保留；后来的新fixture/外层/hosted成功不反写原失败。只收窄新fixture：真正runtime tarballs/source-locked compiler/two native APIcases，不替代外层consumer-installed compiler或全仓语义覆盖。原packages/root/signed/local/guidance/journal/validators/gates/旧断言/locks/deps/CI均未改；三个operator helpers仅显式additive扩展、默认保持原行为。

## 单样本实际结果

用户批准bank `pi-vista-local-test-01a114ab`，唯一新namespace `workflow-01a11fcc-actual` / 一份合成指导文档。PID14348执行freshverify/exactpreviewconfirm/ONEretain200/精确original/currentcontext/deprecate失效；独立PID52511retain0、real原文200→client503/sink-failed保留→仅readonlyreconcile/recovery、recallownref1/importobserved/freshreadrunproof/currentcontext/reject失效/shutdownnotcurrent。没有第二retain，不重处理旧失败/journal。

每个进程真正native learning590/0nonpass；guard只有三个固定宿主命令6admit-settle/0block/drop，不覆盖Gitmetadata、nested processes、FS/OS/Meta或日常Pi；bankroute audit另记。两进程source、artifact `130a45d721ab53ed509da8f9a611df3e5c1ef87af0165ffd46cc4545ae4280fe`、policy `a56c67f87511e32cf566c946a8fd842d696282c413366b6e9347db1a586a98cf`、bankconfig `ca30c23879651145c4a910e5143acc68afa84ea68ca2cb494554595acc014af7`、doc `ead26d1b830617cf47a698aa469688631c31f8a68e7ca70368629746f3a49d55`一致，原文/crossphase/final检查通过。

API实际0.10.2及已接受的五个部署文件一致，不称heap/whole-service/upstream来源attestation；bank保持chunks/observationsfalse/defaultstrategynull，未改embedding/model/维度/指令/全局service/dailyPi/main trial。新历史仍not-checked/none/false；回调是可信宿主代码，不是OS硬沙箱或人类身份。过程中的native/synthetic/当前proof不能执行学习动作或更改Meta裁决。

[限定运行snapshot](2026-10-10-local-workflow-scoped-runtime.md)保留原准备时PR/mainpending与安全report hashes。原privatereports/reference/policy/journal仍在sourceWT `local-workflow-01a11fcc/tmp/local-learning-workflow/workflow-01a11fcc-actual/`，安全summary/review/CI/红绿log在其 `tmp/local-workflow-proof/`，不得清理重放；它们不是Git公开原件。后继main/postmain证据在本补充WT的tmp。父级回读不冒称审查者独立重放。

## 未完成／后继

- 本补充main closeout自身独立PR/main纳入仍pending；不得递归用旧PR伪证明。
- Stage6应以相同条件代表任务做无经验/有经验paired对照，测成功率/返工/人工介入/耗时/token成本，然后核验发行账户/渠道/版本/rollback。当前无这项实际数据，不宣称能力提升、推广或发布。
- default/live产品记忆、签名producer/key、Mac身份broker、OS/跨机器/分布式/持久withdrawal保证、完整SDK declaration债务仍独立未解决；不由Stage5局部PASS解除。
- 任何新增资源试验或生产/默认活跃配置动作需具体范围；已用完的这一个新样本不是无限bank/model试验许可。

入口：[operator guide](../local-learning-workflow.md)、[operational design](../../openspec/changes/pi-operational-rollout/stage5-operational-design.md)、[tasks](../../openspec/changes/pi-operational-rollout/tasks.md)、[LOCAL library](../local-learning.md)。
