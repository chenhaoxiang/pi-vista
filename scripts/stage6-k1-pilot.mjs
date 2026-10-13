import { randomUUID, createHash } from "node:crypto";
import { types } from "node:util";
import { openStage6Pilot } from "./stage6-pilot-coordinator.mjs";
import { admitStage6Run, snapshotStage6Context, classifyProfileDrift } from "./stage6-admission.mjs";
import { admitK1 } from "./stage6-k1-admission.mjs";
import { isK1PreparedHistory } from "./stage6-k1-history-host.mjs";
import { snapshotStage6Provenance } from "./stage6-pilot-coordinator.mjs";
import { adaptK1SDKMeasurement, aggregateK1SDKMeasurements } from "./stage6-k1-metrics-adapter.mjs";
import { pairedOrder, pairedFixture, expectedFixtureContract, PAIR_CASES, PAIR_SOURCE_SHA, PAIR_HISTORY_DIGEST, PAIR_TIMEOUT_MS, PAIR_ROUND_BUDGET } from "./paired-evaluation-data.mjs";
import { PUBLIC_1_0_4_CONTRACT } from "./stage6-sdk-provenance.mjs";
import { classifyDecisionOutcome, STRICT_DECISION_SCHEMA } from "./stage6-decision-tool.mjs";
import { failureCode, providerFailureCategory } from "./pi-agent-canary-support.mjs";

const KEYS = ["profileDirectory", "context", "bindings", "provenance", "preparedHistory"];
const PORTS = ["createSession", "collectProvenance", "checkSource", "captureProfile"];
const SYSTEM = "Validate the synthetic metadata by calling paired_inspect_metadata exactly once, then emit exactly one stage6_decision tool call. Compare source_sha/env_fingerprint and required title/format_version with the expected contract. No other actions or tools.";
const TOOLS = Object.freeze(["paired_inspect_metadata", "stage6_decision"]);
const rejected = () => { throw Error("stage6-k1-pilot-refused"); };
function own(v, keys) {
  if (types.isProxy(v) || !v || typeof v !== "object" || Array.isArray(v) || ![Object.prototype, null].includes(Object.getPrototypeOf(v)) || Reflect.ownKeys(v).length !== keys.length) rejected();
  const out = Object.create(null);
  for (const k of keys) { const p = Object.getOwnPropertyDescriptor(v, k); if (!p || !Object.hasOwn(p, "value") || p.value === undefined) rejected(); out[k] = p.value; }
  return out;
}
const hash = v => createHash("sha256").update(v).digest("hex");
const stable = v => v === null || typeof v !== "object" ? JSON.stringify(v) : Array.isArray(v) ? `[${v.map(stable).join(",")}]` : `{${Object.keys(v).sort().map(k => `${JSON.stringify(k)}:${stable(v[k])}`).join(",")}}`;
export function k1PilotTask(case_id, source, environment) {
  return `Inspect case_id=${case_id}; expected contract=${stable(expectedFixtureContract(source, environment))}. Call paired_inspect_metadata for this case, then stage6_decision with the exact case_id, decision and reason_code. The decision tool records the answer and terminates its tool batch.`;
}
export function k1PilotTools(case_id) {
  if (!PAIR_CASES.includes(case_id)) rejected();
  return Object.freeze({ inspector: Object.freeze({ type: "object", additionalProperties: false, properties: Object.freeze({ case_id: Object.freeze({ type: "string", enum: PAIR_CASES }) }), required: Object.freeze(["case_id"]) }), decision: STRICT_DECISION_SCHEMA });
}
function sumUsage(messages) {
  if (!messages.length) throw Error("stage6-k1-usage-unavailable");
  const totals = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
  let reasoning = 0, reasoningObserved = true;
  for (const m of messages) {
    const u = m.usage;
    if (!u || typeof u !== "object") throw Error("stage6-k1-usage-unavailable");
    for (const k of ["input", "output", "cacheRead", "cacheWrite", "totalTokens"]) {
      if (!Number.isSafeInteger(u[k]) || u[k] < 0 || !Number.isSafeInteger(totals[k] + u[k])) throw Error("stage6-k1-usage-unavailable"); totals[k] += u[k];
    }
    for (const k of Object.keys(totals.cost)) { if (!u.cost || !Number.isFinite(u.cost[k]) || u.cost[k] < 0 || !Number.isFinite(totals.cost[k] + u.cost[k])) throw Error("stage6-k1-usage-unavailable"); totals.cost[k] += u.cost[k]; }
    if (u.reasoning === undefined) reasoningObserved = false;
    else { if (!Number.isSafeInteger(u.reasoning) || u.reasoning < 0 || u.reasoning > u.output || !Number.isSafeInteger(reasoning + u.reasoning)) throw Error("stage6-k1-usage-unavailable"); reasoning += u.reasoning; }
  }
  if (reasoningObserved) totals.reasoning = reasoning;
  return Object.freeze({ ...totals, cost: Object.freeze(totals.cost) });
}
export function summarizeK1Usage(messages) { return sumUsage(messages); }
function technical(error) {
  if (error instanceof Error && error.message === "stage6-window-deadline") return "deadline";
  if (error instanceof Error && ["stage6-session-budget-exhausted", "request-budget-exhausted"].includes(error.message)) return "round-budget";
  const c = failureCode(error);
  return ["deadline", "round-budget", "model-drift"].includes(c) ? c : "external-failure";
}

/** One explicit trusted-host window. Sessions and history are genuine objects;
 * no CLI/model/bank/default activation occurs at import. Ports are host code,
 * not a sandbox: the coordinator owns one total budget and two per session.
 */
export async function runK1Pilot(input, portsInput) {
  const v = own(input, KEYS), ports = own(portsInput, PORTS);
  for (const fn of Object.values(ports)) if (typeof fn !== "function" || types.isProxy(fn)) rejected();
  if (!isK1PreparedHistory(v.preparedHistory) || !v.preparedHistory.isCurrent()) rejected();
  const provenance = snapshotStage6Provenance(v.provenance), base = snapshotStage6Context(v.context);
  const bindingCheck = snapshotStage6Provenance({ ...provenance, bindings: v.bindings });
  if (stable(bindingCheck.bindings) !== stable(provenance.bindings)) rejected();
  const bindings = provenance.bindings;
  for (const key of ["repo", "source_sha", "policy_version", "env_fingerprint"]) {
    if (bindings[key] !== v.preparedHistory.compiled_context.provenance[0][key]) rejected();
  }
  if (base.provider !== "codex-local-8319" || base.model !== "gpt-6.1-sol" || base.thinking !== "max" || base.sdk !== "1.0.4" ||
      base.arm !== "baseline" || base.subject_source_sha !== PAIR_SOURCE_SHA || base.subject_history_digest !== PAIR_HISTORY_DIGEST ||
      provenance.sdk.expected.contract_id !== PUBLIC_1_0_4_CONTRACT.contract_id ||
      ["package_name", "version", "export_entry", "node_engine", "manifest_sha256", "entry_sha256"].some(key => provenance.sdk.expected[key] !== PUBLIC_1_0_4_CONTRACT[key])) rejected();
  const budget = Object.freeze({ k: 1, max_requests: 16, max_per_session: 2, deadline_ms: PAIR_TIMEOUT_MS });
  const plans = pairedOrder().map(({ case_id, arm }) => {
    const guided = arm === "guided", context = { ...base, arm, guidance_mode: guided ? "historical-observed" : "none", guidance_digest: guided ? v.preparedHistory.history_context.context_digest : null };
    const admission = admitK1({ context, expected: context, provenance, history: guided ? v.preparedHistory.history_context : null, budget, model_calls: 0 });
    if (admission.status !== "metadata-admitted") rejected(); return { case_id, arm, context };
  });
  await ports.checkSource(); v.preparedHistory.check();
  const window = await openStage6Pilot({ profileDirectory: v.profileDirectory, context: base, expected: base, bindings: v.bindings,
    expectedProvenance: provenance, model_calls: 0, max_requests: 16, deadline_ms: PAIR_TIMEOUT_MS }, { captureProfile: ports.captureProfile, collectProvenance: ports.collectProvenance });
  if (window.status !== "admitted") return Object.freeze({ schema: "stage6-k1-pilot/1", status: "not-ready", reason_code: window.reason_code,
    rows: Object.freeze([]), aggregate: null, receipt: window, verification: "metadata-only", authorization: "none", executable: false });
  const records = [], rows = [], sessions = new Set(); const started = performance.now();
  let session, receipt, stopped = null, systemDigest, toolDigest;
  try {
    // All genuine arm admissions are prepared once while the one window's
    // observed transport counter is zero, never refilled per row after calls.
    const before = await ports.captureProfile(v.profileDirectory), after = await ports.captureProfile(v.profileDirectory);
    if (window.statusSnapshot().pretransport_attempts !== 0) rejected();
    for (const plan of plans) {
      plan.genuine = admitStage6Run({ ...plan.context, profile_before: before, profile_after: after,
        model_calls: window.statusSnapshot().pretransport_attempts }, plan.context);
      if (!plan.genuine.admitted) throw Error("stage6-k1-row-admission-refused");
    }
    for (const plan of plans) {
      await ports.checkSource(); v.preparedHistory.check();
      if (classifyProfileDrift(before, await ports.captureProfile(v.profileDirectory)).classification !== "unchanged") throw Error("stage6-profile-unavailable");
      const fixture = pairedFixture(plan.case_id, PAIR_SOURCE_SHA, bindings.env_fingerprint), expected = expectedFixtureContract(PAIR_SOURCE_SHA, bindings.env_fingerprint);
      const task = k1PilotTask(plan.case_id, PAIR_SOURCE_SHA, bindings.env_fingerprint), definitions = k1PilotTools(plan.case_id);
      let inspected = 0, decisions = 0, call = null, toolEvents = 0, retryEvents = 0, rowError = null; const messages = [];
      const tools = { inspect(args) { if (!args || Object.keys(args).length !== 1 || args.case_id !== plan.case_id || inspected !== 0) throw Error("stage6-k1-inspector-refused"); inspected++; return fixture; },
        decide(args) { decisions++; call = { name: "stage6_decision", arguments: args }; return { content: [{ type: "text", text: "Structured decision recorded" }], details: {}, terminate: true }; } };
      const made = await ports.createSession({ case_id: plan.case_id, arm: plan.arm, system: SYSTEM, task, definitions, tools,
        guidance: plan.arm === "guided" ? v.preparedHistory.compiled_context.content : null });
      session = made.session;
      if (!session || made.modelFallbackMessage !== undefined || sessions.has(session.sessionId)) throw Error("stage6-k1-session-identity-refused");
      sessions.add(session.sessionId);
      const baseline = { provider: session.model?.provider, model: session.model?.id, thinking: session.thinkingLevel,
        system: session.systemPrompt, tools: [...session.getActiveToolNames()].sort() };
      const currentSystemDigest = hash(baseline.system);
      const currentToolDigest = made.toolDefinitionDigest;
      if (baseline.provider !== base.provider || baseline.model !== base.model || baseline.thinking !== base.thinking || !baseline.system.startsWith(SYSTEM) ||
          stable(baseline.tools) !== stable([...TOOLS].sort()) || typeof currentToolDigest !== "string" || !/^[a-f0-9]{64}$/u.test(currentToolDigest)) throw Error("stage6-k1-session-contract-refused");
      systemDigest ??= currentSystemDigest; toolDigest ??= currentToolDigest;
      if (currentSystemDigest !== systemDigest || currentToolDigest !== toolDigest) throw Error("stage6-k1-session-contract-refused");
      const binding = window.bindSession(session, plan.genuine, { maxPerSession: 2, requestGuard: made.requestGuard });
      const unsubscribe = session.subscribe(event => {
        if (event.type === "message_end" && event.message?.role === "assistant") messages.push(event.message);
        if (event.type === "tool_execution_end") toolEvents++;
        if (["auto_retry_start", "compaction_start", "summarization_retry_scheduled"].includes(event.type)) { retryEvents++; session.agent.abort(); }
      });
      const rowStart = performance.now(); let timer;
      try {
        const remaining = PAIR_TIMEOUT_MS - (performance.now() - started);
        if (remaining <= 0) throw Error("stage6-window-deadline");
        const prompting = typeof made.promptTask === "function" ? made.promptTask() : session.prompt(task, { expandPromptTemplates: false });
        await Promise.race([prompting, new Promise((_, reject) => { timer = setTimeout(() => { session.agent.abort(); reject(Error("stage6-window-deadline")); }, remaining); })]);
        await session.waitForIdle();
      } catch (e) { rowError = technical(e); await session.abort().catch(() => undefined); }
      finally { clearTimeout(timer); unsubscribe(); }
      const elapsed = performance.now() - rowStart;
      const last = messages.at(-1);
      const failure = rowError ?? (last?.stopReason === "aborted" ? "cancelled" : last?.stopReason === "error" ? providerFailureCategory(last.errorMessage) : retryEvents ? "request-contract" : null);
      const outcome = classifyDecisionOutcome({ case_id: plan.case_id,
        status: failure ? ["cancelled", "deadline", "timeout", "stream-disconnected"].includes(failure) ? failure : "provider-error" : "completed", call,
        metadata: fixture, expected });
      const trace = inspected === 1 && decisions === 1 && toolEvents === 2 && retryEvents === 0;
      const success = outcome.outcome === "decision-valid" && trace && !failure;
      const measurement = { case_id: plan.case_id, arm: plan.arm, source_sha: PAIR_SOURCE_SHA, harness_source_sha: base.harness_source_sha,
        provider: base.provider, model: base.model, thinking: base.thinking, sdk: base.sdk,
        runtime_digest: hash(stable({ sdk: provenance.sdk.observed_digest, profile: provenance.broker.target_metadata_sha256, node: process.version })),
        system_prompt_digest: currentSystemDigest, tool_definition_digest: currentToolDigest, task_prompt_digest: hash(task),
        timeout_ms: PAIR_TIMEOUT_MS, round_budget: PAIR_ROUND_BUDGET, run_identity_digest: hash(randomUUID()), session_identity_digest: hash(session.sessionId),
        guidance_mode: plan.arm === "guided" ? "historical-observed" : "none", history_digest: plan.arm === "guided" ? PAIR_HISTORY_DIGEST : null,
        context_digest: plan.context.guidance_digest, history_current_verification: plan.arm === "guided" ? "not-checked" : "none",
        guidance_reimported: plan.arm === "guided", guidance_currently_verified: plan.arm === "guided" && v.preparedHistory.isCurrent(), authorization: "none", executable: false,
        success, failure_category: success ? "none" : failure ?? "fixture-mismatch", trace_accuracy: trace, decision_parsed: outcome.decision_parsed,
        disagreement_count: outcome.outcome === "semantic-mismatch" ? 1 : 0, elapsed_ms: elapsed, request_attempts: binding.status().session_attempts,
        retry_count: retryEvents, cancelled: failure === "cancelled", tool_calls: toolEvents, human_interventions: 0, output_digest: hash(stable({ outcome, messages: messages.map(m => ({ content: m.content, stopReason: m.stopReason })) })) };
      let record = null;
      try { record = { measurement, usage: sumUsage(messages) }; adaptK1SDKMeasurement(record); records.push(record); }
      catch { record = null; stopped ??= "metric-incomplete"; }
      rows.push(Object.freeze({ case_id: plan.case_id, arm: plan.arm, outcome: outcome.outcome, decision_parsed: outcome.decision_parsed, trace_accuracy: trace,
        success, failure_category: measurement.failure_category, elapsed_ms: elapsed, request_attempts: measurement.request_attempts, metric_complete: record !== null }));
      session.dispose(); session = undefined;
      if (failure || record === null) { stopped = failure ?? stopped; break; }
    }
  } catch (e) { stopped = technical(e); }
  finally {
    if (session) { try { await session.abort(); } finally { session.dispose(); } }
    receipt = await window.finalize();
  }
  let aggregate = null;
  if (records.length === 8 && receipt.integrity_status === "unchanged") { try { aggregate = aggregateK1SDKMeasurements(records); } catch { stopped ??= "metric-contract-refused"; } }
  if (records.length !== 8) stopped ??= "metric-incomplete";
  return Object.freeze({ schema: "stage6-k1-pilot/1", status: aggregate?.evaluation_status === "measured" ? "measured" : "unknown",
    reason_code: stopped, rows: Object.freeze(rows), aggregate, receipt, fresh_sessions: sessions.size,
    verification: "metadata-only", authorization: "none", executable: false });
}
