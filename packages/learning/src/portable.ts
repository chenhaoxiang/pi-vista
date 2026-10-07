import {
  DEFAULT_TIMEOUT_MS, MAX_EXPERIENCES, MAX_TIMEOUT_MS, LearningError,
  type ContextOptions, type SafeDocument,
} from "./contract.js";
import {
  MAX_ARCHIVE_AGE_MS, MAX_LIFECYCLE_AGE_MS,
  type ArchiveLifecycleReceipt, type ArchiveReference, type ArchiveScope, type HistoricalContext, type HistoricalExperience,
  type HistoricalLifecycle, type HistoricalOriginReference, type HistoricalQuery, type HistoricalSelection,
  type HindsightDocumentRef, type HindsightRecallPort, type PortableRecall, type PortableRecallConfig, type SafeExperienceSnapshot,
} from "./portable-contract.js";
import { bounded, canonical, digest, frozen, integer, invalid, label, list, own, sameRetrievalBinding } from "./data.js";
import { contextOptions, query as snapshotQuery } from "./input.js";
import { authenticateSignature, callback, clock, decodeDocument, document, originIdentity, originOf, pin, scope, type OriginPin } from "./portable-data.js";

interface HistoryRecord {
  readonly view: HistoricalExperience;
  readonly check: () => void;
}
// Only independently verified history can cross into observed-only import. Copies carry no capability.
const historical = new WeakMap<object, HistoryRecord>();
function historyRecord(input: unknown): HistoryRecord {
  const record = input !== null && typeof input === "object" ? historical.get(input) : undefined;
  if (!record) throw new LearningError("unverified-archive"); record.check(); return record;
}
export function historicalImport(input: unknown): { readonly experience: SafeExperienceSnapshot; readonly origin: HistoricalOriginReference } {
  const view = historyRecord(input).view;
  return frozen({ experience: view.experience, origin: historicalOrigin(view) });
}
function historicalOrigin(view: HistoricalExperience): HistoricalOriginReference {
  return frozen({ ...view.origin, archive_digest: view.archive_digest, archived_at: view.archived_at,
    experience_id: view.experience.experience_id, run_id: view.experience.run_id, source_sha: view.experience.source_sha,
    policy_version: view.experience.policy_version, env_fingerprint: view.experience.env_fingerprint });
}
type Query = HistoricalQuery & { readonly limit: number };
function query(input: unknown): Query {
  const v = own(input, ["bank", "repo", "source_sha", "policy_version", "env_fingerprint", "task_type", "limit"],
    ["bank", "repo", "source_sha", "policy_version", "env_fingerprint", "task_type"]);
  return frozen({ bank: label(v.bank), ...snapshotQuery({ repo: v.repo, source_sha: v.source_sha, policy_version: v.policy_version,
    env_fingerprint: v.env_fingerprint, task_type: v.task_type, ...(v.limit === undefined ? {} : { limit: v.limit }) } as HistoricalQuery) });
}
function reference(input: unknown): HindsightDocumentRef {
  const v = own(input, ["document_id", "bank"]); return frozen({ document_id: label(v.document_id), bank: label(v.bank) });
}
const HEADER = "authorization=none\nexecutable=false\nverification=historical-authenticated\ncurrent-verification=not-checked\nbudget=characters\n";
const compare = (a: string, b: string): number => a < b ? -1 : a > b ? 1 : 0;

/** Explicit public-key/port factory. A historical signature can never mint live VerifiedEvidence. */
export function createPortableRecall(config: PortableRecallConfig): PortableRecall {
  let pins: Map<string, OriginPin>; let now: () => number; let maxAge: number; let timeout: number;
  let port: HindsightRecallPort | undefined; let lifecycle: PortableRecallConfig["lifecycle"]; let lifecycleAge: number;
  try {
    const c = own(config, ["origins", "now", "max_age_ms", "port", "lifecycle", "max_lifecycle_age_ms", "timeout_ms"], ["origins", "now", "max_age_ms"]);
    pins = new Map();
    for (const input of list(c.origins, MAX_EXPERIENCES, 1)) {
      const p = pin(input); const identity = originIdentity(p);
      if (pins.has(identity)) invalid(); pins.set(identity, p);
    }
    now = clock(c.now); maxAge = integer(c.max_age_ms, MAX_ARCHIVE_AGE_MS, 1);
    timeout = integer(c.timeout_ms ?? DEFAULT_TIMEOUT_MS, MAX_TIMEOUT_MS, 1);
    lifecycleAge = integer(c.max_lifecycle_age_ms ?? 600_000, MAX_LIFECYCLE_AGE_MS, 1);
    if (c.port !== undefined) {
      const p = own(c.port, ["query", "read"]);
      port = frozen({ query: callback<HindsightRecallPort["query"]>(p.query), read: callback<HindsightRecallPort["read"]>(p.read) });
    }
    if (c.lifecycle !== undefined) lifecycle = callback<NonNullable<PortableRecallConfig["lifecycle"]>>(c.lifecycle);
  } catch { throw new LearningError("invalid-config"); }
  const views = new WeakSet<object>();
  const selections = new WeakMap<object, { readonly query: Query; readonly histories: readonly HistoricalExperience[] }>();
  function check(view: HistoricalExperience): void {
    try {
      const p = pins.get(originIdentity(view.origin)); const time = now();
      if (!p || p.trust !== "pinned-history" || view.archived_at < p.not_before || view.archived_at >= p.not_after ||
        view.archived_at > time || time - view.archived_at > maxAge) invalid();
      if (view.lifecycle.state === "eligible-at-policy-check" &&
        (view.lifecycle.checked_at > time || time >= view.lifecycle.expires_at || time - view.lifecycle.checked_at > lifecycleAge)) invalid();
    } catch { throw new LearningError("stale-history"); }
  }
  async function authenticate(input: SafeDocument, expectedInput: ArchiveScope): Promise<HistoricalExperience> {
    let decoded: ReturnType<typeof decodeDocument>;
    try {
      const expected = scope(expectedInput); decoded = decodeDocument(input);
      const p = decoded.payload; const trusted = pins.get(originIdentity(p.origin));
      if (!trusted || p.origin.repo !== expected.repo || p.origin.bank !== expected.bank) invalid();
      authenticateSignature(p, decoded.archive_digest, decoded.signature, trusted);
      const time = now(); if (p.archived_at > time || time - p.archived_at > maxAge) invalid();
    } catch { throw new LearningError("unverified-archive"); }
    const p = decoded.payload;
    let status: HistoricalLifecycle = frozen({ state: "not-checked" });
    if (lifecycle) {
      const ref: ArchiveReference = frozen({ ...p.origin, archive_digest: decoded.archive_digest });
      const result = await bounded(signal => lifecycle!(ref, signal), timeout, value => {
        const v = own(value, ["role", "issuer", "key_id", "repo", "bank", "archive_digest", "state", "checked_at", "expires_at"]);
        const returnedOrigin = originOf({ role: v.role, issuer: v.issuer, key_id: v.key_id, repo: v.repo, bank: v.bank } as ArchiveReference);
        if (originIdentity(returnedOrigin) !== originIdentity(ref) || digest(v.archive_digest) !== ref.archive_digest ||
          typeof v.state !== "string" || !["active", "deprecated", "revoked", "rejected", "superseded"].includes(v.state)) invalid();
        const checked = integer(v.checked_at); const expires = integer(v.expires_at); const time = now();
        if (checked > time || time >= expires || expires <= checked || expires - checked > lifecycleAge || time - checked > lifecycleAge) invalid();
        return frozen({ ...returnedOrigin, archive_digest: ref.archive_digest, state: v.state, checked_at: checked, expires_at: expires }) as ArchiveLifecycleReceipt;
      });
      if (result.state !== "active") throw new LearningError("archive-withdrawn");
      status = frozen({ state: "eligible-at-policy-check", checked_at: result.checked_at, expires_at: result.expires_at });
    }
    const view: HistoricalExperience = frozen({ verification: "historical-authenticated", signature_checked: true, current_verification: "not-checked",
      authorization: "none", executable: false, archive_digest: decoded.archive_digest, origin: p.origin, archived_at: p.archived_at,
      source_status_at_archive: p.source_status_at_archive, lifecycle: status, experience: p.experience, evidence: p.evidence });
    check(view); historical.set(view, { view, check: () => check(view) }); views.add(view); return view;
  }
  function select(inputs: readonly HistoricalExperience[], queryInput: HistoricalQuery, bankRejected = 0, refDuplicates = 0): HistoricalSelection {
    const q = query(queryInput); const matches: HistoricalExperience[] = []; const seen = new Set<string>();
    const rejected = { bank: bankRejected, mismatch: 0, task: 0, duplicate: refDuplicates, limit: 0 };
    for (const input of list(inputs, MAX_EXPERIENCES)) {
      if (input === null || typeof input !== "object" || !views.has(input)) throw new LearningError("unverified-archive");
      const view = historyRecord(input).view;
      if (view.origin.bank !== q.bank) { rejected.bank++; continue; }
      if (!sameRetrievalBinding(view.experience, q)) { rejected.mismatch++; continue; }
      if (view.experience.task_type !== q.task_type && !view.experience.script.applicable_to.includes(q.task_type)) { rejected.task++; continue; }
      if (seen.has(view.archive_digest)) { rejected.duplicate++; continue; }
      seen.add(view.archive_digest); matches.push(view);
    }
    matches.sort((a, b) => Number(b.experience.task_type === q.task_type) - Number(a.experience.task_type === q.task_type) ||
      compare(a.experience.experience_id, b.experience.experience_id) || compare(a.archive_digest, b.archive_digest));
    rejected.limit = Math.max(0, matches.length - q.limit);
    const result: HistoricalSelection = frozen({ verification: "historical-authenticated", current_verification: "not-checked", authorization: "none", executable: false,
      mode: "historical-selection", histories: frozen(matches.slice(0, q.limit)), rejected: frozen(rejected) });
    selections.set(result, { query: q, histories: result.histories }); return result;
  }
  const recall: PortableRecall = frozen({
    authenticate,
    // Transport-derived count seeds remain private; extra JS arguments are ignored.
    select(inputs: readonly HistoricalExperience[], queryInput: HistoricalQuery): HistoricalSelection {
      return select(inputs, queryInput);
    },
    async recall(queryInput: HistoricalQuery): Promise<HistoricalSelection> {
      const q = query(queryInput); if (!port) throw new LearningError("recall-unavailable");
      const refs = await bounded(signal => port!.query(q, signal), timeout, value => {
        const v = own(value, ["documents"]); return frozen(list(v.documents, MAX_EXPERIENCES).map(reference));
      });
      let bankRejected = 0; let duplicates = 0; const seen = new Set<string>(); const histories: HistoricalExperience[] = [];
      for (const ref of refs) {
        if (ref.bank !== q.bank) { bankRejected++; continue; }
        const identity = canonical(ref); if (seen.has(identity)) { duplicates++; continue; } seen.add(identity);
        const result = await bounded(signal => port!.read(ref, signal), timeout, value => {
          const v = own(value, ["document_id", "bank", "document"]);
          if (v.document_id !== ref.document_id || v.bank !== ref.bank) invalid();
          // Snapshot before the next await; returned source objects cannot later redirect the document.
          const decoded = decodeDocument(v.document);
          return frozen({ document: document(decoded.payload, decoded.signature) });
        });
        histories.push(await authenticate(result.document, { repo: q.repo, bank: q.bank }));
      }
      // Any uncertain/malformed read rejects the whole recall; there is no hidden partial-success result.
      return select(histories, q, bankRejected, duplicates);
    },
    compileContext(selection: HistoricalSelection, optionsInput: ContextOptions = {}): HistoricalContext {
      const selected = selection !== null && typeof selection === "object" ? selections.get(selection) : undefined;
      if (!selected) throw new LearningError("stale-history");
      const options = contextOptions(optionsInput);
      for (const view of selected.histories) { historyRecord(view); if (!sameRetrievalBinding(view.experience, selected.query) || view.origin.bank !== selected.query.bank) throw new LearningError("stale-history"); }
      let content = HEADER; const included: string[] = []; const omitted: string[] = []; const provenance: HistoricalOriginReference[] = [];
      for (const view of selected.histories) {
        const source = historicalOrigin(view);
        const item = canonical({ verification: "historical-authenticated", current_verification: "not-checked", authorization: "none", executable: false,
          origin: source, lifecycle: view.lifecycle, source_status_at_archive: view.source_status_at_archive, evidence: view.evidence,
          script: view.experience.script, steps: view.experience.steps,
          ...(view.experience.failure_analysis === undefined ? {} : { failure_analysis: view.experience.failure_analysis }) });
        if (included.length >= options.max_items || content.length + item.length + 1 > options.max_characters) { omitted.push(view.archive_digest); continue; }
        content += `${item}\n`; included.push(view.archive_digest); provenance.push(source);
      }
      return frozen({ verification: "historical-authenticated", current_verification: "not-checked", authorization: "none", executable: false,
        mode: "historical-script-step-context", budget_unit: "characters", content, character_count: content.length, max_characters: options.max_characters,
        item_count: included.length, selected_digests: frozen(included), omitted_digests: frozen(omitted), provenance: frozen(provenance) });
    },
  });
  return recall;
}
