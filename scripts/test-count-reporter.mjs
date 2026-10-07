import { writeFileSync } from "node:fs";
import path from "node:path";

/** Native events, not test stdout/diagnostic strings, are the case-count source. */
export function isFileWrapper(data, files, cwd = process.cwd()) {
  return data.line === 1 && data.column === 1 && data.nesting === 0 &&
    typeof data.name === "string" && typeof data.file === "string" &&
    !Object.hasOwn(data, "entryFile") && files.includes(path.resolve(data.file)) &&
    path.resolve(cwd, data.name) === path.resolve(data.file);
}
export function countCompletion(counts, event, files, cwd) {
  if (event.type !== "test:pass" && event.type !== "test:fail") return;
  const data = event.data;
  if (data.details?.type === "suite") { counts.suites++; return; }
  if (isFileWrapper(data, files, cwd)) { counts.file_wrappers++; return; }
  if (data.details?.type !== undefined && data.details.type !== "test") throw Error("Unsupported native test completion");
  counts.tests++;
  if (data.skip) counts.skipped++;
  else if (data.todo) counts.todo++;
  else if (event.type === "test:pass") counts.passed++;
  else if (["cancelledByParent", "testTimeoutFailure", "testAborted"].includes(data.details?.error?.failureType)) counts.cancelled++;
  else counts.failed++;
}

/** Loaded by the parent test controller; test modules run in isolated children. */
export default async function* report(source) {
  const file = process.env.PI_VISTA_TEST_COUNT_FILE;
  const files = JSON.parse(process.env.PI_VISTA_TEST_FILES ?? "null");
  if (typeof file !== "string" || !Array.isArray(files) || !files.length || !files.every(value => typeof value === "string" && path.isAbsolute(value))) throw Error("Missing native test-count configuration");
  const counts = { tests: 0, passed: 0, failed: 0, cancelled: 0, skipped: 0, todo: 0, suites: 0, file_wrappers: 0 };
  for await (const event of source) {
    countCompletion(counts, event, files, process.cwd());
    if (event.type === "test:pass" || event.type === "test:fail") {
      const name = String(event.data.name).replace(/[\r\n]/gu, " ");
      yield `${event.type === "test:pass" ? "ok" : "not ok"} - ${name}\n`;
    }
    // stdout, stderr and user diagnostics cannot impersonate native totals.
  }
  writeFileSync(file, JSON.stringify({ schema: 1, files, counts }), { encoding: "utf8", flag: "wx" });
  for (const key of ["tests", "suites", "passed", "failed", "cancelled", "skipped", "todo"]) {
    const label = key === "passed" ? "pass" : key === "failed" ? "fail" : key;
    yield `# ${label} ${counts[key]}\n`;
  }
}
