import { types } from "node:util";
import { hasKnownCredential, isSafeSegment, VistaProtocolError } from "@pi-vista/core";

/** An existing owner record, never a new task database or an executable path. */
export interface PiWorkRef {
  readonly owner: string;
  readonly kind: "issue" | "change" | "task" | "document";
  readonly key: string;
}

/** One stage and attempt of an existing work item. */
export interface PiWorkBinding {
  readonly workRef: PiWorkRef;
  readonly stageId: string;
  readonly runId: string;
  readonly sessionId: string;
  readonly revision: number;
  readonly headSha?: string;
}

/** @internal Descriptor-only boundary shared by the explicit work adapter. */
export function readWorkMetadata(value: unknown, keys: readonly string[], label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || types.isProxy(value) || Array.isArray(value)
    || Object.getPrototypeOf(value) !== Object.prototype) {
    throw new VistaProtocolError(`${label} must be plain own-data metadata`);
  }
  const ownKeys = Reflect.ownKeys(value);
  if (ownKeys.length > keys.length) throw new VistaProtocolError(`${label} contains unsupported metadata`);
  const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const key of ownKeys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (typeof key !== "string" || !keys.includes(key) || !descriptor || !Object.hasOwn(descriptor, "value")) {
      throw new VistaProtocolError(`${label} contains unsupported metadata`);
    }
    result[key] = descriptor.value;
  }
  return result;
}

/** @internal Snapshot a bounded dense own-data array, never calling an input array method. */
export function readWorkArray(value: unknown, maxLength: number): unknown[] {
  if (value === null || typeof value !== "object" || types.isProxy(value) || !Array.isArray(value)
    || Object.getPrototypeOf(value) !== Array.prototype) {
    throw new VistaProtocolError("work metadata requires an ordinary array");
  }
  const length = Object.getOwnPropertyDescriptor(value, "length")?.value as unknown;
  if (typeof length !== "number" || !Number.isSafeInteger(length) || length < 0 || length > maxLength
    || Reflect.ownKeys(value).length !== length + 1) {
    throw new VistaProtocolError("work metadata array is not bounded and dense");
  }
  const result: unknown[] = [];
  for (let index = 0; index < length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor || !Object.hasOwn(descriptor, "value")) {
      throw new VistaProtocolError("work metadata array contains a hole or accessor");
    }
    result.push(descriptor.value);
  }
  return result;
}

/** @internal An opaque bounded reference; private paths and credential values have no field here. */
export function workIdentifier(value: unknown): string {
  if (!isSafeSegment(value) || value.length > 128 || hasKnownCredential(value)) {
    throw new VistaProtocolError("work reference requires a bounded opaque identifier");
  }
  return value;
}

/** Snapshot a unique owner/kind/key reference without reading a record or invoking getters. */
export function snapshotPiWorkRef(value: unknown): PiWorkRef {
  const data = readWorkMetadata(value, ["owner", "kind", "key"], "work reference");
  if (typeof data.owner !== "string" || data.owner.length > 256
    || !/^[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)?$/u.test(data.owner)
    || data.owner.split("/").some((part) => part === "." || part === "..")
    || hasKnownCredential(data.owner)) {
    throw new VistaProtocolError("work owner requires an explicit namespace");
  }
  if (data.kind !== "issue" && data.kind !== "change" && data.kind !== "task" && data.kind !== "document") {
    throw new VistaProtocolError("work reference kind is not supported");
  }
  return Object.freeze({ owner: data.owner, kind: data.kind, key: workIdentifier(data.key) });
}

/** Compare closed references by owner/kind/key; malformed inputs are never equal. */
export function samePiWorkRef(left: PiWorkRef, right: PiWorkRef): boolean {
  try {
    const a = snapshotPiWorkRef(left);
    const b = snapshotPiWorkRef(right);
    return a.owner === b.owner && a.kind === b.kind && a.key === b.key;
  } catch { return false; }
}

/** Snapshot one work/stage/run/session/revision and optional exact source head. */
export function snapshotPiWorkBinding(value: unknown): PiWorkBinding {
  const data = readWorkMetadata(value, ["workRef", "stageId", "runId", "sessionId", "revision", "headSha"], "work binding");
  if (!Number.isSafeInteger(data.revision) || (data.revision as number) < 0) {
    throw new VistaProtocolError("work revision must be a non-negative safe integer");
  }
  if (data.headSha !== undefined && (typeof data.headSha !== "string" || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u.test(data.headSha))) {
    throw new VistaProtocolError("work source head must be an exact lowercase digest");
  }
  return Object.freeze({
    workRef: snapshotPiWorkRef(data.workRef),
    stageId: workIdentifier(data.stageId),
    runId: workIdentifier(data.runId),
    sessionId: workIdentifier(data.sessionId),
    revision: data.revision as number,
    ...(data.headSha === undefined ? {} : { headSha: data.headSha as string }),
  });
}

/** Exact closed attempt binding, including head; equality is not evidence or permission. */
export function samePiWorkBinding(left: PiWorkBinding, right: PiWorkBinding): boolean {
  try {
    const a = snapshotPiWorkBinding(left);
    const b = snapshotPiWorkBinding(right);
    return a.workRef.owner === b.workRef.owner && a.workRef.kind === b.workRef.kind && a.workRef.key === b.workRef.key
      && a.stageId === b.stageId && a.runId === b.runId && a.sessionId === b.sessionId
      && a.revision === b.revision && a.headSha === b.headSha;
  } catch { return false; }
}
