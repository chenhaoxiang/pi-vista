import { strict as assert } from "node:assert";
import { createHash } from "node:crypto";
import { lstat, mkdir, readFile, realpath, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { ROOT, createRunDirectory, discoverPackages, isMain, listFiles, npmCli, npmFlags, parseOptions, publicBins, publicEntrypoints, readJson, runLogged, sha256, validateContent, validateInstalledLock, validateInventory, validateLockedCompiler, writeReport } from "./release-utils.mjs";

export function consumerSources(entries) {
  const imports = entries.map((entry, index) => `import * as public${index} from ${JSON.stringify(entry.specifier)};`).join("\n");
  const typescript = `${imports}
import { CheckRegistry } from "@pi-vista/checks";
import type { VistaCheckFunction } from "@pi-vista/protocol";
export const publicNamespaces = [${entries.map((_, index) => `public${index}`).join(", ")}];
export async function compareSyntheticMetadata(): Promise<boolean> {
  const definitions: VistaCheckFunction[] = [{
    check_id: "consumer-binding", type: "env_matches",
    params: { expected: "synthetic", actual: "synthetic" }, on_fail: "STOP",
  }];
  const registry = new CheckRegistry();
  registry.registerBindingPredicates();
  const report = await registry.run(definitions);
  const authorization: "none" = report.authorization;
  const verification: "predicate-only" = report.verification;
  return report.satisfied && authorization === "none" && verification === "predicate-only";
}
`;
  const probe = `import { strict as assert } from "node:assert";
import { realpath } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const entries = ${JSON.stringify(entries)};
for (const entry of entries) {
  const resolved = await realpath(fileURLToPath(import.meta.resolve(entry.specifier)));
  assert.equal(resolved, entry.expectedRuntime, "export must resolve to the installed tarball, never the checkout");
  assert.equal(typeof await import(entry.specifier), "object");
  if (entry.require) {
    assert.equal(await realpath(require.resolve(entry.specifier)), entry.expectedRequire);
    require(entry.specifier);
  }
}
const { compareSyntheticMetadata, publicNamespaces } = await import("./dist/consumer.js");
assert.equal(await compareSyntheticMetadata(), true);
assert.equal(publicNamespaces.length, entries.length);
console.log(JSON.stringify({ importedExports: entries.length, compiledConsumer: true, authorization: "none" }));
`;
  return { typescript, probe };
}

export async function packedConsumer({ network = false, "keep-consumer": keepConsumer = false } = {}) {
  if (Number(process.versions.node.split(".")[0]) < 20 || process.platform === "win32") throw new Error("Packed-consumer gate requires Node >=20 on POSIX");
  const directory = await createRunDirectory("consumer");
  const tarballDirectory = path.join(directory, "tarballs");
  const consumer = path.join(directory, "isolated consumer");
  const records = [];
  let consumerCreated = false, failure, report;
  try {
    await mkdir(tarballDirectory);
    await mkdir(consumer);
    consumerCreated = true;
    const npm = await npmCli();
    const flags = npmFlags(directory, network);
    const sourceLock = await validateLockedCompiler();
    const workspaces = await discoverPackages();
    for (const [index, pkg] of workspaces.entries()) {
      if (!pkg.manifest.scripts?.build) throw new Error(`Workspace missing build script: ${pkg.manifest.name}`);
      await runLogged(directory, `build-${index}`, process.execPath, [npm, "run", "build", `--workspace=${pkg.manifest.name}`, ...flags]);
    }
    const packages = workspaces.filter((pkg) => pkg.manifest.private !== true);
    const tarballs = [];
    for (const [index, pkg] of packages.entries()) {
      const result = await runLogged(directory, `pack-${index}`, process.execPath, [npm, "pack", `--workspace=${pkg.manifest.name}`, "--json", `--pack-destination=${tarballDirectory}`, ...flags]);
      const metadata = JSON.parse(result.stdout);
      if (metadata.length !== 1 || metadata[0].name !== pkg.manifest.name || metadata[0].version !== pkg.manifest.version || !/^[a-zA-Z0-9_.-]+\.tgz$/.test(metadata[0].filename)) throw new Error("Unexpected packed package identity");
      const files = validateInventory(pkg.manifest, metadata[0].files.map((file) => file.path));
      const tarball = path.join(tarballDirectory, metadata[0].filename);
      const bytes = await readFile(tarball);
      assert.equal(`sha512-${createHash("sha512").update(bytes).digest("base64")}`, metadata[0].integrity, "tarball integrity");
      const inventory = await runLogged(directory, `tar-inventory-${index}`, "tar", ["-tzf", tarball]);
      const actualFiles = inventory.stdout.trimEnd().split("\n").map((file) => {
        if (!file.startsWith("package/")) throw new Error("Unexpected tarball root");
        return file.slice("package/".length);
      });
      assert.deepEqual([...validateInventory(pkg.manifest, actualFiles)].sort(), [...files].sort(), "actual archive vs npm pack inventory");
      tarballs.push(tarball);
      records.push({ name: pkg.manifest.name, version: pkg.manifest.version, sha256: sha256(bytes), integrity: metadata[0].integrity, files });
    }
    const devDependencies = {}, overrides = {};
    for (const [location, locked] of Object.entries(sourceLock.packages)) {
      if (location.startsWith("node_modules/") && !locked.link) {
        const name = location.slice("node_modules/".length);
        if (name.includes("/node_modules/")) throw new Error("Nested tool locks need explicit consumer lock support");
        overrides[name] = locked.version;
      }
    }
    for (const name of ["typescript", "@types/node"]) {
      const locked = sourceLock.packages[`node_modules/${name}`];
      if (!locked?.version || !locked.integrity) throw new Error("Missing locked consumer compiler dependency");
      devDependencies[name] = locked.version;
    }
    await writeFile(path.join(consumer, "package.json"), JSON.stringify({ name: "pi-vista-packed-consumer", version: "0.0.0", private: true, type: "module", devDependencies, overrides }, null, 2));
    await runLogged(directory, "npm-install", process.execPath, [npm, "install", "--workspaces=false", "--save-exact", ...flags, ...tarballs], consumer);
    const installedLock = await readJson(path.join(consumer, "package-lock.json"));
    validateInstalledLock(sourceLock, installedLock, packages, tarballs, consumer, records.map((record) => record.integrity));
    const entries = [], bins = [];
    for (const [index, pkg] of packages.entries()) {
      const installed = path.join(consumer, "node_modules", pkg.manifest.name);
      assert.equal((await lstat(installed)).isSymbolicLink(), false, "installed package must not be a workspace symlink");
      assert.equal(await realpath(installed), installed);
      const installedManifest = await readJson(path.join(installed, "package.json"));
      assert.deepEqual(installedManifest, pkg.manifest, "packed manifest must equal source manifest");
      const files = validateInventory(installedManifest, await listFiles(installed));
      assert.deepEqual([...files].sort(), [...records[index].files].sort(), "installed inventory must equal actual tarball");
      for (const file of files) validateContent(file, await readFile(path.join(installed, file), "utf8"));
      for (const entry of publicEntrypoints(installedManifest)) entries.push({ ...entry, expectedRuntime: path.join(installed, entry.runtime), ...(entry.require ? { expectedRequire: path.join(installed, entry.require) } : {}) });
      for (const bin of publicBins(installedManifest)) bins.push({ ...bin, installed });
    }
    const { typescript, probe } = consumerSources(entries);
    await writeFile(path.join(consumer, "consumer.ts"), typescript);
    await writeFile(path.join(consumer, "probe.mjs"), probe);
    await writeFile(path.join(consumer, "tsconfig.json"), JSON.stringify({ compilerOptions: { target: "ES2022", module: "NodeNext", moduleResolution: "NodeNext", strict: true, skipLibCheck: false, types: ["node"], typeRoots: ["./node_modules/@types"], outDir: "dist" }, include: ["consumer.ts"] }, null, 2));
    const installedCompiler = path.join(consumer, "node_modules/typescript");
    assert.equal((await readJson(path.join(installedCompiler, "package.json"))).version, sourceLock.packages["node_modules/typescript"].version);
    await runLogged(directory, "consumer-typescript", process.execPath, [path.join(installedCompiler, "bin/tsc"), "-p", "tsconfig.json"], consumer);
    await runLogged(directory, "consumer-imports", process.execPath, ["probe.mjs"], consumer);
    for (const [index, bin] of bins.entries()) {
      const installedBin = path.join(consumer, "node_modules/.bin", bin.name);
      assert.equal(await realpath(installedBin), path.join(bin.installed, bin.file), "npm bin must target the installed tarball");
      assert.notEqual((await stat(installedBin)).mode & 0o111, 0, "installed bin is executable");
      const result = await runLogged(directory, `consumer-bin-${index}`, process.execPath, [installedBin, "--help"], consumer);
      assert.notEqual(result.stdout.trim(), "", "bin help must produce output");
      assert.equal(result.stderr, "", "bin help must not report an error");
    }
    await writeFile(path.join(directory, "consumer-package-lock.json"), JSON.stringify(installedLock, null, 2) + "\n");
    await writeFile(path.join(directory, "consumer.ts"), typescript);
    await writeFile(path.join(directory, "probe.mjs"), probe);
    report = { status: "passed", network, dependencyCache: process.env.npm_config_cache ?? process.env.NPM_CONFIG_CACHE ?? "npm default cache", compiler: sourceLock.packages["node_modules/typescript"].version, exports: entries.map((entry) => entry.specifier), bins: bins.map((bin) => bin.name), packages: records, consumerRetained: keepConsumer, authorization: "none" };
  } catch (error) {
    failure = error;
    report = { status: "failed", network, packages: records, failure: error.message, consumerRetained: keepConsumer, authorization: "none" };
  } finally {
    // This exact directory was created above; never delete checkout-wide tmp or caller paths.
    if (consumerCreated && !keepConsumer) {
      try { await rm(consumer, { recursive: true, force: true }); }
      catch (error) {
        failure ??= error;
        report = { ...report, status: "failed", failure: failure.message };
      }
    }
  }
  await writeReport(directory, report);
  if (failure) throw failure;
  console.log(`Packed-consumer evidence: ${directory}`);
  return directory;
}

if (isMain(import.meta.url)) {
  try { await packedConsumer(parseOptions(process.argv.slice(2), [], ["network", "keep-consumer"])); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
