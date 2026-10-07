import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { chmod, link, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createLearningLibrary, LearningError, type IngestRequest } from "@pi-vista/learning";
import { createHindsightStore } from "@pi-vista/learning/hindsight";
import { ownerFixture, verifiedExperience } from "./learning.fixtures.js";
import { BANK } from "./portable.fixtures.js";
import { deadlineEvent, fixtureEnvelope, httpFixture, journalName, json, repoRoot, requestOf, signal } from "./hindsight-http.fixtures.js";

const script = fileURLToPath(new URL("hindsight-process.fixtures.js", import.meta.url));
function launch(role: string, configPath: string, requestPath: string) {
  const child = spawn(process.execPath, [script, role, configPath, requestPath], { cwd: repoRoot, shell: false, stdio: ["ignore", "pipe", "pipe", "ipc"],
    env: { PATH: path.dirname(process.execPath), LANG: "C", LC_ALL: "C", NODE_PATH: "" } }); let stdout = ""; let stderr = "";
  child.stdout!.on("data", data => { stdout += data; }); child.stderr!.on("data", data => { stderr += data; });
  const ready = new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(Error("synthetic child readiness deadline")), 5000);
    child.on("message", (message: any) => { if (message.stage === "ready") { clearTimeout(timer); resolve(); } }); child.once("error", error => { clearTimeout(timer); reject(error); });
    child.once("close", () => { clearTimeout(timer); reject(Error("synthetic child exited before readiness")); });
  });
  const done = new Promise<{ code: number | null; killed: NodeJS.Signals | null; result?: any }>((resolve, reject) => {
    const timer = setTimeout(() => { child.kill("SIGKILL"); reject(Error("synthetic child exit deadline")); }, 15_000);
    child.once("close", (code, killed) => { clearTimeout(timer); try { if (code === 0) { assert.equal(stderr, ""); resolve({ code, killed, result: JSON.parse(stdout) }); } else resolve({ code, killed }); } catch (error) { reject(error); } });
  });
  return { child, ready, done, async run() { await ready; child.send("go"); const out = await done; assert.equal(out.code, 0); return out.result; } };
}
async function stop(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(Error("synthetic child stop deadline")), 5000);
    child.once("close", () => { clearTimeout(timer); resolve(); }); child.kill("SIGKILL");
  });
}
async function setup(f: Awaited<ReturnType<typeof httpFixture>>, request?: IngestRequest) {
  const configPath = path.join(f.root, "config.json"); const requestPath = path.join(f.root, "request.json");
  await writeFile(configPath, JSON.stringify(f.config), { mode: 0o600 }); if (request) await writeFile(requestPath, JSON.stringify(request), { mode: 0o600 });
  return { configPath, requestPath };
}
const requestFixture = async (): Promise<IngestRequest> => { const owner = ownerFixture(); const library = createLearningLibrary({ verifier: owner.verifier });
  return requestOf(library.preparePromotion(await verifiedExperience(library, owner), BANK)); };

test("hindsight concurrent fresh processes share one exclusive intent; duplicate and restart never retain twice", async () => {
  const f = await httpFixture(); const request = await requestFixture(); const files = await setup(f, request); const children: ChildProcess[] = [];
  let release!: () => void; const barrier = new Promise<void>(resolve => { release = resolve; });
  try {
    f.hooks.get = async (_req, response) => { if (f.calls.get !== 1) return false; await barrier; json(response, { detail: "absent" }, 404); return true; };
    const first = launch("writer", files.configPath, files.requestPath); children.push(first.child); await first.ready;
    const claimed = deadlineEvent(f.events, "get"); first.child.send("go"); await claimed; assert.equal((await readdir(f.directory)).length, 1);
    const second = launch("writer", files.configPath, files.requestPath); children.push(second.child); assert.equal((await second.run()).state, "refused"); assert.equal(f.calls.retain, 0);
    release(); const firstResult = await first.done; assert.equal(firstResult.code, 0); assert.equal(firstResult.result.state, "matched");
    const restarted = launch("writer", files.configPath, files.requestPath); children.push(restarted.child); assert.equal((await restarted.run()).state, "matched"); assert.equal(f.calls.retain, 1);
    assert.notEqual(first.child.pid, second.child.pid); assert.notEqual(restarted.child.pid, first.child.pid);
  } finally { release(); for (const child of children) await stop(child); await f.close(); }
});
for (const stage of ["claimed-unsent", "remote-committed", "ack-lost"] as const) test(`hindsight fresh restart after ${stage} is read-only and preserves uncertain intent`, async () => {
  const f = await httpFixture(); const request = await requestFixture(); const files = await setup(f, request); const children: ChildProcess[] = [];
  let release!: () => void; const barrier = new Promise<void>(resolve => { release = resolve; });
  try {
    if (stage === "claimed-unsent") f.hooks.get = async (_req, response) => { await barrier; json(response, { detail: "absent" }, 404); return true; };
    else f.hooks.afterRetain = async (_req, response) => { if (stage === "ack-lost") response.destroy(); else { await barrier; response.destroy(); } return true; };
    const child = launch("writer", files.configPath, files.requestPath); children.push(child.child); await child.ready;
    const reached = deadlineEvent(f.events, stage === "claimed-unsent" ? "get" : "retain"); child.child.send("go"); await reached;
    if (stage === "ack-lost") { const out = await child.done; assert.equal(out.code, 0); assert.equal(out.result.state, "refused"); }
    else { await stop(child.child); assert.equal((await child.done).killed, "SIGKILL"); }
    assert.equal((await readdir(f.directory)).length, 1); assert.equal(await readFile(path.join(f.directory, `${journalName(request)}.intent`), "utf8"), fixtureEnvelope(request, f.config));
    delete f.hooks.get; delete f.hooks.afterRetain; release();
    const restarted = launch("writer", files.configPath, files.requestPath); children.push(restarted.child);
    assert.equal((await restarted.run()).state, stage === "claimed-unsent" ? "refused" : "matched");
    assert.equal((await f.store.reconcile(request, signal())).state, stage === "claimed-unsent" ? "not-confirmed" : "matched");
    assert.equal(f.calls.retain, stage === "claimed-unsent" ? 0 : 1);
  } finally { release(); for (const child of children) await stop(child); await f.close(); }
});
for (const partial of ["empty intent", "corrupt intent", "BOM-prefixed intent", "empty completion", "corrupt completion", "completion creation blocked"] as const) test(`hindsight ${partial} remains fail-closed across fresh processes with zero second retain`, async () => {
  const f = await httpFixture(); const request = await requestFixture(); const files = await setup(f, request); const children: ChildProcess[] = [];
  try {
    const name = journalName(request); const envelope = fixtureEnvelope(request, f.config);
    if (partial.includes("intent")) await writeFile(path.join(f.directory, `${name}.intent`), partial === "empty intent" ? "" : partial === "BOM-prefixed intent" ? `\uFEFF${envelope}` : "{", { mode: 0o600 });
    else {
      f.hooks.afterRetain = async (_req, response) => {
        await writeFile(path.join(f.directory, `${name}.complete`), partial === "empty completion" ? "" : "{", { mode: 0o600 });
        if (partial === "completion creation blocked") await chmod(f.directory, 0o500);
        json(response, { success: true, bank_id: "synthetic-bank", items_count: 1, async: false }); return true;
      };
      await assert.rejects(f.store.sink.ingest(request, signal()), (error: unknown) => error instanceof LearningError); assert.equal(f.calls.retain, 1);
      assert.equal(await readFile(path.join(f.directory, `${name}.intent`), "utf8"), envelope);
    }
    for (let attempt = 0; attempt < 2; attempt++) { const child = launch("writer", files.configPath, files.requestPath); children.push(child.child); assert.equal((await child.run()).state, "refused"); }
    assert.equal((await f.store.reconcile(request, signal())).state, "not-confirmed"); assert.equal(f.calls.retain, partial.includes("intent") ? 0 : 1);
  } finally { await chmod(f.directory, 0o700); for (const child of children) await stop(child); await f.close(); }
});

test("hindsight exact preexisting original avoids retain; missing or replaced remote content never resets a completed intent", async () => {
  const f = await httpFixture(); const request = await requestFixture();
  try {
    const envelope = fixtureEnvelope(request, f.config); const id = JSON.parse(envelope).document_id; f.documents.set(id, envelope);
    await f.store.sink.ingest(request, signal()); assert.equal(f.calls.retain, 0); assert.equal((await readdir(f.directory)).length, 2);
    f.documents.delete(id); await assert.rejects(f.store.sink.ingest(request, signal())); assert.equal((await f.store.reconcile(request, signal())).state, "not-confirmed");
    f.documents.set(id, "replaced unapproved original"); await assert.rejects(f.store.sink.ingest(request, signal())); assert.equal((await f.store.reconcile(request, signal())).state, "not-confirmed"); assert.equal(f.calls.retain, 0);
  } finally { await f.close(); }
});
test("hindsight journal target fingerprint refuses endpoint/bank remapping and hardlinked claims", async () => {
  const f = await httpFixture(); const request = await requestFixture();
  try {
    await writeFile(path.join(f.directory, `${journalName(request)}.intent`), fixtureEnvelope(request, f.config), { mode: 0o600 });
    for (const patch of [{ endpoint: "https://different.invalid" }, { banks: { [BANK]: "different-bank" } }]) {
      const store = createHindsightStore({ ...f.config, ...patch }); await assert.rejects(store.sink.ingest(request, signal())); assert.equal((await store.reconcile(request, signal())).state, "not-confirmed");
    }
    await link(path.join(f.directory, `${journalName(request)}.intent`), path.join(f.root, "linked-claim")); await assert.rejects(f.store.sink.ingest(request, signal()));
    assert.equal(f.calls.retain + f.calls.get, 0);
  } finally { await f.close(); }
});
test("hindsight actual HTTP producer and restarted consumer independently authenticate history without live authority", async () => {
  const f = await httpFixture(); const files = await setup(f); const children: ChildProcess[] = [];
  try {
    const producer = launch("producer", files.configPath, files.requestPath); children.push(producer.child); const before = await producer.run(); assert.equal(before.state, "host-readback-matched"); assert.equal(f.calls.retain, 1);
    const consumer = launch("consumer", files.configPath, files.requestPath); children.push(consumer.child); const after = await consumer.run();
    assert.notEqual(before.pid, after.pid); assert.equal(before.node, process.version); assert.equal(after.node, process.version);
    assert.equal(after.reconciliation, "matched"); assert.equal(after.history, "historical-authenticated"); assert.equal(after.current_verification, "not-checked"); assert.equal(after.imported, "observed");
    assert.equal(after.copied_proof_refused, true); assert.equal(after.executable, false); assert.equal(after.authorization, "none"); assert.equal(f.calls.retain, 1); assert.equal(f.calls.recall, 1);
  } finally { for (const child of children) await stop(child); await f.close(); }
});
