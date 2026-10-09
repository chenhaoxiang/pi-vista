import { types } from "node:util";
import path from "node:path";
import { LearningError, DEFAULT_TIMEOUT_MS, type ExperienceObservation, type RetrievalQuery } from "../contract.js";
import { canonical, digest, frozen, integer, invalid, label, list, own } from "../data.js";
import { query as snapshotQuery } from "../input.js";
import { targetFingerprint, validSignal, storeOperation } from "../hindsight/data.js";
import { attemptJournal } from "../hindsight/journal.js";
import { document, documentId, envelope, original, prefix, prepareGuidanceDocument, receipt, reference, scopedId, writeRequest, type WriteRequest } from "./data.js";
import type { GuidanceDocument, GuidanceReference, GuidanceReceipt, HindsightGuidanceConfig, HindsightGuidanceStore } from "./contract.js";
export * from "./contract.js";

const DOCUMENT_FIELDS = ["id", "bank_id", "original_text", "content_hash", "created_at", "updated_at", "memory_unit_count", "nodes_by_fact_type", "tags", "document_metadata", "retain_params", "observation_scopes", "attachments"];
const RESULT_FIELDS = ["id", "text", "type", "entities", "context", "occurred_start", "occurred_end", "mentioned_at", "document_id", "metadata", "chunk_id", "tags", "source_fact_ids", "scores", "attachments"];
const REF_FIELDS = ["bank", "document_id", "current_verification", "authorization", "executable"];
const input = <T>(call: () => T): T => { try { return call(); } catch { throw new LearningError("invalid-input"); } };
function mismatch(): never { throw new LearningError("sink-mismatch"); }

/** Pure safe historical guidance. No signer/current proof/library/store construction. */
export function prepareHistoricalGuidance(observation: ExperienceObservation): GuidanceDocument {
  return input(() => prepareGuidanceDocument(observation));
}

/** Explicit separate guidance transport; no effects/import discovery or original signed fallback. */
export function createHindsightGuidanceStore(config: HindsightGuidanceConfig): HindsightGuidanceStore {
  let endpoint: string; let directory: string; let token: string | undefined; let timeout: number; let maxBytes: number;
  const banks = new Map<string, { id: string; target: string }>();
  try {
    const c = own(config, ["mode", "endpoint", "banks", "journal_directory", "bearer_token", "allow_loopback_http", "timeout_ms", "max_response_bytes"], ["mode", "endpoint", "banks", "journal_directory"]);
    if (c.mode !== "local-guidance" || process.platform === "win32" || typeof process.getuid !== "function" || typeof c.endpoint !== "string" || c.endpoint.length > 2048) invalid();
    const url = new URL(c.endpoint);
    if (url.username || url.password || url.search || url.hash || (c.endpoint !== url.origin && c.endpoint !== `${url.origin}/`) ||
        (c.allow_loopback_http !== undefined && typeof c.allow_loopback_http !== "boolean")) invalid();
    if (url.protocol !== "https:" && !(url.protocol === "http:" && c.allow_loopback_http === true && ["127.0.0.1", "[::1]"].includes(url.hostname))) invalid();
    endpoint = url.origin;
    if (typeof c.journal_directory !== "string" || c.journal_directory.length > 4096 || !c.journal_directory.startsWith("/") || c.journal_directory === "/" ||
        /[\x00-\x1f\x7f]/u.test(c.journal_directory) || path.posix.normalize(c.journal_directory) !== c.journal_directory || c.journal_directory.endsWith("/")) invalid();
    directory = c.journal_directory;
    if (c.bearer_token !== undefined) {
      if (typeof c.bearer_token !== "string" || !c.bearer_token.length || c.bearer_token.length > 4096 || !/^[A-Za-z0-9._~+/-]+=*$/u.test(c.bearer_token)) invalid();
      token = c.bearer_token;
    }
    timeout = integer(c.timeout_ms ?? DEFAULT_TIMEOUT_MS, 180_000, 1); maxBytes = integer(c.max_response_bytes ?? 262_144, 1_048_576, 1);
    if (types.isProxy(c.banks) || c.banks === null || typeof c.banks !== "object") invalid();
    const keys = Reflect.ownKeys(c.banks); if (!keys.length || keys.length > 64 || keys.some(k => typeof k !== "string")) invalid();
    const aliases = own(c.banks, keys as string[]); const ids = new Set<string>();
    for (const alias of keys as string[]) {
      label(alias); const id = label(aliases[alias]); if (ids.has(id)) invalid(); ids.add(id);
      banks.set(alias, { id, target: targetFingerprint(endpoint, alias, id) });
    }
  } catch { throw new LearningError("invalid-config"); }
  const http = globalThis.fetch;
  const bank = (alias: string) => { const mapped = banks.get(alias); if (!mapped) invalid(); return mapped; };
  const tags = (target: string) => ["pi-vista:guidance-v1", `pi-vista:guidance-target:${target}`];
  async function request(mapped: { id: string }, route: string, signal: AbortSignal, check: () => void, body?: unknown, absent = false): Promise<unknown | null> {
    check();
    const options = {
      method: body === undefined ? "GET" : "POST", headers: { Accept: "application/json", ...(token === undefined ? {} : { Authorization: `Bearer ${token}` }),
        ...(body === undefined ? {} : { "Content-Type": "application/json" }) }, ...(body === undefined ? {} : { body: canonical(body) }),
      signal, redirect: "error" as const, credentials: "omit" as const, cache: "no-store" as const, referrerPolicy: "no-referrer" as const,
    };
    const response = await http(`${endpoint}/v1/default/banks/${encodeURIComponent(mapped.id)}/${route}`, options);
    check(); if (absent && response.status === 404) { await response.body?.cancel(); return null; }
    if (response.status !== 200 || !response.body) { await response.body?.cancel(); throw new LearningError("sink-failed"); }
    const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let bytes = 0;
    try {
      const declared = response.headers.get("content-length");
      if (declared !== null && (!/^\d+$/u.test(declared) || Number(declared) > maxBytes)) mismatch();
      for (;;) { check(); const part = await reader.read(); check(); if (part.done) break; bytes += part.value.byteLength;
        if (bytes > maxBytes) mismatch(); chunks.push(part.value); }
      return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks, bytes))) as unknown;
    } finally { await reader.cancel().catch(() => undefined); reader.releaseLock(); }
  }
  async function readOriginal(alias: string, id: string, signal: AbortSignal, check: () => void): Promise<WriteRequest | null> {
    const mapped = bank(alias); scopedId(id, mapped.target);
    const result = await request(mapped, `documents/${encodeURIComponent(id)}`, signal, check, undefined, true);
    if (result === null) return null;
    try {
      const v = own(result, DOCUMENT_FIELDS, ["id", "bank_id", "original_text", "content_hash", "created_at", "updated_at", "memory_unit_count"]);
      if (v.id !== id || v.bank_id !== mapped.id || (v.content_hash !== null && typeof v.content_hash !== "string") ||
          typeof v.created_at !== "string" || typeof v.updated_at !== "string") invalid(); integer(v.memory_unit_count);
      const safe = original(v.original_text, mapped.target, id); if (safe.bank !== alias) invalid(); return safe;
    } catch { mismatch(); }
  }
  async function requireBank(mapped: { id: string }, signal: AbortSignal, check: () => void): Promise<void> {
    const result = own(await request(mapped, "config", signal, check), ["bank_id", "config", "overrides"]);
    if (result.bank_id !== mapped.id || result.config === null || typeof result.config !== "object" || Array.isArray(result.config) ||
        result.overrides === null || typeof result.overrides !== "object" || Array.isArray(result.overrides)) mismatch();
    // Configuration values are neither projected nor persisted. This is a preflight,
    // not remote CAS against an administrator concurrently deleting the bank.
  }
  const prepare = (alias: string, value: GuidanceDocument, signal: unknown) => input(() => {
    const safe = writeRequest(alias, value); const mapped = bank(safe.bank); return { safe, mapped, signal: validSignal(signal) };
  });
  function snapshotRef(value: GuidanceReference, signal: unknown) {
    return input(() => {
      const v = own(value, [...REF_FIELDS, "content_digest", "idempotency_key"], REF_FIELDS);
      if (v.current_verification !== "not-checked" || v.authorization !== "none" || v.executable !== false) invalid();
      if (Object.hasOwn(v, "content_digest") !== Object.hasOwn(v, "idempotency_key")) invalid();
      const expected = v.content_digest === undefined ? undefined : { content_digest: digest(v.content_digest), idempotency_key: label(v.idempotency_key) };
      if (expected && !/^guidance-[a-f0-9]{64}$/u.test(expected.idempotency_key)) invalid();
      const alias = label(v.bank); return { bank: alias, document_id: scopedId(v.document_id, bank(alias).target), expected, signal: validSignal(signal) };
    });
  }
  return frozen({
    async retain(alias: string, value: GuidanceDocument, signal: AbortSignal): Promise<GuidanceReceipt> {
      const p = prepare(alias, value, signal); const claim = envelope(p.safe, p.mapped.target); const id = documentId(p.safe, p.mapped.target);
      return storeOperation(p.signal, timeout, async (abort, check) => {
        const journal = await attemptJournal(directory, p.safe.idempotency_key, claim, check);
        try {
          await requireBank(p.mapped, abort, check);
          const first = await journal.claim(); const existing = await readOriginal(p.safe.bank, id, abort, check);
          if (existing !== null && envelope(existing, p.mapped.target) !== claim) mismatch();
          if (existing === null) {
            if (!first) throw new LearningError("sink-failed");
            const ack = await request(p.mapped, "memories", abort, check, { async: false, items: [{ content: claim, document_id: id,
              timestamp: "unset", update_mode: "replace", tags: tags(p.mapped.target) }] });
            const a = own(ack, ["success", "bank_id", "items_count", "async", "operation_id", "operation_ids", "usage"], ["success", "bank_id", "items_count", "async"]);
            if (a.success !== true || a.bank_id !== p.mapped.id || a.items_count !== 1 || a.async !== false) mismatch();
            const fresh = await readOriginal(p.safe.bank, id, abort, check); if (!fresh || envelope(fresh, p.mapped.target) !== claim) mismatch();
          }
          await journal.complete(); check(); return receipt(p.safe, p.mapped.target);
        } finally { await journal.close(); }
      });
    },
    async read(value: GuidanceReference, signal: AbortSignal) {
      const r = snapshotRef(value, signal);
      return storeOperation(r.signal, timeout, async (abort, check) => {
        const safe = await readOriginal(r.bank, r.document_id, abort, check); if (!safe) mismatch(); const decoded = document(safe.document);
        const actual = receipt(safe, bank(r.bank).target);
        if (r.expected && (r.expected.content_digest !== actual.content_digest || r.expected.idempotency_key !== actual.idempotency_key)) mismatch();
        return frozen({ ...actual, document: decoded.document, guidance: decoded.guidance });
      });
    },
    async query(alias: string, query: RetrievalQuery, signal: AbortSignal) {
      const q = input(() => { const selected = label(alias); const mapped = bank(selected);
        return { alias: selected, mapped, query: snapshotQuery(query), signal: validSignal(signal) }; });
      return storeOperation(q.signal, timeout, async (abort, check) => {
        await requireBank(q.mapped, abort, check);
        const result = await request(q.mapped, "memories/recall", abort, check, { query: canonical(q.query), budget: "low", max_tokens: 4096, trace: false,
          include: { entities: null, chunks: null, source_facts: null }, tags: tags(q.mapped.target), tags_match: "all_strict" });
        const v = own(result, ["results", "trace", "entities", "chunks", "source_facts", "source_facts_truncated"], ["results"]); const ids = new Set<string>();
        for (const raw of list(v.results, 64)) {
          const entry = own(raw, RESULT_FIELDS, ["id", "text"]); if (typeof entry.id !== "string" || typeof entry.text !== "string") mismatch();
          if (entry.document_id === undefined || entry.document_id === null) continue;
          if (typeof entry.document_id !== "string") mismatch(); if (!entry.document_id.startsWith(prefix(q.mapped.target))) continue;
          ids.add(scopedId(entry.document_id, q.mapped.target));
        }
        return frozen([...ids].sort().slice(0, q.query.limit).map(id => reference(q.alias, id)));
      });
    },
    async reconcile(alias: string, value: GuidanceDocument, signal: AbortSignal) {
      const p = prepare(alias, value, signal); let matched = false;
      try {
        await storeOperation(p.signal, timeout, async (abort, check) => {
          const claim = envelope(p.safe, p.mapped.target); const journal = await attemptJournal(directory, p.safe.idempotency_key, claim, check);
          try { await journal.existing(); const safe = await readOriginal(p.safe.bank, documentId(p.safe, p.mapped.target), abort, check);
            if (!safe || envelope(safe, p.mapped.target) !== claim) mismatch(); await journal.complete(); check(); }
          finally { await journal.close(); }
        }); matched = true;
      } catch { /* Uncertainty is read-only observation, never replay/reset permission. */ }
      return frozen({ state: matched ? "matched" : "not-confirmed", current_verification: "not-checked", authorization: "none", executable: false });
    },
  });
}
