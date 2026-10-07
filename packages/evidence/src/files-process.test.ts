import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

test("receipt files: independent fresh public-addon producer/consumer, current proof and explicitly confirmed synthetic learning sink", async () => {
  const checkout = fileURLToPath(new URL("../../../", import.meta.url));
  await mkdir(path.join(checkout, "tmp"), { recursive: true });
  const directory = await mkdtemp(path.join(checkout, "tmp/receipt-process-"));
  const script = fileURLToPath(new URL("files-process.fixtures.js", import.meta.url));
  const run = (role: string) => {
    const result = spawnSync(process.execPath, [script, role, directory], { cwd: checkout, shell: false, env: {}, encoding: "utf8", timeout: 15_000, maxBuffer: 128 * 1024 });
    assert.ifError(result.error); assert.equal(result.status, 0, result.stderr); assert.equal(result.stderr, ""); return JSON.parse(result.stdout);
  };
  try {
    const producer = run("producer");
    assert.deepEqual((await readdir(directory)).sort(), ["config.json", "next-gate.json", "old-proof.json", "receipts"]);
    for (const file of ["config.json", "next-gate.json", "old-proof.json"]) assert.doesNotMatch(await readFile(path.join(directory, file), "utf8"), /BEGIN (?:PRIVATE|RSA PRIVATE|OPENSSH PRIVATE) KEY/u);
    const consumer = run("consumer");
    assert.notEqual(producer.pid, consumer.pid); assert.notEqual(producer.pid, process.pid); assert.notEqual(consumer.pid, process.pid);
    assert.equal(producer.node, process.version); assert.equal(consumer.node, process.version); assert.equal(producer.receipt_count, 3);
    assert.equal(consumer.copied_current_proof_refused, true); assert.equal(consumer.binding_checks, 5); assert.equal(consumer.predicate_only, "predicate-only");
    assert.equal(consumer.ingests, 1); assert.equal(consumer.readbacks, 1); assert.equal(consumer.confirmed_status, "trusted");
    assert.equal(consumer.changed_file_refused, true); assert.equal(consumer.fresh_publication_seen, true); assert.equal(consumer.expiry_preserved, true);
    assert.equal(consumer.authorization, "none"); assert.equal(consumer.executable, false);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
