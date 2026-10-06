import { deepStrictEqual, match, rejects, strictEqual, throws } from "node:assert/strict";
import { test } from "node:test";
import type { CheckFunctionType, VistaCheckFunction } from "@pi-vista/protocol";
import {
  CheckError, CheckRegistry, DEFAULT_TIMEOUT_MS, MAX_CHECKS, MAX_DESCRIPTION_LENGTH,
  MAX_HANDLERS, MAX_LABEL_LENGTH, MAX_PARAM_KEY_LENGTH, MAX_PARAMS, MAX_TIMEOUT_MS,
  type CheckContext, type CheckErrorCode, type CheckHandler, type CheckInvocation,
  type CheckReport, type CheckRunOptions,
} from "@pi-vista/checks";

const shaA = "a".repeat(40);
const shaB = "b".repeat(40);
const custom = "custom:synthetic/predicate";

function definition(id = "check-a", on_fail: "STOP" | "WARN" | "REPAIR" = "STOP", type: CheckFunctionType = custom): VistaCheckFunction {
  return { check_id: id, type, params: {}, on_fail };
}

function fixedError(code: CheckErrorCode): (error: unknown) => boolean {
  return (error) => {
    strictEqual(error instanceof CheckError, true);
    const checkError = error as CheckError;
    strictEqual(checkError.code, code);
    strictEqual(checkError.stack, `CheckError: ${checkError.message}`);
    strictEqual(checkError.message.includes("synthetic-private"), false);
    return true;
  };
}

function contract(report: CheckReport, satisfied: boolean): void {
  strictEqual(report.verification, "predicate-only");
  strictEqual(report.authorization, "none");
  strictEqual(report.satisfied, satisfied);
  strictEqual(Object.isFrozen(report), true);
  strictEqual(Object.isFrozen(report.results), true);
  for (const result of report.results) strictEqual(Object.isFrozen(result), true);
}

function statuses(report: CheckReport): string[] { return report.results.map((item) => `${item.status}:${item.reason}`); }
function unsafeDefinitions(value: unknown): readonly VistaCheckFunction[] { return value as readonly VistaCheckFunction[]; }
function unsafeHandler(value: unknown): CheckHandler { return value as CheckHandler; }
function delay(ms: number): Promise<void> { return new Promise((resolve) => setTimeout(resolve, ms)); }

async function invalidRun(definitions: unknown, context: unknown = {}, options: unknown = {}, code: CheckErrorCode = "invalid-input"): Promise<void> {
  let calls = 0;
  const registry = new CheckRegistry();
  registry.register(custom, () => { calls += 1; return true; });
  await rejects(registry.run(unsafeDefinitions(definitions), context as CheckContext, options as CheckRunOptions), fixedError(code));
  strictEqual(calls, 0, "the entire input must validate before any handler");
}

function watchedProxy<T extends object>(value: T, observe: () => void): T {
  return new Proxy(value, {
    get() { observe(); throw new Error("synthetic-private get"); },
    getPrototypeOf() { observe(); throw new Error("synthetic-private prototype"); },
    ownKeys() { observe(); throw new Error("synthetic-private keys"); },
    getOwnPropertyDescriptor() { observe(); throw new Error("synthetic-private descriptor"); },
    has() { observe(); throw new Error("synthetic-private has"); },
    apply() { observe(); throw new Error("synthetic-private apply"); },
  });
}

test("CheckRegistry genuine true/false predicates run in order and STOP skips remaining callbacks", async () => {
  const calls: string[] = [];
  const registry = new CheckRegistry();
  registry.register(custom, ({ definition: check }) => { calls.push(check.check_id); return check.check_id !== "check-b"; });
  const report = await registry.run([definition(), definition("check-b"), definition("check-c")]);
  contract(report, false);
  deepStrictEqual(calls, ["check-a", "check-b"]);
  deepStrictEqual(statuses(report), ["passed:predicate-true", "failed:predicate-false", "skipped:stopped"]);
  deepStrictEqual(report.results.map((item) => item.check_id), ["check-a", "check-b", "check-c"]);
});

test("CheckRegistry WARN continues but never makes a false predicate satisfied", async () => {
  const calls: string[] = [];
  const registry = new CheckRegistry();
  registry.register(custom, ({ definition: check }) => { calls.push(check.check_id); return check.check_id !== "check-a"; });
  const report = await registry.run([definition("check-a", "WARN"), definition("check-b")]);
  contract(report, false);
  deepStrictEqual(statuses(report), ["warning:predicate-false", "passed:predicate-true"]);
  deepStrictEqual(calls, ["check-a", "check-b"]);
});

test("CheckRegistry all passing predicates grant no authorization or promotion", async () => {
  const registry = new CheckRegistry();
  registry.register(custom, async () => true);
  const report = await registry.run([definition("check-a", "WARN"), definition("check-b")]);
  contract(report, true);
  deepStrictEqual(statuses(report), ["passed:predicate-true", "passed:predicate-true"]);
  deepStrictEqual(Object.keys(report).sort(), ["authorization", "results", "satisfied", "verification"]);
});

test("CheckRegistry has no default implementations, including claimed receipt/test/path checks", async () => {
  const registry = new CheckRegistry();
  const types: CheckFunctionType[] = ["sha_matches", "env_matches", "receipt_present", "test_passed", "path_exists", "path_not_exists", "branch_exists", "branch_not_exists", "worktree_clean", "file_contains", custom];
  const report = await registry.run(types.map((type, index) => definition(`check-${index}`, "WARN", type)));
  contract(report, false);
  strictEqual(report.results.every((item) => item.status === "failed" && item.reason === "missing-handler"), true);
});

test("CheckRegistry missing handler preflight calls nothing even after a registered definition", async () => {
  let calls = 0;
  const registry = new CheckRegistry();
  registry.register(custom, () => { calls += 1; return true; });
  const report = await registry.run([definition(), definition("check-b", "WARN", "receipt_present"), definition("check-c")]);
  contract(report, false);
  deepStrictEqual(statuses(report), ["skipped:preflight-rejected", "failed:missing-handler", "skipped:preflight-rejected"]);
  strictEqual(calls, 0);
});

test("CheckRegistry unknown types and unsafe custom namespaces fail closed before callbacks", async () => {
  for (const type of ["unknown", "custom:", "custom:/tmp/private", "custom:../escape", "custom:host//probe", "custom:host/../probe", "custom:git", "custom:curl", "custom:pwd", "custom:whoami", "custom:rm", "custom:cat", "custom:bash", "custom:probe;exec", "custom:prefixghp_1234567890suffix"]) {
    await invalidRun([definition(), { ...definition("check-b"), type }]);
    throws(() => new CheckRegistry().register(type as CheckFunctionType, () => true), fixedError("invalid-registration"));
  }
});

test("CheckRegistry duplicate registration cannot overwrite the original trusted callback", async () => {
  const registry = new CheckRegistry();
  registry.register(custom, () => false);
  throws(() => registry.register(custom, () => true), fixedError("duplicate-registration"));
  deepStrictEqual(statuses(await registry.run([definition()])), ["failed:predicate-false"]);
});

test("CheckRegistry rejects nonfunctions and Proxy handlers without invocation", () => {
  let traps = 0;
  const proxy = watchedProxy(() => true, () => { traps += 1; });
  for (const handler of [undefined, null, true, "synthetic-private code", {}, proxy]) {
    throws(() => new CheckRegistry().register(custom, unsafeHandler(handler)), fixedError("invalid-registration"));
  }
  strictEqual(traps, 0);
});

test("CheckRegistry bound registration count and deterministic duplicate errors at capacity", async () => {
  const registry = new CheckRegistry();
  for (let index = 0; index < MAX_HANDLERS; index += 1) registry.register(`custom:synthetic-${index}`, () => true);
  throws(() => registry.register("custom:overflow", () => true), fixedError("invalid-registration"));
  throws(() => registry.register("custom:synthetic-0", () => false), fixedError("duplicate-registration"));
  contract(await registry.run([definition("check-a", "STOP", "custom:synthetic-0")]), true);
});

test("CheckRegistry REPAIR is unsupported anywhere before any callback, regardless of repair ID", async () => {
  for (const repair_action_id of [undefined, "repair-synthetic"]) {
    const repair = definition("check-b", "REPAIR");
    if (repair_action_id !== undefined) repair.repair_action_id = repair_action_id;
    await invalidRun([definition(), repair], {}, {}, "unsupported-repair");
  }
});

test("CheckRegistry STOP/WARN repair IDs are opaque and never resolved or executed", async () => {
  let calls = 0;
  const registry = new CheckRegistry();
  registry.register(custom, () => { calls += 1; return false; });
  const report = await registry.run([{ ...definition("check-a", "WARN"), repair_action_id: "repair-synthetic" }, { ...definition("check-b"), repair_action_id: "repair-synthetic" }]);
  strictEqual(calls, 2);
  contract(report, false);
  deepStrictEqual(statuses(report), ["warning:predicate-false", "failed:predicate-false"]);
  strictEqual(JSON.stringify(report).includes("repair-synthetic"), false);
});

test("binding predicates are opt-in and atomically reject duplicates without partial registration", async () => {
  const registry = new CheckRegistry();
  registry.register("env_matches", () => false);
  throws(() => registry.registerBindingPredicates(), fixedError("duplicate-registration"));
  const report = await registry.run([definition("check-a", "WARN", "sha_matches")]);
  deepStrictEqual(statuses(report), ["failed:missing-handler"]);
  deepStrictEqual(statuses(await registry.run([definition("check-a", "STOP", "env_matches")])), ["failed:predicate-false"]);
  const second = new CheckRegistry();
  second.registerBindingPredicates();
  throws(() => second.registerBindingPredicates(), fixedError("duplicate-registration"));
  const full = new CheckRegistry();
  for (let index = 0; index < MAX_HANDLERS - 1; index += 1) full.register(`custom:synthetic-${index}`, () => true);
  throws(() => full.registerBindingPredicates(), fixedError("invalid-registration"));
  deepStrictEqual(statuses(await full.run([definition("check-a", "STOP", "sha_matches")])), ["failed:missing-handler"]);
});

test("sha_matches compares actual 40/64 hex labels case-insensitively and fails mismatch", async () => {
  const registry = new CheckRegistry();
  registry.registerBindingPredicates();
  for (const sha of [shaA, "c".repeat(64)]) {
    const check = { ...definition("sha-binding", "STOP", "sha_matches"), params: { expected: sha.toUpperCase(), actual: "{sha}" } };
    contract(await registry.run([check], { sha }), true);
    const mismatch = await registry.run([{ ...check, params: { expected: sha, actual: "d".repeat(sha.length) } }]);
    contract(mismatch, false);
    deepStrictEqual(statuses(mismatch), ["failed:predicate-false"]);
  }
});

test("sha_matches never treats malformed SHA, missing comparison or extra params as a pass", async () => {
  const registry = new CheckRegistry();
  registry.registerBindingPredicates();
  for (const params of [
    { expected: "a".repeat(39), actual: "a".repeat(39) },
    { expected: "g".repeat(40), actual: "g".repeat(40) },
    { expected: shaA, actual: "a".repeat(64) },
    { expected: shaA }, {},
    { expected: shaA, actual: shaA, extra: "label" },
  ]) {
    const report = await registry.run([{ ...definition("sha-binding", "WARN", "sha_matches"), params }]);
    contract(report, false);
    deepStrictEqual(statuses(report), ["warning:predicate-false"]);
  }
});

test("env_matches uses safe opaque expected/actual labels with exact equality only", async () => {
  const registry = new CheckRegistry();
  registry.registerBindingPredicates();
  for (const [expected, actual, satisfied] of [["sandbox-1", "sandbox-1", true], ["Sandbox-1", "sandbox-1", false], ["sandbox-1", "sandbox-2", false]] as const) {
    const report = await registry.run([{ ...definition("env-binding", "STOP", "env_matches"), params: { expected, actual } }]);
    contract(report, satisfied);
  }
  for (const params of [{}, { expected: "sandbox-1" }, { expected: "sandbox-1", actual: "sandbox-1", extra: "label" }]) {
    contract(await registry.run([{ ...definition("env-binding", "STOP", "env_matches"), params }]), false);
  }
});

test("binding predicates evaluate anew across contexts and repeated runs, without cached pass", async () => {
  const registry = new CheckRegistry();
  registry.registerBindingPredicates();
  const check = { ...definition("sha-binding", "STOP", "sha_matches"), params: { expected: shaA, actual: "{sha}" } };
  contract(await registry.run([check], { sha: shaA }), true);
  contract(await registry.run([check], { sha: shaB }), false);
  contract(await registry.run([check], { sha: shaA }), true);
  let calls = 0;
  registry.register(custom, () => { calls += 1; return calls === 1; });
  contract(await registry.run([definition()]), true);
  contract(await registry.run([definition()]), false);
  strictEqual(calls, 2);
});

test("CheckRegistry only whole-value repo/task/branch/sha placeholders bind safe host labels", async () => {
  const context = { repo: "repo-synthetic", task: "task-1", branch: "branch-1", sha: shaA };
  let calls = 0;
  const registry = new CheckRegistry();
  registry.register(custom, ({ definition: check, context: snapshot }) => {
    calls += 1;
    deepStrictEqual({ ...check.params }, context);
    deepStrictEqual({ ...snapshot }, context);
    return true;
  });
  const params = { repo: "{repo}", task: "{task}", branch: "{branch}", sha: "{sha}" };
  contract(await registry.run([{ ...definition(), params }], context), true);
  deepStrictEqual(params, { repo: "{repo}", task: "{task}", branch: "{branch}", sha: "{sha}" });
  strictEqual(calls, 1);
});

test("CheckRegistry rejects missing, unknown, partial and repeated placeholders before callbacks", async () => {
  for (const actual of ["{repo}", "{task}", "{branch}", "{sha}", "{unknown}", "prefix-{repo}", "{repo}-suffix", "{repo}{repo}", "{{repo}}", "${repo}", "{repo", "repo}"]) {
    await invalidRun([definition(), { ...definition("check-b"), params: { actual } }]);
  }
});

test("CheckRegistry rejects unsafe direct and post-binding labels, no shell/path interpolation", async () => {
  const unsafe = ["", "/tmp/synthetic-private", "../private", "relative/private", "C:\\private", "https://invalid.example", "foo bar", "rm", "git", "pwd", "whoami", "cat", "curl", "bash", "node -e code", "x;exec", "$(exec)", "x\ny", "x\u0000y", "x\u202ey", "prefixghp_1234567890suffix", "prefixgithub_pat_1234567890suffix", "prefixsk-1234567890suffix", "xoxb-1234567890", "AKIAABCDEFGHIJKLMNOP", "token=synthetic", "__proto__", "constructor", "prototype", "x".repeat(MAX_LABEL_LENGTH + 1)];
  for (const actual of unsafe) {
    await invalidRun([{ ...definition(), params: { actual } }]);
    await invalidRun([{ ...definition(), params: { actual: "{repo}" } }], { repo: actual });
  }
  for (const sha of ["a".repeat(39), "g".repeat(40), "a".repeat(65)]) await invalidRun([definition()], { sha });
});

test("CheckRegistry definitions are closed own-data, duplicate IDs and optional undefined reject", async () => {
  for (const bad of [
    null, [], new Date(), Object.create({ check_id: "check-b" }),
    { ...definition("check-b"), extra: "synthetic-private" },
    { ...definition("check-b"), [Symbol("extra")]: true },
    { ...definition("check-b"), check_id: "/tmp/synthetic-private" },
    { ...definition("check-b"), on_fail: "PASS" },
    { ...definition("check-b"), description: undefined },
    { ...definition("check-b"), repair_action_id: undefined },
    { ...definition("check-b"), repair_action_id: "rm -rf private" },
    { ...definition("check-b"), description: "x".repeat(MAX_DESCRIPTION_LENGTH + 1) },
    { ...definition("check-b"), description: "synthetic-private /tmp/private" },
  ]) await invalidRun([definition(), bad]);
  await invalidRun([definition(), definition()]);
  for (const key of ["check_id", "type", "params", "on_fail"]) {
    const bad = { ...definition("check-b") } as Record<string, unknown>;
    delete bad[key];
    await invalidRun([definition(), bad]);
  }
});

test("CheckRegistry params reject hostile nested values and unsafe or overlong keys", async () => {
  for (const params of [
    null, [], new Date(), Object.create({ actual: "label" }),
    { actual: undefined }, { actual: true }, { actual: 1 }, { actual: {} }, { actual: [] },
    { [Symbol("extra")]: "label" }, { constructor: "label" }, { prototype: "label" },
    Object.fromEntries([["__proto__", "label"]]),
    { secret: "label" }, { raw_command: "label" }, { private_path: "label" },
    { "bad-key": "label" }, { ["a".repeat(MAX_PARAM_KEY_LENGTH + 1)]: "label" },
    Object.fromEntries(Array.from({ length: MAX_PARAMS + 1 }, (_, index) => [`p${index}`, "label"])),
  ]) await invalidRun([definition(), { ...definition("check-b"), params }]);
});

test("CheckRegistry contexts/options reject unknown fields, symbols, prototypes and bad limits", async () => {
  for (const context of [null, [], new Date(), Object.create({ repo: "label" }), { extra: "label" }, { repo: undefined }, { repo: 1 }, { [Symbol("extra")]: "label" }]) {
    await invalidRun([definition()], context);
  }
  for (const options of [null, [], new Date(), Object.create({ timeoutMs: 1 }), { extra: 1 }, { timeoutMs: undefined }, { [Symbol("extra")]: 1 }, ...[0, -1, 1.5, Infinity, NaN, MAX_TIMEOUT_MS + 1, "1", null].map((timeoutMs) => ({ timeoutMs }))]) {
    await invalidRun([definition()], {}, options);
  }
  strictEqual(DEFAULT_TIMEOUT_MS <= MAX_TIMEOUT_MS, true);
});

test("CheckRegistry all array holes/extras/accessors/symbols/custom prototypes reject without reading", async () => {
  let reads = 0;
  const accessor: unknown[] = [definition()];
  Object.defineProperty(accessor, "0", { get() { reads += 1; throw new Error("synthetic-private"); } });
  const customPrototype = [definition()]; Object.setPrototypeOf(customPrototype, Object.create(Array.prototype));
  const extras = Object.assign([definition()], { extra: "label" });
  const symbol = [definition()]; Object.defineProperty(symbol, Symbol.iterator, { get() { reads += 1; throw new Error("synthetic-private"); } });
  const iterator = [definition()]; Object.defineProperty(iterator, "values", { get() { reads += 1; throw new Error("synthetic-private"); } });
  for (const input of [null, {}, [], Array(1), [definition(), , definition("check-c")], accessor, customPrototype, extras, symbol, iterator, Array.from({ length: MAX_CHECKS + 1 }, (_, index) => definition(`check-${index}`))]) await invalidRun(input);
  strictEqual(reads, 0);
});

test("CheckRegistry rejects Node Proxies, including revoked ones, at every seam with zero traps/calls", async () => {
  let traps = 0;
  const observe = () => { traps += 1; };
  await invalidRun(watchedProxy([definition()], observe));
  await invalidRun([definition(), watchedProxy(definition("check-b"), observe)]);
  await invalidRun([{ ...definition(), params: watchedProxy({ actual: "label" }, observe) }]);
  await invalidRun([definition()], watchedProxy({ repo: "label" }, observe));
  await invalidRun([definition()], {}, watchedProxy({ timeoutMs: 1 }, observe));
  for (const seam of ["array", "definition", "params", "context", "options"]) {
    const revoked = Proxy.revocable({}, {}); revoked.revoke();
    await invalidRun(seam === "array" ? revoked.proxy : seam === "definition" ? [revoked.proxy] : seam === "params" ? [{ ...definition(), params: revoked.proxy }] : [definition()], seam === "context" ? revoked.proxy : {}, seam === "options" ? revoked.proxy : {});
  }
  strictEqual(traps, 0);
});

test("CheckRegistry accessors and coercion hooks on definitions/params/context/options never execute", async () => {
  let reads = 0;
  const getter = () => { reads += 1; throw new Error("synthetic-private"); };
  for (const seam of ["definition", "params", "context", "options"]) {
    const input = seam === "definition" ? definition("check-b") : {};
    Object.defineProperty(input, seam === "definition" ? "type" : seam === "params" ? "actual" : seam === "context" ? "repo" : "timeoutMs", { get: getter });
    await invalidRun(seam === "definition" ? [definition(), input] : seam === "params" ? [{ ...definition(), params: input }] : [definition()], seam === "context" ? input : {}, seam === "options" ? input : {});
  }
  const coercible = { toString: getter, valueOf: getter, [Symbol.toPrimitive]: getter };
  await invalidRun([{ ...definition(), params: { actual: coercible } }]);
  await invalidRun([definition()], { repo: coercible });
  await invalidRun([definition()], {}, { timeoutMs: coercible });
  strictEqual(reads, 0);
});

test("CheckRegistry every definition/context data field accessor rejects without executing", async () => {
  let reads = 0;
  const getter = () => { reads += 1; throw new Error("synthetic-private"); };
  for (const key of ["check_id", "type", "params", "on_fail", "description", "repair_action_id", "unknown"]) {
    const check = definition("check-b");
    Object.defineProperty(check, key, { get: getter, configurable: true });
    await invalidRun([definition(), check]);
  }
  for (const key of ["repo", "task", "branch", "sha", "unknown"]) {
    await invalidRun([definition()], Object.defineProperty({}, key, { get: getter }));
  }
  strictEqual(reads, 0);
});

test("CheckRegistry Proxy/symbol/function scalar fields reject with no coercion or source traps", async () => {
  let traps = 0;
  const proxy = watchedProxy({}, () => { traps += 1; });
  for (const value of [proxy, Symbol("synthetic"), () => "synthetic"]) {
    await invalidRun([{ ...definition(), check_id: value }]);
    await invalidRun([{ ...definition(), type: value }]);
    await invalidRun([{ ...definition(), params: { actual: value } }]);
    await invalidRun([definition()], { repo: value });
    await invalidRun([definition()], {}, { timeoutMs: value });
  }
  strictEqual(traps, 0);
});

test("CheckRegistry accepts frozen dense non-enumerable own data and null-prototype records", async () => {
  const registry = new CheckRegistry();
  registry.register(custom, ({ definition: check, context }) => {
    strictEqual(check.params.actual, "repo-synthetic");
    strictEqual(context.repo, "repo-synthetic");
    return true;
  });
  const params = Object.create(null);
  Object.defineProperty(params, "actual", { value: "{repo}" });
  const check = Object.create(null);
  for (const [key, value] of Object.entries({ ...definition(), params, description: "Synthetic comparison" })) Object.defineProperty(check, key, { value });
  const definitions: VistaCheckFunction[] = [];
  Object.defineProperty(definitions, "0", { value: check, writable: false, enumerable: false });
  const context = Object.create(null); Object.defineProperty(context, "repo", { value: "repo-synthetic" });
  const options = Object.create(null); Object.defineProperty(options, "timeoutMs", { value: 1_000 });
  contract(await registry.run(Object.freeze(definitions), Object.freeze(context), Object.freeze(options)), true);
});

test("CheckRegistry inherited optional-field pollution is ignored and snapshots have no prototype", async () => {
  let reads = 0;
  for (const key of ["description", "repair_action_id", "repo", "timeoutMs"]) Object.defineProperty(Object.prototype, key, { configurable: true, get() { reads += 1; throw new Error("synthetic-private inherited"); } });
  try {
    const registry = new CheckRegistry();
    registry.register(custom, ({ definition: check, context }) => {
      strictEqual(Object.getPrototypeOf(check), null);
      strictEqual(Object.getPrototypeOf(check.params), null);
      strictEqual(Object.getPrototypeOf(context), null);
      strictEqual(check.description, undefined);
      strictEqual(check.repair_action_id, undefined);
      strictEqual(context.repo, undefined);
      return true;
    });
    contract(await registry.run([definition()]), true);
    await invalidRun([{ ...definition(), params: { actual: "{repo}" } }]);
    strictEqual(reads, 0);
  } finally {
    for (const key of ["description", "repair_action_id", "repo", "timeoutMs"]) delete (Object.prototype as Record<string, unknown>)[key];
  }
});

test("CheckRegistry internal async records/reports do not inherit then hooks", async () => {
  let reads = 0;
  const registry = new CheckRegistry();
  registry.register(custom, () => true);
  Object.defineProperty(Object.prototype, "then", { configurable: true, get() { reads += 1; throw new Error("synthetic-private inherited then"); } });
  let running: Promise<CheckReport>;
  try {
    running = registry.run([definition()]);
  } finally {
    delete (Object.prototype as Record<string, unknown>).then;
  }
  const report = await running;
  contract(report, true);
  strictEqual(reads, 0);
  strictEqual(Object.getPrototypeOf(report), null);
  strictEqual(Object.getPrototypeOf(report.results[0]), null);
});

test("CheckRegistry detached immutable snapshots survive mutations across awaited callbacks", async () => {
  const registry = new CheckRegistry();
  let release!: (value: boolean) => void;
  const invocations: CheckInvocation[] = [];
  registry.register(custom, (invocation) => {
    invocations.push(invocation);
    strictEqual(Object.isFrozen(invocation), true);
    strictEqual(Object.isFrozen(invocation.definition), true);
    strictEqual(Object.isFrozen(invocation.definition.params), true);
    strictEqual(Object.isFrozen(invocation.context), true);
    strictEqual(Reflect.set(invocation.definition.params, "actual", "mutated"), false);
    strictEqual(Reflect.set(invocation.context, "repo", "mutated"), false);
    if (invocation.definition.check_id === "check-a") return new Promise<boolean>((resolve) => { release = resolve; });
    strictEqual(invocation.definition.params.actual, "repo-synthetic");
    strictEqual(invocation.definition.description, "Synthetic comparison");
    strictEqual(invocation.context.repo, "repo-synthetic");
    return true;
  });
  const definitions = [definition(), { ...definition("check-b"), params: { actual: "{repo}" }, description: "Synthetic comparison" }];
  const context = { repo: "repo-synthetic" };
  const options = { timeoutMs: 1_000 };
  const running = registry.run(definitions, context, options);
  definitions[1]!.check_id = "changed";
  definitions[1]!.params.actual = "unsafe/private";
  definitions[1]!.description = "Changed description";
  context.repo = "changed";
  options.timeoutMs = 1;
  definitions.push(definition("check-c"));
  release(true);
  const report = await running;
  contract(report, true);
  deepStrictEqual(report.results.map((item) => item.check_id), ["check-a", "check-b"]);
  strictEqual(invocations.length, 2);
});

test("CheckRegistry blocks registration during callbacks/awaits and permits it after completion", async () => {
  const registry = new CheckRegistry();
  let release!: (value: boolean) => void;
  registry.register(custom, () => {
    throws(() => registry.register("custom:new-handler", () => true), fixedError("registry-busy"));
    throws(() => registry.registerBindingPredicates(), fixedError("registry-busy"));
    return new Promise<boolean>((resolve) => { release = resolve; });
  });
  const running = registry.run([definition()]);
  throws(() => registry.register("custom:new-handler", () => true), fixedError("registry-busy"));
  release(true);
  contract(await running, true);
  registry.register("custom:new-handler", () => true);
  contract(await registry.run([definition("check-b", "STOP", "custom:new-handler")]), true);
});

test("CheckRegistry concurrent runs have independent results and remain busy until both finish", async () => {
  const registry = new CheckRegistry();
  const releases: ((value: boolean) => void)[] = [];
  registry.register(custom, () => new Promise<boolean>((resolve) => releases.push(resolve)));
  const first = registry.run([definition()]);
  const second = registry.run([definition()]);
  releases[0]!(true); contract(await first, true);
  throws(() => registry.registerBindingPredicates(), fixedError("registry-busy"));
  releases[1]!(false); contract(await second, false);
  registry.registerBindingPredicates();
});

test("CheckRegistry thrown/rejected handler errors fail closed on WARN and omit private errors", async () => {
  for (const handler of [() => { throw new Error("synthetic-private /tmp/private ghp_1234567890"); }, async () => { throw new Error("synthetic-private /tmp/private"); }]) {
    let calls = 0;
    const registry = new CheckRegistry();
    registry.register(custom, () => { calls += 1; return handler(); });
    const report = await registry.run([definition("check-a", "WARN"), definition("check-b")]);
    contract(report, false);
    deepStrictEqual(statuses(report), ["failed:handler-threw", "skipped:stopped"]);
    strictEqual(calls, 1);
    strictEqual(JSON.stringify(report).includes("synthetic-private"), false);
  }
});

test("CheckRegistry malformed verdicts, truthy strings/objects and thenables cannot WARN into success", async () => {
  let reads = 0;
  const accessor = Object.defineProperty({}, "then", { get() { reads += 1; throw new Error("synthetic-private"); } });
  const thenable = { then() { reads += 1; return true; } };
  const proxy = watchedProxy({ passed: true }, () => { reads += 1; });
  for (const value of [undefined, null, 1, "true", "synthetic-private", {}, { passed: true }, [], accessor, thenable, proxy]) {
    const registry = new CheckRegistry();
    let calls = 0;
    registry.register(custom, unsafeHandler(() => { calls += 1; return value; }));
    const report = await registry.run([definition("check-a", "WARN"), definition("check-b")]);
    contract(report, false);
    deepStrictEqual(statuses(report), ["failed:invalid-verdict", "skipped:stopped"]);
    strictEqual(calls, 1);
  }
  strictEqual(reads, 0);
});

test("CheckRegistry native Promise transports still require actual boolean verdicts", async () => {
  const registry = new CheckRegistry();
  registry.register(custom, unsafeHandler(async () => "true"));
  const report = await registry.run([definition("check-a", "WARN")]);
  contract(report, false);
  deepStrictEqual(statuses(report), ["failed:invalid-verdict"]);
  const second = new CheckRegistry();
  const promise = Promise.resolve(true);
  let reads = 0;
  Object.defineProperty(promise, "then", { get() { reads += 1; throw new Error("synthetic-private"); } });
  second.register(custom, () => promise);
  contract(await second.run([definition()]), true);
  strictEqual(reads, 0);
});

test("CheckRegistry never-settle timeout aborts best-effort, skips even WARN and releases registry", async () => {
  const registry = new CheckRegistry();
  let signal!: AbortSignal;
  let calls = 0;
  registry.register(custom, (invocation) => { calls += 1; signal = invocation.signal; return new Promise<boolean>(() => {}); });
  const started = performance.now();
  const report = await registry.run([definition("check-a", "WARN"), definition("check-b")], {}, { timeoutMs: 10 });
  const elapsed = performance.now() - started;
  contract(report, false);
  deepStrictEqual(statuses(report), ["failed:timeout", "skipped:stopped"]);
  strictEqual(signal.aborted, true);
  strictEqual(calls, 1);
  strictEqual(elapsed < 2_000, true, "bounded async completion with generous scheduler margin");
  registry.registerBindingPredicates();
});

test("CheckRegistry late reject and late pass cannot change timed-out report or leak unhandledRejection", async () => {
  const unhandled: unknown[] = [];
  const listener = (error: unknown) => { unhandled.push(error); };
  process.on("unhandledRejection", listener);
  try {
    for (const mode of ["reject", "resolve"]) {
      const registry = new CheckRegistry();
      let resolve!: (value: boolean) => void;
      let reject!: (reason: unknown) => void;
      registry.register(custom, () => new Promise<boolean>((res, rej) => { resolve = res; reject = rej; }));
      const report = await registry.run([definition()], {}, { timeoutMs: 5 });
      const before = JSON.stringify(report);
      if (mode === "reject") reject(new Error("synthetic-private late error"));
      else resolve(true);
      await delay(20);
      strictEqual(JSON.stringify(report), before);
      deepStrictEqual(statuses(report), ["failed:timeout"]);
    }
    deepStrictEqual(unhandled, []);
  } finally { process.off("unhandledRejection", listener); }
});

test("CheckRegistry synchronous callback cannot be preempted, but an over-deadline true is not passed", async () => {
  const registry = new CheckRegistry();
  let completed = false;
  registry.register(custom, () => {
    const end = performance.now() + 15;
    while (performance.now() < end) { /* bounded synthetic blocking callback */ }
    completed = true;
    return true;
  });
  const report = await registry.run([definition()], {}, { timeoutMs: 2 });
  strictEqual(completed, true);
  contract(report, false);
  deepStrictEqual(statuses(report), ["failed:timeout"]);
});

test("CheckRegistry report is a closed sanitized projection with no params/context/description/repair", async () => {
  const registry = new CheckRegistry();
  registry.register(custom, () => true);
  const report = await registry.run([{ ...definition(), params: { actual: "param-private-label" }, description: "Synthetic private description", repair_action_id: "repair-private-label" }], { repo: "repo-private-label", task: "job-private-label", branch: "branch-private-label", sha: shaA });
  contract(report, true);
  deepStrictEqual(JSON.parse(JSON.stringify(report)), {
    verification: "predicate-only", authorization: "none", satisfied: true,
    results: [{ check_id: "check-a", type: custom, status: "passed", reason: "predicate-true" }],
  });
  const json = JSON.stringify(report);
  for (const value of ["param-private-label", "Synthetic private description", "repair-private-label", "repo-private-label", "job-private-label", "branch-private-label", shaA]) strictEqual(json.includes(value), false);
  const error = new CheckError("invalid-input");
  match(String(error), /^CheckError: invalid check input$/u);
  strictEqual(String(error.stack).includes("/"), false);
});

test("CheckRegistry maximum dense check/param lists and timeout limits accept valid data", async () => {
  const registry = new CheckRegistry();
  let calls = 0;
  registry.register(custom, ({ definition: check }) => { calls += 1; strictEqual(Object.keys(check.params).length, MAX_PARAMS); return true; });
  const params = Object.fromEntries(Array.from({ length: MAX_PARAMS }, (_, index) => [`p${index}`, "label"]));
  const definitions = Array.from({ length: MAX_CHECKS }, (_, index) => ({ ...definition(`check-${index}`), params }));
  contract(await registry.run(definitions, {}, { timeoutMs: MAX_TIMEOUT_MS }), true);
  strictEqual(calls, MAX_CHECKS);
  // Validate the lower option bound without assuming a 1 ms scheduler deadline.
  const missing = await new CheckRegistry().run([definition()], {}, { timeoutMs: 1 });
  contract(missing, false);
  deepStrictEqual(statuses(missing), ["failed:missing-handler"]);
});
