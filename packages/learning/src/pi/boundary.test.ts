import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import * as root from "@pi-vista/learning";
import { createPiObservation } from "@pi-vista/learning/pi";
import { originFixture } from "../portable.fixtures.js";
import { harness, start, idle, startCall, endCall, TASK, mockHost } from "./observation.fixtures.js";

test("optional addon is not in root import graph; no SDK dependency, autoload manifest or runtime fixtures", () => {
  assert.equal(Object.hasOwn(root, "createPiObservation"), false);
  const pkg = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8"));
  assert.deepEqual(pkg.exports["./pi"], { types: "./dist/pi/index.d.ts", import: "./dist/pi/index.js" });
  assert.equal(Object.hasOwn(pkg, "pi"), false); assert.equal(Object.hasOwn(pkg, "peerDependencies"), false);
  const runtime = new URL("../../dist/pi/", import.meta.url);
  for (const name of readdirSync(runtime)) { assert.doesNotMatch(name, /test|fixtures/u); if (!name.endsWith(".js")) continue;
    const source = readFileSync(new URL(name, runtime), "utf8");
    assert.doesNotMatch(source, /node:(?:fs|path|os|http|https|net|child_process|worker_threads)|\bprocess\.|getOrCreateRunId|createPiRunContext|@earendil-works/u);
    assert.doesNotMatch(source, /sendMessage|sendUserMessage|appendEntry|setActiveTools|setModel|registerTool|pasteToEditor|setEditorText|\b(?:exec|spawn|fetch|require|import)\s*\(/u);
  }
});
test("fresh child import/factory causes no FS/network/timers/env/home/session discovery or callbacks", () => {
  const source = `
    import assert from 'node:assert/strict';
    import fs from 'node:fs/promises'; import os from 'node:os'; import { syncBuiltinESMExports } from 'node:module';
    let effects = 0; let callbacks = 0; let discovery = 0;
    for (const name of ['open','mkdir','writeFile','appendFile','readdir']) fs[name] = () => { effects++; throw Error('synthetic unexpected I/O'); };
    const readSource = fs.readFile;
    // Node20's ESM loader itself uses readFile. Permit only the exact package module namespace, never data/config/session reads.
    const moduleRoot = new URL('../', import.meta.url).pathname;
    fs.readFile = (url, ...args) => {
      if (url instanceof URL && url.protocol === 'file:' && url.pathname.startsWith(moduleRoot) && /\\/(?:learning|core|evidence|checks|protocol)\\/dist\\/[^?]+\\.js$/.test(url.pathname)) return readSource(url, ...args);
      effects++; throw Error('unexpected data read');
    };
    os.homedir = () => { discovery++; throw Error('no home discovery'); }; syncBuiltinESMExports();
    globalThis.fetch = () => { effects++; throw Error('no network'); };
    const setTimer = globalThis.setTimeout;
    globalThis.setTimeout = () => { effects++; throw Error('no factory timer'); };
    const environment = process.env;
    const probe = key => { if (typeof key === 'string' && /VISTA|PI_|HOME|TOKEN|CREDENTIAL|CONFIG/.test(key)) { discovery++; throw Error('no env discovery'); } };
    process.env = new Proxy({}, { get(target, key) { probe(key); return target[key]; }, getOwnPropertyDescriptor(target, key) { probe(key); return Object.getOwnPropertyDescriptor(target, key); } });
    const { createPiObservation } = await import('@pi-vista/learning/pi');
    const addon = createPiObservation({ now: () => { callbacks++; return 20000; }, resolve_task: async () => { callbacks++; return {repo:'fixture-repo',source_sha:'a'.repeat(40),policy_version:'policy-1',env_fingerprint:'env-1',task_type:'metadata-update',task_goal:'bounded metadata validation',bank:'fixture-bank'}; }, tools: [] });
    assert.ok(Object.isFrozen(addon.controller)); assert.equal(addon.controller.status().phase, 'MISSING');
    assert.equal(callbacks, 0); assert.equal(discovery, 0); assert.equal(effects, 0);
    globalThis.setTimeout = setTimer;
    const hooks = new Map(); addon.extension({on(name,handler){hooks.set(name,handler);return ()=>{};},registerCommand(){}});
    assert.equal(hooks.get('agent_start')({},{}), undefined);
    await new Promise(resolve => setTimer(resolve, 5));
    assert.equal(addon.controller.status().phase, 'active'); assert.equal(callbacks, 1);
    assert.equal(hooks.get('tool_execution_start')({toolCallId:'one',toolName:'read'},{}), undefined);
    assert.equal(hooks.get('tool_execution_end')({toolCallId:'one',isError:false},{}), undefined);
    await new Promise(resolve => setTimer(resolve, 5));
    process.env = environment; assert.equal(discovery, 0); assert.equal(effects, 0);
    console.log('optional-pi-no-effects');
  `;
  const child = spawnSync(process.execPath, ["--input-type=module", "-e", source], { cwd: fileURLToPath(new URL("../../", import.meta.url)), shell: false, timeout: 10_000,
    encoding: "utf8", env: { PATH: "/usr/bin:/bin", LANG: "C", LC_ALL: "C", NODE_PATH: "" } });
  assert.ifError(child.error); assert.equal(child.status, 0, child.stderr); assert.equal(child.stderr, ""); assert.equal(child.stdout.trim(), "optional-pi-no-effects");
});
for (const hostile of ["getter", "proxy", "unknown", "credential", "raw-port", "sparse-array", "explicit-undefined", "unsafe-goal"] as const) test(`closed configuration ${hostile} rejects before trusted callbacks`, () => {
  let callbacks = 0; let traps = 0;
  const config: any = { now: () => { callbacks++; return 20_000; }, resolve_task: async () => { callbacks++; return TASK; }, tools: [] };
  let input = config;
  if (hostile === "getter") Object.defineProperty(config, "events", { get() { traps++; throw Error("getter"); } });
  if (hostile === "proxy") input = new Proxy(config, { get() { traps++; throw Error("proxy"); }, ownKeys() { traps++; throw Error("proxy"); } });
  if (hostile === "unknown") config.cwd = "/private/path";
  if (hostile === "credential") config.tools = [{ native_name: "read", classification: "prefix-ghp_" + "a".repeat(36) }];
  if (hostile === "raw-port") config.events = { append: async () => { callbacks++; }, root: "/private/path" };
  if (hostile === "sparse-array") config.tools = new Array(1);
  if (hostile === "explicit-undefined") config.history = undefined;
  if (hostile === "unsafe-goal") config.task_goal = "raw prompt";
  assert.throws(() => createPiObservation(input), /invalid-config/u); assert.equal(callbacks, 0); assert.equal(traps, 0);
});
test("hostile portable config is validated without clocks/ports; valid factory also calls no clock", () => {
  const f = originFixture(); let calls = 0;
  const base = { now: () => { calls++; return 20_000; }, resolve_task: async () => { calls++; return TASK; }, tools: [],
    history: { origins: [f.pin], now: () => { calls++; return 20_000; }, max_age_ms: 60_000, port: { query: async () => { calls++; return {}; }, read: async () => { calls++; return {}; } } } };
  createPiObservation(base); assert.equal(calls, 0);
  assert.throws(() => createPiObservation({ ...base, history: { ...base.history, port: { ...base.history.port, get extra() { calls++; throw Error("getter"); } } } } as any), /invalid-config/u);
  assert.equal(calls, 0);
});
test("later config/task mutation cannot redirect stores, classifications or retained aliases", async () => {
  const events: any[] = []; const config = { now: () => 20_000, resolve_task: async () => TASK, tools: [{ native_name: "read", classification: "metadata-reader" }], events: { append: async (e: any) => { events.push(e); } } };
  const addon = createPiObservation(config); config.events.append = async () => { assert.fail("mutated callback"); }; config.tools[0]!.classification = "mutated-class";
  const host = mockHost(); addon.extension(host.api); host.fire("agent_start"); await idle(addon.controller); host.fire("tool_execution_start", startCall("one")); await idle(addon.controller);
  assert.equal(events.find(e => e.action === "pi:tool-execution-start").target_class, "metadata-reader"); assert.ok(Object.isFrozen(addon.controller.status().task));
});
for (const field of ["args", "result", "messages", "parentToolCallId", "unknown", "toolName-at-end", "isError"] as const) test(`raw ${field} getter/proxy bodies are never invoked or retained`, async () => {
  let touched = 0; const raw = new Proxy({}, { get() { touched++; throw Error("private-raw-canary"); }, ownKeys() { touched++; throw Error("private-raw-canary"); } });
  const h = harness(); await start(h); const begin: any = { toolCallId: "native-raw-canary", toolName: "read", args: raw };
  const end: any = { toolCallId: "native-raw-canary", isError: false, result: raw, toolName: raw };
  const key = field === "toolName-at-end" ? "toolName" : field;
  Object.defineProperty(field === "args" ? begin : end, key, { get() { touched++; throw Error("private-raw-canary"); } });
  h.fire("tool_execution_start", begin); h.fire("tool_execution_end", end); await idle(h.controller);
  assert.equal(touched, 0); assert.equal(h.events.filter(e => e.action === "pi:tool-execution-end").length, 1);
  assert.doesNotMatch(JSON.stringify([h.events, h.checkpoints, h.controller.status(), h.messages]), /native-raw-canary|private-raw-canary/u);
});
for (const type of ["proxy", "revoked-proxy", "id-getter", "name-getter", "oversized-id"] as const) test(`hostile event ${type} remains explicit loss without traps`, async () => {
  let traps = 0; const h = harness(); await start(h); let event: any = startCall("one");
  if (type === "proxy") event = new Proxy(event, { get() { traps++; throw Error("trap"); }, getOwnPropertyDescriptor() { traps++; throw Error("trap"); } });
  if (type === "revoked-proxy") { const p = Proxy.revocable(event, {}); p.revoke(); event = p.proxy; }
  if (type === "id-getter") Object.defineProperty(event, "toolCallId", { get() { traps++; throw Error("getter"); } });
  if (type === "name-getter") Object.defineProperty(event, "toolName", { get() { traps++; throw Error("getter"); } });
  if (type === "oversized-id") event.toolCallId = "a".repeat(257);
  h.fire("tool_execution_start", event); await idle(h.controller); assert.equal(traps, 0); assert.equal(h.controller.status().dropped, 1); assert.equal(h.controller.status().correlations, 0);
});
for (const kind of ["getter", "proxy", "revoked-proxy", "symbol", "custom-prototype"] as const) test(`closed task ${kind} rejects without traps or persisted raw metadata`, async () => {
  let traps = 0; let input: any = { ...TASK };
  if (kind === "getter") Object.defineProperty(input, "repo", { get() { traps++; throw Error("private-task-getter"); } });
  if (kind === "proxy") input = new Proxy(input, { ownKeys() { traps++; throw Error("private-task-proxy"); }, get(_target, key) {
    // Native resolver Promise assimilation probes then before the library receives its value.
    if (key === "then") return undefined; traps++; throw Error("private-task-proxy");
  } });
  if (kind === "revoked-proxy") { const p = Proxy.revocable(input, {}); p.revoke(); input = p.proxy; }
  if (kind === "symbol") input[Symbol("private-task-canary")] = "private-task-canary";
  if (kind === "custom-prototype") Object.setPrototypeOf(input, { repo: "private-task-canary" });
  const h = harness({ resolve_task: async () => input }); await start(h); assert.equal(traps, 0); assert.equal(h.controller.status().phase, "MISSING");
  assert.equal(h.events.length, 0); assert.equal(h.checkpoints.length, 0);
});
test("unsafe raw tool names are lookup-only and unknown maps to fixed unclassified", async () => {
  const h = harness(); await start(h); h.fire("tool_execution_start", startCall("one", "prefix-ghp_" + "a".repeat(36))); h.fire("tool_execution_end", endCall("one")); await idle(h.controller);
  assert.equal(h.events.find(e => e.action === "pi:tool-execution-start")!.target_class, "unclassified"); assert.doesNotMatch(JSON.stringify(h.events), /ghp_/u);
});
