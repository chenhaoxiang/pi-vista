import { createHash } from "node:crypto";
import { isAbsolute, normalize } from "node:path";
import { types } from "node:util";
import { profileSnapshot as captureCanaryProfile, constrainStream } from "./pi-agent-canary-support.mjs";
import { admitStage6Run, createAdmissionRequestBudget, profileSnapshot, snapshotStage6Context } from "./stage6-admission.mjs";

const digest = value => createHash("sha256").update(JSON.stringify(value)).digest("hex");

/** Explicit readonly stat collection. No credential bytes, profile writes, SDK or model calls. */
export async function captureStage6Profile(directory) {
  if (typeof directory !== "string" || !isAbsolute(directory) || normalize(directory) !== directory || directory.includes("\0")) throw new Error("stage6-profile-unavailable");
  try {
    const native = await captureCanaryProfile(directory);
    const root = native["."];
    return profileSnapshot({
      protected: { auth: digest(native["auth.json"]), models: digest(native["models.json"]),
        settings: native["settings.json"] === null ? null : digest(native["settings.json"]),
        root_identity: digest([root[0], root[1], root[3], root[4]]) },
      volatile: { root_metadata: digest(root), catalog_metadata: native["models-store.json"] === null ? null : digest(native["models-store.json"]) },
    });
  } catch { throw new Error("stage6-profile-unavailable"); }
}

/** Capture both sides in one explicit host call, then return metadata-only admission.
 * This is intentionally not called by the planner or by a Pi extension.
 */
export async function collectStage6Admission(input) {
  if (!input || typeof input !== "object" || Array.isArray(input) || types.isProxy(input) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(input)) || Reflect.ownKeys(input).length !== 4) throw new Error("stage6-collection-refused");
  const values = {};
  for (const key of ["profileDirectory", "context", "expected", "model_calls"]) {
    const p = Object.getOwnPropertyDescriptor(input, key);
    if (!p || !Object.hasOwn(p, "value") || p.value === undefined) throw new Error("stage6-collection-refused");
    values[key] = p.value;
  }
  if (!Number.isSafeInteger(values.model_calls) || values.model_calls < 0) throw new Error("stage6-collection-refused");
  const context = snapshotStage6Context(values.context), expected = snapshotStage6Context(values.expected);
  const before = await captureStage6Profile(values.profileDirectory);
  const after = await captureStage6Profile(values.profileDirectory);
  return admitStage6Run({ ...context, profile_before: before, profile_after: after, model_calls: values.model_calls }, expected);
}

/** Reuse the proven canary pretransport seam with a mandatory shared pilot budget.
 * This does not call a model. The host still owns SDK/source/history provenance,
 * the shared budget's identity and the final request-envelope guard.
 */
export function bindStage6Stream(session, admission, sharedBudget, { maxPerSession = 2, requestGuard } = {}) {
  // Validate the genuine admission before reading the caller's stream/session.
  const admissionBudget = createAdmissionRequestBudget(admission, 16);
  if (!Number.isSafeInteger(maxPerSession) || maxPerSession < 1 || maxPerSession > 2 ||
      sharedBudget === null || typeof sharedBudget !== "object" || types.isProxy(sharedBudget) ||
      typeof sharedBudget.take !== "function" || requestGuard !== undefined && typeof requestGuard !== "function") throw new Error("stage6-stream-binding-refused");
  const agent = session?.agent;
  if (!agent || typeof agent.streamFunction !== "function") throw new Error("stage6-stream-binding-refused");
  const original = agent.streamFunction;
  let sessionAttempts = 0, live = true;
  const state = constrainStream(session, { take(model, thinking) {
    if (!live) throw new Error("stage6-stream-withdrawn");
    if (model.provider !== admission.provider || model.id !== admission.model || thinking !== admission.thinking) throw new Error("stage6-model-binding-mismatch");
    if (sessionAttempts >= maxPerSession) throw new Error("stage6-session-budget-exhausted");
    sharedBudget.take(model, thinking); admissionBudget.take(); sessionAttempts++;
  } }, requestGuard);
  const wrapped = agent.streamFunction;
  return Object.freeze({
    status: () => Object.freeze({ session_attempts: sessionAttempts, admission_attempts: admissionBudget.requests,
      active: live, authorization: "none", executable: false }),
    requestSignalAborted: state.requestSignalAborted,
    shutdown() { if (!live) return; live = false; if (agent.streamFunction === wrapped) agent.streamFunction = original; },
  });
}
