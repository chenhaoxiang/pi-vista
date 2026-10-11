import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { chmod, link, mkdir, mkdtemp, readFile, rename, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import {
  HISTORICAL_FORK_1_0_4_FORK_1_CONTRACT,
  OBSERVED_INSTALLED_FORK_1_1_0_FORK_1_CONTRACT,
  PUBLIC_1_0_4_CONTRACT,
  STAGE6_SDK_PROVENANCE_ERROR_CODES,
  STAGE6_SDK_PROVENANCE_REASON_CODES,
  bindStage6Provenance,
  matchSdkContract,
  observeReadonlyBrokerMetadata,
  observeSdkInstallation,
  validateReadonlyBrokerMetadata,
  validateSdkContractMatch,
  validateStage6Provenance,
} from "./stage6-sdk-provenance.mjs";

const exec = promisify(execFile);
const ROOT = fileURLToPath(new URL("../", import.meta.url));
const sha = value => createHash("sha256").update(value).digest("hex");
const source = "a".repeat(40);
const history = sha("history");
const harness = sha("harness");
const context = sha("context");
const artifact = sha("artifact");
const env = sha("environment");
const binding = {
  run_id: "stage6-run",
  repo: "pi-vista",
  source_sha: source,
  policy_version: "stage6-p0",
  env_fingerprint: env,
  harness_source_sha: harness,
  context_digest: context,
  artifact_digest: artifact,
};
async function fixtureRoot(version = "1.0.4") {
  await mkdir(join(ROOT, "tmp"), { recursive: true });
  const root = await mkdtemp(join(ROOT, "tmp", "stage6-sdk-provenance-fixture-"));
  await mkdir(join(root, "dist"));
  const entry = "export const stage6Fixture = true;\n";
  const manifest = { name: "@earendil-works/pi-coding-agent", version,
    engines: { node: ">=22.19.0" }, exports: { ".": { types: "./dist/index.d.ts", import: "./dist/index.js" } } };
  await writeFile(join(root, "package.json"), `${JSON.stringify(manifest)}\n`, { mode: 0o600 });
  await writeFile(join(root, "dist/index.js"), entry, { mode: 0o600 });
  await writeFile(join(root, "dist/index.d.ts"), "export declare const stage6Fixture: boolean;\n", { mode: 0o600 });
  return root;
}
function fixtureContract(observed) {
  return { contract_id: "fixture-public-1.0.4", package_name: observed.package_name, version: observed.version,
    export_entry: observed.export_entry, node_engine: observed.node_engine, manifest_sha256: observed.manifest_sha256, entry_sha256: observed.entry_sha256 };
}
async function brokerFixture() {
  await mkdir(join(ROOT, "tmp"), { recursive: true });
  const profile = await mkdtemp(join(ROOT, "tmp", "stage6-sdk-broker-fixture-"));
  const target = join(profile, "auth-source");
  await chmod(profile, 0o700); await writeFile(target, "PRIVATE_SYNTHETIC_VALUE\n", { mode: 0o600 });
  return { profile, target };
}

test("public SDK contract matrix keeps public, historical fork, and installed fork independent", () => {
  assert.equal(PUBLIC_1_0_4_CONTRACT.version, "1.0.4");
  assert.equal(HISTORICAL_FORK_1_0_4_FORK_1_CONTRACT.version, "1.0.4-fork.1");
  assert.equal(OBSERVED_INSTALLED_FORK_1_1_0_FORK_1_CONTRACT.version, "1.1.0-fork.1");
  assert.equal(PUBLIC_1_0_4_CONTRACT.entry_sha256, HISTORICAL_FORK_1_0_4_FORK_1_CONTRACT.entry_sha256);
  assert.equal(PUBLIC_1_0_4_CONTRACT.entry_sha256, OBSERVED_INSTALLED_FORK_1_1_0_FORK_1_CONTRACT.entry_sha256);
  assert.notEqual(PUBLIC_1_0_4_CONTRACT.manifest_sha256, HISTORICAL_FORK_1_0_4_FORK_1_CONTRACT.manifest_sha256);
  assert.notEqual(HISTORICAL_FORK_1_0_4_FORK_1_CONTRACT.manifest_sha256, OBSERVED_INSTALLED_FORK_1_1_0_FORK_1_CONTRACT.manifest_sha256);
  assert.ok(STAGE6_SDK_PROVENANCE_REASON_CODES.includes("sdk-version-mismatch"));
  assert.ok(STAGE6_SDK_PROVENANCE_ERROR_CODES.includes("stage6-sdk-broker-refused"));
});

test("fixture installation observation reads only fixed manifest and public entry metadata", async () => {
  const root = await fixtureRoot();
  try {
    const observed = await observeSdkInstallation(root);
    assert.equal(observed.verification, "metadata-only"); assert.equal(observed.version, "1.0.4");
    assert.equal(observed.export_entry, "./dist/index.js"); assert.equal(observed.coverage, "manifest-and-public-entry");
    assert.equal(observed.dependency_closure, "not-observed"); assert.equal(JSON.stringify(observed).includes(root), false);
    const matched = matchSdkContract(observed, fixtureContract(observed));
    assert.equal(matched.matched, true); assert.equal(matched.reason_code, "sdk-contract-match"); assert.equal(matched.authorization, "none");
    assert.deepEqual(validateSdkContractMatch(matched), matched);
    assert.equal(matchSdkContract(observed, { ...fixtureContract(observed), version: "1.0.4-fork.1" }).reason_code, "sdk-version-mismatch");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("synthetic three-version matrix never equates equal public entry bytes with SDK equality", async () => {
  for (const version of ["1.0.4", "1.0.4-fork.1", "1.1.0-fork.1"]) {
    const root = await fixtureRoot(version);
    try {
      const observed = await observeSdkInstallation(root); const expected = fixtureContract(observed);
      assert.equal(matchSdkContract(observed, expected).matched, true);
      const other = matchSdkContract(observed, { ...expected, version: version === "1.0.4" ? "1.1.0-fork.1" : "1.0.4" });
      assert.equal(other.matched, false); assert.equal(other.reason_code, "sdk-version-mismatch");
    } finally { await rm(root, { recursive: true, force: true }); }
  }
});

test("readonly broker metadata matches command/file metadata without reading credential bytes", async () => {
  const { profile, target } = await brokerFixture();
  try {
    const command = `cat ${target}`;
    const observed = await observeReadonlyBrokerMetadata({ profile_directory: profile, provider: "codex-local-8319", command, expected_command_sha256: sha(command) });
    assert.equal(observed.matched, true); assert.equal(observed.reason_code, "broker-command-match");
    assert.equal(observed.credential_bytes_read, false); assert.equal(observed.authorization, "none");
    assert.equal(JSON.stringify(observed).includes("PRIVATE_SYNTHETIC_VALUE"), false);
    assert.deepEqual(validateReadonlyBrokerMetadata(observed), observed);
    const mismatch = await observeReadonlyBrokerMetadata({ profile_directory: profile, provider: "codex-local-8319", command, expected_command_sha256: sha(`${command} --changed`) });
    assert.equal(mismatch.matched, false); assert.equal(mismatch.reason_code, "broker-command-mismatch");
    assert.equal(mismatch.target_path_sha256, null); assert.equal(mismatch.target_metadata_sha256, null);
  } finally { await rm(profile, { recursive: true, force: true }); }
});

test("broker rejects shell, path escape and malformed metadata without fallback", async () => {
  const { profile, target } = await brokerFixture();
  try {
    await assert.rejects(observeReadonlyBrokerMetadata({ profile_directory: profile, provider: "codex-local-8319", command: `cat ${target}; echo leak`, expected_command_sha256: sha("x") }), /stage6-sdk-broker-refused/);
    await assert.rejects(observeReadonlyBrokerMetadata({ profile_directory: profile, provider: "codex-local-8319", command: "cat /tmp/other", expected_command_sha256: sha("x") }), /stage6-sdk-broker-refused/);
    const observed = await observeReadonlyBrokerMetadata({ profile_directory: profile, provider: "codex-local-8319", command: `cat ${target}`, expected_command_sha256: sha(`cat ${target}`) });
    assert.throws(() => validateReadonlyBrokerMetadata({ ...observed, command_sha256: sha("other") }), /stage6-sdk-broker-refused/);
  } finally { await rm(profile, { recursive: true, force: true }); }
});

test("embedded credential signatures are refused at provider, contract and binding label boundaries", async () => {
  const f = await pairedFixture();
  try {
    await assert.rejects(observeReadonlyBrokerMetadata({ profile_directory: f.profile, provider: "fixture-sk-12345678", command: `cat ${f.target}`, expected_command_sha256: sha(`cat ${f.target}`) }), /stage6-sdk-broker-refused/);
    assert.throws(() => matchSdkContract(f.observed, { ...fixtureContract(f.observed), contract_id: "fixture-ghp_12345678" }), /stage6-sdk-contract-refused/);
    assert.throws(() => bindStage6Provenance({ ...f.input, bindings: { ...f.input.bindings, env_fingerprint: "env-sk-12345678" } }), /stage6-sdk-binding-refused/);
  } finally { await f.close(); }
});

test("metadata-only binding keeps subject source/history/context/artifact/harness fields distinct", async () => {
  const root = await fixtureRoot();
  const { profile, target } = await brokerFixture();
  try {
    const observed = await observeSdkInstallation(root); const sdk = matchSdkContract(observed, fixtureContract(observed));
    const broker = await observeReadonlyBrokerMetadata({ profile_directory: profile, provider: "codex-local-8319", command: `cat ${target}`, expected_command_sha256: sha(`cat ${target}`) });
    const bound = bindStage6Provenance({ sdk, broker, subject_source_sha: source, history_digest: history, bindings: { ...binding } });
    assert.equal(bound.schema, "stage6-provenance/1"); assert.equal(bound.verification, "metadata-only");
    assert.equal(bound.authorization, "none"); assert.equal(bound.executable, false); assert.equal(bound.subject_source_sha, source); assert.equal(bound.history_digest, history);
    assert.equal(bound.bindings.source_sha, source); assert.equal(bound.bindings.harness_source_sha, harness); assert.equal(bound.bindings.context_digest, context); assert.equal(bound.bindings.artifact_digest, artifact);
    assert.equal(Object.hasOwn(bound, "proof"), false); assert.equal(Object.hasOwn(bound, "permission"), false); assert.equal(Object.hasOwn(bound, "budget"), false);
    assert.deepEqual(validateStage6Provenance(bound), bound);
    assert.throws(() => bindStage6Provenance({ sdk, broker, subject_source_sha: source, history_digest: history, bindings: { ...binding, source_sha: "b".repeat(40) } }), /stage6-sdk-binding-refused/);
  } finally { await rm(root, { recursive: true, force: true }); await rm(profile, { recursive: true, force: true }); }
});

async function pairedFixture() {
  const root = await fixtureRoot(); const { profile, target } = await brokerFixture();
  const observed = await observeSdkInstallation(root), sdk = matchSdkContract(observed, fixtureContract(observed));
  const broker = await observeReadonlyBrokerMetadata({ profile_directory: profile, provider: "codex-local-8319", command: `cat ${target}`, expected_command_sha256: sha(`cat ${target}`) });
  return { root, profile, target, observed, sdk, broker, input: { sdk, broker, subject_source_sha: source, history_digest: history, bindings: { ...binding } },
    async close() { await rm(root, { recursive: true, force: true }); await rm(profile, { recursive: true, force: true }); } };
}
for (const corruption of ["malformed-json", "invalid-utf8", "wrong-name", "wrong-export", "oversized-manifest", "oversized-entry"]) {
  test(`SDK observation refuses ${corruption} with no foreign file/error text`, async () => {
    const root = await fixtureRoot();
    try {
      if (corruption === "malformed-json") await writeFile(join(root, "package.json"), "PRIVATE_DIAGNOSTIC{");
      if (corruption === "invalid-utf8") await writeFile(join(root, "package.json"), Buffer.from([0xff, 0xfe]));
      if (corruption === "oversized-manifest") await writeFile(join(root, "package.json"), Buffer.alloc(65_537, 0x20));
      if (corruption === "oversized-entry") await writeFile(join(root, "dist/index.js"), Buffer.alloc(1_048_577, 0x20));
      if (corruption === "wrong-name" || corruption === "wrong-export") {
        const p = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
        if (corruption === "wrong-name") p.name = "@fixture/foreign-sdk"; else p.exports["."].import = "../../PRIVATE_DIAGNOSTIC";
        await writeFile(join(root, "package.json"), JSON.stringify(p));
      }
      await assert.rejects(observeSdkInstallation(root), error => error.message === "stage6-sdk-installation-refused");
    } finally { await rm(root, { recursive: true, force: true }); }
  });
}
for (const member of ["package.json", "dist/index.js", "dist"]) {
  test(`SDK observation refuses symlink at ${member}`, async () => {
    const root = await fixtureRoot();
    try {
      const file = join(root, member), moved = join(root, "original-member"); await rename(file, moved); await symlink(moved, file);
      await assert.rejects(observeSdkInstallation(root), /stage6-sdk-installation-refused/);
    } finally { await rm(root, { recursive: true, force: true }); }
  });
}
test("SDK observation refuses executable/coerced root inputs before hooks", async () => {
  let calls = 0;
  for (const input of [null, "relative", "/", new Proxy({}, { get() { calls++; throw Error(); } }), { toString() { calls++; throw Error(); } }]) {
    await assert.rejects(observeSdkInstallation(input), /stage6-sdk-installation-refused/);
  }
  assert.equal(calls, 0);
});
test("SDK identity/match validators recompute digest/decision and reject injected current authority", async () => {
  const f = await pairedFixture();
  try {
    assert.throws(() => matchSdkContract({ ...f.observed, identity_sha256: sha("forged") }, fixtureContract(f.observed)), /stage6-sdk-contract-refused/);
    assert.throws(() => validateSdkContractMatch({ ...f.sdk, matched: false }), /stage6-sdk-contract-refused/);
    assert.throws(() => validateSdkContractMatch({ ...f.sdk, observed_digest: sha("other") }), /stage6-sdk-contract-refused/);
    assert.throws(() => validateSdkContractMatch({ ...f.sdk, authorization: "approved" }), /stage6-sdk-contract-refused/);
    assert.throws(() => validateSdkContractMatch({ ...f.sdk, proof: true }), /stage6-sdk-contract-refused/);
    assert.equal(matchSdkContract(f.observed, { ...fixtureContract(f.observed), manifest_sha256: sha("other") }).reason_code, "sdk-manifest-mismatch");
    assert.equal(matchSdkContract(f.observed, { ...fixtureContract(f.observed), entry_sha256: sha("other") }).reason_code, "sdk-entry-mismatch");
  } finally { await f.close(); }
});
for (const kind of ["readable-mode", "hardlink", "symlink", "empty", "oversized"]) {
  test(`readonly broker refuses ${kind} without reading bytes`, async () => {
    const { profile, target } = await brokerFixture();
    try {
      if (kind === "readable-mode") await chmod(target, 0o644);
      if (kind === "hardlink") await link(target, join(profile, "alias"));
      if (kind === "symlink") { await rename(target, join(profile, "original")); await symlink(join(profile, "original"), target); }
      if (kind === "empty") await writeFile(target, "");
      if (kind === "oversized") await writeFile(target, Buffer.alloc(4097));
      const command = `cat ${target}`;
      await assert.rejects(observeReadonlyBrokerMetadata({ profile_directory: profile, provider: "codex-local-8319", command, expected_command_sha256: sha(command) }), /stage6-sdk-broker-refused/);
    } finally { await rm(profile, { recursive: true, force: true }); }
  });
}
test("broker command pin mismatch refuses observation before even nonexistent profile/target lookup", async () => {
  const command = "cat /nonexistent/stage6-provenance/secret";
  const value = await observeReadonlyBrokerMetadata({ profile_directory: "/nonexistent/stage6-provenance", provider: "fixture-provider", command, expected_command_sha256: sha("different") });
  assert.equal(value.matched, false); assert.equal(value.target_metadata_sha256, null); assert.equal(value.credential_bytes_read, false);
});
test("broker metadata detects target mutation, supports explicit bang marker and contains no secret/path", async () => {
  const { profile, target } = await brokerFixture();
  try {
    const command = `cat ${target}`, input = { profile_directory: profile, provider: "fixture-provider", command: `!${command}`, expected_command_sha256: sha(command) };
    const before = await observeReadonlyBrokerMetadata(input); await writeFile(target, "DIFFERENT_PRIVATE_BYTES_LONGER\n");
    const after = await observeReadonlyBrokerMetadata(input); assert.equal(before.command_sha256, after.command_sha256);
    assert.notEqual(before.target_metadata_sha256, after.target_metadata_sha256); const text = JSON.stringify(after);
    assert.ok(!text.includes(target) && !text.includes("PRIVATE_BYTES"));
  } finally { await rm(profile, { recursive: true, force: true }); }
});
test("broker probe never calls file read/readFile for secret targets", async () => {
  const { profile, target } = await brokerFixture();
  try {
    const url = new URL("./stage6-sdk-provenance.mjs", import.meta.url).href, command = `cat ${target}`;
    const code = `import assert from 'node:assert/strict';import * as fs from 'node:fs/promises';let reads=0;const handle=await fs.open(${JSON.stringify(target)},'r');const proto=Object.getPrototypeOf(handle);await handle.close();for(const method of ['read','readFile'])proto[method]=()=>{reads++;throw Error('credential-read');};const m=await import(${JSON.stringify(url)});const v=await m.observeReadonlyBrokerMetadata(${JSON.stringify({ profile_directory: profile, provider: "fixture-provider", command, expected_command_sha256: sha(command) })});assert.equal(v.matched,true);assert.equal(reads,0);console.log(JSON.stringify({reads}));`;
    const result = await exec(process.execPath, ["--input-type=module", "-e", code], { cwd: ROOT, env: { PATH: "/usr/bin:/bin", HOME: "/nonexistent" }, shell: false, timeout: 5000 });
    assert.equal(result.stderr, ""); assert.deepEqual(JSON.parse(result.stdout), { reads: 0 });
  } finally { await rm(profile, { recursive: true, force: true }); }
});
test("binding allows detached JSON history metadata but never restores a proof, budget or authority", async () => {
  const f = await pairedFixture();
  try {
    const before = bindStage6Provenance(f.input); const after = validateStage6Provenance(JSON.parse(JSON.stringify(before)));
    assert.deepEqual(before, after); assert.ok(Object.isFrozen(after) && Object.isFrozen(after.sdk.observed) && Object.isFrozen(after.broker) && Object.isFrozen(after.bindings));
    for (const extra of [{ permission: true }, { budget: 16 }, { proof: true }]) assert.throws(() => validateStage6Provenance({ ...before, ...extra }), /stage6-sdk-binding-refused/);
    assert.throws(() => bindStage6Provenance({ ...f.input, bindings: { ...binding, source_sha: harness } }), /stage6-sdk-binding-refused/);
    assert.throws(() => bindStage6Provenance({ ...f.input, bindings: { ...binding, context_digest: "raw context" } }), /stage6-sdk-binding-refused/);
    assert.throws(() => bindStage6Provenance({ ...f.input, history_digest: "raw history" }), /stage6-sdk-binding-refused/);
    assert.equal(bindStage6Provenance({ ...f.input, bindings: { ...binding, context_digest: null } }).bindings.context_digest, null);
    assert.equal(bindStage6Provenance({ ...f.input, bindings: { ...binding, env_fingerprint: "fixture-environment-v1" } }).bindings.env_fingerprint, "fixture-environment-v1");
  } finally { await f.close(); }
});
test("SDK/broker/binding hostile getters, proxies and extra sensitive fields invoke no hooks", async () => {
  const f = await pairedFixture(); let calls = 0;
  try {
    const get = Object.defineProperty({ ...f.sdk }, "observed", { get() { calls++; throw Error(); } });
    const proxy = new Proxy(f.sdk, { get() { calls++; throw Error(); }, ownKeys() { calls++; throw Error(); } });
    assert.throws(() => validateSdkContractMatch(get)); assert.throws(() => validateSdkContractMatch(proxy));
    const broker = Object.defineProperty({ ...f.broker }, "matched", { get() { calls++; throw Error(); } });
    assert.throws(() => validateReadonlyBrokerMetadata(broker));
    const b = Object.defineProperty({ ...binding }, "source_sha", { get() { calls++; throw Error(); } });
    assert.throws(() => bindStage6Provenance({ ...f.input, bindings: b }));
    const request = Object.defineProperty({ profile_directory: f.profile, provider: "fixture-provider", command: `cat ${f.target}`, expected_command_sha256: sha(`cat ${f.target}`) }, "command", { get() { calls++; throw Error(); } });
    await assert.rejects(observeReadonlyBrokerMetadata(request)); assert.equal(calls, 0);
    assert.throws(() => validateReadonlyBrokerMetadata({ ...f.broker, credential: "PRIVATE_VALUE" }));
  } finally { await f.close(); }
});

test("SDK match scalar metadata rejects executable objects without proxy/getter traversal", async () => {
  const f = await pairedFixture(); let calls = 0;
  try {
    for (const field of ["schema", "matched", "reason_code", "observed_digest", "expected_digest"]) {
      const proxy = new Proxy({}, { ownKeys() { calls++; throw Error(); }, get() { calls++; throw Error(); } });
      assert.throws(() => validateSdkContractMatch({ ...f.sdk, [field]: proxy }), /stage6-sdk-contract-refused/);
    }
    assert.equal(calls, 0);
  } finally { await f.close(); }
});

test("module import is inert and source has no model/bank/network runtime path", async () => {
  const sourceText = await readFile(new URL("./stage6-sdk-provenance.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(sourceText, /ModelRuntime|createAgentSession|fetch\s*\(|EventStore|Hindsight|bank|credential_bytes_read\s*=\s*true/u);
  const result = await exec(process.execPath, ["--input-type=module", "-e", `globalThis.fetch=()=>{throw Error("fetch");}; await import(${JSON.stringify(new URL("./stage6-sdk-provenance.mjs", import.meta.url).href)}); console.log("imported");`], { env: { PATH: "/usr/bin:/bin", HOME: "/nonexistent", TMPDIR: "/nonexistent" }, shell: false });
  assert.equal(result.stdout.trim(), "imported"); assert.equal(result.stderr, "");
});
