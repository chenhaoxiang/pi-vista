---
doc_type: handoff
project: workspace
owner_repository: chenhaoxiang/pi-vista
product_line: pi-vista
release_scope: source packages 0.1.0 candidate; publisher channel and release undecided
status: active
truth_mode: maintained
created: 2026-10-09
verified: 2026-10-09
---

# Stage4 精确提取诊断与专用 bank chunks 试验

## 当前状态

前两次concise合成试验保持**运行验收失败**；[原源码与阻塞记录](2026-10-09-stage4-guidance-source-and-operational-block.md)不反向改成PASS。后继只读诊断已证明两次Qwen提取正常返回合法JSON的显式空facts；用户随后明确批准仅专用bank的chunks模式及一个新namespace有界试验。

已经完成：精确只读trace计数诊断；专用bank一次字段PATCH200/GET回读；其他公开bank配置一致；旧两doc不变；operator chunks-policy/source/type/package/regression本地候选。**新的完整chunks运行试验、源码纠正复审/最新headCI/PR/main/共享收口尚未完成**，不由mode切换推导Stage4PASS或启动Stage5/6。

## 用户批准的后继范围

用户选择了两个独立具体动作：

1. 只读诊断扩大到当前实例非敏感模型/提取参数，以及能严格隔离到这两份合成文档的运行记录；不读其他bank、凭据值或模型输入/输出原文，不改设置不新增写入。
2. 在诊断后，仅将 `pi-vista-local-test-01a114ab` 的 `retain_extraction_mode` 改为 `chunks`，回读并核对其他设置不变；保留旧文档/失败/journal、不重处理旧样本；显式验收预检绑定模式后，用一个新namespace的一份合成指导文档验真记忆项、检索、原文、新客户端及失败对账。可能消耗既有embedding/reranker额度，不修改main、全局/服务/模型/embedding维度或原签名/Root边界。

本次bank模式变更是这项新授权，不是从旧的“停止更多写入/配置改变”记录自行推导；旧不确定请求永不重发。原规则入口仍为仓AGENTS、pi-operational-rollout，以及 `/Users/robotmac/.config/hindsight/AGENTS.md` 的现有embedding/维度/指令禁止无计划改动。没有执行run.sh切换/重启/备份，未使用凭据目录工具。

## 只读诊断：直接原因与未知项

### 精确记录来源

监听端口8888的PID35052由lsof元数据确认。OS进程环境检查不可用，因此磁盘selected-profile=qwen-failover及其600s timeout/单路retain参数只作**disk配置**，不宣称当前live环境一致。

共享日志不能靠相邻日志/时间猜测归属。HTTP `llm-requests`虽然有document filter，但会返回模型input/output/error原文，因此未调用它。读取安装公共代码确认每次retain_extract_facts写入精确document_id后，改用现有本地无密码Unix-socket路由，执行**default_transaction_read_only=on、readonly transaction、15s statement timeout**。WHERE只限专用bank、两个完整docid、当天范围与固定retain/scope；SQL只投影provider/model/status/duration/token/finish reason、错误存在/类型及由数据库计算的JSON结构/事实数量，没有SELECT模型原文、secret列、其他bank或DML/DDL。

| 样本 | 真实provider/model | 记录结果 | 时长 | input/output token | 数据库计算结构 |
| --- | --- | --- | --- | --- | --- |
| bbd符号元数据 | ollama / qwen3.8:27b-ud-q5_k_xl | success / stop；无error | 831ms | 2553 / 10 | 合法JSON object，facts存在且显式空array |
| a8完整synthetic事实 | 同上 | success / stop；无error | 256419ms | 2601 / 10 | 合法JSON object，facts存在且显式空array |

第二份document创建时点为2026-10-09T11:14:38.287159Z，提取trace于11:14:38.285810Z结束；client先120s timeout，而服务提取后续正常结束并存原文。两doc unit_count均0，与HTTP元数据/recall失败一致。

### 已定位的直接机制

安装的 `engine/retain/fact_extraction.py` 在2116–2125读取facts；合法空列表不会被当作malformed，不进入2343–2359的错误升级，随后正常return空chunk_facts。因此不是客户端tag/权限/编译产物或JSON解析“吞掉已有事实”；两次模型实际返回0facts，存储层也没有事实可检索。成功空结果不触发错误retry/modelfallback。

这只证明**结果的直接机制**，不证明Qwen为什么把内容判为无事实、不证明全局Qwen能力或完整后台/索引健康。提取慢也不等于成功；加长client timeout本身不能让空facts变成有效指导记忆。未读取模型prompt/output原文、未跨bank查看失败或发起付费重试。

## 为何选择chunks而非换模型/放宽安全验证

安装公共实现 `fact_extraction.py:3295–3351,3392–3397` 在chunks模式将每个文本块变为一项world记忆，保留原始块并跳过LLM事实提取。对于已经封闭、安全、有界、content/target绑定的结构化guidance，这比继续让模型二次筛选更直接、可预测。

chunks不是签名/当前proof，也不保证embedding/检索/reranker/服务持久化一定成功。原文仍not-checked/authorizationnone/executablefalse，读取仍独立精确校验；query仍只返回own-targetreferences，不输出fact正文。实际运行仍须证明，不能用安装源码或mode GET代替。

## 已执行的bank单字段变更

- 只GET专用config和旧两doc；前值concise、observationsfalse、defaultstrategy null。
- 独占本地intent及sync先于一次 `PATCH /v1/default/banks/pi-vista-local-test-01a114ab/config`，body只 `{updates:{retain_extraction_mode:chunks}}`。
- PATCH200、configGET200，resolved/override均chunks；去掉mode后的两份配置分别逐值一致。
- 两doc完整回读摘要与unit_count在前后相同，未重处理、未删除；不会因改配置自动重新提取旧doc。
- before bank-state digest `be0f2ccd419f16d5f45476c3baea3fcc6d70660b6cc86a16cd09f2b83f5ed023`；after `ca30c23879651145c4a910e5143acc68afa84ea68ca2cb494554595acc014af7`。
- 其余resolved摘要 `f025a4cd4141072963d56d5a2f5f60332afc4e2981b42707e0b6a46953e9b6c7`、其余override摘要 `0e82c9429a4a935eaf17810b6c50c9f007e9657f05729cac92ea3b969047fdfe`前后相同。
- 0main请求，0retain/reprocess/delete，0共享重启、0模型/embedding/维度/指令改变；private现有API bearer未输出。

完整安全计数报告位于原worktree `tmp/takeover-01a11fcc/approved-bank-chunks-result.json`。一次PATCH受理/回读只证明policy变更，不等于新样本或Stage4验收已通过。

## Operator绑定与新增本地验证

library API/default/root/signedstore/journal/query及发布规则不变；仅显式actual operator新增policy约束：

- source SHA/fresh archive/锁定build/安装文件指纹仍在前；OpenAPI版本/bytecap不降级。
- 读专用bank config，必须resolvedchunks、observationsfalse、无retain_default_strategy，才创建新journal/执行retain；bank响应非凭据公开config/override只以canonical digest记录，不投影mission/body。
- 初次write在retain之前将bank/namespace/sourceSHA/完整公开configdigest写入私有0700trial目录的独占0600单链接trial-policy文件、file/dirsync；重启read（包括receipt缺失的只读不确定恢复）必须读取同一不可覆盖基线。缺失/损坏/source或policy不匹配均失败，不重新定基线、不重置journal、不授权新POST；这是历史比较元数据，不是审批账本或当前proof。
- library每次config预检及结束时，重验同一mode/configdigest及持久trial基线；漂移失败。config响应单流限量读取/校验后提供原始字节一致的Response给原library，不使用clone/tee串行取消。管理员并发改变仍不是远端CAS。
- GET/POST固定专用路由、一次retain、只读recovery、旧不确定intent不重放等继续保留。operator不提供PATCH/default发现或其他bank入口；policy变更由此次单独获批的受信动作完成。
- 新回归覆盖chunks合法/foreignmain/concise/observations/默认strategy/shape拒绝、超限/statuscancel、原生fixture在不符mode前无journal/retain，以及末尾drift不伪PASS；原断言和metadata/emptyrecallfail等保留。
- 原2fae08d候选 **1192 native cases**（原1181+11policycases）、Node20/26/source/consumer通过，但十一文件复审93af285c…为BLOCK0P0/2P1/0P2：clone串行cancel等待未消费原分支；重启read重新定policy基线。原审查SHA256为3e9060e78e302c2bf71ec5315ee6264454071712029e2ade0abd3deca8c003db，保留为source-review-2fae08d-chunks-original.md，不反写成PASS。
- 父级离线nativeResponse复现404/超限两路cancel等待，只有取消原分支后结束；独立nativewrite/read fixture复现不同cfgdigest仍双PASS（0真实bank）。纠正新增不可覆盖/缺失/corrupt/sourcecfg漂移/字节保留/无tee等8项回归，目标1200cases；最终全套门禁、准确commit与纠正review仍待证据，不以局部green替代。

## 下一步（未完成）

固定源码和新policy设计、独立窄范围复审与精确CI；复审通过后以**一个新namespace/一份新合成文档**执行一次write/lost-ack及独立clientreadonlyread/recall，核对记忆项和旧两doc未重处理。若新目标或mode不符、source/policy变化、embedding/recall错误，保持真实失败和既有journal，不继续reseeding，不切模型、不改其它policy来绕过。

Stage4完整运行通过、正常PR/远端main/文档共享收口必须分别确认；尚无任何上述完成推断。Stage5/6仍未启动。源PR26仍draft，原失败记录及原review BLOCK不改写。

入口：[guidance](../hindsight-guidance.md)、[原阻塞记录](2026-10-09-stage4-guidance-source-and-operational-block.md)、[stage4设计](../../openspec/changes/pi-operational-rollout/stage4-guidance-design.md)。
