import { types } from "node:util";
import {
  type CheckContext, type CheckDefinition, type CheckHandler,
  type CheckReason, type CheckReport, type CheckResult,
} from "./contract.js";

interface Verdict {
  readonly passed: boolean;
  readonly reason: "predicate-true" | "predicate-false" | "handler-threw" | "invalid-verdict" | "timeout";
}

// Internal records cannot inherit then/toJSON or optional metadata hooks.
function frozenRecord<T extends object>(data: T): Readonly<T> {
  return Object.freeze(Object.assign(Object.create(null), data)) as Readonly<T>;
}

function evaluate(handler: CheckHandler, definition: CheckDefinition, context: Readonly<CheckContext>, timeoutMs: number): Promise<Verdict> {
  return new Promise((resolve) => {
    const controller = new AbortController();
    const deadline = performance.now() + timeoutMs;
    let settled = false;
    const finish = (reason: Verdict["reason"]): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (reason === "timeout") controller.abort();
      resolve(frozenRecord({ passed: reason === "predicate-true", reason }));
    };
    const failure = (reason: "handler-threw" | "invalid-verdict"): void => {
      finish(performance.now() >= deadline ? "timeout" : reason);
    };
    const receive = (value: unknown): void => {
      if (performance.now() >= deadline) finish("timeout");
      else if (typeof value !== "boolean") finish("invalid-verdict");
      else finish(value ? "predicate-true" : "predicate-false");
    };
    const timer = setTimeout(() => finish("timeout"), timeoutMs);
    try {
      const returned: unknown = handler(frozenRecord({ definition, context, signal: controller.signal }));
      if (typeof returned === "boolean") receive(returned);
      else if (types.isProxy(returned) || !types.isPromise(returned)) failure("invalid-verdict");
      else {
        // Ignore source .then properties and consume late rejection even after timeout.
        // The promise, like the callback itself, is trusted host code, not a sandbox.
        Promise.prototype.then.call(returned, receive, () => failure("handler-threw"));
      }
    } catch {
      failure("handler-threw");
    }
  });
}

function result(definition: CheckDefinition, status: CheckResult["status"], reason: CheckReason): CheckResult {
  return frozenRecord({ check_id: definition.check_id, type: definition.type, status, reason });
}

function report(results: CheckResult[]): CheckReport {
  return frozenRecord({
    verification: "predicate-only" as const,
    authorization: "none" as const,
    satisfied: results.every((item) => item.status === "passed"),
    results: Object.freeze(results),
  });
}

export async function runSnapshot(
  definitions: readonly CheckDefinition[], context: Readonly<CheckContext>, timeoutMs: number,
  handlers: ReadonlyMap<CheckDefinition["type"], CheckHandler>,
): Promise<CheckReport> {
  // A missing implementation anywhere rejects the whole preflight, even for WARN.
  if (definitions.some((definition) => !handlers.has(definition.type))) {
    return report(definitions.map((definition) => handlers.has(definition.type)
      ? result(definition, "skipped", "preflight-rejected")
      : result(definition, "failed", "missing-handler")));
  }
  const results: CheckResult[] = [];
  let stopped = false;
  for (const definition of definitions) {
    if (stopped) {
      results.push(result(definition, "skipped", "stopped"));
      continue;
    }
    const verdict = await evaluate(handlers.get(definition.type)!, definition, context, timeoutMs);
    if (verdict.passed) results.push(result(definition, "passed", verdict.reason));
    else if (verdict.reason === "predicate-false" && definition.on_fail === "WARN") {
      results.push(result(definition, "warning", verdict.reason));
    } else {
      results.push(result(definition, "failed", verdict.reason));
      stopped = true;
    }
  }
  return report(results);
}
