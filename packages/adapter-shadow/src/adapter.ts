import { isDeepStrictEqual, types as utilTypes } from "node:util";
import {
  emitVistaEvent,
  hasKnownCredential,
  isSafeSegment,
  redactAll,
  VistaProtocolError,
  type VistaEvent,
  type VistaEventInput,
  type VistaResult,
} from "@pi-vista/core";
import { isVistaStepIdForRun } from "@pi-vista/core/validation";
import type { ArtifactRef, VistaComponent } from "@pi-vista/protocol";
import type {
  ShadowAssetEvidence,
  ShadowCorrelation,
  ShadowEmitOptions,
  ShadowEvent,
  ShadowEventInput,
  ShadowObservation,
  ShadowModelFamily,
  ShadowRowEvidence,
} from "./types.js";

const OBSERVATION_FIELDS = new Set([
  "schema", "shadow", "model_family", "model_id", "model_version", "verdict", "status", "context_status",
  "correlation", "request", "vote", "vote_ref", "reason_code", "confidence", "row_evidence", "asset_evidence",
  "humanExpectationWritten", "trainingEligible", "promotionEligible",
]);
const CORRELATION_FIELDS = new Set([
  "run_id", "step_id", "source_sha", "request_id", "pair_id", "shared_input_hash", "fingerprint", "policy_version",
]);
const ROW_FIELDS = new Set([
  "sample_id", "row_sha256", "input_sha256", "packet_sha256", "contract_map_sha256",
  "ownerReviewCandidate", "ownerAdjudicationRequired", "forcedAbstain",
]);
const ASSET_FIELDS = new Set([
  "scope", "verified", "realInputIsolationProven", "asset_ref", "asset_sha256", "receipt_ref", "receipt_sha256",
  "isolation_ref", "isolation_sha256", "license_mode",
]);
const OPTION_FIELDS = new Set(["store", "baseDir", "runId", "stepId", "seq", "now", "clock", "persistTimeoutMs"]);
const APPEND_FIELDS = new Set(["append"]);
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;
const REF_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,255}$/u;
const LABEL_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:@+-]{0,63}$/u;
const SHA_PATTERN = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/iu;
const DIGEST_PATTERN = /^[a-f0-9]{64}$/iu;
const CREDENTIAL_LABEL_PATTERN = /(?:^|[./_:@+-])(?:secret|token|bearer|password|passwd|api[_-]?key|access[_-]?key|auth|credential|cookie|private[_-]?key|ssh[_-]?key)(?:$|[./_:@+-])/iu;
const COMPONENTS: Readonly<Record<ShadowModelFamily, VistaComponent>> = {
  laya: "laya", kev: "kev", intern: "custom:shadow/intern", startlux: "custom:shadow/startlux",
};
const KNOWN_MODEL_FAMILIES: Readonly<Record<string, ShadowModelFamily>> = {
  "laya-421m": "laya", "kev-4b": "kev", "intern-decision-4b": "intern", "startlux-decision-4b": "startlux",
};

type Snapshot = Readonly<Record<string, unknown>>;

/** Private normalized records never regain Object.prototype optional fields. */
function ownRecord<T extends object>(data: T): T {
  return Object.assign(Object.create(null) as T, data);
}
function setOwn(target: object, key: string, value: unknown): void {
  Object.defineProperty(target, key, { value, enumerable: true, writable: true, configurable: true });
}

function invalid(): never {
  // One fixed error for all schemas/options; no field names, values or raw errors escape.
  throw new VistaProtocolError("invalid normalized shadow observation or emission options");
}

/** Only inspect own descriptors after rejecting Proxies, including revoked ones. */
function snapshot(value: unknown, fields: ReadonlySet<string>): Snapshot {
  if (value === null || typeof value !== "object" || utilTypes.isProxy(value) || Array.isArray(value)) invalid();
  const prototype: unknown = Object.getPrototypeOf(value);
  if (prototype !== null && prototype !== Object.prototype) invalid();
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const key of Reflect.ownKeys(descriptors)) {
    if (typeof key !== "string" || !fields.has(key)) invalid();
    const descriptor = descriptors[key];
    if (descriptor === undefined || !Object.hasOwn(descriptor, "value") || descriptor.value === undefined) invalid();
    result[key] = descriptor.value;
  }
  return Object.freeze(result);
}

function safeString(value: unknown, pattern: RegExp, coreKey: string): string {
  if (typeof value !== "string" || !pattern.test(value) || hasKnownCredential(value) || CREDENTIAL_LABEL_PATTERN.test(value)) invalid();
  // Public shared redaction is a check, never a repair. An opaque ref also must
  // pass action redaction so a bare command is not accepted as an evidence ID.
  if (redactAll({ [coreKey]: value })[coreKey] !== value || redactAll({ action: value }).action !== value) invalid();
  return value;
}

function identifier(value: unknown): string {
  const result = safeString(value, ID_PATTERN, "run_id");
  if (!isSafeSegment(result)) invalid();
  return result;
}

function label(value: unknown): string {
  return safeString(value, LABEL_PATTERN, "reason_code");
}

function ref(value: unknown): string {
  const result = safeString(value, REF_PATTERN, "ref");
  if (!isSafeSegment(result)) invalid();
  return result;
}

function digest(value: unknown, source = false): string {
  if (typeof value !== "string" || !(source ? SHA_PATTERN : DIGEST_PATTERN).test(value)) invalid();
  return value;
}

function boolean(value: unknown): boolean {
  if (typeof value !== "boolean") invalid();
  return value;
}

function literal<T extends string>(value: unknown, allowed: readonly T[]): T {
  if (typeof value !== "string" || !allowed.includes(value as T)) invalid();
  return value as T;
}

function correlation(value: unknown): ShadowCorrelation {
  const data = snapshot(value, CORRELATION_FIELDS);
  const result: { run_id: string } & Record<string, string> = ownRecord({ run_id: identifier(data.run_id) });
  for (const key of ["step_id", "request_id", "pair_id"] as const) {
    if (Object.hasOwn(data, key)) result[key] = identifier(data[key]);
  }
  if (result.step_id !== undefined && !isVistaStepIdForRun(result.run_id, result.step_id)) invalid();
  if (Object.hasOwn(data, "source_sha")) result.source_sha = digest(data.source_sha, true);
  for (const key of ["shared_input_hash", "fingerprint"] as const) {
    if (Object.hasOwn(data, key)) result[key] = digest(data[key]);
  }
  if (Object.hasOwn(data, "policy_version")) result.policy_version = label(data.policy_version);
  return Object.freeze(result);
}

function assertCorrelation(expected: ShadowCorrelation, supplied: ShadowCorrelation): void {
  for (const key of Object.keys(supplied) as (keyof ShadowCorrelation)[]) {
    const actual = supplied[key];
    const wanted = expected[key];
    if (wanted === undefined || actual === undefined) invalid();
    const hash = key === "source_sha" || key === "shared_input_hash" || key === "fingerprint";
    if (hash ? wanted.toLowerCase() !== actual.toLowerCase() : wanted !== actual) invalid();
  }
}

function rowEvidence(value: unknown): ShadowRowEvidence {
  const data = snapshot(value, ROW_FIELDS);
  if (data.ownerAdjudicationRequired !== true) invalid();
  const result: ShadowRowEvidence = ownRecord({
    sample_id: identifier(data.sample_id),
    row_sha256: digest(data.row_sha256),
    ownerReviewCandidate: boolean(data.ownerReviewCandidate),
    ownerAdjudicationRequired: true,
    forcedAbstain: boolean(data.forcedAbstain),
    ...(Object.hasOwn(data, "input_sha256") ? { input_sha256: digest(data.input_sha256) } : {}),
    ...(Object.hasOwn(data, "packet_sha256") ? { packet_sha256: digest(data.packet_sha256) } : {}),
    ...(Object.hasOwn(data, "contract_map_sha256") ? { contract_map_sha256: digest(data.contract_map_sha256) } : {}),
  });
  return Object.freeze(result);
}

function assetEvidence(value: unknown): ShadowAssetEvidence {
  const data = snapshot(value, ASSET_FIELDS);
  if (data.verified !== false || data.realInputIsolationProven !== false) invalid();
  const result: Record<string, unknown> = ownRecord({
    scope: literal(data.scope, ["synthetic", "offline", "unknown"]),
    verified: false,
    realInputIsolationProven: false,
  });
  for (const prefix of ["asset", "receipt", "isolation"] as const) {
    const refKey = `${prefix}_ref` as const;
    const shaKey = `${prefix}_sha256` as const;
    if (Object.hasOwn(data, refKey)) result[refKey] = ref(data[refKey]);
    if (Object.hasOwn(data, shaKey)) {
      if (!Object.hasOwn(data, refKey)) invalid();
      result[shaKey] = digest(data[shaKey]);
    }
  }
  if (!Object.hasOwn(data, "asset_ref") && !Object.hasOwn(data, "receipt_ref") && !Object.hasOwn(data, "isolation_ref")) invalid();
  if (Object.hasOwn(data, "license_mode")) {
    result.license_mode = literal(data.license_mode, ["local-shadow", "non-commercial-research-shadow", "unknown"]);
  }
  return Object.freeze(result) as unknown as ShadowAssetEvidence;
}

function normalize(observation: unknown): ShadowObservation {
  const data = snapshot(observation, OBSERVATION_FIELDS);
  if (data.schema !== "shadow-observation/1" || data.shadow !== true ||
      data.humanExpectationWritten !== false || data.trainingEligible !== false || data.promotionEligible !== false) invalid();
  const modelFamily = literal(data.model_family, ["laya", "kev", "intern", "startlux"]);
  const modelId = safeString(data.model_id, ID_PATTERN, "model_id");
  if (!isSafeSegment(modelId) ||
      (Object.hasOwn(KNOWN_MODEL_FAMILIES, modelId) && KNOWN_MODEL_FAMILIES[modelId] !== modelFamily)) invalid();
  if ((modelFamily === "intern" && modelId !== "intern-decision-4b") ||
      (modelFamily === "startlux" && modelId !== "startlux-decision-4b")) invalid();
  const binding = correlation(data.correlation);
  const result: Record<string, unknown> = ownRecord({
    schema: "shadow-observation/1", shadow: true, model_family: modelFamily, model_id: modelId,
    model_version: label(data.model_version),
    verdict: literal(data.verdict, ["allow", "pass", "deny", "veto", "abstain", "uncertain", "unknown"]),
    status: literal(data.status, ["observed", "timeout", "unavailable", "disagreement", "missing-context", "invalid-evidence", "unknown"]),
    context_status: literal(data.context_status, ["complete", "missing", "redacted", "truncated", "unknown"]),
    correlation: binding, humanExpectationWritten: false, trainingEligible: false, promotionEligible: false,
  });
  for (const key of ["request", "vote"] as const) {
    if (Object.hasOwn(data, key)) {
      const supplied = correlation(data[key]);
      assertCorrelation(binding, supplied);
      result[key] = supplied;
    }
  }
  if (Object.hasOwn(data, "vote_ref")) result.vote_ref = ref(data.vote_ref);
  if (Object.hasOwn(data, "reason_code")) result.reason_code = label(data.reason_code);
  if (Object.hasOwn(data, "confidence")) {
    const confidence = data.confidence;
    if (typeof confidence !== "number" || !Number.isFinite(confidence) || confidence < 0 || confidence > 1) invalid();
    result.confidence = confidence;
  }
  if (Object.hasOwn(data, "row_evidence")) {
    if (modelFamily !== "laya") invalid();
    result.row_evidence = rowEvidence(data.row_evidence);
  }
  if (Object.hasOwn(data, "asset_evidence")) result.asset_evidence = assetEvidence(data.asset_evidence);
  return Object.freeze(result) as unknown as ShadowObservation;
}

function observedResult(observation: ShadowObservation): VistaResult {
  // Negative owner outcomes survive missing context/status/row abstention.
  if (observation.verdict === "deny" || observation.verdict === "veto") return "blocked";
  if (observation.verdict === "abstain" || observation.row_evidence?.forcedAbstain === true ||
      observation.status === "disagreement" || observation.status === "missing-context" ||
      ["missing", "redacted", "truncated"].includes(observation.context_status)) return "abstain";
  // allow/pass, confidence and receipt/candidate existence never produce ok.
  return "unknown";
}

function removeUndefined(record: object): void {
  for (const key of Object.keys(record)) {
    const descriptor = Object.getOwnPropertyDescriptor(record, key);
    if (descriptor !== undefined && Object.hasOwn(descriptor, "value") && descriptor.value === undefined && descriptor.configurable) Reflect.deleteProperty(record, key);
  }
}
function freezeEvent<T extends VistaEventInput>(event: T): T {
  // Core handoff shadows omitted optionals; do not expose or persist added undefined fields.
  removeUndefined(event);
  const artifacts = Object.hasOwn(event, "artifact_refs") ? event.artifact_refs : undefined;
  for (const artifact of artifacts ?? []) {
    removeUndefined(artifact);
    if (Object.hasOwn(artifact, "stats") && artifact.stats !== undefined) Object.freeze(artifact.stats);
    Object.freeze(artifact);
  }
  if (artifacts !== undefined) Object.freeze(artifacts);
  return Object.freeze(event);
}

function coreInput(event: VistaEventInput): VistaEventInput {
  // The unchanged core creates ordinary records and reads known optional fields.
  // Explicit own undefined entries prevent its reads from filling ambient data.
  const input = ownRecord({ ...event });
  for (const key of ["step_id", "ts", "vista_version", "session_id", "trace_id", "repo", "source_sha",
    "worktree_id", "branch", "target_class", "policy_version", "layer", "reason_code", "env_fingerprint", "model_id"] as const) {
    if (!Object.hasOwn(input, key)) setOwn(input, key, undefined);
  }
  input.artifact_refs = event.artifact_refs!.map(artifact => {
    const copy = ownRecord({ ...artifact });
    for (const key of ["sha", "verified", "stats"] as const) if (!Object.hasOwn(copy, key)) setOwn(copy, key, undefined);
    return copy;
  });
  return input;
}

function project(observation: ShadowObservation): VistaEventInput {
  const binding = observation.correlation;
  // Core reserves raw model/input/authorization keys even in stats. Use its
  // bounded metadata vocabulary and typed digest refs, never relax redaction.
  // ArtifactRef.sha is source binding, not an artifact-content digest.
  const stats: Record<string, number | string> = {
    family: observation.model_family, revision: observation.model_version,
    owner_verdict: observation.verdict, owner_status: observation.status, context_status: observation.context_status,
    shadow: 1, safety_role: "observation-only", humanExpectationWritten: 0, trainingEligible: 0, promotionEligible: 0,
  };
  if (observation.confidence !== undefined) setOwn(stats, "confidence", observation.confidence);
  if (binding.fingerprint !== undefined) setOwn(stats, "fingerprint", binding.fingerprint);
  const artifacts: ArtifactRef[] = [{ type: "shadow_metadata", ref: "shadow-observation", stats }];
  if (binding.request_id !== undefined) artifacts.push({ type: "shadow_request", ref: binding.request_id });
  if (binding.pair_id !== undefined) artifacts.push({ type: "shadow_pair", ref: binding.pair_id });
  if (observation.vote_ref !== undefined) artifacts.push({ type: "shadow_vote", ref: observation.vote_ref });
  if (binding.shared_input_hash !== undefined) {
    artifacts.push({ type: "shadow_shared_input", ref: "shadow-shared-input", stats: { digest_sha256: binding.shared_input_hash } });
  }
  if (observation.row_evidence !== undefined) {
    const row = observation.row_evidence;
    const rowStats: Record<string, number | string> = {
      digest_sha256: row.row_sha256, ownerReviewCandidate: row.ownerReviewCandidate ? 1 : 0,
      ownerAdjudicationRequired: 1, forcedAbstain: row.forcedAbstain ? 1 : 0,
    };
    for (const key of ["packet_sha256", "contract_map_sha256"] as const) {
      if (row[key] !== undefined) setOwn(rowStats, key, row[key]);
    }
    artifacts.push({ type: "shadow_row_evidence", ref: row.sample_id, stats: rowStats });
    if (row.input_sha256 !== undefined) {
      artifacts.push({ type: "shadow_row_input", ref: row.sample_id, stats: { digest_sha256: row.input_sha256 } });
    }
  }
  if (observation.asset_evidence !== undefined) {
    const asset = observation.asset_evidence;
    for (const prefix of ["asset", "receipt", "isolation"] as const) {
      const assetRef = asset[`${prefix}_ref`];
      const assetSha = asset[`${prefix}_sha256`];
      if (assetRef !== undefined) {
        const assetStats: Record<string, number | string> = { scope: asset.scope, isolation_proof: "none" };
        if (assetSha !== undefined) setOwn(assetStats, "digest_sha256", assetSha);
        if (asset.license_mode !== undefined) setOwn(assetStats, "license_mode", asset.license_mode);
        artifacts.push({ type: `shadow_${prefix}`, ref: assetRef, stats: assetStats });
      }
    }
  }
  const event: VistaEventInput = {
    component: COMPONENTS[observation.model_family], action: `shadow:${observation.model_family}:observe`,
    result: observedResult(observation), run_id: binding.run_id, model_id: observation.model_id, artifact_refs: artifacts,
  };
  if (binding.step_id !== undefined) setOwn(event, "step_id", binding.step_id);
  if (binding.source_sha !== undefined) setOwn(event, "source_sha", binding.source_sha);
  if (binding.policy_version !== undefined) setOwn(event, "policy_version", binding.policy_version);
  const traceId = binding.pair_id ?? binding.request_id;
  if (traceId !== undefined) setOwn(event, "trace_id", traceId);
  if (observation.reason_code !== undefined) setOwn(event, "reason_code", observation.reason_code);
  if (!isDeepStrictEqual(redactAll(event), event)) invalid();
  return freezeEvent(event);
}

function isCallback(value: unknown): value is (...args: unknown[]) => unknown {
  return typeof value === "function" && !utilTypes.isProxy(value);
}

function emissionOptions(value: unknown, event: VistaEventInput): ShadowEmitOptions {
  const data: Snapshot = value === undefined ? Object.freeze(ownRecord({})) : snapshot(value, OPTION_FIELDS);
  const result: Record<string, unknown> = ownRecord({ runId: event.run_id });
  if (Object.hasOwn(data, "runId")) {
    if (identifier(data.runId) !== event.run_id) invalid();
  }
  if (Object.hasOwn(data, "stepId")) {
    const stepId = identifier(data.stepId);
    if (!isVistaStepIdForRun(event.run_id, stepId) || (Object.hasOwn(event, "step_id") && event.step_id !== stepId)) invalid();
    result.stepId = stepId;
  }
  if (Object.hasOwn(data, "seq")) {
    if (typeof data.seq !== "number" || !Number.isSafeInteger(data.seq) || data.seq < 0) invalid();
    result.seq = data.seq;
  }
  if (Object.hasOwn(data, "baseDir")) {
    if (typeof data.baseDir !== "string" || data.baseDir.length === 0 || data.baseDir.length > 4096 || /[\p{Cc}\p{Cf}]/u.test(data.baseDir)) invalid();
    result.baseDir = data.baseDir;
  }
  if (Object.hasOwn(data, "persistTimeoutMs")) {
    if (typeof data.persistTimeoutMs !== "number" || !Number.isFinite(data.persistTimeoutMs) || data.persistTimeoutMs < 0 || data.persistTimeoutMs > 2_147_483_647) invalid();
    result.persistTimeoutMs = data.persistTimeoutMs;
  }
  for (const key of ["clock", "now"] as const) {
    if (!Object.hasOwn(data, key)) continue;
    const callback = data[key];
    if (key === "now" && typeof callback === "number" && Number.isFinite(callback)) result[key] = callback;
    else if (isCallback(callback)) result[key] = callback;
    else invalid();
  }
  if (Object.hasOwn(data, "store")) {
    const store = snapshot(data.store, APPEND_FIELDS);
    const append = store.append;
    if (!isCallback(append)) invalid();
    result.store = Object.freeze({ append: async (emitted: VistaEvent): Promise<void> => { await append(freezeEvent(emitted)); } });
  }
  return Object.freeze(result) as ShadowEmitOptions;
}

/** Pure mapping; never reads an owner, environment, filesystem, or model runtime. */
export function toVistaEventInput(observation: ShadowObservation): ShadowEventInput {
  try { return project(normalize(observation)); }
  catch { return invalid(); }
}

/** Explicit opt-in core emission. Malformed inputs reject; persistence stays fail-open. */
export async function emitShadowObservation(
  observation: ShadowObservation,
  options?: ShadowEmitOptions,
): Promise<ShadowEvent | undefined> {
  try {
    const event = project(normalize(observation));
    const emitted = await emitVistaEvent(coreInput(event), emissionOptions(options, event));
    return emitted === undefined ? undefined : freezeEvent(emitted);
  } catch { return invalid(); }
}
