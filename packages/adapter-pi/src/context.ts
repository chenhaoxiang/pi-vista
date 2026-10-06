import {
  CheckpointStore,
  emitVistaEvent,
  generateStepId,
  getOrCreateRunId,
  isSafeSegment,
  VistaProtocolError,
  type EmitOptions,
  type EventStore,
  type VistaCheckpoint,
  type VistaEmitter,
  type VistaEvent,
  type VistaEventInput,
  type VistaResult,
} from "@pi-vista/core";
import type {
  PiArtifactRefInput,
  PiCheckpointInput,
  PiRunContext,
  PiRunContextOptions,
  PiStep,
  PiToolCallInput,
  PiToolResultInput,
} from "./types.js";

const SAFE_LABEL_PATTERN = /^[A-Za-z0-9._:@+-]{1,128}$/u;
const SUMMARY_PATTERN = /^[A-Za-z0-9._:@+\- \[\],]{1,256}$/u;
const CONTROL_CHARACTER_PATTERN = /[\p{Cc}\p{Cf}]/u;
const REDACTION_MARKER_PATTERN = /^\[REDACTED(?:_[A-Z]+)?\]$/u;
const RAW_SUMMARY_PATTERN = /(?:^|[^a-z0-9])(?:arg(?:s|ument)?|argv|command|completion|content|cwd|directory|file(?:name|path)?|input|model|output|path|prompt|raw|request|response|secret|shell|stderr|stdin|stdout|token|credential|password)(?:$|[^a-z0-9])/iu;
const SHELL_SYNTAX_PATTERN = /(?:&&|\|\||[|;`$<>]|\r?\n)/u;
const SENSITIVE_STATS_KEY_PATTERN = /(?:accesskey|accesstoken|apikey|auth|cookie|credential|password|passwd|privatekey|refreshtoken|secret|token|sshkey|signingkey|absolutepath|command|cwd|directory|filename|filepath|path|shell|url|uri|href)/u;
const SAFE_STATS_KEY_PATTERN = /^[A-Za-z][A-Za-z0-9._:-]{0,63}$/u;
const SAFE_STATS_VALUE_PATTERN = /^[A-Za-z0-9._:@+\-]{1,64}$/u;
const VISTA_RESULTS = new Set<VistaResult>(["ok", "blocked", "failed", "unknown", "abstain"]);

const CONTEXT_OPTION_KEYS = new Set([
  "runId",
  "run_id",
  "sessionId",
  "session_id",
  "persistTimeoutMs",
  "now",
  "clock",
  "store",
  "eventStore",
  "checkpointStore",
  "emit",
]);
const TOOL_KEYS = new Set([
  "tool",
  "tool_name",
  "name",
  "action",
  "action_name",
  "targetClass",
  "target_class",
  "reasonCode",
  "reason_code",
  "artifactRefs",
  "artifact_refs",
]);
const TOOL_RESULT_KEYS = new Set([...TOOL_KEYS, "result"]);
const ARTIFACT_KEYS = new Set(["type", "ref", "sha", "verified", "stats"]);
const CHECKPOINT_KEYS = new Set([
  "runId",
  "run_id",
  "stepId",
  "step_id",
  "ts",
  "taskGoal",
  "task_goal",
  "completedSteps",
  "completed_steps",
  "currentState",
  "current_state",
  "pendingSteps",
  "pending_steps",
  "sourceSha",
  "source_sha",
  "envFingerprint",
  "env_fingerprint",
  "policyVersion",
  "policy_version",
  "checkFnIds",
  "check_fn_ids",
  "resumable",
  "resumeRequires",
  "resume_requires",
]);

interface SnapshotRecord {
  readonly [key: string]: unknown;
}

interface NormalizedToolInput {
  readonly tool: string;
  readonly action: string | undefined;
  readonly targetClass: string | undefined;
  readonly reasonCode: string | undefined;
  readonly artifactRefs: NonNullable<VistaEvent["artifact_refs"]> | undefined;
  readonly result: VistaResult | undefined;
}

interface NormalizedOptions {
  readonly runId: string;
  readonly sessionId: string | undefined;
  readonly persistTimeoutMs: number | undefined;
  readonly now: number | (() => number) | undefined;
  readonly clock: (() => number) | undefined;
  readonly store: Pick<EventStore, "append"> | undefined;
  readonly checkpointStore: Pick<CheckpointStore, "save">;
  readonly emit: VistaEmitter;
}

function reject(message: string): never {
  throw new VistaProtocolError(message);
}

function isObject(value: unknown): value is object {
  return value !== null && typeof value === "object";
}

/**
 * Take a data-only snapshot before reading any adapter input. This rejects
 * custom prototypes, accessors, symbols, unknown own keys, and proxy traps
 * that throw while the snapshot is being taken.
 */
function snapshotRecord(value: unknown, label: string, allowedKeys: ReadonlySet<string>): SnapshotRecord {
  return snapshotDataRecord(value, label, (key) => allowedKeys.has(key));
}

function snapshotDataRecord(
  value: unknown,
  label: string,
  acceptKey: (key: string) => boolean,
): SnapshotRecord {
  try {
    if (!isObject(value) || Array.isArray(value)) {
      reject(`${label} must be a plain object`);
    }
    if (Object.getPrototypeOf(value) !== Object.prototype) {
      reject(`${label} must use the plain object prototype`);
    }
    const keys = Reflect.ownKeys(value);
    const descriptors = Object.getOwnPropertyDescriptors(value);
    if (keys.length !== Object.keys(descriptors).length) {
      reject(`${label} contains unsupported own properties`);
    }
    const result: Record<string, unknown> = {};
    for (const key of keys) {
      if (typeof key !== "string" || !acceptKey(key)) {
        reject(`${label} contains an unknown own key`);
      }
      const descriptor = descriptors[key];
      if (descriptor === undefined || !("value" in descriptor)) {
        reject(`${label}.${key} must be a data property`);
      }
      result[key] = descriptor.value;
    }
    return result;
  } catch (error) {
    if (error instanceof VistaProtocolError) {
      throw error;
    }
    reject(`${label} could not be safely inspected`);
  }
}

/** Snapshot a dense, ordinary array without invoking element getters. */
function snapshotArray(value: unknown, label: string): unknown[] {
  try {
    if (!Array.isArray(value)) {
      reject(`${label} must be an array`);
    }
    const array = value as unknown[];
    if (Object.getPrototypeOf(array) !== Array.prototype) {
      reject(`${label} must use the ordinary array prototype`);
    }
    const descriptors: Record<string, PropertyDescriptor> = Object.getOwnPropertyDescriptors(array as object);
    const lengthDescriptor = descriptors.length;
    const lengthValue = lengthDescriptor?.value;
    if (typeof lengthValue !== "number" || !Number.isSafeInteger(lengthValue)) {
      reject(`${label} has an invalid length`);
    }
    const length = lengthValue as number;
    const keys = Reflect.ownKeys(array as object);
    if (keys.length !== length + 1) {
      reject(`${label} contains unsupported own properties or holes`);
    }
    const result: unknown[] = [];
    for (let index = 0; index < length; index += 1) {
      const key = String(index);
      const descriptor = descriptors[key];
      if (descriptor === undefined || !("value" in descriptor)) {
        reject(`${label} contains a hole or accessor`);
      }
      result.push(descriptor.value);
    }
    for (const key of keys) {
      if (typeof key !== "string" || (key !== "length" && !/^(?:0|[1-9][0-9]*)$/u.test(key))) {
        reject(`${label} contains an unsupported own key`);
      }
    }
    return result;
  } catch (error) {
    if (error instanceof VistaProtocolError) {
      throw error;
    }
    reject(`${label} could not be safely inspected`);
  }
}

function ownValue(record: SnapshotRecord, key: string): unknown {
  return record[key];
}

function aliasValue(record: SnapshotRecord, keys: readonly string[], label: string): unknown {
  const present = keys.filter((key) => ownValue(record, key) !== undefined);
  if (present.length > 1) {
    reject(`${label} has conflicting aliases`);
  }
  return present.length === 1 ? ownValue(record, present[0] as string) : undefined;
}

function optionalString(value: unknown, label: string): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string") {
    reject(`${label} must be a string`);
  }
  return value;
}

function requiredString(value: unknown, label: string): string {
  const result = optionalString(value, label);
  if (result === undefined) {
    reject(`${label} is required`);
  }
  return result;
}

function safeLabel(value: unknown, label: string): string {
  const result = requiredString(value, label);
  if (!SAFE_LABEL_PATTERN.test(result) || result.includes("..")) {
    reject(`${label} must be a short metadata label`);
  }
  return result;
}

function safeIdentifier(value: unknown, label: string): string {
  const result = requiredString(value, label);
  if (!isSafeSegment(result)) {
    reject(`${label} must be a path-safe identifier`);
  }
  return result;
}

function optionalSafeLabel(value: unknown, label: string): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  return safeLabel(value, label);
}

function optionalSafeIdentifier(value: unknown, label: string): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  return safeIdentifier(value, label);
}

function safeSummary(value: unknown, label: string): string {
  const result = requiredString(value, label);
  if (
    result.length > 256 ||
    CONTROL_CHARACTER_PATTERN.test(result) ||
    (!REDACTION_MARKER_PATTERN.test(result) &&
      (!SUMMARY_PATTERN.test(result) || RAW_SUMMARY_PATTERN.test(result) || SHELL_SYNTAX_PATTERN.test(result)))
  ) {
    reject(`${label} must be an already-summarized protocol value`);
  }
  return result;
}

function optionalFiniteNumber(value: unknown, label: string): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "number" || !Number.isFinite(value)) {
    reject(`${label} must be a finite number`);
  }
  return value;
}

function optionalBoolean(value: unknown, label: string): boolean | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "boolean") {
    reject(`${label} must be a boolean`);
  }
  return value;
}

function ensureNoConflict<T>(left: T | undefined, right: T | undefined, label: string): T | undefined {
  if (left !== undefined && right !== undefined) {
    reject(`${label} has conflicting values`);
  }
  return left ?? right;
}

function normalizeToolInput(value: unknown, requireResult: boolean): NormalizedToolInput {
  const record = snapshotRecord(value, "tool input", requireResult ? TOOL_RESULT_KEYS : TOOL_KEYS);
  const toolAliases = ["tool", "tool_name", "name"] as const;
  const toolValues = toolAliases.filter((key) => ownValue(record, key) !== undefined);
  if (toolValues.length !== 1) {
    reject("tool input must contain exactly one tool name");
  }
  const tool = safeLabel(ownValue(record, toolValues[0] as string), "tool");
  const actionValue = aliasValue(record, ["action", "action_name"], "action");
  const targetClassValue = aliasValue(record, ["targetClass", "target_class"], "target_class");
  const reasonCodeValue = aliasValue(record, ["reasonCode", "reason_code"], "reason_code");
  const artifactRefsValue = aliasValue(record, ["artifactRefs", "artifact_refs"], "artifact_refs");
  const action = optionalSafeLabel(actionValue, "action");
  const targetClass = optionalSafeLabel(targetClassValue, "target_class");
  const reasonCode = optionalSafeLabel(reasonCodeValue, "reason_code");
  const artifactRefs = normalizeArtifactRefs(artifactRefsValue);
  const rawResult = requireResult ? ownValue(record, "result") : undefined;
  const result = requireResult ? normalizeResult(rawResult) : undefined;
  return { tool, action, targetClass, reasonCode, artifactRefs, result };
}

function normalizeResult(value: unknown): VistaResult {
  if (typeof value !== "string" || !VISTA_RESULTS.has(value as VistaResult)) {
    reject("result must be an explicit VistaResult");
  }
  return value as VistaResult;
}

function normalizeArtifactRefs(value: unknown): NonNullable<VistaEvent["artifact_refs"]> | undefined {
  if (value === undefined) {
    return undefined;
  }
  const entries = snapshotArray(value, "artifact_refs");
  return entries.map((entry, index) => normalizeArtifactRef(entry, `artifact_refs[${index}]`));
}

function normalizeArtifactRef(value: unknown, label: string): PiArtifactRefInput {
  const record = snapshotRecord(value, label, ARTIFACT_KEYS);
  const type = safeLabel(ownValue(record, "type"), `${label}.type`);
  const ref = safeIdentifier(ownValue(record, "ref"), `${label}.ref`);
  const sha = optionalSafeIdentifier(ownValue(record, "sha"), `${label}.sha`);
  const verified = optionalBoolean(ownValue(record, "verified"), `${label}.verified`);
  const rawStats = ownValue(record, "stats");
  let stats: Record<string, number | string> | undefined;
  if (rawStats !== undefined) {
    const statsRecord = snapshotDataRecord(rawStats, `${label}.stats`, () => true);
    const entries = Object.entries(statsRecord);
    if (entries.length > 32) {
      reject(`${label}.stats has too many entries`);
    }
    stats = {};
    for (const [key, stat] of entries) {
      if (!SAFE_STATS_KEY_PATTERN.test(key) || SENSITIVE_STATS_KEY_PATTERN.test(key.replace(/[_.:-]/gu, "").toLowerCase())) {
        reject(`${label}.stats contains an unsafe key`);
      }
      if (typeof stat === "number") {
        if (!Number.isFinite(stat)) {
          reject(`${label}.stats.${key} must be finite`);
        }
        stats[key] = stat;
      } else if (typeof stat === "string" && (REDACTION_MARKER_PATTERN.test(stat) || SAFE_STATS_VALUE_PATTERN.test(stat))) {
        stats[key] = stat;
      } else {
        reject(`${label}.stats.${key} must be a short metadata value`);
      }
    }
  }
  const result: Record<string, unknown> = { type, ref };
  if (sha !== undefined) result.sha = sha;
  if (verified !== undefined) result.verified = verified;
  if (stats !== undefined) result.stats = stats;
  return result as unknown as PiArtifactRefInput;
}

function resolveIdentity(options: SnapshotRecord): { runId: string; sessionId: string | undefined } {
  const explicitRunId = aliasValue(options, ["runId", "run_id"], "run_id");
  let runId: string;
  if (explicitRunId !== undefined) {
    runId = safeIdentifier(explicitRunId, "run_id");
  } else {
    // getOrCreateRunId preserves an existing safe VISTA_RUN_ID and replaces an
    // unsafe/missing environment value with a newly generated safe ID.
    runId = getOrCreateRunId();
  }

  const explicitSessionId = aliasValue(options, ["sessionId", "session_id"], "session_id");
  let sessionId: string | undefined;
  if (explicitSessionId !== undefined) {
    sessionId = safeIdentifier(explicitSessionId, "session_id");
  } else {
    const environmentSessionId = process.env.PI_SESSION_ID;
    sessionId = isSafeSegment(environmentSessionId) ? environmentSessionId : undefined;
  }
  return { runId, sessionId };
}

function normalizeOptions(value: unknown): NormalizedOptions {
  const options = value === undefined ? {} : snapshotRecord(value, "context options", CONTEXT_OPTION_KEYS);
  const { runId, sessionId } = resolveIdentity(options);
  const timeout = optionalFiniteNumber(ownValue(options, "persistTimeoutMs"), "persistTimeoutMs");
  if (timeout !== undefined && timeout < 0) {
    reject("persistTimeoutMs must be non-negative");
  }
  const nowValue = ownValue(options, "now");
  if (nowValue !== undefined && typeof nowValue !== "number" && typeof nowValue !== "function") {
    reject("now must be a finite number or function");
  }
  if (typeof nowValue === "number" && !Number.isFinite(nowValue)) {
    reject("now must be a finite number or function");
  }
  const clockValue = ownValue(options, "clock");
  if (clockValue !== undefined && typeof clockValue !== "function") {
    reject("clock must be a function");
  }
  const store = ensureNoConflict(
    ownValue(options, "store") as Pick<EventStore, "append"> | undefined,
    ownValue(options, "eventStore") as Pick<EventStore, "append"> | undefined,
    "event store",
  );
  const checkpointStore = (ownValue(options, "checkpointStore") as Pick<CheckpointStore, "save"> | undefined)
    ?? new CheckpointStore();
  const emit = (ownValue(options, "emit") as VistaEmitter | undefined) ?? emitVistaEvent;
  if (typeof emit !== "function") {
    reject("emit must be a function");
  }
  if (!isObject(checkpointStore) || typeof checkpointStore.save !== "function") {
    reject("checkpointStore must provide save");
  }
  return {
    runId,
    sessionId,
    persistTimeoutMs: timeout,
    now: nowValue as number | (() => number) | undefined,
    clock: clockValue as (() => number) | undefined,
    store,
    checkpointStore,
    emit,
  };
}

function eventOptions(options: NormalizedOptions, step: PiStep): EmitOptions {
  const result: EmitOptions = {
    runId: options.runId,
    stepId: step.stepId,
    seq: step.seq,
  };
  if (options.store !== undefined) result.store = options.store;
  if (options.persistTimeoutMs !== undefined) result.persistTimeoutMs = options.persistTimeoutMs;
  if (options.now !== undefined) result.now = options.now;
  if (options.clock !== undefined) result.clock = options.clock;
  return result;
}

function timestamp(options: NormalizedOptions): number {
  try {
    const value = typeof options.now === "function"
      ? options.now()
      : (options.now ?? options.clock?.() ?? Date.now());
    return Number.isFinite(value) ? value : Date.now();
  } catch {
    return Date.now();
  }
}

function normalizeCheckpoint(
  value: unknown,
  runId: string,
  currentStep: PiStep,
  options: NormalizedOptions,
): VistaCheckpoint {
  const record = snapshotRecord(value, "checkpoint input", CHECKPOINT_KEYS);
  const suppliedRunId = aliasValue(record, ["runId", "run_id"], "checkpoint.run_id");
  if (suppliedRunId !== undefined && safeIdentifier(suppliedRunId, "checkpoint.run_id") !== runId) {
    reject("checkpoint.run_id must match the context run");
  }
  const suppliedStepId = aliasValue(record, ["stepId", "step_id"], "checkpoint.step_id");
  if (suppliedStepId !== undefined && safeIdentifier(suppliedStepId, "checkpoint.step_id") !== currentStep.stepId) {
    reject("checkpoint.step_id must match the current context step");
  }

  const taskGoal = safeSummary(aliasValue(record, ["taskGoal", "task_goal"], "task_goal"), "task_goal");
  const currentState = safeSummary(aliasValue(record, ["currentState", "current_state"], "current_state"), "current_state");
  const sourceSha = safeIdentifier(aliasValue(record, ["sourceSha", "source_sha"], "source_sha"), "source_sha");
  const envFingerprint = safeIdentifier(aliasValue(record, ["envFingerprint", "env_fingerprint"], "env_fingerprint"), "env_fingerprint");
  const policyVersion = safeIdentifier(aliasValue(record, ["policyVersion", "policy_version"], "policy_version"), "policy_version");
  const resumable = optionalBoolean(ownValue(record, "resumable"), "resumable");
  if (resumable === undefined) {
    reject("resumable is required");
  }
  const completedSteps = normalizeStepArray(aliasValue(record, ["completedSteps", "completed_steps"], "completed_steps"), runId, "completed_steps");
  const pendingSteps = normalizeStepArray(aliasValue(record, ["pendingSteps", "pending_steps"], "pending_steps"), runId, "pending_steps");
  const checkFnIds = normalizeIdentifierArray(aliasValue(record, ["checkFnIds", "check_fn_ids"], "check_fn_ids"), "check_fn_ids") ?? [];
  const resumeRequires = normalizeIdentifierArray(
    aliasValue(record, ["resumeRequires", "resume_requires"], "resume_requires"),
    "resume_requires",
    true,
  );
  const ts = optionalFiniteNumber(ownValue(record, "ts"), "ts") ?? timestamp(options);
  return {
    run_id: runId,
    step_id: currentStep.stepId,
    ts,
    task_goal: taskGoal,
    completed_steps: completedSteps,
    current_state: currentState,
    pending_steps: pendingSteps,
    source_sha: sourceSha,
    env_fingerprint: envFingerprint,
    policy_version: policyVersion,
    check_fn_ids: checkFnIds,
    resumable,
    ...(resumeRequires === undefined ? {} : { resume_requires: resumeRequires }),
  };
}

function normalizeIdentifierArray(value: unknown, label: string, allowUndefined = false): string[] | undefined {
  if (value === undefined) {
    if (allowUndefined) return undefined;
    return [];
  }
  return snapshotArray(value, label).map((item, index) => safeIdentifier(item, `${label}[${index}]`));
}

function normalizeStepArray(value: unknown, runId: string, label: string): string[] {
  const stepIds = normalizeIdentifierArray(value, label) ?? [];
  return stepIds.map((stepId) => {
    if (!stepId.startsWith(`${runId}_`)) {
      reject(`${label} must contain steps from the context run`);
    }
    return stepId;
  });
}

class PiRunContextImpl implements PiRunContext {
  readonly runId: string;
  readonly sessionId: string | undefined;
  private readonly options: NormalizedOptions;
  private readonly pending = new Set<Promise<unknown>>();
  private sequence = 0;
  private currentStep: PiStep | undefined;

  constructor(options: NormalizedOptions) {
    this.options = options;
    this.runId = options.runId;
    this.sessionId = options.sessionId;
  }

  get stepId(): string | undefined {
    return this.currentStep?.stepId;
  }

  get run_id(): string {
    return this.runId;
  }

  get session_id(): string | undefined {
    return this.sessionId;
  }

  get step_id(): string | undefined {
    return this.stepId;
  }

  getRunId(): string {
    return this.runId;
  }

  getSessionId(): string | undefined {
    return this.sessionId;
  }

  nextStep(): string {
    const step: PiStep = {
      runId: this.runId,
      seq: this.sequence,
      stepId: generateStepId(this.runId, this.sequence),
    };
    this.sequence += 1;
    this.currentStep = step;
    return step.stepId;
  }

  private ensureStep(): PiStep {
    return this.currentStep ?? {
      runId: this.runId,
      seq: this.sequence,
      stepId: this.nextStep(),
    };
  }

  private track<T>(operation: Promise<T>): Promise<T> {
    const tracked = operation.then(
      (value) => value,
      (error) => {
        throw error;
      },
    );
    this.pending.add(tracked);
    void tracked.finally(() => {
      this.pending.delete(tracked);
    }).catch(() => undefined);
    return tracked;
  }

  private async dispatch(input: VistaEventInput, step: PiStep): Promise<VistaEvent | undefined> {
    const operation = Promise.resolve().then(() => this.options.emit(input, eventOptions(this.options, step)));
    try {
      return await this.track(operation);
    } catch (error) {
      if (error instanceof VistaProtocolError) {
        throw error;
      }
      return undefined;
    }
  }

  async emitToolCall(input: PiToolCallInput): Promise<VistaEvent | undefined> {
    const normalized = normalizeToolInput(input, false);
    const step = this.ensureStep();
    const event: VistaEventInput = {
      run_id: this.runId,
      step_id: step.stepId,
      component: "pi",
      action: normalized.action ?? `pi:tool_call:${normalized.tool}`,
      result: "unknown",
    };
    if (this.sessionId !== undefined) event.session_id = this.sessionId;
    if (normalized.targetClass !== undefined) event.target_class = normalized.targetClass;
    if (normalized.reasonCode !== undefined) event.reason_code = normalized.reasonCode;
    if (normalized.artifactRefs !== undefined) event.artifact_refs = normalized.artifactRefs;
    return this.dispatch(event, step);
  }

  async emitToolResult(input: PiToolResultInput): Promise<VistaEvent | undefined> {
    const normalized = normalizeToolInput(input, true);
    const step = this.ensureStep();
    const event: VistaEventInput = {
      run_id: this.runId,
      step_id: step.stepId,
      component: "pi",
      action: normalized.action ?? `pi:tool_result:${normalized.tool}`,
      result: normalized.result as VistaResult,
    };
    if (this.sessionId !== undefined) event.session_id = this.sessionId;
    if (normalized.targetClass !== undefined) event.target_class = normalized.targetClass;
    if (normalized.reasonCode !== undefined) event.reason_code = normalized.reasonCode;
    if (normalized.artifactRefs !== undefined) event.artifact_refs = normalized.artifactRefs;
    return this.dispatch(event, step);
  }

  async checkpoint(partial: PiCheckpointInput): Promise<void> {
    const step = this.ensureStep();
    const checkpoint = normalizeCheckpoint(partial, this.runId, step, this.options);
    const operation = Promise.resolve().then(() => this.options.checkpointStore.save(checkpoint));
    try {
      await this.track(operation);
    } catch {
      // Checkpoint persistence is observation only. Match core's fail-open
      // contract even when a test or extension supplies a custom store.
    }
  }

  withRunContext<T>(callback: (context: PiRunContext) => T | Promise<T>): T | Promise<T> {
    if (typeof callback !== "function") {
      reject("withRunContext callback must be a function");
    }
    return callback(this);
  }

  async flush(): Promise<void> {
    const operations = [...this.pending];
    if (operations.length === 0) {
      return;
    }
    const settled = Promise.allSettled(operations);
    const timeoutMs = this.options.persistTimeoutMs ?? 250;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<void>((resolve) => {
      timer = setTimeout(resolve, timeoutMs);
    });
    try {
      await Promise.race([settled, timeout]);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }

  async end(): Promise<void> {
    await this.flush();
  }
}

export function createPiRunContext(options?: PiRunContextOptions): PiRunContext {
  return new PiRunContextImpl(normalizeOptions(options));
}

/** Run a callback with an explicit context, or construct one from options. */
export function withRunContext<T>(
  contextOrOptions: PiRunContext | PiRunContextOptions | undefined,
  callback: (context: PiRunContext) => T | Promise<T>,
): T | Promise<T> {
  if (typeof callback !== "function") {
    reject("withRunContext callback must be a function");
  }
  const context = isPiRunContext(contextOrOptions)
    ? contextOrOptions
    : createPiRunContext(contextOrOptions);
  return callback(context);
}

function isPiRunContext(value: unknown): value is PiRunContext {
  return (
    isObject(value) &&
    typeof (value as { getRunId?: unknown }).getRunId === "function" &&
    typeof (value as { nextStep?: unknown }).nextStep === "function" &&
    typeof (value as { emitToolCall?: unknown }).emitToolCall === "function"
  );
}

export { VistaProtocolError } from "@pi-vista/core";
