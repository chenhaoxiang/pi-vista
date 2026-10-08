---
doc_type: guide
project: workspace
owner_repository: chenhaoxiang/pi-vista
status: active
truth_mode: maintained
created: 2026-10-08
verified: 2026-10-08
---

# 本机可信宿主证据（显式候选）

用户于2026-10-08选择单人、单机的本机模式：用户是唯一人类 Owner，当前明确授权确定本次执行范围；AI负责执行，不是另一位人类批准人。不新建签名密钥，不要求已授权范围内每一步重复解锁。源码与实际验收尚在实施，不能把本页当已合入、已启用或完整运营闭环。

## 身份与结果不是一回事

Mac身份认证可用于必要的本人确认，但“屏幕已解锁”、UID、文件权限、approval字段不是这次操作或某份结果的真实性证明。本切片不实现/不声称完成原生Touch ID或密码broker，不读取密码/Keychain。当前责任边界是用户明确授权与显式可信宿主；如果未来需要系统本人确认，应由可信宿主取得系统原生认证结果并绑定具体范围，不能让模型自报。

签名与加密也不同：签名用于保存后/跨进程核对来源与完整性，不意味着正文加密。`@pi-vista/evidence/host` 是**独立本机信任入口**，不是原签名验证器的无签名兼容模式。原 evidence/files、signed verifier、Learning和portable archive接口不变，真实Ed25519 owner producer/key provenance仍MISSING。原Learning工厂不能接受新本机verifier；显式本机经验闭环属于Stage5后继工作。

## API与可信来源

`createLocalEvidenceVerifier(config)` 要求显式mode=`local-host`、scope、唯一subject/producer/kind、可信`collect(AbortSignal): Promise<unknown>`、必需gate checks/test suites、gate version/config digest、可信now及有界age/总collection timeout。没有默认文件、HTTP、签名、producer发现、环境/cwd/home/配置读取或Pi接线。factory对配置做封闭own-data快照；回调是可信宿主代码，不是模型/任意JSON传入的“passed”声明。

每个collection结果为封闭schema1 `LocalObservation`：scope/kind/producer、run_id/repo/source_sha/policy_version/env_fingerprint五绑定、result_ref、observed_at/expires_at与details。gate必须普通pass、全部检查成功、必需项和版本/config精确一致；owner-override不是普通gate pass。test suites必须正数、原生计数相加一致且failed/skipped/cancelled/todo为0；必需suite不可缺失。guard须在明确scope内complete、正数event_count、blocked/dropped均0。原Meta观测日志只记部分命中且观测异常不改裁决，不能补写字段冒充完整覆盖。

缺失/冲突/未知字段/版本、稀疏或扩展数组、accessor/Proxy、自定义原型、敏感/path/命令形态标签均拒绝；不会修复、截断或执行输入。已验证快照的内容digest仅用于本进程一致性比较，不是跨进程签名、防篡改证明或Owner身份认证。已知模式检查不是通用秘密检测器。

## 当前证明与生命周期

`verify(expected, {gate,test,guard})` 每次重新采集3类结果，确认完整绑定/成功/时效。返回deep-frozen的`LocalVerifiedEvidence`，标明verification=`local-host-process`、trust_basis=`explicit-trusted-host`、scope、portable=false、authorization=none、executable=false；只投影安全摘要，不携带原命令/路径/密钥/错误/body/模型文字。

`isCurrent(proof, expected)` 只接受该factory本进程WeakMap里确切对象且未过期的绑定；拷贝、JSON、另一factory、新进程或状态flag不能恢复。`revalidate(proof)` 消耗旧handle、重采集并核对相同摘要；失败或变化撤销旧handle，成功产生新handle。墙钟回退永久关闭该factory的时间上下文；单调elapsed TTL防止固定墙钟无限续期。`shutdown()`永久退休本机上下文并abort在途采集；晚到结果不能复活。没有跨进程时间认证、同步CPU沙箱或对可信回调效果的撤回能力。

## 有界实际验收命令

候选脚本仅显式调用，不进入普通测试/CI的实际执行：

```sh
node scripts/local-host-acceptance.mjs --allow-local \
  --source-sha=<当前干净且已提交的精确SHA> \
  --namespace=<本次安全标识> --deadline-ms=600000
```

命令固定执行既有offline source gate、evidence-native suite及packed-consumer gate，并绑定前后HEAD/clean source；拒绝任意shell/command、network/live参数、脏源或缺少opt-in。原source runner验证计数后删除自身native报告，因此新wrapper使用**原封不动的native reporter**重跑明确的evidence suite，保留test-owned原生事件计数文件，而不是采信stdout合计。该正数suite覆盖evidence包测试，不冒称全仓语义覆盖；原source gate的其它套件、协议零case例外、no-op lint和缓存安装限制分别保留。

scope=`fixed-host-command-plan-v1` 的guard只覆盖三项固定宿主命令admit/settle，未知、重复、未settle或失败拒绝clean proof。**不覆盖**Git只读元数据探针、嵌套子进程/任意工具、文件系统/系统调用、Meta guard、ACL/NFS、恶意同UID代码或日常Pi全流程，不声称OS硬沙箱。deadline对直接子进程是有界等待/终止，不保证递归子进程调度抢占。宿主软件、工具查找、依赖缓存与采集回调均在本机信任范围内。

结果在test-owned `tmp/local-host-acceptance/` 保留。报告中的processProof只是历史展示；脚本已经shutdown，保存后标明currentVerificationAfterShutdown=`not-current`。报告passed不启用全局Pi、不授予模型路由/阈值/Meta策略修改或bank/release权限。原回归可能生成一次性synthetic keys和loopback fixtures，但不会建立真实签名根或调用真实模型/bank；请求范围和真实访问审计是两种不同证据。

## 后继边界

Stage4真实隔离bank仅接受指导性历史记录，不能恢复当前权限；原签名存储接口不降级。Stage5新显式本机Learning入口先采集新证据再进入验证/确认/持久化/recall，不能把历史status变成trusted。Stage6实际对照与发布需具体环境/账户/渠道事实。原SDK43项声明诊断、原真实签名链与Meta/RootG2/HOLD均保持原状态，不由本地通过解除。

设计与验收计划：[Stage3 amendment](../openspec/changes/pi-operational-rollout/stage3-local-host-design.md)；[tasks](../openspec/changes/pi-operational-rollout/tasks.md)。
