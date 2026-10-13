import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open } from "node:fs/promises";
import { dirname, isAbsolute, normalize } from "node:path";
import { types } from "node:util";

// Explicit Owner-selected current READ scope; old0.10.2 default is unchanged.
export const K1_READ_SERVICE_CONTRACT = "api-1.0.0-dist-1.0.0";
const ENDPOINT = "http://127.0.0.1:8888", BANK = "pi-vista-local-test-01a114ab";
const FILES = ["api/http.py", "engine/memory_engine.py", "config.py", "main.py", "server.py"];
const HEX = /^[a-f0-9]{64}$/u, BLOB = /^[a-f0-9]{40}$/u;
const reject = () => { throw Error("stage6-k1-service-compat-refused"); };
function own(value, keys) {
  if (types.isProxy(value) || !value || typeof value !== "object" || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value)) || Reflect.ownKeys(value).length !== keys.length) reject();
  const out = Object.create(null);
  for (const key of keys) { const p = Object.getOwnPropertyDescriptor(value, key); if (!p || !Object.hasOwn(p, "value") || p.value === undefined) reject(); out[key] = p.value; }
  return out;
}
const absolute = value => typeof value === "string" && isAbsolute(value) && normalize(value) === value && !/[\x00-\x1f\x7f]/u.test(value);
const statKeys = ["dev", "ino", "size", "mode", "uid", "nlink", "mtimeMs", "ctimeMs"];
async function bytes(path, max, privateOnly = false) {
  if (!absolute(path)) reject();
  const before = await lstat(path);
  if (!before.isFile() || before.isSymbolicLink() || before.size < 1 || before.size > max ||
      privateOnly && (before.uid !== process.getuid() || (before.mode & 0o7777) !== 0o600 || before.nlink !== 1)) reject();
  const fd = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const first = await fd.stat(), buffer = Buffer.alloc(max + 1); let length = 0;
    if (statKeys.some(k => before[k] !== first[k])) reject();
    while (length < buffer.length) { const part = await fd.read(buffer, length, buffer.length - length, length); if (!part.bytesRead) break; length += part.bytesRead; }
    const after = await fd.stat(), named = await lstat(path);
    if (length !== first.size || length > max || statKeys.some(k => first[k] !== after[k] || first[k] !== named[k])) reject();
    return buffer.subarray(0, length);
  } finally { await fd.close(); }
}
export async function checkK1ReadServiceFingerprint(path) {
  try {
    const raw = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(await bytes(path, 65_536, true)));
    const v = own(raw, ["schema", "endpoint", "bank", "api_metadata_version", "distribution", "files"]);
    const d = own(v.distribution, ["name", "version", "metadata_path", "sha256"]);
    if (v.schema !== "hindsight-read-service-fingerprint/1" || v.endpoint !== ENDPOINT || v.bank !== BANK || v.api_metadata_version !== "1.0.0" ||
        d.name !== "hindsight-api" || d.version !== "1.0.0" || typeof d.sha256 !== "string" || !HEX.test(d.sha256) ||
        !absolute(d.metadata_path) || !d.metadata_path.endsWith("/hindsight_api-1.0.0.dist-info/METADATA")) reject();
    const metadata = await bytes(d.metadata_path, 1_048_576);
    if (createHash("sha256").update(metadata).digest("hex") !== d.sha256) reject();
    const text = new TextDecoder("utf-8", { fatal: true }).decode(metadata);
    if (!/^Name: hindsight-api\r?$/mu.test(text) || !/^Version: 1\.0\.0\r?$/mu.test(text)) reject();
    if (types.isProxy(v.files) || !Array.isArray(v.files) || Object.getPrototypeOf(v.files) !== Array.prototype || v.files.length !== 5 || Reflect.ownKeys(v.files).length !== 6) reject();
    const rows = []; let root;
    for (let index = 0; index < 5; index++) {
      const property = Object.getOwnPropertyDescriptor(v.files, String(index)); if (!property || !Object.hasOwn(property, "value")) reject();
      const f = own(property.value, ["relative", "path", "git_blob"]);
      if (f.relative !== FILES[index] || !absolute(f.path) || !f.path.endsWith(`/hindsight_api/${f.relative}`) || typeof f.git_blob !== "string" || !BLOB.test(f.git_blob)) reject();
      const candidateRoot = f.path.slice(0, -f.relative.length); root ??= candidateRoot;
      if (candidateRoot !== root || !d.metadata_path.startsWith(dirname(root.slice(0, -1)) + "/")) reject();
      const body = await bytes(f.path, 4 * 1024 * 1024);
      const blob = createHash("sha1").update(Buffer.from(`blob ${body.length}\0`)).update(body).digest("hex");
      if (blob !== f.git_blob) reject(); rows.push(Object.freeze({ relative: f.relative, git_blob: blob }));
    }
    return Object.freeze({ contract: K1_READ_SERVICE_CONTRACT, api_metadata_version: "1.0.0", distribution_name: "hindsight-api", distribution_version: "1.0.0",
      distribution_metadata_sha256: d.sha256, installed_files: Object.freeze(rows), in_memory_byte_attestation: false, vendor_authentication: false });
  } catch { throw Error("stage6-k1-service-compat-refused"); }
}
export async function readK1ReadServiceMetadata(response) {
  try {
    if (!response || response.status !== 200 || !response.body) { await response?.body?.cancel(); reject(); }
    const reader = response.body.getReader(), chunks = []; let length = 0;
    try {
      for (;;) { const p = await reader.read(); if (p.done) break; length += p.value.byteLength; if (length > 1_048_576) reject(); chunks.push(p.value); }
      const v = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks, length)));
      if (!v.info || v.info.version !== "1.0.0") reject();
      return Object.freeze({ contract: K1_READ_SERVICE_CONTRACT, api_metadata_version: "1.0.0" });
    } finally { await reader.cancel().catch(() => undefined); reader.releaseLock(); }
  } catch { throw Error("stage6-k1-service-compat-refused"); }
}
