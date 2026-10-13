import { types } from "node:util";
import { createLocalLearningLibrary } from "@pi-vista/learning/local";
import { isLocalEvidenceVerifier } from "@pi-vista/evidence/host";
import { buildK1HistoryContext } from "./stage6-k1-history-context.mjs";
import { PAIR_SOURCE_SHA, PAIR_HISTORY_DIGEST } from "./paired-evaluation-data.mjs";

const refuse = () => { throw Error("stage6-k1-history-host-refused"); };
function own(value, keys) {
  if (types.isProxy(value) || value === null || typeof value !== "object" || Array.isArray(value) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(value)) || Reflect.ownKeys(value).length !== keys.length) refuse();
  const safe = Object.create(null);
  for (const key of keys) {
    const p = Object.getOwnPropertyDescriptor(value, key);
    if (!p || !Object.hasOwn(p, "value") || p.value === undefined) refuse();
    safe[key] = p.value;
  }
  return safe;
}
const bindingKeys = ["run_id", "repo", "source_sha", "policy_version", "env_fingerprint"];
const referenceKeys = ["bank", "document_id", "current_verification", "authorization", "executable", "content_digest", "idempotency_key"];
const blocked = async () => { throw Error("stage6-k1-history-write-refused"); };
const issued = new WeakSet();
export function isK1PreparedHistory(value) { return value !== null && typeof value === "object" && issued.has(value); }

/** Explicit trusted host only. Re-read through a new LOCAL factory, import with
 * new identities, collect genuinely current local proof, then compile one item.
 * The returned raw history/context stay private host values, not protocol DTOs.
 * No stored proof/handle/plan is accepted and no retain/query/reconcile is called.
 */
export async function prepareK1ActualHistory(input) {
  let library, verifier, expected, proof, verified;
  try {
    const value = own(input, ["reference", "scope", "verifier", "read", "binding", "experience_id", "now"]);
    if (!isLocalEvidenceVerifier(value.verifier) || typeof value.read !== "function" || types.isProxy(value.read) ||
        typeof value.now !== "function" || types.isProxy(value.now)) refuse();
    const reference = own(value.reference, referenceKeys);
    if (reference.content_digest !== PAIR_HISTORY_DIGEST || reference.current_verification !== "not-checked" ||
        reference.authorization !== "none" || reference.executable !== false) refuse();
    expected = Object.freeze(own(value.binding, bindingKeys));
    if (expected.source_sha !== PAIR_SOURCE_SHA) refuse();
    verifier = value.verifier;
    library = createLocalLearningLibrary({ mode: "local-learning", scope: value.scope, verifier,
      store: { read: value.read, retain: blocked, query: blocked, reconcile: blocked } });
    const history = await library.readGuidance(Object.freeze(reference));
    if (history.content_digest !== PAIR_HISTORY_DIGEST || history.guidance.experience.source_sha !== PAIR_SOURCE_SHA) refuse();
    const observed = library.importGuidance(history, { ...expected, experience_id: value.experience_id, ts: value.now() });
    if (observed.status !== "observed" || observed.verification !== undefined) refuse();
    const candidate = library.nominate(observed);
    proof = await verifier.verify(expected, { gate: "gate", test: "test", guard: "guard" });
    if (!verifier.isCurrent(proof, expected) || verifier.isCurrent(JSON.parse(JSON.stringify(proof)), expected)) refuse();
    verified = library.verifyCandidate(candidate, proof);
    const query = { repo: expected.repo, source_sha: expected.source_sha, policy_version: expected.policy_version,
      env_fingerprint: expected.env_fingerprint, task_type: history.guidance.experience.task_type, limit: 1 };
    const selection = library.retrieve([verified], query);
    const compiled = library.compileContext(selection, { max_items: 1, max_characters: 8192 });
    const metadata = buildK1HistoryContext({ history, context: compiled });
    let live = true;
    function current() { return live && verifier.isCurrent(proof, expected); }
    function retire() { if (!live) return; live = false; library.shutdown(); }
    const prepared = Object.freeze({
      history, compiled_context: compiled, history_context: metadata,
      summary: Object.freeze({ schema: "stage6-k1-history-preparation/1", history_digest: history.content_digest,
        subject_source_sha: expected.source_sha, context_digest: metadata.context_digest, character_count: compiled.character_count,
        item_count: compiled.item_count, guidance_reimported: true, guidance_currently_verified: current(),
        historical_current_verification: "not-checked", proof_portable: false,
        observation_count: proof.observations.length, expires_at: Math.min(...proof.observations.map(o => o.expires_at)),
        scope: value.scope, authorization: "none", executable: false }),
      isCurrent: current,
      check() { if (!current()) refuse(); library.compileContext(selection, { max_items: 1, max_characters: 8192 }); },
      shutdown: retire,
    });
    issued.add(prepared); return prepared;
  } catch {
    library?.shutdown();
    throw Error("stage6-k1-history-host-refused");
  }
}
