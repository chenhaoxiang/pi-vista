import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { promisify } from "node:util";
import test from "node:test";
import assert from "node:assert/strict";
import { EventStore } from "@pi-vista/core";
import { ROOT } from "./release-utils.mjs";
import { createLocalPiObserver, localObserverExtension, readSessionHead } from "./pi-local-observer.mjs";
import { parseLocalObserverSdkOptions } from "./pi-local-observer-sdk.mjs";

const exec = promisify(execFile);
test("Default observation state declares its best-effort local store without performing I/O", () => {
  for (const observer of [createLocalPiObserver(), createLocalPiObserver({ store: null })]) {
    assert.equal(observer.hostStatus().persistence, "default-local-event-store");
    assert.equal(observer.hostStatus().registration, "not-registered");
    assert.equal(observer.controller.status().authorization, "none");
    observer.controller.shutdown();
  }
});
test("SDK acceptance options are explicit and reject duplicates or malformed fixture combinations", () => {
  assert.deepEqual(parseLocalObserverSdkOptions(["--sdk=/synthetic/sdk"]), { sdk: "/synthetic/sdk" });
  for (const args of [[], ["--sdk=relative"], ["--sdk=/synthetic/sdk", "--sdk=/other"], ["--sdk=/synthetic/sdk", "--unknown=x"],
    ["--sdk=/synthetic/sdk", "--fixture=/synthetic/fixture"], ["--sdk=/synthetic/sdk", "--scenario=normal"],
    ["--sdk=/synthetic/sdk", `--fixture=${ROOT}tmp/release-contract/../outside`, "--scenario=normal"]]) {
    assert.throws(() => parseLocalObserverSdkOptions(args));
  }
});
function host() {
  const handlers = new Map();
  const commands = new Map();
  return {
    handlers,
    commands,
    on(name, handler) { handlers.set(name, handler); return () => handlers.delete(name); },
    registerCommand(name, options) { commands.set(name, options); },
  };
}
const context = () => ({ cwd: ROOT, hasUI: false, ui: { notify() { assert.fail("non-ui must not notify"); } } });
async function fixture(callback) {
  await mkdir(join(ROOT, "tmp"), { recursive: true });
  const root = await mkdtemp(join(ROOT, "tmp", "local-observer-unit-"));
  try { return await callback(root); }
  finally { await rm(root, { recursive: true, force: true }); }
}
async function drain(observer) {
  const deadline = performance.now() + 3_000;
  for (;;) {
    const status = observer.controller.status();
    if (status.pending_work === 0 && status.pending_callbacks === 0) return status;
    assert.ok(performance.now() < deadline, "observer work did not settle");
    await delay(1);
  }
}
async function readEventLines(root) {
  const files = await readdir(join(root, "runs"));
  assert.equal(files.length, 1);
  const body = await readFile(join(root, "runs", files[0], "events.jsonl"), "utf8");
  return body.trim().split("\n").map(line => JSON.parse(line));
}

test("Pi local observer records native notification results without changing the host path", async () => fixture(async root => {
  const api = host();
  const observer = createLocalPiObserver({ store: new EventStore({ baseDir: root }), readHead: async () => "a".repeat(40), now: () => 20_000 });
  observer.extension(api);
  assert.deepEqual([...api.commands.keys()].sort(), ["vista-adopt", "vista-preview", "vista-status", "vista-verify"]);
  const ctx = context();
  for (const event of ["session_start", "agent_start"]) assert.equal(api.handlers.get(event)?.({}, ctx), undefined);
  api.handlers.get("tool_execution_start")?.({ toolCallId: "call-1", toolName: "read" }, ctx);
  api.handlers.get("tool_execution_end")?.({ toolCallId: "call-1", isError: false }, ctx);
  api.handlers.get("agent_end")?.({}, ctx);
  api.handlers.get("agent_settled")?.({}, ctx);
  await drain(observer);
  const events = await readEventLines(root);
  assert.ok(events.some(event => event.action === "pi:tool-execution-start" && event.result === "unknown"));
  assert.ok(events.some(event => event.action === "pi:tool-execution-end" && event.result === "ok"));
  assert.ok(events.every(event => event.authorization === undefined));
  assert.ok(events.every(event => !JSON.stringify(event).includes(ROOT)));
  assert.ok(events.every(event => event.repo === "session-cwd"));
  assert.equal(observer.controller.status().authorization, "none");
  assert.equal(observer.controller.status().executable, false);
  assert.equal(observer.hostStatus().persistence, "host-supplied-append-port");
}));

test("Observer storage failure is fail-open and unrelated host handlers continue", async () => {
  const api = host(), calls = [];
  const observer = createLocalPiObserver({
    store: { async append() { throw new Error("synthetic-store-failure"); } },
    readHead: async () => "b".repeat(40), now: () => 20_000,
  });
  observer.extension(api);
  const ctx = { ...context(), ui: { notify() { calls.push("notify"); } } };
  for (const [event, input] of [["session_start", {}], ["agent_start", {}],
    ["tool_execution_start", { toolCallId: "call-1", toolName: "bash" }],
    ["tool_execution_end", { toolCallId: "call-1", isError: true }], ["agent_settled", {}]]) {
    assert.equal(api.handlers.get(event)?.(input, ctx), undefined);
  }
  await drain(observer);
  assert.deepEqual(calls, []);
  assert.equal(observer.controller.status().authorization, "none");
  assert.equal(observer.hostStatus().persistence, "host-supplied-append-port");
});

test("Default extension persists only redacted local metadata when explicitly scoped", async () => fixture(async root => {
  const api = host();
  let appended;
  const persisted = new Promise(resolve => { appended = resolve; });
  const store = new EventStore({ baseDir: root });
  localObserverExtension(api, { store: { async append(event) { await store.append(event); appended(); } }, readHead: async () => "c".repeat(40), now: () => 20_000 });
  assert.equal(api.handlers.get("session_start")?.({}, context()), undefined);
  assert.equal(api.handlers.get("agent_start")?.({}, context()), undefined);
  const timeout = new AbortController();
  try { await Promise.race([persisted, delay(3_000, undefined, { signal: timeout.signal }).then(() => { throw new Error("event append did not settle"); })]); }
  finally { timeout.abort(); }
  const events = await readEventLines(root);
  assert.ok(events.length > 0);
  assert.ok(events.every(event => event.repo === "session-cwd" && event.authorization === undefined));
  api.handlers.get("session_shutdown")?.({}, context());
}));

test("Missing cwd is a fixed diagnostic and does not invoke the host reader", async () => {
  const diagnostics = [], api = host();
  let reads = 0;
  const observer = createLocalPiObserver({ store: { async append() { assert.fail("store-not-used"); } },
    readHead: async () => { reads++; return "a".repeat(40); },
    diagnose: code => diagnostics.push(code), now: () => 20_000 });
  observer.extension(api);
  const ctx = { hasUI: false, ui: context().ui };
  assert.equal(api.handlers.get("session_start")?.({}, ctx), undefined);
  assert.equal(api.handlers.get("agent_start")?.({}, ctx), undefined);
  await drain(observer);
  assert.deepEqual(diagnostics, ["local observer binding unavailable"]);
  assert.equal(reads, 0);
  assert.equal(observer.hostStatus().binding, "unavailable");
  assert.equal(observer.controller.status().authorization, "none");
});

test("A hanging HEAD reader times out visibly without blocking a native notification", async () => {
  const diagnostics = [], api = host();
  let reads = 0;
  const observer = createLocalPiObserver({ store: { async append() { assert.fail("store-not-used"); } },
    readHead: () => { reads++; return new Promise(() => {}); }, observerTimeoutMs: 10,
    diagnose: code => diagnostics.push(code), now: () => 20_000 });
  observer.extension(api);
  assert.equal(api.handlers.get("session_start")?.({}, context()), undefined);
  assert.equal(api.handlers.get("agent_start")?.({}, context()), undefined);
  await drain(observer);
  assert.equal(reads, 1);
  assert.deepEqual(diagnostics, ["local observer binding unavailable"]);
  assert.equal(observer.hostStatus().binding, "unavailable");
  assert.equal(observer.controller.status().authorization, "none");
});

test("Invalid or failed HEAD readers cannot report an observed binding", async () => {
  for (const readHead of [async () => "not-a-head", async () => { throw new Error("PRIVATE_READER_FAILURE"); }]) {
    const api = host(), diagnostics = [];
    const observer = createLocalPiObserver({ store: { async append() { assert.fail("store-not-used"); } }, readHead, diagnose: code => diagnostics.push(code) });
    observer.extension(api);
    api.handlers.get("session_start")?.({}, context());
    api.handlers.get("agent_start")?.({}, context());
    await drain(observer);
    assert.equal(observer.hostStatus().binding, "unavailable");
    assert.deepEqual(diagnostics, ["local observer binding unavailable"]);
  }
});

test("Command introspection faults do not disable the observer, but actual conflicts are diagnosed", async () => {
  for (const getCommands of [() => null, () => { throw new Error("PRIVATE_COMMAND_FAILURE"); }, () => []]) {
    const api = { ...host(), getCommands }, diagnostics = [];
    const observer = createLocalPiObserver({ store: { async append() {} }, readHead: async () => "a".repeat(40), diagnose: code => diagnostics.push(code) });
    observer.extension(api);
    assert.equal(observer.hostStatus().registration, "registered");
    assert.deepEqual(diagnostics, []);
    observer.controller.shutdown();
  }
  const api = { ...host(), getCommands: () => [{ name: "vista-status" }] }, diagnostics = [];
  const observer = createLocalPiObserver({ store: { async append() {} }, diagnose: code => diagnostics.push(code) });
  observer.extension(api);
  assert.equal(observer.hostStatus().registration, "unavailable");
  assert.equal(api.handlers.size, 0);
  assert.deepEqual(diagnostics, ["local observer registration unavailable"]);
});

test("A failed registration cleans up already-added notification handlers", () => {
  const api = host(), diagnostics = [];
  api.registerCommand = () => { throw new Error("PRIVATE_REGISTRATION_FAILURE"); };
  const observer = createLocalPiObserver({ store: { async append() {} }, diagnose: code => diagnostics.push(code) });
  observer.extension(api);
  assert.equal(observer.hostStatus().registration, "unavailable");
  assert.equal(api.handlers.size, 0);
  assert.equal(observer.controller.status().phase, "shutdown");
  assert.deepEqual(diagnostics, ["local observer registration unavailable"]);
});

test("Actual SDK-shaped cwd accessors are sampled once, while stale or throwing contexts fail-open", async () => {
  const api = host(), events = [], diagnostics = [];
  let cwdReads = 0;
  const observer = createLocalPiObserver({ store: { async append(event) { events.push(event); } },
    readHead: async value => { assert.equal(value, ROOT); return "d".repeat(40); }, diagnose: code => diagnostics.push(code) });
  observer.extension(api);
  const ctx = { get cwd() { cwdReads++; return ROOT; }, hasUI: false, ui: context().ui };
  assert.equal(api.handlers.get("session_start")?.({}, ctx), undefined);
  assert.equal(api.handlers.get("agent_start")?.({}, ctx), undefined);
  await drain(observer);
  assert.equal(cwdReads, 1);
  assert.equal(observer.hostStatus().binding, "session-cwd-observed");
  assert.ok(events.length > 0);
  const stale = { get cwd() { throw new Error("PRIVATE_STALE_CONTEXT"); } };
  assert.equal(api.handlers.get("session_start")?.({}, stale), undefined);
  assert.equal(observer.hostStatus().binding, "unavailable");
  assert.deepEqual(diagnostics, ["local observer binding unavailable"]);
  observer.controller.shutdown();
});

test("Late HEAD resolution from a replaced session cannot publish into its successor", async () => {
  const api = host(), diagnostics = [], events = [];
  let finishOld;
  const old = new Promise(resolve => { finishOld = resolve; });
  let reads = 0;
  const observer = createLocalPiObserver({ store: { async append(event) { events.push(event); } },
    readHead: () => ++reads === 1 ? old : Promise.resolve("b".repeat(40)), diagnose: code => diagnostics.push(code) });
  observer.extension(api);
  api.handlers.get("session_start")?.({}, context());
  api.handlers.get("agent_start")?.({}, context());
  while (reads === 0) await delay(1);
  api.handlers.get("session_start")?.({}, context());
  api.handlers.get("agent_start")?.({}, context());
  finishOld("a".repeat(40));
  await drain(observer);
  assert.equal(observer.hostStatus().binding, "session-cwd-observed");
  assert.ok(events.length > 0);
  assert.ok(events.every(event => event.source_sha === "b".repeat(40)));
  assert.deepEqual(diagnostics, []);
  api.handlers.get("session_shutdown")?.({}, context());
  assert.equal(observer.hostStatus().binding, "shutdown");
});

test("Default reader accepts a synthetic Git HEAD, not the runner's ambient cwd", async () => fixture(async root => {
  const env = { PATH: "/usr/bin:/bin", LC_ALL: "C", HOME: root, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_AUTHOR_NAME: "Synthetic", GIT_AUTHOR_EMAIL: "synthetic@example.invalid", GIT_COMMITTER_NAME: "Synthetic", GIT_COMMITTER_EMAIL: "synthetic@example.invalid" };
  await exec("/usr/bin/git", ["-c", "core.hooksPath=/dev/null", "init", "--initial-branch=main", root], { env });
  await exec("/usr/bin/git", ["-c", "core.hooksPath=/dev/null", "-c", "commit.gpgsign=false", "-C", root, "commit", "--allow-empty", "-m", "Synthetic fixture"], { env });
  const head = await readSessionHead(root);
  assert.match(head, /^(?:[a-fA-F0-9]{40}|[a-fA-F0-9]{64})$/u);
  await assert.rejects(readSessionHead(join(root, "missing")), /observer-binding-unavailable/u);
  await assert.rejects(readSessionHead(""), /observer-binding-unavailable/u);
  await assert.rejects(readSessionHead(root, join(root, "missing-git")), /observer-binding-unavailable/u);
}));
