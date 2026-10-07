import { lstat, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { ROOT, createRunDirectory, isMain, listFiles, publicEntrypoints, readJson } from "./release-utils.mjs";

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
  const owned = await createRunDirectory("test-counts");
  const reportPath = path.join(owned, "native-counts.json");
  env.PI_VISTA_TEST_COUNT_FILE = reportPath;
  env.PI_VISTA_TEST_FILES = JSON.stringify(files);
  try {
    const reporter = fileURLToPath(new URL("./test-count-reporter.mjs", import.meta.url));
    const child = spawn(process.execPath, ["--test", `--test-reporter=${reporter}`, ...files], { env, shell: false, stdio: "inherit" });
    const code = await new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("close", (value, signal) => resolve(signal === null && value === 0 ? 0 : value || 1));
    });
    if (code !== 0) return code;
    const report = JSON.parse(await readFile(reportPath, "utf8"));
    validateCaseCounts(report, files);
    return 0;
  } finally { await rm(owned, { recursive: true, force: true }); }
}

export function validateCaseCounts(report, files) {
  const keys = ["tests", "passed", "failed", "cancelled", "skipped", "todo", "suites", "file_wrappers"];
  if (report === null || typeof report !== "object" || Array.isArray(report) || Object.keys(report).length !== 3 ||
    !["schema", "files", "counts"].every(key => Object.hasOwn(report, key)) || report.schema !== 1 ||
    !Array.isArray(report.files) || JSON.stringify(report.files) !== JSON.stringify(files) ||
    !report.counts || Array.isArray(report.counts) || Object.keys(report.counts).length !== keys.length ||
    !keys.every(key => Object.hasOwn(report.counts, key) && Number.isSafeInteger(report.counts[key]) && report.counts[key] >= 0) ||
    report.counts.tests !== report.counts.passed + report.counts.failed + report.counts.cancelled + report.counts.skipped + report.counts.todo) throw Error("Invalid native test-count report");
  if (report.counts.tests === 0 || report.counts.passed + report.counts.failed === 0) throw Error("No executed test cases; empty suites and implicit file wrappers are not coverage");
  if (report.counts.failed !== 0 || report.counts.cancelled !== 0) throw Error("Native test cases failed or were cancelled");
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
