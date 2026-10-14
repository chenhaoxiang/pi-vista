import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { ROOT } from "./release-utils.mjs";
import { buildPiLocalObserverRelease, piLocalObserverLoader } from "./pi-local-observer-release.mjs";
import { parseLocalObserverSdkOptions } from "./pi-local-observer-sdk.mjs";
const hash = x => createHash("sha256").update(x).digest("hex");
test("loader is fixed, diagnostic-only and verifies artifact hashes before factory", async () => {
  await mkdir(join(ROOT, "tmp"), { recursive: true });const root = await mkdtemp(join(ROOT, "tmp", "observer-release-test-"));
  const entry = join(root, "entry.mjs"), content = "export default function(pi){pi.called++;}\n", dependency = join(root, "dependency.mjs");
  await writeFile(entry, content); await writeFile(dependency, "export const a=1;\n");
  const manifest = JSON.stringify({ files: [{ path: "entry.mjs", sha256: hash(content) }, { path: "dependency.mjs", sha256: hash("export const a=1;\n") }] });
  await writeFile(join(root, "manifest.json"), manifest);
  const loader = join(root, "loader.mjs"); await writeFile(loader, piLocalObserverLoader({ entry, manifest_sha256: hash(manifest) }));
  const messages = [], original = console.error; console.error = message => messages.push(message);
  try {
    const module = await import(pathToFileURL(loader).href), pi = { called: 0 };await module.default(pi);assert.equal(pi.called, 1);
    await writeFile(dependency, "changed public runtime bytes"); await module.default(pi);assert.equal(pi.called, 1);assert.deepEqual(messages, ["[pi-vista] local observer entry unavailable"]);
    await writeFile(join(root, "manifest.json"), "private drift payload");await module.default(pi);assert.equal(pi.called, 1);assert.equal(messages.length, 2);
  } finally { console.error = original;await rm(root, { recursive: true, force: true }); }
});
test("loader options/proxies/getters refuse before hooks", () => {
  let calls = 0;const x = new Proxy({}, { ownKeys() { calls++;throw Error(); } });assert.throws(() => piLocalObserverLoader(x));
  const getter = Object.defineProperty({ manifest_sha256: "a".repeat(64) }, "entry", { get() { calls++;throw Error(); } });assert.throws(() => piLocalObserverLoader(getter));assert.equal(calls, 0);
  for (const value of [{ entry: "relative", manifest_sha256: "a".repeat(64) }, { entry: "/fixture/entry.mjs", manifest_sha256: "bad" }, { entry: "/fixture/entry.mjs", manifest_sha256: "a".repeat(64), permission: true }]) assert.throws(() => piLocalObserverLoader(value));
});
test("SDK acceptance optionally loads a supplied installed entry; old default still supported", () => {
  assert.deepEqual(parseLocalObserverSdkOptions(["--sdk=/fixture/sdk"]), { sdk: "/fixture/sdk" });
  assert.equal(parseLocalObserverSdkOptions(["--sdk=/fixture/sdk", "--entry=/fixture/loader.ts"]).entry, "/fixture/loader.ts");
  assert.throws(() => parseLocalObserverSdkOptions(["--sdk=/fixture/sdk", "--entry=relative"]), /invalid-entry-path/);
  assert.throws(() => parseLocalObserverSdkOptions(["--sdk=/fixture/sdk", "--entry=/fixture/a", "--entry=/fixture/b"]));
  assert.equal(parseLocalObserverSdkOptions(["--sdk=/fixture/sdk", "--entry=/fixture/loader.ts", "--discovery=conventional"]).discovery, "conventional");
  assert.throws(() => parseLocalObserverSdkOptions(["--sdk=/fixture/sdk", "--discovery=arbitrary"]), /invalid-discovery/);
});
test("loader catches rejected async factory and missing manifest without leaking errors", async () => {
  await mkdir(join(ROOT, "tmp"), { recursive: true }); const root = await mkdtemp(join(ROOT, "tmp", "observer-async-test-"));
  const entry = join(root, "entry.mjs"), content = "export default async function(){throw Error('PRIVATE_FACTORY_PAYLOAD');}\n";
  const manifest = JSON.stringify({ files: [{ path: "entry.mjs", sha256: hash(content) }] });
  await writeFile(entry, content); await writeFile(join(root, "manifest.json"), manifest);
  const loader = join(root, "loader.mjs"); await writeFile(loader, piLocalObserverLoader({ entry, manifest_sha256: hash(manifest) }));
  const messages = [], original = console.error; console.error = message => messages.push(message);
  try {
    const module = await import(pathToFileURL(loader).href);
    assert.equal(await module.default({}), undefined);
    await rm(join(root, "manifest.json")); assert.equal(await module.default({}), undefined);
    assert.deepEqual(messages, Array(2).fill("[pi-vista] local observer entry unavailable"));
  } finally { console.error = original; await rm(root, { recursive: true, force: true }); }
});
test("release builder refuses malformed inputs before commands or destination writes", async () => {
  let calls = 0;
  const proxy = new Proxy({}, { ownKeys() { calls++; throw Error(); } });
  const accessor = Object.defineProperty({ source_sha: "a".repeat(40) }, "destination", { get() { calls++; throw Error(); } });
  for (const input of [proxy, accessor, { source_sha: "a".repeat(40), destination: "relative" },
    { source_sha: "bad", destination: join(ROOT, "tmp", "must-not-be-created") },
    { source_sha: "a".repeat(40), destination: "/fixture/../target" },
    { source_sha: "a".repeat(40), destination: "/fixture/target", permission: true }]) {
    await assert.rejects(buildPiLocalObserverRelease(input), /pi-local-observer-release-refused/);
  }
  assert.equal(calls, 0);
});
