---
doc_type: handoff
project: workspace
owner_repository: chenhaoxiang/pi-vista
product_line: pi-vista
release_scope: source candidate packages 0.1.0; publisher channel and actual release version undecided
status: active
truth_mode: maintained
created: 2026-10-09
verified: 2026-10-09
---

# Stage4 guidance：源码候选与真实检索阻塞

## 当前结论与交付边界

**Stage4 operationalAcceptance = BLOCK / incomplete。** 源码候选已经实现、提交、推送并通过本地及精确 head CI、多轮独立同模型只读审查；真实专用 bank 的原文持久化、客户端重启和失败只读对账有成功证据，但两份合成文档均没有可检索事实项，own-reference recall 均为 0。不把这些部分成功写成 Stage4 通过。

- 现行 main 基线：`90add4e8b522e77f30652fceb74c6b2c8c49ac61`（Stage3 PR24/25）。
- 源码候选：`a8d9c76183b3c05e325a11d646b4b8bfafb1b79b`；分支 `feat/hindsight-guidance-01a114ab`。
- [PR #26](https://github.com/chenhaoxiang/pi-vista/pull/26) 保持 draft，未合并；本文件属于其后续文档候选，不宣称已经进入 main。
- 不再新增 retain、重发两份既有请求、删除/重置 journal、删 bank、改 bank 提取模式或共享服务/模型配置来凑通过。
- 原文保存不代表事实提取/语义检索；source/fixture/CI 通过也不代表 operational 或 publication。
- Stage5 经验闭环、Stage6 对照评测/发行仍未启动。下一个实际阻塞是定位专用 bank 的零事实项原因，而不是签名密钥或 UID 解锁。

## 授权和实际范围

继承原 session `01a114ab-bc8a-71cf-9e74-98b87f7f49d7` 的六阶段顺序及明确选择：单人本机 trusted host、没有新的 signing key、现有 `http://127.0.0.1:8888` / `pi-vista-local-test-01a114ab` 专用 bank、只用合成脱敏指导数据及必要的现有受信凭据源。用户接受实际安装文件指纹，而非把该服务宣称为原上游 Git pin。

本次验收通路没有读取/写入 main bank，没有删除 bank、重启/升级共享实例、改日常配置、切模型、训练或启用默认 Pi。原有 coding-agent 记忆/自动 session writeback 是独立机制，原配置未改，不能用来证明或计数本试验。凭据只由受信 operator 私有 FD 读取，未进入报告、任务数据或 Git。

## 源码、修复与审查链

新增的是独立 `@pi-vista/learning/guidance` 和显式 operator。原签名 verifier/store/archive、root Learning、immutable journal/helper、CLI、依赖/lockfile及原断言未降级。

| 源码 pin | 审查与修复 | 结论 |
| --- | --- | --- |
| `868c88ab46e3f622f53d141015182cb138b145d9` | 完整 17 路径 fresh-context 审查 `e7941e77-2838-4a4b-86a7-20ba5755dfbb` | BLOCK：0 P0 / 1 P1 / 1 P2；执行 compiled client 未绑定 source SHA，OpenAPI先全缓冲后限量 |
| `5cb002d056007036241db332e2602112a205647f` | 原三项 red 回归保留；fresh exact Git archive + locked offline build/dynamic imports/产物摘要；流式一 MiB/fatal UTF-8/cancel；targeted5 `9bf65ad1-43c7-4551-98f4-2488df346dcd` | OK with notes，0/0/0；不是 fresh full19 |
| `bbd13db50f7d1333e1311eea87028154bb5457cc` | 真实 prepare 暴露 legacy dist 测试输出；本地 build-only inventory单独哈希/标记、不执行，不改 package 发布规则；narrow3 `a20cdb07-2567-4d3c-9ee5-3f077f39d344` | OK with notes，0/0/0；原17+targeted5覆盖保留 |
| `a8d9c76183b3c05e325a11d646b4b8bfafb1b79b` | 明确synthetic的完整指导事实样本；read/reconcile进度提前记录、0own-ref仍overall failed；narrow4 `c115ee04-492e-4825-b79d-8a88cb566e22` | OK with notes，源码0/0/0；不代表实际验收 |

四次调用均为指定 `codex-local-8319/gpt-6.1-sol:max` 的未参与改写、只读工程审计；是同模型而非异构，也不是另一位自然人批准。工具侧记录 complete/thinking max；审查者没有独立证明模型身份、执行 gate 或重放真实 bank。最后是 full17 + targeted5 + narrow3 + narrow4 的保留覆盖，不伪称 fresh full19。

原 review SHA256：`093a9bc1eba31d16ea012b4d9123a84ef9774985819d785233f83724a7075629`；后续分别为 `2437f2c353303d92b72cde55cf69a00c1f10ad879c4f141a87a9597494e0baa0`、`9a58c42787bf4e2c44b1f12ecc52b6f50c7bf219559cb35c3fea925455876eee`、`275dce73ac02a20e736a9f2f644f0588c003714967a6c8eb30abc5405670f146`。本地原文在 worktree `tmp/takeover-01a11fcc/source-review-*-*.md`；不能把后一次覆盖写成前一次从未 BLOCK。

## 工程与实际编译客户端证据

- 最新源码本地 **1181** native cases：0 failed/cancelled/skipped/todo；其中 learning530、integration28、script95。protocol 的 zero-test exemption 不算正向覆盖。
- Node26.9.0 source/typecheck/build/pack；实际 Node20.20.2 source/consumer 全通过。
- 安装后的 **11 tarballs / 22 public exports / strict locked TypeScript5.9.3** 通过；离线缓存不是 fresh-cache/registry/publication。
- 精确 `a8d9c76` Ubuntu Node20/22/26 CI：[run37920913953](https://github.com/chenhaoxiang/pi-vista/actions/runs/37920913953)，三项 success；GitGuardian success。前 pin CI也保留：5cb run37913026629、bbd run37915841380。
- 三个独立 native child guidance 回归涵盖 exit/restart、lost-ack readonly reconcile和并发单 intent；operator追加source-selection、legacy test非执行、流式拒绝、closed synthetic fixture、empty recall不伪成功。
- bbd真实 compiled-client无服务预检：91个摘要/8个build-only tests，PID64789，0factory fetch、0bank/credential/model操作、未建journal。它不是实际bank验收或OS sandbox。
- 原 root lint 仅 `--if-present`，没有 workspace lint实现，不称全面 lint。SDK full dependency declarations43项历史问题仍独立未解决。

## 真实专用 bank：两份不同样本

### 第一次：符号化元数据样本

`bbd13db` / namespace `guidance-01a11fcc-actual`：

1. PID4413：config200、original404、**一次 POST retain200**；在真实200后只向客户端注入503，随后仅original GET200/200对账并精确匹配原文。write报告 passed。
2. 独立PID6194：original GET200/200及reconcile通过；config200 / recall POST200却**0own refs**，read报告 failed。旧代码在query后才写substep flags，其通过依据是已核对的控制流，不伪造旧报告字段。
3. 三次有界只读诊断（原binding默认types、world/experience、任务词world/experience）均0；该文档memory_unit_count及world/experience/observation均0，scope tags正确，模式concise/observationsfalse。

文档：`vista-guidance-v1-12a0cdea44495aee-d390ec3a3f48a6fd681ca6667438a0d05def80b887fb40c4d4bf447ed999dd6d`。该请求没有重发、重写或删除。

### 最后一次：完整指导事实的synthetic样本

`a8d9c76` / namespace `guidance-01a11fcc-factual`：

1. PID48498：config200、original404、**一次 POST**，120秒内没有状态/ack，write报告 `failed/sink-timeout`。不把“请求已发出”写成返回200；未重发。
2. 独立PID66469：缺少write保存的reference时，用既有intent进行远端只读reconcile，original GET三次200；从精确匹配原文重建只读reference，source/artifact指纹一致。`recoveredUncertainReferenceReadOnly`、`restartedOriginalByteReadback`、`readOnlyReconciliationMatched`均true，**retain0**。
3. config200 / recall POST200仍**0own refs**，overall `failed/guidance-recall-reference-missing`。没有用original GET伪造recall成功。
4. 最后仅GET原文/config的元数据检查：memory_unit_count、world/experience/observation仍0；tags正确、concise/observationsfalse；0retain/0delete/0额外query。

文档：`vista-guidance-v1-12a0cdea44495aee-33b6bd365510dce5e7fedb96a9d64eeb3950d6fb406dff764e4f222abeb684df`。源绑定client artifact SHA256为 `c1a76154a0a2da1a260ec795928092ad968eba435e411179ae181d98c7da86a8`；第一份为 `4a4cb9190f8e84e61927db90bd8d76efd3079672eae9f2349e24f2432bbddaae`。摘要差异包含不同source SHA，不称服务或模型切换。

**合计仅两份不同文档的两个 POST尝试，不是对同一不确定请求重复写。** 两份原文持久化已经通过独立回读/对账确认，但这不保证后台retain任务、事实提取/索引或语义检索成功。零事实项的精确原因未证明；不能仅凭concise配置、synthetic内容或timeout就断言根因。

## 本地证据保全与摘要

均在原隔离worktree；`tmp/`被忽略，不以本机文件冒充已在main共享。

| 证据（相对worktree） | SHA256 |
| --- | --- |
| `tmp/guidance-acceptance/guidance-01a11fcc-actual/write-report.json` | `2fc01eb3d6294b7280c016ab076786d85a2c97ca525f619a40992521b94cc1ba` |
| 同namespace `read-report.json` | `d3b1ab8285764717151fc6e47d6bb000ef1e36458bf44ed7864d94266cd29207` |
| `tmp/takeover-01a11fcc/recall-readonly-diagnosis.json` | `1bcc979a605bb2e9e2e19aba18cc98778c3395838f1e9789ad67d42ef7931cce` |
| `tmp/guidance-acceptance/guidance-01a11fcc-factual/write-report.json` | `bde9d1566260f3f26e0641c3c90188c7bb9aebdb10372dbca961a6c429648b0e` |
| 同namespace `read-report.json` | `9eb5a17863e61ffd63d13fad902e0a513721a64bbea8e52f5273ed5c5bf1633b` |
| `tmp/takeover-01a11fcc/final-original-metadata.json` | `d84a5399cdb0138cc83a66f3798ee63ef06d16455ac45bae5aa97323c095a886` |

新建构建source目录可按operator自身清理；两份trial目录/journal/reference、旧会话untracked保全tar/patch/摘要及全部失败记录保留。不要清整个tmp、旧worktree或bank；不要把completion文件恢复为当前proof。

## 下一步与未完成项

1. 保持Stage4 BLOCK，停止更多retain/reseed和同请求重放；安全的source/docs候选交付与运行PASS分开声明。
2. 后续先明确可隔离到这两份文档/专用bank的只读提取链记录、非敏感模型/策略状态或公共实现证据；如果需要扩大到共享日志/其他数据、改bank/service/model、另建实例或新写入方案，按实际范围取得必要决定，不从本记录推导授权。
3. 没有新证据不做同类重试。原文成功不代替semantic检索，不通过放宽标签、原文拼ref或未知根因标签来凑PASS。
4. 独立银行检索条件被真实证据解除后才重新验收Stage4及其共享收口，再按顺序Stage5/6；publisher账户/渠道/版本、评测收益仍需具体事实。
5. 原签名owner/key路径MISSING、Mac原生本人认证、全SDK声明健康、production/defaultPi/registry发布均未被本次源码或部分运行证明解决。

入口：[guidance guide](../hindsight-guidance.md)、[sequential tasks](../../openspec/changes/pi-operational-rollout/tasks.md)、[stage4 design](../../openspec/changes/pi-operational-rollout/stage4-guidance-design.md)。
