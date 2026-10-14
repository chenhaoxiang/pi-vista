import { types } from "node:util";

export const STAGE6_CONTEXT_ROI_SCHEMA = "stage6-context-roi/1";
const ARM_KEYS = ["runs", "successes", "trace_accurate", "decision_parsed", "elapsed_ms", "tokens", "reasoning_tokens", "tool_calls", "human_interventions", "sdk_cost", "cost_priced", "unknown_runs"];
const CONTEXT_KEYS = ["baseline_characters", "guided_characters", "compile_ms", "profile_drift", "evaluation_status"];
const INPUT_KEYS = ["baseline", "guided", "context"];
const OUTPUT_KEYS = ["schema", "status", "recommendation", "reason_code", "baseline_successes", "guided_successes", "semantic_gain", "trace_gain", "baseline_tokens", "guided_tokens", "token_delta", "token_overhead_ratio", "context_delta_chars", "compile_ms", "elapsed_delta_ms", "cost_status", "non_degradation", "verification", "authorization", "executable"];
const REASONS = ["evaluation-unknown", "semantic-regression", "negative-context-roi", "semantic-gain-observed", "token-saving-observed", "no-demonstrated-benefit"];
const refuse = () => { throw Error("stage6-context-roi-refused"); };
function own(value, keys) {
  if (types.isProxy(value) || value === null || typeof value !== "object" || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value)) || Reflect.ownKeys(value).length !== keys.length) refuse();
  const out = Object.create(null);
  for (const key of keys) { const p = Object.getOwnPropertyDescriptor(value, key); if (!p || !Object.hasOwn(p, "value") || p.value === undefined) refuse(); out[key] = p.value; }
  return out;
}
function number(value, min = 0) { if (typeof value !== "number" || !Number.isFinite(value) || value < min) refuse(); return value; }
function integer(value, min = 0) { if (!Number.isSafeInteger(value) || value < min) refuse(); return value; }
function arm(value) {
  const v = own(value, ARM_KEYS);
  for (const key of ["runs", "successes", "trace_accurate", "decision_parsed", "tokens", "tool_calls", "human_interventions", "unknown_runs"]) integer(v[key]);
  number(v.elapsed_ms); if (v.reasoning_tokens !== null) number(v.reasoning_tokens);
  if (v.sdk_cost !== null) number(v.sdk_cost); if (typeof v.cost_priced !== "boolean") refuse();
  if (v.cost_priced ? v.sdk_cost === null || v.sdk_cost === 0 : v.sdk_cost !== null) refuse();
  if (v.successes > v.decision_parsed || v.trace_accurate > v.runs || v.decision_parsed > v.runs || v.unknown_runs > v.runs) refuse();
  return Object.freeze(v);
}
function context(value) {
  const v = own(value, CONTEXT_KEYS);
  for (const key of ["baseline_characters", "guided_characters"]) integer(v[key]);
  if (v.compile_ms !== null) number(v.compile_ms);
  if (v.guided_characters < v.baseline_characters || !["unchanged", "unknown", "not-observed"].includes(v.profile_drift) || !["measured", "unknown", "not-evaluated"].includes(v.evaluation_status)) refuse();
  return Object.freeze(v);
}
function output(value) {
  const v = own(value, OUTPUT_KEYS);
  if (v.schema !== STAGE6_CONTEXT_ROI_SCHEMA || !["candidate", "not-beneficial", "insufficient"].includes(v.status) ||
      v.recommendation !== ({ candidate: "inject-candidate", "not-beneficial": "do-not-inject", insufficient: "collect-more" })[v.status] || !REASONS.includes(v.reason_code) ||
      v.verification !== "metadata-only" || v.authorization !== "none" || v.executable !== false || !["priced-estimate", "unpriced"].includes(v.cost_status) || typeof v.non_degradation !== "boolean") refuse();
  for (const key of ["baseline_successes", "guided_successes", "baseline_tokens", "guided_tokens", "context_delta_chars"]) integer(v[key]);
  if (v.compile_ms !== null) number(v.compile_ms);
  for (const key of ["semantic_gain", "trace_gain", "token_delta"]) if (v[key] !== null && !Number.isSafeInteger(v[key])) refuse();
  for (const key of ["token_overhead_ratio", "elapsed_delta_ms"]) if (v[key] !== null && (typeof v[key] !== "number" || !Number.isFinite(v[key]))) refuse();
  if (v.status === "insufficient") {
    if (v.reason_code !== "evaluation-unknown" || v.non_degradation !== false || ["semantic_gain", "trace_gain", "token_delta", "token_overhead_ratio", "elapsed_delta_ms"].some(key => v[key] !== null)) refuse();
  } else if (["semantic_gain", "trace_gain", "token_delta", "elapsed_delta_ms"].some(key => v[key] === null) ||
             v.semantic_gain !== v.guided_successes - v.baseline_successes || v.token_delta !== v.guided_tokens - v.baseline_tokens ||
             v.token_overhead_ratio !== (v.baseline_tokens === 0 ? null : v.token_delta / v.baseline_tokens)) refuse();
  return Object.freeze(v);
}
/** Pure offline comparison. It never reads model/bank/profile state and never
 * changes guidance injection or permissions. The caller supplies already-safe
 * paired aggregate summaries and context lengths only. */
export function analyzeStage6ContextRoi(input) {
  try {
    const v = own(input, INPUT_KEYS), baseline = arm(v.baseline), guided = arm(v.guided), c = context(v.context);
    if (baseline.runs !== guided.runs || baseline.runs < 1 || baseline.unknown_runs > 0 || guided.unknown_runs > 0 || c.profile_drift !== "unchanged" || c.evaluation_status !== "measured") {
      return output({ schema: STAGE6_CONTEXT_ROI_SCHEMA, status: "insufficient", recommendation: "collect-more", reason_code: "evaluation-unknown", baseline_successes: baseline.successes, guided_successes: guided.successes,
        semantic_gain: null, trace_gain: null, baseline_tokens: baseline.tokens, guided_tokens: guided.tokens, token_delta: null, token_overhead_ratio: null, context_delta_chars: c.guided_characters - c.baseline_characters,
        compile_ms: c.compile_ms, elapsed_delta_ms: null, cost_status: baseline.cost_priced && guided.cost_priced ? "priced-estimate" : "unpriced", non_degradation: false, verification: "metadata-only", authorization: "none", executable: false });
    }
    const semantic_gain = guided.successes - baseline.successes, trace_gain = guided.trace_accurate - baseline.trace_accurate;
    const token_delta = guided.tokens - baseline.tokens, token_overhead_ratio = baseline.tokens === 0 ? null : token_delta / baseline.tokens;
    const context_delta_chars = c.guided_characters - c.baseline_characters, elapsed_delta_ms = guided.elapsed_ms - baseline.elapsed_ms;
    const cost_status = baseline.cost_priced && guided.cost_priced ? "priced-estimate" : "unpriced";
    const non_degradation = semantic_gain >= 0 && trace_gain >= 0 && guided.decision_parsed >= baseline.decision_parsed && guided.human_interventions <= baseline.human_interventions;
    const qualityGain = semantic_gain > 0 || trace_gain > 0;
    const candidate = non_degradation && (qualityGain || token_delta < 0);
    const status = candidate ? "candidate" : "not-beneficial";
    const recommendation = candidate ? "inject-candidate" : "do-not-inject";
    // A single-window elapsed improvement alone does not demonstrate ROI.
    const reason_code = !non_degradation ? "semantic-regression" : qualityGain ? "semantic-gain-observed" : token_delta < 0 ? "token-saving-observed" :
      token_delta > 0 || context_delta_chars > 0 ? "negative-context-roi" : "no-demonstrated-benefit";
    return output({ schema: STAGE6_CONTEXT_ROI_SCHEMA, status, recommendation, reason_code, baseline_successes: baseline.successes, guided_successes: guided.successes,
      semantic_gain, trace_gain, baseline_tokens: baseline.tokens, guided_tokens: guided.tokens, token_delta, token_overhead_ratio, context_delta_chars,
      compile_ms: c.compile_ms, elapsed_delta_ms, cost_status, non_degradation, verification: "metadata-only", authorization: "none", executable: false });
  } catch { throw Error("stage6-context-roi-refused"); }
}
export function validateStage6ContextRoi(input) {
  try { return output(input); } catch { throw Error("stage6-context-roi-refused"); }
}
