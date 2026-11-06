import { types } from "node:util";
import { hasKnownCredential } from "@pi-vista/core";
import { snapshotPiWorkBinding } from "@pi-vista/adapter-pi";

// Display facts only. No row/next action is an acceptance or execution request.
export const CODE_PROGRESS_TRIPLES = Object.freeze([
  ["pull-request", "pr_not_ready", "follow_owner_work"],
  ["head-checks", "required_checks_pending", "wait_required_checks"],
  ["head-checks", "required_checks_failed", "inspect_required_checks"],
  ["head-checks", "required_checks_missing", "inspect_required_evidence"],
  ["owner-gate", "owner_delivery_pending", "follow_owner_delivery"],
  ["postmerge-checks", "postmerge_workflows_pending", "wait_postmerge_checks"],
  ["postmerge-checks", "postmerge_workflows_failed", "inspect_postmerge_checks"],
  ["postmerge-checks", "postmerge_workflows_missing", "inspect_required_evidence"],
  ["owner-gate", "owner_gate_unavailable", "inspect_owner_evidence"],
  ["source-delivery", "none", "inspect_result"],
  ["unknown", "source_binding_mismatch", "inspect_binding"],
  ["unknown", "source_original_unavailable", "inspect_originals"],
].map(Object.freeze));
export const CODE_PROGRESS_MAX_BYTES = 5400;
export const CODE_PROGRESS_MAX_ROWS = 16;

function refuse() { throw Error("code-progress-invalid"); }
export function snapshotCodeProgress(value) {
  if (!value || typeof value !== "object" || types.isProxy(value) || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) refuse();
  const keys = ["binding", "repository", "pullRequest", "observedAt", "phase", "waitReason", "nextAction", "authorization", "readOnly", "executable"];
  if (Reflect.ownKeys(value).length !== keys.length) refuse();
  const v = {};
  for (const key of keys) {
    const d = Object.getOwnPropertyDescriptor(value, key);
    if (!d || !Object.hasOwn(d, "value")) refuse();
    v[key] = d.value;
  }
  const binding = snapshotPiWorkBinding(v.binding);
  if (!/^[a-f0-9]{40}$/u.test(binding.headSha ?? "")) refuse();
  if (typeof v.repository !== "string" || v.repository.length > 200 || !/^[A-Za-z0-9_-]+\/[A-Za-z0-9_.-]+$/u.test(v.repository)
    || v.repository.endsWith("/.") || v.repository.endsWith("/..") || hasKnownCredential(v.repository)) refuse();
  if (!Number.isSafeInteger(v.pullRequest) || v.pullRequest < 1 || !Number.isSafeInteger(v.observedAt) || v.observedAt < 0) refuse();
  if (!CODE_PROGRESS_TRIPLES.some(row => row[0] === v.phase && row[1] === v.waitReason && row[2] === v.nextAction)
    || v.authorization !== "none" || v.readOnly !== true || v.executable !== false) refuse();
  return Object.freeze({ ...v, binding });
}

export function codeProgressRow(contract, waitReason, observedAt) {
  const triple = CODE_PROGRESS_TRIPLES.find(row => row[1] === waitReason);
  if (!triple) refuse();
  return snapshotCodeProgress({ binding: contract.binding, repository: contract.repository, pullRequest: contract.pullRequest,
    observedAt, phase: triple[0], waitReason: triple[1], nextAction: triple[2], authorization: "none", readOnly: true, executable: false });
}

/** One display lane, reset by the owning observer's existing epoch lifecycle. */
export function createCodeProgressWindow(initialCoverage = "not-observed") {
  let seq = 0, coverage = initialCoverage, observations = [], omitted = 0;
  const snapshot = () => Object.freeze({ version: 1, source: "explicit-code-owner", seq, coverage, observations: Object.freeze([...observations]), omitted });
  function compact() {
    while (observations.length > CODE_PROGRESS_MAX_ROWS || Buffer.byteLength(JSON.stringify(snapshot()), "utf8") > CODE_PROGRESS_MAX_BYTES) {
      if (!observations.length) refuse();
      observations.shift(); omitted++;
    }
  }
  return Object.freeze({
    snapshot,
    reset(state) { seq = 0; coverage = state; observations = []; omitted = 0; },
    close() { seq++; coverage = "unavailable"; observations = []; omitted = 0; },
    unavailable() { seq++; coverage = "unavailable"; compact(); },
    append(value) {
      const observation = snapshotCodeProgress(value);
      if (!Number.isSafeInteger(seq + 1)) return false;
      const row = Object.freeze({ seq: seq + 1, ...observation });
      // A single bounded row must fit; refuse rather than truncating its identity.
      const one = { version: 1, source: "explicit-code-owner", seq: seq + 1, coverage: "observed", observations: [row], omitted };
      if (Buffer.byteLength(JSON.stringify(one), "utf8") > CODE_PROGRESS_MAX_BYTES) return false;
      seq++; coverage = "observed"; observations.push(row);
      compact();
      return true;
    },
  });
}
