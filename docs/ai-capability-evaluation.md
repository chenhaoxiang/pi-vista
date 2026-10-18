---
doc_type: guide
project: workspace
owner_repository: chenhaoxiang/pi-vista
status: active
truth_mode: maintained
created: 2026-10-18
verified: 2026-10-18
verified_by: manual
ssot: false
authority: non-gating
---

# 非门禁 AI 能力评估集与本机 Pi Extension 白名单审计

## 1. 范围、基线与结论边界

本页记录一份可重复的**离线、非门禁** AI 能力评估集，以及对本机一组自定义 Pi
Extensions 的白名单安全字段审计。评估集用于观察正常工程任务中的结果质量、成本和
恢复行为；它不是 Gate、CI、权限前置、审批系统、执行账本或模型路由器。规范性边界以
[离线评估设计](../openspec/changes/pi-operational-rollout/ai-capability-evaluation-design.md)
为准，本页主要保留使用说明、任务矩阵和本次核验快照。

核验快照（2026-10-18）：

- 目标仓：`github-public/pi-vista`，开工实时远端核对的 `origin/main` 与本地 `main` 均为
  `94c8357d52c3b3d2c141f0a7dff9e2880f3e62c3`。
- 实施工作树：独立 `pi-vista` worktree（公开路径省略；分支见下）。
- 实施分支：`docs/ai-capability-eval-20261018-01a14f02`。
- 评估 runner：`scripts/ai-capability-evaluation.mjs`。
- 手动测试：`tests/ai-capability-evaluation.test.mjs`；它故意不加入
  `package.json` 的默认 test、Gate 或 CI 发现路径。
- 本片只使用合成数据或由操作者预先脱敏的有限指标 DTO。不读取 `auth.json`、
  `models.json`、`.env`、原始 session、真实模型输入/输出、真实资金或生产状态。

**不能由本页推出的结论：**真实 AI 完成率、真实模型质量、普遍 ROI、权限或发布资格。
没有真实 run/token/time 数据时，所有对应指标必须保持 `unknown`；合成演示只证明矩阵、
字段校验和安全边界能运行，不输出能力收益或完成率。

## 2. 评估合同

### 2.1 场景原则

矩阵中的任务来自正常工程工作，可由人工或受控 runner 给出可验证的结果。任务描述
不规定固定工具调用序列；应评估是否达成验收标准，而不是是否照抄某个工具脚本。

每条真实记录只允许携带下列安全指标：

- `task_id`：`T01` 至 `T10`；`run_id`：`run-` 加 1–32 位小写十六进制脱敏别名；
  `arm`：`baseline`、`candidate` 或 `single`，不接受路径、模型/端点名或自由文本；
- `completion`：`pass`、`partial`、`fail` 或 `unknown`；
- `tool_calls`、`elapsed_ms`、`context_tokens`、`output_tokens`、`rework_count`；
- `error_injected`、`error_recovered`、`human_interventions`；
- `false_intercepts` 与 `safe_action_opportunities`（只有同时有分母才计算误拦率）。

禁止把 prompt、模型原文、工具参数全文、绝对敏感路径、凭据、session transcript、
模型名/端点细节或 artifact 正文放入评估记录。字段集合封闭，数值需非负、有限且计数为
safe integer；不执行 getter/proxy。缺值使用 `null`，不是用零补齐。输入是受信操作者
预先准备的安全投影，结构校验不认证来源，也不能判断数字是否真的测得。

### 2.2 指标语义

| 指标 | 含义 | 未观察到时 |
|---|---|---|
| 完成结果 | 是否满足该任务的验收标准 | `unknown` |
| 工具调用数 | 上游观察器在生成安全 DTO 时按工具调用 ID 去重后的尝试数；含被阻断尝试，nested 调用不重复计 wrapper 转发；本 runner 只校验计数 | `unknown` |
| 耗时 | 任务开始至终态报告的 wall time，含重试/等待/人工介入；失败也保留实际耗时 | `unknown` |
| 输入/context 成本 | SDK Usage 的逻辑输入/context token，含 cache-read/write 时须按原 SDK 定义去重；不可按字符数猜 token | `unknown` |
| 输出成本 | 安全投影中的输出 token 数；不等于供应商计费 | `unknown` |
| 返工次数 | 首次提交候选后因验收不满足而修改候选的次数；正常多步实施不算返工 | `unknown` |
| 错误恢复 | 注入可控错误后是否保全现状、取得新证据并恢复 | `unknown` |
| 人工介入 | 需要人类输入、裁决或手动恢复的次数 | `unknown` |
| 误拦 | 依据当时授权/合同，人工或确定性证据确认被误拒的安全调用数；分母为同一 run 已确认安全的尝试数 | `unknown` |

记录按 `arm` 分开统计；同一 task/run/arm 重复记录拒绝，不把两个版本混成一份成绩。
数值只展示已观察的 `observed_sum` 与样本数；若该指标有缺值，完整 `total=null`。
完成结果只计给定分类，不自动给成功率或总分。错误恢复分别保留 eligible/observed/recovered，
无观察不当作成功或失败。`error_injected=true` 表示该记录确有受控错误场景，恢复结果仍可未知。

`elapsed_ms` 单独改善不能证明 ROI。若以后形成成对的 baseline/candidate 汇总，应沿用
现有 `docs/stage6-context-roi.md` 与 `scripts/stage6-context-roi.mjs` 的边界：
未知、profile drift、分母不一致保持 `collect-more`；语义/轨迹退化优先于 token 节省；
无明确价格时保持 `unpriced`；输出仍是 `metadata-only / authorization:none /
executable:false` 的建议投影，不是默认注入或放行。

### 2.3 非门禁安全投影

runner 的固定安全投影为：

```json
{
  "observation": "recorded-only",
  "verification": "metadata-only",
  "authorization": "none",
  "executable": false
}
```

评估 runner 不调用 provider、不写 Pi settings、不修改工具集、不改变 guard/gate、不
访问 bank，不创建 judge、ledger、approval 或新的 evaluation framework。它只从 stdin
消费显式安全 DTO（最多 256 KiB），在 stdout 输出 JSON 或 Markdown；不扫描 HOME、
不打开输入文件、不创建持久运行账本。CLI 错误只输出固定 reason，不回显输入或解析器异常。

## 3. 十项正常任务矩阵

| ID | 能力 | 可验证场景 | 关键验收维度 | 合成 fixture |
|---|---|---|---|---|
| T01 | 范围与仓库路由 | 根据 issue、仓库地图和生命周期标签选择目标仓与规则入口 | 目标唯一、入口可追溯、范围外事项不写入执行计划 | `routing` |
| T02 | 证据分层 | 从脱敏交接摘要区分实现/验证/合并/部署/上线/未知 | 保留未知，不把历史当实时证据 | `evidence` |
| T03 | 根因诊断 | 根据测试失败、轨迹和环境摘要提出最小根因假设与下一条只读核验 | 证据对应、保留竞争假设、下一步无副作用 | `diagnosis` |
| T04 | 最小补丁 | 修正合成 `sum([])` 返回 undefined 的 bug，输出最小补丁/红例与回归 | 空输入返回 0、保留非空行为、不改 unrelated.js | `patch` |
| T05 | 真实路径测试设计 | 将行为契约拆为主路径、边界输入和失败路径 | 覆盖可达路径、状态转换断言、失败可观察 | `regression` |
| T06 | 安全命令构造 | 将歧义 cwd/GIT_* 命令改为字面目标仓与隔离 worktree 方案 | 目标可核验、不用破坏性恢复、标出人工边界 | `command` |
| T07 | 文档契约维护 | 修复合成文档的 frontmatter、链接和文档地图候选 | 元数据/链接合法，不伪称运行验收 | `document` |
| T08 | 错误恢复 | 面对超时或工具阻断选择保全、新证据和有界重试顺序 | 不原样盲重试、不覆盖 dirty、恢复后重绑 head/输入 | `recovery` |
| T09 | 跨文件一致性 | 在代码、配置和文档投影中定位版本/host/schema/状态冲突 | 指出冲突、不擅自选择上位裁决、建议最小修复 | `consistency` |
| T10 | 真实交付报告 | 根据记录分开报告实现、验证、提交、合并、部署、上线 | 六层状态可回读，具体列出风险和未验证项 | `delivery` |

任务定义、**十份实际输入数据**（不是只有名称的 fixture 标签）、逐项验收标准、字段
校验和输出格式在 `scripts/ai-capability-evaluation.mjs` 的 `TASKS` / `FIXTURES` 中维护。
使用 `--matrix` 输出完整输入及人工核验标准。矩阵不包含固定工具序列；后续如评估真实
AI 输出，由操作者依据标准检查结果并提供脱敏指标，不由本脚本做自动语义判断。
本次未执行十项 AI 任务，没有把 fixture 自检冒充模型能力实验。

表中 fixture 键与源码完全对应，具体内容只在源码维护。T03 给定 slice 的输入/期望/实际；
T07 给定日期倒置及损坏链接；T09 给定 owner v1 与 config v2/host 冲突；T10 给定 PR open
和未部署事实，因此这些任务有可核验的正确/错误边界，不依赖固定工具轨迹。

## 4. 执行与发现证明

### 4.1 合成结构演示

```bash
# 在 pi-vista worktree 根目录执行
mkdir -p tmp/ai-capability-evaluation
node scripts/ai-capability-evaluation.mjs --matrix > tmp/ai-capability-evaluation/matrix.json
node scripts/ai-capability-evaluation.mjs --demo > tmp/ai-capability-evaluation/demo.json
node scripts/ai-capability-evaluation.mjs --demo --format=markdown > tmp/ai-capability-evaluation/demo.md
node scripts/ai-capability-evaluation.mjs --template | node scripts/ai-capability-evaluation.mjs --summarize
```

`--demo` 默认输出十项 fixture 的存在状态，`measurement_status=unknown`，并明确将
完成率与 ROI 输出为 `null`；`capability_claim=not-assessed`。模板汇总仍保留全部未知，
`measurement_status=supplied-not-authenticated`，不自动认证为真实 run。

### 4.2 手动测试 suite

```bash
# 在 pi-vista worktree 根目录执行
node --test tests/ai-capability-evaluation.test.mjs
```

该测试文件放在 `tests/` 而不是现有 `scripts/*.test.mjs` release-contract 发现目录；
`package.json` 没有把它加入 `test`、required CI 或 Gate。测试本身检查：

- 十项唯一任务、具体输入和验收标准存在且不可被调用者修改；
- 合成演示不会伪造能力、完成率或 ROI；
- 脱敏记录只汇总实际提供的字段，缺失保持 unknown；
- 错误恢复与误拦分母缺失时不计算假比率；
- runner 不导入 provider、网络或子进程模块；
- suite 仍是手动离线入口，不改变现有 required scripts。

### 4.3 真实数据接入的边界

以后如要使用真实运行，先按 `--template` 的 `ai-capability-evaluation-input/1` 结构，
由操作者填入 `mode=safe-projection` 的安全 DTO，再从 stdin 交给 `--summarize`。
只根据可回读证据填数，不得从工具成功、磁盘存在或记录里自称 pass 推导真实完成。
此入口不执行任务、不调用模型、不认证来源、不决定注入，不生成 ROI 或模型排名。
现有 observer 的 `ok` 也不是能力评分；observer 自身不覆盖 token、返工、人工介入或
误拦等全部指标，缺项必须留空，不能把它改成第二套采集/权限系统。

## 5. 本机自定义 Pi Extensions 白名单审计

### 5.1 审计范围与默认加载判断

只读取了以下安全字段：绝对路径、文件来源、settings 中是否显式列出、Pi conventional
user-extension discovery 的资格、源码中是否出现模型调用/持久化/外部进程/事件接线、
失败行为和对主链的影响。没有读取 `auth.json`、`models.json`、任何 `.env`、原始
session 或观察日志正文。

`~/.pi/agent/settings.json` 当前 `extensions` 数组显式列出的是 Hindsight extension
和 `+builtin:mcp`，没有把下面七个文件逐个列出。Pi 文档规定 `~/.pi/agent/extensions/`
是 user extension 目录，直接 `.ts`/`.js` 文件属于 conventional discovery；因此下表
的“默认资格”只能说明**具备被默认发现的资格**，不是声称每个 session 已加载。`--no-extensions`、
显式资源覆盖、session reload 时机或其他运行条件都可能改变实际加载；本审计没有读取
当前 session 的加载回执。

| Extension | 路径/来源 | settings 显式列出 | 默认资格 | 实际所有 session 已加载 |
|---|---|---:|---|---|
| workspace-guard | `~/.pi/agent/extensions/workspace-guard.ts`，转出到 `tudingai-meta/scripts/pi-extensions/workspace-guard/workspace-guard.ts` | 否 | user conventional `.ts` | UNKNOWN |
| pi-vista-local | `~/.pi/agent/extensions/pi-vista-local.ts`，固定指向本机 `~/.pi/vista/runtime/releases/<release>/` 的 manifest 绑定 observer | 否 | user conventional `.ts` | UNKNOWN |
| approval-notify | `~/.pi/agent/extensions/approval-notify.ts` | 否 | user conventional `.ts` | UNKNOWN |
| noninteractive-env | `~/.pi/agent/extensions/noninteractive-env.ts` | 否 | user conventional `.ts` | UNKNOWN |
| llm-wait | `~/.pi/agent/extensions/llm-wait-indicator.ts` | 否 | user conventional `.ts` | UNKNOWN |
| session-id | `~/.pi/agent/extensions/session-id-status.ts` | 否 | user conventional `.ts` | UNKNOWN |
| session-title | `~/.pi/agent/extensions/session-title.ts` | 否 | user conventional `.ts` | UNKNOWN；本片只读、不修改 |

### 5.2 白名单字段结果

| Extension | 模型调用 | 持久化 | fail-open / fail-closed 观察 | 对主链影响 |
|---|---|---|---|---|
| **workspace-guard** | 源码保留外部双模型/Laya/shadow 历史 helper，但默认 `tool_call` / `user_bash` 明确传 `hasUI=false, policyOverride=new`，普通活动入口不走旧确认/trio 模型分支；不能把 helper 存在当作默认调用。本片不执行。 | 条件式记录 events；approvals/authorization 属保留 helper/显式命令路径。owner-policy-host 可读本机 Owner 配置，显式用户命令才写入。未读其内容。 | bash 确定性预检异常/目标不明可 fail-closed；event 日志失败被 catch。Owner 配置缺失无规则则继续；读取故障保留已知规则、允许诊断通信，不全工具熔断。 | **高**：可阻断受管 bash/用户命令，并注册 `project_context` 与 Owner 规则预检；当前活动入口不改写命令、tool_result 或全局 abort。工具放行不是授权。 |
| **pi-vista-local** | 无模型调用。固定 manifest/hash 校验后动态加载 `pi-local-observer.mjs`；observer 可用受限 git HEAD 读取绑定。 | 默认 local EventStore 记录 notification-only 元数据；安装文档声明不写 bank、不注入历史、不改模型/工具/权限。审计未读 store 内容。 | loader/observer factory/绑定/存储异常 catch 后仅诊断并返回；观察旁路 fail-open，主工具/回合继续。 | **低**：监听通知和生命周期、注册四个 `/vista-*` 只读/预览型命令；不改变 native prompt/provider/model/thinking/active tools/tool result。 |
| **approval-notify** | 无模型调用。可能调用 `ps`、`osascript`、`afplay`，并启动提醒 timer。 | 无 extension-owned 持久化；未发现写文件路径。 | tty/定位失败有返回或诊断，不自动回答确认；同步 `ps` 每次 timeout 1s，父 tty 回退会再查一次。提醒弹窗无 deadline，通常靠点击/子进程回调结束。 | **低到中**：ui_prompt_start 与 TUI ask_user_question 可触发弹窗/声音/跳转；同步 tty 查询会占用事件线程。未见 ui_prompt_end/session_shutdown 对提醒的对应清理，不将其宣称为完全零影响旁路。 |
| **noninteractive-env** | 无模型调用。 | 无持久化。 | 正常路径只在 `bash tool_call` 输入前注入环境前缀；`PI_NONINTERACTIVE_ENV=0` 可禁用。若 handler 自身异常，Pi 的 `tool_call` fail-safe 可阻止该工具；代码无独立 catch 放行。 | **中到高**：直接修改 bash command；设置 editor/sequence-editor=true、pager=cat、terminal-prompt=0 等；可能改变编辑/rebase/认证语义。与 guard 的解析相互作用需单独诊断，不据此调整权限。 |
| **llm-wait** | 无嵌套模型调用；只观察 provider request/response/message 生命周期。 | `~/.pi/agent/llm-wait-indicator.json` 由显式 `/llm-wait <seconds\|off>` 写入；核验时该文件不存在（未读配置正文）。读写失败 catch 后保留内存功能。 | 配置 I/O 失败是 fail-open；部分 UI/timer 回调无独立 catch，不能泛称任何异常都被隔离。无工具拦截或请求超时改写。 | **低**：仅 TUI 跟踪 request 并每秒刷新 status/working-message；结束/关闭清理 timer。文件头超时说明是历史注释，不用它代替当前 settings。 |
| **session-id** | 无模型调用。 | 无 extension-owned 写入；读取 Pi session manager 的 ID/file 以显示恢复命令。Pi native session persistence 是否启用不由此 extension 推断。 | 无独立 I/O 失败降级实现；UI-only 路径不参与工具/模型/权限决策。 | **低**：`session_start` 设置下方 widget，仅展示 `pi --session <id>` 或未保存提示。 |
| **session-title** | **有（本次读取快照）**：未命名会话的 `turn_end` 使用固定 deepseek-flash；仅在固定模型未配置/无鉴权时选当前模型，不是调用失败后自动换模型。`/title` 可手动触发。最多截取 1500 code point 用户文本，仍是额外外发。 | `pi.setSessionName()` 交给 host 保存名称并同步 footer；extension 不直接写 session 文件，原生是否持久化取决于 host session。 | 自动异常 catch；每次 session_start 激活内最多 2 次尝试，非严格终身一次；无模型/空结果第二次可用本地兜底，抛错则只是保留未命名。调用未传显式 deadline/signal，捕获异常不代表无等待。 | **中**：await 在 turn_end，可增加回合结束时延、token/成本；host session 名称可持久化。不是工具/权限门禁。本片只读，另 session 的后续修改不在该快照内。 |

### 5.3 重要审计事实

1. **磁盘存在不等于已加载。** 七个文件在 user extensions 目录存在，只能证明 conventional
   discovery 的输入存在；settings 显式数组没有逐个声明它们，当前 session 是否实际加载仍为
   UNKNOWN。本片没有通过新 session、`pi config` 或 runtime receipt 把 UNKNOWN 写成 PASS。
2. **模型调用与主链应分开。** `session-title` 的 host model call 是额外成本与持久化副作用；
   `workspace-guard` 的历史 external model/shadow helper 不能代表当前固定 new 活动入口。
   其余白名单 extension 没有 nested model call。任何“无模型调用”只针对这里审查的源码和
   接线，不代表本机全局没有其他 extension 或 Pi core 模型请求。
3. **观察失败与门禁失败不能混写。** pi-vista local observer 的失败是 fail-open 观察缺失；
   workspace-guard 的目标不明/预检异常是 fail-closed 保护。二者不共享授权含义。
4. **session-title 明确只读审计。** 本页不修改该文件、不调整其模型、提示、持久化或重试行为。
   除已核对的 guard/observer shim 目标外，未核实其余本地文件的上游归属，不推断发布身份。
5. **静态审计不是全隔离证明。** Pi extension factory/事件 handler 与 Pi 同进程运行。
   Pi 文档明确异步 factory 会被等待、tool_call handler 抛错可阻断工具；通知-only 只能描述
   代码的设计/调用位置，不能据名称保证任意宿主故障零影响。

### 5.4 安全来源指针与字节快照

源码与配置核验基于本机 Pi `1.3.0-fork.1` 的 `docs/extensions.md`、
`docs/configuration.md`、`docs/settings.md`、`docs/packages.md` 与最小 extension 示例；
它们位于 `~/.pi/core-releases/1.3.0-fork.1/node/node_modules/@earendil-works/pi-coding-agent/`。
声明的发现资格以这些文档为据，不为审计启动/重载所有 extension。Guard 实际 owner
工作区 HEAD 在读取时为 `e599a8a414668a76775536ecec7c8cf2546db5db`；
owner-policy-host 预检接线与保留的旧 lease helper 分开读取，未运行它们。

2026-10-18 只读 SHA-256（只保存安全文件身份，不保存配置或用户文本）：

| 文件（`~/.pi/agent/` 相对路径） | SHA-256 |
|---|---|
| settings.json | `2fcc777538811999489366652b158b2f6f20eff5f1b64ea86e1cf99ee363afe5` |
| extensions/workspace-guard.ts | `8a85d521d500f0b760632108cea260cf7be71619328545948e4e704bb56bd570` |
| extensions/pi-vista-local.ts | `b9ba45a93982a9c66ea55e4323a2b69ae617b37430c95f13a28655be0526d048` |
| extensions/approval-notify.ts | `90d9bfdadd36696e36a49ef4206e5a2430e33dd993689d46f3078f7e0f04b84f` |
| extensions/noninteractive-env.ts | `7a31c3bcdcaa6618a82f474bc8bbf5f4dd0c99fb4d3c070ecbf3b9dd2319521f` |
| extensions/llm-wait-indicator.ts | `b2849161a42a99d0819dfd85dd79e6bde35c0449c8f73a2684a09dc1dd6f9032` |
| extensions/session-id-status.ts | `0e148a135773712bfe816f210f005394275411eeb0a64d81e059fd540bc5775c` |
| extensions/session-title.ts | `53b7065e4adf9177ff3f36cb888fcbd4ba1606fd0edc5983c794d595fb0f4836` |

这些 hash 绑定本次读取快照，不是签名、上游来源或实际加载证明。其他 session 的后继
修改不改变本次历史快照，不应由本任务恢复或覆盖。

## 6. 本片适用验证与未验证边界

本地 Node v26.9.0 的显式命令 `node --test tests/ai-capability-evaluation.test.mjs` 已发现并
执行 **16 tests / 16 pass / 0 fail / 0 skipped**。其中 CLI 子进程实际执行 demo、matrix、
Markdown、template→stdin-summary 及拒绝路径；不是仅创建测试文件。验证使用无 provider
环境的子进程及合成指标。stdout 报告和 TAP 只存 `tmp/ai-capability-evaluation/`，不提交。
原有 ROI 专项 **9/9** 通过。以上是工具回归测试通过数，**不是十项 AI 能力任务的通过数**。

为检查不影响现有脚本合同，先在 fresh worktree 运行 `npm run test:release-contract`；
因没有 `node_modules`/构建产物而出现包导入和 built-protocol 前置失败，专项诊断确认
`ERR_MODULE_NOT_FOUND: @pi-vista/core`。原始失败未覆盖。随后 `npm ci --offline --ignore-scripts`
与 `npm run build` 均通过，同一 release-contract 命令重跑 **343 tests / 343 pass / 0 fail /
0 skipped**。默认 suite 仍未发现新增的手动测试（其 16 项必须显式运行），没有改变
package scripts、CI 或 Gate。未为本片执行真实 SDK/模型/bank 验收。

接手后的 P1/S1 本地验证在同一候选树上补齐：`npm ci --offline --ignore-scripts`、
`npm run build`、`npm run typecheck`、`npm test`、现有 `npm run lint`、
`npm run pack:dry-run` 与 `npm run gate:consumer` 均退出 0。默认测试的逐 suite
原生计数合计 **1491 tests / 1491 pass / 0 fail / 0 cancelled / 0 skipped / 0 todo**；
新增手动 suite 与原有 ROI 的联合重跑为 **25/25**（16 新增 + 9 既有），不把重复的
ROI 计为新增能力证据。packed-consumer 实际安装 11 份本地 tarball 并通过公共入口与
consumer TypeScript 验证；没有注册表发布或真实模型调用。输出保留在
`tmp/ai-capability-evaluation/local-p1/`，早期缺构建产物的失败原件保持不变。

pi-vista 本机固定 observer manifest 的 86 个文件 hash 与条目绑定在审计时匹配；这仅证明
安装文件完整性，不触发 extension 执行，也不证明当前 session 加载或模型质量。

- 未启动新 Pi session，因此没有声称七个扩展在某个具体 session 中已加载。
- 未读取认证、模型配置、环境文件、原始 session 或观测日志内容。
- 未调用任何真实模型、资金、生产服务或付费模型；没有真实能力完成率、token 成本、
  elapsed、人工介入或误拦率结论。
- 未测试 macOS AppleScript/Terminal/iTerm 的真实窗口跳转，也未执行 workspace-guard
  的模型/shadow 分支。
- 未修改 `tudingai-meta`、Meta 资金策略、fork 项目、本机 settings 或任何本机 extension；
  `session-title.ts` 保持原状。
- 候选提交阶段的本地快照只证明离线评估集的结构/校验/安全边界和审计快照；共享交付
  的 PR、合并和主线 CI 终态见 §7，仍不代表部署、发布、默认激活或真实运行验收。

## 7. 共享交付收口

本片代码、设计和验证已由 PR58 进入共享主线。以下是 **PR58 收口时的证据快照**，
不是后续 main 始终停在同一 SHA 的声明；各层证据分开，不外推为真实 AI 能力或运行授权：

- 评审 head：`c83d2d8c7e6ec8b08d132a4d7a55dc473d30323f`；独立
  `codex-local/kimi-k3:high` 评审结论为 **OK with notes**、blocker/major 均为 0，
  App review check `117702883198` 与记录 hash
  `a975d52e02eec938dc02444e13e1662aed4759e2fb6b082eff796c2bedd065e6` 绑定。
- PR [#58](https://github.com/chenhaoxiang/pi-vista/pull/58) 已普通合并，merge commit
  为 `ec3587e16cd1a9b512a118344872c6d7f04c62ff`；P1/S1 Gate 结果为
  `PASS_ESCALATED`，使用 Driver + 1 个异构 reviewer，未使用 Owner override，未覆盖任何 gate。
- 评审 head CI run
  [39136789338](https://github.com/chenhaoxiang/pi-vista/actions/runs/39136789338) 的
  Node 20/22/26 source-and-consumer jobs 全部成功；merge SHA 的 main CI run
  [39137339682](https://github.com/chenhaoxiang/pi-vista/actions/runs/39137339682) 的
  Node 20/22/26 jobs 也全部成功。
- 严格只读对账以 exact head/base/merge SHA 返回 `already-merged` + `ci-success`；
  canonical `main`、`origin/main` 与实时远端 main 均为 merge SHA，工作树干净且
  `ahead/behind=0/0`，评审 head 是 merge commit 的祖先。
- 这些是源代码、审查、CI、Gate、合并和主线回读证据；本片未进行真实 AI 能力实验、
  Provider 业务调用、bank、生产、资金、部署、发布、默认 guidance 或 extension 安装/
  重载操作。独立模型审查不属于十项 AI 能力实验，也不产生实验成绩。
