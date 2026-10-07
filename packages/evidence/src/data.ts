import { types } from "node:util";
import { hasKnownCredential, isSafeSegment } from "@pi-vista/core";

export class EvidenceError extends Error {
  constructor(readonly code: "invalid-input" | "invalid-config" | "unverified-evidence" | "evidence-timeout") {
    super(code); this.name = "EvidenceError"; this.stack = `${this.name}: ${code}`;
  }
}
export function fail(): never { throw new EvidenceError("invalid-input"); }

/** Inspect only own data, never getters, proxy traps, iterators or coercion. */
export function own(input: unknown, allowed: readonly string[], required: readonly string[] = allowed): Record<string, unknown> {
  if (types.isProxy(input) || input === null || typeof input !== "object" || Array.isArray(input)) fail();
  const proto = Object.getPrototypeOf(input);
  if (proto !== Object.prototype && proto !== null) fail();
  const keys = Reflect.ownKeys(input);
  if (keys.length > allowed.length) fail();
  const out = Object.create(null) as Record<string, unknown>;
  for (const key of keys) {
    if (typeof key !== "string" || !allowed.includes(key)) fail();
    const d = Object.getOwnPropertyDescriptor(input, key);
    if (!d || !Object.hasOwn(d, "value") || d.value === undefined) fail();
    out[key] = d.value;
  }
  if (!required.every(key => Object.hasOwn(out, key))) fail();
  return out;
}
export function list(input: unknown, max = 32, min = 1): unknown[] {
  if (types.isProxy(input) || !Array.isArray(input) || Object.getPrototypeOf(input) !== Array.prototype) fail();
  const d = Object.getOwnPropertyDescriptor(input, "length");
  if (!d || !Object.hasOwn(d, "value") || !Number.isInteger(d.value) || d.value < min || d.value > max) fail();
  if (Reflect.ownKeys(input).length !== d.value + 1) fail();
  const out: unknown[] = [];
  for (let i = 0; i < d.value; i++) {
    const item = Object.getOwnPropertyDescriptor(input, String(i));
    if (!item || !Object.hasOwn(item, "value")) fail();
    out.push(item.value);
  }
  return out;
}
export function label(input: unknown): string {
  if (typeof input !== "string" || input.length > 128 || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(input) ||
      !isSafeSegment(input) || hasKnownCredential(input)) fail();
  return input;
}
export function sha(input: unknown): string {
  if (typeof input !== "string" || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/iu.test(input)) fail();
  return input.toLowerCase();
}
export function digest(input: unknown): string {
  const value = sha(input); if (value.length !== 64) fail(); return value;
}
export function integer(input: unknown, max = Number.MAX_SAFE_INTEGER, min = 0): number {
  if (typeof input !== "number" || !Number.isSafeInteger(input) || input < min || input > max) fail();
  return input;
}
export function labels(input: unknown): readonly string[] {
  const values = list(input).map(label); if (new Set(values).size !== values.length) fail();
  return Object.freeze(values);
}
export function freeze<T extends object>(value: T): Readonly<T> { return Object.freeze(value); }

/** Serialize validated snapshots, not source objects or their toJSON methods. */
export function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) as string;
  if (Array.isArray(value)) {
    const parts: string[] = []; for (let i = 0; i < value.length; i++) parts.push(canonical(value[i]));
    return `[${parts.join(",")}]`;
  }
  const parts: string[] = [];
  for (const key of Object.keys(value).sort()) parts.push(`${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`);
  return `{${parts.join(",")}}`;
}

export interface EvidenceBinding {
  readonly run_id: string;
  readonly repo: string;
  readonly source_sha: string;
  readonly policy_version: string;
  readonly env_fingerprint: string;
}
export const BINDING_KEYS = ["run_id", "repo", "source_sha", "policy_version", "env_fingerprint"] as const;
export function binding(input: unknown): EvidenceBinding {
  const v = own(input, BINDING_KEYS);
  return freeze({ run_id: label(v.run_id), repo: label(v.repo), source_sha: sha(v.source_sha),
    policy_version: label(v.policy_version), env_fingerprint: label(v.env_fingerprint) });
}
export function sameBinding(a: EvidenceBinding, b: EvidenceBinding): boolean {
  return BINDING_KEYS.every(key => a[key] === b[key]);
}

/** Trusted native-promise transport; abort/timeout is not a synchronous sandbox. */
export function bounded<T>(call: (signal: AbortSignal) => Promise<T>, ms: number, parent?: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const controller = new AbortController(); const start = performance.now();
    let done = false;
    const finish = (ok: boolean, value?: T): void => {
      if (done) return; done = true; clearTimeout(timer); parent?.removeEventListener("abort", abort);
      if (!ok || performance.now() - start > ms || controller.signal.aborted) {
        controller.abort(); reject(new EvidenceError(ok ? "evidence-timeout" : "unverified-evidence"));
      } else resolve(value as T);
    };
    const abort = (): void => finish(false);
    const timer = setTimeout(() => { if (!done) { finish(false); } }, ms);
    parent?.addEventListener("abort", abort, { once: true });
    if (parent?.aborted) { abort(); return; }
    try {
      const promise = call(controller.signal);
      if (!types.isPromise(promise)) { finish(false); return; }
      Promise.prototype.then.call(promise, (value: T) => finish(true, value), () => finish(false));
    } catch { finish(false); }
  });
}
