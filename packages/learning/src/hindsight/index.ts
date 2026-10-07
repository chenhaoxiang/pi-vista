import { types } from "node:util";
import path from "node:path";
import { DEFAULT_TIMEOUT_MS, MAX_TIMEOUT_MS, LearningError, type IngestRequest, type SinkReadback, type SinkReceipt } from "../contract.js";
import type { HindsightStore, HindsightStoreConfig } from "./contract.js";
import type { HistoricalQuery, HindsightDocumentRef } from "../portable-contract.js";
import { canonical, digest, frozen, integer, invalid, label, list, own } from "../data.js";
import { query as snapshotQuery } from "../input.js";
import { decodeDocument } from "../portable-data.js";
import { documentId, documentPrefix, originalRequest, receiptOf, scopedId, storageEnvelope, storageRequest, storeOperation, targetFingerprint, validSignal } from "./data.js";
import { attemptJournal } from "./journal.js";

export * from "./contract.js";

const DOCUMENT_FIELDS = ["id", "bank_id", "original_text", "content_hash", "created_at", "updated_at", "memory_unit_count", "nodes_by_fact_type", "tags", "document_metadata", "retain_params", "observation_scopes", "attachments"];
const RESULT_FIELDS = ["id", "text", "type", "entities", "context", "occurred_start", "occurred_end", "mentioned_at", "document_id", "metadata", "chunk_id", "tags", "source_fact_ids", "scores", "attachments"];
function input<T>(call: () => T): T { try { return call(); } catch { throw new LearningError("invalid-input"); } }
function mismatch(): never { throw new LearningError("sink-mismatch"); }

/** Explicit Hindsight 0.10.2 original-document transport; no effects until an API is called. */
export function createHindsightStore(config: HindsightStoreConfig): HindsightStore {
  let endpoint: string; let directory: string; let token: string | undefined; let timeout: number; let maxBytes: number;
  const banks = new Map<string, { id: string; target: string }>();
  try {
    const c = own(config, ["endpoint", "banks", "journal_directory", "bearer_token", "allow_loopback_http", "timeout_ms", "max_response_bytes"], ["endpoint", "banks", "journal_directory"]);
    if (process.platform === "win32" || typeof process.getuid !== "function" || typeof c.endpoint !== "string" || c.endpoint.length > 2048) invalid();
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
    timeout = integer(c.timeout_ms ?? DEFAULT_TIMEOUT_MS, MAX_TIMEOUT_MS, 1); maxBytes = integer(c.max_response_bytes ?? 262_144, 1_048_576, 1);
    if (types.isProxy(c.banks) || c.banks === null || typeof c.banks !== "object") invalid();
    const keys = Reflect.ownKeys(c.banks); if (!keys.length || keys.length > 64 || keys.some(key => typeof key !== "string")) invalid();
    const mappings = own(c.banks, keys as string[]); const ids = new Set<string>();
    for (const alias of keys as string[]) {
      label(alias); const id = label(mappings[alias]); if (ids.has(id)) invalid(); ids.add(id);
      banks.set(alias, { id, target: targetFingerprint(endpoint, alias, id) });
    }
  } catch { throw new LearningError("invalid-config"); }
  const http = globalThis.fetch;
  function bank(alias: string) { const mapped = banks.get(alias); if (!mapped) invalid(); return mapped; }
  const scopeTags = (target: string): string[] => ["pi-vista:original-v1", `pi-vista:target:${target}`];
  async function request(bankId: string, route: string, signal: AbortSignal, check: () => void, body?: unknown, absent = false): Promise<unknown | null> {
    check(); const headers: Record<string, string> = { Accept: "application/json", ...(token === undefined ? {} : { Authorization: `Bearer ${token}` }) };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    const options = {
      method: body === undefined ? "GET" : "POST", headers, ...(body === undefined ? {} : { body: canonical(body) }),
      signal, redirect: "error" as const, credentials: "omit" as const, cache: "no-store" as const, referrerPolicy: "no-referrer" as const,
    };
    const response = await http(`${endpoint}/v1/default/banks/${encodeURIComponent(bankId)}/${route}`, options);
    check();
    if (absent && response.status === 404) { await response.body?.cancel(); return null; }
    if (response.status !== 200 || !response.body) { await response.body?.cancel(); throw new LearningError("sink-failed"); }
    const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let bytes = 0;
    try {
      const declared = response.headers.get("content-length"); if (declared !== null && (!/^\d+$/u.test(declared) || Number(declared) > maxBytes)) mismatch();
      for (;;) {
        check(); const part = await reader.read(); check(); if (part.done) break;
        bytes += part.value.byteLength; if (bytes > maxBytes) mismatch(); chunks.push(part.value);
      }
      return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks, bytes))) as unknown;
    } finally { await reader.cancel().catch(() => undefined); reader.releaseLock(); }
  }
  async function original(alias: string, id: string, signal: AbortSignal, check: () => void): Promise<IngestRequest | null> {
    const mapped = bank(alias); scopedId(id, mapped.target);
    const response = await request(mapped.id, `documents/${encodeURIComponent(id)}`, signal, check, undefined, true);
    if (response === null) return null;
    try {
      const v = own(response, DOCUMENT_FIELDS, ["id", "bank_id", "original_text", "content_hash", "created_at", "updated_at", "memory_unit_count"]);
      if (v.id !== id || v.bank_id !== mapped.id || (v.content_hash !== null && typeof v.content_hash !== "string") ||
        typeof v.created_at !== "string" || typeof v.updated_at !== "string") invalid(); integer(v.memory_unit_count);
      const safe = originalRequest(v.original_text, mapped.target, id); if (safe.bank !== alias) invalid(); return safe;
    } catch { mismatch(); }
  }
  const prepared = (value: unknown, signal: unknown) => input(() => {
    const safe = storageRequest(value); const mapped = bank(safe.bank); return { safe, mapped, signal: validSignal(signal) };
  });
  const sink = frozen({
    async ingest(value: IngestRequest, signal: AbortSignal): Promise<SinkReceipt> {
      const p = prepared(value, signal); const envelope = storageEnvelope(p.safe, p.mapped.target); const id = documentId(p.safe, p.mapped.target);
      return storeOperation(p.signal, timeout, async (abort, check) => {
        const journal = await attemptJournal(directory, p.safe.idempotency_key, envelope, check);
        try {
          const first = await journal.claim(); const existing = await original(p.safe.bank, id, abort, check);
          if (existing !== null && storageEnvelope(existing, p.mapped.target) !== envelope) mismatch();
          if (existing === null) {
            if (!first) throw new LearningError("sink-failed");
            const ack = await request(p.mapped.id, "memories", abort, check, { async: false, items: [{ content: envelope, document_id: id,
              timestamp: "unset", update_mode: "replace", tags: [...p.safe.tags, ...scopeTags(p.mapped.target),
                ...(p.safe.idempotency_key.startsWith("archive-") ? ["pi-vista:archive-v1"] : [])] }] });
            const a = own(ack, ["success", "bank_id", "items_count", "async", "operation_id", "operation_ids", "usage"], ["success", "bank_id", "items_count", "async"]);
            if (a.success !== true || a.bank_id !== p.mapped.id || a.items_count !== 1 || a.async !== false) mismatch();
            const read = await original(p.safe.bank, id, abort, check); if (read === null || storageEnvelope(read, p.mapped.target) !== envelope) mismatch();
          }
          await journal.complete(); check(); return receiptOf(p.safe, p.mapped.target);
        } finally { await journal.close(); }
      });
    },
    async readback(value: SinkReceipt, signal: AbortSignal): Promise<SinkReadback> {
      const r = input(() => {
        const v = own(value, ["document_id", "bank", "content_digest", "idempotency_key"]); const alias = label(v.bank); const mapped = bank(alias);
        return { document_id: scopedId(v.document_id, mapped.target), bank: alias, content_digest: digest(v.content_digest), idempotency_key: label(v.idempotency_key), signal: validSignal(signal) };
      });
      return storeOperation(r.signal, timeout, async (abort, check) => {
        const safe = await original(r.bank, r.document_id, abort, check); if (!safe) mismatch(); const receipt = receiptOf(safe, bank(r.bank).target);
        if (receipt.document_id !== r.document_id || receipt.content_digest !== r.content_digest || receipt.idempotency_key !== r.idempotency_key) mismatch();
        return frozen({ ...receipt, title: safe.title, content: safe.content, tags: safe.tags });
      });
    },
  });
  const port = frozen({
    async query(value: HistoricalQuery, signal: AbortSignal) {
      const q = input(() => {
        const v = own(value, ["bank", "repo", "source_sha", "policy_version", "env_fingerprint", "task_type", "limit"], ["bank", "repo", "source_sha", "policy_version", "env_fingerprint", "task_type"]);
        const alias = label(v.bank); const mapped = bank(alias);
        const query = snapshotQuery({ repo: v.repo, source_sha: v.source_sha, policy_version: v.policy_version, env_fingerprint: v.env_fingerprint,
          task_type: v.task_type, ...(v.limit === undefined ? {} : { limit: v.limit }) } as HistoricalQuery);
        return { query, alias, mapped, signal: validSignal(signal) };
      });
      return storeOperation(q.signal, timeout, async (abort, check) => {
        const response = await request(q.mapped.id, "memories/recall", abort, check, { query: canonical(q.query), budget: "low", max_tokens: 4096, trace: false,
          include: { entities: null, chunks: null, source_facts: null }, tags: [...scopeTags(q.mapped.target), "pi-vista:archive-v1"], tags_match: "all_strict" });
        const v = own(response, ["results", "trace", "entities", "chunks", "source_facts", "source_facts_truncated"], ["results"]); const ids = new Set<string>();
        for (const entry of list(v.results, 64)) {
          const result = own(entry, RESULT_FIELDS, ["id", "text"]); if (typeof result.id !== "string" || typeof result.text !== "string") mismatch();
          if (result.document_id === undefined || result.document_id === null) continue;
          if (typeof result.document_id !== "string") mismatch();
          if (!result.document_id.startsWith(documentPrefix(q.mapped.target))) continue;
          ids.add(scopedId(result.document_id, q.mapped.target));
        }
        return frozen({ documents: frozen([...ids].sort().map(document_id => frozen({ document_id, bank: q.alias }))) });
      });
    },
    async read(value: HindsightDocumentRef, signal: AbortSignal) {
      const r = input(() => { const v = own(value, ["document_id", "bank"]); const alias = label(v.bank);
        return { document_id: scopedId(v.document_id, bank(alias).target), bank: alias, signal: validSignal(signal) }; });
      return storeOperation(r.signal, timeout, async (abort, check) => {
        const safe = await original(r.bank, r.document_id, abort, check); if (!safe || !safe.idempotency_key.startsWith("archive-")) mismatch();
        const document = frozen({ title: safe.title, content: safe.content, tags: safe.tags, content_digest: safe.content_digest });
        decodeDocument(document); return frozen({ document_id: r.document_id, bank: r.bank, document });
      });
    },
  });
  return frozen({ sink, port, async reconcile(value: IngestRequest, signal: AbortSignal) {
    const p = prepared(value, signal); let matched = false;
    try {
      await storeOperation(p.signal, timeout, async (abort, check) => {
        const envelope = storageEnvelope(p.safe, p.mapped.target); const journal = await attemptJournal(directory, p.safe.idempotency_key, envelope, check);
        try {
          await journal.existing(); const safe = await original(p.safe.bank, documentId(p.safe, p.mapped.target), abort, check);
          if (!safe || storageEnvelope(safe, p.mapped.target) !== envelope) mismatch(); await journal.complete(); check();
        } finally { await journal.close(); }
      }); matched = true;
    } catch { /* Uncertainty is a fixed observation, never retry permission. */ }
    return frozen({ state: matched ? "matched" : "not-confirmed", authorization: "none", executable: false });
  } });
}
