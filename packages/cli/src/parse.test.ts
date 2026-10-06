import { deepStrictEqual, rejects, strictEqual, throws } from "node:assert/strict";
import { test } from "node:test";
import { CliError, MAX_ID_LENGTH, MAX_LIMIT, observe, parseArgs, runCli, type ObservationRequest } from "@pi-vista/cli";

const usage = (error: unknown): boolean => error instanceof CliError && error.code === "usage" && error.message === "invalid arguments";

test("parseArgs accepts all four commands, common options on either side, and bound steps", () => {
  deepStrictEqual(parseArgs(["--json", "--base-dir", "relative-store", "history", "run-a", "--limit", "2"]), {
    kind: "observation", json: true, request: { command: "history", runId: "run-a", baseDir: "relative-store", limit: 2 },
  });
  deepStrictEqual(parseArgs(["history"]), { kind: "observation", json: false, request: { command: "history" } });
  deepStrictEqual(parseArgs(["inspect", "run-a", "--step", "run-a_s0"]), { kind: "observation", json: false, request: { command: "inspect", runId: "run-a", stepId: "run-a_s0" } });
  deepStrictEqual(parseArgs(["compare", "run-a", "run-b"]), { kind: "observation", json: false, request: { command: "compare", runIdA: "run-a", runIdB: "run-b" } });
  deepStrictEqual(parseArgs(["receipts", "run-a"]), { kind: "observation", json: false, request: { command: "receipts", runId: "run-a" } });
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
  for (const request of requests) await rejects(() => observe(request as ObservationRequest), usage);
});
