import { randomBytes } from "node:crypto";
import { assertSafeSegment, isSafeSegment } from "./path-safe.js";

const RUN_ID_ENV = "VISTA_RUN_ID";

export { assertSafeSegment, isSafeSegment } from "./path-safe.js";

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
  const value = process.env[RUN_ID_ENV];
  return isSafeSegment(value) ? value : undefined;
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
  process.env[RUN_ID_ENV] = runId;
  return runId;
}
