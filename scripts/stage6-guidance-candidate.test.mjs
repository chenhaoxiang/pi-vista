import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { prepareHistoricalGuidance } from "@pi-vista/learning/guidance";
import { proposeStage6GuidanceCandidate } from "./stage6-guidance-candidate.mjs";
import { workflowObservation } from "./local-learning-workflow.mjs";
import { PAIR_SOURCE_SHA } from "./paired-evaluation-data.mjs";
const sha = x => createHash("sha256").update(x).digest("hex");
const canonical = x => x !== null && typeof x === "object" ? Array.isArray(x) ? `[${x.map(canonical).join(",")}]` : `{${Object.keys(x).sort().map(k => `${JSON.stringify(k)}:${canonical(x[k])}`).join(",")}}` : JSON.stringify(x);
const header = "authorization=none\nexecutable=false\nmode=local-script-step-context\nbudget=characters-not-tokens\n";
function fixture() {
  const env = sha("environment"), experience = workflowObservation(PAIR_SOURCE_SHA, "workflow-01a11fcc-actual", env), document = prepareHistoricalGuidance(experience), bank = "fixture-bank", key = `guidance-${sha(canonical({ bank, document }))}`;
  const history = { bank, document_id: `vista-guidance-v1-${"b".repeat(16)}-${sha(key)}`, current_verification: "not-checked", authorization: "none", executable: false, content_digest: document.content_digest, idempotency_key: key, document, guidance: JSON.parse(document.content) };
  const p = { run_id: "current-run", repo: "pi-vista", source_sha: PAIR_SOURCE_SHA, policy_version: experience.policy_version, env_fingerprint: env, experience_id: "current-experience", status: "verified", scope: "fixture", observation_digests: [sha("observation")] };
  const compiled = { mode: "local-script-step-context", authorization: "none", executable: false, budget_unit: "characters", max_characters: 8192, item_count: 1, selected_ids: ["current-experience"], omitted_ids: [], provenance: [p] };
  compiled.content = `${header}${canonical({ authorization: "none", executable: false, provenance: p, script: experience.script, steps: experience.steps })}\n`; compiled.character_count = compiled.content.length;
  return { history, context: compiled };
}
test("offline candidate keeps complete sections, digests only and never returns executable content", () => {
  const f = fixture(), result = proposeStage6GuidanceCandidate({ ...f, task_type: "metadata-validation", max_characters: 8192 });
  assert.equal(result.status, "candidate"); assert.equal(result.task_match, true); assert.equal(result.history_digest, f.history.content_digest); assert.equal(result.source_sha, PAIR_SOURCE_SHA);
  assert.equal(Object.hasOwn(result, "content"), false); assert.equal(result.token_count, null); assert.equal(result.authorization, "none"); assert.equal(result.executable, false);
  assert.deepEqual(result.included_sections, ["script", "steps"]); assert.deepEqual(result.omitted_sections, []);
});
test("tight character budget refuses partial guidance instead of truncating or claiming ROI", () => {
  const f = fixture(), result = proposeStage6GuidanceCandidate({ ...f, task_type: "metadata-validation", max_characters: 128 });
  assert.equal(result.status, "budget-exhausted"); assert.equal(result.candidate_characters, null); assert.equal(result.character_delta, null); assert.deepEqual(result.included_sections, []); assert.ok(result.omitted_sections.length > 0); assert.equal(result.economic_roi, "not-established");
});
test("unrelated task and hostile DTO fields refuse/avoid association", () => {
  const f = fixture(); assert.equal(proposeStage6GuidanceCandidate({ ...f, task_type: "other-task", max_characters: 8192 }).status, "not-applicable");
  assert.throws(() => proposeStage6GuidanceCandidate({ ...f, raw: "PRIVATE", task_type: "metadata-validation", max_characters: 8192 }), /stage6-guidance-candidate-refused/);
  let calls = 0; const proxy = new Proxy(f.history, { ownKeys() { calls++; throw Error(); } }); assert.throws(() => proposeStage6GuidanceCandidate({ history: proxy, context: f.context, task_type: "metadata-validation", max_characters: 8192 })); assert.equal(calls, 0);
});
test("candidate module import is inert and has no model/bank/network dependency", async () => {
  const source = await (await import("node:fs/promises")).readFile(new URL("./stage6-guidance-candidate.mjs", import.meta.url), "utf8"); assert.doesNotMatch(source, /from ["'](?:node:fs|node:http|node:https|node:child_process)/u); assert.doesNotMatch(source, /import\s*\(/u);
});
