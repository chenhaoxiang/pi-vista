import { randomBytes } from "node:crypto";
import { types } from "node:util";
import { hasKnownCredential } from "./credential.js";
import { assertSafeSegment, isSafeSegment } from "./path-safe.js";

const RUN_ID_ENV = "VISTA_RUN_ID";

export { assertSafeSegment, isSafeSegment } from "./path-safe.js";

function ownEnvironmentValue(key: string): unknown {
  try {
    const processDescriptor = Object.getOwnPropertyDescriptor(process, "env");
    if (processDescriptor === undefined || !Object.hasOwn(processDescriptor, "value")) {
      return undefined;
    }
    const environment = processDescriptor.value;
    if (environment === null || typeof environment !== "object" || types.isProxy(environment)) {
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

function setOwnEnvironmentValue(key: string, value: string): void {
  try {
    const processDescriptor = Object.getOwnPropertyDescriptor(process, "env");
    if (processDescriptor === undefined || !Object.hasOwn(processDescriptor, "value")) {
      return;
    }
    const environment = processDescriptor.value;
    if (environment === null || typeof environment !== "object" || types.isProxy(environment)) {
      return;
    }
    Object.defineProperty(environment, key, {
      value,
      writable: true,
      enumerable: true,
      configurable: true,
    });
  } catch {
    // A replaced or hostile process.env must not prevent a safe in-memory ID
    // from being returned to the caller.
  }
}

/**
 * Generate a run identifier that is sortable by creation time and safe to use
 * as a directory name.
 */
export function generateRunId(): string {
  const timestamp = Date.now().toString(36);
  const random = randomBytes(4).toString("hex");
  return assertSafeSegment(`vr_${timestamp}_${random}`, "runId");
}

/**
 * Generate a deterministic step identifier for a run sequence number.
 * Base-36 keeps identifiers compact. Checkpoint listing is lexicographic,
 * not a claim of numeric or timestamp ordering.
 */
export function generateStepId(runId: string, seq: number): string {
  assertSafeSegment(runId, "runId");
  if (hasKnownCredential(runId)) {
    throw new TypeError("runId must not contain a known credential signature");
  }
  if (!Number.isInteger(seq) || seq < 0) {
    throw new TypeError("seq must be a non-negative integer");
  }

  const stepId = `${runId}_s${seq.toString(36)}`;
  assertSafeSegment(stepId, "stepId");
  return stepId;
}

/**
 * Read the current run ID, returning undefined without changing process.env.
 */
export function currentRunId(): string | undefined {
  const value = ownEnvironmentValue(RUN_ID_ENV);
  return isSafeSegment(value) && !hasKnownCredential(value) ? value : undefined;
}

/**
 * Return the current run ID or create one for this process when none exists.
 */
export function getOrCreateRunId(): string {
  const existing = currentRunId();
  if (existing !== undefined) {
    return existing;
  }

  const runId = generateRunId();
  setOwnEnvironmentValue(RUN_ID_ENV, runId);
  return runId;
}
