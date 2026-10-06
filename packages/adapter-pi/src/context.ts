import { types } from "node:util";
import {
  CheckpointStore,
  hasKnownCredential,
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
import { assertVistaCheckpoint, isVistaStepIdForRun } from "@pi-vista/core/validation";
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
const DEFAULT_PERSIST_TIMEOUT_MS = 250;
const PI_RUN_CONTEXTS = new WeakSet<object>();
const CONTEXT_METHOD_KEYS = new Set([
  "getRunId",
  "getSessionId",
  "nextStep",
  "checkpoint",
  "emitToolCall",
  "emitToolResult",
  "withRunContext",
  "flush",
  "end",
]);

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

interface BoundObserverMethod {
  readonly owner: object;
  readonly method: Function;
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
    const result = Object.create(null) as Record<string, unknown>;
    for (const key of keys) {
      if (typeof key !== "string" || !acceptKey(key)) {
        reject(`${label} contains an unknown own key`);
      }
      const descriptor = descriptors[key];
      if (descriptor === undefined || !Object.hasOwn(descriptor, "value")) {
        reject(`${label} fields must be data properties`);
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
      if (descriptor === undefined || !Object.hasOwn(descriptor, "value")) {
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
  return Object.hasOwn(record, key) ? record[key] : undefined;
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
  if (!SAFE_LABEL_PATTERN.test(result) || result.includes("..") || hasKnownCredential(result)) {
    reject(`${label} must be a short metadata label`);
  }
  return result;
}

function safeIdentifier(value: unknown, label: string): string {
  const result = requiredString(value, label);
  if (!isSafeSegment(result) || hasKnownCredential(result)) {
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
    hasKnownCredential(result) ||
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
  return left !== undefined ? left : right;
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
      if (!SAFE_STATS_KEY_PATTERN.test(key) || hasKnownCredential(key) || SENSITIVE_STATS_KEY_PATTERN.test(key.replace(/[_.:-]/gu, "").toLowerCase())) {
        reject(`${label}.stats contains an unsafe key`);
      }
      if (typeof stat === "number") {
        if (!Number.isFinite(stat)) {
          reject(`${label}.stats.${key} must be finite`);
        }
        stats[key] = stat;
      } else if (typeof stat === "string" && !hasKnownCredential(stat) && (REDACTION_MARKER_PATTERN.test(stat) || SAFE_STATS_VALUE_PATTERN.test(stat))) {
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

function ownProcessEnvironmentValue(key: string): unknown {
  try {
    const processDescriptor = Object.getOwnPropertyDescriptor(process, "env");
    if (processDescriptor === undefined || !Object.hasOwn(processDescriptor, "value")) {
      return undefined;
    }
    const environment = processDescriptor.value;
    if (!isObject(environment) || types.isProxy(environment)) {
      return undefined;
    }
    const descriptor = Object.getOwnPropertyDescriptor(environment, key);
    if (descriptor === undefined || !Object.hasOwn(descriptor, "value")) {
      return undefined;
    }
    return descriptor.value;
  } catch {
    return undefined;
  }
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
    const environmentSessionId = ownProcessEnvironmentValue("PI_SESSION_ID");
    sessionId = isSafeSegment(environmentSessionId) && !hasKnownCredential(environmentSessionId) ? environmentSessionId : undefined;
  }
  return { runId, sessionId };
}

function safeObserverDescriptors(
  value: object,
  label: string,
  requireDataProperties = false,
): Record<PropertyKey, PropertyDescriptor> {
  try {
    const keys = Reflect.ownKeys(value);
    const descriptors = Object.getOwnPropertyDescriptors(value) as Record<PropertyKey, PropertyDescriptor>;
    const descriptorKeys = Reflect.ownKeys(descriptors);
    if (keys.length !== descriptorKeys.length || keys.some((key) => !Object.hasOwn(descriptors, key))) {
      reject(`${label} contains unsupported own properties`);
    }
    if (keys.some((key) => typeof key !== "string")) {
      reject(`${label} contains an unsupported symbol property`);
    }
    if (requireDataProperties && keys.some((key) => !Object.hasOwn(descriptors[key] as PropertyDescriptor, "value"))) {
      reject(`${label} contains an accessor property`);
    }
    return descriptors;
  } catch (error) {
    if (error instanceof VistaProtocolError) {
      throw error;
    }
    reject(`${label} could not be safely inspected`);
  }
}

function rejectUnbrandedContext(value: unknown): void {
  if (!isObject(value)) {
    return;
  }
  try {
    const descriptors = safeObserverDescriptors(value, "withRunContext context");
    for (const key of CONTEXT_METHOD_KEYS) {
      if (Object.hasOwn(descriptors, key)) {
        reject("withRunContext requires a context created by createPiRunContext");
      }
    }
  } catch (error) {
    if (error instanceof VistaProtocolError) {
      throw error;
    }
    reject("withRunContext context could not be safely inspected");
  }
}

function isClassPrototype(value: object): boolean {
  try {
    const constructorDescriptor = Object.getOwnPropertyDescriptor(value, "constructor");
    if (constructorDescriptor === undefined || !Object.hasOwn(constructorDescriptor, "value")) {
      return false;
    }
    if (typeof constructorDescriptor.value !== "function") {
      return false;
    }
    const prototypeDescriptor = Object.getOwnPropertyDescriptor(constructorDescriptor.value, "prototype");
    return prototypeDescriptor !== undefined
      && Object.hasOwn(prototypeDescriptor, "value")
      && prototypeDescriptor.value === value;
  } catch {
    return false;
  }
}

/** Validate a callable data value without invoking it or its accessors. */
function observerFunction(value: unknown, label: string): Function {
  if (typeof value !== "function") {
    reject(`${label} must be a function`);
  }
  try {
    Object.getPrototypeOf(value);
  } catch {
    reject(`${label} could not be safely inspected`);
  }
  safeObserverDescriptors(value, label, true);
  return value;
}

/**
 * Resolve an observer method from descriptors only. A receiver may be a
 * null-prototype object or an ordinary object with an own data method; an
 * inherited method is allowed only from a class prototype. The complete
 * prototype chain is inspected before either form is accepted, while
 * Object.prototype itself is never an allowed receiver. No property getter is
 * invoked and the returned pair preserves the original owner for class
 * methods that use `this`.
 */
function observerMethod(value: unknown, property: string, label: string): BoundObserverMethod {
  try {
    if (!isObject(value) || Array.isArray(value)) {
      reject(`${label} must be an object`);
    }
    const owner = value as object;
    if (owner === Object.prototype) {
      reject(`${label} must not use Object.prototype as its receiver`);
    }

    // Inspect the owner and every prototype before accepting any method. An
    // own method must not hide a hostile prototype, and a late rejection from
    // the chain must never expose a raw Proxy trap error to the caller.
    const ownerPrototype = Object.getPrototypeOf(owner);
    const ownDescriptors = safeObserverDescriptors(owner, label, true);
    const ownDescriptor = Object.hasOwn(ownDescriptors, property)
      ? ownDescriptors[property]
      : undefined;
    let method: Function | undefined;
    if (ownDescriptor !== undefined) {
      if (!Object.hasOwn(ownDescriptor, "value")) {
        reject(`${label}.${property} must be an own data function`);
      }
      method = observerFunction(ownDescriptor.value, `${label}.${property}`);
    }

    const visited = new Set<object>();
    let prototype = ownerPrototype;
    while (prototype !== null) {
      if (visited.has(prototype)) {
        reject(`${label} has a cyclic prototype chain`);
      }
      visited.add(prototype);
      const descriptors = safeObserverDescriptors(prototype, label, prototype !== Object.prototype);
      const descriptor = Object.hasOwn(descriptors, property)
        ? descriptors[property]
        : undefined;
      if (descriptor !== undefined) {
        if (prototype === Object.prototype || !isClassPrototype(prototype)) {
          reject(`${label}.${property} must be an own data function or class prototype method`);
        }
        if (!Object.hasOwn(descriptor, "value")) {
          reject(`${label}.${property} must be a data function`);
        }
        if (method === undefined) {
          method = observerFunction(descriptor.value, `${label}.${property}`);
        }
      }
      prototype = Object.getPrototypeOf(prototype);
    }

    if (method === undefined) {
      reject(`${label} must provide ${property}`);
    }
    return { owner, method };
  } catch (error) {
    if (error instanceof VistaProtocolError) {
      throw error;
    }
    reject(`${label} could not be safely inspected`);
  }
}

function normalizeEventStore(value: unknown): Pick<EventStore, "append"> | undefined {
  if (value === undefined) {
    return undefined;
  }
  const { owner, method } = observerMethod(value, "append", "event store");
  return {
    append: (event) => Reflect.apply(method, owner, [event]) as Promise<void>,
  };
}

function normalizeCheckpointStore(value: unknown): Pick<CheckpointStore, "save"> {
  const candidate = value === undefined ? new CheckpointStore() : value;
  const { owner, method } = observerMethod(candidate, "save", "checkpointStore");
  return {
    save: (checkpoint) => Reflect.apply(method, owner, [checkpoint]) as Promise<void>,
  };
}

function normalizeEmitter(value: unknown): VistaEmitter {
  if (value === undefined) {
    return emitVistaEvent;
  }
  return observerFunction(value, "emit") as VistaEmitter;
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
  const rawStore = ensureNoConflict(
    ownValue(options, "store"),
    ownValue(options, "eventStore"),
    "event store",
  );
  const store = normalizeEventStore(rawStore);
  const checkpointStore = normalizeCheckpointStore(ownValue(options, "checkpointStore"));
  const emit = normalizeEmitter(ownValue(options, "emit"));
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

/**
 * Bound an injected observer promise without leaving a late rejection
 * unhandled after the adapter has already failed open on timeout.
 */
function awaitWithTimeout<T>(operation: Promise<T>, timeoutMs: number): Promise<T | undefined> {
  operation.catch(() => undefined);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<undefined>((resolve) => {
    timer = setTimeout(() => resolve(undefined), timeoutMs);
  });
  return Promise.race([operation, timeout]).finally(() => {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  });
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
    safeResumeRequirement,
  );
  const ts = optionalFiniteNumber(ownValue(record, "ts"), "ts") ?? timestamp(options);
  const checkpoint: VistaCheckpoint = {
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
  // Validate an own-data snapshot so a polluted Object.prototype cannot alter
  // core's optional-field lookup; keep the protocol output shape unchanged.
  const validationCheckpoint: VistaCheckpoint = { ...checkpoint, resume_requires: resumeRequires };
  assertVistaCheckpoint(validationCheckpoint);
  return checkpoint;
}

function normalizeIdentifierArray(
  value: unknown,
  label: string,
  allowUndefined = false,
  normalizeIdentifier: (value: unknown, label: string) => string = safeIdentifier,
): string[] | undefined {
  if (value === undefined) {
    if (allowUndefined) return undefined;
    return [];
  }
  return snapshotArray(value, label).map((item, index) => normalizeIdentifier(item, `${label}[${index}]`));
}

function safeResumeRequirement(value: unknown, label: string): string {
  const result = safeIdentifier(value, label);
  if (result.includes("..")) {
    reject(`${label} must be a safe resume requirement`);
  }
  return result;
}

function normalizeStepArray(value: unknown, runId: string, label: string): string[] {
  const stepIds = normalizeIdentifierArray(value, label) ?? [];
  return stepIds.map((stepId) => {
    if (!isVistaStepIdForRun(runId, stepId)) {
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
    PI_RUN_CONTEXTS.add(this);
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
    safeIdentifier(this.runId, "run_id");
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
    safeIdentifier(this.runId, "run_id");
    optionalSafeIdentifier(this.sessionId, "session_id");
    const step = this.currentStep ?? {
      runId: this.runId,
      seq: this.sequence,
      stepId: this.nextStep(),
    };
    if (step.runId !== this.runId || !isVistaStepIdForRun(this.runId, step.stepId)) {
      reject("current step must match the context run");
    }
    return step;
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

  private observerTimeout(): number {
    return this.options.persistTimeoutMs ?? DEFAULT_PERSIST_TIMEOUT_MS;
  }

  private async dispatch(input: VistaEventInput, step: PiStep): Promise<VistaEvent | undefined> {
    const emit = this.options.emit;
    const operation = Promise.resolve().then(() => Reflect.apply(emit, undefined, [
      input,
      eventOptions(this.options, step),
    ]));
    const bounded = this.options.emit === emitVistaEvent
      ? operation
      : awaitWithTimeout(operation, this.observerTimeout());
    try {
      return await this.track(bounded);
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
      await this.track(awaitWithTimeout(operation, this.observerTimeout()));
    } catch (error) {
      if (error instanceof VistaProtocolError) {
        throw error;
      }
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
    const timeoutMs = this.observerTimeout();
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
  let context: PiRunContext;
  if (isPiRunContext(contextOrOptions)) {
    context = contextOrOptions;
  } else {
    rejectUnbrandedContext(contextOrOptions);
    context = createPiRunContext(contextOrOptions);
  }
  return callback(context);
}

function isPiRunContext(value: unknown): value is PiRunContext {
  try {
    return isObject(value) && PI_RUN_CONTEXTS.has(value);
  } catch {
    return false;
  }
}

export { VistaProtocolError } from "@pi-vista/core";
