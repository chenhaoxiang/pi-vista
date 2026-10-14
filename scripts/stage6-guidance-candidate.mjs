import { createHash } from "node:crypto";
import { types } from "node:util";
import { buildK1HistoryContext } from "./stage6-k1-history-context.mjs";

const HEADER = "Historical observed guidance only. authorization=none; executable=false; current-verification=not-checked.\n";
const reject = () => { throw Error("stage6-guidance-candidate-refused"); };
function canonical(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  return Array.isArray(value) ? `[${value.map(canonical).join(",")}]` : `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonical(value[k])}`).join(",")}}`;
}
function own(value, keys) {
  if (types.isProxy(value) || !value || typeof value !== "object" || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value)) || Reflect.ownKeys(value).length !== keys.length) reject();
  const out = Object.create(null);
  for (const key of keys) { const p = Object.getOwnPropertyDescriptor(value, key); if (!p || !Object.hasOwn(p, "value") || p.value === undefined) reject(); out[key] = p.value; }
  return out;
}
/** Offline text proposal only, NOT LocalCompiledContext or opaque selection.
 * Exact history/context association is checked by the existing public bridge.
 * Whole semantic sections are selected, never silently substring-truncated.
 * No store, model, default Pi, permission or current proof is constructed.
 */
export function proposeStage6GuidanceCandidate(input) {
  try {
    const v = own(input, ["history", "context", "task_type", "max_characters"]);
    if (typeof v.task_type !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(v.task_type) ||
        !Number.isSafeInteger(v.max_characters) || v.max_characters < 128 || v.max_characters > 8192) reject();
    const association = buildK1HistoryContext({ history: v.history, context: v.context });
    // Parse only the canonical validated document, never re-read original objects.
    const e = JSON.parse(v.history.document.content).experience;
    const matching = e.task_type === v.task_type || e.script.applicable_to.includes(v.task_type);
    const sections = [["script", `Script: ${canonical(e.script)}\n`], ["steps", `Steps: ${canonical(e.steps)}\n`]];
    const included = [], omitted = []; let content = matching ? HEADER : "";
    if (matching) for (const [name, text] of sections) {
      if (!text) continue;
      if (content.length + text.length > v.max_characters) omitted.push(name);
      else { content += text; included.push(name); }
    }
    // Never propose a partial instruction bundle (preconditions/dependencies/
    // on-failure semantics all remain inside the unchanged script+steps).
    const status = !matching ? "not-applicable" : omitted.length || included.length !== sections.length ? "budget-exhausted" : "candidate";
    if (status !== "candidate") { content = ""; included.length = 0; }
    return Object.freeze({ schema: "stage6-guidance-candidate/1", mode: "offline-proposal", status,
      task_match: matching, history_digest: association.content_digest, original_context_digest: association.context_digest,
      source_sha: association.subject_source_sha, original_characters: association.character_count,
      candidate_characters: content.length, character_delta: content.length - association.character_count,
      content_digest: createHash("sha256").update(content).digest("hex"),
      section_digests: Object.freeze(Object.fromEntries(sections.filter(([name, text]) => included.includes(name)).map(([name, text]) => [name, createHash("sha256").update(text).digest("hex")]))),
      included_sections: Object.freeze(included), omitted_sections: Object.freeze(omitted),
      token_count: null, token_claim: "not-measured", economic_roi: "not-established",
      current_verification: "not-checked", authorization: "none", executable: false });
  } catch { throw Error("stage6-guidance-candidate-refused"); }
}
