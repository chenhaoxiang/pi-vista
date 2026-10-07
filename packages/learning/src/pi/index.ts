import { types } from "node:util";
import { emitVistaEvent, generateRunId, generateStepId, isVistaCheckpoint, type VistaCheckpoint, type VistaEvent, type VistaResult } from "@pi-vista/core";
import type { EvidenceBinding, VerifiedEvidence } from "@pi-vista/evidence";
import { bounded, canonical, frozen, hash, integer } from "../data.js";
import { createPortableRecall } from "../portable.js";
import type { HistoricalSelection, PortableRecall } from "../portable-contract.js";
import { configuration, task, eventField, callId } from "./config.js";
import { PiObservationError, type PiObservationAddon, type PiObservationConfig, type PiObservationController, type PiObservationStatus, type PiPreview, type PiTask, type PiUIContext } from "./contract.js";
export * from "./contract.js";

interface Correlation { readonly step: string; readonly classification: string; state: "pending" | "ended" | "ambiguous"; }
interface PreviewRecord { readonly view: PiPreview; readonly recall: PortableRecall; readonly selection: HistoricalSelection; close(): void; }
interface Epoch {
  readonly run: string; active: boolean; task?: PiTask; binding?: EvidenceBinding; ready: Promise<void>;
  sequence: number; dropped: number; readonly calls: Map<string, Correlation>; revision: number;
  preview?: PreviewRecord; adopted: boolean; proof?: VerifiedEvidence; verificationRevision: number;
}
function refuse(): never { throw new PiObservationError("refused"); }

/** Explicit optional seam. Import/construction never discovers a session or creates stores/timers. */
export function createPiObservation(config: PiObservationConfig): PiObservationAddon {
  const c = configuration(config);
  // Validate the whole portable config without invoking any trusted host callback in the factory.
  if (c.history) {
    try { createPortableRecall({ ...c.history, now: () => 0 }); } catch { throw new PiObservationError("invalid-config"); }
  }
  let epoch: Epoch | undefined; let shut = false; let registered = false; let pendingWork = 0; let pendingCallbacks = 0; let lastTime = 0;
  const current = (e: Epoch): boolean => epoch === e && !shut;
  const guard = (e: Epoch): void => { if (!current(e)) refuse(); };
  const drop = (e: Epoch): void => { if (current(e)) e.dropped++; };
  const clock = (): number => { const n = integer(c.now()); if (n < lastTime) refuse(); lastTime = n; return n; };
  // Shared for the controller lifetime: replacing a preview or epoch cannot erase observed history time.
  let historyHighWater = 0;
  const historyClock = (): number => {
    const n = integer(c.history!.now()); if (n < historyHighWater) refuse(); historyHighWater = n; return n;
  };
  function clearPreview(e: Epoch): void { e.preview?.close(); delete e.preview; e.adopted = false; }
  function invalidate(): void {
    if (epoch) { clearPreview(epoch); delete epoch.proof; epoch.calls.clear(); epoch.revision++; }
    epoch = undefined;
  }
  /** Timed-out native callbacks keep their quota until actual settlement; late failures are consumed. */
  function host(call: (signal: AbortSignal) => Promise<unknown>): Promise<unknown> {
    return bounded(signal => {
      if (pendingCallbacks >= c.maxWork) refuse(); pendingCallbacks++;
      let promise: Promise<unknown>;
      try {
        promise = call(signal);
        if (types.isProxy(promise) || !types.isPromise(promise)) refuse();
      } catch { pendingCallbacks--; refuse(); }
      Promise.prototype.then.call(promise, () => { pendingCallbacks--; }, () => { pendingCallbacks--; });
      return promise;
    }, c.timeout, value => frozen({ value })).then(result => result.value);
  }
  function work<T>(e: Epoch, job: () => Promise<T>): Promise<T> {
    if (!current(e) || pendingWork >= c.maxWork) { drop(e); return Promise.reject(new PiObservationError("refused")); }
    pendingWork++;
    return Promise.resolve().then(() => { guard(e); return job(); }).then(value => { pendingWork--; return value; }, () => {
      pendingWork--; drop(e); throw new PiObservationError("refused");
    });
  }
  function detach(e: Epoch, job: () => Promise<unknown>): void { void work(e, job).catch(() => undefined); }
  function newEpoch(active: boolean, knownTask?: PiTask): Epoch {
    invalidate(); shut = false;
    const e: Epoch = { run: generateRunId(), active, ready: Promise.resolve(), sequence: 0, dropped: 0, calls: new Map(), revision: 0, adopted: false, verificationRevision: 0 };
    epoch = e;
    const bind = (t: PiTask): void => {
      e.task = t; e.binding = frozen({ run_id: e.run, repo: t.repo, source_sha: t.source_sha, policy_version: t.policy_version, env_fingerprint: t.env_fingerprint });
    };
    if (knownTask) bind(knownTask);
    else e.ready = work(e, async () => { const input = await host(() => c.resolveTask()); guard(e); bind(task(input)); }).catch(() => undefined);
    return e;
  }
  async function requireTask(e: Epoch, refresh = false): Promise<void> {
    await e.ready; guard(e); if (!e.task || !e.binding) refuse();
    if (refresh) {
      let next: PiTask;
      try { next = task(await host(() => c.resolveTask())); } catch { clearPreview(e); delete e.proof; refuse(); }
      guard(e);
      if (canonical(next) !== canonical(e.task)) { newEpoch(e.active, next); refuse(); }
    }
  }
  async function observe(e: Epoch, step: string, action: string, result: VistaResult = "unknown", classification?: string): Promise<void> {
    await requireTask(e); const t = e.task!;
    if (c.events) {
      const event: Partial<VistaEvent> = { ...e.binding!, step_id: step, ts: clock(), component: "pi", action, result,
        ...(classification === undefined ? {} : { target_class: classification }),
        ...(t.session_alias === undefined ? {} : { session_id: t.session_alias }) };
      await emitVistaEvent(event, { store: { append: async value => {
        guard(e);
        try { await host(() => c.events!.append(frozen(value))); } catch { drop(e); refuse(); }
      } }, seq: e.sequence++, persistTimeoutMs: c.timeout });
    }
  }
  async function checkpoint(e: Epoch, step: string, state: string): Promise<void> {
    if (!c.checkpoints) return; await requireTask(e);
    const checkpoint: VistaCheckpoint = { run_id: e.run, step_id: step, ts: clock(), task_goal: e.task!.task_goal,
      completed_steps: [], pending_steps: [], current_state: state, source_sha: e.task!.source_sha,
      policy_version: e.task!.policy_version, env_fingerprint: e.task!.env_fingerprint, check_fn_ids: [], resumable: false };
    if (!isVistaCheckpoint(checkpoint)) refuse();
    // Arrays are generated metadata, not raw tool or session data.
    Object.freeze(checkpoint.completed_steps); Object.freeze(checkpoint.pending_steps); Object.freeze(checkpoint.check_fn_ids);
    await host(() => { guard(e); return c.checkpoints!.save(frozen(checkpoint)); });
  }
  function activeEpoch(): Epoch { if (!epoch || shut) refuse(); return epoch; }
  function status(): PiObservationStatus {
    const e = epoch;
    if (e?.preview) { try { e.preview.recall.compileContext(e.preview.selection, { max_items: c.maxItems, max_characters: c.maxCharacters }); }
      catch { clearPreview(e); } }
    if (e?.proof && (!e.binding || !c.verifier?.isCurrent(e.proof, e.binding))) delete e.proof;
    return frozen({ authorization: "none", executable: false, observation: "observed",
      phase: shut ? "shutdown" : !e?.task ? "MISSING" : e.active ? "active" : "settled",
      ...(e?.binding === undefined ? {} : { binding: e.binding }), ...(e?.task === undefined ? {} : { task: e.task }),
      history: e?.preview ? "historical-authenticated" : "MISSING", current: e?.proof ? "current-verified" : "MISSING",
      selection: e?.adopted ? "local-guidance-acknowledgement" : "none",
      ...(e?.preview === undefined ? {} : { preview_digest: e.preview.view.preview_digest }),
      dropped: e?.dropped ?? 0, correlations: e?.calls.size ?? 0, pending_work: pendingWork, pending_callbacks: pendingCallbacks });
  }
  async function recallPreview(e: Epoch): Promise<PiPreview> {
    await requireTask(e, true); guard(e); clearPreview(e); const revision = ++e.revision;
    if (!c.history?.port) refuse();
    let open = true;
    const check = (): void => { guard(e); if (!open || revision !== e.revision) refuse(); };
    const history = c.history;
    let constructing = true;
    const recall = createPortableRecall({ ...history, now: () => {
      if (constructing) return historyHighWater; check(); return historyClock();
    }, port: {
      query: (query, signal) => host(() => { check(); if (signal.aborted) refuse(); return history.port!.query(query, signal); }),
      read: (ref, signal) => host(() => { check(); if (signal.aborted) refuse(); return history.port!.read(ref, signal); }),
    }, ...(history.lifecycle === undefined ? {} : { lifecycle: (ref, signal) => host(() => {
      check(); if (signal.aborted) refuse(); return history.lifecycle!(ref, signal);
    }) }) });
    constructing = false;
    try {
      const selection = await bounded(() => recall.recall({ repo: e.task!.repo, bank: e.task!.bank, source_sha: e.task!.source_sha,
        policy_version: e.task!.policy_version, env_fingerprint: e.task!.env_fingerprint, task_type: e.task!.task_type, limit: c.maxItems }), c.timeout, value => value as HistoricalSelection);
      await requireTask(e, true); check(); const context = recall.compileContext(selection, { max_items: c.maxItems, max_characters: c.maxCharacters });
      if (context.item_count === 0) refuse();
      const view: PiPreview = frozen({ verification: "historical-authenticated", current_verification: "not-checked", authorization: "none", executable: false,
        run_id: e.run, context, preview_digest: hash(canonical({ run: e.run, revision, task: e.task, context })) });
      e.preview = { view, recall, selection, close: () => { open = false; } }; return view;
    } catch { open = false; if (current(e) && revision === e.revision) clearPreview(e); refuse(); }
  }
  const controller: PiObservationController = frozen({
    status,
    async preview(): Promise<PiPreview> { const e = activeEpoch(); return work(e, () => recallPreview(e)); },
    async adopt(view: PiPreview, digest: string): Promise<PiObservationStatus> {
      const e = activeEpoch(); const record = e.preview;
      if (!record || view !== record.view || typeof digest !== "string" || digest !== record.view.preview_digest) refuse();
      return work(e, async () => {
        e.adopted = false;
        try {
          await requireTask(e, true); guard(e); if (e.preview !== record) refuse();
          // Fresh original-document and lifecycle reads at acknowledgement; stored authentic-looking flags are insufficient.
          const selected = await bounded(() => record.recall.recall({ repo: e.task!.repo, bank: e.task!.bank, source_sha: e.task!.source_sha,
            policy_version: e.task!.policy_version, env_fingerprint: e.task!.env_fingerprint, task_type: e.task!.task_type, limit: c.maxItems }), c.timeout, value => value as HistoricalSelection);
          const context = record.recall.compileContext(selected, { max_items: c.maxItems, max_characters: c.maxCharacters });
          await requireTask(e, true); guard(e); if (e.preview !== record || canonical(context) !== canonical(record.view.context)) refuse();
          record.recall.compileContext(selected, { max_items: c.maxItems, max_characters: c.maxCharacters });
          e.adopted = true; return status();
        } catch { if (current(e) && e.preview === record) clearPreview(e); refuse(); }
      });
    },
    async verifyCurrent(): Promise<PiObservationStatus> {
      const e = activeEpoch(); delete e.proof; const revision = ++e.verificationRevision;
      return work(e, async () => {
        await requireTask(e, true); if (!c.verifier || !c.subjects) refuse();
        const proof = await host(() => c.verifier!.verify(e.binding!, c.subjects!)) as VerifiedEvidence;
        await requireTask(e, true); guard(e);
        if (revision !== e.verificationRevision || !c.verifier.isCurrent(proof, e.binding!)) refuse(); e.proof = proof; return status();
      });
    },
    reset(): void { invalidate(); shut = false; },
    shutdown(): void { invalidate(); shut = true; },
  });
  function notify(ctx: PiUIContext, text: string): void {
    try {
      if (!ctx.hasUI) return;
      const returned: unknown = ctx.ui.notify(text, "info");
      if (!types.isProxy(returned) && types.isPromise(returned)) Promise.prototype.then.call(returned, () => undefined, () => undefined);
    } catch { /* Public UI is optional and never changes observation or the primary operation. */ }
  }
  return frozen({ controller, extension(pi): void {
    if (registered) throw new PiObservationError("refused"); registered = true;
    pi.on("session_start", () => { controller.reset(); return undefined; });
    pi.on("session_shutdown", () => { controller.shutdown(); return undefined; });
    pi.on("agent_start", () => {
      if (shut) return undefined;
      try {
        if (!epoch?.active) {
          const e = newEpoch(true); const step = generateStepId(e.run, e.sequence++);
          detach(e, async () => { await observe(e, step, "pi:agent-start"); await checkpoint(e, step, "agent-active observed-only"); });
          if (c.previewOnStart && c.history?.port) detach(e, () => recallPreview(e));
        }
      } catch { if (epoch) drop(epoch); } return undefined;
    });
    pi.on("agent_end", () => {
      try { const e = activeEpoch(); if (e.active) { const step = generateStepId(e.run, e.sequence++); detach(e, () => observe(e, step, "pi:agent-end")); } }
      catch { /* No low-level end can assert success or final settlement. */ } return undefined;
    });
    pi.on("agent_settled", () => {
      try { const e = activeEpoch(); if (e.active) {
        e.active = false; for (const call of e.calls.values()) if (call.state === "pending") drop(e); e.calls.clear();
        const step = generateStepId(e.run, e.sequence++);
        detach(e, async () => { await observe(e, step, "pi:agent-settled"); await checkpoint(e, step, "agent-settled observed-only"); });
      } } catch { /* Idempotent final notification. */ } return undefined;
    });
    pi.on("tool_execution_start", event => {
      try { const e = activeEpoch(); if (!e.active) refuse(); const id = callId(eventField(event, "toolCallId"));
        const existing = e.calls.get(id); if (existing) { existing.state = "ambiguous"; drop(e); return undefined; }
        if (e.calls.size >= c.maxCorrelations) { drop(e); return undefined; }
        const step = generateStepId(e.run, e.sequence++);
        // Reserve before metadata inspection; a lost start must not later look like a fresh identity.
        e.calls.set(id, { step, classification: "unclassified", state: "ambiguous" });
        const name = eventField(event, "toolName"); const classification = typeof name === "string" ? c.tools.get(name) ?? "unclassified" : "unclassified";
        e.calls.set(id, { step, classification, state: "pending" });
        detach(e, () => observe(e, step, "pi:tool-execution-start", "unknown", classification));
      } catch { if (epoch) drop(epoch); } return undefined;
    });
    pi.on("tool_execution_end", event => {
      try { const e = activeEpoch(); if (!e.active) refuse(); const id = callId(eventField(event, "toolCallId")); const call = e.calls.get(id);
        if (!call) {
          if (e.calls.size < c.maxCorrelations) e.calls.set(id, { step: generateStepId(e.run, e.sequence++), classification: "unclassified", state: "ambiguous" });
          drop(e); return undefined;
        }
        if (call.state !== "pending") { drop(e); return undefined; } call.state = "ended";
        let error: unknown; try { error = eventField(event, "isError"); } catch { error = undefined; }
        const result = error === true ? "failed" : error === false ? "ok" : "unknown";
        detach(e, () => observe(e, call.step, "pi:tool-execution-end", result, call.classification));
      } catch { if (epoch) drop(epoch); } return undefined;
    });
    const command = (name: string, description: string, action: (args: string) => Promise<string>): void => {
      pi.registerCommand(name, { description, handler: async (args, ctx) => {
        const before = epoch;
        try { const text = await action(args); if (epoch === before && !shut) notify(ctx, text); }
        catch { if (epoch === before && !shut) notify(ctx, "Vista MISSING/refused; authorization=none executable=false"); }
      } });
    };
    command("vista-status", "Read non-authorizing observation status", async () => canonical(status()));
    command("vista-preview", "Read authentic historical guidance without injection", async () => { const p = await controller.preview(); return `${p.preview_digest}\n${p.context.content}`; });
    command("vista-adopt", "Acknowledge an exact current preview locally only", async args => {
      const p = activeEpoch().preview; if (!p) refuse(); return canonical(await controller.adopt(p.view, args));
    });
    command("vista-verify", "Explicit fresh current evidence check, never permission", async () => canonical(await controller.verifyCurrent()));
  } });
}
