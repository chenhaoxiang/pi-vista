import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

test("portable public-import restart proof: separate fresh producer/consumer processes use only persisted safe file-backed Hindsight docs and PUBLIC pins", async () => {
  const root = fileURLToPath(new URL("../../../", import.meta.url)); const tmp = path.join(root, "tmp"); await mkdir(tmp, { recursive: true });
  const directory = await mkdtemp(path.join(tmp, "portable-restart-"));
  const script = fileURLToPath(new URL("portable-process.fixtures.js", import.meta.url));
  const run = (role: string) => {
    const result = spawnSync(process.execPath, [script, role, directory], { cwd: root, shell: false, timeout: 30_000,
      encoding: "utf8", env: { PATH: path.dirname(process.execPath), LANG: "C", LC_ALL: "C", NODE_PATH: "" } });
    assert.ifError(result.error); assert.equal(result.status, 0, result.stderr); assert.equal(result.stderr, ""); return JSON.parse(result.stdout);
  };
  try {
    const producer = run("producer");
    const entries = await readdir(directory); assert.deepEqual(entries.sort(), ["document.json", "pin.json"]);
    for (const entry of entries) assert.doesNotMatch(await readFile(path.join(directory, entry), "utf8"), /BEGIN (?:PRIVATE|RSA PRIVATE|OPENSSH PRIVATE) KEY|raw-session-body/u);
    const consumer = run("consumer");
    assert.notEqual(producer.pid, consumer.pid); assert.notEqual(producer.pid, process.pid); assert.notEqual(consumer.pid, process.pid);
    assert.equal(producer.node, process.version); assert.equal(consumer.node, process.version);
    assert.equal(producer.archive_digest, consumer.archive_digest); assert.equal(producer.ingests, 1); assert.equal(producer.readbacks, 1);
    assert.equal(consumer.historical_authentication, "historical-authenticated"); assert.equal(consumer.current_verification, "not-checked");
    assert.equal(consumer.imported_state, "observed"); assert.equal(consumer.copied_current_proof_refused, true);
    assert.equal(consumer.fresh_current_owner_reads, 3); assert.equal(consumer.fresh_current_verification, "verified"); assert.equal(consumer.current_expiry_preserved, true);
    assert.equal(consumer.executable, false); assert.equal(consumer.authorization, "none");
    assert.equal(consumer.queries, 1); assert.equal(consumer.reads, 1);
  } finally {
    // Exact mkdtemp fixture only, never checkout-wide tmp or any supplied directory.
    await rm(directory, { recursive: true, force: true });
  }
});
