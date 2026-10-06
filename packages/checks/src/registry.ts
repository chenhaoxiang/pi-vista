import { types } from "node:util";
import type { CheckFunctionType, VistaCheckFunction } from "@pi-vista/protocol";
import { envMatches, shaMatches } from "./bindings.js";
import {
  CheckError, MAX_HANDLERS,
  type CheckContext, type CheckHandler, type CheckReport, type CheckRunOptions,
} from "./contract.js";
import { safeType, snapshotRun } from "./input.js";
import { runSnapshot } from "./runner.js";

/** Explicit trusted host registration; no loading, repair, probing, or caching. */
export class CheckRegistry {
  #handlers = new Map<CheckFunctionType, CheckHandler>();
  #activeRuns = 0;

  register(type: CheckFunctionType, handler: CheckHandler): void {
    if (this.#activeRuns !== 0) throw new CheckError("registry-busy");
    if (!safeType(type) || types.isProxy(handler) || typeof handler !== "function") {
      throw new CheckError("invalid-registration");
    }
    if (this.#handlers.has(type)) throw new CheckError("duplicate-registration");
    if (this.#handlers.size >= MAX_HANDLERS) throw new CheckError("invalid-registration");
    this.#handlers.set(type, handler);
  }

  /** Atomically opt in to both pure expected/actual metadata comparisons. */
  registerBindingPredicates(): void {
    if (this.#activeRuns !== 0) throw new CheckError("registry-busy");
    if (this.#handlers.has("sha_matches") || this.#handlers.has("env_matches")) throw new CheckError("duplicate-registration");
    if (this.#handlers.size + 2 > MAX_HANDLERS) throw new CheckError("invalid-registration");
    this.#handlers.set("sha_matches", shaMatches);
    this.#handlers.set("env_matches", envMatches);
  }

  async run(definitions: readonly VistaCheckFunction[], context: CheckContext = {}, options: CheckRunOptions = {}): Promise<CheckReport> {
    const snapshot = snapshotRun(definitions, context, options);
    const handlers = new Map(this.#handlers);
    this.#activeRuns += 1;
    try {
      return await runSnapshot(snapshot.definitions, snapshot.context, snapshot.timeoutMs, handlers);
    } finally {
      this.#activeRuns -= 1;
    }
  }
}
