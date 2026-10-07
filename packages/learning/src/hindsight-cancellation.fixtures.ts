import assert from "node:assert/strict";
import { constants } from "node:fs";
import nativeFs from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import path from "node:path";
import { LearningError, type IngestRequest } from "@pi-vista/learning";
import { createHindsightStore, type HindsightStoreConfig } from "@pi-vista/learning/hindsight";

// Standalone synthetic child only: native FS interception never reaches the test parent.
const [mode, phase, configFile, requestFile] = process.argv.slice(2);
assert.ok((mode === "abort" || mode === "timeout") && (phase === "lstat" || phase === "stat") && configFile && requestFile);
const config = JSON.parse(await nativeFs.readFile(configFile, "utf8")) as HindsightStoreConfig;
const request = JSON.parse(await nativeFs.readFile(requestFile, "utf8")) as IngestRequest;
const store = createHindsightStore({ ...config, timeout_ms: mode === "timeout" ? 200 : 2000 });
const controller = new AbortController(); const start = performance.now();
const fs = nativeFs as unknown as { lstat: (...args: any[]) => Promise<any>; open: (...args: any[]) => Promise<any> };
const originalLstat = fs.lstat; const originalOpen = fs.open;
let release!: () => void; let held!: () => void; let rootChecks = 0; let directoryStats = 0;
const gate = new Promise<void>(resolve => { release = resolve; });
const ready = new Promise<void>(resolve => { held = resolve; });
const createEvents: { aborted: boolean; elapsed_ms: number }[] = [];
let readinessTimer: ReturnType<typeof setTimeout> | undefined;
fs.lstat = async (...args: any[]) => {
  if (args[0] === config.journal_directory && ++rootChecks === 2 && phase === "lstat") { held(); await gate; }
  return originalLstat(...args);
};
fs.open = async (...args: any[]) => {
  if (typeof args[0] === "string" && args[0].endsWith(".intent") && (args[1] & constants.O_CREAT)) {
    createEvents.push({ aborted: controller.signal.aborted, elapsed_ms: Math.round(performance.now() - start) });
  }
  const file = await originalOpen(...args);
  if (args[0] === config.journal_directory && (args[1] & constants.O_DIRECTORY)) {
    const stat = file.stat.bind(file);
    file.stat = async (...options: any[]) => {
      if (++directoryStats === 2 && phase === "stat") { held(); await gate; }
      return stat(...options);
    };
  }
  return file;
};
syncBuiltinESMExports();
try {
  const pending = store.sink.ingest(request, controller.signal).then(
    () => ({ state: "matched" }),
    (error: unknown) => ({ state: "refused", code: error instanceof LearningError ? error.code : "unexpected-error", fixed_error: error instanceof LearningError && error.stack === `LearningError: ${error.code}` }),
  );
  await Promise.race([ready, new Promise<never>((_, reject) => { readinessTimer = setTimeout(() => reject(Error("synthetic readiness deadline")), 4000); })]);
  clearTimeout(readinessTimer);
  if (mode === "abort") controller.abort(); else await new Promise(resolve => setTimeout(resolve, 300));
  release(); const first = await pending;
  fs.lstat = originalLstat; fs.open = originalOpen; syncBuiltinESMExports();
  const before = await nativeFs.readdir(config.journal_directory);
  const retry = await createHindsightStore({ ...config, timeout_ms: 2000 }).sink.ingest(request, new AbortController().signal).then(
    () => ({ state: "matched" }), (error: unknown) => ({ state: "refused", code: error instanceof LearningError ? error.code : "unexpected-error" }),
  );
  const reconciliation = await store.reconcile(request, new AbortController().signal);
  console.log(JSON.stringify({ mode, phase, node: process.version, pid: process.pid, first, creates_before_retry: createEvents, journal_before_retry: before,
    retry, reconciliation, journal_after_retry: await nativeFs.readdir(config.journal_directory) }));
} finally {
  clearTimeout(readinessTimer); release(); fs.lstat = originalLstat; fs.open = originalOpen; syncBuiltinESMExports();
}
