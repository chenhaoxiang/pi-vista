import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createLearningLibrary } from "@pi-vista/learning";
import { ownerFixture, verifiedExperience } from "./learning.fixtures.js";
import { BANK } from "./portable.fixtures.js";
import { httpFixture, requestOf } from "./hindsight-http.fixtures.js";

for (const phase of ["lstat", "stat"] as const) for (const mode of ["abort", "timeout"] as const) {
  test(`hindsight ${mode} during pre-create ${phase} causes no attempt or HTTP effect before a valid fresh retry`, async () => {
    const fixture = await httpFixture(); const owner = ownerFixture();
    const library = createLearningLibrary({ verifier: owner.verifier });
    const request = requestOf(library.preparePromotion(await verifiedExperience(library, owner), BANK));
    const configFile = path.join(fixture.root, "synthetic-config.json"); const requestFile = path.join(fixture.root, "synthetic-request.json");
    await writeFile(configFile, JSON.stringify(fixture.config), { mode: 0o600 }); await writeFile(requestFile, JSON.stringify(request), { mode: 0o600 });
    let timer: ReturnType<typeof setTimeout> | undefined;
    const child = spawn(process.execPath, [fileURLToPath(new URL("./hindsight-cancellation.fixtures.js", import.meta.url)), mode, phase, configFile, requestFile],
      { env: {}, stdio: ["ignore", "pipe", "pipe"] });
    try {
      const result = await new Promise<{ code: number | null; signal: NodeJS.Signals | null; stdout: string; stderr: string }>((resolve, reject) => {
        let stdout = ""; let stderr = "";
        timer = setTimeout(() => { child.kill("SIGKILL"); reject(Error("synthetic child deadline")); }, 10_000);
        child.stdout!.on("data", chunk => { stdout += String(chunk); }); child.stderr!.on("data", chunk => { stderr += String(chunk); });
        child.once("error", reject); child.once("close", (code, signal) => resolve({ code, signal, stdout, stderr }));
      });
      assert.equal(result.code, 0); assert.equal(result.signal, null); assert.equal(result.stderr, "");
      const report = JSON.parse(result.stdout);
      assert.equal(report.mode, mode); assert.equal(report.phase, phase); assert.equal(report.node, process.version); assert.notEqual(report.pid, process.pid);
      assert.equal(report.first.state, "refused"); assert.equal(report.first.code, mode === "timeout" ? "sink-timeout" : "sink-failed"); assert.equal(report.first.fixed_error, true);
      assert.deepEqual(report.creates_before_retry, []); assert.deepEqual(report.journal_before_retry, []);
      assert.equal(report.retry.state, "matched"); assert.equal(report.reconciliation.state, "matched");
      assert.equal(report.reconciliation.authorization, "none"); assert.equal(report.reconciliation.executable, false);
      assert.equal(report.journal_after_retry.length, 2);
      assert.deepEqual(fixture.calls, { retain: 1, get: 3, recall: 0, other: 0 });
    } finally {
      clearTimeout(timer);
      if (child.exitCode === null && child.signalCode === null) { await new Promise<void>(resolve => { child.once("close", () => resolve()); child.kill("SIGKILL"); }); }
      await fixture.close();
    }
  });
}
