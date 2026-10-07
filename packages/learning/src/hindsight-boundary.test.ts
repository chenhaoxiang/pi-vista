import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as root from "@pi-vista/learning";

const runtime = new URL("../dist/", import.meta.url);
test("hindsight additive subpath is not in the recursive own-package root runtime import graph", () => {
  const visited = new Set<string>();
  function visit(url: URL): void {
    if (visited.has(url.href)) return; visited.add(url.href); const source = readFileSync(url, "utf8");
    assert.ok(url.pathname.startsWith(runtime.pathname) && !url.pathname.includes("/hindsight/"));
    assert.doesNotMatch(source, /node:(?:fs|path|http|https|net|child_process|worker_threads)|\bprocess\.|\b(?:fetch|require|import)\s*\(/u);
    for (const match of source.matchAll(/from\s+["']([^"']+)["']/gu)) if (match[1]!.startsWith(".")) visit(new URL(match[1]!, url));
  }
  visit(new URL("index.js", runtime)); assert.ok(visited.size >= 7); assert.equal(Object.hasOwn(root, "createHindsightStore"), false);
  const manifest = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  assert.deepEqual(manifest.exports["./hindsight"], { types: "./dist/hindsight/index.d.ts", import: "./dist/hindsight/index.js" });
});
test("hindsight explicit addon import/factory cause no FS/network or default endpoint/credential/home discovery", () => {
  const child = `
    import assert from 'node:assert/strict';
    import fs from 'node:fs/promises';
    import { syncBuiltinESMExports } from 'node:module';
    let effects = 0; let discovery = 0;
    for (const name of ['open','lstat','mkdir','writeFile','realpath']) fs[name] = () => { effects++; throw Error('unexpected synthetic I/O'); };
    syncBuiltinESMExports();
    globalThis.fetch = () => { effects++; throw Error('unexpected synthetic network'); };
    const environment = process.env;
    process.env = new Proxy({ ...environment, HINDSIGHT_API_URL: 'http://unapproved.invalid', HINDSIGHT_API_TOKEN: 'synthetic-private-canary', HOME: '/unapproved-home' }, {
      get(target, key) { if (typeof key === 'string' && /HINDSIGHT|TOKEN|HOME|CONFIG/.test(key)) discovery++; return target[key]; }
    });
    const addon = await import('@pi-vista/learning/hindsight');
    assert.deepEqual(Object.keys(addon), ['createHindsightStore']);
    const api = addon.createHindsightStore({ endpoint: 'https://synthetic.example', banks: { fixture: 'synthetic-bank' }, journal_directory: '/explicit-private-directory' });
    assert.deepEqual(Object.keys(api).sort(), ['port','reconcile','sink']);
    assert.throws(() => addon.createHindsightStore({}), error => error.code === 'invalid-config');
    process.env = environment; assert.equal(discovery, 0); assert.equal(effects, 0);
    console.log('explicit-addon-no-effects');
  `;
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", child], { cwd: fileURLToPath(new URL("../", import.meta.url)), shell: false, timeout: 10_000,
    encoding: "utf8", env: { PATH: path.dirname(process.execPath), LANG: "C", LC_ALL: "C", NODE_PATH: "" } });
  assert.ifError(result.error); assert.equal(result.status, 0, "bounded addon import/factory child must pass"); assert.equal(result.stderr, ""); assert.equal(result.stdout.trim(), "explicit-addon-no-effects");
});
