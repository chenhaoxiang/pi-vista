import { types } from "node:util";
import type { CheckFunctionType, VistaCheckFunction } from "@pi-vista/protocol";
import {
  CheckError, DEFAULT_TIMEOUT_MS, MAX_CHECKS, MAX_DESCRIPTION_LENGTH,
  MAX_LABEL_LENGTH, MAX_PARAM_KEY_LENGTH, MAX_PARAMS, MAX_TIMEOUT_MS,
  type CheckContext, type CheckDefinition, type CheckRunOptions,
} from "./contract.js";

const BUILTIN_TYPES = new Set<string>([
  "path_not_exists", "path_exists", "sha_matches", "branch_not_exists", "branch_exists",
  "worktree_clean", "file_contains", "env_matches", "receipt_present", "test_passed",
]);
const COMMAND_WORDS = new Set([
  "awk", "basename", "bash", "cat", "cd", "chmod", "chown", "command", "cp", "curl",
  "cut", "date", "dd", "diff", "dirname", "docker", "echo", "env", "export", "false",
  "find", "git", "grep", "head", "id", "jq", "kill", "kubectl", "ln", "ls", "make",
  "man", "mkdir", "more", "mv", "node", "npm", "npx", "openssl", "perl", "pip", "pnpm",
  "printf", "ps", "pwd", "pytest", "python", "python3", "read", "realpath", "rev", "rm",
  "rmdir", "scp", "sed", "set", "sh", "sleep", "sort", "source", "ssh", "sudo", "tail",
  "tar", "tee", "test", "time", "touch", "tr", "true", "tsc", "uname", "uniq", "unset",
  "wait", "wc", "wget", "which", "whoami", "xargs", "yarn", "yes", "zip", "zsh",
]);
const CREDENTIAL = /(?:github_pat_[A-Za-z0-9_]{8,}|gh[pousr]_[A-Za-z0-9_]{8,}|sk-[A-Za-z0-9_-]{8,}|xox[baprs]-[A-Za-z0-9-]{8,}|eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}|(?:AKIA|ASIA)[A-Z0-9]{16})/iu;
const RESERVED = new Set(["__proto__", "prototype", "constructor"]);
const DEFINITION_KEYS = new Set(["check_id", "type", "params", "on_fail", "description", "repair_action_id"]);
const CONTEXT_KEYS = new Set(["repo", "task", "branch", "sha"]);
const OPTION_KEYS = new Set(["timeoutMs"]);

function invalid(): never { throw new CheckError("invalid-input"); }

/** Closed ASCII labels, not paths, shell, code, or recognized credential encodings. */
export function safeLabel(value: unknown): value is string {
  return typeof value === "string" && value.length <= MAX_LABEL_LENGTH &&
    /^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(value) &&
    !RESERVED.has(value) && !COMMAND_WORDS.has(value.toLowerCase()) && !CREDENTIAL.test(value);
}

export function safeSha(value: unknown): value is string {
  return typeof value === "string" && /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/iu.test(value);
}

export function safeType(value: unknown): value is CheckFunctionType {
  if (typeof value !== "string") return false;
  if (BUILTIN_TYPES.has(value)) return true;
  if (!value.startsWith("custom:") || value.length > MAX_LABEL_LENGTH || CREDENTIAL.test(value)) return false;
  const suffix = value.slice(7);
  return !COMMAND_WORDS.has(suffix.toLowerCase()) &&
    suffix.split("/").every((segment) => /^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(segment) && !RESERVED.has(segment));
}

function safeParamKey(value: string): boolean {
  return value.length <= MAX_PARAM_KEY_LENGTH && /^[A-Za-z][A-Za-z0-9_]*$/u.test(value) &&
    !RESERVED.has(value) && !COMMAND_WORDS.has(value.toLowerCase()) && !CREDENTIAL.test(value) &&
    !/(?:auth|cookie|credential|password|passwd|secret|token|key|path|shell|command|code|url|uri|href)/iu.test(value.replace(/_/gu, ""));
}

/** No input getters, iterators, coercion or Proxy traps are consulted. */
function ownData(input: unknown, maxKeys: number, allowed?: ReadonlySet<string>): Map<string, unknown> {
  if (types.isProxy(input) || input === null || typeof input !== "object" || Array.isArray(input)) invalid();
  const prototype = Object.getPrototypeOf(input);
  if (prototype !== Object.prototype && prototype !== null) invalid();
  const keys = Reflect.ownKeys(input);
  if (keys.length > maxKeys) invalid();
  const values = new Map<string, unknown>();
  for (const key of keys) {
    if (typeof key !== "string" || (allowed !== undefined && !allowed.has(key))) invalid();
    const descriptor = Object.getOwnPropertyDescriptor(input, key);
    if (descriptor === undefined || !Object.hasOwn(descriptor, "value") || descriptor.value === undefined) invalid();
    values.set(key, descriptor.value);
  }
  return values;
}

function frozenData<T>(values: ReadonlyMap<string, unknown>): T {
  const snapshot = Object.create(null) as Record<string, unknown>;
  for (const [key, value] of values) snapshot[key] = value;
  return Object.freeze(snapshot) as T;
}

function snapshotContext(input: unknown): Readonly<CheckContext> {
  const values = ownData(input, CONTEXT_KEYS.size, CONTEXT_KEYS);
  for (const [key, value] of values) if (!(key === "sha" ? safeSha(value) : safeLabel(value))) invalid();
  return frozenData<Readonly<CheckContext>>(values);
}

function snapshotOptions(input: unknown): number {
  const values = ownData(input, OPTION_KEYS.size, OPTION_KEYS);
  const timeout = values.get("timeoutMs");
  if (!values.has("timeoutMs")) return DEFAULT_TIMEOUT_MS;
  if (typeof timeout !== "number" || !Number.isInteger(timeout) || timeout < 1 || timeout > MAX_TIMEOUT_MS) invalid();
  return timeout;
}

function snapshotParams(input: unknown, context: Readonly<CheckContext>): Readonly<Record<string, string>> {
  const values = ownData(input, MAX_PARAMS);
  for (const [key, rawValue] of values) {
    if (!safeParamKey(key) || typeof rawValue !== "string") invalid();
    let value = rawValue;
    // Only whole values may bind; other braces fail the closed label grammar.
    if (/^\{(?:repo|task|branch|sha)\}$/u.test(value)) {
      const binding = value.slice(1, -1) as keyof CheckContext;
      const resolved = context[binding];
      if (resolved === undefined) invalid();
      value = resolved;
    }
    if (!safeLabel(value)) invalid();
    values.set(key, value);
  }
  return frozenData<Readonly<Record<string, string>>>(values);
}

function snapshotDefinition(input: unknown, context: Readonly<CheckContext>): CheckDefinition {
  const values = ownData(input, DEFINITION_KEYS.size, DEFINITION_KEYS);
  if (!safeLabel(values.get("check_id")) || !safeType(values.get("type"))) invalid();
  const onFail = values.get("on_fail");
  if (onFail === "REPAIR") throw new CheckError("unsupported-repair");
  if (onFail !== "STOP" && onFail !== "WARN") invalid();
  if (values.has("repair_action_id") && !safeLabel(values.get("repair_action_id"))) invalid();
  if (values.has("description")) {
    const description = values.get("description");
    if (typeof description !== "string" || description.length > MAX_DESCRIPTION_LENGTH ||
      !description.split(" ").every(safeLabel)) invalid();
  }
  values.set("params", snapshotParams(values.get("params"), context));
  return frozenData<CheckDefinition>(values);
}

function snapshotDefinitions(input: readonly VistaCheckFunction[], context: Readonly<CheckContext>): readonly CheckDefinition[] {
  if (types.isProxy(input) || !Array.isArray(input) || Object.getPrototypeOf(input) !== Array.prototype) invalid();
  const lengthDescriptor = Object.getOwnPropertyDescriptor(input, "length");
  if (lengthDescriptor === undefined || !Object.hasOwn(lengthDescriptor, "value")) invalid();
  const length: unknown = lengthDescriptor.value;
  if (typeof length !== "number" || !Number.isInteger(length) || length < 1 || length > MAX_CHECKS) invalid();
  if (Reflect.ownKeys(input).length !== length + 1) invalid();
  const definitions: CheckDefinition[] = [];
  const ids = new Set<string>();
  for (let index = 0; index < length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(input, String(index));
    if (descriptor === undefined || !Object.hasOwn(descriptor, "value")) invalid();
    const definition = snapshotDefinition(descriptor.value, context);
    if (ids.has(definition.check_id)) invalid();
    ids.add(definition.check_id);
    definitions.push(definition);
  }
  return Object.freeze(definitions);
}

export function snapshotRun(definitions: readonly VistaCheckFunction[], context: CheckContext, options: CheckRunOptions): {
  readonly definitions: readonly CheckDefinition[];
  readonly context: Readonly<CheckContext>;
  readonly timeoutMs: number;
} {
  try {
    const contextSnapshot = snapshotContext(context);
    const timeoutMs = snapshotOptions(options);
    return Object.freeze({ definitions: snapshotDefinitions(definitions, contextSnapshot), context: contextSnapshot, timeoutMs });
  } catch (error) {
    if (error instanceof CheckError) throw error;
    return invalid();
  }
}
