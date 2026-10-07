import { lstat } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { ROOT, isMain, listFiles, publicEntrypoints, readJson } from "./release-utils.mjs";

export function selectTestFiles(files, suffix) {
  if (![".test.js", ".test.mjs"].includes(suffix)) throw new Error("Expected .test.js or .test.mjs suffix");
  const selected = files.filter((file) => file.endsWith(suffix)).sort();
  if (!selected.length) throw new Error("No compiled test files found");
  return selected;
}

export function validateProtocolEmptyExemption(directory, suffix, manifest, builtFiles) {
  if (directory !== path.join(ROOT, "packages/protocol/dist") || suffix !== ".test.js" || manifest.name !== "@pi-vista/protocol") throw new Error("--allow-empty is restricted to this repository's protocol dist/.test.js workspace");
  for (const target of publicEntrypoints(manifest).flatMap((entry) => [entry.types, entry.runtime])) {
    if (!builtFiles.includes(target.slice("dist/".length))) throw new Error("Protocol zero-test exemption requires built public entries and declarations");
  }
}

export async function runTests(directory, suffix, allowEmpty = false) {
  const absolute = path.resolve(directory);
  const stat = await lstat(absolute);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("Test directory must be real");
  const allFiles = await listFiles(absolute);
  if (allowEmpty) {
    if (absolute !== path.join(ROOT, "packages/protocol/dist")) throw new Error("--allow-empty is restricted to this repository's protocol workspace");
    validateProtocolEmptyExemption(absolute, suffix, await readJson(path.join(ROOT, "packages/protocol/package.json")), allFiles);
    if (!allFiles.some((file) => file.endsWith(suffix))) {
      console.log("ZERO TESTS: explicit protocol-only exemption; built entries/declarations present, no assertions counted.");
      return 0;
    }
  }
  const files = selectTestFiles(allFiles, suffix).map((file) => path.join(absolute, file));
  console.log(`Running ${files.length} compiled test files on ${process.version}`);
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT; // Nested synthetic runner tests must launch a real child test harness.
  const child = spawn(process.execPath, ["--test", ...files], { env, shell: false, stdio: "inherit" });
  return await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => resolve(signal === null && code === 0 ? 0 : code || 1));
  });
}

if (isMain(import.meta.url)) {
  try {
    if (![4, 5].includes(process.argv.length) || process.argv.length === 5 && process.argv[4] !== "--allow-empty") throw new Error("Usage: node scripts/run-tests.mjs <compiled-directory> <.test.js|.test.mjs> [--allow-empty (protocol only)]");
    process.exitCode = await runTests(process.argv[2], process.argv[3], process.argv[4] === "--allow-empty");
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
