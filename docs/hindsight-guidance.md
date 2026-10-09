---
doc_type: guide
project: workspace
owner_repository: chenhaoxiang/pi-vista
status: active
truth_mode: maintained
created: 2026-10-08
verified: 2026-10-08
---

# 显式 Hindsight 指导性历史存储（源码候选）

用户在 Stage3 选择单人本机可信宿主模式，并批准 Stage4 在现有 localhost Hindsight 服务新建 `pi-vista-local-test-01a114ab` 专用测试 bank。创建前404/创建200/配置回读200已确认，该 bank observations关闭；创建不代表数据持久化、recall、重启或故障验收通过。当前源码候选尚未经过独立审查、PR/主线CI与文档收口，不宣称 Stage4 完成。

## 独立入口，不是签名降级

`@pi-vista/learning/guidance` 提供 `prepareHistoricalGuidance(ExperienceObservation)` 和 `createHindsightGuidanceStore(config)`。只准备封闭、限量、标签化的安全原始 observation，保存canonical schema1历史指导文档。failure只保留原始unknown/hypotheses/fix元数据，不把Root派生分析重新当作原始证据。文档/ref/readback/reconcile始终current_verification=not-checked、authorization=none、executable=false；内容digest只比较字节，不认证Owner或恢复当前证明。

新入口不是原LearningSink，也不进入Root自动export；原signed verifier/rootLearning/archive/Hindsight store/data/journal均不降级。原signed store拒绝新的无签名guidance格式；本地经验验证/预览/确认/lifecycle属于Stage5。历史内容即使标有passed或保存成功，也不能恢复WeakMap handle或verified/trusted权限。

## 显式配置与有限传输

factory要求mode=local-guidance、canonical HTTPS origin、明确bank aliases→actual IDs、已有私有POSIX journal、可选显式bearer、timeout/byte上限。显式allow_loopback_http只允许literal127.0.0.1/[::1] HTTP；没有DNS localhost、userinfo/query/fragment/redirect/genericheaders/cookies/defaultbank/环境HOME配置或凭据发现。import/factory不读FS或网络、不建删bank、不装Pi hook、不注入上下文、不签名/训练/改模型。宿主fetch/文件系统可信，不是网络或恶意同UID沙箱。

配置/输入在await前own-data快照；unknown/undefined/proxy/accessor/自定义原型/稀疏/多余数组字段、重复或敏感/path/shell标签拒绝，不触发输入钩子。纯准备与操作错误只返回固定LearningError，不输出原错误/body/URL/token/path或stack内容。timeout允许1–180000ms，适应真实同步retain；原signed store的10s上限保持不变。

- `retain(alias, document, AbortSignal)`：校验整个canonical文档、title/tag/hash，绑定endpoint/alias/actualbank/request/ID。已有bank config只读preflight确认目标存在；一次同步POST只带一个item，显式deterministic document_id、timestamp unset、update_mode replace及scope tags。不使用deprecated document_tags/operation_id，不暗中重试。
- `read(refOrReceipt, signal)`：独立GET original_text，全字节重新验证wrapper/request/target/id/bank；receipt上的digest/idempotency如提供必须成对合法并相符。null/missing/partial/substituted原文、仅hash/ack不能成功。
- `query(alias, safeRetrievalQuery, signal)`：同样做existing-bank预检，固定low/4096/tracefalse/最小include与strict target+guidance tags。最多64项；只投影去重排序、受limit限制的own-targetrefs，不把fact text/rank/trace当历史或证明。foreign/null refs剔除，malformed own refs整次失败。
- `reconcile(alias, document, signal)`：只有已有精确intent时远端只读对账并可写本地completion，返回matched/not-confirmed，不retains/deletes/resets/接管或恢复权限。

Token不进入target fingerprint、文档或journal。新document namespace与原store分离。新alias/endpoint/actual bank不能复用旧claim。existing-bank preflight不是与管理员删除的CAS：服务本身的write-lazy-create在外部竞争下仍是限制，不能声称硬隔离。

## 持久attempt与不确定结果

复用原封不动的POSIX attemptJournal/storeOperation helper。宿主提供已存在的绝对私有0700/no-symlink目录；intent/completion须当前UID、0600、单链接、regular/限量/no-follow。新intent及directory sync在POST前完成，只有first exclusive creator且original明确404可发一次retain。已存在/未发/崩溃/lostack/partial/corrupt/deadline过期claim均不得重POST；原文已存在且逐字一致则跳过POST。completion只是存储完成，不是远端或当前信任证明。

取消在await-root预检后/独占创建前再次检查；晚取消可能留下不确定claim，绝不reset。restarted客户端和并发者共用journal只能原文读取/对账；不承诺distributed exactly-once、NFS/ACL、恶意FS、调度抢占、callback效果撤回或真实断电sync保证。

## 当前服务基线与实际验收入口

客户端合同仍来自官方HTTP0.10.2/ea5ab3034ceb1fed601950ec8996c69363c0b0b6，静态OpenAPI摘要d34d04b9…。本机服务及distribution标0.10.2；原文/retain/recall主要schemas匹配。MemoryItem仅document_id描述文字有差异；客户端总显式传一个ID，不使用省略ID分组规则。四个实际HTTP/engine/config/main文件不字节等于原pin，用户已明确接受本次实际安装指纹作为运行基线；不升级/改共享服务、不宣称活跃进程内存或整树等同原Git commit。

实际命令仅显式调用，普通测试/CI不操作真实bank。仅允许已批准localhost/专用bank，必须干净精确source SHA、小写字母/数字/连字符namespace、显式私有credential-config与已批准service-fingerprint文件（指纹无secret值）、timeout、write/read分别admission。凭据读取属于受信operator harness，检查privateFD/身份/模式/drift且不输出，不是library发现；只消费显式top/Pi配置，不读ambient env/Keychain/模型密码或自动刷新。

operator不会从工作树的ignored `dist`/`node_modules`加载客户端。先将精确Git SHA归档到新建的私有测试构建目录，使用既有lockfile、离线`npm ci --ignore-scripts`和build，再动态加载该隔离目录的编译模块及恢复helper。报告包含source SHA、锁定compiler版本、全部workspace编译JavaScript/manifest摘要与整体artifact摘要；现有包编译到dist的测试JavaScript也保留摘要并标记build_only_test，不导入/执行它们，不修改原发布文件allowlist或打包测试排除规则。导入后、实际调用前后重复检查源码及产物。仅清理本次新建的隔离构建源码，保留构建日志/产物清单、试验报告及不确定journal，不清理旧工作区输出。这是受信宿主下的来源绑定，不是恶意同UID/编译器/OS沙箱证明。

OpenAPI预检按一MiB原始字节进行流式限量、fatal UTF-8解析；超限、无效原文或非200立即取消body，不先完整缓冲后检查。普通合成回归以独立Git fixture和mock fetch证明：旧ignored编译模块不会被执行、实际加载的是fresh archive build、chunked超限和拒绝status均取消读取；它们不是实际bank验收。

```sh
node scripts/hindsight-guidance-acceptance.mjs --phase=write --allow-bank-write \
  --source-sha=<clean committed SHA> --namespace=<this trial> \
  --credential-config=<explicit private config> \
  --service-fingerprint=<accepted private fingerprint> --timeout-ms=120000 \
  --inject-lost-ack
# 独立新客户端进程；沿用同一 namespace/源SHA/journal，只读验真
node scripts/hindsight-guidance-acceptance.mjs --phase=read --allow-bank-read \
  --source-sha=<same SHA> --namespace=<same trial> \
  --credential-config=<same explicit config> \
  --service-fingerprint=<same accepted fingerprint> --timeout-ms=120000
```

write只允许一次目标retain。lost-ack注入在真实服务器200之后让客户端看到503，不停共享服务、不改库；之后只用原文reconcile/read构造历史ref，无第二POST。read阶段禁止retain，检查原文和digest、only-guidance/currentnotchecked、clientrestart、只读对账及own-doc recall。报告保留HTTP方法/类别/status和fault，绝不headers/body/token；保存到test-owned tmp/guidance-acceptance。安装文件指纹在前后对照，不等于强OS/in-memory attestation。

本次acceptance通路不读写main。已经安装的coding-agent项目记忆与自动session记录是另一个机制，保持原配置，不被拿来充当这个专用bank的验收。真实retain可消耗服务既有模型/embedding额度，usage不是独立账单；不会自动换模型/权重、扩权限/改Meta/RootG2/HOLD/开启日常Pi或训练。Stage5 usable local workflow与Stage6实际对照/发行仍待后继明确验收。

## 原文持久化不等于语义检索完成

首次bbd13db合成试验已经得到一次实际retain200、注入lost-ack后的只读对账和精确原文回读；独立新客户端也完成原文/对账，但own-reference recall为0，整体验收失败。专用bank只读诊断确认该文档memory_unit_count=0且三类fact均为0、scope tags正确；三种有界只读查询（默认types、world/experience、任务词）均为空。保留这个失败样本、原报告及journal，不重复retain它，不把original GET拼成recall结果，也不改变bank/shared-service提取配置。

canonical指导文档只有符号化标识/动作元数据时，真实提取模型可能不产生可检索fact；单独的200或原文保存不能保证recall。下一份有界正向样本使用明确synthetic的完整指导性事实和新namespace，仍无当前证明、执行权限或真实产品断言。脚本保留已通过的原文/对账子步骤；若own-reference缺失，继续overall failed并固定标记guidance-recall-reference-missing，不能以partial success关闭Stage4。该新样本及最后Stage4运行/交付验收仍待具体证据。

设计：[Stage4 guidance](../openspec/changes/pi-operational-rollout/stage4-guidance-design.md)；[sequential tasks](../openspec/changes/pi-operational-rollout/tasks.md)；原路线：[signed Hindsight store](hindsight-store.md)、[local host evidence](local-host-evidence.md)。
