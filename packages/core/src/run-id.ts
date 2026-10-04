import { randomBytes } from "node:crypto";

const RUN_ID_ENV = "VISTA_RUN_ID";

/**
 * Generate a run identifier that is sortable by creation time and safe to use
 * as a directory name.
 */
export function generateRunId(): string {
  const timestamp = Date.now().toString(36);
  const random = randomBytes(4).toString("hex");
  return `vr_${timestamp}_${random}`;
}

/**
 * Generate a deterministic step identifier for a run sequence number.
 * Base-36 keeps identifiers compact while retaining their ordering.
 */
export function generateStepId(runId: string, seq: number): string {
  if (runId.length === 0 || /[\\/]/u.test(runId)) {
    throw new TypeError("runId must be a non-empty path-safe string");
  }
  if (!Number.isInteger(seq) || seq < 0) {
    throw new TypeError("seq must be a non-negative integer");
  }

  return `${runId}_s${seq.toString(36)}`;
}

/**
 * Read the current run ID, returning undefined without changing process.env.
 */
export function currentRunId(): string | undefined {
  const value = process.env[RUN_ID_ENV];
  return value && value.length > 0 ? value : undefined;
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
