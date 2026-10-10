import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { types } from "node:util";
import { EventStore } from "@pi-vista/core";
import { createPiObservation } from "@pi-vista/learning/pi";

const SCHEMA = "pi-local-notifications-1";
const HEAD_PATTERN = /^(?:[a-fA-F0-9]{40}|[a-fA-F0-9]{64})$/u;
const COMMANDS = ["vista-status", "vista-preview", "vista-adopt", "vista-verify"];
const TOOLS = Object.freeze([
  { native_name: "read", classification: "file-tool" },
  { native_name: "write", classification: "file-tool" },
  { native_name: "edit", classification: "file-tool" },
  { native_name: "bash", classification: "process-tool" },
]);

/** POSIX default; a trusted host may provide its own executable or async reader. */
export function readSessionHead(cwd, gitExecutable = "/usr/bin/git", timeoutMs = 1_000) {
  return new Promise((resolve, reject) => {
    const unavailable = () => reject(new Error("observer-binding-unavailable"));
    if (typeof cwd !== "string" || !cwd || cwd.includes("\0") ||
        typeof gitExecutable !== "string" || !gitExecutable || gitExecutable.includes("\0") ||
        !Number.isSafeInteger(timeoutMs) || timeoutMs < 50 || timeoutMs > 2_000) {
      unavailable(); return;
    }
    const env = { PATH: "/usr/bin:/bin:/usr/sbin:/sbin", LC_ALL: "C",
      GIT_OPTIONAL_LOCKS: "0", GIT_TERMINAL_PROMPT: "0", GIT_CONFIG_NOSYSTEM: "1",
      GIT_CONFIG_GLOBAL: "/dev/null", GIT_NO_REPLACE_OBJECTS: "1" };
    execFile(gitExecutable, ["--no-optional-locks", "--no-replace-objects", "-C", cwd,
      "rev-parse", "--verify", "HEAD"], { env, timeout: timeoutMs, maxBuffer: 4096 }, (error, stdout) => {
      const head = typeof stdout === "string" ? stdout.trim() : "";
      if (error || !HEAD_PATTERN.test(head)) { unavailable(); return; }
      resolve(head);
    });
  });
}

/**
 * Reuse notification-only addon + existing local EventStore. Construction does
 * not open files or launch a process. Session-cwd HEAD is an observed binding,
 * not affected-repository identity, financial evidence, guard coverage or proof.
 * Injected callbacks are trusted; their synchronous portions must be lightweight.
 */
export function createLocalPiObserver({ store, now = Date.now, readHead,
  gitExecutable = "/usr/bin/git", gitTimeoutMs = 1_000,
  observerTimeoutMs = 1_500, diagnose = code => console.error(`[pi-vista] ${code}`) } = {}) {
  let cwd;
  let generation = 0;
  let binding = "awaiting-session";
  let registration = "not-registered";
  let reported = false;
  const local = store ?? new EventStore();
  function report(code) {
    if (reported) return;
    reported = true;
    try {
      const value = diagnose(code);
      if (types.isPromise(value) && !types.isProxy(value)) Promise.prototype.then.call(value, () => undefined, () => undefined);
    } catch { /* Diagnostics never affect primary execution. */ }
  }
  const fingerprint = createHash("sha256").update(
    JSON.stringify([SCHEMA, process.version, process.platform, process.arch])).digest("hex");
  function contextCwd(ctx) {
    if (!ctx || typeof ctx !== "object" || types.isProxy(ctx)) return undefined;
    const descriptor = Object.getOwnPropertyDescriptor(ctx, "cwd");
    if (!descriptor) return undefined;
    if (Object.hasOwn(descriptor, "value")) return typeof descriptor.value === "string" ? descriptor.value : undefined;
    if (typeof descriptor.get !== "function") return undefined;
    const value = descriptor.get.call(ctx);
    return typeof value === "string" ? value : undefined;
  }
  const addon = createPiObservation({
    resolve_task: async () => {
      const version = generation;
      const sessionCwd = cwd;
      let timer;
      try {
        if (sessionCwd === undefined) throw new Error("observer-binding-unavailable");
        const reading = (readHead ?? (value => readSessionHead(value, gitExecutable, gitTimeoutMs)))(sessionCwd);
        const head = await Promise.race([reading, new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error("observer-binding-unavailable")), observerTimeoutMs);
        })]);
        if (version !== generation || typeof head !== "string" || !HEAD_PATTERN.test(head)) throw new Error("observer-binding-unavailable");
        binding = "session-cwd-observed";
        return { repo: "session-cwd", source_sha: head, policy_version: SCHEMA,
          env_fingerprint: fingerprint, task_type: "session-observation",
          task_goal: "Observe native lifecycle status", bank: "local-observations" };
      } catch {
        if (version === generation) { binding = "unavailable"; report("local observer binding unavailable"); }
        throw new Error("observer-binding-unavailable");
      } finally { clearTimeout(timer); }
    },
    now, tools: TOOLS, events: { append: async event => local.append(event) },
    timeout_ms: observerTimeoutMs, preview_on_start: false,
  });
  const unsubscribers = [];
  const extension = pi => {
    try {
      let conflict = false;
      try {
        const commands = typeof pi.getCommands === "function" ? pi.getCommands() : undefined;
        conflict = Array.isArray(commands) && commands.some(command => COMMANDS.includes(command?.name));
      } catch { /* Optional introspection failure is not a registration conflict. */ }
      if (conflict) throw new Error("observer-registration-unavailable");
      addon.extension({
        on(name, handler) {
          const unsubscribe = pi.on(name, (event, ctx) => {
            if (name === "session_start") {
              generation++; cwd = undefined; binding = "awaiting-session"; reported = false;
              try { cwd = contextCwd(ctx); } catch { cwd = undefined; }
              if (cwd === undefined) { binding = "unavailable"; report("local observer binding unavailable"); }
            }
            if (name === "session_shutdown") { generation++; cwd = undefined; binding = "shutdown"; }
            return handler(event, ctx);
          });
          if (typeof unsubscribe === "function") unsubscribers.push(unsubscribe);
          return unsubscribe;
        },
        registerCommand(name, command) { return pi.registerCommand(name, command); },
      });
      registration = "registered";
    } catch {
      for (const unsubscribe of unsubscribers.splice(0)) { try { unsubscribe(); } catch { /* best effort */ } }
      addon.controller.shutdown(); registration = "unavailable";
      report("local observer registration unavailable");
    }
  };
  return Object.freeze({ extension, controller: addon.controller,
    hostStatus: () => Object.freeze({ registration, binding, persistence: store == null ? "default-local-event-store" : "host-supplied-append-port", authorization: "none", executable: false }) });
}

export function localObserverExtension(pi, options) {
  try { return createLocalPiObserver(options).extension(pi); }
  catch { try { console.error("[pi-vista] local observer setup unavailable"); } catch { /* fail-open */ } }
}
export default localObserverExtension;
