import { types } from "node:util";
import {
  consumePiOwnerResult,
  unknownPiResultConsumption,
  type PiResultConsumption,
} from "./result-consumption.js";
import { readWorkMetadata, snapshotPiWorkBinding, workIdentifier, type PiWorkBinding } from "./work-ref.js";

/** An existing owner result/receipt alias, not artifact content or a private path. */
export interface PiOwnerResultReference {
  readonly binding: PiWorkBinding;
  readonly resultRef: string;
}

export interface PiOwnerResultReadRequest extends PiOwnerResultReference {
  readonly authorization: "none";
  readonly readOnly: true;
}

export interface PiOwnerResultReaderOptions {
  /**
   * Explicit trusted host code resolves this result and the current owner record
   * from originals. It must not derive acceptance from worker-supplied flags.
   * No reader, filesystem/network discovery, history or task writer is installed.
   * This is not hostile-code isolation: synchronous callback work cannot be preempted.
   */
  readonly readOwner: (request: PiOwnerResultReadRequest) => unknown | Promise<unknown>;
  /** Async observation wait only, 250 ms by default, at most 30 seconds. No abort is sent. */
  readonly timeoutMs?: number;
  /** Explicit host observation time for deterministic/frozen readbacks; otherwise evaluated after the read. */
  readonly now?: number;
}

type ReadOutcome = { readonly state: "read"; readonly value: unknown } | { readonly state: "failed" | "timeout" };

/** Box sync metadata before Promise adoption so its `then` getter is never invoked. */
function invokeReader(readOwner: PiOwnerResultReaderOptions["readOwner"], request: PiOwnerResultReadRequest): Promise<ReadOutcome> {
  return new Promise((resolve) => {
    queueMicrotask(() => {
      try {
        const value: unknown = Reflect.apply(readOwner, undefined, [request]);
        if (value !== null && (typeof value === "object" || typeof value === "function") && types.isProxy(value)) {
          resolve({ state: "failed" });
        } else if (types.isPromise(value)) {
          // Use native promise machinery, not a returned metadata object's .then.
          // Async hooks may add native bookkeeping symbols; these are not readback fields.
          void Promise.prototype.then.call(value,
            (data: unknown) => { resolve({ state: "read", value: data }); },
            () => { resolve({ state: "failed" }); });
        } else {
          resolve({ state: "read", value });
        }
      } catch {
        resolve({ state: "failed" });
      }
    });
  });
}

/**
 * Explicit, read-only owner consumption of one existing result reference. Failures
 * and timeouts affect only this observation, not native execution or the owner Gate.
 * Returned acceptance is owner-reported metadata, not independent verification/proof.
 */
export async function readPiOwnerResult(resultValue: unknown, optionsValue: PiOwnerResultReaderOptions): Promise<PiResultConsumption> {
  let binding: PiWorkBinding;
  let resultRef: string;
  try {
    const data = readWorkMetadata(resultValue, ["binding", "resultRef"], "owner result reference");
    try { binding = snapshotPiWorkBinding(data.binding); }
    catch { return unknownPiResultConsumption(null, "binding_invalid"); }
    try { resultRef = workIdentifier(data.resultRef); }
    catch { return unknownPiResultConsumption(binding, "result_reference_invalid"); }
  } catch {
    return unknownPiResultConsumption(null, "result_reference_invalid");
  }
  let readOwner: PiOwnerResultReaderOptions["readOwner"];
  let timeoutMs: number;
  let now: number | undefined;
  try {
    const options = readWorkMetadata(optionsValue, ["readOwner", "timeoutMs", "now"], "owner reader options");
    if (typeof options.readOwner !== "function" || types.isProxy(options.readOwner)) {
      return unknownPiResultConsumption(binding, "reader_options_invalid", resultRef);
    }
    readOwner = options.readOwner as PiOwnerResultReaderOptions["readOwner"];
    const timeout = options.timeoutMs === undefined ? 250 : options.timeoutMs;
    if (typeof timeout !== "number" || !Number.isSafeInteger(timeout) || timeout < 0 || timeout > 30_000) {
      return unknownPiResultConsumption(binding, "reader_options_invalid", resultRef);
    }
    timeoutMs = timeout;
    if (options.now !== undefined && (typeof options.now !== "number" || !Number.isFinite(options.now) || options.now < 0 || options.now > 8.64e15)) {
      return unknownPiResultConsumption(binding, "observation_time_invalid", resultRef);
    }
    now = options.now as number | undefined;
  } catch {
    return unknownPiResultConsumption(binding, "reader_options_invalid", resultRef);
  }
  const request: PiOwnerResultReadRequest = Object.freeze({ binding, resultRef, authorization: "none", readOnly: true });
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<ReadOutcome>((resolve) => {
    timer = setTimeout(() => resolve({ state: "timeout" }), timeoutMs);
  });
  // invokeReader always settles to boxed metadata, including rejection after this race has timed out.
  const observed = await Promise.race([invokeReader(readOwner, request), timeout]);
  if (timer !== undefined) clearTimeout(timer);
  if (observed.state !== "read") {
    return unknownPiResultConsumption(binding, observed.state === "timeout" ? "owner_reader_timeout" : "owner_reader_failed", resultRef);
  }
  return Object.freeze({ ...consumePiOwnerResult(binding, observed.value, now), resultRef });
}
