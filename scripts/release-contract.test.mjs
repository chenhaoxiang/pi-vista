import { strict as assert } from "node:assert";
import { execFile } from "node:child_process";
import { mkdir, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { ROOT, allowedPackagePath, buildOrder, commandEnvironment, createRunDirectory, discoverPackages, npmCli, npmFlags, parseOptions, publicEntrypoints, runLogged, sha256, validateContent, validateInstalledLock, validateInventory } from "./release-utils.mjs";
import { selectTestFiles, validateProtocolEmptyExemption, validateCaseCounts } from "./run-tests.mjs";
import { countCompletion } from "./test-count-reporter.mjs";
import { consumerSources } from "./packed-consumer.mjs";
import { NODE20_ARCHIVE, NODE20_SHA256, validateArchiveNames, validateNode20Version, verifyOfficialChecksum } from "./node20-gate.mjs";

const exec = promisify(execFile);
const fixtureManifest = (name = "synthetic-package") => ({ name, version: "0.0.0", type: "module", exports: { ".": { types: "./dist/index.d.ts", import: "./dist/index.js" } }, files: ["dist", "README.md", "LICENSE"] });
async function fixture(callback) {
  const directory = await createRunDirectory("script-test");
  try { await callback(directory); }
  finally { await rm(directory, { recursive: true, force: true }); }
}

test("run-tests deterministically enumerates nested files without Node20 glob support", () => {
  assert.deepEqual(selectTestFiles(["z.test.js", "other.js", "nested/a.test.js"], ".test.js"), ["nested/a.test.js", "z.test.js"]);
  assert.deepEqual(selectTestFiles(["integration.test.mjs"], ".test.mjs"), ["integration.test.mjs"]);
  assert.throws(() => selectTestFiles([], ".test.js"), /No compiled/);
  assert.throws(() => selectTestFiles(["a.js"], "*"), /suffix/);
});

test("run-tests preserves pass/failure exit status and handles spaces", async () => {
  await fixture(async (directory) => {
    const compiled = path.join(directory, "compiled tests with spaces");
    await mkdir(path.join(compiled, "nested"), { recursive: true });
    const file = path.join(compiled, "nested/example.test.mjs");
    await writeFile(file, 'import { test } from "node:test"; import { strict as assert } from "node:assert"; test("synthetic pass", () => assert.equal(1, 1));');
    const args = [path.join(ROOT, "scripts/run-tests.mjs"), compiled, ".test.mjs"];
    const result = await runLogged(directory, "enumerator-pass", process.execPath, args);
    assert.match(result.stdout, /synthetic pass/);
    await writeFile(file, 'import { test } from "node:test"; test("synthetic failure", () => { throw new Error("expected fixture failure"); });');
    await assert.rejects(runLogged(directory, "enumerator-fail", process.execPath, args), /FAILED enumerator-fail/);
    assert.match(await readFile(path.join(directory, "enumerator-fail.log"), "utf8"), /exit: 1/);
  });
});

test("run-tests fails on empty directories and refuses symlinks", async () => {
  await fixture(async (directory) => {
    const compiled = path.join(directory, "compiled");
    await mkdir(compiled);
    const args = [path.join(ROOT, "scripts/run-tests.mjs"), compiled, ".test.mjs"];
    await assert.rejects(runLogged(directory, "empty-tests", process.execPath, args));
    await symlink(path.join(directory, "missing.test.mjs"), path.join(compiled, "linked.test.mjs"));
    await assert.rejects(runLogged(directory, "symlink-tests", process.execPath, args));
  });
});

test("compiled empty suites and comment-only modules do not manufacture executed coverage", async () => {
  await fixture(async directory => {
    const compiled = path.join(directory, "compiled"); await mkdir(compiled);
    const file = path.join(compiled, "empty.test.mjs");
    for (const [name, source] of [
      ["empty-suite", 'import { describe } from "node:test"; describe("synthetic empty", () => {});'],
      ["comment-only", '// Synthetic compiled module with no explicit test.'],
      ["diagnostic-spoof", 'console.log("tests 999"); console.log("pass 999");'],
      ["skipped-only", 'import { test } from "node:test"; test.skip("synthetic skipped", () => {});'],
    ]) {
      await writeFile(file, source);
      await assert.rejects(runLogged(directory, name, process.execPath, [path.join(ROOT, "scripts/run-tests.mjs"), compiled, ".test.mjs"]));
      assert.match(await readFile(path.join(directory, name + ".log"), "utf8"), /No executed test cases/);
    }
  });
});

test("native completions exclude automatic file wrappers and suites, never stdout/diagnostic claims", () => {
  const files = ["/synthetic/module.test.mjs"];
  const counts = { tests: 0, passed: 0, failed: 0, cancelled: 0, skipped: 0, todo: 0, suites: 0, file_wrappers: 0 };
  for (const type of ["test:stdout", "test:stderr", "test:diagnostic"]) countCompletion(counts, { type, data: { message: "tests 999" } }, files, "/synthetic");
  countCompletion(counts, { type: "test:pass", data: { name: files[0], file: files[0], line: 1, column: 1, nesting: 0, details: {} } }, files, "/synthetic");
  countCompletion(counts, { type: "test:pass", data: { name: "empty suite", details: { type: "suite" } } }, files, "/synthetic");
  assert.equal(counts.tests, 0); assert.equal(counts.file_wrappers, 1); assert.equal(counts.suites, 1);
  assert.throws(() => validateCaseCounts({ schema: 1, files, counts }, files), /No executed/);
  countCompletion(counts, { type: "test:pass", data: { name: "explicit case", file: files[0], line: 2, column: 1, nesting: 0, details: {} } }, files, "/synthetic");
  validateCaseCounts({ schema: 1, files, counts }, files);
  assert.equal(counts.tests, 1); assert.equal(counts.passed, 1);
  assert.throws(() => validateCaseCounts({ schema: 1, files: ["other"], counts }, files), /Invalid/);
  assert.throws(() => validateCaseCounts({ schema: 1, files, counts: { ...counts, failed: 1 } }, files), /Invalid/);
});

test("protocol zero-test exemption is explicit, workspace-only and requires both built public artifacts", () => {
  const directory = path.join(ROOT, "packages/protocol/dist");
  const manifest = fixtureManifest("@pi-vista/protocol");
  validateProtocolEmptyExemption(directory, ".test.js", manifest, ["index.js", "index.d.ts"]);
  for (const files of [[], ["index.js"], ["index.d.ts"]]) assert.throws(() => validateProtocolEmptyExemption(directory, ".test.js", manifest, files), /requires built/);
  for (const candidate of [path.join(ROOT, "packages/core/dist"), "/synthetic/protocol/dist"]) assert.throws(() => validateProtocolEmptyExemption(candidate, ".test.js", manifest, ["index.js", "index.d.ts"]), /restricted/);
  assert.throws(() => validateProtocolEmptyExemption(directory, ".test.mjs", manifest, ["index.js", "index.d.ts"]), /restricted/);
  assert.throws(() => validateProtocolEmptyExemption(directory, ".test.js", fixtureManifest(), ["index.js", "index.d.ts"]), /restricted/);
});

test("built repository protocol deliberately reports zero assertions, not a fabricated test PASS", async () => {
  await fixture(async (directory) => {
    const result = await runLogged(directory, "protocol-zero", process.execPath, [path.join(ROOT, "scripts/run-tests.mjs"), path.join(ROOT, "packages/protocol/dist"), ".test.js", "--allow-empty"]);
    assert.match(result.stdout, /ZERO TESTS: explicit protocol-only exemption/);
    assert.match(result.stdout, /no assertions counted/);
  });
});

test("non-protocol CLI empty exemption is refused even with a similarly named fixture", async () => {
  await fixture(async (directory) => {
    await assert.rejects(runLogged(directory, "non-protocol-exemption", process.execPath, [path.join(ROOT, "scripts/run-tests.mjs"), directory, ".test.js", "--allow-empty"]));
    assert.match(await readFile(path.join(directory, "non-protocol-exemption.log"), "utf8"), /restricted/);
    const missing = path.join(directory, "missing dist");
    await assert.rejects(runLogged(directory, "missing-dist", process.execPath, [path.join(ROOT, "scripts/run-tests.mjs"), missing, ".test.js", "--allow-empty"]));
  });
});

test("workspace discovery and topological builds include future public packages generically", async () => {
  await fixture(async (directory) => {
    await writeFile(path.join(directory, "package.json"), JSON.stringify({ workspaces: ["packages/*"] }));
    for (const [name, dependencies] of [["protocol", {}], ["learning", { "@pi-vista/protocol": "0.0.0" }], ["shadow", { "@pi-vista/learning": "0.0.0" }]]) {
      const child = path.join(directory, "packages", name);
      await mkdir(child, { recursive: true });
      await writeFile(path.join(child, "package.json"), JSON.stringify({ ...fixtureManifest(`@pi-vista/${name}`), dependencies }));
    }
    const packages = await discoverPackages(directory);
    assert.deepEqual(packages.map((pkg) => pkg.manifest.name), ["@pi-vista/protocol", "@pi-vista/learning", "@pi-vista/shadow"]);
    packages[0].manifest.dependencies = { "@pi-vista/shadow": "0.0.0" };
    assert.throws(() => buildOrder(packages), /cycle/);
    assert.throws(() => buildOrder([packages[0], packages[0]]), /Duplicate/);
  });
});

test("public export validation is closed and never silently skips an export", () => {
  assert.equal(publicEntrypoints(fixtureManifest())[0].specifier, "synthetic-package");
  for (const exports of [{ "./*": { types: "./dist/index.d.ts", import: "./dist/index.js" } }, { ".": { import: "./dist/index.js" } }, { ".": { types: "./src/index.ts", import: "./dist/index.js" } }, { ".": { types: "./dist/index.d.ts", import: "./dist/index.js", unknown: "./dist/index.js" } }]) {
    assert.throws(() => publicEntrypoints({ ...fixtureManifest(), exports }));
  }
});

test("package-content allowlist rejects source, tests, keys, dotenv, traversal and temporary artifacts", () => {
  for (const file of ["src/index.ts", "dist/index.ts", "dist/index.test.js", "dist/index.test.d.ts.map", "dist/tests/index.js", "dist/fixtures/a.js", "dist/internal/a.js", "dist/../index.js", ".env", "dist/.env.js", "keys/private.pem", "tmp/artifact.json"]) assert.equal(allowedPackagePath(file), false, file);
  for (const file of ["dist/index.js", "dist/index.d.ts", "dist/index.js.map", "dist/runtime/credential.js", "README.md", "LICENSE", "package.json"]) assert.equal(allowedPackagePath(file), true, file);
  assert.throws(() => validateInventory(fixtureManifest(), ["package.json", "dist/index.js"]), /Missing public/);
  assert.throws(() => validateInventory(fixtureManifest(), ["package.json", "package.json"]), /duplicate/);
});

test("bounded packed-content checks reject embedded source and private-key markers, not credential test labels", () => {
  validateContent("dist/index.js.map", JSON.stringify({ sources: ["../src/index.ts"] }));
  validateContent("dist/credential.js", 'const syntheticLabel = "ghp_not-a-real-credential";');
  assert.throws(() => validateContent("dist/index.js.map", JSON.stringify({ sourcesContent: ["synthetic source"] })), /Embedded source/);
  assert.throws(() => validateContent("dist/index.js.map", "invalid map"));
  assert.throws(() => validateContent("README.md", "-----BEGIN PRIVATE KEY-----\nnot a key, synthetic marker only"), /Private-key/);
});

test("actual npm pack includes compiled test artifacts without metadata exclusions and excludes them with metadata only", async () => {
  await fixture(async (directory) => {
    const workspace = path.join(directory, "package with spaces");
    await mkdir(path.join(workspace, "dist"), { recursive: true });
    await writeFile(path.join(workspace, "dist/index.js"), "export const value = 1;\n");
    await writeFile(path.join(workspace, "dist/index.d.ts"), "export declare const value = 1;\n");
    await writeFile(path.join(workspace, "dist/index.test.js"), "// synthetic compiled test\n");
    await writeFile(path.join(workspace, "dist/index.test.d.ts.map"), "{}\n");
    const manifest = fixtureManifest();
    await writeFile(path.join(workspace, "package.json"), JSON.stringify(manifest));
    const npm = await npmCli();
    const args = [npm, "pack", "--json", `--pack-destination=${directory}`, ...npmFlags(directory, false)];
    const before = JSON.parse((await runLogged(directory, "pack-before", process.execPath, args, workspace)).stdout)[0];
    assert(before.files.some((file) => file.path === "dist/index.test.js"));
    assert.throws(() => validateInventory(manifest, before.files.map((file) => file.path)), /Disallowed/);
    manifest.files.splice(1, 0, "!dist/**/*.test.*");
    await writeFile(path.join(workspace, "package.json"), JSON.stringify(manifest));
    const after = JSON.parse((await runLogged(directory, "pack-after", process.execPath, args, workspace)).stdout)[0];
    validateInventory(manifest, after.files.map((file) => file.path));
    const inventory = (await runLogged(directory, "actual-archive", "tar", ["-tzf", path.join(directory, after.filename)], workspace)).stdout.trimEnd().split("\n").map((file) => file.slice("package/".length));
    assert.deepEqual([...inventory].sort(), after.files.map((file) => file.path).sort());
    assert(!inventory.some((file) => file.includes(".test.")));
    assert.equal(await readFile(path.join(workspace, "dist/index.test.js"), "utf8"), "// synthetic compiled test\n", "no generated tests deleted or sanitized");
  });
});

test("consumer lock validation refuses workspace links, version/integrity drift and missing public installs", () => {
  const packages = [{ manifest: fixtureManifest() }];
  const sourceLock = { packages: { "node_modules/typescript": { version: "5.9.3", integrity: "synthetic-ts" }, "node_modules/@types/node": { version: "20.0.0", integrity: "synthetic-types" } } };
  const lock = { packages: { ...sourceLock.packages, "node_modules/synthetic-package": { version: "0.0.0", resolved: "file:../tarballs/synthetic.tgz", integrity: "synthetic-tarball-integrity" } } };
  const validate = (candidate) => validateInstalledLock(sourceLock, candidate, packages, ["/synthetic/tarballs/synthetic.tgz"], "/synthetic/consumer", ["synthetic-tarball-integrity"]);
  validate(lock);
  const publicEntry = lock.packages["node_modules/synthetic-package"];
  for (const entry of [{ ...publicEntry, link: true }, { ...publicEntry, version: "9.0.0" }, { ...publicEntry, resolved: "file:../checkout" }, { ...publicEntry, integrity: "changed" }]) assert.throws(() => validate({ packages: { ...lock.packages, "node_modules/synthetic-package": entry } }));
  assert.throws(() => validate({ packages: sourceLock.packages }), /missing packed/);
  assert.throws(() => validate({ packages: { ...lock.packages, "node_modules/typescript": { version: "5.9.3", integrity: "changed" } } }), /differs/);
});

test("consumer compiler source uses public APIs and checks non-authorizing typed results", () => {
  const sources = consumerSources([{ specifier: "@pi-vista/checks", expectedRuntime: "/synthetic/consumer/node_modules/@pi-vista/checks/dist/index.js" }]);
  assert.match(sources.typescript, /VistaCheckFunction\[\]/);
  assert.match(sources.typescript, /authorization: "none"/);
  assert.match(sources.probe, /import\.meta\.resolve/);
  assert.match(sources.probe, /compareSyntheticMetadata/);
});

test("Node20 validators fail closed for other runtimes, checksum mismatches and unsafe archive names", () => {
  assert.equal(validateNode20Version("v20.20.2\n"), "v20.20.2");
  for (const version of ["v22.23.2", "v26.9.0", "20", "v20.1.0 arbitrary"]) assert.throws(() => validateNode20Version(version));
  validateArchiveNames("node-v20.20.2-darwin-arm64/bin/node\n");
  for (const names of ["/etc/a", "node-v20.20.2-darwin-arm64/../escape", "other/bin/node"]) assert.throws(() => validateArchiveNames(names));
  assert.equal(sha256("abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  assert.throws(() => verifyOfficialChecksum(`${NODE20_SHA256}  ${NODE20_ARCHIVE}\n`, Buffer.from("synthetic, not an archive")), /checksum mismatch/);
  assert.throws(() => verifyOfficialChecksum("invalid checksum listing", Buffer.from("synthetic")), /checksum mismatch/);
});

test("gate options are explicit and reject arbitrary arguments", () => {
  assert.deepEqual(parseOptions(["--network"]), { network: true });
  assert.equal(parseOptions(["--node=/path with spaces/node"], ["node"]).node, "/path with spaces/node");
  for (const args of [["--network=false"], ["--network", "--network"], ["--unknown"], ["raw command"], ["--node="]]) assert.throws(() => parseOptions(args, ["node"]));
});

test("child environment is an allowlist and does not forward arbitrary API keys or runner context", () => {
  const key = "SYNTHETIC_RELEASE_API_KEY";
  const previous = process.env[key];
  try {
    process.env[key] = "synthetic-value-not-a-credential";
    const env = commandEnvironment();
    assert.equal(Object.hasOwn(env, key), false);
    assert.equal(Object.hasOwn(env, "NODE_TEST_CONTEXT"), false);
    assert.equal(Object.hasOwn(env, "NODE_OPTIONS"), false);
    assert.equal(env.NPM_CONFIG_USERCONFIG, "/dev/null");
  } finally {
    if (previous === undefined) delete process.env[key];
    else process.env[key] = previous;
  }
});

test("all standalone script imports are side-effect-free (no npm, download, test or artifact operations)", async () => {
  await fixture(async (directory) => {
    const scripts = ["release-utils.mjs", "run-tests.mjs", "test-count-reporter.mjs", "source-gate.mjs", "packed-consumer.mjs", "node20-gate.mjs"];
    const source = scripts.map((script) => `await import(${JSON.stringify(pathToFileURL(path.join(ROOT, "scripts", script)).href)});`).join("\n");
    const before = await readdir(directory);
    const result = await exec(process.execPath, ["--input-type=module", "-e", source], { cwd: directory, env: { PATH: "/nonexistent" }, shell: false });
    assert.equal(result.stdout, "");
    assert.equal(result.stderr, "");
    assert.deepEqual(await readdir(directory), before);
  });
});
