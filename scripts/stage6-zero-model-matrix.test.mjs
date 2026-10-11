import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { runFailureDiagnostics, runReferenceMatrix, validateZeroModelMatrix } from "./stage6-zero-model-matrix.mjs";

test("reference matrix covers four cases and both arms without model or bank activity", () => {
  const result = runReferenceMatrix();
  assert.equal(result.schema, "stage6-zero-model-matrix/1"); assert.equal(result.status, "reference-only");
  assert.equal(result.evaluation_status, "not-evaluated"); assert.equal(result.pair_count, 4);
  assert.equal(result.rows.length, 8); assert.equal(result.reference_calls, 8); assert.equal(result.model_calls, 0); assert.equal(result.bank_writes, 0);
  assert.equal(result.all_decisions_valid, true); assert.equal(result.authorization, "none"); assert.equal(result.executable, false);
  assert.deepEqual(validateZeroModelMatrix(result), result);
  assert.deepEqual(result.rows.map(row => row.guidance_mode), ["none", "historical-observed", "none", "historical-observed", "none", "historical-observed", "none", "historical-observed"]);
});

test("failure diagnostics preserve distinct non-success classes without a model", () => {
  const rows = runFailureDiagnostics();
  assert.deepEqual(rows.map(row => row.outcome), ["tool-not-called", "schema-invalid", "refusal", "provider-error", "cancelled", "timeout", "deadline", "stream-disconnected"]);
  assert.ok(rows.every(row => row.authorization === "none" && row.executable === false));
});

test("matrix validation rejects changed status, counts and added fields", () => {
  const result = runReferenceMatrix();
  for (const bad of [
    { ...result, evaluation_status: "measured" },
    { ...result, reference_calls: 7 },
    { ...result, model_calls: 1 },
    { ...result, extra: true },
  ]) assert.throws(() => validateZeroModelMatrix(bad), /stage6-matrix-refused/);
});

test("matrix import is inert before explicit reference execution", async () => {
  const module = new URL("./stage6-zero-model-matrix.mjs", import.meta.url).href;
  const result = await promisify(execFile)(process.execPath, ["--input-type=module", "-e", `globalThis.fetch=()=>{throw Error("fetch");};globalThis.setTimeout=()=>{throw Error("timer");};await import(${JSON.stringify(module)});console.log("imported");`], {
    env: { PATH: "/usr/bin:/bin", HOME: "/nonexistent", TMPDIR: "/nonexistent" }, shell: false, timeout: 5000,
  });
  assert.equal(result.stdout.trim(), "imported"); assert.equal(result.stderr, "");
});
