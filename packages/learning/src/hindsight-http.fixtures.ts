import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { IngestRequest, PromotionPlan, ArchivePlan } from "@pi-vista/learning";
import { createHindsightStore, type HindsightStoreConfig } from "@pi-vista/learning/hindsight";
import { canonical, sha256 } from "./portable.fixtures.js";

export const signal = (): AbortSignal => new AbortController().signal;
export const requestOf = (plan: PromotionPlan | ArchivePlan): IngestRequest => ({ bank: plan.bank, ...plan.document, idempotency_key: plan.idempotency_key });
export const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));
export const json = (response: ServerResponse, data: unknown, status = 200): void => {
  response.writeHead(status, { "Content-Type": "application/json" }); response.end(JSON.stringify(data));
};
type Hook = (request: IncomingMessage, response: ServerResponse, body: any, route: string) => boolean | Promise<boolean>;
/** Real loopback HTTP fixture with the exact pinned 0.10.2 routes and original-document fields. */
export async function httpFixture(overrides: Partial<HindsightStoreConfig> = {}) {
  await mkdir(path.join(repoRoot, "tmp"), { recursive: true });
  const root = await mkdtemp(path.join(repoRoot, "tmp/hindsight-http-")); const directory = path.join(root, "journal"); await mkdir(directory, { mode: 0o700 });
  const documents = new Map<string, string>(); const retained: any[] = []; const calls = { retain: 0, get: 0, recall: 0, other: 0 };
  const events = new EventEmitter(); const hooks: { before?: Hook; afterRetain?: Hook; get?: Hook; recall?: Hook } = {};
  const observed: { authorization?: string; cookie?: string; query?: any } = {};
  const server = createServer(async (request, response) => {
    try {
      const route = request.url!; const chunks: Buffer[] = []; for await (const chunk of request) chunks.push(Buffer.from(chunk));
      const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : undefined;
      if (request.headers.authorization !== undefined) observed.authorization = request.headers.authorization;
      if (request.headers.cookie !== undefined) observed.cookie = request.headers.cookie;
      if (hooks.before && await hooks.before(request, response, body, route)) return;
      const prefix = "/v1/default/banks/synthetic-bank/";
      if (request.method === "POST" && route === `${prefix}memories`) {
        calls.retain++; assert.equal(body.async, false); assert.deepEqual(Object.keys(body).sort(), ["async", "items"]); assert.equal(body.items.length, 1);
        const item = body.items[0]; assert.equal(item.timestamp, "unset"); assert.equal(item.update_mode, "replace");
        assert.deepEqual(Object.keys(item).sort(), ["content", "document_id", "tags", "timestamp", "update_mode"]);
        assert.match(item.document_id, /^vista-v1-[a-f0-9]{16}-[a-f0-9]{64}$/u); assert.ok(item.tags.includes("pi-vista:original-v1"));
        retained.push(body); documents.set(item.document_id, item.content); events.emit("retain");
        if (hooks.afterRetain && await hooks.afterRetain(request, response, body, route)) return;
        json(response, { success: true, bank_id: "synthetic-bank", items_count: 1, async: false, usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0 } });
      } else if (request.method === "GET" && route.startsWith(`${prefix}documents/`)) {
        calls.get++; events.emit("get");
        if (hooks.get && await hooks.get(request, response, body, route)) return;
        const id = decodeURIComponent(route.slice(`${prefix}documents/`.length)); const text = documents.get(id);
        if (text === undefined) { json(response, { detail: "document-not-found" }, 404); return; }
        json(response, documentResponse(id, text));
      } else if (request.method === "POST" && route === `${prefix}memories/recall`) {
        calls.recall++; observed.query = body; events.emit("recall");
        assert.equal(body.budget, "low"); assert.equal(body.trace, false); assert.equal(body.max_tokens, 4096); assert.equal(body.tags_match, "all_strict");
        assert.ok(body.tags.includes("pi-vista:archive-v1")); assert.deepEqual(body.include, { entities: null, chunks: null, source_facts: null });
        if (hooks.recall && await hooks.recall(request, response, body, route)) return;
        json(response, { results: [...documents].filter(([, text]) => JSON.parse(text).request.idempotency_key.startsWith("archive-")).map(([id]) =>
          ({ id: "generated-fact", text: "GENERATED FACT IS NOT ORIGINAL OR CURRENT PROOF", document_id: id, type: "world", metadata: { status: "trusted" } })), trace: null });
      } else { calls.other++; json(response, { detail: "unexpected-route" }, 404); }
    } catch { if (!response.headersSent) json(response, { detail: "fixture-contract-failed" }, 500); else response.destroy(); }
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve)); const address = server.address(); assert.ok(address && typeof address === "object");
  const config: HindsightStoreConfig = { endpoint: `http://127.0.0.1:${address.port}`, banks: { "fixture-bank": "synthetic-bank" }, journal_directory: directory,
    allow_loopback_http: true, timeout_ms: 2000, ...overrides };
  const store = createHindsightStore(config);
  return { root, directory, config, store, documents, retained, calls, hooks, observed, events,
    async close() { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); await rm(root, { recursive: true, force: true }); } };
}
export function documentResponse(id: string, text: string): object {
  return { id, bank_id: "synthetic-bank", original_text: text, content_hash: sha256(text), created_at: "2026-10-07T00:00:00Z", updated_at: "2026-10-07T00:00:00Z", memory_unit_count: 1 };
}
export function deadlineEvent(events: EventEmitter, event: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const done = (): void => { clearTimeout(timer); resolve(); };
    const timer = setTimeout(() => { events.removeListener(event, done); reject(Error("synthetic readiness deadline")); }, 5000); events.once(event, done);
  });
}
export const journalName = (request: IngestRequest): string => sha256(request.idempotency_key);
export const fixtureEnvelope = (request: IngestRequest, config: HindsightStoreConfig): string => {
  const target = sha256(canonical({ endpoint: new URL(config.endpoint).origin, bank: request.bank, bank_id: config.banks[request.bank] }));
  const id = `vista-v1-${target.slice(0, 16)}-${sha256(request.idempotency_key)}`;
  return canonical({ schema: 1, purpose: "pi-vista-hindsight-original", target_fingerprint: target, document_id: id, request });
};
