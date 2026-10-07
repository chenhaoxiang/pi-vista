import {
  MAX_CONTEXT_CHARACTERS, DEFAULT_CONTEXT_CHARACTERS, MAX_LIST_ITEMS, MAX_STEPS, MAX_SELECTION_ITEMS,
  type ContextOptions, type Correction, type ExperienceObservation, type ExperienceHandle,
  type FailureObservation, type RetrievalQuery, type SafeScript, type SafeStep,
} from "./contract.js";
import { BINDING_KEYS, RETRIEVAL_KEYS, binding, choice, frozen, integer, invalid, label, labels, list, metadata, own, retrievalBinding } from "./data.js";
import { classifyFailure } from "./failure.js";

function script(input: unknown): SafeScript {
  const v = own(input, ["task_type", "description", "preconditions", "steps", "postconditions", "known_failures", "applicable_to"]);
  const failures = list(v.known_failures, MAX_LIST_ITEMS).map(item => {
    const f = own(item, ["symptom", "mitigation"]); return frozen({ symptom: label(f.symptom), mitigation: label(f.mitigation) });
  });
  return frozen({ task_type: label(v.task_type), description: metadata(v.description), preconditions: labels(v.preconditions, MAX_LIST_ITEMS),
    steps: labels(v.steps, MAX_LIST_ITEMS, 1), postconditions: labels(v.postconditions, MAX_LIST_ITEMS), known_failures: frozen(failures),
    applicable_to: labels(v.applicable_to, MAX_LIST_ITEMS) });
}
function steps(input: unknown): readonly SafeStep[] {
  const seen = new Set<string>();
  const out = list(input, MAX_STEPS, 1).map(item => {
    const v = own(item, ["step_id", "tool", "action_description", "check_fn_ids", "expected_result", "on_failure", "depends_on"]);
    const id = label(v.step_id); const dependencies = labels(v.depends_on, MAX_LIST_ITEMS);
    if (seen.has(id) || !dependencies.every(dependency => seen.has(dependency))) invalid(); seen.add(id);
    return frozen({ step_id: id, tool: label(v.tool), action_description: metadata(v.action_description),
      check_fn_ids: labels(v.check_fn_ids, MAX_LIST_ITEMS), expected_result: label(v.expected_result),
      on_failure: choice(v.on_failure, ["stop", "retry_once", "skip", "escalate"]), depends_on: dependencies });
  });
  return frozen(out);
}
export type SnapshotObservation = Omit<ExperienceHandle, "status" | "authorization" | "verification" | "hindsight_doc_id" | "superseded_by" | "historical_origin">;
export function observation(input: ExperienceObservation): SnapshotObservation {
  const required = ["experience_id", ...BINDING_KEYS, "task_type", "ts", "script", "steps"];
  const v = own(input, [...required, "model_id", "failure_analysis"], required);
  const expected = binding(Object.fromEntries(BINDING_KEYS.map(key => [key, v[key]])));
  const safeScript = script(v.script); const safeSteps = steps(v.steps); const task = label(v.task_type);
  if (safeScript.task_type !== task) invalid();
  const failure = v.failure_analysis === undefined ? undefined : classifyFailure(v.failure_analysis as FailureObservation);
  if (failure && (failure.run_id !== expected.run_id || !safeSteps.some(step => step.step_id === failure.step_id))) invalid();
  return frozen({ ...expected, experience_id: label(v.experience_id), task_type: task, ts: integer(v.ts), script: safeScript, steps: safeSteps,
    ...(v.model_id === undefined ? {} : { model_id: label(v.model_id) }), ...(failure === undefined ? {} : { failure_analysis: failure }) });
}
export type SnapshotQuery = RetrievalQuery & { readonly limit: number };
export function query(input: RetrievalQuery): SnapshotQuery {
  const v = own(input, [...RETRIEVAL_KEYS, "task_type", "limit"], [...RETRIEVAL_KEYS, "task_type"]);
  return frozen({ ...retrievalBinding(v), task_type: label(v.task_type), limit: integer(v.limit ?? 8, MAX_SELECTION_ITEMS, 1) });
}
export function contextOptions(input: ContextOptions): Required<ContextOptions> {
  const v = own(input, ["max_characters", "max_items"], []);
  return frozen({ max_characters: integer(v.max_characters ?? DEFAULT_CONTEXT_CHARACTERS, MAX_CONTEXT_CHARACTERS, 128),
    max_items: integer(v.max_items ?? MAX_SELECTION_ITEMS, MAX_SELECTION_ITEMS, 1) });
}
export function correction(input: Correction): Correction {
  const v = own(input, ["failure_id", "prior_claim", "correction_code"]);
  return frozen({ failure_id: label(v.failure_id), prior_claim: label(v.prior_claim), correction_code: label(v.correction_code) });
}
