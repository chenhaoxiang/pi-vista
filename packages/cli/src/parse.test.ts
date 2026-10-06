import { deepStrictEqual, rejects, strictEqual, throws } from "node:assert/strict";
import { test } from "node:test";
import { CheckpointStore, EventStore } from "@pi-vista/core";
import { CliError, MAX_ID_LENGTH, MAX_LIMIT, observe, parseArgs, runCli, type ObservationRequest } from "@pi-vista/cli";

const usage = (error: unknown): boolean => error instanceof CliError && error.code === "usage" && error.message === "invalid arguments";
const safeUsageResult = { exitCode: 2, stdout: "", stderr: "vista: invalid arguments. Use vista --help.\n" };
const privatePayload = "SYNTHETIC_PRIVATE_prefixghp_1234567890suffix";
const expectedRequest = (fields: object): object => Object.assign(Object.create(null) as object, fields);

async function withCoreReadSpies(check: (reads: string[]) => Promise<void>): Promise<void> {
  const { listRuns, readRun } = EventStore.prototype;
  const { listCheckpoints, load } = CheckpointStore.prototype;
  const reads: string[] = [];
  EventStore.prototype.listRuns = async () => { reads.push("listRuns"); return []; };
  EventStore.prototype.readRun = async () => { reads.push("readRun"); return []; };
  CheckpointStore.prototype.listCheckpoints = async () => { reads.push("listCheckpoints"); return []; };
  CheckpointStore.prototype.load = async () => { reads.push("load"); return null; };
  try { await check(reads); }
  finally {
    EventStore.prototype.listRuns = listRuns; EventStore.prototype.readRun = readRun;
    CheckpointStore.prototype.listCheckpoints = listCheckpoints; CheckpointStore.prototype.load = load;
  }
}

function throwingProxy(target: object, called: () => void): object {
  const handler: ProxyHandler<object> = {};
  for (const trap of ["getPrototypeOf", "setPrototypeOf", "isExtensible", "preventExtensions", "getOwnPropertyDescriptor", "defineProperty", "has", "get", "set", "deleteProperty", "ownKeys", "apply", "construct"] as const) {
    handler[trap] = () => { called(); throw new Error(privatePayload); };
  }
  return new Proxy(target, handler);
}

test("parseArgs accepts all four commands, common options on either side, and bound steps", () => {
  deepStrictEqual(parseArgs(["--json", "--base-dir", "relative-store", "history", "run-a", "--limit", "2"]), {
    kind: "observation", json: true, request: expectedRequest({ command: "history", runId: "run-a", baseDir: "relative-store", limit: 2 }),
  });
  deepStrictEqual(parseArgs(["history"]), { kind: "observation", json: false, request: expectedRequest({ command: "history" }) });
  deepStrictEqual(parseArgs(["inspect", "run-a", "--step", "run-a_s0"]), { kind: "observation", json: false, request: expectedRequest({ command: "inspect", runId: "run-a", stepId: "run-a_s0" }) });
  deepStrictEqual(parseArgs(["compare", "run-a", "run-b"]), { kind: "observation", json: false, request: expectedRequest({ command: "compare", runIdA: "run-a", runIdB: "run-b" }) });
  deepStrictEqual(parseArgs(["receipts", "run-a"]), { kind: "observation", json: false, request: expectedRequest({ command: "receipts", runId: "run-a" }) });
});

test("parseArgs information options do not create observation requests", () => {
  for (const args of [[], ["--help"], ["-h"], ["inspect", "--help"], ["--help", "compare"]]) deepStrictEqual(parseArgs(args), { kind: "help" });
  for (const args of [["--version"], ["receipts", "--version"]]) deepStrictEqual(parseArgs(args), { kind: "version" });
});

test("parseArgs rejects unknown, duplicate, missing, inappropriate and ambiguous options", () => {
  const invalid = [
    ["promote", "run-a"], ["inspect"], ["receipts"], ["compare", "run-a"], ["history", "run-a", "extra"],
    ["history", "--unknown"], ["history", "--json=true"], ["history", "--base-dir=store"], ["history", "--"],
    ["history", "--json", "--json"], ["history", "--base-dir", "a", "--base-dir", "b"],
    ["history", "--limit", "2", "--limit", "3"], ["inspect", "run-a", "--step", "run-a_s0", "--step", "run-a_s1"],
    ["history", "--step", "run-a_s0"], ["compare", "run-a", "run-b", "--step", "run-a_s0"],
    ["receipts", "run-a", "--step", "run-a_s0"], ["history", "--base-dir"], ["history", "--base-dir", ""],
    ["history", "--base-dir", "  "], ["history", "--base-dir", "bad\npath"], ["history", "--base-dir", "--json"],
    ["inspect", "run-a", "--step"], ["history", "--help", "--unknown"], ["--help", "--json"], ["--help", "--version"],
    ["--version", "run-a"], ["receipts", "run-a", "--json", "false"], ["--json"], [""],
  ];
  for (const args of invalid) throws(() => parseArgs(args), usage);
});

test("parseArgs limit grammar is exact and bounded", () => {
  for (const value of ["0", "-1", String(MAX_LIMIT + 1), "1.5", "NaN", "Infinity", "1e2", "01", " 1", "1 ", "undefined", "99999999999999999999"]) {
    throws(() => parseArgs(["history", "--limit", value]), usage);
  }
  for (const value of ["1", String(MAX_LIMIT)]) strictEqual(parseArgs(["history", "--limit", value]).kind, "observation");
});

test("parseArgs rejects traversal, unsafe and embedded-credential IDs without echoing them", async () => {
  const ids = [".", "..", "../escape", "nested/run", "nested\\run", "/synthetic/private", "C:\\synthetic", "bad id", "bad\u0000id", "-run", "a".repeat(MAX_ID_LENGTH + 1), "wrapghp_1234567890suffix", "wrapgithub_pat_1234567890suffix", "wrapsk-1234567890suffix", "wrapxoxb-1234567890suffix", "wrapAKIA1234567890ABCDEFsuffix"];
  for (const id of ids) {
    const args = ["inspect", id];
    throws(() => parseArgs(args), usage);
    deepStrictEqual(await runCli(args), { exitCode: 2, stdout: "", stderr: "vista: invalid arguments. Use vista --help.\n" });
    throws(() => parseArgs(["compare", "run-a", id]), usage);
  }
  for (const step of ["run-b_s0", "run-a_", "run-a", "../escape", "run-a_wrapgithub_pat_1234567890suffix"]) throws(() => parseArgs(["inspect", "run-a", "--step", step]), usage);
});

test("parseArgs rejects undefined, sparse arrays, non-string arguments and excess arguments", () => {
  for (const args of [undefined, null, {}, ["history", undefined], ["history", 1], new Array(1), Array(33).fill("history")]) {
    throws(() => parseArgs(args as readonly string[]), usage);
  }
});

test("observe rejects explicitly undefined structured options and illegal API keys before reading", async () => {
  const requests: unknown[] = [
    { command: "history", runId: undefined }, { command: "history", baseDir: undefined }, { command: "history", limit: undefined },
    { command: "inspect", runId: "run-a", stepId: undefined }, { command: "compare", runIdA: "run-a", runIdB: undefined },
    { command: "history", json: true }, { command: "receipts", runId: "run-a", stepId: "run-a_s0" },
    { command: "history", limit: MAX_LIMIT + 1 }, { command: "history", limit: NaN }, { command: "history", limit: 1.5 },
    { command: "history", baseDir: "" }, { command: "inspect", runId: "run-a", stepId: "run-b_s0" },
    { command: "history", runId: "wrapgithub_pat_1234567890suffix" }, null, undefined,
    Object.assign(Object.create({ runId: "run-a" }) as object, { command: "inspect" }),
    { command: "history", [Symbol("private")]: true },
  ];
  const getter = Object.defineProperty({ command: "history" }, "baseDir", { get: () => { throw new Error("must not invoke input getter"); }, enumerable: true });
  requests.push(getter);
  await withCoreReadSpies(async (reads) => {
    for (const request of requests) await rejects(() => observe(request as ObservationRequest), usage);
    strictEqual(reads.length, 0);
  });
});

test("observe rejects request Proxy TOCTOU without any get or store read", async () => {
  let getCalls = 0;
  let runIdReads = 0;
  const source = new Proxy({ command: "history", runId: "run-a", baseDir: "synthetic-unused" }, {
    get(target, key, receiver) {
      getCalls += 1;
      if (key === "runId") return ++runIdReads === 1 ? "run-a" : privatePayload;
      return Reflect.get(target, key, receiver);
    },
  });
  await withCoreReadSpies(async (reads) => {
    await rejects(() => observe(source as ObservationRequest), usage);
    strictEqual(reads.length, 0);
  });
  strictEqual(getCalls, 0);
  strictEqual(runIdReads, 0);
});

test("observe rejects throwing Proxy traps, Proxy handlers and revoked proxies without invoking them", async () => {
  let trapCalls = 0;
  const called = () => { trapCalls += 1; };
  const revoked = Proxy.revocable({ command: "history" }, {});
  revoked.revoke();
  const requests = [
    throwingProxy({ command: "history", runId: "run-a" }, called),
    throwingProxy([], called),
    throwingProxy(() => {}, called),
    new Proxy({ command: "history" }, throwingProxy({}, called)),
    revoked.proxy,
  ];
  await withCoreReadSpies(async (reads) => {
    for (const input of requests) await rejects(() => observe(input as ObservationRequest), usage);
    strictEqual(reads.length, 0);
  });
  strictEqual(trapCalls, 0);
});

test("observe rejects custom prototypes and own accessors without reading getters or thenables", async () => {
  let calls = 0;
  const fail = () => { calls += 1; throw new Error(privatePayload); };
  const prototype = Object.create(null) as object;
  Object.defineProperty(prototype, "command", { get: fail });
  const requests: unknown[] = [Object.create(prototype), Object.create(throwingProxy({}, fail))];
  for (const key of ["command", "runId", "baseDir", "limit", "stepId", "runIdA", "runIdB", "then", "unknown"]) {
    requests.push(Object.defineProperty({ command: "history" }, key, { get: fail }));
  }
  const coercible = Object.defineProperties({}, {
    then: { get: fail }, toString: { get: fail }, valueOf: { get: fail }, [Symbol.toPrimitive]: { get: fail },
  });
  requests.push({ command: coercible }, { command: "history", runId: coercible }, { command: "history", baseDir: coercible }, { command: "history", limit: coercible });
  for (const key of ["command", "runId", "baseDir", "limit"]) requests.push({ command: "history", [key]: throwingProxy({}, fail) });
  await withCoreReadSpies(async (reads) => {
    for (const request of requests) await rejects(() => observe(request as ObservationRequest), usage);
    strictEqual(reads.length, 0);
  });
  strictEqual(calls, 0);
});

test("input-field Object.prototype data/getter pollution is ignored without source getters or inherited validation", async () => {
  const fields = ["command", "runId", "runIdA", "runIdB", "stepId", "baseDir", "limit"];
  const saved = new Map(fields.map((key) => [key, Object.getOwnPropertyDescriptor(Object.prototype, key)]));
  let getterCalls = 0;
  await withCoreReadSpies(async (reads) => {
    for (const mode of ["data", "getter"] as const) {
      try {
        for (const key of fields) Object.defineProperty(Object.prototype, key, mode === "data"
          ? { value: privatePayload, writable: true, configurable: true }
          : { get: () => { getterCalls += 1; throw new Error(privatePayload); }, configurable: true });
        const parsed = parseArgs(["history"]);
        strictEqual(parsed.kind, "observation");
        if (parsed.kind !== "observation") throw new Error("unexpected parsed command");
        strictEqual(Object.getPrototypeOf(parsed.request), null);
        for (const key of fields.filter((key) => key !== "command")) {
          strictEqual(Object.hasOwn(parsed.request, key), false);
          strictEqual((parsed.request as unknown as Record<string, unknown>)[key], undefined);
        }
        const before = reads.length;
        await rejects(() => observe({} as ObservationRequest), usage);
        await rejects(() => observe({ command: "inspect" } as ObservationRequest), usage);
        await rejects(() => observe({ command: "compare", runIdA: "run-a" } as ObservationRequest), usage);
        strictEqual(reads.length, before);
        const inventory = await observe({ command: "history" });
        strictEqual(inventory.command, "history");
        if (inventory.command !== "history") throw new Error("unexpected view");
        strictEqual(inventory.mode, "inventory");
        const inspect = await observe({ command: "inspect", runId: "run-a", baseDir: "synthetic-unused" });
        strictEqual(inspect.command, "inspect");
        deepStrictEqual(reads.slice(before), ["listRuns", "readRun", "listCheckpoints"]);
      } finally {
        for (const key of fields) {
          const descriptor = saved.get(key);
          if (descriptor === undefined) Reflect.deleteProperty(Object.prototype, key);
          else Object.defineProperty(Object.prototype, key, descriptor);
        }
      }
    }
    strictEqual(reads.length, 6);
  });
  strictEqual(getterCalls, 0);
});

test("observe accepts detached own non-enumerable data and frozen ordinary or null-prototype requests", async () => {
  await withCoreReadSpies(async (reads) => {
    for (const prototype of [Object.prototype, null]) {
      const input = Object.create(prototype) as ObservationRequest;
      Object.defineProperties(input, {
        command: { value: "inspect" }, runId: { value: "run-a" }, stepId: { value: "run-a_s0" },
        baseDir: { value: "synthetic-unused" }, limit: { value: 1 },
      });
      const view = await observe(Object.freeze(input));
      strictEqual(view.command, "inspect");
      if (view.command !== "inspect") throw new Error("unexpected view");
      strictEqual(view.run_id, "run-a"); strictEqual(view.step_id, "run-a_s0");
    }
    deepStrictEqual(reads, ["readRun", "load", "readRun", "load"]);
  });
});

test("observe rejects own symbols, non-enumerable unknown fields and present undefined before all store readers", async () => {
  const inputs = [
    Object.defineProperty({ command: "history" }, Symbol("private"), { value: privatePayload }),
    Object.defineProperty({ command: "history" }, "unknown", { value: privatePayload }),
    Object.defineProperty({ command: "history" }, "baseDir", { value: undefined }),
    Object.defineProperty({ command: "history" }, "command", { value: undefined }),
  ];
  await withCoreReadSpies(async (reads) => {
    for (const input of inputs) await rejects(() => observe(input as ObservationRequest), usage);
    strictEqual(reads.length, 0);
  });
});

test("parseArgs rejects element/method accessors and coercible elements without invoking user code", async () => {
  let calls = 0;
  const fail = () => { calls += 1; throw new Error(privatePayload); };
  const accessor = Object.defineProperty(["history", "run-a"], "1", { get: fail });
  const filter = Object.defineProperty(["history"], "filter", { get: fail });
  const iterator = Object.defineProperty(["history"], Symbol.iterator, { get: fail });
  const then = Object.defineProperty(["history"], "then", { get: fail });
  const setter = Object.defineProperty(["history"], "0", { set: fail });
  const element = Object.defineProperties({}, { then: { get: fail }, toString: { get: fail }, [Symbol.toPrimitive]: { get: fail } });
  const fakeArray = Object.defineProperty({ 0: "history" }, "length", { get: fail });
  await withCoreReadSpies(async (reads) => {
    for (const input of [accessor, filter, iterator, then, setter, fakeArray, [element], ["history", element], [throwingProxy({}, fail)]]) {
      const args = input as unknown as readonly string[];
      throws(() => parseArgs(args), usage);
      deepStrictEqual(await runCli(args), safeUsageResult);
    }
    strictEqual(reads.length, 0);
  });
  strictEqual(calls, 0);
});

test("parseArgs and runCli reject Proxy get/length/iterator, throwing traps and revoked arrays with zero calls", async () => {
  let gets = 0; let lengthReads = 0; let iteratorReads = 0; let traps = 0;
  const getProxy = new Proxy(["history"], { get(target, key, receiver) {
    gets += 1;
    if (key === "length") lengthReads += 1;
    if (key === Symbol.iterator) iteratorReads += 1;
    return Reflect.get(target, key, receiver);
  } });
  const revoked = Proxy.revocable(["history"], {}); revoked.revoke();
  const inputs = [getProxy, throwingProxy(["history"], () => { traps += 1; }), new Proxy(["history"], throwingProxy({}, () => { traps += 1; })), revoked.proxy];
  await withCoreReadSpies(async (reads) => {
    for (const input of inputs) {
      const args = input as readonly string[];
      throws(() => parseArgs(args), usage);
      deepStrictEqual(await runCli(args), safeUsageResult);
    }
    strictEqual(reads.length, 0);
  });
  deepStrictEqual([gets, lengthReads, iteratorReads, traps], [0, 0, 0, 0]);
});

test("parseArgs rejects holes, symbols, extra data keys and custom prototypes as fixed usage", async () => {
  let getters = 0; let traps = 0;
  const prototype = Object.create(Array.prototype) as object;
  Object.defineProperty(prototype, "0", { get: () => { getters += 1; throw new Error(privatePayload); } });
  const customPrototype = Object.setPrototypeOf(new Array(1), prototype);
  const proxyPrototype = Object.setPrototypeOf(["history"], throwingProxy(Array.prototype, () => { traps += 1; }));
  const symbol = Object.defineProperty(["history"], Symbol("private"), { value: privatePayload });
  const key = Object.defineProperty(["history"], "private", { value: privatePayload });
  const nonIndex = Object.defineProperty(["history"], "01", { value: "run-a" });
  const holeWithKey = Object.defineProperty(new Array(1), "private", { value: privatePayload });
  const inputs = [new Array(1), ["history", , "run-a"], symbol, key, nonIndex, holeWithKey, customPrototype, proxyPrototype, Object.setPrototypeOf(["history"], null), { 0: "history", length: 1 }];
  await withCoreReadSpies(async (reads) => {
    for (const input of inputs) {
      const args = input as readonly string[];
      throws(() => parseArgs(args), usage);
      deepStrictEqual(await runCli(args), safeUsageResult);
    }
    strictEqual(reads.length, 0);
  });
  strictEqual(getters, 0); strictEqual(traps, 0);
});

test("parseArgs accepts frozen and non-enumerable dense data arrays, detached from later input mutation", () => {
  const fields = ["inspect", "run-a", "--step", "run-a_s0", "--base-dir", "synthetic-unused", "--limit", "1"];
  const expected = parseArgs(fields);
  const frozen = Object.freeze([...fields]);
  deepStrictEqual(parseArgs(frozen), expected);
  const nonEnumerable = [...fields];
  for (let index = 0; index < fields.length; index += 1) Object.defineProperty(nonEnumerable, String(index), { enumerable: false });
  deepStrictEqual(parseArgs(nonEnumerable), expected);
  const parsed = parseArgs(fields);
  fields[0] = "receipts"; fields[1] = privatePayload;
  fields.length = 0;
  deepStrictEqual(parsed, expected);
});
