import { types } from "node:util";
import { isEvidenceVerifier, type EvidenceBinding, type ReceiptSummary, type VerifiedEvidence } from "@pi-vista/evidence";
import {
  DEFAULT_TIMEOUT_MS, MAX_TIMEOUT_MS, MAX_EXPERIENCES, MAX_DOCUMENT_CHARACTERS, MAX_EVALUATION_CASES, MAX_SELECTION_ITEMS,
  LearningError, type CompiledContext, type ContextOptions, type ContextProvenance, type Correction, type EvaluationCase,
  type EvaluationRow, type ExperienceHandle, type ExperienceObservation, type IngestRequest, type LearningConfig,
  type LearningLibrary, type LearningSink, type LearningStatus, type ModelStatistics, type PromotionConfirmation,
  type PromotionPlan, type RecordedComparison, type ReplayPlan, type RetrievalEvaluation, type RetrievalQuery,
  type RetrievalResult, type SafeDocument, type SinkReceipt,
} from "./contract.js";
import {
  binding, bindingOf, bounded, canonical, digest, frozen, hash, integer, invalid, label, labels, list, own,
  sameBinding, sameRetrievalBinding,
} from "./data.js";
import { contextOptions, correction as snapshotCorrection, observation, query as snapshotQuery, type SnapshotObservation, type SnapshotQuery } from "./input.js";
import type { ArchivePlan, ArchivePayload, ArchiveUpload, HistoricalExperience, HistoricalImportContext, HistoricalOriginReference } from "./portable-contract.js";
import { producer as snapshotProducer, originOf, payload as archivePayload, requireProducerTime, signDocument, type ArchiveProducer } from "./portable-data.js";
import { historicalImport } from "./portable.js";
export * from "./contract.js";
export * from "./portable-contract.js";
export { createPortableRecall } from "./portable.js";
export { classifyFailure } from "./failure.js";

/** Configuration snippet only: no configuration file, plugin or bank is edited. */
export const HINDSIGHT_CUSTOM_PAGES = frozen({ customPages: frozen({
  "Verified skills": frozen({ source_query: "What task patterns have been successfully completed, verified by tests and gate receipts, and are safe to reuse?", tags: frozen(["knowledge:skill"]) }),
  "Failure patterns": frozen({ source_query: "What has failed repeatedly? What was the root cause and the verified fix?", tags: frozen(["knowledge:failure"]) }),
}) });

interface ExperienceRecord { readonly input: SnapshotObservation; current: ExperienceHandle; proof?: VerifiedEvidence; promotionStarted: boolean; historicalOrigin?: HistoricalOriginReference; }
interface ArchivePlanRecord { readonly record: ExperienceRecord; readonly handle: ExperienceHandle; readonly proof: VerifiedEvidence; readonly payload: ArchivePayload; readonly request: IngestRequest; used: boolean; }
interface PlanRecord { readonly record: ExperienceRecord; readonly handle: ExperienceHandle; readonly proof: VerifiedEvidence; readonly request: IngestRequest; used: boolean; }
interface SelectionRecord { readonly query: SnapshotQuery; readonly handles: readonly ExperienceHandle[]; }
const CONTEXT_HEADER = "authorization=none\nmode=script-step-context\nbudget=characters-not-tokens\n";
const TERMINAL: readonly LearningStatus[] = ["rejected", "deprecated", "superseded"];
const compareLabels = (a: string, b: string): number => a < b ? -1 : a > b ? 1 : 0;

function safeReceipts(proof: VerifiedEvidence): readonly ReceiptSummary[] {
  return frozen(proof.receipts.map(receipt => frozen({ kind: receipt.kind, issuer: label(receipt.issuer), receipt_ref: label(receipt.receipt_ref),
    content_digest: digest(receipt.content_digest), expires_at: integer(receipt.expires_at) })));
}
function validateReceipt(input: unknown, request: IngestRequest): SinkReceipt {
  const v = own(input, ["document_id", "bank", "content_digest", "idempotency_key"]);
  const receipt = frozen({ document_id: label(v.document_id), bank: label(v.bank), content_digest: digest(v.content_digest), idempotency_key: label(v.idempotency_key) });
  if (receipt.bank !== request.bank || receipt.content_digest !== request.content_digest || receipt.idempotency_key !== request.idempotency_key) invalid();
  return receipt;
}
function validateReadback(input: unknown, receipt: SinkReceipt, request: IngestRequest): SinkReceipt {
  const v = own(input, ["document_id", "bank", "content_digest", "idempotency_key", "title", "content", "tags"]);
  const returned = validateReceipt({ document_id: v.document_id, bank: v.bank, content_digest: v.content_digest, idempotency_key: v.idempotency_key }, request);
  const tags = list(v.tags, 1, 1);
  if (returned.document_id !== receipt.document_id || v.title !== request.title || v.content !== request.content ||
    tags[0] !== request.tags[0] || typeof v.content !== "string" || hash(v.content) !== returned.content_digest) invalid();
  return returned;
}

/** Explicit host factory; only the exact evidence factory's verifier identity is accepted. */
export function createLearningLibrary(config: LearningConfig): LearningLibrary {
  let verifier: LearningConfig["verifier"]; let sink: LearningSink | undefined; let timeout: number; let archive: ArchiveProducer | undefined;
  try {
    const c = own(config, ["verifier", "sink", "timeout_ms", "archive"], ["verifier"]);
    if (!isEvidenceVerifier(c.verifier)) invalid(); verifier = c.verifier;
    timeout = integer(c.timeout_ms ?? DEFAULT_TIMEOUT_MS, MAX_TIMEOUT_MS, 1);
    if (c.archive !== undefined) archive = snapshotProducer(c.archive);
    if (c.sink !== undefined) {
      const s = own(c.sink, ["ingest", "readback"]);
      if (typeof s.ingest !== "function" || types.isProxy(s.ingest) || typeof s.readback !== "function" || types.isProxy(s.readback)) invalid();
      sink = frozen({ ingest: s.ingest as LearningSink["ingest"], readback: s.readback as LearningSink["readback"] });
    }
  } catch { throw new LearningError("invalid-config"); }
  const handles = new WeakMap<object, ExperienceRecord>(); const ids = new Set<string>();
  const plans = new WeakMap<object, PlanRecord>(); const selections = new WeakMap<object, SelectionRecord>();
  const archivePlans = new WeakMap<object, ArchivePlanRecord>(); const archived = new WeakSet<ExperienceRecord>();
  // Process-local, one-shot identities. The host must supply durable/cross-process idempotency.
  const attempts = new Set<string>();
  function lookup(value: unknown): ExperienceRecord | undefined {
    return value !== null && typeof value === "object" ? handles.get(value) : undefined;
  }
  function active(value: unknown): ExperienceRecord {
    const record = lookup(value);
    if (!record || record.current !== value) throw new LearningError("invalid-handle"); return record;
  }
  function raise(record: ExperienceRecord, status: LearningStatus, documentId?: string, supersededBy?: string): ExperienceHandle {
    const handle: ExperienceHandle = frozen({ ...record.input, authorization: "none", status,
      ...(record.proof === undefined ? {} : { verification: frozen({ verification: "authority-bound", authorization: "none", receipts: safeReceipts(record.proof) }) }),
      ...(documentId === undefined ? {} : { hindsight_doc_id: documentId }), ...(supersededBy === undefined ? {} : { superseded_by: supersededBy }),
      ...(record.historicalOrigin === undefined ? {} : { historical_origin: record.historicalOrigin }) });
    record.current = handle; handles.set(handle, record); return handle;
  }
  function verified(value: unknown): ExperienceRecord {
    const record = active(value);
    if ((record.current.status !== "verified" && record.current.status !== "trusted") || !record.proof || !verifier.isCurrent(record.proof, bindingOf(record.input))) {
      throw new LearningError("unverified-evidence");
    }
    return record;
  }
  function prepare(handle: ExperienceHandle, bankInput: string, correction?: Correction): PromotionPlan {
    const record = verified(handle);
    if (handle.status !== "verified") throw new LearningError("invalid-transition");
    const bank = label(bankInput); const proof = record.proof!;
    const isFailure = correction !== undefined || record.input.failure_analysis !== undefined;
    const content = canonical({ schema: 1, authorization: "none", purpose: correction === undefined ? "verified_experience" : "correction",
      experience: record.input, evidence: safeReceipts(proof), ...(correction === undefined ? {} : { correction }) });
    if (content.length > MAX_DOCUMENT_CHARACTERS) invalid();
    const document: SafeDocument = frozen({ title: `${correction === undefined ? (isFailure ? "Failure pattern" : "Verified skill") : "Correction"}: ${handle.experience_id}`,
      content, tags: frozen([isFailure ? "knowledge:failure" : "knowledge:skill"] as const), content_digest: hash(content) });
    const previewDigest = hash(canonical({ bank, document }));
    const request: IngestRequest = frozen({ bank, ...document, idempotency_key: `learning-${previewDigest}` });
    const plan: PromotionPlan = frozen({ authorization: "none", mode: "dry-run", experience_id: handle.experience_id, bank, document,
      preview_digest: previewDigest, idempotency_key: request.idempotency_key });
    plans.set(plan, { record, handle, proof, request, used: false }); return plan;
  }
  function stillValid(plan: PlanRecord, proof: VerifiedEvidence): void {
    if (plan.record.current !== plan.handle || plan.handle.status !== "verified") throw new LearningError("promotion-invalidated");
    if (!verifier.isCurrent(proof, bindingOf(plan.record.input))) throw new LearningError("unverified-evidence");
  }
  function stillArchiveValid(record: ExperienceRecord, handle: ExperienceHandle, proof: VerifiedEvidence, payload: ArchivePayload): void {
    if (record.current !== handle || !["verified", "trusted"].includes(handle.status)) throw new LearningError("archive-invalidated");
    if (!verifier.isCurrent(proof, bindingOf(record.input))) throw new LearningError("unverified-evidence");
    requireProducerTime(payload, archive!);
  }
  function replay(handle: ExperienceHandle, expectedInput: EvidenceBinding): ReplayPlan {
    const record = active(handle); const expected = binding(expectedInput);
    if (TERMINAL.includes(handle.status)) throw new LearningError("invalid-transition");
    if (!sameBinding(record.input, expected)) throw new LearningError("unverified-evidence");
    return frozen({ ...expected, authorization: "none", mode: "recorded-only", executable: false,
      experience_id: handle.experience_id, ts: handle.ts, script: handle.script, timeline: handle.steps });
  }
  function retrieve(inputs: readonly unknown[], queryInput: RetrievalQuery): RetrievalResult {
    const pool = list(inputs, MAX_EXPERIENCES); const query = snapshotQuery(queryInput);
    const rejected = { unverified: 0, stale: 0, lifecycle: 0, mismatch: 0, task: 0, limit: 0 };
    const matches: ExperienceHandle[] = []; const seen = new Set<string>();
    for (const input of pool) {
      const record = lookup(input);
      if (!record) { rejected.unverified++; continue; }
      if (record.current !== input) { rejected.stale++; continue; }
      const handle = record.current;
      if (TERMINAL.includes(handle.status)) { rejected.lifecycle++; continue; }
      if ((handle.status !== "verified" && handle.status !== "trusted") || !record.proof) { rejected.unverified++; continue; }
      if (!verifier.isCurrent(record.proof, bindingOf(record.input))) { rejected.stale++; continue; }
      if (!sameRetrievalBinding(record.input, query)) { rejected.mismatch++; continue; }
      if (handle.task_type !== query.task_type && !handle.script.applicable_to.includes(query.task_type)) { rejected.task++; continue; }
      if (!seen.has(handle.experience_id)) { matches.push(handle); seen.add(handle.experience_id); }
    }
    matches.sort((a, b) => Number(b.task_type === query.task_type) - Number(a.task_type === query.task_type) ||
      Number(b.status === "trusted") - Number(a.status === "trusted") || compareLabels(a.experience_id, b.experience_id));
    rejected.limit = Math.max(0, matches.length - query.limit);
    const result: RetrievalResult = frozen({ authorization: "none", mode: "offline-selection", handles: frozen(matches.slice(0, query.limit)), rejected: frozen(rejected) });
    selections.set(result, { query, handles: result.handles }); return result;
  }
  function compile(selection: RetrievalResult, optionsInput: ContextOptions = {}): CompiledContext {
    const options = contextOptions(optionsInput);
    const selected = selection !== null && typeof selection === "object" ? selections.get(selection) : undefined;
    if (!selected) throw new LearningError("stale-selection");
    const valid = selected.handles.map(handle => {
      try {
        const record = verified(handle);
        if (!sameRetrievalBinding(record.input, selected.query)) throw new LearningError("stale-selection"); return record;
      } catch { throw new LearningError("stale-selection"); }
    });
    let content = CONTEXT_HEADER; const included: string[] = []; const omitted: string[] = []; const provenance: ContextProvenance[] = [];
    for (const record of valid) {
      const handle = record.current;
      const source: ContextProvenance = frozen({ ...bindingOf(record.input), experience_id: handle.experience_id,
        status: handle.status as "verified" | "trusted", receipt_digests: frozen(record.proof!.receipts.map(receipt => receipt.content_digest)) });
      const item = canonical({ authorization: "none", provenance: source, script: handle.script, steps: handle.steps });
      if (included.length >= options.max_items || content.length + item.length + 1 > options.max_characters) { omitted.push(handle.experience_id); continue; }
      content += `${item}\n`; included.push(handle.experience_id); provenance.push(source);
    }
    return frozen({ authorization: "none", mode: "script-step-context", budget_unit: "characters", content,
      character_count: content.length, max_characters: options.max_characters, item_count: included.length,
      selected_ids: frozen(included), omitted_ids: frozen(omitted), provenance: frozen(provenance) });
  }
  const library: LearningLibrary = frozen({
    observe(input: ExperienceObservation): ExperienceHandle {
      const snapshot = observation(input);
      if (ids.has(snapshot.experience_id)) throw new LearningError("duplicate-experience");
      if (ids.size >= MAX_EXPERIENCES) invalid();
      // Every input is validated before reserving an identity.
      const record = Object.assign(Object.create(null), { input: snapshot, promotionStarted: false }) as ExperienceRecord;
      const handle = raise(record, "observed"); ids.add(snapshot.experience_id); return handle;
    },
    nominate(handle: ExperienceHandle): ExperienceHandle {
      const record = active(handle); if (handle.status !== "observed") throw new LearningError("invalid-transition");
      return raise(record, "candidate");
    },
    verifyCandidate(handle: ExperienceHandle, proof: VerifiedEvidence): ExperienceHandle {
      const record = active(handle); if (handle.status !== "candidate") throw new LearningError("invalid-transition");
      if (!verifier.isCurrent(proof, bindingOf(record.input))) throw new LearningError("unverified-evidence");
      safeReceipts(proof); record.proof = proof; return raise(record, "verified");
    },
    reject(handle: ExperienceHandle): ExperienceHandle {
      const record = active(handle);
      if (!["observed", "candidate", "verified"].includes(handle.status)) throw new LearningError("invalid-transition");
      return raise(record, "rejected");
    },
    deprecate(handle: ExperienceHandle): ExperienceHandle {
      const record = active(handle); if (handle.status !== "trusted") throw new LearningError("invalid-transition");
      return raise(record, "deprecated");
    },
    supersede(handle: ExperienceHandle, replacement: ExperienceHandle): ExperienceHandle {
      const record = active(handle); const next = verified(replacement);
      if (!["verified", "trusted"].includes(handle.status) || record === next || record.input.task_type !== next.input.task_type || !sameRetrievalBinding(record.input, next.input)) throw new LearningError("invalid-transition");
      return raise(record, "superseded", undefined, replacement.experience_id);
    },
    preparePromotion(handle: ExperienceHandle, bank: string): PromotionPlan { return prepare(handle, bank); },
    prepareCorrection(handle: ExperienceHandle, bank: string, input: Correction): PromotionPlan {
      const fix = snapshotCorrection(input); const record = verified(handle); const failure = record.input.failure_analysis;
      if (!failure || failure.failure_id !== fix.failure_id || failure.fix_outcome !== "resolved") throw new LearningError("invalid-transition");
      return prepare(handle, bank, fix);
    },
    async commitPromotion(plan: PromotionPlan, confirmation: PromotionConfirmation): Promise<ExperienceHandle> {
      const privatePlan = plan !== null && typeof plan === "object" ? plans.get(plan) : undefined;
      if (!privatePlan) throw new LearningError("invalid-plan");
      let confirmed: string;
      try { confirmed = digest(own(confirmation, ["preview_digest"]).preview_digest); } catch { throw new LearningError("invalid-confirmation"); }
      if (confirmed !== plan.preview_digest) throw new LearningError("invalid-confirmation");
      if (privatePlan.used || privatePlan.record.promotionStarted || attempts.has(plan.idempotency_key)) throw new LearningError("promotion-used");
      if (!sink) throw new LearningError("sink-unavailable");
      stillValid(privatePlan, privatePlan.proof);
      privatePlan.used = true; privatePlan.record.promotionStarted = true; attempts.add(plan.idempotency_key);
      let proof: VerifiedEvidence;
      try { proof = await verifier.revalidate(privatePlan.proof); } catch { throw new LearningError("unverified-evidence"); }
      stillValid(privatePlan, proof);
      const receipt = await bounded(signal => sink!.ingest(privatePlan.request, signal), timeout, value => validateReceipt(value, privatePlan.request));
      stillValid(privatePlan, proof);
      await bounded(signal => sink!.readback(receipt, signal), timeout, value => validateReadback(value, receipt, privatePlan.request));
      stillValid(privatePlan, proof);
      privatePlan.record.proof = proof; return raise(privatePlan.record, "trusted", receipt.document_id);
    },
    async prepareArchive(handle: ExperienceHandle, bankInput: string): Promise<ArchivePlan> {
      const record = verified(handle); const bank = label(bankInput);
      if (!archive) throw new LearningError("archive-unavailable");
      if (archive.pin.repo !== record.input.repo || archive.pin.bank !== bank) throw new LearningError("unverified-archive");
      const original = record.proof!;
      let proof: VerifiedEvidence;
      try { proof = await verifier.revalidate(original); } catch { throw new LearningError("unverified-evidence"); }
      if (record.current !== handle) throw new LearningError("archive-invalidated");
      if (!verifier.isCurrent(proof, bindingOf(record.input))) throw new LearningError("unverified-evidence");
      let payload: ArchivePayload;
      try {
        const time = archive.now(); if (time < proof.verified_at) invalid();
        payload = archivePayload({ schema: 1, purpose: "portable-experience-history", authorization: "none", executable: false,
          origin: originOf(archive.pin), archived_at: time, source_status_at_archive: handle.status,
          experience: record.input, evidence: safeReceipts(proof) });
      } catch { throw new LearningError("unverified-archive"); }
      stillArchiveValid(record, handle, proof, payload);
      const document = await signDocument(payload, archive, timeout);
      stillArchiveValid(record, handle, proof, payload);
      const previewDigest = hash(canonical({ bank, document }));
      const request: IngestRequest = frozen({ bank, ...document, idempotency_key: `archive-${previewDigest}` });
      const plan: ArchivePlan = frozen({ authorization: "none", executable: false, mode: "dry-run", experience_id: handle.experience_id,
        bank, origin: payload.origin, archive_digest: hash(canonical(payload)), document, preview_digest: previewDigest, idempotency_key: request.idempotency_key });
      archivePlans.set(plan, { record, handle, proof, payload, request, used: false }); return plan;
    },
    async commitArchive(plan: ArchivePlan, confirmation: PromotionConfirmation): Promise<ArchiveUpload> {
      const privatePlan = plan !== null && typeof plan === "object" ? archivePlans.get(plan) : undefined;
      if (!privatePlan) throw new LearningError("invalid-plan");
      let confirmed: string;
      try { confirmed = digest(own(confirmation, ["preview_digest"]).preview_digest); } catch { throw new LearningError("invalid-confirmation"); }
      if (confirmed !== plan.preview_digest) throw new LearningError("invalid-confirmation");
      if (privatePlan.used || archived.has(privatePlan.record) || attempts.has(plan.idempotency_key)) throw new LearningError("archive-used");
      if (!sink) throw new LearningError("sink-unavailable");
      stillArchiveValid(privatePlan.record, privatePlan.handle, privatePlan.proof, privatePlan.payload);
      privatePlan.used = true; archived.add(privatePlan.record); attempts.add(plan.idempotency_key);
      let proof: VerifiedEvidence;
      try { proof = await verifier.revalidate(privatePlan.proof); } catch { throw new LearningError("unverified-evidence"); }
      stillArchiveValid(privatePlan.record, privatePlan.handle, proof, privatePlan.payload);
      const receipt = await bounded(signal => sink!.ingest(privatePlan.request, signal), timeout, value => validateReceipt(value, privatePlan.request));
      stillArchiveValid(privatePlan.record, privatePlan.handle, proof, privatePlan.payload);
      await bounded(signal => sink!.readback(receipt, signal), timeout, value => validateReadback(value, receipt, privatePlan.request));
      stillArchiveValid(privatePlan.record, privatePlan.handle, proof, privatePlan.payload);
      return frozen({ ...receipt, authorization: "none", executable: false, persistence: "host-readback-matched", archive_digest: plan.archive_digest });
    },
    importHistorical(history: HistoricalExperience, context: HistoricalImportContext): ExperienceHandle {
      const source = historicalImport(history);
      const c = own(context, ["experience_id", "run_id", "repo", "source_sha", "policy_version", "env_fingerprint", "ts"]);
      const current = binding({ run_id: c.run_id, repo: c.repo, source_sha: c.source_sha, policy_version: c.policy_version, env_fingerprint: c.env_fingerprint });
      if (!sameRetrievalBinding(source.experience, current)) throw new LearningError("unverified-archive");
      // Old-run failure/model observations stay in history, not relabelled as this new run's measurements.
      const handle = library.observe({ ...current, experience_id: label(c.experience_id), ts: integer(c.ts), task_type: source.experience.task_type,
        script: source.experience.script, steps: source.experience.steps });
      const record = active(handle); record.historicalOrigin = source.origin; return raise(record, "observed");
    },
    planReplay: replay,
    compareRecorded(left: ExperienceHandle, right: ExperienceHandle, expected: EvidenceBinding): RecordedComparison {
      const l = replay(left, expected); const r = replay(right, expected);
      return frozen({ authorization: "none", mode: "recorded-comparison", executable: false, run_id: l.run_id,
        script_equal: canonical(l.script) === canonical(r.script), steps_equal: canonical(l.timeline) === canonical(r.timeline),
        failure_reason_equal: left.failure_analysis?.reason_code === right.failure_analysis?.reason_code,
        left_step_ids: frozen(l.timeline.map(step => step.step_id)), right_step_ids: frozen(r.timeline.map(step => step.step_id)) });
    },
    retrieve,
    compileContext: compile,
    evaluateRetrieval(inputs: readonly unknown[], casesInput: readonly EvaluationCase[]): RetrievalEvaluation {
      const pool = frozen(list(inputs, MAX_EXPERIENCES));
      // Snapshot every case before producing any view, and reject duplicate fixture IDs.
      const cases = list(casesInput, MAX_EVALUATION_CASES, 1).map(input => {
        const v = own(input, ["case_id", "query", "expected_ids", "context"], ["case_id", "query", "expected_ids"]);
        return frozen({ case_id: label(v.case_id), query: snapshotQuery(v.query as RetrievalQuery),
          expected_ids: labels(v.expected_ids, MAX_SELECTION_ITEMS), context: contextOptions(v.context === undefined ? {} : v.context as ContextOptions) });
      });
      if (new Set(cases.map(c => c.case_id)).size !== cases.length) invalid();
      const rows: EvaluationRow[] = cases.map(testCase => {
        const result = retrieve(pool, testCase.query); const context = compile(result, testCase.context);
        const ids = result.handles.map(handle => handle.experience_id);
        const matched = ids.filter(id => testCase.expected_ids.includes(id)).length;
        const steps = context.selected_ids.reduce((count, id) => count + result.handles.find(handle => handle.experience_id === id)!.steps.length, 0);
        return frozen({ case_id: testCase.case_id, successful_selection: matched === ids.length && matched === testCase.expected_ids.length,
          selected_ids: frozen(ids), expected_count: testCase.expected_ids.length, matched_count: matched,
          coverage: testCase.expected_ids.length === 0 ? 1 : matched / testCase.expected_ids.length,
          context_items: context.item_count, context_steps: steps, context_characters: context.character_count, rejected: result.rejected });
      });
      const expected = rows.reduce((sum, row) => sum + row.expected_count, 0); const matched = rows.reduce((sum, row) => sum + row.matched_count, 0);
      return frozen({ authorization: "none", evaluation: "offline-fixtures", capability_claim: "none", cases: frozen(rows),
        successful_selections: rows.filter(row => row.successful_selection).length, expected_count: expected, matched_count: matched,
        coverage: expected === 0 ? 1 : matched / expected, context_characters: rows.reduce((sum, row) => sum + row.context_characters, 0) });
    },
    modelStatistics(inputs: readonly ExperienceHandle[]): ModelStatistics {
      const counts = new Map<string, number>(); const seen = new Set<string>();
      for (const input of list(inputs, MAX_EXPERIENCES)) {
        const record = active(input);
        if (seen.has(record.input.experience_id)) continue; seen.add(record.input.experience_id);
        const model = record.input.model_id ?? "unspecified";
        counts.set(model, (counts.get(model) ?? 0) + 1);
      }
      return frozen({ authorization: "none", use: "observational-only", models: frozen([...counts].sort(([a], [b]) => compareLabels(a, b)).map(([model_id, observations]) => frozen({ model_id, observations }))) });
    },
  });
  return library;
}
