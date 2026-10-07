import { types } from "node:util";
import { isAbsolute, parse, resolve } from "node:path";
import { hasKnownCredential, isSafeSegment } from "@pi-vista/core";
import { CheckRegistry, MAX_CHECKS, MAX_LABEL_LENGTH } from "@pi-vista/checks";

export const MAX_ROOTS = 16;
export const MAX_REPOSITORIES = 32;
export const MAX_SUBJECTS = 64;
export const MAX_RELATIVE_LENGTH = 1_024;
export const MAX_PATH_DEPTH = 32;
export const GIT_TIMEOUT_MS = 2_000;
export const GIT_MAX_BUFFER = 65_536;

/** Host-private, never a VistaCheckFunction parameter or serialized context. */
export interface LocalTarget {
  readonly root: string;
  readonly relativePath: string;
}

export interface LocalBranch {
  readonly repo: string;
  readonly ref: string;
}

export interface LocalCheckConfig {
  readonly roots: Readonly<Record<string, string>>;
  readonly repositories: Readonly<Record<string, LocalTarget>>;
  readonly targets: Readonly<Record<string, LocalTarget>>;
  readonly branches: Readonly<Record<string, LocalBranch>>;
  /** Absolute path to a trusted host Git executable, not a sandboxed binary. */
  readonly gitExecutable: string;
}

export class LocalCheckError extends Error {
  constructor(readonly code: "invalid-config" | "probe-failed") {
    super(code === "invalid-config" ? "invalid local check configuration" : "local check probe failed");
    this.name = "LocalCheckError";
    this.stack = `${this.name}: ${this.message}`;
  }
}

export function fail(): never { throw new LocalCheckError("probe-failed"); }
function invalid(): never { throw new LocalCheckError("invalid-config"); }

export interface ConfigSnapshot {
  readonly roots: ReadonlyMap<string, string>;
  readonly repositories: ReadonlyMap<string, LocalTarget>;
  readonly targets: ReadonlyMap<string, LocalTarget>;
  readonly branches: ReadonlyMap<string, LocalBranch>;
  readonly gitExecutable: string;
}

// Source objects are inspected once, without getters, iterators or Proxy traps.
function ownData(input: unknown, limit: number, allowed?: readonly string[]): Map<string, unknown> {
  if (types.isProxy(input) || input === null || typeof input !== "object" || Array.isArray(input)) invalid();
  const prototype = Object.getPrototypeOf(input);
  if (prototype !== Object.prototype && prototype !== null) invalid();
  const keys = Reflect.ownKeys(input);
  if (keys.length > limit) invalid();
  const values = new Map<string, unknown>();
  for (const key of keys) {
    if (typeof key !== "string" || (allowed !== undefined && !allowed.includes(key))) invalid();
    const descriptor = Object.getOwnPropertyDescriptor(input, key);
    if (descriptor === undefined || !Object.hasOwn(descriptor, "value") || descriptor.value === undefined) invalid();
    values.set(key, descriptor.value);
  }
  return values;
}

function absolutePath(value: unknown): value is string {
  return typeof value === "string" && value.length > 1 && value.length <= 4_096 &&
    !/[\p{Cc}\p{Cf}\\]/u.test(value) && isAbsolute(value) &&
    parse(value).root !== value && resolve(value) === value;
}

export function relativeParts(value: string): readonly string[] {
  if (value === ".") return Object.freeze([]);
  const parts = value.split("/");
  if (value.length === 0 || value.length > MAX_RELATIVE_LENGTH || parts.length > MAX_PATH_DEPTH ||
    !parts.every((part) => part.length <= 128 && /^[A-Za-z0-9._-]+$/u.test(part) && part !== "." && part !== "..")) invalid();
  return Object.freeze(parts);
}

export function fullBranchRef(value: unknown): value is string {
  if (typeof value !== "string" || value.length > MAX_RELATIVE_LENGTH || !value.startsWith("refs/heads/")) return false;
  const parts = value.slice(11).split("/");
  return parts.length <= MAX_PATH_DEPTH && parts.every((part) =>
    part.length <= 128 && /^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(part) &&
    !part.includes("..") && !part.endsWith(".") && !part.endsWith(".lock"));
}

/** Snapshot all private input before the first asynchronous validation step. No I/O. */
export async function snapshotConfig(input: LocalCheckConfig): Promise<ConfigSnapshot> {
  try {
    const fields = ownData(input, 5, ["roots", "repositories", "targets", "branches", "gitExecutable"]);
    if (fields.size !== 5 || !absolutePath(fields.get("gitExecutable"))) invalid();
    const labels: string[] = [];
    const label = (value: unknown): string => {
      if (typeof value !== "string" || value.length > MAX_LABEL_LENGTH || !isSafeSegment(value) || hasKnownCredential(value)) invalid();
      labels.push(value);
      return value;
    };
    const roots = new Map<string, string>();
    for (const [alias, path] of ownData(fields.get("roots"), MAX_ROOTS)) {
      label(alias);
      if (!absolutePath(path)) invalid();
      roots.set(alias, path);
    }
    if (roots.size === 0) invalid();
    const targets = (source: unknown, limit: number): ReadonlyMap<string, LocalTarget> => {
      const result = new Map<string, LocalTarget>();
      for (const [alias, target] of ownData(source, limit)) {
        label(alias);
        const values = ownData(target, 2, ["root", "relativePath"]);
        const root = label(values.get("root"));
        const relativePath = values.get("relativePath");
        if (values.size !== 2 || !roots.has(root) || typeof relativePath !== "string") invalid();
        relativeParts(relativePath);
        result.set(alias, Object.freeze({ root, relativePath }));
      }
      return result;
    };
    const repositories = targets(fields.get("repositories"), MAX_REPOSITORIES);
    const targetMap = targets(fields.get("targets"), MAX_SUBJECTS);
    const branches = new Map<string, LocalBranch>();
    for (const [alias, branch] of ownData(fields.get("branches"), MAX_SUBJECTS)) {
      label(alias);
      const values = ownData(branch, 2, ["repo", "ref"]);
      const repo = label(values.get("repo"));
      const ref = values.get("ref");
      if (values.size !== 2 || !repositories.has(repo) || !fullBranchRef(ref)) invalid();
      branches.set(alias, Object.freeze({ repo, ref }));
    }
    // The public base runner is the authority for its narrower opaque-label grammar
    // (including command words). Do not fork or relax its private validation rules.
    const validator = new CheckRegistry();
    for (let start = 0; start < labels.length; start += MAX_CHECKS) {
      await validator.run(labels.slice(start, start + MAX_CHECKS).map((subject, index) => ({
        check_id: `local-label-${index}`, type: "path_exists", params: { subject }, on_fail: "STOP",
      })));
    }
    return Object.freeze({ roots, repositories, targets: targetMap, branches, gitExecutable: fields.get("gitExecutable") as string });
  } catch {
    return invalid();
  }
}
