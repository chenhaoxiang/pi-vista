import { randomUUID } from "node:crypto";
import { appendFile, mkdir, readdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import type { VistaCheckpoint, VistaEvent } from "@pi-vista/protocol";
import { redactAll } from "./redact.js";
import { assertSafeSegment, isSafeSegment } from "./path-safe.js";
import { assertVistaCheckpoint, assertVistaEvent, isVistaCheckpoint, isVistaEvent } from "./validation.js";

const EVENTS_FILE = "events.jsonl";
const CHECKPOINTS_DIR = "checkpoints";

export interface StoreOptions {
  baseDir?: string;
}

export function defaultBaseDir(): string {
  return join(homedir(), ".pi", "vista");
}

function safeSegment(value: string, label: string): string {
  return assertSafeSegment(value, label);
}

function reportFailure(operation: string): void {
  // Keep diagnostics deliberately generic: an error object may contain a
  // filesystem path or another value that must not be surfaced by a logger.
  try {
    console.error(`[pi-vista] ${operation} failed`);
  } catch {
    // Logging must not turn a best-effort write into a caller-visible failure.
  }
}

function parseJsonLines(contents: string): unknown[] {
  const values: unknown[] = [];
  for (const line of contents.split("\n")) {
    if (line.trim().length === 0) {
      continue;
    }
    try {
      values.push(JSON.parse(line) as unknown);
    } catch {
      // A truncated final line or an older malformed record must not make
      // otherwise readable history unavailable.
    }
  }
  return values;
}

function parseEvent(value: unknown): VistaEvent | undefined {
  if (!isVistaEvent(value) || !isSafeSegment(value.run_id) || !isSafeSegment(value.step_id)) {
    return undefined;
  }
  try {
    const redacted = redactAll(value) as unknown;
    return isVistaEvent(redacted) ? redacted : undefined;
  } catch {
    return undefined;
  }
}

function parseCheckpoint(value: unknown): VistaCheckpoint | undefined {
  if (!isVistaCheckpoint(value) || !isSafeSegment(value.run_id) || !isSafeSegment(value.step_id)) {
    return undefined;
  }
  try {
    const redacted = redactAll(value) as unknown;
    return isVistaCheckpoint(redacted) ? redacted : undefined;
  } catch {
    return undefined;
  }
}

/** Append-only local JSONL event storage. All write failures are fail-open. */
export class EventStore {
  readonly baseDir: string;

  constructor(baseDirOrOptions: string | StoreOptions = {}) {
    const baseDir = typeof baseDirOrOptions === "string"
      ? baseDirOrOptions
      : (baseDirOrOptions.baseDir ?? defaultBaseDir());
    this.baseDir = resolve(baseDir);
  }

  runDir(runId: string): string {
    return join(this.baseDir, "runs", safeSegment(runId, "runId"));
  }

  async append(event: VistaEvent): Promise<void> {
    assertVistaEvent(event);
    let redacted: VistaEvent;
    try {
      redacted = redactAll(event) as VistaEvent;
    } catch {
      reportFailure("event append");
      return;
    }
    assertVistaEvent(redacted);
    try {
      const runId = safeSegment(redacted.run_id, "runId");
      const directory = this.runDir(runId);
      await mkdir(directory, { recursive: true });
      await appendFile(join(directory, EVENTS_FILE), `${JSON.stringify(redacted)}\n`, "utf8");
    } catch {
      reportFailure("event append");
    }
  }

  async readRun(runId: string): Promise<VistaEvent[]> {
    try {
      const contents = await readFile(join(this.runDir(runId), EVENTS_FILE), "utf8");
      return parseJsonLines(contents)
        .map(parseEvent)
        .filter((event): event is VistaEvent => event !== undefined && event.run_id === runId);
    } catch {
      return [];
    }
  }

  async listRuns(): Promise<string[]> {
    try {
      const entries = await readdir(join(this.baseDir, "runs"), { withFileTypes: true });
      return entries
        .filter((entry) => entry.isDirectory() && isSafeSegment(entry.name))
        .map((entry) => entry.name)
        .sort();
    } catch {
      return [];
    }
  }
}

/** JSON checkpoint storage colocated with the event stream for each run. */
export class CheckpointStore {
  readonly baseDir: string;

  constructor(baseDirOrOptions: string | StoreOptions = {}) {
    const baseDir = typeof baseDirOrOptions === "string"
      ? baseDirOrOptions
      : (baseDirOrOptions.baseDir ?? defaultBaseDir());
    this.baseDir = resolve(baseDir);
  }

  private runDir(runId: string): string {
    return join(this.baseDir, "runs", safeSegment(runId, "runId"));
  }

  private checkpointsDir(runId: string): string {
    return join(this.runDir(runId), CHECKPOINTS_DIR);
  }

  async save(checkpoint: VistaCheckpoint): Promise<void> {
    assertVistaCheckpoint(checkpoint);
    let redacted: VistaCheckpoint;
    try {
      redacted = redactAll(checkpoint) as VistaCheckpoint;
    } catch {
      reportFailure("checkpoint save");
      return;
    }
    assertVistaCheckpoint(redacted);
    let temporaryPath: string | undefined;
    try {
      const runId = safeSegment(redacted.run_id, "runId");
      const stepId = safeSegment(redacted.step_id, "stepId");
      const directory = join(this.baseDir, "runs", runId, CHECKPOINTS_DIR);
      await mkdir(directory, { recursive: true });
      const finalPath = join(directory, `${stepId}.json`);
      // Keep the temporary file beside the destination so rename is atomic on
      // the same filesystem. The name contains only safe path-segment chars.
      temporaryPath = join(directory, `.${stepId}.${randomUUID()}.tmp`);
      await writeFile(temporaryPath, `${JSON.stringify(redacted, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
      await rename(temporaryPath, finalPath);
      temporaryPath = undefined;
    } catch {
      reportFailure("checkpoint save");
    } finally {
      if (temporaryPath !== undefined) {
        try {
          await unlink(temporaryPath);
        } catch {
          // The write may have failed before creating the temporary file.
        }
      }
    }
  }

  /** Return a checkpoint, or null when it is missing or cannot be parsed. */
  async load(runId: string, stepId: string): Promise<VistaCheckpoint | null> {
    try {
      const contents = await readFile(join(this.checkpointsDir(runId), `${safeSegment(stepId, "stepId")}.json`), "utf8");
      const checkpoint = parseCheckpoint(JSON.parse(contents) as unknown);
      return checkpoint !== undefined && checkpoint.run_id === runId && checkpoint.step_id === stepId
        ? checkpoint
        : null;
    } catch {
      return null;
    }
  }

  /** Return stored checkpoint step IDs in stable lexicographic order. */
  async listCheckpoints(runId: string): Promise<string[]> {
    try {
      const entries = await readdir(this.checkpointsDir(runId), { withFileTypes: true });
      return entries
        .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
        .map((entry) => entry.name.slice(0, -".json".length))
        .filter((stepId) => isSafeSegment(stepId))
        .sort();
    } catch {
      return [];
    }
  }
}
