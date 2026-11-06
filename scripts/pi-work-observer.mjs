import { createHash, randomUUID } from "node:crypto";
import { types } from "node:util";
import { isAbsolute, normalize } from "node:path";
import { EventStore, hasKnownCredential, isSafeSegment } from "@pi-vista/core";
import { readPiOwnerResult, observePiWorkHandoff } from "@pi-vista/adapter-pi";
import { createSubagentOwnerProducer, readSubagentFile } from "./pi-subagent-owner.mjs";
import { createCodeProgressWindow, codeProgressRow } from "./pi-code-progress.mjs";
import { readCodeStage } from "./pi-code-stage-reader.mjs";

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
export function createPiWorkObserver({ store = new EventStore(), now = Date.now, freshSessionsSince, codeOwner = {},
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
  const codeProgress = createCodeProgressWindow("unavailable");
  let codePending;
  function observationSnapshot() {
    return Object.freeze({ version: 1, hostSessionId: publicationHost, observerEpoch, seq: sequence,
      scope: "session-recent-observations", coverage, observations: Object.freeze([...observations]), omitted,
      codeProgress: codeProgress.snapshot(), authorization: "none", readOnly: true, executable: false });
  }
  function publishSnapshot(name, value) {
    try { eventBus?.emit(name, value); } catch { report(); }
  }
  function changed() {
    if (publicationOpen && publicationHost) publishSnapshot(WORK_OBSERVATION_CHANGED_EVENT, Object.freeze({ version: 1, snapshot: observationSnapshot() }));
  }
  function resetPublication(host, state) {
    publicationHost = host; observerEpoch = randomUUID(); sequence = 0; coverage = state; observations = []; omitted = 0;
    codeProgress.reset(state); codePending = undefined;
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
  function recordOwnerObservation(identity, observation, stillCurrent) {
    if (stillCurrent) {
      counts.ownerReads++;
      if (observation.decision === "deliverable") counts.deliverable++;
      else if (observation.decision === "reportable_terminal") counts.terminal++;
      else counts.unresolved++;
    }
    const binding = observation.binding;
    emit(identity, "pi:work:owner-result", observation.outcome === "accepted" ? "ok" : observation.outcome === "failed" ? "failed" : "unknown",
      observation.reasonCode, binding ? JSON.stringify(binding.workRef) : undefined, binding?.stageId);
    if (stillCurrent) recentResults = [...recentResults.slice(-15), Object.freeze({
      workRef: binding?.workRef ?? null, stageId: binding?.stageId ?? null, runId: binding?.runId ?? null,
      decision: observation.decision, reasonCode: observation.reasonCode, authorization: "none",
    })];
  }
  async function observeCode(_id, args, signal, _onUpdate, ctx) {
    const reply = details => ({ content: [{ type: "text", text: JSON.stringify(details) }], details });
    const unavailable = reasonCode => reply({ available: false, published: false, reasonCode, authorization: "none", readOnly: true, executable: false });
    const identity = current, version = generation, requestedEpoch = observerEpoch;
    if (!identity || sessionId(ctx) !== identity.session || !publicationOpen) return unavailable("observer_scope_unavailable");
    if (codePending) return unavailable("code_observation_busy");
    if (!args || typeof args !== "object" || types.isProxy(args) || Array.isArray(args) || Object.getPrototypeOf(args) !== Object.prototype
      || Reflect.ownKeys(args).length !== 1 || !Object.hasOwn(args, "contractFile")) return unavailable("contract_invalid");
    const file = data(args, "contractFile");
    if (typeof file !== "string" || file.length > 4096 || !isAbsolute(file) || normalize(file) !== file || /[\x00-\x1f\x7f]/u.test(file)) return unavailable("contract_invalid");
    const token = {}; codePending = token;
    const controller = new AbortController(), abort = () => controller.abort();
    const timer = setTimeout(abort, 60_000);
    signal?.addEventListener("abort", abort, { once: true }); if (signal?.aborted) abort();
    async function bounded(operation) {
      let stop;
      const cancelled = new Promise((_resolve, reject) => { stop = () => reject(Error("code-read-ended")); controller.signal.addEventListener("abort", stop, { once: true }); if (controller.signal.aborted) stop(); });
      try { return await Promise.race([operation, cancelled]); }
      finally { controller.signal.removeEventListener("abort", stop); }
    }
    try {
      controller.signal.throwIfAborted();
      const bytes = await bounded((codeOwner.readContract ?? readSubagentFile)(file, 64 * 1024));
      const prepared = await bounded((codeOwner.readStage ?? readCodeStage)(JSON.parse(bytes.toString("utf8")), { now, signal: controller.signal }));
      controller.signal.throwIfAborted();
      let result;
      // This is the genuine readback produced from this invocation's originals,
      // never reconstructed from a result flag. The callback performs no IO.
      if (prepared.readback) result = await readPiOwnerResult({ binding: prepared.readback.binding, resultRef: `github-pr-${prepared.progress.pullRequest}` },
        { readOwner: () => prepared.readback, timeoutMs: 250, now: now() });
      const progress = prepared.readback && result?.decision !== "deliverable"
        ? codeProgressRow({ binding: prepared.progress.binding, repository: prepared.progress.repository, pullRequest: prepared.progress.pullRequest }, "source_original_unavailable", prepared.progress.observedAt)
        : prepared.progress;
      const stillCurrent = version === generation && identity === current && requestedEpoch === observerEpoch && publicationOpen;
      if (result) recordOwnerObservation(identity, result, stillCurrent);
      if (stillCurrent && result) completedObservation("owner", result, requestedEpoch);
      // Result publication can synchronously trigger a scope reset in a consumer.
      const publish = version === generation && identity === current && requestedEpoch === observerEpoch && publicationOpen;
      const published = publish && progress ? codeProgress.append(progress) : false;
      if (published) changed();
      else if (publish) { codeProgress.unavailable(); changed(); }
      return reply({ available: Boolean(progress), published, progress: progress ?? null, ...(result ? { result } : {}),
        ...(!progress ? { reasonCode: "source_original_unavailable" } : {}), authorization: "none", readOnly: true, executable: false });
    } catch {
      if (version === generation && identity === current && requestedEpoch === observerEpoch && publicationOpen) { codeProgress.unavailable(); changed(); report(); }
      return unavailable("source_original_unavailable");
    }
    finally { clearTimeout(timer); signal?.removeEventListener("abort", abort); if (codePending === token) codePending = undefined; }
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
        recordOwnerObservation(identity, observation, stillCurrent);
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
      subscriptions.push(pi.on("tool_result", (event, ctx) => {
        try { if (current && sessionId(ctx) === current.session) ownerProducer?.onToolResult(event); } catch { report(); }
      }));
      subscriptions.push(pi.on("tool_execution_end", event => { try { todo(event); } catch { report(); } }));
      subscriptions.push(pi.on("session_tree", () => {
        ownerProducer?.onTree();
        epoch = randomUUID(); lastTasks = new Map();
        resetPublication(publicationHost, current ? "not-observed" : coverage);
      }));
      subscriptions.push(pi.events.on(WORK_OBSERVATION_QUERY_EVENT, payload => { try { queryObservation(payload); } catch { report(); } }));
      subscriptions.push(pi.events.on(SUBAGENT_ASYNC_COMPLETE_EVENT, event => { try { ownerProducer?.onCompletion(event); } catch { report(); } }));
      subscriptions.push(pi.events.on(SUBAGENT_PROCESS_TERMINAL_EVENT, event => { try { ownerProducer?.onTerminal(event); } catch { report(); } }));
      subscriptions.push(pi.on("session_shutdown", () => {
        generation++; current = undefined; inFlight = 0; lastTasks = new Map(); recentResults = []; ownerProducer?.reset();
        sequence++; coverage = "unavailable"; observations = []; omitted = 0;
        codeProgress.close(); codePending = undefined;
        const snapshot = observationSnapshot(); publicationOpen = false;
        if (publicationHost) publishSnapshot(WORK_OBSERVATION_CHANGED_EVENT, Object.freeze({ version: 1, snapshot }));
      }));
      subscriptions.push(pi.events.on(OWNER_RESULT_EVENT, value => { try { request(value, "owner"); } catch { report(); } }));
      subscriptions.push(pi.events.on(HANDOFF_EVENT, value => { try { request(value, "handoff"); } catch { report(); } }));
      pi.registerCommand("vista-work-status", { description: "Read local work-observation coverage, not task acceptance", handler: async (_args, ctx) => { ctx.ui.notify(JSON.stringify(status()), "info"); } });
      pi.registerTool?.({ name: "vista_code_observe", label: "Observe selected code work", exposure: "codemode",
        description: "Explicit read-only observation of one existing private code-owner contract. Bounded public GitHub GETs and its original Gate file; no Gate/merge/CI/deploy execution, polling or approval. Returns only bounded safe progress/result metadata. Call only for an authorized selected engineering task; work.refresh never calls this tool.",
        annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
        parameters: { type: "object", properties: { contractFile: { type: "string", minLength: 1, maxLength: 4096, description: "Absolute host-local original code-owner contract path; not exported to clients." } }, required: ["contractFile"], additionalProperties: false },
        execute: observeCode });
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
