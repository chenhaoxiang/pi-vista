import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createServer, type ServerResponse } from "node:http";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import type { ExperienceObservation } from "../contract.js";
import type { GuidanceReference, GuidanceReceipt } from "./contract.js";
import { prepareHistoricalGuidance } from "./index.js";
import { documentId, reference, writeRequest } from "./data.js";
import { targetFingerprint } from "../hindsight/data.js";

const exec = promisify(execFile);
const root = fileURLToPath(new URL("../../../../tmp/guidance-process/", import.meta.url));
const observation: ExperienceObservation = {
  experience_id: "fixture-process", run_id: "fixture-run", repo: "fixture-repo", source_sha: "a".repeat(40),
  policy_version: "fixture-v1", env_fingerprint: "fixture-env", task_type: "fixture-task", ts: 1000,
  script: { task_type: "fixture-task", description: "inspect fixture metadata", preconditions: [], steps: ["inspect-fixture"],
    postconditions: [], known_failures: [], applicable_to: [] },
  steps: [{ step_id: "fixture-step", tool: "fixture-reader", action_description: "inspect metadata", check_fn_ids: [],
    expected_result: "observed", on_failure: "stop", depends_on: [] }],
};
interface ClientResult {
  status: "passed" | "failed";
  pid: number;
  code?: string;
  receipt?: GuidanceReceipt;
  state?: string;
  content_match?: boolean;
  current_verification?: string;
  authorization?: string;
  executable?: boolean;
}

async function fixture(options: { lostAck?: boolean; contenders?: number } = {}) {
  await mkdir(root, { recursive: true });
  const owned = await mkdtemp(path.join(root, "case-"));
  const journal = path.join(owned, "journal");
  await mkdir(journal, { mode: 0o700 });
  const documents = new Map<string, string>();
  const waiting: ServerResponse[] = [];
  let retains = 0;
  let configReads = 0;
  const json = (res: ServerResponse, status: number, value: unknown) => {
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(JSON.stringify(value));
  };
  const server = createServer(async (req, res) => {
    const route = new URL(req.url!, "http://fixture").pathname;
    if (route.endsWith("/config")) {
      configReads++;
      // A native HTTP barrier, not a timing assumption about child startup.
      if (options.contenders && configReads <= options.contenders) {
        waiting.push(res);
        if (waiting.length < options.contenders) return;
        for (const pending of waiting.splice(0)) json(pending, 200, { bank_id: "fixture-bank", config: {}, overrides: {} });
      } else json(res, 200, { bank_id: "fixture-bank", config: {}, overrides: {} });
      return;
    }
    if (route.includes("/documents/") && req.method === "GET") {
      const id = route.split("/").pop()!;
      const text = documents.get(id);
      if (text === undefined) json(res, 404, {});
      else json(res, 200, { id, bank_id: "fixture-bank", original_text: text, content_hash: null,
        created_at: "fixture-time", updated_at: "fixture-time", memory_unit_count: 1 });
      return;
    }
    if (route.endsWith("/memories") && req.method === "POST") {
      let body = "";
      for await (const part of req) body += part.toString();
      const request = JSON.parse(body);
      retains++;
      documents.set(request.items[0].document_id, request.items[0].content);
      json(res, options.lostAck ? 503 : 200, { success: true, bank_id: "fixture-bank", items_count: 1, async: false });
      return;
    }
    json(res, 404, {});
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const endpoint = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const config = { mode: "local-guidance", endpoint, banks: { "fixture-alias": "fixture-bank" },
    journal_directory: journal, allow_loopback_http: true, timeout_ms: 5000 };
  const native = async (phase: "write" | "read", ref?: GuidanceReference): Promise<ClientResult> => {
    const code = `
      import { createHindsightGuidanceStore, prepareHistoricalGuidance } from ${JSON.stringify(new URL("./index.js", import.meta.url).href)};
      import { LearningError } from ${JSON.stringify(new URL("../contract.js", import.meta.url).href)};
      const store = createHindsightGuidanceStore(${JSON.stringify(config)});
      const document = prepareHistoricalGuidance(${JSON.stringify(observation)});
      const signal = new AbortController().signal;
      let result;
      try {
        if (${JSON.stringify(phase)} === "write") {
          result = { status: "passed", pid: process.pid, receipt: await store.retain("fixture-alias", document, signal) };
        } else {
          const read = await store.read(${JSON.stringify(ref ?? null)}, signal);
          const reconciliation = await store.reconcile("fixture-alias", document, signal);
          result = { status: "passed", pid: process.pid, state: reconciliation.state,
            content_match: read.document.content === document.content, current_verification: read.guidance.current_verification,
            authorization: read.guidance.authorization, executable: read.guidance.executable };
        }
      } catch (error) {
        result = { status: "failed", pid: process.pid, code: error instanceof LearningError ? error.code : "fixture-failed" };
      }
      console.log(JSON.stringify(result));
    `;
    const result = await exec(process.execPath, ["--input-type=module", "-e", code], {
      cwd: owned, env: { PATH: path.dirname(process.execPath), HOME: owned, TMPDIR: owned },
      timeout: 10_000, maxBuffer: 32_768, shell: false,
    });
    assert.equal(result.stderr, "");
    return JSON.parse(result.stdout) as ClientResult;
  };
  const expectedReference = () => {
    const request = writeRequest("fixture-alias", prepareHistoricalGuidance(observation));
    const target = targetFingerprint(endpoint, "fixture-alias", "fixture-bank");
    return reference("fixture-alias", documentId(request, target));
  };
  const close = async () => {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
    await rm(owned, { recursive: true, force: true });
  };
  return { native, expectedReference, retains: () => retains, close };
}

test("guidance independent restarted native client reads exact history without another retain", { timeout: 20_000 }, async () => {
  const f = await fixture();
  try {
    const written = await f.native("write");
    assert.equal(written.status, "passed");
    const restarted = await f.native("read", written.receipt!);
    assert.notEqual(written.pid, restarted.pid);
    assert.equal(restarted.status, "passed");
    assert.equal(restarted.content_match, true);
    assert.equal(restarted.state, "matched");
    assert.equal(restarted.current_verification, "not-checked");
    assert.equal(restarted.authorization, "none");
    assert.equal(restarted.executable, false);
    assert.equal(f.retains(), 1);
  } finally { await f.close(); }
});

test("guidance lost acknowledgement survives process exit and readonly native reconciliation", { timeout: 20_000 }, async () => {
  const f = await fixture({ lostAck: true });
  try {
    const uncertain = await f.native("write");
    assert.equal(uncertain.status, "failed");
    assert.equal(uncertain.code, "sink-failed");
    const restarted = await f.native("read", f.expectedReference());
    assert.notEqual(uncertain.pid, restarted.pid);
    assert.equal(restarted.status, "passed");
    assert.equal(restarted.content_match, true);
    assert.equal(restarted.state, "matched");
    assert.equal(restarted.current_verification, "not-checked");
    assert.equal(f.retains(), 1);
  } finally { await f.close(); }
});

test("guidance independent competing native clients share one durable retain attempt", { timeout: 20_000 }, async () => {
  const f = await fixture({ contenders: 2 });
  try {
    const results = await Promise.all([f.native("write"), f.native("write")]);
    assert.notEqual(results[0]!.pid, results[1]!.pid);
    assert.ok(results.some(result => result.status === "passed"));
    assert.equal(f.retains(), 1);
    const restarted = await f.native("read", f.expectedReference());
    assert.equal(restarted.status, "passed");
    assert.equal(restarted.state, "matched");
    assert.equal(f.retains(), 1);
  } finally { await f.close(); }
});
