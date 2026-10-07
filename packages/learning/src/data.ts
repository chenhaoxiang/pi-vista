import { createHash } from "node:crypto";
import { types } from "node:util";
import { hasKnownCredential } from "@pi-vista/core";
import type { EvidenceBinding } from "@pi-vista/evidence";
import { LearningError, MAX_LABEL_LENGTH, MAX_METADATA_CHARACTERS, type RetrievalBinding } from "./contract.js";

const RESERVED = new Set(["__proto__", "prototype", "constructor"]);
const COMMAND_WORDS = new Set([
  "awk", "basename", "bash", "cat", "cd", "chmod", "chown", "command", "cp", "curl", "cut", "date", "dd", "diff",
  "dirname", "docker", "echo", "env", "export", "false", "find", "git", "grep", "head", "id", "jq", "kill", "kubectl",
  "ln", "ls", "make", "man", "mkdir", "more", "mv", "node", "npm", "npx", "openssl", "perl", "pip", "pnpm", "printf",
  "ps", "pwd", "pytest", "python", "python3", "read", "realpath", "rev", "rm", "rmdir", "scp", "sed", "set", "sh",
  "sleep", "sort", "source", "ssh", "sudo", "tail", "tar", "tee", "test", "time", "touch", "tr", "true", "tsc",
  "uname", "uniq", "unset", "wait", "wc", "wget", "which", "whoami", "xargs", "yarn", "yes", "zip", "zsh",
]);
export function invalid(): never { throw new LearningError("invalid-input"); }

/** Node-detectable proxies are rejected before any reflective operation. */
export function own(input: unknown, allowed: readonly string[], required: readonly string[] = allowed): Record<string, unknown> {
  if (types.isProxy(input) || input === null || typeof input !== "object" || Array.isArray(input)) invalid();
  const proto = Object.getPrototypeOf(input);
  if (proto !== Object.prototype && proto !== null) invalid();
  const keys = Reflect.ownKeys(input);
  if (keys.length > allowed.length) invalid();
  const out = Object.create(null) as Record<string, unknown>;
  for (const key of keys) {
    if (typeof key !== "string" || !allowed.includes(key)) invalid();
    const d = Object.getOwnPropertyDescriptor(input, key);
    if (!d || !Object.hasOwn(d, "value") || d.value === undefined) invalid();
    out[key] = d.value;
  }
  if (!required.every(key => Object.hasOwn(out, key))) invalid();
  return out;
}
export function list(input: unknown, max: number, min = 0): unknown[] {
  if (types.isProxy(input) || !Array.isArray(input) || Object.getPrototypeOf(input) !== Array.prototype) invalid();
  const length = Object.getOwnPropertyDescriptor(input, "length");
  if (!length || !Object.hasOwn(length, "value")) invalid();
  const count = integer(length.value, max, min);
  if (Reflect.ownKeys(input).length !== count + 1) invalid();
  const out: unknown[] = [];
  for (let i = 0; i < count; i++) {
    const item = Object.getOwnPropertyDescriptor(input, String(i));
    if (!item || !Object.hasOwn(item, "value") || item.value === undefined) invalid();
    out.push(item.value);
  }
  return out;
}
export function label(input: unknown): string {
  if (typeof input !== "string" || input.length > MAX_LABEL_LENGTH || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(input) ||
    RESERVED.has(input.toLowerCase()) || COMMAND_WORDS.has(input.toLowerCase()) || hasKnownCredential(input) || /(?:AKIA|ASIA)[A-Z0-9]{16}/u.test(input)) invalid();
  return input;
}
export function metadata(input: unknown): string {
  if (typeof input !== "string" || input.length > MAX_METADATA_CHARACTERS) invalid();
  input.split(" ").forEach(label);
  return input;
}
export function sha(input: unknown): string {
  if (typeof input !== "string" || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/iu.test(input)) invalid();
  return input.toLowerCase();
}
export function digest(input: unknown): string {
  const value = sha(input); if (value.length !== 64) invalid(); return value;
}
export function integer(input: unknown, max = Number.MAX_SAFE_INTEGER, min = 0): number {
  if (typeof input !== "number" || !Number.isSafeInteger(input) || input < min || input > max) invalid(); return input;
}
export function choice<T extends string>(input: unknown, choices: readonly T[]): T {
  if (typeof input !== "string" || !choices.includes(input as T)) invalid(); return input as T;
}
export function labels(input: unknown, max: number, min = 0): readonly string[] {
  const out = list(input, max, min).map(label);
  if (new Set(out).size !== out.length) invalid(); return frozen(out);
}
/** Use only on generated records/arrays, never unvalidated source objects. */
export function frozen<T extends object>(value: T): Readonly<T> {
  return Object.freeze(Array.isArray(value) ? value : Object.assign(Object.create(null), value)) as Readonly<T>;
}
export const BINDING_KEYS = ["run_id", "repo", "source_sha", "policy_version", "env_fingerprint"] as const;
export const RETRIEVAL_KEYS = ["repo", "source_sha", "policy_version", "env_fingerprint"] as const;
export function binding(input: unknown): EvidenceBinding {
  const v = own(input, BINDING_KEYS);
  return frozen({ run_id: label(v.run_id), ...retrievalBinding(v) });
}
/** Internal projection from an already detached record. */
export function retrievalBinding(v: Record<string, unknown>): RetrievalBinding {
  return frozen({ repo: label(v.repo), source_sha: sha(v.source_sha), policy_version: label(v.policy_version), env_fingerprint: label(v.env_fingerprint) });
}
export function sameBinding(a: EvidenceBinding, b: EvidenceBinding): boolean { return BINDING_KEYS.every(key => a[key] === b[key]); }
export function sameRetrievalBinding(a: RetrievalBinding, b: RetrievalBinding): boolean { return RETRIEVAL_KEYS.every(key => a[key] === b[key]); }
export function bindingOf(v: EvidenceBinding): EvidenceBinding {
  return binding({ run_id: v.run_id, repo: v.repo, source_sha: v.source_sha, policy_version: v.policy_version, env_fingerprint: v.env_fingerprint });
}
/** Canonicalize only validated, detached data; no source iterators or toJSON hooks. */
export function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) as string;
  if (Array.isArray(value)) {
    const parts: string[] = []; for (let i = 0; i < value.length; i++) parts.push(canonical(value[i]));
    return `[${parts.join(",")}]`;
  }
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(",")}}`;
}
export function hash(content: string): string { return createHash("sha256").update(content, "utf8").digest("hex"); }

/** Bounds waits and consumes late rejection; cannot sandbox or undo trusted callback effects. */
export function bounded<T extends object>(call: (signal: AbortSignal) => Promise<unknown>, ms: number, inspect: (value: unknown) => T): Promise<T> {
  return new Promise((resolve, reject) => {
    const controller = new AbortController(); const start = performance.now(); let done = false;
    const finish = (ok: boolean, value?: T, code: "sink-failed" | "sink-timeout" | "sink-mismatch" = "sink-failed"): void => {
      if (done) return; done = true; clearTimeout(timer);
      if (!ok || performance.now() - start > ms) {
        controller.abort(); reject(new LearningError(ok ? "sink-timeout" : code));
      } else resolve(value as T);
    };
    const timer = setTimeout(() => finish(false, undefined, "sink-timeout"), ms);
    try {
      const promise = call(controller.signal);
      if (types.isProxy(promise) || !types.isPromise(promise)) { finish(false); return; }
      Promise.prototype.then.call(promise, (value: unknown) => {
        if (done) return;
        try { finish(true, inspect(value)); } catch { finish(false, undefined, "sink-mismatch"); }
      }, () => finish(false));
    } catch { finish(false); }
  });
}
