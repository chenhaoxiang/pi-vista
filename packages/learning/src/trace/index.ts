import { generateStepId } from "@pi-vista/core";
import type { EvidenceBinding } from "@pi-vista/evidence";
import { MAX_STEPS, type ExperienceObservation, type FailureObservation, type SafeScript, type SafeStep } from "../contract.js";
import { BINDING_KEYS, binding, bindingOf, canonical, choice, frozen, hash, integer, invalid, label, list, metadata, own, sameBinding } from "../data.js";
import { observation } from "../input.js";

export interface TraceTask {
  readonly task_type: string; readonly description: string; readonly preconditions: readonly string[];
  readonly postconditions: readonly string[]; readonly applicable_to: readonly string[];
}
export interface TraceDraftInput {
  readonly experience_id: string; readonly expected: EvidenceBinding; readonly task: TraceTask;
  /** Explicit host loss count is an observation claim, never complete guard coverage. */
  readonly dropped_count: number; readonly events: readonly unknown[];
}
export interface TracePair {
  readonly step_id: string; readonly tool_class: string; readonly start_ts: number; readonly end_ts: number;
  readonly result: "ok" | "failed" | "blocked";
}
export interface TraceExperienceDraft {
  readonly mode: "dry-run-trace-draft"; readonly authorization: "none"; readonly executable: false;
  readonly current_verification: "not-checked"; readonly basis: "untrusted-input-shape-only";
  readonly observation: ExperienceObservation; readonly pairs: readonly TracePair[];
  readonly trace_digest: string; readonly dependency_basis: "not-inferred";
}
const actions = ["pi:agent-start", "pi:agent-end", "pi:agent-settled", "pi:tool-execution-start", "pi:tool-execution-end"] as const;
interface Event extends EvidenceBinding {
  readonly step_id: string; readonly ts: number; readonly action: typeof actions[number]; readonly result: string;
  readonly target_class?: string; readonly session_id?: string;
}
function event(input: unknown, expected: EvidenceBinding): Event {
  const required = [...BINDING_KEYS, "step_id", "ts", "component", "action", "result", "vista_version"];
  const v = own(input, [...required, "target_class", "session_id"], required);
  if (v.component !== "pi" || v.vista_version !== "0.1.0") invalid();
  const bound = binding(Object.fromEntries(BINDING_KEYS.map(key => [key, v[key]])));
  if (!sameBinding(bound, expected)) invalid();
  const action = choice(v.action, actions); const step = label(v.step_id);
  const sequence = step.slice(expected.run_id.length + 2);
  const ordinal = Number.parseInt(sequence, 36);
  if (!step.startsWith(`${expected.run_id}_s`) || !/^(?:0|[1-9a-z][0-9a-z]*)$/.test(sequence) ||
    !Number.isSafeInteger(ordinal) || generateStepId(expected.run_id, ordinal) !== step) invalid();
  const tool = action.startsWith("pi:tool-");
  if (tool ? typeof v.target_class !== "string" : v.target_class !== undefined) invalid();
  const result = choice(v.result, ["ok", "failed", "blocked", "unknown"]);
  if (action !== "pi:tool-execution-end" && result !== "unknown") invalid();
  if (action === "pi:tool-execution-end" && result === "unknown") invalid();
  return frozen({ ...bound, step_id: step, ts: integer(v.ts), action, result,
    ...(v.target_class === undefined ? {} : { target_class: label(v.target_class) }),
    ...(v.session_id === undefined ? {} : { session_id: label(v.session_id) }) });
}
/** Pure bounded draft; no verifier/library/callback/state/write, even for structurally complete input. */
export function draftTraceExperience(input: TraceDraftInput): TraceExperienceDraft {
  const v = own(input, ["experience_id", "expected", "task", "dropped_count", "events"]);
  const id = label(v.experience_id); const expected = binding(v.expected);
  if (integer(v.dropped_count, 1000000) !== 0) invalid();
  const t = own(v.task, ["task_type", "description", "preconditions", "postconditions", "applicable_to"]);
  const events = list(v.events, 64, 5).map(value => event(value, expected));
  const starts = events.filter(value => value.action === "pi:agent-start"), settled = events.filter(value => value.action === "pi:agent-settled");
  if (starts.length !== 1 || settled.length !== 1 || !events.some(value => value.action === "pi:agent-end")) invalid();
  const beginning = starts[0]!, final = settled[0]!;
  if (events.some(value => value.ts < beginning.ts || value.ts > final.ts || value.session_id !== beginning.session_id)) invalid();
  const identities = new Set<string>();
  for (const e of events) {
    const identity = `${e.action}:${e.step_id}`; if (identities.has(identity)) invalid(); identities.add(identity);
  }
  const toolStarts = events.filter(value => value.action === "pi:tool-execution-start");
  const toolEnds = events.filter(value => value.action === "pi:tool-execution-end");
  if (!toolStarts.length || toolStarts.length > MAX_STEPS || toolStarts.length !== toolEnds.length || new Set(toolStarts.map(value => value.step_id)).size !== toolStarts.length) invalid();
  const lifecycleIds = events.filter(value => value.action.startsWith("pi:agent-")).map(value => value.step_id);
  if (new Set(lifecycleIds).size !== lifecycleIds.length || toolStarts.some(value => lifecycleIds.includes(value.step_id))) invalid();
  const pairs = toolStarts.map(start => {
    const end = toolEnds.find(value => value.step_id === start.step_id);
    if (!end || end.target_class !== start.target_class || end.ts < start.ts || end.session_id !== start.session_id) invalid();
    return frozen({ step_id: start.step_id, tool_class: start.target_class!, start_ts: start.ts, end_ts: end.ts,
      result: end.result as TracePair["result"] });
  }).sort((a, b) => a.start_ts - b.start_ts || (a.step_id < b.step_id ? -1 : a.step_id > b.step_id ? 1 : 0));
  if (new Set(toolEnds.map(value => value.step_id)).size !== toolStarts.length ||
    !events.some(value => value.action === "pi:agent-end" && value.ts >= Math.max(...pairs.map(pair => pair.end_ts)))) invalid();
  const steps: readonly SafeStep[] = frozen(pairs.map(pair => frozen({ step_id: pair.step_id, tool: pair.tool_class,
    action_description: `observed ${pair.tool_class}`, expected_result: `observed-result-${pair.result}`,
    check_fn_ids: frozen([] as string[]), on_failure: "stop" as const, depends_on: frozen([] as string[]) })));
  const script: SafeScript = { task_type: label(t.task_type), description: metadata(t.description),
    preconditions: t.preconditions as readonly string[], postconditions: t.postconditions as readonly string[],
    applicable_to: t.applicable_to as readonly string[], steps: pairs.map((_, index) => `observed-step-${index + 1}`), known_failures: [] };
  const failed = pairs.find(pair => pair.result !== "ok");
  const failure: FailureObservation | undefined = failed === undefined ? undefined : frozen({ failure_id: label(`failure-${hash(canonical({ id, step: failed.step_id })).slice(0, 24)}`),
    run_id: expected.run_id, step_id: failed.step_id, ts: failed.end_ts, stage: "execution", reason_code: "unknown" });
  const raw: ExperienceObservation = { ...expected, experience_id: id, task_type: script.task_type, ts: final.ts, script, steps,
    ...(failure === undefined ? {} : { failure_analysis: failure }) };
  // Reuse the original observation decoder; retain raw FailureObservation rather than its derived analysis fields.
  const validated = observation(raw);
  const safe: ExperienceObservation = frozen({ ...bindingOf(validated), experience_id: validated.experience_id, task_type: validated.task_type,
    ts: validated.ts, script: validated.script, steps: validated.steps, ...(failure === undefined ? {} : { failure_analysis: failure }) });
  return frozen({ mode: "dry-run-trace-draft", authorization: "none", executable: false, current_verification: "not-checked",
    basis: "untrusted-input-shape-only", observation: safe, pairs: frozen(pairs), dependency_basis: "not-inferred",
    trace_digest: hash(canonical({ events: events.slice().sort((a, b) => a.ts - b.ts || (a.action < b.action ? -1 : a.action > b.action ? 1 : a.step_id < b.step_id ? -1 : 1)), observation: safe })) });
}
