import { createHash, randomUUID } from "node:crypto";
import { types } from "node:util";
import { EventStore, hasKnownCredential, isSafeSegment } from "@pi-vista/core";
import { readPiOwnerResult, observePiWorkHandoff } from "@pi-vista/adapter-pi";
import { createSubagentOwnerProducer } from "./pi-subagent-owner.mjs";

export const OWNER_RESULT_EVENT = "pi-vista:owner-result";
export const HANDOFF_EVENT = "pi-vista:work-handoff";
export const WORK_OBSERVATION_QUERY_EVENT = "pi-vista:work-observation:query:v1";
export const WORK_OBSERVATION_REPLY_PREFIX = "pi-vista:work-observation:reply:v1:";
export const WORK_OBSERVATION_CHANGED_EVENT = "pi-vista:work-observation:changed:v1";
export const SUBAGENT_ASYNC_COMPLETE_EVENT = "subagent:async-complete";
export const SUBAGENT_PROCESS_TERMINAL_EVENT = "subagent:process-terminal";
const hash = value => createHash("sha256").update(value).digest("hex");
function data(value, key) {
  if (!value || typeof value !== "object" || types.isProxy(value)) return undefined;
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  return descriptor && Object.hasOwn(descriptor, "value") ? descriptor.value : undefined;
}
function sessionId(ctx) {
  // The native SessionManager is trusted host code, never a payload callback.
  const manager = ctx?.sessionManager;
  const value = manager?.getSessionId();
  return typeof value === "string" && isSafeSegment(value) && value.length <= 256 && !hasKnownCredential(value) ? value : undefined;
}
function dense(value, max) {
  if (!Array.isArray(value) || types.isProxy(value) || Object.getPrototypeOf(value) !== Array.prototype) return;
  const size = data(value, "length");
  if (!Number.isSafeInteger(size) || size > max || Reflect.ownKeys(value).length !== size + 1) return;
  const out = [];
  for (let i = 0; i < size; i++) {
    const field = Object.getOwnPropertyDescriptor(value, String(i));
    if (!field || !Object.hasOwn(field, "value")) return;
    out.push(field.value);
  }
  return out;
}

/** Forward-only native metadata observer. No history scan, task writer or model API.
 * Owner bus callbacks are trusted same-process host code, not model payloads or
 * source authentication. They must read original acceptance before reporting it.
 */
export function createPiWorkObserver({ store = new EventStore(), now = Date.now, freshSessionsSince,
  diagnose = () => console.error("[pi-vista] work observation unavailable") } = {}) {
  if (typeof freshSessionsSince !== "string" || !Number.isFinite(Date.parse(freshSessionsSince)) || new Date(freshSessionsSince).toISOString() !== freshSessionsSince) throw Error("work-observer-cohort-invalid");
  const cutoff = Date.parse(freshSessionsSince);
  let current, generation = 0, epoch = "initial", step = 0, inFlight = 0, persisting = 0, diagnosed = false;
  let counts = counters(), recentResults = [];
  let lastTasks = new Map();
  const subscriptions = [];
  const active = new Set();
  let eventBus, publicationOpen = false, publicationHost = null, observerEpoch = randomUUID(), sequence = 0;
  let coverage = "unavailable", observations = [], omitted = 0;
  function observationSnapshot() {
    return Object.freeze({ version: 1, hostSessionId: publicationHost, observerEpoch, seq: sequence,
      scope: "session-recent-observations", coverage, observations: Object.freeze([...observations]), omitted,
      authorization: "none", readOnly: true, executable: false });
  }
  function publishSnapshot(name, value) {
    try { eventBus?.emit(name, value); } catch { report(); }
  }
  function changed() {
    if (publicationOpen && publicationHost) publishSnapshot(WORK_OBSERVATION_CHANGED_EVENT, Object.freeze({ version: 1, snapshot: observationSnapshot() }));
  }
  function resetPublication(host, state) {
    publicationHost = host; observerEpoch = randomUUID(); sequence = 0; coverage = state; observations = []; omitted = 0;
    changed();
  }
  function completedObservation(kind, observation, requestedEpoch) {
    if (!publicationOpen || !current || requestedEpoch !== observerEpoch) return;
    try {
      const observedAt = now();
      if (!Number.isSafeInteger(observedAt) || observedAt < 0) throw Error();
      sequence++;
      if (observations.length === 16) { observations = observations.slice(1); omitted++; }
      observations.push(Object.freeze({ seq: sequence, observedAt, kind: kind === "owner" ? "result" : "handoff", observation }));
      coverage = "observed"; changed();
    } catch { report(); }
  }
  function queryObservation(payload) {
    if (!publicationOpen || !publicationHost || !payload || typeof payload !== "object" || types.isProxy(payload)
      || Array.isArray(payload) || Object.getPrototypeOf(payload) !== Object.prototype) return;
    const keys = Reflect.ownKeys(payload);
    if (keys.length !== 3 || keys.some(key => !["version", "requestId", "hostSessionId"].includes(key))) return;
    const requestId = data(payload, "requestId");
    if (data(payload, "version") !== 1 || data(payload, "hostSessionId") !== publicationHost
      || typeof requestId !== "string" || !/^[A-Za-z0-9_-]{1,128}$/u.test(requestId) || hasKnownCredential(requestId)) return;
    publishSnapshot(WORK_OBSERVATION_REPLY_PREFIX + requestId,
      Object.freeze({ version: 1, requestId, snapshot: observationSnapshot() }));
  }
  function counters() { return { todoRecords: 0, ownerReads: 0, deliverable: 0, terminal: 0, unresolved: 0, handoffs: 0, unavailable: 0 }; }
  function report() { counts.unavailable++; if (diagnosed) return; diagnosed = true; try { diagnose(); } catch { /* observer only */ } }
  function emit(identity, action, result, reason, trace, stage) {
    if (!identity) return;
    if (persisting >= 64) { report(); return; }
    const event = { run_id: identity.run, session_id: hash(identity.session), step_id: `${identity.run}_work-${++step}`,
      ts: now(), component: "pi", action, result, target_class: "work-observation",
      policy_version: "pi-work-observation-1", reason_code: reason,
      ...(trace === undefined ? {} : { trace_id: hash(trace) }),
      ...(stage === undefined ? {} : { artifact_refs: [{ type: "work-stage", ref: stage }] }) };
    try {
      const pending = store.append(event);
      if (types.isPromise(pending)) {
        persisting++;
        Promise.prototype.then.call(pending, () => { persisting--; }, () => { persisting--; if (identity === current) report(); });
      }
    } catch { if (identity === current) report(); }
  }
  let ownerProducer;
  function start(_event, ctx) {
    generation++; inFlight = 0; current = undefined; lastTasks = new Map(); counts = counters(); epoch = "initial"; diagnosed = false;
    ownerProducer?.reset(); recentResults = []; publicationOpen = true;
    let host = null, state = "unavailable";
    try {
      const id = sessionId(ctx), header = ctx?.sessionManager?.getHeader();
      const created = Date.parse(header?.timestamp);
      // Only metadata is inspected: no branch, prompt, tools or transcript read.
      if (id && header?.id === id) host = id;
      if (host && Number.isFinite(created)) {
        state = created >= cutoff ? "not-observed" : "not-applicable";
        if (created >= cutoff) current = { session: id, nativeOwnerId: ctx.sessionManager.getSessionFile?.() ?? id, run: randomUUID() };
      }
    } catch { report(); }
    const identity = current;
    resetPublication(host, state);
    if (identity && identity === current) emit(identity, "pi:work:loaded", "ok", "forward_only_observer_loaded");
  }
  function todo(event) {
    ownerProducer?.onTool(event);
    if (!current || data(event, "toolName") !== "todo" || data(event, "isError") === true) return;
    const result = data(event, "result"), details = data(result, "details");
    if (data(result, "isError") === true || data(details, "error") !== undefined) return;
    const action = data(details, "action"), tasks = dense(data(details, "tasks"), 4096);
    if (!tasks || !["create", "update", "get", "list", "delete", "clear"].includes(action)) return;
    const call = data(event, "toolCallId");
    if (typeof call !== "string" || call.length > 512) return;
    if (action === "clear") { epoch = hash(call); lastTasks = new Map(); }
    const next = new Map();
    for (const task of tasks) {
      const id = data(task, "id"), status = data(task, "status");
      if (!Number.isSafeInteger(id) || id < 1 || !["pending", "in_progress", "completed", "deleted"].includes(status) || next.has(id)) return;
      next.set(id, status);
    }
    for (const [id, status] of next) {
      if (lastTasks.get(id) === status) continue;
      counts.todoRecords++;
      emit(current, "pi:work:todo-record", "unknown", `native_todo_${status}_unverified`, `${current.run}:${epoch}:${id}`);
    }
    lastTasks = next;
  }
  function request(payload, kind) {
    const identity = current, version = generation, requestedEpoch = observerEpoch;
    if (!identity) return false;
    const address = data(payload, "hostSessionId");
    if (typeof address !== "string") { report(); return false; }
    if (address !== identity.session) return false;
    if (inFlight >= 32) { report(); return false; }
    const onObservation = data(payload, "onObservation");
    if (onObservation !== undefined && (typeof onObservation !== "function" || types.isProxy(onObservation))) { report(); return false; }
    const reference = data(payload, "reference"), readOwner = data(payload, "readOwner");
    if (kind === "owner" && (typeof readOwner !== "function" || types.isProxy(readOwner))) { report(); return false; }
    let operation;
    try {
      operation = kind === "owner"
        ? readPiOwnerResult(reference, { readOwner, timeoutMs: 250 })
        : Promise.resolve(observePiWorkHandoff(reference));
    } catch { report(); return false; }
    inFlight++;
    const work = Promise.resolve(operation).then(observation => {
      // Preserve late observation metadata under its original session/run, never
      // call a stale consumer into a replacement session or cancel native work.
      const stillCurrent = version === generation && identity === current;
      const reason = observation.reasonCode;
      if (kind === "owner") {
        if (stillCurrent) {
          counts.ownerReads++;
          if (observation.decision === "deliverable") counts.deliverable++;
          else if (observation.decision === "reportable_terminal") counts.terminal++;
          else counts.unresolved++;
        }
        const binding = observation.binding;
        const trace = binding ? JSON.stringify(binding.workRef) : undefined;
        emit(identity, "pi:work:owner-result", observation.outcome === "accepted" ? "ok" : observation.outcome === "failed" ? "failed" : "unknown", reason, trace, binding?.stageId);
        if (stillCurrent) recentResults = [...recentResults.slice(-15), Object.freeze({
          workRef: binding?.workRef ?? null, stageId: binding?.stageId ?? null, runId: binding?.runId ?? null,
          decision: observation.decision, reasonCode: reason, authorization: "none",
        })];
      } else {
        if (stillCurrent) counts.handoffs++;
        emit(identity, "pi:work:handoff", "unknown", reason);
      }
      if (stillCurrent) completedObservation(kind, observation, requestedEpoch);
      if (onObservation && version === generation && identity === current) {
        try {
          const response = onObservation(observation);
          if (types.isPromise(response)) Promise.prototype.then.call(response, () => undefined, () => { if (identity === current) report(); });
        } catch { report(); }
      }
    }, () => { if (version === generation) report(); }).finally(() => {
      active.delete(work);
      if (version === generation) inFlight--;
    });
    active.add(work);
    return true;
  }
  function status() {
    return Object.freeze({ schema: 1, loaded: current !== undefined, mode: "forward-only-readonly",
      ...counts, inFlight, recentResults: Object.freeze([...recentResults]), ownerProducer: ownerProducer?.status(), todoRecordsMeaning: "observed-not-persisted", persistence: "best-effort",
      todoCompletionIsDelivery: false, ownerProducerRequired: true,
      authorization: "none", executable: false });
  }
  function extension(pi) {
    try {
      eventBus = pi.events;
      ownerProducer = createSubagentOwnerProducer({
        hostSessionId: () => current?.session,
        nativeOwnerId: () => current?.nativeOwnerId,
        publish: value => request(value, "owner"),
        diagnose: report,
      });
      let commands;
      try { commands = pi.getCommands?.(); } catch { /* SDK runtime may not be bound at factory load. */ }
      if (Array.isArray(commands) && commands.some(command => command.name === "vista-work-status")) throw Error();
      subscriptions.push(pi.on("session_start", start));
      subscriptions.push(pi.on("tool_execution_end", event => { try { todo(event); } catch { report(); } }));
      subscriptions.push(pi.on("session_tree", () => {
        epoch = randomUUID(); lastTasks = new Map();
        resetPublication(publicationHost, current ? "not-observed" : coverage);
      }));
      subscriptions.push(pi.events.on(WORK_OBSERVATION_QUERY_EVENT, payload => { try { queryObservation(payload); } catch { report(); } }));
      subscriptions.push(pi.events.on(SUBAGENT_ASYNC_COMPLETE_EVENT, event => { try { ownerProducer?.onCompletion(event); } catch { report(); } }));
      subscriptions.push(pi.events.on(SUBAGENT_PROCESS_TERMINAL_EVENT, event => { try { ownerProducer?.onTerminal(event); } catch { report(); } }));
      subscriptions.push(pi.on("session_shutdown", () => {
        generation++; current = undefined; inFlight = 0; lastTasks = new Map(); recentResults = []; ownerProducer?.reset();
        sequence++; coverage = "unavailable"; observations = []; omitted = 0;
        const snapshot = observationSnapshot(); publicationOpen = false;
        if (publicationHost) publishSnapshot(WORK_OBSERVATION_CHANGED_EVENT, Object.freeze({ version: 1, snapshot }));
      }));
      subscriptions.push(pi.events.on(OWNER_RESULT_EVENT, value => { try { request(value, "owner"); } catch { report(); } }));
      subscriptions.push(pi.events.on(HANDOFF_EVENT, value => { try { request(value, "handoff"); } catch { report(); } }));
      pi.registerCommand("vista-work-status", { description: "Read local work-observation coverage, not task acceptance", handler: async (_args, ctx) => { ctx.ui.notify(JSON.stringify(status()), "info"); } });
    } catch {
      for (const unsubscribe of subscriptions.splice(0)) { try { if (typeof unsubscribe === "function") unsubscribe(); } catch { /* local rollback only */ } }
      current = undefined; ownerProducer = undefined; publicationOpen = false; report();
    }
  }
  return Object.freeze({ extension, status, observationSnapshot, drain: () => Promise.all([...active]).then(() => undefined) });
}

export default function workObserverExtension(pi, options) {
  try { createPiWorkObserver(options).extension(pi); }
  catch { try { console.error("[pi-vista] work observation unavailable"); } catch { /* fail open */ } }
}
