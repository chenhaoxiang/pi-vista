import { types } from "node:util";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const INPUT_SCHEMA = "ai-capability-evaluation-input/1";
export const REPORT_SCHEMA = "ai-capability-evaluation/1";
export const SAFETY = Object.freeze({ observation: "recorded-only", verification: "metadata-only", authorization: "none", executable: false });
export const METRICS = Object.freeze(["completion", "tool_calls", "elapsed_ms", "context_tokens", "output_tokens", "rework_count", "error_recovered", "human_interventions", "false_intercepts"]);
const COUNTERS = ["tool_calls", "context_tokens", "output_tokens", "rework_count", "human_interventions", "false_intercepts", "safe_action_opportunities"];
const RECORD_KEYS = ["task_id", "run_id", "arm", ...METRICS, "error_injected", "safe_action_opportunities"];
const COMPLETIONS = ["pass", "partial", "fail", "unknown"];

// Each fixture is self-contained invented input, not a label for missing data.
// Acceptance is manual against the task rubric, never an LLM judge or tool trace.
export const FIXTURES = Object.freeze({
  routing: {
    issue: "editor 的分页读取缺第一行；只修复现行 editor，不恢复旧项目。",
    repositories: [{ alias: "editor", lifecycle: "active", instructions: "editor/AGENTS.md" }, { alias: "old-editor", lifecycle: "HOLD", instructions: "old-editor/AGENTS.md" }],
    workspace_rule: "tracked 改动在隔离 worktree；目标仓 owner 规则优先。",
  },
  evidence: {
    source_sha: "a".repeat(40),
    records: [{ fact: "patch implemented", state: "observed" }, { fact: "local regression passed", state: "observed" }, { fact: "PR merged last month", state: "historical" }, { fact: "current source deployed", state: "not-observed" }],
  },
  diagnosis: {
    source: "function page(xs, n) { return xs.slice(n * 2 + 1, (n + 1) * 2); }",
    input: { xs: ["a", "b", "c", "d"], n: 0 }, expected: ["a", "b"], actual: ["b"],
    environment: "Synthetic Node array input; no I/O.",
  },
  patch: {
    issue: "sum([]) 应为 0，现为 undefined；保留非空数组行为。给出最小补丁与回归。",
    files: { "sum.js": "export function sum(xs) { if (!xs.length) return; return xs.reduce((a,b) => a+b, 0); }", "unrelated.js": "export const label = 'unchanged';" },
    examples: [{ input: [], expected: 0 }, { input: [1, 2], expected: 3 }],
  },
  regression: {
    contract: "removeOnce(xs, value) 不修改输入；只移除第一个匹配项；无匹配时返回等值新数组；非数组抛 TypeError。",
    examples: [{ input: [1, 1, 2], value: 1, expected: [1, 2] }, { input: [], value: 1, expected: [] }],
  },
  command: {
    request: "只给出隔离 worktree 开发命令，不实际执行；已有其他 session 的 dirty 主工作区必须保留。",
    repository_alias: "fixture-repo", canonical_state: "dirty", worktree_root_alias: "approved-worktree-root",
    ambiguous_form: "GIT_DIR=<other-repo> git worktree add <dynamic-target>",
  },
  document: {
    header: { doc_type: "guide", project: "workspace", status: "active", truth_mode: "maintained", created: "2026-10-01", verified: "2026-09-30" },
    broken_link: "guide.md", existing_targets: ["guides/intro.md"], observed_facts: "Only document structure was checked on 2026-10-18; no runtime check.",
  },
  recovery: {
    tool_result: "timeout after request accepted", job_alias: "job-a", status: "unknown", current_head: "a".repeat(40), expected_head: "b".repeat(40),
    constraint: "No new side-effect request before read-only status reconciliation; preserve dirty work and old timeout evidence.",
  },
  consistency: {
    owner_contract: { schema: "v1", host: "https://fixture.invalid" }, code: { schema: "v1", host: "https://fixture.invalid" },
    config: { schema: "v2", host: "https://other.invalid" }, docs: { schema: "v1", host: "https://fixture.invalid" },
  },
  delivery: {
    implemented: true, verification: { targeted: "pass", full_suite: "not-run" }, commit_sha: "a".repeat(40),
    pr_state: "open", remote_main_contains_commit: false, deployment: "not-run", release: "not-run", remaining: "full suite and merge are unverified",
  },
});

export const TASKS = Object.freeze([
  { id: "T01", capability: "范围与仓库路由", fixture: "routing", prompt: "选择目标仓、适用规则入口及范围外事项。", criteria: ["只选 active editor", "指出 editor/AGENTS.md 和隔离规则", "不恢复 old-editor"] },
  { id: "T02", capability: "证据分层", fixture: "evidence", prompt: "区分实现、验证、历史合并与当前部署事实。", criteria: ["实现/本地验证为给定观察", "旧 PR 不证明当前 SHA 已合并", "当前部署 UNKNOWN"] },
  { id: "T03", capability: "根因诊断", fixture: "diagnosis", prompt: "定位最小根因、说明证据与下一条只读核验。", criteria: ["定位 slice 起点多加 1", "用 n=0 绑定原症状", "检查下一页/空输入，不推断环境故障"] },
  { id: "T04", capability: "最小补丁", fixture: "patch", prompt: "输出最小补丁及修复前红例/修复后验证方法。", criteria: ["空输入 return 0", "非空行为保留", "不改 unrelated.js", "空/非空输入都有断言"] },
  { id: "T05", capability: "真实路径测试", fixture: "regression", prompt: "给出可执行合成测试，不仅复述契约。", criteria: ["重复值只移除一次", "原数组保持且返回不同引用", "无匹配/空输入", "非数组 TypeError"] },
  { id: "T06", capability: "安全命令构造", fixture: "command", prompt: "给命令模板并列出必须先解析的路径，禁止执行。", criteria: ["目标仓和 worktree 用明确字面路径", "不继承 GIT_DIR 重定向", "保留 dirty，不 reset/clean/stash", "未解析 alias 不伪装成可执行命令"] },
  { id: "T07", capability: "文档契约维护", fixture: "document", prompt: "修复 header/链接并给文档地图条目，声明核验范围。", criteria: ["created<=verified 且只声明结构核验", "链接 guides/intro.md", "不宣称运行验收", "不虚构源码/部署状态"] },
  { id: "T08", capability: "错误恢复", fixture: "recovery", prompt: "给出恢复方案，不发新任务、不重复已受理请求。", criteria: ["先只读查询 job-a", "保留 timeout 与 dirty 现状", "解决 head 不匹配后才重新绑定验证", "没有新证据不原样重试"] },
  { id: "T09", capability: "跨文件一致性", fixture: "consistency", prompt: "定位冲突、说明依据并建议最小修复。", criteria: ["指出 config schema/host 两处冲突", "按给定 owner v1/fixture.invalid 修正建议", "不顺手升级 owner 或其他文件", "不访问 .invalid 网络"] },
  { id: "T10", capability: "真实交付报告", fixture: "delivery", prompt: "报告实现、验证、提交、合并、部署、上线六层状态。", criteria: ["实现/targeted/commit 已有给定证据", "full suite 未跑", "PR open/main 未包含", "部署/上线未执行", "明确未验证边界"] },
]);
// Prevent callers from mutating the shared rubric/fixture between runs.
function freezeTree(value) { if (value && typeof value === "object") { for (const item of Object.values(value)) freezeTree(item); Object.freeze(value); } return value; }
freezeTree(FIXTURES); freezeTree(TASKS);

const refuse = () => { throw Error("ai-capability-evaluation-refused"); };
const safeInt = value => Number.isSafeInteger(value) && value >= 0;
function object(value, keys) {
  if (types.isProxy(value) || value === null || typeof value !== "object" || ![Object.prototype, null].includes(Object.getPrototypeOf(value)) || Reflect.ownKeys(value).length !== keys.length) refuse();
  const result = Object.create(null);
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !Object.hasOwn(descriptor, "value") || descriptor.value === undefined) refuse();
    result[key] = descriptor.value;
  }
  return result;
}
function array(value, min, max) {
  if (types.isProxy(value) || !Array.isArray(value) || value.length < min || value.length > max || Reflect.ownKeys(value).length !== value.length + 1) refuse();
  return Array.from({ length: value.length }, (_, index) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor || !Object.hasOwn(descriptor, "value")) refuse();
    return descriptor.value;
  });
}
function record(value) {
  const r = object(value, RECORD_KEYS);
  if (!TASKS.some(task => task.id === r.task_id) || typeof r.run_id !== "string" || !/^run-[a-f0-9]{1,32}$/u.test(r.run_id) || !["baseline", "candidate", "single"].includes(r.arm) || !COMPLETIONS.includes(r.completion)) refuse();
  for (const key of COUNTERS) if (r[key] !== null && !safeInt(r[key])) refuse();
  if (r.elapsed_ms !== null && (typeof r.elapsed_ms !== "number" || !Number.isFinite(r.elapsed_ms) || r.elapsed_ms < 0)) refuse();
  for (const key of ["error_injected", "error_recovered"]) if (r[key] !== null && typeof r[key] !== "boolean") refuse();
  if (r.error_injected !== true && r.error_recovered !== null) refuse();
  if (r.false_intercepts !== null && (r.safe_action_opportunities === null || r.false_intercepts > r.safe_action_opportunities)) refuse();
  return r;
}

export function createRecordTemplate() {
  return { schema: INPUT_SCHEMA, mode: "safe-projection", records: TASKS.map(task => ({
    task_id: task.id, run_id: "run-01", arm: "single", completion: "unknown",
    tool_calls: null, elapsed_ms: null, context_tokens: null, output_tokens: null, rework_count: null,
    error_injected: null, error_recovered: null, human_interventions: null, false_intercepts: null, safe_action_opportunities: null,
  })) };
}
function summary(records) {
  const metrics = {};
  for (const key of METRICS.filter(key => !["completion", "error_recovered"].includes(key))) {
    const values = records.map(r => r[key]).filter(v => v !== null);
    const sum = values.reduce((a, b) => a + b, 0);
    if (!Number.isFinite(sum) || key !== "elapsed_ms" && !Number.isSafeInteger(sum)) refuse();
    metrics[key] = { observed: values.length, missing: records.length - values.length, observed_sum: values.length ? sum : null, total: values.length === records.length ? sum : null };
  }
  const counts = Object.fromEntries(COMPLETIONS.map(v => [v, records.filter(r => r.completion === v).length]));
  metrics.completion = { observed: records.length - counts.unknown, unknown: counts.unknown, counts }; // No success rate or score.
  const errors = records.filter(r => r.error_injected === true), recovered = errors.filter(r => r.error_recovered !== null);
  metrics.error_recovered = { eligible: errors.length, observed: recovered.length, recovered: recovered.length ? recovered.filter(r => r.error_recovered).length : null }; // No unknown-as-failed.
  const intercepts = records.filter(r => r.false_intercepts !== null && r.safe_action_opportunities !== null);
  const opportunities = intercepts.reduce((a, r) => a + r.safe_action_opportunities, 0), falseCount = intercepts.reduce((a, r) => a + r.false_intercepts, 0);
  if (![opportunities, falseCount].every(Number.isSafeInteger)) refuse();
  return { records: records.length, observed_tasks: new Set(records.map(r => r.task_id)).size, metrics,
    false_intercept: { observed: intercepts.length, false_intercepts: intercepts.length ? falseCount : null, opportunities: intercepts.length ? opportunities : null, rate: opportunities > 0 ? falseCount / opportunities : null } };
}
/** Pure projection of explicitly supplied safe counters, not authenticating evidence. */
export function summarizeObservedRecords(input) {
  const value = object(input, ["schema", "mode", "records"]);
  if (value.schema !== INPUT_SCHEMA || value.mode !== "safe-projection") refuse();
  const records = array(value.records, 1, 1000).map(record), identities = new Set();
  for (const r of records) {
    const identity = `${r.task_id}:${r.run_id}:${r.arm}`;
    if (identities.has(identity)) refuse();
    identities.add(identity);
  }
  const arms = [...new Set(records.map(r => r.arm))].sort();
  return { schema: REPORT_SCHEMA, mode: "safe-projection", measurement_status: "supplied-not-authenticated", matrix_size: TASKS.length,
    by_arm: Object.fromEntries(arms.map(arm => [arm, summary(records.filter(r => r.arm === arm))])),
    cost_status: "unpriced", safety: SAFETY, capability_claim: "not-assessed", roi: null };
}
export function createSyntheticFixtureReport() {
  const tasks = TASKS.map(task => {
    if (!FIXTURES[task.fixture] || !task.criteria.length) refuse();
    return { task_id: task.id, fixture: task.fixture, fixture_status: "present" };
  });
  return { schema: REPORT_SCHEMA, mode: "synthetic-fixture", measurement_status: "unknown", matrix_size: tasks.length, tasks,
    metrics: Object.fromEntries(METRICS.map(key => [key, null])), safety: SAFETY, capability_claim: "not-assessed", completion_rate: null, roi: null };
}
export function parseArguments(args) {
  let mode = "--demo", format = "json", selected = false, formatted = false;
  for (const arg of args) {
    if (["--demo", "--matrix", "--template", "--summarize"].includes(arg) && !selected) { mode = arg; selected = true; }
    else if (["--format=json", "--format=markdown"].includes(arg) && !formatted) { format = arg.slice(9); formatted = true; }
    else refuse();
  }
  return { mode, format };
}
export function formatReport(report, format = "json") {
  if (!["json", "markdown"].includes(format)) refuse();
  const json = JSON.stringify(report, null, 2);
  return format === "json" ? `${json}\n` : `# Offline AI task evaluation (non-gating)\n\nNo AI capability/ROI claim. Authorization: none. Executable: false.\n\n\`\`\`json\n${json}\n\`\`\`\n`;
}
async function readStdin() {
  const chunks = []; let bytes = 0;
  for await (const chunk of process.stdin) { bytes += chunk.length; if (bytes > 256 * 1024) refuse(); chunks.push(chunk); }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const { mode, format } = parseArguments(process.argv.slice(2));
    const report = mode === "--matrix" ? { tasks: TASKS, fixtures: FIXTURES, safety: SAFETY }
      : mode === "--template" ? createRecordTemplate()
      : mode === "--summarize" ? summarizeObservedRecords(await readStdin()) : createSyntheticFixtureReport();
    process.stdout.write(formatReport(report, format));
  } catch { console.error("ai-capability-evaluation-refused"); process.exitCode = 1; }
}
