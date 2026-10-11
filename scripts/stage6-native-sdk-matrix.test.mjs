import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { parseStage6NativeAcceptanceOptions } from "./stage6-native-sdk-acceptance.mjs";
import { parseStage6NativeMatrixOptions } from "./stage6-native-sdk-matrix.mjs";
import { snapshotSyntheticHostOptions, SYNTHETIC_FAULTS } from "./stage6-synthetic-sdk-host.mjs";

const source = "a".repeat(40), sdk = "/synthetic/installed-sdk";
const supported = () => { const [major, minor] = process.versions.node.split(".").map(Number); return major > 22 || major === 22 && minor >= 19; };

test("matrix/host options are explicit closed DTOs with no coercion", () => {
  if (supported()) assert.deepEqual(parseStage6NativeMatrixOptions([`--sdk=${sdk}`, `--source-sha=${source}`]), { sdk, source_sha: source });
  else assert.throws(() => parseStage6NativeMatrixOptions([`--sdk=${sdk}`, `--source-sha=${source}`]), /stage6-native-acceptance-refused/);
  if (supported()) assert.deepEqual(snapshotSyntheticHostOptions({ sdk, source_sha: source, max_requests: 16 }), { sdk, source_sha: source, max_requests: 16 });
  else assert.throws(() => snapshotSyntheticHostOptions({ sdk, source_sha: source, max_requests: 16 }), /stage6-synthetic-host-refused/);
  let traps = 0;
  for (const bad of [new Proxy([`--sdk=${sdk}`, `--source-sha=${source}`], { ownKeys() { traps++; throw Error(); } }), { sdk, source_sha: source, max_requests: 17 }]) assert.throws(() => snapshotSyntheticHostOptions(bad), /stage6-synthetic-host-refused/);
  assert.equal(traps, 0);
});

test("fault taxonomy is closed and preserves independent technical classes", () => {
  assert.deepEqual(SYNTHETIC_FAULTS, ["semantic-mismatch", "schema-invalid", "provider-error", "cancelled", "timeout", "deadline", "stream-disconnected", "profile-drift", "request-guard", "session-budget"]);
});

test("matrix runner import is inert and has no startup fetch/timer side effect", async () => {
  const module = new URL("./stage6-native-sdk-matrix.mjs", import.meta.url).href;
  const result = await promisify(execFile)(process.execPath, ["--input-type=module", "-e", `globalThis.fetch=()=>{throw Error("fetch");};globalThis.setTimeout=()=>{throw Error("timer");};await import(${JSON.stringify(module)});console.log("imported");`], { env: { PATH: "/usr/bin:/bin", HOME: "/nonexistent", TMPDIR: "/nonexistent" }, shell: false, timeout: 5000 });
  assert.equal(result.stdout.trim(), "imported"); assert.equal(result.stderr, "");
});

test("acceptance CLI and matrix reject unknown flags before any source/SDK access", () => {
  assert.throws(() => parseStage6NativeAcceptanceOptions([`--sdk=${sdk}`, `--source-sha=${source}`, "--allow-live"]), /stage6-native-acceptance-refused/);
  assert.throws(() => parseStage6NativeMatrixOptions([`--sdk=${sdk}`, `--source-sha=${source}`, "--bank=real"]), /stage6-native-acceptance-refused/);
});
