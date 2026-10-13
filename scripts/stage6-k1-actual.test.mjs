import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { parseK1ActualOptions } from "./stage6-k1-actual.mjs";
import { createK1NativeFactory } from "./stage6-k1-native.mjs";
import { K1_READ_SERVICE_CONTRACT } from "./stage6-k1-service-compat.mjs";

const args = () => ["--sdk=/fixture/sdk", "--profile-dir=/fixture/profile", `--broker-pin=${"a".repeat(64)}`, "--history-reference=/fixture/reference.json", "--credential-config=/fixture/config.json", "--service-fingerprint=/fixture/fingerprint.json", "--subject-root=/fixture/subject", `--harness-source-sha=${"b".repeat(40)}`, "--allow-live"];
const supported = () => { const [a, b] = process.versions.node.split(".").map(Number); return a > 22 || a === 22 && b >= 19; };
test("actual runner options are closed and explicit; unsupported Node never invokes SDK", () => {
  if (supported()) {
    assert.equal(parseK1ActualOptions(args())["allow-live"], true);
    assert.equal(parseK1ActualOptions(args())["service-contract"], "api-0.10.2-accepted");
    assert.equal(parseK1ActualOptions([...args(), `--service-contract=${K1_READ_SERVICE_CONTRACT}`])["service-contract"], K1_READ_SERVICE_CONTRACT);
    assert.throws(() => parseK1ActualOptions([...args(), "--service-contract=api-0.10.3"]), /stage6-k1-actual-options-refused/);
  }
  else assert.throws(() => parseK1ActualOptions(args()), /stage6-k1-actual-options-refused/);
  for (const value of [args().slice(0, 8), [...args(), "--retry=1"], [...args().slice(0, 8), "--allow-bank-write"], args().map(a => a.startsWith("--sdk=") ? "--sdk=relative" : a)]) assert.throws(() => parseK1ActualOptions(value), /stage6-k1-actual-options-refused/);
});
test("option proxies/getters and invalid broker pin refuse without hooks", () => {
  let calls = 0; const fail = () => { calls++; throw Error("PRIVATE"); };
  assert.throws(() => parseK1ActualOptions(new Proxy(args(), { get: fail, ownKeys: fail })));
  const g = args(); Object.defineProperty(g, "0", { get: fail }); assert.throws(() => parseK1ActualOptions(g));
  assert.throws(() => createK1NativeFactory({ sdkRoot: "/fixture", profileDirectory: "/fixture", brokerPin: "invalid", outputDirectory: "/fixture" }));
  assert.equal(calls, 0);
});
test("operator and native factory imports are inert before explicit live call", () => {
  for (const module of ["stage6-k1-actual.mjs", "stage6-k1-native.mjs"]) {
    const url = new URL(module, import.meta.url).href;
    const child = spawnSync(process.execPath, ["--input-type=module", "-e", `globalThis.fetch=()=>{throw Error('network')};globalThis.setTimeout=()=>{throw Error('timer')};await import(${JSON.stringify(url)});console.log('imported')`], { encoding: "utf8", timeout: 5000, env: { PATH: process.env.PATH, HOME: "/nonexistent", TMPDIR: "/nonexistent" } });
    assert.equal(child.status, 0); assert.equal(child.stdout, "imported\n"); assert.equal(child.stderr, "");
  }
});
