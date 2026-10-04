import type { VistaComponent, VistaEvent, VistaResult } from "@pi-vista/protocol";
import { VISTA_PROTOCOL_VERSION } from "@pi-vista/protocol";
import { getOrCreateRunId, generateStepId } from "./run-id.js";
import { redactAll } from "./redact.js";
import { EventStore } from "./store.js";

export interface EmitOptions {
  /** Store to use; omitted means a store rooted at baseDir (or the default). */
  store?: Pick<EventStore, "append">;
  baseDir?: string;
  runId?: string;
  stepId?: string;
  seq?: number;
  now?: number | (() => number);
  clock?: () => number;
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

/**
 * Build, redact, and persist one VistaEvent. This function is deliberately
 * fail-open: an unavailable store never interrupts the observed operation.
 */
export async function emitVistaEvent(partial: VistaEventInput, options: EmitOptions = {}): Promise<VistaEvent | undefined> {
  try {
    if (partial === null || typeof partial !== "object") {
      throw new TypeError("event input must be an object");
    }

    const runId = partial.run_id ?? options.runId ?? getOrCreateRunId();
    const sequence = options.seq ?? nextSequence(runId);
    if (options.seq !== undefined) {
      const next = nextSequences.get(runId) ?? 0;
      nextSequences.set(runId, Math.max(next, options.seq + 1));
    }
    const rawEvent: Partial<VistaEvent> = {
      ...partial,
      run_id: runId,
      step_id: partial.step_id ?? options.stepId ?? generateStepId(runId, sequence),
      ts: partial.ts ?? (
        typeof options.now === "function"
          ? options.now()
          : (options.now ?? options.clock?.() ?? Date.now())
      ),
      vista_version: partial.vista_version ?? VISTA_PROTOCOL_VERSION,
    };
    const event = redactAll(rawEvent) as VistaEvent;

    if (
      typeof event.run_id !== "string" ||
      typeof event.step_id !== "string" ||
      typeof event.ts !== "number" ||
      !Number.isFinite(event.ts) ||
      typeof event.component !== "string" ||
      typeof event.action !== "string" ||
      typeof event.result !== "string"
    ) {
      throw new TypeError("event is missing required fields");
    }

    const store = options.store ?? new EventStore(options.baseDir);
    try {
      await store.append(event);
    } catch {
      reportFailure();
    }
    return event;
  } catch {
    reportFailure();
    return undefined;
  }
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
