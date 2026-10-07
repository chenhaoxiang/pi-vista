import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";

const runtime = new URL("../dist/", import.meta.url);
test("build products contain no default I/O, executor, signer, model client or test fixture", () => {
  const files = readdirSync(runtime).filter(file => file.endsWith(".js"));
  assert.ok(files.includes("index.js")); assert.ok(!files.some(file => /test|fixtures/u.test(file)));
  for (const file of files) {
    const source = readFileSync(new URL(file, runtime), "utf8");
    const imports = [...source.matchAll(/from\s+["']([^"']+)["']/gu)].map(match => match[1]!);
    assert.ok(imports.every(name => name.startsWith("./") || ["node:crypto", "node:util", "@pi-vista/core", "@pi-vista/evidence"].includes(name)), file);
    assert.doesNotMatch(source, /\b(?:eval|exec|execFile|spawn|fetch|require|import)\s*\(/u, file);
    assert.doesNotMatch(source, /node:(?:fs|http|https|net|child_process|worker_threads)|\bprocess\.|generateKeyPair|private_key|BEGIN PRIVATE KEY/u, file);
    assert.doesNotMatch(source, /hindsight_ingest_document|hindsight_capture_initiative|hindsight_reflect/u, file);
  }
});
test("manifest exports generated ESM/types/license and requires the native executed-case guard", () => {
  const manifest = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  assert.equal(manifest.name, "@pi-vista/learning"); assert.equal(manifest.type, "module"); assert.equal(manifest.engines.node, ">=20");
  assert.equal(manifest.exports["."].import, "./dist/index.js"); assert.equal(manifest.exports["."].types, "./dist/index.d.ts");
  assert.ok(readFileSync(new URL("index.d.ts", runtime), "utf8").includes("createLearningLibrary"));
  assert.ok(readFileSync(new URL("../LICENSE", import.meta.url), "utf8").startsWith("MIT License"));
  assert.ok(manifest.files.includes("LICENSE")); assert.ok(manifest.files.includes("dist"));
  assert.equal(manifest.scripts.test, "npm run build && tsc -p tsconfig.test.json && node ../../scripts/run-tests.mjs dist-test .test.js");
  assert.deepEqual(Object.keys(manifest.dependencies).sort(), ["@pi-vista/core", "@pi-vista/evidence", "@pi-vista/protocol"]);
});
