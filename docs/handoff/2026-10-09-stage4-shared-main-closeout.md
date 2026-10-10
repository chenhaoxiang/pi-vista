---
doc_type: handoff
project: workspace
owner_repository: chenhaoxiang/pi-vista
product_line: pi-vista
release_scope: source packages 0.1.0 candidate; publication channel and release version undecided
status: completed
truth_mode: snapshot
created: 2026-10-10
verified: 2026-10-10
---

# Stage4 shared-main closeout

## 结论

历史时点：PR26于2026-10-09T23:02:27Z普通合并；实时核验日期2026-10-10（本机日期），API/远端Git ancestry/tree、main CI及canonical回读如下。文件名保留合并UTC日期，不把核验日期假填为昨天。本文记录PR26/75a2741已经包含的源码/运行记录；本补充文档自身的分支/PR/主线纳入尚待后续交付，不用PR26证明本文件已在main。

Stage4 的源码、文档和**明确限定的 synthetic/chunks 运行验收**已经形成共享 Git 闭环；不把它扩写为生产 bank、当前 proof、默认 Pi 激活、产品级记忆发布或 Stage5/6 完成。

- PR：[#26](https://github.com/chenhaoxiang/pi-vista/pull/26)
- 合并提交：`75a2741cac427dde6471d01711fbe01f53a04455`
- source-reviewed head：`a08b159417a9fc5d05005d84c9225567887405f6`
- merge base：`90add4e8b522e77f30652fceb74c6b2c8c49ac61`
- 远端 `origin/main`：`75a2741cac427dde6471d01711fbe01f53a04455`
- main CI：[run 38002400266](https://github.com/chenhaoxiang/pi-vista/actions/runs/38002400266)：Node 20 / 22 / 26、source/packed-consumer 均成功；合并前精确head `4d64877` 的GitGuardian成功是独立证据，不伪称main另有GitGuardian check
- canonical 主目录：`/Users/robotmac/Desktop/fly/code/202603/github-public/pi-vista` 已从 `90add4e` 安全 ff-only 同步到 `75a2741`，ahead/behind `0/0`、工作树干净
- 合并后独立 Node20/source/packed-consumer 复验：`tmp/release-contract/node20-lKqmUJ`，运行时 `v20.20.2`，通过；证据位于合并后验证 worktree，不把本文件写入主目录运行产物

## 限定运行验收

用户批准的专用 bank 为 `pi-vista-local-test-01a114ab`，仅合成数据；旧两份 concise 试验失败和其 journal 保留，不重处理、不重发。随后仅将该 bank 的 `retain_extraction_mode` 改为 `chunks`，其他公开配置、observations=false、default_strategy=null、旧文档内容和计数保持不变。

新 namespace `guidance-01a11fcc-chunks` 通过以下链路：

1. 单次 retain 返回 HTTP 200；客户端在服务成功后注入 503，随后只读 reconciliation 和精确原文回读通过。
2. 独立新客户端进程不 retain，完成同策略基线校验、原文回读、只读 reconciliation 和 own-reference recall；recall 返回 1 个 own target reference。
3. 只读数据库计数仅限定于该 bank/document，`default_transaction_read_only=on`，结果为 1 个 `world` memory unit；不读取原文，不执行 DML/DDL，不访问其他 bank。
4. 两个进程的 bank config digest、trial-policy digest、source/artifact digest 一致；结果仍是 `current_verification=not-checked`、`authorization=none`、`executable=false`。

这证明的是**该合成/chunks范围内的持久化、丢失确认恢复、独立重启和检索链路**。它不证明真实 owner receipt、签名公钥、跨机器可信、产品 bank、默认 Pi 路径、当前执行权限、发布或 Stage5/6。

安全摘要证据由原隔离 worktree 保留（不复制真实 body/token）：

- write report SHA256 `01dd26f50072fb55626cb6c55bab8ce87d0528c204abda054e446e8424375ca3`
- read report SHA256 `1c1a48ac0703ec7c111fe605cdc002903031dfcc3b7a77a9fab728cd181c44ac`
- trial-policy SHA256 `c54fd5a1ee56987e3575adfb3ec56f4d7cdd099f3d18bce649fee13bafa66649`
- readonly count report SHA256 `79fa39bcbe827e38662188ca1df630eebde231a6c34c775ead00fddf114091bb`

## 交接边界

- 原历史 BLOCK、F1–F5 修复、分层同模型只读审查和 document/runtime/source/main 各自证据保留；历史 snapshot 不改写成当前状态。
- `@pi-vista/evidence/host`、`@pi-vista/learning/pi`、`@pi-vista/learning/trace`、`@pi-vista/adapter-ai-gate` 的职责边界不变：观察/证据/草稿不授予执行或合并权限。
- Meta 的 gate-evaluate、actual-merge、post-merge-ci 三层结果应继续通过现有 `emitAiGateObservation`/`emitAiGateEvidence` 的封闭字段传递；不要把 gate PASS 推导成 merge/CI 成功，不新建第二套 learning/gate 账本。
- Stage5（显式 LOCAL candidate→fresh verification→preview→confirmation→guidance lifecycle）和 Stage6（paired effectiveness/cost/release）尚未启动。
- 后续如果扩大到旧样本重处理、其他 bank、模型/embedding/维度/指令、共享服务、生产数据或发布渠道，须重新明确范围和验收；本次 chunks 运行结果不扩展授权。
