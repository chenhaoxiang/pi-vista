import path from "node:path";
import { isMain, ROOT, createRunDirectory, discoverPackages, npmCli, npmFlags, parseOptions, publicEntrypoints, runLogged, validateInventory, validateLockedCompiler, writeReport } from "./release-utils.mjs";

export async function sourceGate({ network = false } = {}) {
  if (Number(process.versions.node.split(".")[0]) < 20 || process.platform === "win32") throw new Error("Source gate requires Node >=20 on POSIX");
  const directory = await createRunDirectory("source");
  let npm;
  const flags = npmFlags(directory, network);
  const steps = [];
  const run = async (label, args) => {
    const result = await runLogged(directory, label, process.execPath, [npm, ...args]);
    steps.push(label);
    return result;
  };
  try {
    npm = await npmCli();
    await run("npm-ci", ["ci", ...flags]);
    await validateLockedCompiler();
    const packages = await discoverPackages();
    for (const [index, pkg] of packages.entries()) {
      if (!pkg.manifest.scripts?.build || !pkg.manifest.scripts?.typecheck || !pkg.manifest.scripts?.test) throw new Error(`Workspace missing required source gate scripts: ${pkg.manifest.name}`);
      await run(`build-${index}`, ["run", "build", `--workspace=${pkg.manifest.name}`, ...flags]);
    }
    for (const [index, pkg] of packages.entries()) await run(`typecheck-${index}`, ["run", "typecheck", `--workspace=${pkg.manifest.name}`, ...flags]);
    const compiler = path.join(ROOT, "node_modules/typescript/bin/tsc");
    await runLogged(directory, "integration-typecheck", process.execPath, [compiler, "-p", "tsconfig.integration.json", "--noEmit"]);
    steps.push("integration-typecheck");
    for (const [index, pkg] of packages.entries()) await run(`tests-${index}`, ["run", "test", `--workspace=${pkg.manifest.name}`, ...flags]);
    await runLogged(directory, "integration-build", process.execPath, [compiler, "-p", "tsconfig.integration.json"]);
    await runLogged(directory, "integration-tests", process.execPath, [path.join(ROOT, "scripts/run-tests.mjs"), "dist-integration", ".test.mjs"]);
    await runLogged(directory, "release-script-tests", process.execPath, [path.join(ROOT, "scripts/run-tests.mjs"), "scripts", ".test.mjs"]);
    steps.push("integration-build", "integration-tests", "release-script-tests");
    const inventories = [];
    for (const [index, pkg] of packages.filter((pkg) => pkg.manifest.private !== true).entries()) {
      publicEntrypoints(pkg.manifest);
      const result = await run(`pack-dry-run-${index}`, ["pack", `--workspace=${pkg.manifest.name}`, "--dry-run", "--json", ...flags]);
      const records = JSON.parse(result.stdout);
      if (records.length !== 1 || records[0].name !== pkg.manifest.name || records[0].version !== pkg.manifest.version) throw new Error("Unexpected dry-run package identity");
      inventories.push({ name: pkg.manifest.name, files: validateInventory(pkg.manifest, records[0].files.map((file) => file.path)) });
    }
    await writeReport(directory, { status: "passed", network, steps, packages: packages.map((pkg) => pkg.manifest.name), inventories });
    console.log(`Source evidence: ${directory}`);
    return directory;
  } catch (error) {
    await writeReport(directory, { status: "failed", network, steps, failure: error.message });
    throw error;
  }
}

if (isMain(import.meta.url)) {
  try { await sourceGate(parseOptions(process.argv.slice(2))); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
