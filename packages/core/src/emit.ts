import type { VistaComponent, VistaEvent, VistaResult } from "@pi-vista/protocol";
import { VISTA_PROTOCOL_VERSION } from "@pi-vista/protocol";
import { getOrCreateRunId, generateStepId, isSafeSegment } from "./run-id.js";
import { hasKnownCredential } from "./credential.js";
import { redactAll } from "./redact.js";
import { EventStore } from "./store.js";
import { assertVistaEvent, VistaProtocolError } from "./validation.js";

const DEFAULT_PERSIST_TIMEOUT_MS = 250;

export interface EmitOptions {
  /** Store to use; omitted means a store rooted at baseDir (or the default). */
  store?: Pick<EventStore, "append">;
  baseDir?: string;
  runId?: string;
  stepId?: string;
  seq?: number;
  now?: number | (() => number);
  clock?: () => number;
  /**
   * Maximum time spent awaiting Store.append. Defaults to 250 ms so a broken
   * observer cannot block the operation being observed. A timeout is fail-open.
   */
  persistTimeoutMs?: number;
}

export type VistaEventInput = Partial<VistaEvent>;

export type VistaEmitter = (
  partial: VistaEventInput,
  options?: EmitOptions,
) => Promise<VistaEvent | undefined>;

const nextSequences = new Map<string, number>();

function nextSequence(runId: string): number {
  const sequence = nextSequences.get(runId) ?? 0;
  nextSequences.set(runId, sequence + 1);
  return sequence;
}

function reportFailure(): void {
  try {
    console.error("[pi-vista] event emission failed");
  } catch {
    // Logging must not turn a best-effort emission into a caller-visible failure.
  }
}

function persistTimeout(options: EmitOptions): number {
  const value = options.persistTimeoutMs ?? DEFAULT_PERSIST_TIMEOUT_MS;
  return Number.isFinite(value) && value >= 0 ? value : DEFAULT_PERSIST_TIMEOUT_MS;
}

async function appendWithTimeout(
  store: Pick<EventStore, "append">,
  event: VistaEvent,
  timeoutMs: number,
): Promise<void> {
  // Attach a rejection handler immediately. The append may settle after the
  // timeout, but it must never become an unhandled rejection.
  const appendPromise = Promise.resolve().then(() => store.append(event));
  appendPromise.catch(() => undefined);

  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, timeoutMs);
  });
  try {
    await Promise.race([appendPromise, timeoutPromise]);
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  }
}

/**
 * Build, redact, and persist one VistaEvent. Invalid protocol input rejects
 * with VistaProtocolError. Store I/O failures, rejections, and timeouts are
 * fail-open and never interrupt the observed operation.
 */
export async function emitVistaEvent(partial: VistaEventInput, options: EmitOptions = {}): Promise<VistaEvent | undefined> {
  if (partial === null || typeof partial !== "object" || Array.isArray(partial)) {
    throw new VistaProtocolError("event input must be an object");
  }

  const runId = partial.run_id !== undefined
    ? partial.run_id
    : (options.runId !== undefined ? options.runId : getOrCreateRunId());
  if (!isSafeSegment(runId) || hasKnownCredential(runId)) {
    throw new VistaProtocolError("event run_id must be a path-safe identifier");
  }
  if (options.seq !== undefined && (!Number.isInteger(options.seq) || options.seq < 0)) {
    throw new VistaProtocolError("seq must be a non-negative integer");
  }
  const sequence = options.seq ?? nextSequence(runId);
  if (options.seq !== undefined) {
    const next = nextSequences.get(runId) ?? 0;
    nextSequences.set(runId, Math.max(next, options.seq + 1));
  }

  let rawEvent: Partial<VistaEvent>;
  try {
    rawEvent = {
      ...partial,
      run_id: runId,
      step_id: partial.step_id !== undefined
        ? partial.step_id
        : (options.stepId !== undefined ? options.stepId : generateStepId(runId, sequence)),
      ts: partial.ts !== undefined ? partial.ts : (
        typeof options.now === "function"
          ? options.now()
          : (options.now ?? options.clock?.() ?? Date.now())
      ),
      vista_version: partial.vista_version !== undefined ? partial.vista_version : VISTA_PROTOCOL_VERSION,
    };
  } catch {
    // An unsafe getter, malformed ID, or other construction failure must not
    // cause an observer integration to block its caller.
    reportFailure();
    return undefined;
  }

  // This validation intentionally happens before redaction so malformed
  // protocol input is observable as a rejected promise rather than silently
  // looking like a store outage.
  assertVistaEvent(rawEvent);

  let event: VistaEvent;
  try {
    event = redactAll(rawEvent) as VistaEvent;
  } catch {
    // Never persist the unredacted input, and do not turn an unsafe optional
    // field (for example a circular object) into a caller-visible failure.
    reportFailure();
    return undefined;
  }
  assertVistaEvent(event);

  const timeoutMs = persistTimeout(options);
  try {
    const store = options.store ?? new EventStore(options.baseDir);
    await appendWithTimeout(store, event, timeoutMs);
  } catch {
    reportFailure();
  }
  return event;
}

/** Create an emitter with fixed event defaults and optional store defaults. */
export function createEmitter(
  defaults: Partial<VistaEvent>,
  options: EmitOptions = {},
): VistaEmitter {
  return async (partial, callOptions = {}) => {
    const mergedOptions: EmitOptions = { ...options, ...callOptions };
    return emitVistaEvent(
      { ...defaults, ...partial } as VistaEventInput,
      mergedOptions,
    );
  };
}

export type { VistaComponent, VistaResult };
export { VistaProtocolError } from "./validation.js";
