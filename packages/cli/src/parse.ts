import { types } from "node:util";
import { CliError, MAX_LIMIT, type ObservationRequest, type ParsedCommand } from "./contract.js";
import { isBoundStep, isCliIdentifier } from "./safety.js";

const COMMANDS = new Set(["history", "inspect", "compare", "receipts"]);
const OPTIONS = new Set(["--json", "--base-dir", "--step", "--limit"]);
const COMMON_KEYS = ["command", "baseDir", "limit"];

function invalid(): never {
  throw new CliError("usage");
}

function validBaseDir(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= 4096 && !/[\p{Cc}\p{Cf}]/u.test(value);
}

/** Read only own data descriptors; reject proxies before any observable operation. */
export function validateRequest(input: ObservationRequest): ObservationRequest {
  try {
    if (types.isProxy(input) || input === null || typeof input !== "object" || Array.isArray(input)) invalid();
    const prototype = Object.getPrototypeOf(input);
    if (prototype !== Object.prototype && prototype !== null) invalid();
    const values = new Map<string, unknown>();
    for (const key of Reflect.ownKeys(input)) {
      if (typeof key !== "string") invalid();
      const descriptor = Object.getOwnPropertyDescriptor(input, key);
      if (descriptor === undefined || !Object.hasOwn(descriptor, "value") || descriptor.value === undefined) invalid();
      values.set(key, descriptor.value);
    }
    const command = values.get("command");
    if (typeof command !== "string" || !COMMANDS.has(command)) invalid();
    const commandKeys = command === "compare" ? ["runIdA", "runIdB"]
      : command === "inspect" ? ["runId", "stepId"] : ["runId"];
    const allowed = new Set([...COMMON_KEYS, ...commandKeys]);
    for (const key of values.keys()) if (!allowed.has(key)) invalid();
    const baseDir = values.get("baseDir");
    const limit = values.get("limit");
    const runId = values.get("runId");
    if (values.has("baseDir") && !validBaseDir(baseDir)) invalid();
    if (values.has("limit") && (typeof limit !== "number" || !Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT)) invalid();
    if (command === "compare") {
      if (!isCliIdentifier(values.get("runIdA")) || !isCliIdentifier(values.get("runIdB"))) invalid();
    } else {
      if ((command !== "history" || values.has("runId")) && !isCliIdentifier(runId)) invalid();
      if (command === "inspect" && values.has("stepId") && !isBoundStep(runId, values.get("stepId"))) invalid();
    }
    // Optional lookups downstream must not fall through to Object.prototype.
    const request = Object.create(null) as Record<string, unknown>;
    for (const [key, value] of values) request[key] = value;
    return request as ObservationRequest;
  } catch {
    return invalid();
  }
}

function snapshotArgv(input: readonly string[]): string[] {
  if (types.isProxy(input) || !Array.isArray(input) || Object.getPrototypeOf(input) !== Array.prototype) invalid();
  const descriptor = Object.getOwnPropertyDescriptor(input, "length");
  if (descriptor === undefined || !Object.hasOwn(descriptor, "value")) invalid();
  const length: unknown = descriptor.value;
  if (typeof length !== "number" || !Number.isInteger(length) || length < 0 || length > 32) invalid();
  // Dense indices plus length must exhaust own keys, excluding symbols/extras.
  if (Reflect.ownKeys(input).length !== length + 1) invalid();
  const argv: string[] = [];
  for (let index = 0; index < length; index += 1) {
    const element = Object.getOwnPropertyDescriptor(input, String(index));
    if (element === undefined || !Object.hasOwn(element, "value")) invalid();
    const value: unknown = element.value;
    if (typeof value !== "string" || value.length === 0 || value.length > 4096 || /[\p{Cc}\p{Cf}]/u.test(value)) invalid();
    argv.push(value);
  }
  return argv;
}

function parseSnapshot(argv: readonly string[]): ParsedCommand {
  if (argv.length === 0) return { kind: "help" };
  const info: readonly string[] = argv.filter((arg) => arg === "--help" || arg === "-h" || arg === "--version");
  if (info.length > 0) {
    const rest = argv.filter((arg) => !info.includes(arg));
    if (info.length !== 1 || rest.length > 1 || (rest.length === 1 && !COMMANDS.has(rest[0]!))) invalid();
    return { kind: info[0] === "--version" ? "version" : "help" };
  }
  const seen = new Set<string>();
  const positionals: string[] = [];
  let json = false;
  let baseDir: string | undefined;
  let stepId: string | undefined;
  let limit: number | undefined;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]!;
    if (!arg.startsWith("-")) {
      positionals.push(arg);
      continue;
    }
    if (!OPTIONS.has(arg) || seen.has(arg)) invalid();
    seen.add(arg);
    if (arg === "--json") {
      json = true;
      continue;
    }
    const next = argv[++index];
    if (next === undefined || next.startsWith("--")) invalid();
    if (arg === "--base-dir") {
      if (!validBaseDir(next)) invalid();
      baseDir = next;
    } else if (arg === "--step") {
      stepId = next;
    } else {
      if (!/^[1-9][0-9]{0,2}$/u.test(next)) invalid();
      limit = Number(next);
      if (limit > MAX_LIMIT) invalid();
    }
  }
  const [command, first, second] = positionals;
  const common = { ...(baseDir !== undefined ? { baseDir } : {}), ...(limit !== undefined ? { limit } : {}) };
  let request: ObservationRequest;
  if (command === "history" && positionals.length <= 2 && stepId === undefined) {
    request = { command, ...(first !== undefined ? { runId: first } : {}), ...common };
  } else if (command === "inspect" && positionals.length === 2 && first !== undefined) {
    request = { command, runId: first, ...(stepId !== undefined ? { stepId } : {}), ...common };
  } else if (command === "compare" && positionals.length === 3 && first !== undefined && second !== undefined && stepId === undefined) {
    request = { command, runIdA: first, runIdB: second, ...common };
  } else if (command === "receipts" && positionals.length === 2 && first !== undefined && stepId === undefined) {
    request = { command, runId: first, ...common };
  } else {
    return invalid();
  }
  return { kind: "observation", request: validateRequest(request), json };
}

/** Parse detached dense data only; malformed input always yields a fixed usage error. */
export function parseArgs(input: readonly string[]): ParsedCommand {
  try {
    return parseSnapshot(snapshotArgv(input));
  } catch {
    return invalid();
  }
}
