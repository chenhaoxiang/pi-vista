# Router / Worker / Attention Queue v1

## 定位

这是基于现有 Pi、Intercom、Subagents、Schedule 和 Vista 能力的只读治理合同，不是新增 Router 服务、第二执行器、中央任务库或审批系统。

- **Router（职责，不是新进程）**：维护用户对话、目标归属、当前 head 和交付边界；不把消息送达或 Worker 空闲当作业务完成。
- **Worker（既有 session/subagent）**：在既有 session/worktree 中执行授权范围内的工作，提交状态和收据；不直接向用户承诺未被证据支持的完成结果。
- **Attention Queue（Vista 只读投影）**：从已验证的 governance receipt 生成“需要人处理”的有限视图；不启动 Worker、不发送消息、不修改 Schedule、不授予权限。

## 状态与证据

Router/Worker 之间只传递安全元数据和收据引用。以下事实必须分开：

- `delivery`：消息完成传输；
- `started`：目标 session/Worker 已开始；
- `execution_outcome`：执行器结果；
- `business_outcome`：业务结果；
- `delivery_outcome`：交付是否可用；
- `permission_outcome`：当前授权状态。

`unknown` 不能被转换为成功、失败或重新执行许可。恢复必须沿现有 `reconcile` 路径进行；未知 effect 不得 replay。

Fresh handoff 必须保留：

- `run_id` / `run_revision`；
- 已接受的安全事实；
- 未解决的 effect；
- blockers；
- 下一步和停止条件；
- 当前 head 必须重新读取；
- 不得重放 unknown effect；
- 不得静默更换模型。

## Attention Queue v1

`@pi-vista/core` 提供：

- `assertGovernanceHandoff` / `isGovernanceHandoff`；
- `projectGovernanceAttention`；
- `projectGovernanceAttentionQueue`。

队列只保留以下事项：

- `waiting_user`：等待用户输入或决策；
- `reconcile_required`：存在 UNKNOWN 或需要对账；
- `permission_blocked` / `business_blocked`：被当前边界阻塞；
- `handoff_required`：需要把结果交付给人；
- `close_available`：工作已达到可关闭状态。

正常运行中的 `continue`、已完成且已交付的 receipt 不进入队列。相同 run/effect 的后续 receipt 会替换旧投影；run 级 settled/failed/cancelled/closed receipt 也会清理该 run 的 effect 级旧项，避免重复催促。已完成但仍需要 handoff 或 close 的 receipt 仍会进入队列；只有 `next.action` 为 `none`/`continue` 且无需对账时保持安静。

所有输出固定标记：

```json
{
  "authorization": "none",
  "readOnly": true
}
```

投影丢弃 action payload、evidence body、resource metadata 和原始上下文。该投影是纯只读旁路；输入不符合既有 Receipt 校验契约时会拒绝并保留错误，调用方不得让它阻塞主执行。

## 明确不做

本切片不：

- 创建 Router/Worker daemon；
- 调用 Intercom、Subagents 或 Schedule；
- 启动、停止、重试或 replay Worker；
- 写入权限、Gate、Guard、生产配置或 Hindsight bank；
- 进行 24×7 运行或自动自我修改；
- 把 Attention Queue 当作新的权威状态源。

真实运行接线、自然任务观察和业务完成仍需使用各自 Owner 的原生合同分开验收。
