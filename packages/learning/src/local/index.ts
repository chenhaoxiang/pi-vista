import { types } from "node:util";
import { isLocalEvidenceVerifier, type LocalEvidenceVerifier, type LocalVerifiedEvidence } from "@pi-vista/evidence/host";
import { DEFAULT_TIMEOUT_MS, MAX_EXPERIENCES, LearningError, type ContextOptions, type ExperienceObservation, type PromotionConfirmation, type RetrievalQuery } from "../contract.js";
import { binding, bindingOf, canonical, digest, frozen, hash, integer, invalid, label, list, own, sameRetrievalBinding } from "../data.js";
import { contextOptions, query as snapshotQuery, type SnapshotQuery } from "../input.js";
import { document, prepareGuidanceDocument, writeRequest } from "../guidance/data.js";
import type { GuidanceDocument, GuidanceReadback, GuidanceReceipt, GuidanceReference, HindsightGuidanceStore } from "../guidance/contract.js";
import { readback, receipt, snapshotReference } from "./data.js";
import type { LocalCompiledContext, LocalContextProvenance, LocalExperienceHandle, LocalGuidancePlan, LocalImportContext, LocalLearningConfig, LocalLearningLibrary, LocalLearningStatus, LocalRetrievalResult } from "./contract.js";
export * from "./contract.js";

interface RecordState { readonly input: ExperienceObservation; current: LocalExperienceHandle; proof?: LocalVerifiedEvidence;
  attempted: boolean; origin?: GuidanceReference; receipt?: GuidanceReceipt; }
interface PlanState { readonly record: RecordState; readonly handle: LocalExperienceHandle; readonly proof: LocalVerifiedEvidence; used: boolean; }
interface SelectionState { readonly query: SnapshotQuery; readonly handles: readonly LocalExperienceHandle[]; }
const TERMINAL = ["rejected", "deprecated", "superseded"];
const HEADER = "authorization=none\nexecutable=false\nmode=local-script-step-context\nbudget=characters-not-tokens\n";
const order = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
function safeError(error: unknown): LearningError {
  if (!types.isProxy(error) && error !== null && typeof error === "object") {
    const code = Object.getOwnPropertyDescriptor(error, "code");
    if (code && Object.hasOwn(code, "value") && ["sink-failed", "sink-timeout", "sink-mismatch", "unverified-evidence", "promotion-invalidated"].includes(code.value as string))
      return new LearningError(code.value as LearningError["code"]);
  }
  return new LearningError("sink-failed");
}

/** Separate opt-in LOCAL workflow; root/signed Learning acceptance remains unchanged. */
export function createLocalLearningLibrary(config: LocalLearningConfig): LocalLearningLibrary {
  let verifier: LocalEvidenceVerifier; let scope: string; let store: HindsightGuidanceStore | undefined; let timeout: number;
  try {
    const c = own(config, ["mode", "scope", "verifier", "store", "timeout_ms"], ["mode", "scope", "verifier"]);
    if (c.mode !== "local-learning" || !isLocalEvidenceVerifier(c.verifier)) invalid(); verifier = c.verifier;
    scope = label(c.scope); timeout = integer(c.timeout_ms ?? DEFAULT_TIMEOUT_MS, 180_000, 1);
    if (c.store !== undefined) {
      const s = own(c.store, ["retain", "read", "query", "reconcile"]);
      for (const f of Object.values(s)) if (typeof f !== "function" || types.isProxy(f)) invalid();
      store = frozen(s) as unknown as HindsightGuidanceStore;
    }
  } catch { throw new LearningError("invalid-config"); }
  let open = true;
  const handles = new WeakMap<object, RecordState>(); const ids = new Set<string>();
  const plans = new WeakMap<object, PlanState>(); const selections = new WeakMap<object, SelectionState>();
  const histories = new WeakSet<object>(); const attempts = new Set<string>(); const pending = new Set<AbortController>();
  const requireOpen = () => { if (!open) throw new LearningError("invalid-transition"); };
  function lookup(value: unknown): RecordState | undefined { return value !== null && typeof value === "object" ? handles.get(value) : undefined; }
  function active(value: unknown): RecordState {
    requireOpen(); const record = lookup(value);
    if (!record || record.current !== value) throw new LearningError("invalid-handle"); return record;
  }
  function current(record: RecordState): boolean {
    return open && !TERMINAL.includes(record.current.status) && !!record.proof && verifier.isCurrent(record.proof, bindingOf(record.input));
  }
  function verified(value: unknown): RecordState {
    const record = active(value);
    if (!["verified", "persisted"].includes(record.current.status) || !current(record)) throw new LearningError("unverified-evidence");
    return record;
  }
  function raise(record: RecordState, status: LocalLearningStatus, supersededBy?: string): LocalExperienceHandle {
    const handle = frozen({ ...record.input, status, authorization: "none" as const, executable: false as const,
      ...(record.proof === undefined ? {} : { verification: frozen({ verification: "local-host-process" as const, scope,
        portable: false as const, observations: record.proof.observations }) }),
      ...(record.receipt === undefined ? {} : { persistence: record.receipt }),
      ...(record.origin === undefined ? {} : { historical_origin: record.origin }),
      ...(supersededBy === undefined ? {} : { superseded_by: supersededBy }) });
    record.current = handle; handles.set(handle, record); return handle;
  }
  function observe(input: ExperienceObservation): LocalExperienceHandle {
    requireOpen(); const safe = document(prepareGuidanceDocument(input)).guidance.experience;
    if (ids.has(safe.experience_id)) throw new LearningError("duplicate-experience"); if (ids.size >= MAX_EXPERIENCES) invalid();
    const record = { input: safe, attempted: false } as RecordState;
    ids.add(safe.experience_id); return raise(record, "observed");
  }
  function still(plan: PlanState, proof: LocalVerifiedEvidence): void {
    if (!open || plan.record.current !== plan.handle || plan.handle.status !== "verified") throw new LearningError("promotion-invalidated");
    if (!verifier.isCurrent(proof, bindingOf(plan.record.input)) || proof.scope !== scope) throw new LearningError("unverified-evidence");
  }
  // One total deadline and retirement abort for a whole store operation. Native
  // promises are checked before assimilation; late work is observed but never raised.
  function io<T>(call: (signal: AbortSignal, check: () => void) => Promise<T>): Promise<T> {
    requireOpen(); if (!store) return Promise.reject(new LearningError("sink-unavailable"));
    const controller = new AbortController(); pending.add(controller); const start = performance.now();
    return new Promise<T>((resolve, reject) => {
      let done = false; let timedOut = false;
      const finish = (value?: T, error?: LearningError) => {
        if (done) return; done = true; clearTimeout(timer);
        controller.signal.removeEventListener("abort", aborted); pending.delete(controller);
        if (error) { controller.abort(); reject(error); } else resolve(value as T);
      };
      const check = () => {
        if (timedOut || performance.now() - start >= timeout) throw new LearningError("sink-timeout");
        if (!open || controller.signal.aborted) throw new LearningError("sink-failed");
      };
      const aborted = () => finish(undefined, new LearningError(timedOut ? "sink-timeout" : "sink-failed"));
      controller.signal.addEventListener("abort", aborted, { once: true });
      const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeout);
      try {
        check(); const task = call(controller.signal, check);
        if (types.isProxy(task) || !types.isPromise(task)) throw new LearningError("sink-failed");
        Promise.prototype.then.call(task, (value: T) => { try { check(); finish(value); } catch (e) { finish(undefined, safeError(e)); } },
          (e: unknown) => finish(undefined, safeError(e)));
      } catch (e) { finish(undefined, safeError(e)); }
    });
  }
  function native<T>(promise: Promise<T>): Promise<{ readonly value: T }> {
    if (types.isProxy(promise) || !types.isPromise(promise)) throw new LearningError("sink-failed");
    // Wrap fulfillment before resolving: a raw DTO's .then must never be invoked
    // by a second promise assimilation before closed own-data validation.
    return new Promise((resolve, reject) => { Promise.prototype.then.call(promise, (value: T) => resolve({ value }), reject); });
  }
  async function read(ref: GuidanceReference | GuidanceReceipt, signal: AbortSignal, check: () => void): Promise<GuidanceReadback> {
    check(); const { value: raw } = await native(store!.read(ref, signal)); check();
    let result: GuidanceReadback;
    try { result = readback(raw, ref); } catch { throw new LearningError("sink-mismatch"); }
    histories.add(result); return result;
  }
  const library: LocalLearningLibrary = frozen({
    observe,
    nominate(handle: LocalExperienceHandle) {
      const record = active(handle); if (handle.status !== "observed") throw new LearningError("invalid-transition"); return raise(record, "candidate");
    },
    verifyCandidate(handle: LocalExperienceHandle, proof: unknown) {
      const record = active(handle);
      if (!["candidate", "verified", "persisted"].includes(handle.status)) throw new LearningError("invalid-transition");
      if (!verifier.isCurrent(proof, bindingOf(record.input))) throw new LearningError("unverified-evidence");
      const local = proof as LocalVerifiedEvidence;
      if (local.scope !== scope) throw new LearningError("unverified-evidence");
      record.proof = local; return raise(record, handle.status === "persisted" ? "persisted" : "verified");
    },
    reject(handle: LocalExperienceHandle) {
      const record = active(handle); if (!["observed", "candidate", "verified"].includes(handle.status)) throw new LearningError("invalid-transition");
      delete record.proof; return raise(record, "rejected");
    },
    deprecate(handle: LocalExperienceHandle) {
      const record = active(handle); if (handle.status !== "persisted") throw new LearningError("invalid-transition");
      delete record.proof; return raise(record, "deprecated");
    },
    supersede(handle: LocalExperienceHandle, replacement: LocalExperienceHandle) {
      const record = active(handle); const next = verified(replacement);
      if (!["verified", "persisted"].includes(handle.status) || record === next || record.input.task_type !== next.input.task_type ||
          !sameRetrievalBinding(record.input, next.input)) throw new LearningError("invalid-transition");
      delete record.proof; return raise(record, "superseded", replacement.experience_id);
    },
    prepareGuidance(handle: LocalExperienceHandle, bankInput: string) {
      const record = verified(handle); if (handle.status !== "verified") throw new LearningError("invalid-transition");
      const request = writeRequest(bankInput, prepareGuidanceDocument(record.input));
      const preview = { mode: "dry-run" as const, authorization: "none" as const, executable: false as const,
        experience_id: handle.experience_id, scope, bank: request.bank, document: request.document, idempotency_key: request.idempotency_key };
      const plan = frozen({ ...preview, preview_digest: hash(canonical(preview)) });
      plans.set(plan, { record, handle, proof: record.proof!, used: false }); return plan;
    },
    async commitGuidance(plan: LocalGuidancePlan, confirmation: PromotionConfirmation) {
      requireOpen(); const p = plan !== null && typeof plan === "object" ? plans.get(plan) : undefined;
      if (!p) throw new LearningError("invalid-plan");
      let confirmed: string;
      try { confirmed = digest(own(confirmation, ["preview_digest"]).preview_digest); } catch { throw new LearningError("invalid-confirmation"); }
      if (confirmed !== plan.preview_digest) throw new LearningError("invalid-confirmation");
      if (p.used || p.record.attempted || attempts.has(plan.idempotency_key)) throw new LearningError("promotion-used");
      if (!store) throw new LearningError("sink-unavailable"); still(p, p.proof);
      p.used = true; p.record.attempted = true; attempts.add(plan.idempotency_key);
      const result = await io(async (signal, check) => {
        check(); let fresh: LocalVerifiedEvidence;
        try { fresh = await verifier.revalidate(p.proof); } catch { throw new LearningError("unverified-evidence"); }
        check(); still(p, fresh); p.record.proof = fresh;
        const { value: raw } = await native(store!.retain(plan.bank, plan.document, signal)); check(); still(p, fresh);
        let accepted: GuidanceReceipt;
        try { accepted = receipt(raw, plan.bank, plan.document); } catch { throw new LearningError("sink-mismatch"); }
        const stored = await read(accepted, signal, check); check(); still(p, fresh);
        if (canonical(stored.document) !== canonical(plan.document)) throw new LearningError("sink-mismatch");
        return { accepted, fresh };
      });
      still(p, result.fresh); p.record.receipt = result.accepted; return raise(p.record, "persisted");
    },
    async reconcileGuidance(bankInput: string, input: GuidanceDocument) {
      requireOpen(); const bank = label(bankInput); let doc: GuidanceDocument;
      try { doc = document(input).document; } catch { throw new LearningError("invalid-input"); }
      return io(async (signal, check) => {
        check(); const { value: raw } = await native(store!.reconcile(bank, doc, signal)); check();
        try {
          const v = own(raw, ["state", "current_verification", "authorization", "executable"]);
          if (!["matched", "not-confirmed"].includes(v.state as string) || v.current_verification !== "not-checked" || v.authorization !== "none" || v.executable !== false) invalid();
          return frozen({ state: v.state as "matched" | "not-confirmed", current_verification: "not-checked" as const, authorization: "none" as const, executable: false as const });
        } catch { throw new LearningError("sink-mismatch"); }
      });
    },
    async readGuidance(input: GuidanceReference | GuidanceReceipt) {
      requireOpen(); const ref = snapshotReference(input); return io((signal, check) => read(ref, signal, check));
    },
    async recallGuidance(bankInput: string, queryInput: RetrievalQuery) {
      requireOpen(); const bank = label(bankInput); const query = snapshotQuery(queryInput);
      return io(async (signal, check) => {
        check(); const { value: raw } = await native(store!.query(bank, query, signal)); check();
        let refs: readonly (GuidanceReference | GuidanceReceipt)[];
        try { refs = list(raw, query.limit).map(snapshotReference); if (refs.some(r => r.bank !== bank)) invalid(); } catch { throw new LearningError("sink-mismatch"); }
        const results: GuidanceReadback[] = []; const seen = new Set<string>();
        for (const ref of refs) {
          if (seen.has(ref.document_id)) continue; seen.add(ref.document_id);
          const result = await read(ref, signal, check); const e = result.guidance.experience;
          if (sameRetrievalBinding(e, query) && (e.task_type === query.task_type || e.script.applicable_to.includes(query.task_type))) results.push(result);
        }
        return frozen(results);
      });
    },
    importGuidance(history: GuidanceReadback, context: LocalImportContext) {
      requireOpen(); if (history === null || typeof history !== "object" || !histories.has(history)) throw new LearningError("stale-history");
      const c = own(context, ["experience_id", "run_id", "repo", "source_sha", "policy_version", "env_fingerprint", "ts"]);
      const expected = binding({ run_id: c.run_id, repo: c.repo, source_sha: c.source_sha, policy_version: c.policy_version, env_fingerprint: c.env_fingerprint });
      const id = label(c.experience_id); const e = history.guidance.experience;
      if (!sameRetrievalBinding(expected, e) || expected.run_id === e.run_id || id === e.experience_id) throw new LearningError("stale-history");
      const handle = observe({ ...expected, experience_id: id, ts: integer(c.ts), task_type: e.task_type, script: e.script, steps: e.steps });
      const record = active(handle); record.origin = snapshotReference({ bank: history.bank, document_id: history.document_id,
        current_verification: "not-checked", authorization: "none", executable: false }); return raise(record, "observed");
    },
    retrieve(inputs: readonly unknown[], queryInput: RetrievalQuery) {
      requireOpen(); const pool = list(inputs, MAX_EXPERIENCES); const query = snapshotQuery(queryInput);
      const rejected = { unverified: 0, stale: 0, lifecycle: 0, mismatch: 0, task: 0, limit: 0 }; const matches: LocalExperienceHandle[] = []; const seen = new Set<string>();
      for (const value of pool) {
        const record = lookup(value); if (!record) { rejected.unverified++; continue; }
        const handle = record.current; if (handle !== value) { rejected.stale++; continue; }
        if (TERMINAL.includes(handle.status)) { rejected.lifecycle++; continue; }
        if (!["verified", "persisted"].includes(handle.status) || !record.proof) { rejected.unverified++; continue; }
        if (!current(record)) { rejected.stale++; continue; }
        if (!sameRetrievalBinding(record.input, query)) { rejected.mismatch++; continue; }
        if (handle.task_type !== query.task_type && !handle.script.applicable_to.includes(query.task_type)) { rejected.task++; continue; }
        if (!seen.has(handle.experience_id)) { matches.push(handle); seen.add(handle.experience_id); }
      }
      matches.sort((a, b) => Number(b.task_type === query.task_type) - Number(a.task_type === query.task_type) || order(a.experience_id, b.experience_id));
      rejected.limit = Math.max(0, matches.length - query.limit);
      const result = frozen({ mode: "local-selection" as const, authorization: "none" as const, executable: false as const,
        handles: frozen(matches.slice(0, query.limit)), rejected: frozen(rejected) }); selections.set(result, { query, handles: result.handles }); return result;
    },
    compileContext(selection: LocalRetrievalResult, optionsInput: ContextOptions = {}): LocalCompiledContext {
      requireOpen(); const options = contextOptions(optionsInput); const state = selection !== null && typeof selection === "object" ? selections.get(selection) : undefined;
      if (!state) throw new LearningError("stale-selection");
      let records: RecordState[];
      try { records = state.handles.map(handle => { const record = verified(handle); if (!sameRetrievalBinding(record.input, state.query)) invalid(); return record; }); }
      catch { throw new LearningError("stale-selection"); }
      let content = HEADER; const included: string[] = []; const omitted: string[] = []; const provenance: LocalContextProvenance[] = [];
      for (const record of records) {
        const handle = record.current; const p = frozen({ ...bindingOf(record.input), experience_id: handle.experience_id,
          status: handle.status as "verified" | "persisted", scope, observation_digests: frozen(record.proof!.observations.map(o => o.observation_digest)) });
        const item = canonical({ authorization: "none", executable: false, provenance: p, script: handle.script, steps: handle.steps });
        if (included.length >= options.max_items || content.length + item.length + 1 > options.max_characters) { omitted.push(handle.experience_id); continue; }
        content += `${item}\n`; included.push(handle.experience_id); provenance.push(p);
      }
      return frozen({ mode: "local-script-step-context", authorization: "none", executable: false, budget_unit: "characters", content,
        character_count: content.length, max_characters: options.max_characters, item_count: included.length,
        selected_ids: frozen(included), omitted_ids: frozen(omitted), provenance: frozen(provenance) });
    },
    shutdown() { open = false; for (const controller of pending) controller.abort(); },
  });
  return library;
}
