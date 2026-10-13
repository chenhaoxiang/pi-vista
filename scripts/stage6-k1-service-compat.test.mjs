import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { ROOT } from "./release-utils.mjs";
import { checkK1ReadServiceFingerprint, readK1ReadServiceMetadata, K1_READ_SERVICE_CONTRACT } from "./stage6-k1-service-compat.mjs";
import { readGuidanceMetadata } from "./guidance-acceptance-io.mjs";
const sha = b => createHash("sha256").update(b).digest("hex");
async function fixture() {
  await mkdir(join(ROOT, "tmp"), { recursive: true }); const dir = await mkdtemp(join(ROOT, "tmp", "k1-service-"));
  const root = join(dir, "site-packages"); await mkdir(join(root, "hindsight_api", "api"), { recursive: true }); await mkdir(join(root, "hindsight_api", "engine"));
  const meta = join(root, "hindsight_api-1.0.0.dist-info", "METADATA"); await mkdir(join(root, "hindsight_api-1.0.0.dist-info"));
  const text = "Metadata-Version: 2.1\nName: hindsight-api\nVersion: 1.0.0\n\n"; await writeFile(meta, text);
  const files = [];
  for (const relative of ["api/http.py", "engine/memory_engine.py", "config.py", "main.py", "server.py"]) {
    const path = join(root, "hindsight_api", relative), bytes = Buffer.from(`# public fixture ${relative}\n`); await writeFile(path, bytes);
    files.push({ relative, path, git_blob: createHash("sha1").update(Buffer.from(`blob ${bytes.length}\0`)).update(bytes).digest("hex") });
  }
  const value = { schema: "hindsight-read-service-fingerprint/1", endpoint: "http://127.0.0.1:8888", bank: "pi-vista-local-test-01a114ab", api_metadata_version: "1.0.0", distribution: { name: "hindsight-api", version: "1.0.0", metadata_path: meta, sha256: sha(text) }, files };
  const path = join(dir, "fingerprint.json"); await writeFile(path, JSON.stringify(value), { mode: 0o600 });
  return { dir, path, value, close: () => rm(dir, { recursive: true, force: true }) };
}
test("explicit API1.0.0/dist1.0.0 fingerprint rehashes fixed public files", async () => {
  const f = await fixture(); try { const v = await checkK1ReadServiceFingerprint(f.path); assert.equal(v.contract, K1_READ_SERVICE_CONTRACT); assert.equal(v.api_metadata_version, "1.0.0"); assert.equal(v.distribution_version, "1.0.0"); assert.equal(v.installed_files.length, 5); assert.equal(v.in_memory_byte_attestation, false); assert.equal(v.vendor_authentication, false); assert.equal(JSON.stringify(v).includes(f.dir), false); } finally { await f.close(); }
});
test("fingerprint drift, wrong pins, duplicate paths or authority fields refuse", async () => {
  for (const change of [v => { v.api_metadata_version = "0.10.2"; }, v => { v.distribution.version = "0.10.3"; }, v => { v.bank = "other"; }, v => { v.files[0].git_blob = "f".repeat(40); }, v => { v.files[1] = v.files[0]; }, v => { v.approved = true; }]) {
    const f = await fixture(); try { change(f.value); await writeFile(f.path, JSON.stringify(f.value)); await assert.rejects(checkK1ReadServiceFingerprint(f.path), /stage6-k1-service-compat-refused/); } finally { await f.close(); }
  }
});
test("bad input refuses without proxy/coercion hooks", async () => {
  let calls = 0; for (const value of [null, "relative", new Proxy({}, { get() { calls++; throw Error(); } }), { toString() { calls++; throw Error(); } }]) await assert.rejects(checkK1ReadServiceFingerprint(value)); assert.equal(calls, 0);
});
test("metadata version is independent of distribution and old default remainsstrict", async () => {
  const body = version => new Response(JSON.stringify({ info: { title: "Hindsight", version } }), { status: 200 });
  assert.equal((await readK1ReadServiceMetadata(body("1.0.0"))).api_metadata_version, "1.0.0");
  await assert.rejects(readK1ReadServiceMetadata(body("0.10.3")), /stage6-k1-service-compat-refused/);
  await assert.rejects(readGuidanceMetadata(body("0.10.3")), /guidance-service-version-refused/);
  await assert.rejects(readK1ReadServiceMetadata(new Response("{}", { status: 503 })), /stage6-k1-service-compat-refused/);
});
